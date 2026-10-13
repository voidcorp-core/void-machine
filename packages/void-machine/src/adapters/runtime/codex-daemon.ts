// tdd-cover: e2e packages/void-machine/test/codex-daemon-contract.test.ts
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import WebSocket from 'ws';
import { z } from 'zod';
import type {
  AgentRuntimePort, LaunchOutcome, LaunchPlan, NativeRunRef, Preflight, RuntimeCapabilities, RuntimeReading,
  SessionState,
} from '../../runtime/delegation.js';
import {
  DAEMON_START, MIN_CODEX_VERSION, type ThreadReading, type TurnReading, childEnvironment, daemonReadiness,
  handleOf, observeThread, parseDaemonVersion, printable, readLastTurn, readThread, threadNamed,
  threadResumeParams, threadStartParams, turnStartParams,
} from './codex-thread.js';

/**
 * Delegated runs as threads of the Codex app-server daemon (learn.chatgpt.com/docs/app-server),
 * the supervisor Codex runs itself, as `claude --bg` is Claude Code's: the daemon owns every
 * process, and a turn outlives the connection that started it. Each command connects to the
 * daemon's control socket for one bounded exchange and lets go; the adapter keeps nothing, and a
 * run's thread is found again by the name the run gave it.
 * Contract replayed from the Codex 0.158.0 daemon in test/fixtures/codex-daemon/.
 */

export interface CodexTimeouts {
  readonly versionMs: number;
  readonly startMs: number;
  readonly callMs: number;
  readonly turnStartMs: number;
}
const TIMEOUTS: CodexTimeouts = { versionMs: 10_000, startMs: 30_000, callMs: 5_000, turnStartMs: 15_000 };
/** One reply holds a thread's status or its last turn, never its whole history. */
const MAX_FRAME_BYTES = 4_194_304;
const MAX_BRIEF_BYTES = 1_048_576;
/** A run's name is unique; a search by it lists more than a handful only when something is wrong. */
const LIST_LIMIT = 10;
const MESSAGE_MAX = 300;

export interface CodexDaemonConfig {
  /** The codex executable, with any leading arguments; `['codex']` in production. */
  readonly command: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** The daemon's control socket, from `controlSocketPath`; preflight checks the daemon agrees. */
  readonly socketPath: string;
  readonly timeouts?: Partial<CodexTimeouts>;
  readonly maxFrameBytes?: number;
}

const CAPABILITIES: RuntimeCapabilities = {
  view: { available: true, provenance: 'verified', note: 'codex resume <thread> --remote unix://<daemon socket>, '
    + 'shown live in a herdr pane (DEV-926, 2026-09-29)' },
  capture: { available: false, provenance: 'observed', note: 'a PreToolUse deny on collaborationspawn_agent holds, '
    + 'but its tool_input.message is encrypted, so the brief cannot be handed to the kernel (Codex 0.155.1, '
    + '2026-09-28); a Codex coordinator dispatches through void-machine agents itself' },
  structuredOutput: { available: true, provenance: 'verified', note: 'turn/start outputSchema; the final '
    + 'answer is also checked against the schema the run was dispatched with' },
};

// JSON-RPC over the control socket ---------------------------------------------------------

type Reply = { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly kind: 'error' | 'timeout' | 'closed'; readonly message: string };
type Failed = Extract<Reply, { ok: false }>;

/** A write the daemon neither confirmed nor refused may have landed: never retried, looked up. */
const uncertain = (reply: Failed) => reply.kind !== 'error';

interface Connection {
  call(method: string, params: unknown, timeoutMs: number): Promise<Reply>;
  /** A notification: no id, no answer. */
  notify(method: string, params: unknown): void;
  close(): void;
}

interface Refusal { readonly cause: string; readonly action: string }

interface Limits { readonly timeouts: CodexTimeouts; readonly maxFrameBytes: number }

const rpcSchema = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(),
  result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });

/** The socket must be this user's: a brief is never sent to one another account could have planted. */
async function socketRefusal(socket: string): Promise<Refusal | undefined> {
  const info = await stat(socket).catch(() => undefined);
  if (info === undefined) {
    return { cause: `the Codex daemon does not answer on ${socket}: no socket`, action: DAEMON_START };
  }
  if (!info.isSocket() || info.uid !== process.getuid?.()) {
    return { cause: `${socket} is not a socket of this user`,
      action: 'remove it, then run codex app-server daemon restart' };
  }
  return undefined;
}

function connect(socket: string, limits: Limits): Promise<Connection | Refusal> {
  return new Promise((resolve) => {
    // The IPC address separates the socket path from the request path with `:`.
    const ws = new WebSocket(`ws+unix://${socket}:/`, { perMessageDeflate: false,
      handshakeTimeout: limits.timeouts.callMs, maxPayload: limits.maxFrameBytes });
    const pending = new Map<number, (reply: Reply) => void>();
    let closed: string | undefined;
    let next = 0;
    const closeAll = (message: string) => {
      closed ??= message;
      for (const settle of pending.values()) settle({ ok: false, kind: 'closed', message: closed });
      pending.clear();
    };
    ws.on('message', (data: WebSocket.RawData) => {
      let frame: z.infer<typeof rpcSchema>;
      try { frame = rpcSchema.parse(JSON.parse(data.toString())); } catch { return; }
      // A request from the daemon (an approval, an input) is a person's decision: it is left
      // pending, never answered, and the thread's active flags surface it.
      if (frame.method !== undefined) return;
      const settle = typeof frame.id === 'number' ? pending.get(frame.id) : undefined;
      if (settle === undefined) return;
      pending.delete(Number(frame.id));
      settle(frame.error === undefined ? { ok: true, result: frame.result }
        : { ok: false, kind: 'error', message: printable(frame.error.message, MESSAGE_MAX) });
    });
    ws.on('error', (error: Error & { code?: string }) => {
      if (error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
        closeAll(`a reply of the Codex daemon exceeded the ${String(limits.maxFrameBytes)}-byte frame bound`);
      }
      resolve({ cause: `the Codex daemon does not answer on ${socket}: ${printable(error.message, MESSAGE_MAX)}`,
        action: DAEMON_START });
    });
    ws.on('close', () => closeAll('the connection closed'));
    ws.once('open', () => resolve({
      call(method, params, timeoutMs) {
        // A connection the daemon dropped answers at once: no call waits out its timeout on it.
        if (closed !== undefined) return Promise.resolve({ ok: false, kind: 'closed', message: closed });
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

/**
 * Connects and completes the handshake every connection needs before any other request. Only a
 * connection that needs an experimental method asks for that API, so no other depends on it.
 */
async function session(socket: string, limits: Limits, experimental: boolean): Promise<Connection | Refusal> {
  const refused = await socketRefusal(socket);
  if (refused !== undefined) return refused;
  const connection = await connect(socket, limits);
  if (!('call' in connection)) return connection;
  const initialized = await connection.call('initialize',
    { clientInfo: { name: 'void_machine', title: 'Void Machine', version: '1' },
      ...(experimental ? { capabilities: { experimentalApi: true } } : {}) }, limits.timeouts.callMs);
  if (!initialized.ok) {
    connection.close();
    return { cause: `the Codex daemon refused the handshake: ${initialized.message}`, action: DAEMON_START };
  }
  connection.notify('initialized', {});
  return connection;
}

// Reading a run's thread -------------------------------------------------------------------

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

const idSchema = (key: 'thread' | 'turn') => z.object({ [key]: z.object({ id: z.string().min(1).max(100) }) });
function idOf(key: 'thread' | 'turn', reply: Reply): string | undefined {
  if (!reply.ok) return undefined;
  const parsed = idSchema(key).safeParse(reply.result);
  return parsed.success ? (parsed.data[key] as { id: string }).id : undefined;
}

type Located = { readonly kind: 'thread'; readonly thread: ThreadReading; readonly turn: TurnReading | undefined }
  | { readonly kind: 'none' }
  /** `lost` when the connection itself failed: nothing more is asked on it. */
  | { readonly kind: 'unreadable'; readonly cause: string; readonly lost: boolean };

const unreadable = (reply: Failed): Located => ({ kind: 'unreadable', cause: reply.message, lost: uncertain(reply) });

/**
 * The run's thread and its last turn: by the id it is bound to, or by its name. A thread renamed
 * is not the run's. Only the last turn is read, so the reply never grows with the run.
 */
async function locate(connection: Connection, ref: NativeRunRef, timeouts: CodexTimeouts): Promise<Located> {
  let threadId = ref.sessionId;
  if (threadId === undefined) {
    const listed = await connection.call('thread/list', { searchTerm: ref.name, limit: LIST_LIMIT }, timeouts.callMs);
    if (!listed.ok) return unreadable(listed);
    const named = threadNamed(listed.result, ref.name);
    if (named.kind === 'none') return named;
    if (named.kind === 'unreadable') return { ...named, lost: false };
    threadId = named.threadId;
  }
  const read = await connection.call('thread/read', { threadId, includeTurns: false }, timeouts.callMs);
  if (!read.ok) return unreadable(read);
  const thread = readThread(read.result);
  if (thread === undefined) return { kind: 'unreadable', cause: 'thread/read answered an unknown shape', lost: false };
  if (thread.name !== ref.name) {
    return { kind: 'unreadable', cause: `the thread ${threadId} no longer carries the name ${ref.name}`, lost: false };
  }
  const turns = await connection.call('thread/turns/list',
    { threadId, limit: 1, sortDirection: 'desc', itemsView: 'full' }, timeouts.callMs);
  if (!turns.ok) return unreadable(turns);
  const last = readLastTurn(turns.result);
  if (last === undefined) {
    return { kind: 'unreadable', cause: 'thread/turns/list answered an unknown shape', lost: false };
  }
  return { kind: 'thread', thread, turn: last.turn };
}

async function readSessions(connection: Connection, refs: readonly NativeRunRef[], timeouts: CodexTimeouts)
  : Promise<Map<string, SessionState>> {
  const sessions = new Map<string, SessionState>();
  let lost: string | undefined;
  for (const ref of refs) {
    const located: Located = lost === undefined ? await locate(connection, ref, timeouts)
      : { kind: 'unreadable', cause: lost, lost: true };
    if (located.kind === 'none') continue;
    if (located.kind === 'unreadable') {
      if (located.lost) lost = located.cause;
      sessions.set(ref.name, { observation: { kind: 'unreadable', cause: located.cause } });
      continue;
    }
    const { thread, turn } = located;
    sessions.set(ref.name, { ...observeThread(thread, turn),
      binding: { handle: handleOf(thread.id), sessionId: thread.id } });
  }
  return sessions;
}

// Writing to a run's thread ----------------------------------------------------------------

/** Archives a thread no run follows, so no later search finds it; says why when it cannot. */
async function archive(connection: Connection, threadId: string, timeouts: CodexTimeouts): Promise<string> {
  const archived = await connection.call('thread/archive', { threadId }, timeouts.callMs);
  return archived.ok ? '' : `; the thread ${threadId} could not be archived: ${archived.message}`;
}

async function launch(connection: Connection, plan: LaunchPlan, brief: string, timeouts: CodexTimeouts)
  : Promise<LaunchOutcome> {
  const started = await connection.call('thread/start', threadStartParams(plan), timeouts.callMs);
  const threadId = idOf('thread', started);
  if (threadId === undefined) {
    return { kind: 'refused', cause: `codex refused the thread: ${started.ok ? 'no thread id' : started.message}`,
      action: 'check the model and the Codex login' };
  }
  // The name is how every later command finds the thread: a thread without it is never run.
  const named = await connection.call('thread/name/set', { threadId, name: plan.name }, timeouts.callMs);
  if (!named.ok) {
    if (uncertain(named)) {
      return { kind: 'lost',
        cause: 'codex did not confirm the name of the thread in time; the thread is looked up by its name' };
    }
    return { kind: 'refused', cause: `codex did not name the thread: ${named.message}`
      + await archive(connection, threadId, timeouts), action: 'dispatch again' };
  }
  const turn = await connection.call('turn/start', turnStartParams(threadId, brief, plan.outputSchema),
    timeouts.turnStartMs);
  if (!turn.ok && !uncertain(turn)) {
    return { kind: 'refused', cause: `codex refused the turn: ${turn.message}`
      + await archive(connection, threadId, timeouts), action: 'correct the brief or the output schema' };
  }
  if (idOf('turn', turn) === undefined) {
    return { kind: 'lost', cause: 'codex did not confirm the turn in time; the thread is looked up by its name' };
  }
  return { kind: 'acknowledged', handle: handleOf(threadId), sessionId: threadId };
}

/** The next message of a run: steers the turn still running, or starts the next one. */
async function continueThread(connection: Connection, located: Extract<Located, { kind: 'thread' }>,
  plan: LaunchPlan, brief: string, timeouts: CodexTimeouts): Promise<LaunchOutcome> {
  const { thread, turn: last } = located;
  const acknowledged: LaunchOutcome = { kind: 'acknowledged', handle: handleOf(thread.id) };
  if (last?.status === 'inProgress' && thread.status.type === 'active') {
    const steered = await connection.call('turn/steer',
      { threadId: thread.id, expectedTurnId: last.id, input: [{ type: 'text', text: brief }] }, timeouts.callMs);
    if (steered.ok) return acknowledged;
    return uncertain(steered) ? { kind: 'lost', cause: 'codex did not confirm the message in time' }
      : { kind: 'refused', cause: `codex refused the message: ${steered.message}`, action: 'wait and send again' };
  }
  if (thread.status.type === 'notLoaded') {
    // The daemon unloads an idle thread; a turn on it is refused until it is resumed (proven 2026-09-29).
    const resumed = await connection.call('thread/resume', threadResumeParams(thread.id, plan), timeouts.turnStartMs);
    if (!resumed.ok) {
      return uncertain(resumed) ? { kind: 'lost', cause: 'codex did not confirm the resume in time' }
        : { kind: 'refused', cause: `codex did not resume the thread: ${resumed.message}`, action: 'send again' };
    }
  }
  const turn = await connection.call('turn/start', turnStartParams(thread.id, brief, plan.outputSchema),
    timeouts.turnStartMs);
  if (!turn.ok && !uncertain(turn)) {
    return { kind: 'refused', cause: `codex refused the turn: ${turn.message}`, action: 'send again' };
  }
  return idOf('turn', turn) === undefined ? { kind: 'lost', cause: 'codex did not confirm the turn in time' }
    : acknowledged;
}

/**
 * Interrupts the turn a run is running, then ends the commands its turns left in the background,
 * which an interruption leaves alive (proven on 2026-09-29). A thread the daemon unloaded, or a run
 * with no thread, runs nothing.
 */
async function interrupt(connection: Connection, ref: NativeRunRef, timeouts: CodexTimeouts): Promise<Preflight> {
  const located = await locate(connection, ref, timeouts);
  if (located.kind === 'none') return { ok: true };
  if (located.kind === 'unreadable') return { ok: false, cause: located.cause, action: 'stop again' };
  const { thread, turn } = located;
  if (thread.status.type === 'notLoaded') return { ok: true };
  if (turn?.status === 'inProgress' && thread.status.type === 'active') {
    const interrupted = await connection.call('turn/interrupt', { threadId: thread.id, turnId: turn.id },
      timeouts.callMs);
    if (!interrupted.ok) {
      return { ok: false, cause: `codex did not interrupt the turn: ${interrupted.message}`, action: 'stop again' };
    }
  }
  const cleaned = await connection.call('thread/backgroundTerminals/clean', { threadId: thread.id }, timeouts.callMs);
  return cleaned.ok ? { ok: true } : { ok: false,
    cause: `codex did not end the background commands of the thread: ${cleaned.message}`,
    action: `stop again; if it persists, end them from codex resume ${thread.id}` };
}

// Daemon management through the codex CLI --------------------------------------------------

type Codex = (args: readonly string[], timeoutMs: number)
  => { readonly code: number | null; readonly stdout: string; readonly stderr: string };

function codexCommand(config: CodexDaemonConfig): Codex {
  const [executable, ...prefix] = config.command;
  return (args, timeoutMs) => {
    if (executable === undefined) return { code: null, stdout: '', stderr: '' };
    const run = spawnSync(executable, [...prefix, ...args], { encoding: 'utf8', timeout: timeoutMs,
      env: childEnvironment(config.env), shell: false });
    return { code: run.error === undefined ? run.status : null, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  };
}

/** The daemon, running at the right version on the right socket; started once when it is not running. */
function daemonPreflight(codex: Codex, socketPath: string, timeouts: CodexTimeouts): Preflight {
  if (process.platform === 'win32') {
    return { ok: false, cause: 'the Codex daemon listens on a Unix socket, which this adapter does not reach '
      + 'on Windows', action: 'dispatch with --runtime claude on Windows' };
  }
  const version = () => {
    const run = codex(['app-server', 'daemon', 'version'], timeouts.versionMs);
    return run.code === 0 ? parseDaemonVersion(run.stdout) : undefined;
  };
  const first = version();
  if (first === undefined) {
    return { ok: false, cause: 'codex is not installed, not on PATH, or has no app-server daemon',
      action: `install Codex CLI ${MIN_CODEX_VERSION} or later` };
  }
  let readiness = daemonReadiness(first, socketPath);
  let startError = '';
  if (readiness.kind === 'start') {
    const started = codex(['app-server', 'daemon', 'start'], timeouts.startMs);
    const said = printable(started.stderr.trim().split('\n')[0] ?? '', MESSAGE_MAX);
    startError = said === '' ? '' : `: ${said}`;
    const second = version();
    readiness = second === undefined ? readiness : daemonReadiness(second, socketPath);
  }
  if (readiness.kind === 'start') {
    return { ok: false, cause: `the Codex daemon is not running and ${DAEMON_START} did not bring it up${startError}`,
      action: `run ${DAEMON_START} and read its error` };
  }
  return readiness.kind === 'ready' ? { ok: true } : { ok: false, cause: readiness.cause, action: readiness.action };
}

// Adapter ----------------------------------------------------------------------------------

function isRefusal<T extends object>(value: T | Refusal): value is Refusal {
  return !(value instanceof Map) && 'cause' in value && 'action' in value && !('kind' in value) && !('ok' in value);
}

export function createCodexDaemonRuntime(config: CodexDaemonConfig): AgentRuntimePort {
  const timeouts: CodexTimeouts = { ...TIMEOUTS, ...config.timeouts };
  const limits: Limits = { timeouts, maxFrameBytes: config.maxFrameBytes ?? MAX_FRAME_BYTES };
  /** One bounded exchange with the daemon; the connection is closed whatever happens. */
  async function exchange<T>(work: (connection: Connection) => Promise<T>, experimental = false)
    : Promise<T | Refusal> {
    const connection = await session(config.socketPath, limits, experimental);
    if (!('call' in connection)) return connection;
    try {
      return await work(connection);
    } finally {
      connection.close();
    }
  }
  return {
    capabilities: CAPABILITIES,
    async preflight() {
      return daemonPreflight(codexCommand(config), config.socketPath, timeouts);
    },
    async dispatch(plan) {
      const brief = await readBrief(plan.instructionPath);
      if (brief === undefined) {
        return { kind: 'refused', cause: 'the brief file cannot be read', action: 'dispatch again' };
      }
      const outcome = await exchange((connection) => launch(connection, plan, brief, timeouts));
      return isRefusal(outcome) ? { kind: 'refused', ...outcome } : outcome;
    },
    async observe(refs): Promise<RuntimeReading> {
      if (refs.length === 0) return { kind: 'read', sessions: new Map() };
      const sessions = await exchange((connection) => readSessions(connection, refs, timeouts));
      return isRefusal(sessions) ? { kind: 'unreadable', cause: `${sessions.cause}; start it with ${DAEMON_START}` }
        : { kind: 'read', sessions };
    },
    async send(ref, plan) {
      const brief = await readBrief(plan.instructionPath);
      if (brief === undefined) {
        return { kind: 'refused', cause: 'the message file cannot be read', action: 'send again' };
      }
      const outcome = await exchange(async (connection): Promise<LaunchOutcome> => {
        const located = await locate(connection, ref, timeouts);
        if (located.kind === 'none') {
          return { kind: 'refused', cause: 'no Codex thread carries this run', action: 'dispatch a new run' };
        }
        if (located.kind === 'unreadable') return { kind: 'refused', cause: located.cause, action: 'send again' };
        return continueThread(connection, located, plan, brief, timeouts);
      });
      return isRefusal(outcome) ? { kind: 'refused', ...outcome } : outcome;
    },
    async stop(ref): Promise<Preflight> {
      const outcome = await exchange((connection) => interrupt(connection, ref, timeouts), true);
      return isRefusal(outcome) ? { ok: false, ...outcome } : outcome;
    },
    attachCommand(ref) {
      const [executable, ...prefix] = config.command;
      if (executable === undefined || ref.sessionId === undefined) return undefined;
      return [executable, ...prefix, 'resume', ref.sessionId, '--remote', `unix://${config.socketPath}`];
    },
  };
}
