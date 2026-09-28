// tdd-cover: e2e packages/void-machine/test/codex-app-server-contract.test.ts
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
import type {
  AgentRuntimePort, LaunchOutcome, LaunchPlan, NativeRunRef, Preflight, RuntimeCapabilities, SessionState,
} from '../../runtime/delegation.js';
import { versionAtLeast } from './claude-session.js';
import {
  MIN_CODEX_VERSION, childEnvironment, handleOf, observeThread, parseCodexVersion, readThread, socketPathFor,
  threadStartParams, turnStartParams,
} from './codex-thread.js';

/**
 * Delegated runs as threads of a Codex app-server each run owns (learn.chatgpt.com/docs/app-server).
 * The server is started detached so it outlives the command that dispatched it; every later
 * command connects to its Unix socket for one bounded exchange and lets go. Its life ends with
 * the run: stopped, released when the run closes, and never claimed once its process is gone.
 * Contract replayed from Codex CLI 0.155.1 in test/fixtures/codex-app-server/.
 */

export interface CodexTimeouts {
  readonly versionMs: number;
  readonly socketMs: number;
  readonly callMs: number;
  readonly turnStartMs: number;
  readonly exitMs: number;
}
const TIMEOUTS: CodexTimeouts = { versionMs: 10_000, socketMs: 10_000, callMs: 5_000, turnStartMs: 15_000,
  exitMs: 3_000 };
const MAX_FRAME_BYTES = 4_194_304;
const MAX_BRIEF_BYTES = 1_048_576;
const POLL_MS = 50;

export interface CodexAppServerConfig {
  /** The codex executable, with any leading arguments; `['codex']` in production. */
  readonly command: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** Where each run's process record lives: `<machine root>/agents/codex`. */
  readonly stateDirectory: string;
  /** A private directory short enough for socket addresses, outside every Codex sandbox root. */
  readonly socketDirectory: string;
  readonly timeouts?: Partial<CodexTimeouts>;
}

const CAPABILITIES: RuntimeCapabilities = {
  view: { available: false, provenance: 'unknown', note: 'codex resume <thread> --remote unix://<socket> is not '
    + 'proven in a pane yet (2026-09-28: the TUI needs a real terminal); the run has no view until it is' },
  capture: { available: false, provenance: 'observed', note: 'a PreToolUse deny on collaborationspawn_agent holds, '
    + 'but its tool_input.message is encrypted, so the brief cannot be handed to the kernel (Codex 0.155.1, '
    + '2026-09-28); a Codex coordinator dispatches through void-machine agents itself' },
  structuredOutput: { available: true, provenance: 'verified', note: 'turn/start outputSchema; the final '
    + 'answer is also checked against the schema the run was dispatched with' },
};

// State ------------------------------------------------------------------------------------

const stateSchema = z.strictObject({ schemaVersion: z.literal(1), pid: z.number().int().min(2),
  startedAt: z.string().min(1).max(100),
  phase: z.enum(['spawned', 'thread-started', 'turn-starting', 'turn-started']),
  threadId: z.string().min(1).max(100).exactOptional(), turnId: z.string().min(1).max(100).exactOptional(),
  previousTurnId: z.string().min(1).max(100).exactOptional() });
type RunState = z.infer<typeof stateSchema>;

async function readState(path: string): Promise<RunState | undefined> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 4_096) return undefined;
      const parsed = stateSchema.safeParse(JSON.parse(await handle.readFile('utf8')));
      return parsed.success ? parsed.data : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function writeState(path: string, state: RunState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

// Processes --------------------------------------------------------------------------------

/** The start time and command line of a live process, from `ps`; undefined once it is gone. */
function identity(pid: number): { readonly startedAt: string; readonly command: string } | undefined {
  const ps = spawnSync('ps', ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)],
    { encoding: 'utf8', timeout: 5_000, shell: false });
  const line = ps.status === 0 ? ps.stdout.trim() : '';
  // `lstart` is a fixed-width date, such as `Mon Sep 28 23:41:02 2026`.
  const match = /^(\w{3}\s+\w{3}\s+\d{1,2}\s+[\d:]{8}\s+\d{4})\s+(.+)$/.exec(line);
  return match?.[1] === undefined || match[2] === undefined ? undefined
    : { startedAt: match[1].replace(/\s+/g, ' '), command: match[2] };
}

/** Whether the recorded process is still the app-server this run started, on this run's socket. */
function owned(state: RunState, socket: string): boolean {
  const live = identity(state.pid);
  return live !== undefined && live.startedAt === state.startedAt
    && live.command.endsWith(`app-server --listen unix://${socket}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => { setTimeout(done, ms); });
}

/** Ends the app-server's process group (its tool processes with it), escalating after a bound. */
async function terminate(pid: number, exitMs: number): Promise<boolean> {
  const signal = (name: NodeJS.Signals) => { try { process.kill(-pid, name); } catch { /* Already gone. */ } };
  signal('SIGTERM');
  for (let waited = 0; waited < exitMs; waited += POLL_MS) {
    if (identity(pid) === undefined) return true;
    await sleep(POLL_MS);
  }
  signal('SIGKILL');
  for (let waited = 0; waited < exitMs; waited += POLL_MS) {
    if (identity(pid) === undefined) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/** Creates the socket directory, or refuses one another user could reach or redirect. */
async function privateDirectory(directory: string): Promise<string | undefined> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  const uid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid)
    || (info.mode & 0o077) !== 0) {
    return `${directory} must be a directory of this user with mode 0700`;
  }
  return undefined;
}

// JSON-RPC over the socket ------------------------------------------------------------------

type Reply = { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly kind: 'error' | 'timeout' | 'closed'; readonly message: string };

interface Connection {
  call(method: string, params: unknown, timeoutMs: number): Promise<Reply>;
  /** A notification: no id, no answer. */
  notify(method: string, params: unknown): void;
  close(): void;
}

const rpcSchema = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(),
  result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });

function connect(socket: string, timeouts: CodexTimeouts): Promise<Connection | string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws+unix:${socket}`, { perMessageDeflate: false, handshakeTimeout: timeouts.callMs,
      maxPayload: MAX_FRAME_BYTES });
    const pending = new Map<number, (reply: Reply) => void>();
    let next = 0;
    ws.on('message', (data: WebSocket.RawData) => {
      let frame: z.infer<typeof rpcSchema>;
      try { frame = rpcSchema.parse(JSON.parse(data.toString())); } catch { return; }
      // A request from the server (an approval, an input) is a person's decision: never granted here.
      if (frame.method !== undefined && frame.id !== undefined) {
        ws.send(JSON.stringify({ id: frame.id, error: { code: -32601,
          message: 'void-machine never answers a server request; a person decides in the Codex session' } }));
        return;
      }
      const settle = typeof frame.id === 'number' ? pending.get(frame.id) : undefined;
      if (settle === undefined) return;
      pending.delete(Number(frame.id));
      settle(frame.error === undefined ? { ok: true, result: frame.result }
        : { ok: false, kind: 'error', message: frame.error.message.slice(0, 300) });
    });
    ws.on('close', () => {
      for (const settle of pending.values()) settle({ ok: false, kind: 'closed', message: 'the connection closed' });
      pending.clear();
    });
    ws.once('error', (error: Error) => resolve(`the app-server socket did not answer: ${error.message}`));
    ws.once('open', () => resolve({
      call(method, params, timeoutMs) {
        next += 1;
        const id = next;
        return new Promise((settle) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            settle({ ok: false, kind: 'timeout', message: `${method} did not answer in ${String(timeoutMs)} ms` });
          }, timeoutMs);
          pending.set(id, (reply) => { clearTimeout(timer); settle(reply); });
          ws.send(JSON.stringify({ method, id, params }));
        });
      },
      notify(method, params) { ws.send(JSON.stringify({ method, params })); },
      close() { ws.terminate(); },
    }));
  });
}

/** Connects and completes the handshake every connection needs before any other request. */
async function session(socket: string, timeouts: CodexTimeouts): Promise<Connection | string> {
  const connection = await connect(socket, timeouts);
  if (typeof connection === 'string') return connection;
  const initialized = await connection.call('initialize',
    { clientInfo: { name: 'void_machine', title: 'Void Machine', version: '1' } }, timeouts.callMs);
  if (!initialized.ok) {
    connection.close();
    return `initialize failed: ${initialized.message}`;
  }
  connection.notify('initialized', {});
  return connection;
}

// Adapter ----------------------------------------------------------------------------------

async function readBrief(path: string): Promise<string | undefined> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      return info.isFile() && info.size <= MAX_BRIEF_BYTES ? await handle.readFile('utf8') : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function threadIdOf(result: unknown): string | undefined {
  const parsed = z.object({ thread: z.object({ id: z.string().min(1).max(100) }) }).safeParse(result);
  return parsed.success ? parsed.data.thread.id : undefined;
}

function turnIdOf(result: unknown): string | undefined {
  const parsed = z.object({ turn: z.object({ id: z.string().min(1).max(100) }) }).safeParse(result);
  return parsed.success ? parsed.data.turn.id : undefined;
}

export function createCodexAppServerRuntime(config: CodexAppServerConfig): AgentRuntimePort {
  const timeouts: CodexTimeouts = { ...TIMEOUTS, ...config.timeouts };
  const statePath = (name: string) => join(config.stateDirectory, `${name}.json`);
  const socketOf = (name: string) => socketPathFor(config.socketDirectory, name);

  /** Ends what a run owns and forgets it: its process group, its socket, its record. */
  async function end(name: string): Promise<boolean> {
    const state = await readState(statePath(name));
    const socket = socketOf(name);
    let ended = true;
    if (state !== undefined && socket !== undefined && owned(state, socket)) ended = await terminate(state.pid, timeouts.exitMs);
    if (!ended) return false;
    if (socket !== undefined) await unlink(socket).catch(() => { /* Removed by the server on exit. */ });
    await unlink(statePath(name)).catch(() => { /* Never recorded, or already forgotten. */ });
    return true;
  }

  async function launch(plan: LaunchPlan, socket: string, brief: string): Promise<LaunchOutcome> {
    const refuse = async (cause: string, action: string): Promise<LaunchOutcome> => {
      await end(plan.name);
      return { kind: 'refused', cause, action };
    };
    const [executable, ...prefix] = config.command;
    if (executable === undefined) return { kind: 'refused', cause: 'no codex command is configured', action: 'none' };
    const child = spawn(executable, [...prefix, 'app-server', '--listen', `unix://${socket}`],
      { cwd: plan.cwd, env: childEnvironment(config.env), detached: true, stdio: 'ignore', shell: false });
    const started = await new Promise<string | undefined>((done) => {
      child.once('spawn', () => done(undefined));
      child.once('error', (error) => done(error.message));
    });
    child.unref();
    const pid = child.pid;
    const live = pid === undefined ? undefined : identity(pid);
    if (started !== undefined || pid === undefined || live === undefined) {
      return refuse(`codex app-server did not start: ${started ?? 'it exited at once'}`,
        'run codex app-server by hand to see why it fails');
    }
    // Recorded before each step that can fail, so a crash leaves a run the kernel can find.
    let state: RunState = { schemaVersion: 1, pid, startedAt: live.startedAt, phase: 'spawned' };
    await writeState(statePath(plan.name), state);
    for (let waited = 0; !existsSync(socket); waited += POLL_MS) {
      if (waited >= timeouts.socketMs || identity(pid) === undefined) {
        return refuse('codex app-server never opened its socket', 'run codex app-server by hand to see why it fails');
      }
      await sleep(POLL_MS);
    }
    const connection = await session(socket, timeouts);
    if (typeof connection === 'string') return refuse(connection, 'run codex app-server by hand to see why it fails');
    try {
      const thread = await connection.call('thread/start', threadStartParams(plan), timeouts.callMs);
      const threadId = thread.ok ? threadIdOf(thread.result) : undefined;
      if (threadId === undefined) {
        return refuse(`codex refused the thread: ${thread.ok ? 'no thread id' : thread.message}`,
          'check the model and the Codex login, then dispatch again');
      }
      state = { ...state, phase: 'turn-starting', threadId };
      await writeState(statePath(plan.name), state);
      const turn = await connection.call('turn/start', turnStartParams(threadId, brief, plan.outputSchema),
        timeouts.turnStartMs);
      if (!turn.ok && turn.kind === 'error') {
        return refuse(`codex refused the turn: ${turn.message}`, 'correct the brief or the output schema');
      }
      const turnId = turn.ok ? turnIdOf(turn.result) : undefined;
      if (turnId === undefined) {
        return { kind: 'lost', cause: 'codex did not confirm the turn in time; the thread is kept and looked up again' };
      }
      await writeState(statePath(plan.name), { ...state, phase: 'turn-started', turnId });
      return { kind: 'acknowledged', handle: handleOf(threadId) };
    } finally {
      connection.close();
    }
  }

  async function observeOne(name: string): Promise<SessionState | undefined> {
    const state = await readState(statePath(name));
    const socket = socketOf(name);
    // No thread recorded, or a process that is not this run's own: nothing is supervising it.
    if (state?.threadId === undefined || socket === undefined || !owned(state, socket)) return undefined;
    const binding = { handle: handleOf(state.threadId), sessionId: state.threadId };
    const connection = await session(socket, timeouts);
    if (typeof connection === 'string') return { observation: { kind: 'unreadable', cause: connection }, binding };
    try {
      const read = await connection.call('thread/read', { threadId: state.threadId, includeTurns: true },
        timeouts.callMs);
      const thread = read.ok ? readThread(read.result) : undefined;
      if (thread === undefined) {
        return { observation: { kind: 'unreadable',
          cause: read.ok ? 'thread/read answered an unknown shape' : read.message }, binding };
      }
      // While a new turn is unconfirmed, the previous turn's answer is not this turn's.
      const unconfirmed = state.phase === 'turn-starting' && thread.turns.at(-1)?.id === state.previousTurnId;
      const observed = unconfirmed ? { observation: thread.status.type === 'active'
        ? { kind: 'present' as const, state: 'working' as const, status: 'busy' as const }
        : { kind: 'unreadable' as const, cause: 'the new turn is not recorded yet' } }
        : observeThread(thread, state.turnId);
      return { ...observed, binding };
    } finally {
      connection.close();
    }
  }

  return {
    capabilities: CAPABILITIES,
    async preflight() {
      if (process.platform === 'win32') {
        return { ok: false, cause: 'Codex delegation needs a Unix socket, which this adapter does not open on Windows',
          action: 'dispatch with --runtime claude on Windows' };
      }
      const [executable, ...prefix] = config.command;
      const run = executable === undefined ? undefined : spawnSync(executable, [...prefix, '--version'],
        { encoding: 'utf8', timeout: timeouts.versionMs, env: childEnvironment(config.env), shell: false });
      const version = run?.status === 0 ? parseCodexVersion(run.stdout) : undefined;
      if (version === undefined) {
        return { ok: false, cause: 'codex is not installed, not on PATH, or did not report its version',
          action: `install Codex CLI ${MIN_CODEX_VERSION} or later` };
      }
      if (!versionAtLeast(version, MIN_CODEX_VERSION)) {
        return { ok: false, cause: `Codex CLI ${version} predates the app-server contract this adapter was proven `
          + `against (${MIN_CODEX_VERSION})`, action: `update Codex CLI to ${MIN_CODEX_VERSION} or later` };
      }
      return { ok: true };
    },
    async dispatch(plan) {
      const socket = socketOf(plan.name);
      if (socket === undefined) {
        return { kind: 'refused', cause: `${config.socketDirectory} is too long for a Unix socket address`,
          action: 'run void-machine from an account whose home directory has a shorter path' };
      }
      const refused = await privateDirectory(config.socketDirectory);
      if (refused !== undefined) return { kind: 'refused', cause: refused, action: `chmod 700 ${config.socketDirectory}` };
      const brief = await readBrief(plan.instructionPath);
      if (brief === undefined) return { kind: 'refused', cause: 'the brief file cannot be read', action: 'dispatch again' };
      const previous = await readState(statePath(plan.name));
      if (previous !== undefined && owned(previous, socket)) {
        return { kind: 'refused', cause: 'an app-server already serves this run', action: 'none' };
      }
      await end(plan.name);
      return launch(plan, socket, brief);
    },
    async observe(refs) {
      const sessions = new Map<string, SessionState>();
      for (const ref of refs) {
        const observed = await observeOne(ref.name);
        if (observed !== undefined) sessions.set(ref.name, observed);
      }
      return { kind: 'read', sessions };
    },
    async send(ref: NativeRunRef, plan: LaunchPlan): Promise<LaunchOutcome> {
      const state = await readState(statePath(ref.name));
      const socket = socketOf(ref.name);
      if (state?.threadId === undefined || socket === undefined || !owned(state, socket)) {
        return { kind: 'refused', cause: 'the Codex app-server of this run is no longer running',
          action: 'dispatch a new run; the thread stays readable with codex resume' };
      }
      const brief = await readBrief(plan.instructionPath);
      if (brief === undefined) return { kind: 'refused', cause: 'the message file cannot be read', action: 'send again' };
      const connection = await session(socket, timeouts);
      if (typeof connection === 'string') return { kind: 'lost', cause: connection };
      try {
        const read = await connection.call('thread/read', { threadId: state.threadId, includeTurns: true },
          timeouts.callMs);
        const last = read.ok ? readThread(read.result)?.turns.at(-1) : undefined;
        if (last?.status === 'inProgress') {
          const steered = await connection.call('turn/steer', { threadId: state.threadId, expectedTurnId: last.id,
            input: [{ type: 'text', text: brief }] }, timeouts.callMs);
          return steered.ok ? { kind: 'acknowledged', handle: handleOf(state.threadId) }
            : { kind: 'refused', cause: `codex refused the message: ${steered.message}`, action: 'wait and send again' };
        }
        const starting: RunState = { schemaVersion: 1, pid: state.pid, startedAt: state.startedAt,
          phase: 'turn-starting', threadId: state.threadId,
          ...(state.turnId === undefined ? {} : { previousTurnId: state.turnId }) };
        await writeState(statePath(ref.name), starting);
        const turn = await connection.call('turn/start', turnStartParams(state.threadId, brief, plan.outputSchema),
          timeouts.turnStartMs);
        const turnId = turn.ok ? turnIdOf(turn.result) : undefined;
        if (turnId === undefined) {
          return turn.ok || turn.kind !== 'error' ? { kind: 'lost', cause: 'codex did not confirm the turn in time' }
            : { kind: 'refused', cause: `codex refused the turn: ${turn.message}`, action: 'send again' };
        }
        await writeState(statePath(ref.name), { ...starting, phase: 'turn-started', turnId });
        return { kind: 'acknowledged', handle: handleOf(state.threadId) };
      } finally {
        connection.close();
      }
    },
    async stop(ref): Promise<Preflight> {
      const state = await readState(statePath(ref.name));
      const socket = socketOf(ref.name);
      if (state?.threadId !== undefined && socket !== undefined && owned(state, socket)) {
        const connection = await session(socket, timeouts);
        if (typeof connection !== 'string') {
          try {
            const read = await connection.call('thread/read', { threadId: state.threadId, includeTurns: true },
              timeouts.callMs);
            const last = read.ok ? readThread(read.result)?.turns.at(-1) : undefined;
            if (last?.status === 'inProgress') {
              await connection.call('turn/interrupt', { threadId: state.threadId, turnId: last.id }, timeouts.callMs);
            }
          } finally {
            connection.close();
          }
        }
      }
      return await end(ref.name) ? { ok: true }
        : { ok: false, cause: 'the Codex app-server did not exit', action: `kill -KILL -${String(state?.pid)}` };
    },
    async release(ref) {
      await end(ref.name).catch(() => undefined);
    },
    attachCommand() {
      return undefined;
    },
  };
}
