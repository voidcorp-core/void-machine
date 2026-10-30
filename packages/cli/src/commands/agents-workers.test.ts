import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { agentsContext } from '@voidcorp/void-machine/agents';
import type { AgentsContext, AgentRuntimePort } from '@voidcorp/void-machine/agents';
import { appendMissionEvent, createMission } from '../lib/runs/store.js';
import { runAgents } from './agents.js';

const mission = 'mis_worker-contract';
const run = 'run_worker-contract';
const now = '2026-10-30T08:00:00.000Z';
async function repository(startMission = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workers-')));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  if (startMission) await createMission(root, { missionId: mission, title: 'Worker contract', mode: 'fast' });
  const io = { cwd: root, env: {}, home: '/nonexistent', attach: async () => { throw Error('must not attach'); } };
  const log = join(root, '.void/machine/runs', mission, 'events.jsonl');
  const record = async (kind: string, payload: object, observationId = kind) => {
    const file = join(root, 'observation.json');
    writeFileSync(file, JSON.stringify({ kind, payload, observationId }));
    return runAgents(['record', '--mission', mission, '--event-file', file], io);
  };
  const dispatched = { schemaVersion: 1, runId: run, missionId: mission, ticket: 'DEV-42',
    role: 'work', runtime: 'codex', worktree: root, branch: 'main', attachCommand: 'unknown' };
  return { root, io, log, record, dispatched };
}

const state = (value: string, observedAt = now) => ({ schemaVersion: 1, runId: run, state: value, observedAt });
const finished = { schemaVersion: 1, runId: run, outcome: 'succeeded' };

describe('worker lifecycle consumer contract', () => {
  it('publishes all three moments, preserves running-blocked-running, and closes the active snapshot', async () => {
    const f = await repository();
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    expect((await f.record('worker.state', state('running'), 'start')).code).toBe(0);
    expect((await f.record('worker.state', state('blocked', '2026-10-30T08:01:00.000Z'), 'wait')).code).toBe(0);
    expect((await f.record('worker.state', state('running', '2026-10-30T08:02:00.000Z'), 'resume')).code).toBe(0);
    const before = readFileSync(f.log, 'utf8');
    const snapshot = await runAgents(['status', '--json'], f.io);
    expect(snapshot.code).toBe(0);
    expect(JSON.parse(snapshot.stdout)).toMatchObject({ schemaVersion: 1, complete: true, issues: [],
      workers: [{ runId: run, missionId: mission, ticket: 'DEV-42', worktree: f.root,
        state: 'running', observedAt: '2026-10-30T08:02:00.000Z', attachCommand: 'unknown' }] });
    expect(readFileSync(f.log, 'utf8')).toBe(before);
    expect((await f.record('worker.state', state('done', '2026-10-30T08:03:00.000Z'), 'collected')).code).toBe(0);
    expect((await f.record('worker.finished', finished)).code).toBe(0);
    expect((await f.record('worker.finished', finished)).code).toBe(0);
    expect(JSON.parse((await runAgents(['status', '--json'], f.io)).stdout).workers).toEqual([]);
    const events = readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.kind.startsWith('worker.')).map(event => event.kind)).toEqual([
      'worker.dispatched', 'worker.state', 'worker.state', 'worker.state', 'worker.state', 'worker.finished',
    ]);
  });

  it('orders observations by time when UTC timestamps use different precisions', async () => {
    const f = await repository();
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    expect((await f.record('worker.state', state('running', '2026-10-30T08:00:00Z'), 'whole-second')).code).toBe(0);
    expect((await f.record('worker.state', state('blocked', '2026-10-30T08:00:00.001Z'), 'millisecond')).code).toBe(0);
    expect((await f.record('worker.state', state('running', '2026-10-30T08:00:00Z'), 'older')).code).toBe(1);
  });

  it('accepts additive payload fields and makes replay idempotent without ignoring conflicting facts', async () => {
    const f = await repository();
    expect((await f.record('worker.dispatched', { ...f.dispatched, future: true })).code).toBe(0);
    const before = readFileSync(f.log, 'utf8');
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    expect(readFileSync(f.log, 'utf8')).toBe(before);
    expect((await f.record('worker.dispatched', { ...f.dispatched, ticket: 'DEV-43' })).code).toBe(1);
    expect((await f.record('worker.state', state('running'), 'same')).code).toBe(0);
    expect((await f.record('worker.state', state('blocked'), 'same')).code).toBe(1);
  });

  it('refuses invalid versions, paths, identities, attachment strings, premature finish and terminal rewrites', async () => {
    const f = await repository();
    for (const payload of [
      { ...f.dispatched, schemaVersion: 2 }, { ...f.dispatched, worktree: 'relative' },
      { ...f.dispatched, missionId: 'mis_other-mission' }, { ...f.dispatched, attachCommand: 'codex resume x' },
      { ...f.dispatched, role: 'admin' }, { ...f.dispatched, branch: 'not-the-branch' },
    ]) expect((await f.record('worker.dispatched', payload)).code).toBe(1);
    expect((await f.record('worker.state', state('running'))).code).toBe(1);
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    expect((await f.record('worker.finished', finished)).code).toBe(1);
    expect((await f.record('worker.state', state('done'))).code).toBe(0);
    expect((await f.record('worker.finished', finished)).code).toBe(0);
    expect((await f.record('worker.state', state('running'), 'late')).code).toBe(1);
    expect((await f.record('worker.finished', { ...finished, outcome: 'failed' })).code).toBe(1);
  });

  it('reports malformed or incomplete journal data without hiding readable workers', async () => {
    const f = await repository();
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    appendFileSync(f.log, '{"partial":');
    const before = readFileSync(f.log, 'utf8');
    const result = await runAgents(['status', '--json'], f.io);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ complete: false, workers: [{ runId: run }] });
    expect(JSON.parse(result.stdout).issues.length).toBeGreaterThan(0);
    expect(readFileSync(f.log, 'utf8')).toBe(before);
  });

  it('aggregates missions and resolves the same project from a linked worktree', async () => {
    const f = await repository();
    await createMission(f.root, { missionId: 'mis_second-mission', title: 'Second', mode: 'fast' });
    expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'test'], { cwd: f.root });
    const linked = join(f.root, 'linked');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'linked', linked], { cwd: f.root });
    const other = join(f.root, 'other.json');
    writeFileSync(other, JSON.stringify({ observationId: 'second', kind: 'worker.dispatched',
      payload: { ...f.dispatched, missionId: 'mis_second-mission', runId: 'run_second-worker', worktree: linked, branch: 'linked' } }));
    expect((await runAgents(['record', '--mission', 'mis_second-mission', '--event-file', other], f.io)).code).toBe(0);
    const result = await runAgents(['status', '--json'], { ...f.io, cwd: linked });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).workers).toHaveLength(2);
  });
});


it.each([true, false])('emits legacy runtime lifecycle without a surface (canonical mission already exists: %s)', async startMission => {
  const f = await repository(startMission);
  let clock = Date.parse(now);
  let done = false;
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const runId = 'run_00000000-0000-4000-8000-000000000001';
  const capability = { available: true, provenance: 'verified' as const, note: 'test runtime' };
  const runtime: AgentRuntimePort = {
    capabilities: { view: capability, capture: capability, structuredOutput: capability },
    preflight: async () => ({ ok: true }),
    dispatch: async () => ({ kind: 'acknowledged', handle: '00000000', sessionId }),
    send: async () => ({ kind: 'acknowledged', handle: '00000000', sessionId }),
    stop: async () => ({ ok: true }), attachCommand: () => undefined,
    observe: async () => ({ kind: 'read', sessions: new Map([[`vm-${runId}`, {
      observation: { kind: 'present', state: done ? 'done' : 'working' },
      binding: { handle: '00000000', sessionId },
      ...(done ? { result: { turnId: 'native-turn-1', text: 'Collected result', truncated: false } } : {}),
    }]]) }),
  };
  const baseContext = agentsContext({ cwd: f.root, env: {}, home: '/nonexistent', updateCommand: 'update' });
  if (!('store' in baseContext)) throw Error(baseContext.cause);
  const context: AgentsContext = {
    store: baseContext.store,
    runtimes: { claude: runtime, codex: runtime },
    clock: { now: () => clock, sleep: async ms => { clock += ms; } },
    owner: 'contract-test', newRunId: () => runId, newMissionId: () => mission,

  };
  const io = { ...f.io, context: () => context };
  const brief = join(f.root, 'brief.md'); writeFileSync(brief, 'Implement the bounded task.');
  expect((await runAgents(['dispatch', '--role', 'work', '--runtime', 'codex', '--ticket', 'DEV-42',
    '--mission', mission, '--cwd', f.root, '--brief-file', brief], { ...io, cwd: tmpdir() })).code).toBe(0);
  expect(JSON.parse((await runAgents(['status', '--json'], io)).stdout).workers).toMatchObject([
    { runId, ticket: 'DEV-42', worktree: f.root, state: 'running' },
  ]);
  done = true;
  expect((await runAgents(['wait', runId, '--timeout', '1'], io)).code).toBe(0);
  expect(JSON.parse((await runAgents(['status', '--json'], io)).stdout).workers[0].state).toBe('blocked');
  expect((await runAgents(['accept', runId], io)).code).toBe(0);
  expect(JSON.parse((await runAgents(['status', '--json'], io)).stdout).workers).toEqual([]);
  const kinds = readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line).kind);
  expect(kinds).toEqual(['mission.started', 'worker.dispatched', 'worker.state', 'worker.state', 'worker.state', 'worker.finished']);
  const beforeReplay = readFileSync(f.log, 'utf8');
  expect((await runAgents(['publish', runId], io)).code).toBe(0);
  expect(readFileSync(f.log, 'utf8')).toBe(beforeReplay);
});


it.each([{ ...state('running'), state: ['running'] }, state('running', '2026-02-30T08:00:00.000Z')])('rejects malformed state observation %j', async payload => {
  const f = await repository();
  expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
  expect((await f.record('worker.state', payload, 'invalid-state')).code).toBe(1);
});

it('validates detached review commits and rejects mismatched or malformed SHAs', async () => {
  const f = await repository();
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'test'], { cwd: f.root });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '--detach', '-q'], { cwd: f.root });
  const payload = { ...f.dispatched, role: 'review', branch: 'detached', headSha };
  expect((await f.record('worker.dispatched', { ...payload, headSha: 'a'.repeat(41) })).code).toBe(1);
  expect((await f.record('worker.dispatched', payload)).code).toBe(0);
});

it('rejects credential-bearing attachment arguments and strips uncontracted prompt fields', async () => {
  const f = await repository();
  expect((await f.record('worker.dispatched', { ...f.dispatched, attachCommand: ['codex', '--token', 'private-value'] })).code).toBe(1);
  expect((await f.record('worker.dispatched', { ...f.dispatched, prompt: 'not-for-publication' })).code).toBe(0);
  expect(readFileSync(f.log, 'utf8')).not.toContain('not-for-publication');
});

it('marks unsupported worker versions and missing or unsafe journals incomplete', async () => {
  const f = await repository();
  expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
  const lines = readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const last = lines.at(-1);
  appendFileSync(f.log, JSON.stringify({ ...last, seq: last.seq + 1, eventId: 'evt_unsupported-version',
    payload: { ...f.dispatched, schemaVersion: 2 } }) + '\n');
  const missing = join(f.root, '.void/machine/runs/mis_missing-journal');
  mkdirSync(missing);
  const unsafe = join(f.root, '.void/machine/runs/mis_symlink-journal');
  mkdirSync(unsafe); symlinkSync(f.log, join(unsafe, 'events.jsonl'));
  const result = await runAgents(['status', '--json'], f.io);
  expect(result.code).toBe(1);
  const snapshot = JSON.parse(result.stdout);
  expect(snapshot.workers).toMatchObject([{ runId: run }]);
  expect(snapshot.issues).toHaveLength(3);
});


it('does not create a new mission from a mistyped publication destination', async () => {
  const f = await repository();
  const file = join(f.root, 'unknown-mission.json');
  writeFileSync(file, JSON.stringify({ observationId: 'new', kind: 'worker.dispatched',
    payload: { ...f.dispatched, missionId: 'mis_unknown-mission' } }));
  const result = await runAgents(['record', '--mission', 'mis_unknown-mission', '--event-file', file], f.io);
  expect(result.code).toBe(1);
});

it.each(['failed', 'stopped'])('retains the terminal %s outcome without claiming success', async outcome => {
  const f = await repository();
  expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
  expect((await f.record('worker.state', state('failed'))).code).toBe(0);
  expect((await f.record('worker.finished', { ...finished, outcome })).code).toBe(0);
  expect(JSON.parse((await runAgents(['status', '--json'], f.io)).stdout).workers).toEqual([]);
});


it('refuses new observations after closure while allowing identical nonmutating replay', async () => {
  const f = await repository();
  expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
  await appendMissionEvent(f.root, mission, { source: 'test', kind: 'mission.closed', subject: 'mission',
    correlationId: mission, payload: { reason: 'interrupted' } });
  const before = readFileSync(f.log, 'utf8');
  expect((await f.record('worker.state', state('running'))).code).toBe(1);
  expect((await f.record('worker.dispatched', f.dispatched)).code).toBe(0);
  expect(readFileSync(f.log, 'utf8')).toBe(before);
});
