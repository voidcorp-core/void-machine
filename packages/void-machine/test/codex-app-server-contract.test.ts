import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createCodexAppServerRuntime } from '../src/adapters/runtime/codex-app-server.js';
import { socketPathFor } from '../src/adapters/runtime/codex-thread.js';
import type { AgentRuntimePort, LaunchPlan, SessionState } from '../src/runtime/delegation.js';

const fake = fileURLToPath(new URL('./fixtures/codex-app-server-process.mjs', import.meta.url));
const THREAD = '01a0e9f7-5d5e-7c92-b856-0c2782407fda';
const TURN = '01a0e9f7-5e20-7812-b9d7-920fabee855c';
const SECOND_TURN = '01a0ea07-9537-71e3-b352-fb4a81be9c1b';
const verdict = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] },
  summary: { type: 'string' } }, required: ['verdict', 'summary'], additionalProperties: false };

interface Harness {
  readonly runtime: AgentRuntimePort;
  readonly plan: LaunchPlan;
  readonly state: string;
  readonly sockets: string;
  readonly frames: () => Array<{ connection: number; message: { id?: number; method?: string;
    params?: Record<string, unknown>; result?: unknown; error?: unknown } }>;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** A run's adapter against the fake codex; every app-server it starts is ended with the test. */
function harness(mode = 'complete', version?: string): Harness {
  // Under /tmp: the socket address must fit in 104 bytes, which a nested temporary directory may not.
  const base = mkdtempSync('/tmp/vmcx-');
  const sockets = join(base, 's');
  const state = join(base, 'state');
  const log = join(base, 'frames.jsonl');
  const brief = join(base, 'brief.md');
  writeFileSync(brief, 'Reply with verdict pass and a one-sentence summary saying hello. Do not run any command.');
  const runtime = createCodexAppServerRuntime({ command: [execPath, fake], stateDirectory: state,
    socketDirectory: sockets, env: { PATH: process.env['PATH'], FAKE_CODEX_MODE: mode, FAKE_CODEX_LOG: log,
      ...(version === undefined ? {} : { FAKE_CODEX_VERSION: version }) },
    timeouts: { turnStartMs: 1_000 } });
  const plan: LaunchPlan = { name: 'vm-run_0f0e0d0c-0b0a-4908-8706-050403020100', role: 'review',
    agentType: undefined, model: undefined, cwd: base, instructionPath: brief, instructionDirectory: base,
    outputSchema: verdict };
  onTestFinished(async () => {
    await runtime.release({ name: plan.name });
    rmSync(base, { recursive: true, force: true });
  });
  const frames = () => existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { runtime, plan, state, sockets, frames };
}

function stateOf(h: Harness): { pid: number; phase: string; threadId?: string; turnId?: string } {
  return JSON.parse(readFileSync(join(h.state, `${h.plan.name}.json`), 'utf8'));
}

async function session(h: Harness): Promise<SessionState | undefined> {
  const reading = await h.runtime.observe([{ name: h.plan.name }]);
  if (reading.kind !== 'read') throw new Error(reading.cause);
  return reading.sessions.get(h.plan.name);
}

const methods = (h: Harness) => h.frames().map((frame) => frame.message.method ?? `reply:${String(frame.message.id)}`);

describe.skipIf(process.platform === 'win32')('a run as a Codex app-server thread', () => {
  it('checks the installed Codex before anything starts', async () => {
    expect(await harness().runtime.preflight('/tmp')).toEqual({ ok: true });
    expect(await harness('complete', '0.154.9').runtime.preflight('/tmp')).toEqual({ ok: false,
      cause: 'Codex CLI 0.154.9 predates the app-server contract this adapter was proven against (0.155.1)',
      action: 'update Codex CLI to 0.155.1 or later' });
    const missing = createCodexAppServerRuntime({ command: ['/nonexistent/codex'], stateDirectory: '/tmp/none',
      socketDirectory: '/tmp/none', env: {} });
    expect(await missing.preflight('/tmp')).toMatchObject({ ok: false,
      cause: 'codex is not installed, not on PATH, or did not report its version' });
  });

  it('launches the thread and its first turn as the captured session did, then lets go of the socket', async () => {
    const h = harness();
    expect(await h.runtime.dispatch(h.plan)).toEqual({ kind: 'acknowledged', handle: '82407fda' });
    const sent = h.frames().map((frame) => frame.message);
    expect(sent.map((message) => message.method)).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start']);
    expect(sent[2]?.params).toEqual({ cwd: h.plan.cwd, approvalPolicy: 'never', sandbox: 'read-only',
      serviceName: 'void_machine' });
    expect(sent[3]?.params).toEqual({ threadId: THREAD, input: [{ type: 'text',
      text: readFileSync(h.plan.instructionPath, 'utf8') }], outputSchema: verdict });
    const state = stateOf(h);
    expect(state).toMatchObject({ phase: 'turn-started', threadId: THREAD, turnId: TURN });
    expect(alive(state.pid)).toBe(true);
    expect(readdirSync(h.sockets)).toEqual([`${socketPathFor(h.sockets, h.plan.name)?.split('/').at(-1)}`]);
  });

  it('follows the turn to its final answer, one short connection per reading', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    expect(await session(h)).toEqual({ observation: { kind: 'present', state: 'working', status: 'busy' },
      binding: { handle: '82407fda', sessionId: THREAD } });
    expect(await session(h)).toEqual({ observation: { kind: 'present', state: 'done', status: 'idle' },
      binding: { handle: '82407fda', sessionId: THREAD },
      result: { turnId: TURN, text: '{"verdict":"pass","summary":"Hello."}', truncated: false } });
    const connections = new Set(h.frames().map((frame) => frame.connection));
    expect(connections.size).toBe(3);
    expect(h.frames().filter((frame) => frame.message.method === 'initialize')).toHaveLength(3);
  });

  it('starts the next turn with the same schema, and follows that turn only', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    await session(h);
    expect((await session(h))?.observation).toMatchObject({ state: 'done' });
    const next = join(h.plan.instructionDirectory, 'message-001.md');
    writeFileSync(next, 'Reply with the single word ok.');
    expect(await h.runtime.send({ name: h.plan.name }, { ...h.plan, instructionPath: next }))
      .toEqual({ kind: 'acknowledged', handle: '82407fda' });
    expect(h.frames().filter((frame) => frame.message.method === 'turn/start').at(-1)?.message.params)
      .toEqual({ threadId: THREAD, input: [{ type: 'text', text: 'Reply with the single word ok.' }],
        outputSchema: verdict });
    expect(stateOf(h)).toMatchObject({ phase: 'turn-started', turnId: SECOND_TURN });
    expect((await session(h))?.result?.turnId).toBe(SECOND_TURN);
  });

  it('adds a message to a turn still running instead of starting another', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    const next = join(h.plan.instructionDirectory, 'message-001.md');
    writeFileSync(next, 'Also mention the word banana at the end.');
    expect(await h.runtime.send({ name: h.plan.name }, { ...h.plan, instructionPath: next }))
      .toEqual({ kind: 'acknowledged', handle: '82407fda' });
    expect(h.frames().find((frame) => frame.message.method === 'turn/steer')?.message.params).toEqual({
      threadId: THREAD, expectedTurnId: TURN, input: [{ type: 'text', text: 'Also mention the word banana at the end.' }] });
    expect(stateOf(h)).toMatchObject({ phase: 'turn-started', turnId: TURN });
  });

  it('surfaces an approval request to a person and leaves it unanswered', async () => {
    const h = harness('approval');
    await h.runtime.dispatch(h.plan);
    const blocked = { kind: 'present', state: 'blocked', status: 'waiting',
      waitingFor: 'an approval, although the run was started with approvalPolicy never' };
    expect((await session(h))?.observation).toEqual(blocked);
    expect((await session(h))?.observation).toEqual(blocked);
    expect(h.frames().filter((frame) => frame.message.id === 900 && frame.message.method === undefined)).toEqual([]);
  });

  it('keeps following the last turn when Codex refuses the next one', async () => {
    const h = harness('refuse-second-turn');
    await h.runtime.dispatch(h.plan);
    await session(h);
    await session(h);
    const next = join(h.plan.instructionDirectory, 'message-001.md');
    writeFileSync(next, 'Reply with the single word ok.');
    expect(await h.runtime.send({ name: h.plan.name }, { ...h.plan, instructionPath: next }))
      .toEqual({ kind: 'refused', cause: 'codex refused the turn: turn already starting', action: 'send again' });
    expect(stateOf(h)).toMatchObject({ phase: 'turn-started', turnId: TURN });
    expect(await session(h)).toMatchObject({ observation: { state: 'done' }, result: { turnId: TURN } });
  });

  it('recognises its own app-server whatever the locale of the caller', async () => {
    const previous = process.env['LC_ALL'];
    process.env['LC_ALL'] = 'fr_FR.UTF-8';
    onTestFinished(() => {
      if (previous === undefined) delete process.env['LC_ALL'];
      else process.env['LC_ALL'] = previous;
    });
    const h = harness();
    expect(await h.runtime.dispatch(h.plan)).toEqual({ kind: 'acknowledged', handle: '82407fda' });
    expect((await session(h))?.observation).toMatchObject({ state: 'working' });
  });

  it('stops a run: interrupts its turn, ends its app-server and forgets it', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    const { pid } = stateOf(h);
    expect(await h.runtime.stop({ name: h.plan.name })).toEqual({ ok: true });
    expect(methods(h)).toContain('turn/interrupt');
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(h.state, `${h.plan.name}.json`))).toBe(false);
    expect(await session(h)).toBeUndefined();
  });

  it('never claims to supervise a run whose app-server is gone', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    process.kill(stateOf(h).pid, 'SIGKILL');
    for (let attempt = 0; attempt < 100 && alive(stateOf(h).pid); attempt += 1) {
      execFileSync('sleep', ['0.02']);
    }
    expect(await session(h)).toBeUndefined();
    expect(h.runtime.attachCommand({ name: h.plan.name })).toBeUndefined();
  });

  it('never signals a process the state file names but this run did not start', async () => {
    const h = harness();
    await h.runtime.dispatch(h.plan);
    const owned = stateOf(h).pid;
    // A forged record naming this test's own process, as an agent able to edit the file could write.
    writeFileSync(join(h.state, `${h.plan.name}.json`), JSON.stringify({ ...stateOf(h), pid: process.pid }));
    expect(await session(h)).toBeUndefined();
    await h.runtime.release({ name: h.plan.name });
    expect(alive(process.pid)).toBe(true);
    process.kill(owned, 'SIGKILL');
  });

  it('keeps the thread it cannot confirm a turn for, so the kernel reconciles it by reference', async () => {
    const h = harness('hang-turn-start');
    expect(await h.runtime.dispatch(h.plan)).toEqual({ kind: 'lost',
      cause: 'codex did not confirm the turn in time; the thread is kept and looked up again' });
    expect(stateOf(h)).toMatchObject({ phase: 'turn-starting', threadId: THREAD });
    expect((await session(h))?.binding).toEqual({ handle: '82407fda', sessionId: THREAD });
  });

  it('refuses a thread Codex would not start, and leaves no process behind', async () => {
    const h = harness('fail-thread-start');
    const outcome = await h.runtime.dispatch(h.plan);
    expect(outcome).toEqual({ kind: 'refused', cause: 'codex refused the thread: model not available',
      action: 'check the model and the Codex login, then dispatch again' });
    expect(existsSync(join(h.state, `${h.plan.name}.json`))).toBe(false);
    expect(readdirSync(h.sockets)).toEqual([]);
  });

  it('refuses an app-server that exits at start', async () => {
    const h = harness('exit-at-start');
    expect(await h.runtime.dispatch(h.plan)).toMatchObject({ kind: 'refused' });
    expect(existsSync(join(h.state, `${h.plan.name}.json`))).toBe(false);
  });

  it('declares a view it has not proven as unknown, and a capture it cannot perform as unavailable', () => {
    const { capabilities } = harness().runtime;
    expect(capabilities.view).toMatchObject({ available: false, provenance: 'unknown' });
    expect(capabilities.capture).toMatchObject({ available: false, provenance: 'observed' });
    expect(capabilities.capture.note).toMatch(/collaborationspawn_agent/);
    expect(capabilities.structuredOutput).toMatchObject({ available: true, provenance: 'verified' });
  });
});
