import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSequencedEvent, writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { projectMissionLifecycle, reduceReviewLoop } from '@voidcorp/mission-engine';
import { createMission, eventLogPath, inspectMission } from './store.js';
import { changeUsageSession, readUsageSessions } from './usage-sessions.js';
import { scanUsageSource } from './usage-session-contract.js';
import { recordUsageAdvisory } from './usage-advisory.js';

const target = 'mis_target00000001';
const source = 'mis_source00000001';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const inspect = (root: string, id = target) => inspectMission(root, id, { dependencies: {} }, { quarantine: false });
async function hook(root: string) {
  return writeSequencedEvent({ root, missionId: source, draft: { source: 'runtime:codex',
    kind: 'hook.completed', subject: 'hook:tdd-order', correlationId: source, payload: { status: 'ok' } } });
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'usage-binding-')); roots.push(root);
  await createMission(root, { missionId: target, title: 'Usage linkage', mode: 'fast' });
  await hook(root);
  return root;
}
const change = (root: string, action: 'bind' | 'unbind', missionId = target) =>
  changeUsageSession({ root, missionId, sourceMissionId: source, action });
const resolved = async (root: string) => readUsageSessions(root, target, (await inspect(root)).stream.events);

describe('prospective explicit usage intervals', () => {
  it('counts only after opening, freezes at close and retains original event identity', async () => {
    const root = await fixture();
    const opened = await change(root, 'bind');
    expect(opened.status).toBe('open');
    const during = await hook(root);
    const live = await resolved(root);
    expect(live.scopes[0]?.events).toEqual([during]);
    expect(live.links[0]?.status).toBe('open');
    expect(live.notes.join(' ')).toContain('provisional/shared-session');
    const closed = await change(root, 'unbind');
    await hook(root);
    const final = await resolved(root);
    expect(final.scopes[0]?.events).toEqual([during]);
    expect(final.scopes[0]?.events[0]?.missionId).toBe(source);
    expect(final.links[0]?.status).toBe('closed');
    expect(await change(root, 'unbind')).toEqual(closed);
    expect(await change(root, 'bind')).toEqual(closed);
    const stream = (await inspect(root, source)).stream;
    expect(stream.events.filter(event => event.kind === 'usage.session.opened')).toHaveLength(1);
    expect(stream.events.filter(event => event.kind === 'usage.session.closed')).toHaveLength(1);
  });

  it('serializes competing targets and permits a new target only after close', async () => {
    const root = await fixture();
    const other = 'mis_target00000002';
    await createMission(root, { missionId: other, title: 'Other task', mode: 'fast' });
    const outcomes = await Promise.allSettled([change(root, 'bind'), change(root, 'bind', other)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const owner = outcomes[0]?.status === 'fulfilled' ? target : other;
    await change(root, 'unbind', owner);
    await expect(change(root, 'bind', owner === target ? other : target)).resolves.toMatchObject({ status: 'open' });
  });

  it.each([false, true])('releases the losing source at concurrent capacity, or exposes bounded cleanup (close failure=%s)', async failClose => {
    const root = await fixture();
    const seed = async (id: string) => writeSequencedEvent({ root, missionId: id, draft: {
      source: 'runtime:codex', kind: 'hook.completed', subject: 'hook:tdd-order',
      correlationId: id, payload: { status: 'ok' } } });
    for (let index = 0; index < 31; index += 1) {
      const id = `mis_seed_source_${index}`;
      await seed(id);
      await changeUsageSession({ root, missionId: target, sourceMissionId: id, action: 'bind' });
    }
    const candidates = ['mis_candidate_source_a', 'mis_candidate_source_b'];
    await Promise.all(candidates.map(seed));
    let arrivals = 0;
    let release: () => void = () => { throw new Error('Barrier not initialized'); };
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const race: typeof writeSequencedEventOnce = async options => {
      if (options.missionId === target && options.draft.kind === 'usage.session.linked') {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
      }
      if (failClose && options.draft.kind === 'usage.session.closed') throw new Error('TEST_CLOSE_UNAVAILABLE');
      return writeSequencedEventOnce(options);
    };
    const results = await Promise.allSettled(candidates.map(sourceMissionId =>
      changeUsageSession({ root, missionId: target, sourceMissionId, action: 'bind' }, race)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.findIndex(result => result.status === 'rejected');
    const loser = candidates[failed];
    const rejected = results[failed];
    if (loser === undefined || rejected?.status !== 'rejected') throw new Error('Expected one capacity refusal');
    expect(rejected.reason.message).toContain(failClose ? 'USAGE_CAPACITY_CLEANUP_PENDING' : 'USAGE_LINK_LIMIT');
    expect(rejected.reason.message).not.toContain('USAGE_REFERENCE_PENDING');
    const targetEvents = (await inspect(root)).stream.events;
    expect(targetEvents.filter(event => event.kind === 'usage.session.linked')).toHaveLength(32);
    expect(targetEvents.some(event => event.kind === 'usage.session.linked' && event.subject === loser)).toBe(false);
    if (failClose) {
      expect(scanUsageSource((await inspect(root, loser)).stream.events, loser).active).toBeDefined();
      await expect(changeUsageSession({ root, missionId: target, sourceMissionId: loser, action: 'unbind' }))
        .rejects.toThrow('USAGE_LINK_LIMIT');
    }
    const beforeRetry = (await inspect(root, loser)).stream.events;
    expect(scanUsageSource(beforeRetry, loser).active).toBeUndefined();
    expect(beforeRetry.filter(event => event.kind === 'usage.session.opened')).toHaveLength(1);
    expect(beforeRetry.filter(event => event.kind === 'usage.session.closed')).toHaveLength(1);
    await expect(changeUsageSession({ root, missionId: target, sourceMissionId: loser, action: 'bind' }))
      .rejects.toThrow('USAGE_LINK_LIMIT');
    expect((await inspect(root, loser)).stream.events).toEqual(beforeRetry);
    const next = 'mis_capacity_next_target';
    await createMission(root, { missionId: next, title: 'Next independent work', mode: 'fast' });
    await expect(changeUsageSession({ root, missionId: next, sourceMissionId: loser, action: 'bind' }))
      .resolves.toMatchObject({ status: 'open' });
  });

  it('repairs a source-written target-reference failure without backdating or duplicating the opening', async () => {
    const root = await fixture();
    const failReference: typeof writeSequencedEventOnce = async options => {
      if (options.missionId === target) throw new Error('TEST_DISK_FULL');
      return writeSequencedEventOnce(options);
    };
    await expect(changeUsageSession({ root, missionId: target, sourceMissionId: source, action: 'bind' }, failReference))
      .rejects.toThrow('USAGE_REFERENCE_PENDING');
    const during = await hook(root);
    expect((await resolved(root)).scopes).toHaveLength(0);
    await change(root, 'bind');
    await change(root, 'bind');
    expect((await resolved(root)).scopes[0]?.events).toEqual([during]);
    expect((await inspect(root)).stream.events.filter(event => event.kind === 'usage.session.linked')).toHaveLength(1);
    expect((await inspect(root, source)).stream.events.filter(event => event.kind === 'usage.session.opened')).toHaveLength(1);
  });

  it('exposes damaged, unavailable and mismatched boundaries instead of zero coverage', async () => {
    const root = await fixture();
    await change(root, 'bind');
    await hook(root);
    await change(root, 'unbind');
    const path = await eventLogPath(root, source);
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace('"status":"ok"', '"status":"blocked"'));
    expect((await resolved(root)).scopes).toEqual([]);
    expect((await resolved(root)).links[0]?.status).toBe('unavailable');
    await expect(change(root, 'bind')).rejects.toThrow('USAGE_BOUNDARY_INVALID');
    await writeFile(path, original);
    await appendFile(path, '{invalid\n');
    await expect(change(root, 'bind')).rejects.toThrow('USAGE_SOURCE_INTEGRITY');
    expect((await resolved(root)).notes.join(' ')).toContain('unavailable');
    await rm(path);
    expect((await resolved(root)).links[0]?.status).toBe('unavailable');
  });

  it('can freeze a source after its target mission closes', async () => {
    const root = await fixture(); await change(root, 'bind');
    await writeSequencedEvent({ root, missionId: target, draft: { source: 'void-harness:mission',
      kind: 'mission.closed', subject: 'mission', correlationId: target, payload: { reason: 'completed' } } });
    await expect(change(root, 'unbind')).resolves.toMatchObject({ status: 'closed' });
  });

  it('rejects ambiguous duplicate source references instead of retaining their earlier counts', async () => {
    const root = await fixture(); await change(root, 'bind'); await hook(root);
    const ref = (await inspect(root)).stream.events.find(event => event.kind === 'usage.session.linked');
    if (ref === undefined) throw new Error('Expected source reference');
    await writeSequencedEvent({ root, missionId: target, draft: { source: ref.source, kind: ref.kind,
      subject: ref.subject, correlationId: target, payload: ref.payload } });
    const result = await resolved(root);
    expect(result.scopes).toEqual([]);
    expect(result.links).toEqual([{ sourceMissionId: source, status: 'unavailable' }]);
  });

  it('refuses missing missions and a close without an opening without creating usage events', async () => {
    const root = await fixture();
    await expect(change(root, 'unbind')).rejects.toThrow('USAGE_NOT_BOUND');
    await expect(change(root, 'bind', 'mis_missing0001')).rejects.toThrow();
    expect((await inspect(root, source)).stream.events).toHaveLength(1);
  });
});

describe('coordinator-observed native advisory starts', () => {
  it('records real context declarations idempotently, separately from formal lifecycle and all quality gates', async () => {
    const root = await fixture();
    const before = await inspect(root);
    const input = { root, missionId: target, specialistId: 'core:security-engineer', runtime: 'codex' as const,
      contextId: '/root/native-security' };
    const first = await recordUsageAdvisory(input);
    expect(await recordUsageAdvisory(input)).toEqual(first);
    await change(root, 'bind'); await hook(root); await change(root, 'unbind');
    const after = await inspect(root);
    expect(after.verdict).toEqual(before.verdict);
    expect(projectMissionLifecycle(after.stream.events)).toEqual(projectMissionLifecycle(before.stream.events));
    const review = (events: typeof before.stream.events) => reduceReviewLoop({ events,
      stage: 'post-implementation', expectedSource: 'runtime:codex', requiredSpecialists: ['core:security-engineer'],
      contractVersions: { 'core:security-engineer': 1 }, currentInputHashes: { 'core:security-engineer': `sha256:${'a'.repeat(64)}` }, maxRounds: 2 });
    expect(review(after.stream.events)).toEqual(review(before.stream.events));
    expect(after.stream.events.filter(event => event.kind === 'usage.advisory.started')).toHaveLength(1);
    expect(after.stream.events.some(event => event.kind === 'specialist.started')).toBe(false);
    await expect(recordUsageAdvisory({ ...input, specialistId: 'core:test-qa-engineer' })).rejects.toThrow();
  });

  it('rejects unknown roles, malformed context identities and unsupported runtimes', async () => {
    const root = await fixture();
    const base = { root, missionId: target, specialistId: 'core:security-engineer', runtime: 'codex', contextId: '/root/expert' };
    for (const input of [{ ...base, specialistId: 'core:invented-agent' }, { ...base, contextId: '' },
      { ...base, contextId: 'planned\ncontext' }, { ...base, runtime: 'invented' }]) {
      await expect(recordUsageAdvisory(input)).rejects.toThrow();
    }
    expect((await inspect(root)).stream.events).toHaveLength(1);
  });
});
