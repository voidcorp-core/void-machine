import { describe, expect, it } from 'vitest';
import {
  DELEGATION_LIMITS, type RunObservation, type RunTransition,
} from '../src/core/delegation.js';
import {
  type AgentRuntimePort, type DelegationClock, type MissionLock, type RunRecord, type RunRegistry,
  type RunResult, type RuntimeReading, type SessionReading, observeMission, waitForTransitions,
} from '../src/runtime/delegation.js';

const T0 = 5_000_000;

type ObservedPort = Pick<AgentRuntimePort, 'observe' | 'release'>;
/** The same port answers for every runtime, for tests that exercise one runtime only. */
const ports = (port: ObservedPort) => ({ claude: port, codex: port });
const MISSION = 'mis_driver-test';

function transition(seq: number, to: RunTransition['to'], at = T0): RunTransition {
  return { seq, at, to, event: seq === 1 ? 'admitted' : 'observed', cause: 'c', action: 'a',
    ...(seq === 1 ? {} : { from: 'admitted' }) };
}

function record(runId: string, log: RunTransition[], handle = runId.slice(0, 8)): RunRecord {
  return {
    runId, missionId: MISSION, name: `vm-${runId}`, role: 'review', runtime: 'claude',
    cwd: '/work/review', agentType: 'independent-code-reviewer', ticket: undefined,
    model: undefined, binding: { handle }, transitions: log,
  };
}

/** In-memory registry: the only shared state two waiters could race on. */
function memoryRegistry(records: RunRecord[]) {
  const runs = new Map(records.map((run) => [run.runId, { ...run, transitions: [...run.transitions] }]));
  const results = new Map<string, RunResult>();
  const schemas = new Map<string, unknown>();
  const recorded: string[] = [];
  let holder: string | undefined;
  let appends = 0;
  const registry: RunRegistry = {
    list: async (missionId) => [...runs.values()].filter((run) => run.missionId === missionId),
    read: async (runId) => runs.get(runId),
    append: async (runId, next) => {
      const run = runs.get(runId);
      if (run === undefined || run.transitions.length + 1 !== next.seq) return 'conflict';
      run.transitions.push(next);
      appends += 1;
      return 'appended';
    },
    bind: async (runId, binding) => {
      const run = runs.get(runId);
      if (run !== undefined) runs.set(runId, { ...run, binding });
    },
    result: async (runId) => results.get(runId),
    recordResult: async (runId, result) => { recorded.push(runId); results.set(runId, result); },
    outputSchema: async (runId) => schemas.get(runId),
    lock: async (_missionId, owner) => {
      if (holder !== undefined) return undefined;
      holder = owner;
      const lock: MissionLock = { release: async () => { holder = undefined; } };
      return lock;
    },
  };
  return { registry, runs, results, schemas, recorded, appendCount: () => appends };
}

function fakeRuntime(readings: Array<SessionReading | 'unreadable'>) {
  const calls: string[][] = [];
  let index = 0;
  const runtime: ObservedPort = {
    release: async () => undefined,
    observe: async (refs) => {
      calls.push(refs.map((ref) => ref.name));
      const reading = readings[Math.min(index, readings.length - 1)];
      index += 1;
      if (reading === undefined || reading === 'unreadable') {
        return { kind: 'unreadable', cause: 'claude agents exited 1' };
      }
      return { kind: 'read', sessions: reading };
    },
  };
  return { runtime, calls };
}

function manualClock(start = T0) {
  let now = start;
  const sleeps: number[] = [];
  const clock: DelegationClock = {
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
  };
  return { clock, sleeps, advance: (ms: number) => { now += ms; } };
}

const session = (observation: RunObservation, sessionId = 'aaaaaaaa-1111-2222-3333-444444444444') =>
  ({ observation, binding: { handle: sessionId.slice(0, 8), sessionId } });

describe('one observation tick', () => {
  it('reads every open run of the mission with one runtime call and appends each change once', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'dispatched')]),
      record('run-b', [transition(1, 'admitted'), transition(2, 'dispatched')])]);
    const { runtime, calls } = fakeRuntime([new Map([
      ['vm-run-a', session({ kind: 'present', state: 'working' })],
      ['vm-run-b', session({ kind: 'present', state: 'blocked', waitingFor: 'permission prompt' })],
    ])]);
    const outcome = await observeMission(MISSION, { registry: store.registry, runtimes: ports(runtime),
      clock: manualClock().clock, doneSince: new Map() });
    expect(calls).toEqual([['vm-run-a', 'vm-run-b']]);
    expect(outcome).toMatchObject({ kind: 'observed' });
    expect(store.runs.get('run-a')?.transitions.at(-1)?.to).toBe('working');
    expect(store.runs.get('run-b')?.transitions.at(-1)).toMatchObject({ to: 'waiting-human',
      waitingFor: 'permission prompt' });
  });

  it('binds the native session the first time it is listed', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'dispatched')])]);
    const { runtime } = fakeRuntime([new Map([['vm-run-a', session({ kind: 'present', state: 'working' },
      'bbbbbbbb-1111-2222-3333-444444444444')]])]);
    await observeMission(MISSION, { registry: store.registry, runtimes: ports(runtime), clock: manualClock().clock,
      doneSince: new Map() });
    expect(store.runs.get('run-a')?.binding).toEqual({ handle: 'bbbbbbbb',
      sessionId: 'bbbbbbbb-1111-2222-3333-444444444444' });
  });

  it('treats an unlisted run as absent and a failed reading as no change', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'working')])]);
    const unreadable = fakeRuntime(['unreadable']);
    expect(await observeMission(MISSION, { registry: store.registry, runtimes: ports(unreadable.runtime),
      clock: manualClock().clock, doneSince: new Map() }))
      .toEqual({ kind: 'unreadable', cause: 'claude agents exited 1' });
    expect(store.appendCount()).toBe(0);
    const empty = fakeRuntime([new Map()]);
    await observeMission(MISSION, { registry: store.registry, runtimes: ports(empty.runtime),
      clock: manualClock().clock, doneSince: new Map() });
    expect(store.runs.get('run-a')?.transitions.at(-1)?.to).toBe('reconciling');
  });

  it('ignores a result recorded for another session than the bound one', async () => {
    const bound = 'cccccccc-1111-2222-3333-444444444444';
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'working')])]);
    store.registry.bind('run-a', { handle: 'cccccccc', sessionId: bound });
    store.results.set('run-a', { sessionId: 'dddddddd-1111-2222-3333-444444444444', recordedAt: T0 + 1, pendingWork: 0,
      text: 'forged', truncated: false });
    const { runtime } = fakeRuntime([new Map([['vm-run-a', session({ kind: 'present', state: 'done' }, bound)]])]);
    await observeMission(MISSION, { registry: store.registry, runtimes: ports(runtime), clock: manualClock(T0 + 10).clock,
      doneSince: new Map() });
    expect(store.runs.get('run-a')?.transitions.at(-1)?.to).toBe('working');
  });
});

describe('runtimes of one mission', () => {
  const verdict = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'],
    additionalProperties: false };
  const thread = '01a0e9f7-5d5e-7c92-b856-0c2782407fda';
  const codexRun = (log: RunTransition[]): RunRecord => ({ ...record('run-c', log), runtime: 'codex' });

  function port(reading: () => Promise<RuntimeReading>) {
    const released: string[] = [];
    const runtime: ObservedPort = {
      observe: reading,
      release: async (ref) => { released.push(ref.name); },
    };
    return { runtime, released };
  }

  it('observes each run through the port of its own runtime, and a failing one never holds the others', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'dispatched')]),
      codexRun([transition(1, 'admitted'), transition(2, 'dispatched')])]);
    const claude = port(async () => ({ kind: 'read',
      sessions: new Map([['vm-run-a', session({ kind: 'present', state: 'working' })]]) }));
    const codex = port(async () => { throw new Error('socket hung'); });
    const outcome = await observeMission(MISSION, { registry: store.registry,
      runtimes: { claude: claude.runtime, codex: codex.runtime }, clock: manualClock().clock, doneSince: new Map() });
    expect(store.runs.get('run-a')?.transitions.at(-1)?.to).toBe('working');
    expect(store.runs.get('run-c')?.transitions.at(-1)?.to).toBe('dispatched');
    expect(outcome).toEqual({ kind: 'unreadable', cause: 'the codex runtime could not be read: socket hung' });
  });

  it('keeps the final message a runtime reports, once per turn, checked against the run schema', async () => {
    const store = memoryRegistry([codexRun([transition(1, 'admitted'), transition(2, 'working')])]);
    store.schemas.set('run-c', verdict);
    const done = { observation: { kind: 'present', state: 'done', status: 'idle' } as const,
      binding: { handle: thread.slice(-8), sessionId: thread },
      result: { turnId: 'turn-1', text: '{"verdict":"pass"}', truncated: false } };
    const codex = port(async () => ({ kind: 'read', sessions: new Map([['vm-run-c', done]]) }));
    const time = manualClock(T0 + 100);
    const deps = { registry: store.registry, runtimes: { claude: codex.runtime, codex: codex.runtime },
      clock: time.clock, doneSince: new Map<string, number>() };
    await observeMission(MISSION, deps);
    expect(store.results.get('run-c')).toEqual({ sessionId: thread, turnId: 'turn-1', recordedAt: T0 + 100,
      pendingWork: 0, text: '{"verdict":"pass"}', truncated: false, conformance: { state: 'valid' } });
    expect(store.runs.get('run-c')?.transitions.at(-1)).toMatchObject({ to: 'turn-ended', event: 'turn-ended' });
    time.advance(5_000);
    await observeMission(MISSION, deps);
    expect(store.recorded).toEqual(['run-c']);
  });

  it('keeps an answer that breaks the schema, marked invalid', async () => {
    const store = memoryRegistry([codexRun([transition(1, 'admitted'), transition(2, 'working')])]);
    store.schemas.set('run-c', verdict);
    const codex = port(async () => ({ kind: 'read', sessions: new Map([['vm-run-c', {
      observation: { kind: 'present', state: 'done', status: 'idle' } as const,
      binding: { handle: thread.slice(-8), sessionId: thread },
      result: { turnId: 'turn-1', text: 'it passes', truncated: false } }]]) }));
    await observeMission(MISSION, { registry: store.registry, runtimes: ports(codex.runtime),
      clock: manualClock().clock, doneSince: new Map() });
    expect(store.results.get('run-c')).toMatchObject({ text: 'it passes',
      conformance: { state: 'invalid', cause: 'the final message is not JSON' } });
  });

  it('releases what the adapter holds once an observation closes the run', async () => {
    const store = memoryRegistry([codexRun([transition(1, 'admitted'), transition(2, 'working')])]);
    const codex = port(async () => ({ kind: 'read', sessions: new Map([['vm-run-c',
      session({ kind: 'present', state: 'failed' }, thread)]]) }));
    const deps = { registry: store.registry, runtimes: ports(codex.runtime), clock: manualClock().clock,
      doneSince: new Map<string, number>() };
    await observeMission(MISSION, deps);
    await observeMission(MISSION, deps);
    expect(store.runs.get('run-c')?.transitions.at(-1)?.to).toBe('failed');
    expect(codex.released).toEqual(['vm-run-c']);
  });
});

describe('waiting for transitions', () => {
  it('returns the next transition of the run, observing every five seconds', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'dispatched')])]);
    const { runtime } = fakeRuntime([new Map(), new Map([['vm-run-a',
      session({ kind: 'present', state: 'working' })]])]);
    const time = manualClock();
    // The first reading lists nothing yet: absent, so the run reconciles, then works.
    const outcome = await waitForTransitions(['run-a'], { any: false, timeoutMs: 60_000 },
      { registry: store.registry, runtimes: ports(runtime), clock: time.clock, owner: 'waiter-1' });
    expect(outcome).toMatchObject({ kind: 'transitioned', runs: [{ runId: 'run-a',
      transitions: [{ to: 'reconciling' }] }] });
    expect(time.sleeps.every((ms) => ms === DELEGATION_LIMITS.pollIntervalMs)).toBe(true);
  });

  it('times out with the current status and the last observation error', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'working')])]);
    const { runtime } = fakeRuntime(['unreadable']);
    const outcome = await waitForTransitions(['run-a'], { any: false, timeoutMs: 20_000 },
      { registry: store.registry, runtimes: ports(runtime), clock: manualClock().clock, owner: 'waiter-1' });
    expect(outcome).toMatchObject({ kind: 'timed-out', lastObservationError: 'claude agents exited 1',
      runs: [{ runId: 'run-a', status: { state: 'working' } }] });
  });

  it('returns as soon as any run moves when asked for any', async () => {
    const store = memoryRegistry([
      record('run-a', [transition(1, 'admitted'), transition(2, 'working')]),
      record('run-b', [transition(1, 'admitted'), transition(2, 'working')]),
    ]);
    const { runtime } = fakeRuntime([new Map([
      ['vm-run-a', session({ kind: 'present', state: 'working' })],
      ['vm-run-b', session({ kind: 'present', state: 'failed' })],
    ])]);
    const outcome = await waitForTransitions(['run-a', 'run-b'], { any: true, timeoutMs: 60_000 },
      { registry: store.registry, runtimes: ports(runtime), clock: manualClock().clock, owner: 'waiter-1' });
    expect(outcome).toMatchObject({ kind: 'transitioned' });
    expect(outcome.kind === 'transitioned' && outcome.runs.map((run) => run.runId)).toEqual(['run-b']);
  });

  it('lets two concurrent waiters see the same transition, appended once', async () => {
    const store = memoryRegistry([record('run-a', [transition(1, 'admitted'), transition(2, 'working')])]);
    const { runtime } = fakeRuntime([new Map([['vm-run-a',
      session({ kind: 'present', state: 'failed' })]])]);
    const shared = manualClock();
    const [first, second] = await Promise.all(['w1', 'w2'].map((owner) =>
      waitForTransitions(['run-a'], { any: false, timeoutMs: 60_000 },
        { registry: store.registry, runtimes: ports(runtime), clock: shared.clock, owner })));
    expect(store.appendCount()).toBe(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ kind: 'transitioned', runs: [{ transitions: [{ seq: 3, to: 'failed' }] }] });
  });

  it('refuses an unknown run instead of waiting on it', async () => {
    const store = memoryRegistry([]);
    const { runtime } = fakeRuntime([new Map()]);
    expect(await waitForTransitions(['run-x'], { any: false, timeoutMs: 1_000 },
      { registry: store.registry, runtimes: ports(runtime), clock: manualClock().clock, owner: 'w' }))
      .toMatchObject({ kind: 'unknown-run', runId: 'run-x' });
  });
});
