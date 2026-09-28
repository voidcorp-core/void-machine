import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createNoSurface } from '../src/adapters/presentation/none.js';
import { createRunRegistry, resolveMachineRoot } from '../src/adapters/store/run-registry.js';
import {
  type AgentsContext, acceptAgent, acceptReview, agentStatus, attachAgent, dispatchAgent, sendAgent, stopAgent,
  waitAgents,
} from '../src/application/agents.js';
import type {
  AgentRuntimePort, LaunchOutcome, LaunchPlan, NativeRunRef, Preflight, SessionState,
} from '../src/runtime/delegation.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const MISSION = 'mis_application-test';

function repository(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vm-agents-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: base, stdio: 'ignore' });
  return base;
}

/** A runtime whose every answer the test chooses, and which records what it was asked. */
function scriptedRuntime(script: {
  preflight?: Preflight; launch?: LaunchOutcome; resume?: LaunchOutcome;
  sessions?: () => ReadonlyMap<string, SessionState>;
} = {}) {
  const launches: LaunchPlan[] = [];
  const stops: NativeRunRef[] = [];
  const resumes: Array<{ ref: NativeRunRef; plan: LaunchPlan }> = [];
  const runtime: AgentRuntimePort = {
    preflight: async () => script.preflight ?? { ok: true },
    dispatch: async (plan) => { launches.push(plan); return script.launch ?? { kind: 'acknowledged', handle: '6d5ea8bb' }; },
    observe: async () => ({ kind: 'read', sessions: script.sessions?.() ?? new Map() }),
    send: async (ref, plan) => {
      resumes.push({ ref, plan });
      return script.resume ?? { kind: 'acknowledged', handle: '6d5ea8bb' };
    },
    stop: async (ref) => { stops.push(ref); return { ok: true }; },
    attachCommand: (ref) => ref.handle === undefined ? undefined : ['claude', 'attach', ref.handle],
  };
  return { runtime, launches, stops, resumes };
}

function context(cwd: string, runtime: AgentRuntimePort, now = { value: 10_000 }): AgentsContext {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  let runs = 0;
  return {
    store: createRunRegistry({ machineRoot: root.root, now: () => now.value }),
    runtime,
    surfaces: { detected: createNoSurface(), reach: () => createNoSurface() },
    clock: { now: () => now.value, sleep: async (ms) => { now.value += ms; } },
    owner: 'test',
    newRunId: () => `run_00000000-0000-4000-8000-${String(++runs).padStart(12, '0')}`,
    newMissionId: () => MISSION,
  };
}

const reviewInput = (cwd: string) => ({ role: 'review' as const, agentType: 'independent-code-reviewer',
  cwd, brief: 'Review the diff against main.', missionId: MISSION });

function recordResult(cwd: string, recordedAt: number, text: string): void {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  const claim = JSON.parse(readFileSync(join(root.root, 'agents', 'sessions', `${SESSION}.json`), 'utf8'));
  writeFileSync(claim.resultPath, JSON.stringify({ schemaVersion: 1, sessionId: SESSION, recordedAt,
    lastAssistantMessage: text, truncated: false }));
}

const listed = (state: 'working' | 'done') => () =>
  new Map([['vm-run_00000000-0000-4000-8000-000000000001', { observation: { kind: 'present' as const, state },
    binding: { handle: '6d5ea8bb', sessionId: SESSION } }]]);

describe('dispatch', () => {
  it('returns a run identifier at once, with the launch acknowledged', async () => {
    const cwd = repository();
    const { runtime, launches } = scriptedRuntime();
    const receipt = await dispatchAgent(context(cwd, runtime), reviewInput(cwd));
    expect(receipt).toMatchObject({ ok: true, missionId: MISSION, status: { state: 'dispatched' } });
    expect(launches[0]).toMatchObject({ role: 'review', agentType: 'independent-code-reviewer', cwd });
    expect(readFileSync(launches[0]?.instructionPath ?? '', 'utf8')).toBe('Review the diff against main.');
  });

  it('refuses with the repair when the result hook is not installed, and records nothing', async () => {
    const cwd = repository();
    const { runtime, launches } = scriptedRuntime({ preflight: { ok: false,
      cause: 'the delegation-result Stop hook is not installed', action: 'run npx product update' } });
    const ctx = context(cwd, runtime);
    expect(await dispatchAgent(ctx, reviewInput(cwd))).toEqual({ ok: false,
      cause: 'the delegation-result Stop hook is not installed', action: 'run npx product update' });
    expect(launches).toHaveLength(0);
    expect(await ctx.store.runIds()).toEqual([]);
  });

  it.each([
    ['a review without an agent type', { agentType: undefined }],
    ['an agent type that is not a name', { agentType: '--dangerously-skip-permissions' }],
    ['a model that is not a name', { model: 'opus --settings x' }],
    ['an empty brief', { brief: '' }],
  ])('refuses %s before anything runs', async (_case, change) => {
    const cwd = repository();
    const { runtime, launches } = scriptedRuntime();
    expect(await dispatchAgent(context(cwd, runtime), { ...reviewInput(cwd), ...change }))
      .toMatchObject({ ok: false });
    expect(launches).toHaveLength(0);
  });

  it('stops the session of an unknown agent type and fails the run', async () => {
    const cwd = repository();
    const { runtime, stops } = scriptedRuntime({ launch: { kind: 'refused', handle: 'e4c0c72c',
      cause: 'no agent named x', action: 'use a defined agent type' } });
    expect(await dispatchAgent(context(cwd, runtime), reviewInput(cwd)))
      .toMatchObject({ ok: false, cause: 'no agent named x' });
    expect(stops).toEqual([{ name: 'vm-run_00000000-0000-4000-8000-000000000001', handle: 'e4c0c72c' }]);
  });
});

describe('a delegated run end to end', () => {
  it('waits, collects the result, accepts it and stops the reviewer', async () => {
    const cwd = repository();
    let state: 'working' | 'done' = 'working';
    const scripted = scriptedRuntime({ sessions: () => listed(state)() });
    const ctx = context(cwd, scripted.runtime);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 60_000 }))
      .toMatchObject({ kind: 'transitioned', runs: [{ transitions: [{ to: 'working' }] }] });
    expect(await acceptAgent(ctx, receipt.runId)).toMatchObject({ ok: false });
    state = 'done';
    recordResult(cwd, 20_000, 'No blocking finding.');
    expect(await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 60_000 }))
      .toMatchObject({ runs: [{ transitions: [{ to: 'turn-ended' }], status: { action: expect.stringContaining('accept') } }] });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ ok: true, runs: [{
      status: { state: 'turn-ended' }, result: { text: 'No blocking finding.' } }] });
    expect(await acceptAgent(ctx, receipt.runId)).toMatchObject({ ok: true, state: 'retired',
      result: { text: 'No blocking finding.' } });
    expect(scripted.stops.map((ref) => ref.handle)).toEqual(['6d5ea8bb']);
  });

  it('sends a message to a run whose turn ended and follows a session continued as a copy', async () => {
    const cwd = repository();
    const scripted = scriptedRuntime({ sessions: listed('done'),
      resume: { kind: 'acknowledged', handle: 'aaaabbbb' } });
    const now = { value: 10_000 };
    const ctx = context(cwd, scripted.runtime, now);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    // One tick binds the listed session, which writes the claim the Stop hook follows.
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 1 });
    recordResult(cwd, 20_000, 'First answer.');
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 60_000 });
    expect(await sendAgent(ctx, receipt.runId, 'Give the final verdict.')).toMatchObject({ ok: true,
      status: { state: 'working' } });
    expect(readFileSync(scripted.resumes[0]?.plan.instructionPath ?? '', 'utf8')).toBe('Give the final verdict.');
    expect(scripted.resumes[0]?.ref.sessionId).toBe(SESSION);
    expect((await ctx.store.read(receipt.runId))?.binding).toEqual({ handle: 'aaaabbbb' });
    // The original keeps running idle once a copy answers: it is stopped.
    expect(scripted.stops.map((ref) => ref.handle)).toEqual(['6d5ea8bb']);
    expect(await acceptAgent(ctx, receipt.runId)).toMatchObject({ ok: false });
  });

  it('stops a run, and refuses a second stop', async () => {
    const cwd = repository();
    const scripted = scriptedRuntime();
    const ctx = context(cwd, scripted.runtime);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await stopAgent(ctx, receipt.runId)).toMatchObject({ ok: true, status: { state: 'stopped' } });
    expect(scripted.stops.map((ref) => ref.handle)).toEqual(['6d5ea8bb']);
    expect(await stopAgent(ctx, receipt.runId)).toMatchObject({ ok: false });
  });

  it('gives the command that attaches the session', async () => {
    const cwd = repository();
    const ctx = context(cwd, scriptedRuntime().runtime);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await attachAgent(ctx, receipt.runId)).toEqual({ ok: true, command: ['claude', 'attach', '6d5ea8bb'] });
    expect(await attachAgent(ctx, 'run_00000000-0000-4000-8000-00000000ffff')).toMatchObject({ ok: false });
  });

  it('refuses a fifth open run in one mission', async () => {
    const cwd = repository();
    const ctx = context(cwd, scriptedRuntime().runtime);
    for (let index = 0; index < 4; index += 1) {
      expect(await dispatchAgent(ctx, reviewInput(cwd))).toMatchObject({ ok: true });
    }
    expect(await dispatchAgent(ctx, reviewInput(cwd))).toMatchObject({ ok: false,
      cause: expect.stringContaining('4 open runs') });
  });
});


describe('a review result bound to the session the kernel observes', () => {
  const OTHER = '0f0f0f0f-764f-4463-b733-8b94509eb25e';

  async function endedReview(sessions: () => ReadonlyMap<string, SessionState>) {
    const cwd = repository();
    let listing: () => ReadonlyMap<string, SessionState> = listed('done');
    const scripted = scriptedRuntime({ sessions: () => listing() });
    const ctx = context(cwd, scripted.runtime);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 1 });
    recordResult(cwd, 20_000, '{"verdict":"pass"}');
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 60_000 });
    listing = sessions;
    return { cwd, ctx, scripted, runId: receipt.runId };
  }

  it('accepts the result of the session the runtime lists under the run, and names that session', async () => {
    const { ctx, scripted, runId } = await endedReview(listed('done'));
    expect(await acceptReview(ctx, runId)).toEqual({ ok: true, runId, sessionId: SESSION,
      result: { text: '{"verdict":"pass"}', truncated: false } });
    expect(scripted.stops.map((ref) => ref.handle)).toEqual(['6d5ea8bb']);
  });

  it('refuses a result once the run record names a session the runtime does not list for it', async () => {
    // A work agent can write under .void/machine: rebinding the run to a session
    // of its own, then recording a result for that session, is refused, because
    // the session is read from the runtime, never from the record.
    const { cwd, ctx, runId } = await endedReview(listed('done'));
    await ctx.store.bind(runId, { handle: '6d5ea8bb', sessionId: OTHER });
    const root = resolveMachineRoot(cwd);
    if (!root.ok) throw new Error(root.cause);
    const claim = JSON.parse(readFileSync(join(root.root, 'agents', 'sessions', `${SESSION}.json`), 'utf8'));
    writeFileSync(claim.resultPath, JSON.stringify({ schemaVersion: 1, sessionId: OTHER, recordedAt: 20_000,
      lastAssistantMessage: '{"verdict":"pass"}', truncated: false }));
    expect(await acceptReview(ctx, runId)).toMatchObject({ ok: false,
      cause: expect.stringContaining('not the session') });
  });

  it('refuses when the runtime no longer lists the session, or cannot be read', async () => {
    const gone = await endedReview(() => new Map());
    expect(await acceptReview(gone.ctx, gone.runId)).toMatchObject({ ok: false,
      cause: expect.stringContaining('no longer lists') });
  });

  it('refuses a work run: only a review is collected as a review', async () => {
    const cwd = repository();
    const ctx = context(cwd, scriptedRuntime({ sessions: listed('done') }).runtime);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), role: 'work' });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await acceptReview(ctx, receipt.runId)).toMatchObject({ ok: false,
      cause: expect.stringContaining('not a review') });
  });
});
