import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { WebSocketServer } from 'ws';
import { createCodexDaemonRuntime } from '../src/adapters/runtime/codex-daemon.js';
import type { AgentRuntimePort, LaunchPlan, NativeRunRef, SessionState } from '../src/runtime/delegation.js';

/**
 * The adapter against a fake daemon that answers with the frames captured from the Codex
 * app-server daemon 0.158.0 on 2026-09-29 (./fixtures/codex-daemon/), over a WebSocket on a Unix
 * socket as the real one does. Replies are replayed verbatim with their ids rewritten; a test only
 * chooses which captured frame answers each request. Synthetic frames are marked so.
 */

const fakeCli = fileURLToPath(new URL('./fixtures/codex-daemon-cli.mjs', import.meta.url));
const captured = (name: string): { result?: unknown; error?: { code: number; message: string } } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/codex-daemon/${name}`, import.meta.url)), 'utf8'));
const dispatchFrames = captured('dispatch.frames.json') as unknown as {
  requests: Array<{ method: string; params?: unknown }>;
  frames: Array<{ id?: number; method?: string; result?: unknown }> };
const reply = (id: number) => dispatchFrames.frames.find((frame) => frame.id === id && frame.method === undefined);

const THREAD = '01a0ea7c-0a16-7d92-a048-70f5effc1707';
const FIRST_TURN = '01a0ea7c-0dca-7c00-9c0b-b879856bbeec';
const RUN = 'vm-run_00000000-0000-4000-8000-000000000001';
const HANDLE = 'effc1707';
const verdict = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] },
  summary: { type: 'string' } }, required: ['verdict', 'summary'], additionalProperties: false };

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
/** How the fake daemon answers one request: a reply, silence, or dropping the connection. */
type Answer = { result: unknown } | { error: { code: number; message: string } } | 'silent' | 'close';
type Script = Partial<Record<string, (params: Record<string, unknown>) => Answer>>;

const result = (name: string): Answer => ({ result: captured(name).result });
const failure = (message: string): Answer => ({ error: { code: -32600, message } });
/** The daemon as a snapshot shows it: the thread without turns, and its last turn. */
const snapshot = (name: string): Script => ({ 'thread/read': () => result(`${name}.read.json`),
  'thread/turns/list': () => result(`${name}.turns.json`) });
/** Synthetic: the captured thread with the runtime status the test sets (ThreadStatus). */
const withStatus = (name: string, status: unknown): Answer => {
  const read = structuredClone(captured(`${name}.read.json`).result) as { thread: Record<string, unknown> };
  return { result: { thread: { ...read.thread, status } } };
};

const DEFAULT: Script = {
  'initialize': () => ({ result: reply(1)?.result }),
  'thread/start': () => ({ result: reply(2)?.result }),
  'thread/name/set': () => ({ result: reply(3)?.result }),
  'turn/start': () => ({ result: reply(4)?.result }),
  'thread/list': () => result('list-by-name.json'),
  ...snapshot('in-progress'),
  'turn/steer': () => result('steer.json'),
  'turn/interrupt': () => result('interrupt.json'),
  'thread/resume': () => result('resume.json'),
  // Synthetic replies, as ThreadArchiveResponse and ThreadBackgroundTerminalsCleanResponse type them;
  // both calls were proven on the daemon on 2026-09-29.
  'thread/archive': () => ({ result: {} }),
  'thread/backgroundTerminals/clean': () => ({ result: {} }),
};

interface HarnessOptions {
  readonly listening?: boolean;
  /** Called on each connection the adapter opens, with a sender on it. */
  readonly onConnection?: (send: (message: unknown) => void) => void;
  readonly maxFrameBytes?: number;
}

interface Harness {
  readonly runtime: AgentRuntimePort;
  readonly plan: LaunchPlan;
  readonly socket: string;
  /** Every frame the adapter sent, with the connection it came on. */
  readonly sent: Array<{ connection: number; message: Message }>;
  readonly cliCalls: () => string[][];
  readonly setDaemon: (fields: Record<string, unknown>) => void;
}

async function harness(script: Script = {}, options: HarnessOptions = {}): Promise<Harness> {
  // Under /tmp: a socket address must fit in 104 bytes, which a nested temporary directory may not.
  const base = mkdtempSync('/tmp/vmcd-');
  const socket = join(base, 'control.sock');
  const state = join(base, 'daemon.json');
  const log = join(base, 'cli.jsonl');
  const brief = join(base, 'brief.md');
  writeFileSync(brief, 'Reply with verdict pass and a one-sentence summary saying hello.');
  let daemon: Record<string, unknown> = { status: 'running', cli: '0.158.0', server: '0.158.0', socketPath: socket };
  const setDaemon = (fields: Record<string, unknown>) => {
    daemon = { ...daemon, ...fields };
    writeFileSync(state, JSON.stringify(daemon));
  };
  setDaemon({});
  const sent: Harness['sent'] = [];
  const answers = { ...DEFAULT, ...script };
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  let connections = 0;
  sockets.on('connection', (ws) => {
    connections += 1;
    const connection = connections;
    options.onConnection?.((message) => ws.send(JSON.stringify(message)));
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Message;
      sent.push({ connection, message });
      if (message.id === undefined || message.method === undefined) return;
      const answer = answers[message.method]?.(message.params ?? {})
        ?? { error: { code: -32601, message: `unknown method ${message.method}` } };
      if (answer === 'silent') return;
      if (answer === 'close') {
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify({ id: message.id, ...answer }));
    });
  });
  if (options.listening !== false) await new Promise<void>((done) => { server.listen(socket, done); });
  const runtime = createCodexDaemonRuntime({ command: [execPath, fakeCli], socketPath: socket,
    env: { PATH: process.env['PATH'], FAKE_DAEMON_STATE: state, FAKE_DAEMON_LOG: log, GH_TOKEN: 'dropped' },
    timeouts: { callMs: 1_000, turnStartMs: 1_000 },
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }) });
  const plan: LaunchPlan = { name: RUN, role: 'review', agentType: undefined, model: undefined, cwd: base,
    instructionPath: brief, instructionDirectory: base, outputSchema: verdict };
  onTestFinished(async () => {
    sockets.close();
    await new Promise((done) => { server.close(done); });
    rmSync(base, { recursive: true, force: true });
  });
  const cliCalls = () => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
    } catch {
      return [];
    }
  };
  return { runtime, plan, socket, sent, cliCalls, setDaemon };
}

const methods = (h: Harness) => h.sent.map((frame) => frame.message.method ?? `reply:${String(frame.message.id)}`)
  .filter((method) => method.includes('/'));
const params = (h: Harness, method: string) => h.sent.filter((frame) => frame.message.method === method)
  .map((frame) => frame.message.params);

async function session(h: Harness, ref: NativeRunRef = { name: RUN }): Promise<SessionState | undefined> {
  const reading = await h.runtime.observe([ref]);
  if (reading.kind !== 'read') throw new Error(reading.cause);
  return reading.sessions.get(ref.name);
}

const bound = { name: RUN, handle: HANDLE, sessionId: THREAD };
const LAST_TURN = { threadId: THREAD, limit: 1, sortDirection: 'desc', itemsView: 'full' };

describe.skipIf(process.platform === 'win32')('a run as a thread of the Codex daemon', () => {
  describe('before a launch', () => {
    it('admits a running daemon at the version of the CLI, starting nothing', async () => {
      const h = await harness();
      expect(await h.runtime.preflight(h.plan.cwd)).toEqual({ ok: true });
      expect(h.cliCalls()).toEqual([['app-server', 'daemon', 'version']]);
    });

    it('starts a daemon that is not running, then admits it', async () => {
      const h = await harness();
      h.setDaemon({ status: 'stopped' });
      expect(await h.runtime.preflight(h.plan.cwd)).toEqual({ ok: true });
      expect(h.cliCalls()).toEqual([['app-server', 'daemon', 'version'], ['app-server', 'daemon', 'start'],
        ['app-server', 'daemon', 'version']]);
    });

    it('refuses a daemon that will not start, with the error it gave', async () => {
      const h = await harness();
      h.setDaemon({ status: 'stopped', startFails: true });
      expect(await h.runtime.preflight(h.plan.cwd)).toEqual({ ok: false,
        cause: 'the Codex daemon is not running and codex app-server daemon start did not bring it up: '
          + 'failed to start the app server daemon',
        action: 'run codex app-server daemon start and read its error' });
    });

    it('refuses a daemon of another version than the CLI, and a CLI that predates the contract', async () => {
      const h = await harness();
      h.setDaemon({ server: '0.157.0' });
      expect(await h.runtime.preflight(h.plan.cwd)).toEqual({ ok: false,
        cause: 'the Codex daemon runs 0.157.0 while the codex CLI on PATH is 0.158.0',
        action: 'align them: codex app-server daemon update, or update the codex on PATH' });
      h.setDaemon({ server: '0.158.0', cli: '0.155.1' });
      expect(await h.runtime.preflight(h.plan.cwd)).toMatchObject({ ok: false,
        action: 'update Codex CLI to 0.158.0 or later' });
    });

    it('refuses when codex cannot be run, or runs but knows no daemon', async () => {
      const missing = createCodexDaemonRuntime({ command: ['/nonexistent/codex'], socketPath: '/tmp/none.sock',
        env: {} });
      const refusal = { ok: false, cause: 'codex is not installed, not on PATH, or has no app-server daemon',
        action: 'install Codex CLI 0.158.0 or later' };
      expect(await missing.preflight('/tmp')).toEqual(refusal);
      const older = await harness();
      older.setDaemon({ noDaemon: true });
      expect(await older.runtime.preflight(older.plan.cwd)).toEqual(refusal);
    });
  });

  describe('a launch', () => {
    it('starts, names and runs the thread as the captured session did, and names the whole thread', async () => {
      const h = await harness();
      expect(await h.runtime.dispatch(h.plan)).toEqual({ kind: 'acknowledged', handle: HANDLE, sessionId: THREAD });
      expect(methods(h)).toEqual(['thread/start', 'thread/name/set', 'turn/start']);
      const request = (method: string) => dispatchFrames.requests.find((frame) => frame.method === method)?.params;
      expect(params(h, 'initialize')).toEqual([request('initialize')]);
      expect(params(h, 'initialized')).toEqual([{}]);
      expect(params(h, 'thread/start')).toEqual([{ ...(request('thread/start') as object), cwd: h.plan.cwd }]);
      expect(params(h, 'thread/name/set')).toEqual([request('thread/name/set')]);
      expect(params(h, 'turn/start')).toEqual([{ threadId: THREAD, input: [{ type: 'text',
        text: readFileSync(h.plan.instructionPath, 'utf8') }], outputSchema: verdict }]);
    });

    it('never answers a request the daemon asks of it, such as an approval', async () => {
      // Synthetic: a server-initiated approval request, as item/commandExecution/requestApproval shapes it.
      const h = await harness({}, { onConnection: (send) => send({ id: 900,
        method: 'item/commandExecution/requestApproval', params: { threadId: THREAD, command: 'rm -rf build' } }) });
      expect(await h.runtime.dispatch(h.plan)).toMatchObject({ kind: 'acknowledged' });
      expect(h.sent.filter((frame) => frame.message.id === 900)).toEqual([]);
    });

    it('refuses the launch when the daemon does not answer, naming the command that starts it', async () => {
      const h = await harness({}, { listening: false });
      expect(await h.runtime.dispatch(h.plan)).toMatchObject({ kind: 'refused',
        cause: expect.stringContaining(`the Codex daemon does not answer on ${h.socket}`),
        action: 'codex app-server daemon start' });
    });

    it('never sends a brief to a socket that is not one of this user', async () => {
      const h = await harness({}, { listening: false });
      writeFileSync(h.socket, 'not a socket');
      expect(await h.runtime.dispatch(h.plan)).toMatchObject({ kind: 'refused',
        cause: `${h.socket} is not a socket of this user` });
      expect(h.sent).toEqual([]);
    });

    it('refuses a thread Codex will not start, and archives one it refused to name', async () => {
      const refused = await harness({ 'thread/start': () => failure('model not available') });
      expect(await refused.runtime.dispatch(refused.plan)).toEqual({ kind: 'refused',
        cause: 'codex refused the thread: model not available', action: 'check the model and the Codex login' });
      const unnamed = await harness({ 'thread/name/set': () => failure('invalid name') });
      expect(await unnamed.runtime.dispatch(unnamed.plan)).toEqual({ kind: 'refused',
        cause: 'codex did not name the thread: invalid name', action: 'dispatch again' });
      expect(params(unnamed, 'thread/archive')).toEqual([{ threadId: THREAD }]);
      expect(params(unnamed, 'turn/start')).toEqual([]);
    });

    it('calls a launch lost, never refused, when a write may have landed unanswered', async () => {
      const unnamed = await harness({ 'thread/name/set': () => 'silent' });
      expect(await unnamed.runtime.dispatch(unnamed.plan)).toEqual({ kind: 'lost',
        cause: 'codex did not confirm the name of the thread in time; the thread is looked up by its name' });
      const hung = await harness({ 'turn/start': () => 'silent' });
      expect(await hung.runtime.dispatch(hung.plan)).toEqual({ kind: 'lost',
        cause: 'codex did not confirm the turn in time; the thread is looked up by its name' });
    });

    it('archives the thread of a turn Codex refuses, and says so when the archive fails too', async () => {
      const refused = await harness({ 'turn/start': () => failure('invalid output schema') });
      expect(await refused.runtime.dispatch(refused.plan)).toEqual({ kind: 'refused',
        cause: 'codex refused the turn: invalid output schema', action: 'correct the brief or the output schema' });
      expect(params(refused, 'thread/archive')).toEqual([{ threadId: THREAD }]);
      const stuck = await harness({ 'turn/start': () => failure('invalid output schema'),
        'thread/archive': () => failure('busy') });
      expect(await stuck.runtime.dispatch(stuck.plan)).toEqual({ kind: 'refused',
        cause: `codex refused the turn: invalid output schema; the thread ${THREAD} could not be archived: busy`,
        action: 'correct the brief or the output schema' });
    });
  });

  describe('observing', () => {
    it('finds an unbound run by its name, then reads its status and its last turn only', async () => {
      const h = await harness();
      expect(await session(h)).toEqual({ observation: { kind: 'present', state: 'working', status: 'busy' },
        binding: { handle: HANDLE, sessionId: THREAD } });
      expect(params(h, 'thread/list')).toEqual([{ searchTerm: RUN, limit: 10 }]);
      expect(params(h, 'thread/read')).toEqual([{ threadId: THREAD, includeTurns: false }]);
      expect(params(h, 'thread/turns/list')).toEqual([LAST_TURN]);
      await session(h, bound);
      expect(params(h, 'thread/list')).toHaveLength(1);
    });

    it('reports the final answer of the last turn once it completes', async () => {
      const h = await harness(snapshot('completed'));
      expect(await session(h, bound)).toEqual({ observation: { kind: 'present', state: 'done', status: 'idle' },
        binding: { handle: HANDLE, sessionId: THREAD },
        result: { turnId: FIRST_TURN, text: '{"verdict":"pass","summary":"Hello, the command completed successfully."}',
          truncated: false } });
    });

    it('lists no run whose name no thread carries, so the kernel reconciles it', async () => {
      const h = await harness({ 'thread/list': () => ({ result: { data: [], nextCursor: null,
        backwardsCursor: null } }) });
      expect(await session(h)).toBeUndefined();
    });

    it('never guesses a run among threads of the same name, and never follows a thread renamed', async () => {
      const list = captured('list-by-name.json').result as { data: Array<Record<string, unknown>> };
      const several = await harness({ 'thread/list': () => ({ result: { ...list,
        data: [...list.data, { ...list.data[0], id: '01a0ea61-1fc9-7fd3-aeeb-fb6a514c7a0e' }] } }) });
      expect((await session(several))?.observation).toEqual({ kind: 'unreadable',
        cause: `2 Codex threads carry the name ${RUN}` });
      const other = await harness();
      expect((await session(other, { name: 'vm-run_other', sessionId: THREAD }))?.observation).toEqual({
        kind: 'unreadable', cause: `the thread ${THREAD} no longer carries the name vm-run_other` });
    });

    it('reads a daemon that does not answer as unreadable, never as runs gone', async () => {
      const h = await harness({}, { listening: false });
      expect(await h.runtime.observe([{ name: RUN }])).toEqual({ kind: 'unreadable',
        cause: expect.stringContaining('start it with codex app-server daemon start') });
    });

    it('reads a thread the daemon cannot read as unreadable, not absent', async () => {
      const h = await harness({ 'thread/read': () => ({ error: captured('read-unknown.json').error }) as Answer });
      expect((await session(h, bound))?.observation).toEqual({ kind: 'unreadable',
        cause: 'thread not loaded: 01a0ea56-0000-7000-8000-000000000000' });
    });

    it('stops asking a daemon that dropped the connection: every run left reads unreadable at once', async () => {
      const h = await harness({ 'thread/read': () => 'close' });
      const started = Date.now();
      const reading = await h.runtime.observe([bound, { ...bound, name: 'vm-run_second' }]);
      expect(Date.now() - started).toBeLessThan(900);
      expect(reading).toEqual({ kind: 'read', sessions: new Map([
        [RUN, { observation: { kind: 'unreadable', cause: 'the connection closed' } }],
        ['vm-run_second', { observation: { kind: 'unreadable', cause: 'the connection closed' } }]]) });
      expect(params(h, 'thread/read')).toHaveLength(1);
    });

    it('names the frame bound when a reply outgrows it', async () => {
      // The captured thread status fits in 1.4 kB, its last turn does not.
      const h = await harness(snapshot('completed'), { maxFrameBytes: 1_400 });
      expect((await session(h, bound))?.observation).toEqual({ kind: 'unreadable',
        cause: 'a reply of the Codex daemon exceeded the 1400-byte frame bound' });
    });
  });

  describe('sending and stopping', () => {
    it('starts the next turn on an idle thread with the run schema', async () => {
      const h = await harness({ ...snapshot('completed'), 'turn/start': () => result('turn-start-second.json') });
      const next = join(h.plan.instructionDirectory, 'message-001.md');
      writeFileSync(next, 'Say why.');
      expect(await h.runtime.send(bound, { ...h.plan, instructionPath: next }))
        .toEqual({ kind: 'acknowledged', handle: HANDLE });
      expect(params(h, 'turn/start')).toEqual([{ threadId: THREAD, input: [{ type: 'text', text: 'Say why.' }],
        outputSchema: verdict }]);
    });

    it('steers a turn still running instead of starting another, and calls an unanswered steer lost', async () => {
      const h = await harness();
      expect(await h.runtime.send(bound, h.plan)).toEqual({ kind: 'acknowledged', handle: HANDLE });
      expect(params(h, 'turn/steer')).toEqual([{ threadId: THREAD, expectedTurnId: FIRST_TURN,
        input: [{ type: 'text', text: readFileSync(h.plan.instructionPath, 'utf8') }] }]);
      expect(params(h, 'turn/start')).toEqual([]);
      const hung = await harness({ 'turn/steer': () => 'silent' });
      expect(await hung.runtime.send(bound, hung.plan)).toEqual({ kind: 'lost',
        cause: 'codex did not confirm the message in time' });
    });

    it('resumes an unloaded thread with the permissions of its role before its next turn', async () => {
      const h = await harness({ 'thread/read': () => withStatus('completed', { type: 'notLoaded' }),
        'thread/turns/list': () => result('completed.turns.json'),
        'turn/start': () => result('turn-start-second.json') });
      expect(await h.runtime.send(bound, h.plan)).toMatchObject({ kind: 'acknowledged' });
      expect(methods(h)).toEqual(['thread/read', 'thread/turns/list', 'thread/resume', 'turn/start']);
      expect(params(h, 'thread/resume')).toEqual([{ threadId: THREAD, excludeTurns: true, cwd: h.plan.cwd,
        approvalPolicy: 'never', sandbox: 'read-only' }]);
    });

    it('refuses to send to a run no thread carries', async () => {
      const h = await harness({ 'thread/list': () => ({ result: { data: [] } }) });
      expect(await h.runtime.send({ name: RUN }, h.plan)).toEqual({ kind: 'refused',
        cause: 'no Codex thread carries this run', action: 'dispatch a new run' });
    });

    it('interrupts the turn a stopped run is running, then ends the commands it left in the background', async () => {
      const running = await harness();
      expect(await running.runtime.stop(bound)).toEqual({ ok: true });
      expect(methods(running)).toEqual(['thread/read', 'thread/turns/list', 'turn/interrupt',
        'thread/backgroundTerminals/clean']);
      expect(params(running, 'turn/interrupt')).toEqual([{ threadId: THREAD, turnId: FIRST_TURN }]);
      expect(params(running, 'thread/backgroundTerminals/clean')).toEqual([{ threadId: THREAD }]);
      // The cleaning is experimental: only the connection that stops asks for that API.
      expect(params(running, 'initialize')).toEqual([{ clientInfo: { name: 'void_machine', title: 'Void Machine',
        version: '1' }, capabilities: { experimentalApi: true } }]);
    });

    it('ends the background commands of a turn already ended, without interrupting it', async () => {
      const ended = await harness(snapshot('completed'));
      expect(await ended.runtime.stop(bound)).toEqual({ ok: true });
      expect(params(ended, 'turn/interrupt')).toEqual([]);
      expect(params(ended, 'thread/backgroundTerminals/clean')).toEqual([{ threadId: THREAD }]);
    });

    it('leaves an unloaded thread as it is: nothing runs it', async () => {
      const h = await harness({ 'thread/read': () => withStatus('completed', { type: 'notLoaded' }),
        'thread/turns/list': () => result('completed.turns.json') });
      expect(await h.runtime.stop(bound)).toEqual({ ok: true });
      expect(methods(h)).toEqual(['thread/read', 'thread/turns/list']);
    });

    it('never calls a run stopped while its background commands may still run', async () => {
      const h = await harness({ 'thread/backgroundTerminals/clean': () => failure('unknown method') });
      expect(await h.runtime.stop(bound)).toEqual({ ok: false,
        cause: 'codex did not end the background commands of the thread: unknown method',
        action: `stop again; if it persists, end them from codex resume ${THREAD}` });
    });

    it('stops a lost launch through the thread its name designates, and a run with no thread at once', async () => {
      const lost = await harness();
      expect(await lost.runtime.stop({ name: RUN })).toEqual({ ok: true });
      expect(params(lost, 'turn/interrupt')).toHaveLength(1);
      const none = await harness({ 'thread/list': () => ({ result: { data: [] } }) });
      expect(await none.runtime.stop({ name: RUN })).toEqual({ ok: true });
    });

    it('refuses to call a run stopped while the daemon does not answer', async () => {
      const h = await harness({}, { listening: false });
      expect(await h.runtime.stop(bound)).toMatchObject({ ok: false, action: 'codex app-server daemon start' });
    });
  });

  describe('showing a run', () => {
    it('shows a bound thread live through the daemon, and nothing before it is bound', async () => {
      const h = await harness();
      expect(h.runtime.attachCommand(bound))
        .toEqual([execPath, fakeCli, 'resume', THREAD, '--remote', `unix://${h.socket}`]);
      expect(h.runtime.attachCommand({ name: RUN, handle: HANDLE })).toBeUndefined();
    });

    it('declares what it can do and how that is known', async () => {
      const { capabilities } = (await harness()).runtime;
      expect(capabilities).toEqual({
        view: { available: true, provenance: 'verified', note: 'codex resume <thread> --remote unix://<daemon '
          + 'socket>, shown live in a herdr pane (DEV-926, 2026-09-29)' },
        capture: { available: false, provenance: 'observed', note: expect.stringContaining('encrypted') },
        structuredOutput: { available: true, provenance: 'verified', note: expect.stringContaining('outputSchema') },
      });
    });
  });
});
