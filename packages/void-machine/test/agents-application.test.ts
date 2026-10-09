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
  AgentRuntimePort, LaunchOutcome, LaunchPlan, NativeRunRef, Preflight, RuntimeCapabilities, SessionState,
} from '../src/runtime/delegation.js';

const SESSION = '6d5ea8bb-764f-4463-b733-8b94509eb25e';
const MISSION = 'mis_application-test';

function repository(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vm-agents-')));
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: base, stdio: 'ignore' });
  return base;
}

/** What a Claude-like runtime declares: a view, a capture, no schema. */
const capabilities: RuntimeCapabilities = {
  view: { available: true, provenance: 'verified', note: 'attach' },
  capture: { available: true, provenance: 'verified', note: 'hook' },
  structuredOutput: { available: false, provenance: 'documented', note: 'none' },
};

/** A runtime whose every answer the test chooses, and which records what it was asked. */
function scriptedRuntime(script: {
  preflight?: Preflight; launch?: LaunchOutcome; resume?: LaunchOutcome;
  sessions?: () => ReadonlyMap<string, SessionState>;
} = {}) {
  const launches: LaunchPlan[] = [];
  const stops: NativeRunRef[] = [];
  const resumes: Array<{ ref: NativeRunRef; plan: LaunchPlan }> = [];
  const runtime: AgentRuntimePort = {
    capabilities,
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

function context(cwd: string, runtime: AgentRuntimePort, now = { value: 10_000 },
  codex: AgentRuntimePort = runtime): AgentsContext {
  const root = resolveMachineRoot(cwd);
  if (!root.ok) throw new Error(root.cause);
  let runs = 0;
  return {
    store: createRunRegistry({ machineRoot: root.root, now: () => now.value }),
    runtimes: { claude: runtime, codex },
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
    // The generic accept runs the same check on a review: no path takes a verdict unchecked.
    expect(await acceptAgent(ctx, runId)).toMatchObject({ ok: false,
      cause: expect.stringContaining('not the session') });
  });

  it('refuses a run rebound while the runtime is being read, before its result is taken', async () => {
    // The rebinding lands between the runtime reading and the taking of the result: the
    // verification and the take cover the same instant, so the forged text is never returned.
    const cwd = repository();
    let tamper: (() => Promise<void>) | undefined;
    const scripted = scriptedRuntime({ sessions: listed('done') });
    const observe = scripted.runtime.observe;
    const runtime: AgentRuntimePort = { ...scripted.runtime, observe: async (refs) => {
      const reading = await observe(refs);
      const pending = tamper;
      tamper = undefined;
      await pending?.();
      return reading;
    } };
    const ctx = context(cwd, runtime);
    const receipt = await dispatchAgent(ctx, reviewInput(cwd));
    if (!receipt.ok) throw new Error(receipt.cause);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 1 });
    recordResult(cwd, 20_000, '{"verdict":"pass"}');
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 60_000 });
    const root = resolveMachineRoot(cwd);
    if (!root.ok) throw new Error(root.cause);
    const claim = JSON.parse(readFileSync(join(root.root, 'agents', 'sessions', `${SESSION}.json`), 'utf8'));
    tamper = async () => {
      await ctx.store.bind(receipt.runId, { handle: '6d5ea8bb', sessionId: OTHER });
      writeFileSync(claim.resultPath, JSON.stringify({ schemaVersion: 1, sessionId: OTHER, recordedAt: 20_000,
        lastAssistantMessage: '{"verdict":"forged"}', truncated: false }));
    };
    expect(await acceptReview(ctx, receipt.runId)).toMatchObject({ ok: false,
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

describe('a run delegated to Codex', () => {
  const THREAD = '01a0e9f7-5d5e-7c92-b856-0c2782407fda';
  const RUN_1 = 'vm-run_00000000-0000-4000-8000-000000000001';
  const verdict = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
    required: ['verdict'], additionalProperties: false };
  const codexCapabilities: RuntimeCapabilities = {
    view: { available: false, provenance: 'unknown', note: 'not proven in a pane' },
    capture: { available: false, provenance: 'observed', note: 'brief encrypted' },
    structuredOutput: { available: true, provenance: 'verified', note: 'outputSchema' },
  };

  /** A Codex-like port: no view, a schema, and whatever sessions the test lists. */
  function codexRuntime(sessions: () => ReadonlyMap<string, SessionState> = () => new Map()) {
    const scripted = scriptedRuntime({ launch: { kind: 'acknowledged', handle: THREAD.slice(-8) }, sessions });
    const runtime: AgentRuntimePort = { ...scripted.runtime, capabilities: codexCapabilities,
      attachCommand: () => undefined };
    return { ...scripted, runtime };
  }

  const done = (text: string) => () => new Map([[RUN_1, {
    observation: { kind: 'present' as const, state: 'done' as const, status: 'idle' as const },
    binding: { handle: THREAD.slice(-8), sessionId: THREAD },
    result: { turnId: 'turn-1', text, truncated: false } }]]);

  it('launches through the Codex port only, and says the run has no view and why', async () => {
    const cwd = repository();
    const claude = scriptedRuntime();
    const codex = codexRuntime();
    const ctx = context(cwd, claude.runtime, undefined, codex.runtime);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(codex.launches).toHaveLength(1);
    expect(claude.launches).toHaveLength(0);
    const status = await agentStatus(ctx, receipt.runId);
    expect(status).toMatchObject({ ok: true, runs: [{ runtime: 'codex',
      view: { available: false, provenance: 'unknown', note: 'not proven in a pane' } }] });
    expect(await attachAgent(ctx, receipt.runId)).toMatchObject({ ok: false,
      cause: 'the codex runtime offers no view of this run: not proven in a pane' });
  });

  it('binds the whole session a runtime names at launch, so its view exists from the dispatch on', async () => {
    const cwd = repository();
    const codex = codexRuntime();
    const named: AgentRuntimePort = { ...codex.runtime,
      dispatch: async (plan) => { codex.launches.push(plan);
        return { kind: 'acknowledged', handle: THREAD.slice(-8), sessionId: THREAD }; },
      attachCommand: (ref) => ref.sessionId === undefined ? undefined : ['codex', 'resume', ref.sessionId] };
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, named);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await attachAgent(ctx, receipt.runId)).toEqual({ ok: true, command: ['codex', 'resume', THREAD] });
  });

  it('holds a run to its output schema: refused where the runtime cannot, stored and resent where it can', async () => {
    const cwd = repository();
    const codex = codexRuntime(done('{"verdict":"pass"}'));
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, codex.runtime);
    expect(await dispatchAgent(ctx, { ...reviewInput(cwd), outputSchema: verdict })).toMatchObject({ ok: false,
      cause: 'the claude runtime cannot hold a run to an output schema' });
    expect(await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex', outputSchema: ['not', 'a', 'schema'] }))
      .toMatchObject({ ok: false, cause: 'the output schema must be a JSON object' });
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex', outputSchema: verdict });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(codex.launches[0]?.outputSchema).toEqual(verdict);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 10_000 });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ runs: [{ status: { state: 'turn-ended' },
      result: { text: '{"verdict":"pass"}', conformance: { state: 'valid' } } }] });
    await sendAgent(ctx, receipt.runId, 'Say why.');
    expect(codex.resumes[0]?.plan.outputSchema).toEqual(verdict);
  });

  it('keeps the thread of a worker once its result is accepted', async () => {
    const cwd = repository();
    const codex = codexRuntime(done('done'));
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, codex.runtime);
    const receipt = await dispatchAgent(ctx, { role: 'work', cwd, brief: 'Implement it.', missionId: MISSION,
      runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 10_000 });
    expect(await acceptAgent(ctx, receipt.runId)).toMatchObject({ ok: true, state: 'retired' });
    expect(codex.stops).toHaveLength(0);
  });

  it('stops a run whose launch was lost through the thread its runtime finds by name', async () => {
    const cwd = repository();
    const codex = codexRuntime(() => new Map([[RUN_1, {
      observation: { kind: 'present' as const, state: 'working' as const, status: 'busy' as const },
      binding: { handle: THREAD.slice(-8), sessionId: THREAD } }]]));
    const lost: AgentRuntimePort = { ...codex.runtime,
      dispatch: async () => ({ kind: 'lost', cause: 'codex did not confirm the turn in time' }) };
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, lost);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await stopAgent(ctx, receipt.runId)).toMatchObject({ ok: true, status: { state: 'stopped' } });
    expect(codex.stops).toEqual([{ name: RUN_1, handle: THREAD.slice(-8), sessionId: THREAD }]);
  });

  it('never reads a daemon it cannot reach as runs gone: they stay as they were, and the wait says why', async () => {
    const cwd = repository();
    const cause = 'the Codex daemon does not answer on /s.sock: ECONNREFUSED; start it with codex app-server daemon start';
    const down: AgentRuntimePort = { ...codexRuntime().runtime, observe: async () => ({ kind: 'unreadable', cause }) };
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, down);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    expect(await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 120_000 })).toMatchObject({
      kind: 'timed-out', lastObservationError: cause });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ runs: [{ status: { state: 'dispatched' } }] });
  });

  it('keeps a Codex answer that breaks the run schema, marked invalid', async () => {
    const cwd = repository();
    const codex = codexRuntime(done('{"verdict":"maybe"}'));
    const ctx = context(cwd, scriptedRuntime().runtime, undefined, codex.runtime);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex', outputSchema: verdict });
    if (!receipt.ok) throw new Error(receipt.cause);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 10_000 });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ runs: [{ status: { state: 'turn-ended' },
      result: { text: '{"verdict":"maybe"}', conformance: { state: 'invalid' } } }] });
  });

  it('never claims to supervise a run its daemon no longer lists: it reconciles, then fails', async () => {
    const cwd = repository();
    const now = { value: 10_000 };
    const codex = codexRuntime(() => new Map());
    const ctx = context(cwd, scriptedRuntime().runtime, now, codex.runtime);
    const receipt = await dispatchAgent(ctx, { ...reviewInput(cwd), runtime: 'codex' });
    if (!receipt.ok) throw new Error(receipt.cause);
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 5_000 });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ runs: [{ status: { state: 'reconciling',
      cause: 'the session is no longer listed by its runtime' } }] });
    await waitAgents(ctx, [receipt.runId], { any: false, timeoutMs: 120_000 });
    expect(await agentStatus(ctx, receipt.runId)).toMatchObject({ runs: [{ status: { state: 'failed',
      action: expect.stringContaining('inspect the runtime') } }] });
  });
});
