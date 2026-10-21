import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJsonHash, compileContextPack, orchestrateMissionTeam, type SpecialistDispatchEnvelope } from '@voidcorp/mission-engine';
import { resolveProjectRoots } from '../project-roots.js';
import { recordSpecialistRequests, recordSpecialistLifecycle, parseSpecialistLifecycleInput } from './specialist-lifecycle.js';
import { appendMissionEvent, createMission, eventLogPath, inspectMission } from './store.js';
import { recordMissionClosure } from '../../commands/mission.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from './mission-recovery.js';

const roots: string[] = [];
const ID = 'mis_0123456789abcdef0123456789abcdef';
const HASH = `sha256:${'a'.repeat(64)}`;
const specialistId = 'core:test-qa-engineer';
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true }))); });
async function incident() {
  const root = await mkdtemp(join(tmpdir(), 'void-mission-recovery-'));
  roots.push(root);
  await createMission(root, { missionId: ID, title: 'Blocked review', mode: 'team' });
  const completed = await appendMissionEvent(root, ID, { source: 'runtime:codex',
    kind: 'specialist.completed', subject: specialistId, correlationId: ID, payload: {
      stage: 'pre-implementation', reviewRound: 1, inputHash: HASH, contextId: 'context_review',
      completion: { schemaVersion: 1, specialistId, contractVersion: 2,
        completionId: 'completion_review_1', verdict: 'degraded', findings: [],
        evidenceRequests: ['Provide implementation verification after implementation.'],
        limitations: ['Verification timing needs explicit clarification.'] },
    } });
  await recordMissionClosure(root, ID, 'controller-stop');
  const stream = (await inspectMission(root, ID, { dependencies: {} })).stream;
  const closure = stream.events.at(-1);
  if (!closure) throw new Error('Expected closure.');
  const artifact = { path: 'docs/clarification.md', sha256: HASH };
  return { root, stream, request: { schemaVersion: 1 as const,
    closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(stream.events),
    disposition: { kind: 'review-blocker' as const, completionEventIds: [completed.eventId],
      resolutionArtifact: artifact } }, observation: { stage: 'pre-implementation' as const,
    expectedSource: 'runtime:codex' as const, maxRounds: 2,
    contractVersions: { [specialistId]: 2 }, currentInputHashes: { [specialistId]: HASH },
    resolutionArtifact: artifact } };
}

describe('mission recovery append boundary', () => {
  it('appends one recovery receipt under concurrent identical requests without rewriting history', async () => {
    const fixture = await incident();
    const path = await eventLogPath(fixture.root, ID);
    const before = await readFile(path, 'utf8');
    const results = await Promise.all([1, 2].map(() => recordStoppedMissionRecovery(
      fixture.root, ID, fixture.request, fixture.observation)));
    expect(new Set(results.map(value => value.recoveryEventId)).size).toBe(1);
    expect(results.filter(value => value.recorded)).toHaveLength(1);
    const after = await readFile(path, 'utf8');
    expect(after.startsWith(before)).toBe(true);
    const events = (await inspectMission(fixture.root, ID, { dependencies: {} })).stream.events;
    expect(events.filter(value => value.kind === 'mission.recovered')).toHaveLength(1);
    expect(events.at(-1)?.payload).toMatchObject({ priorJournalHash: fixture.request.expectedJournalHash,
      consumedRounds: 1, remainingRounds: 1, nextAction: 'clarification' });
    expect(await recordStoppedMissionRecovery(fixture.root, ID, fixture.request, fixture.observation))
      .toMatchObject({ recorded: false, recoveryEventId: results[0]?.recoveryEventId });
  });
  it('refuses a changed journal hash without appending a recovery', async () => {
    const fixture = await incident();
    await appendMissionEvent(fixture.root, ID, { source: 'void-harness:mission.archive',
      kind: 'mission.archived', subject: 'mission', correlationId: ID, payload: {} });
    const path = await eventLogPath(fixture.root, ID);
    const before = await readFile(path, 'utf8');
    await expect(recordStoppedMissionRecovery(fixture.root, ID, fixture.request, fixture.observation))
      .rejects.toThrow('stale-journal');
    expect(await readFile(path, 'utf8')).toBe(before);
  });
  it('parses exactly the supported request without accepting observations or permission overrides', async () => {
    const fixture = await incident();
    expect(parseMissionRecoveryRequest(fixture.request)).toEqual(fixture.request);
    expect(() => parseMissionRecoveryRequest({ ...fixture.request, observation: fixture.observation }))
      .toThrow('MISSION_RECOVERY_INVALID');
    expect(() => parseMissionRecoveryRequest({ ...fixture.request,
      disposition: { ...fixture.request.disposition, resolutionArtifact: { path: '../escape', sha256: HASH } },
    })).toThrow('MISSION_RECOVERY_INVALID');
  });
});


it('appends one second recovery after premature evidence closure under concurrent requests', async () => {
  const fixture = await incident();
  await recordStoppedMissionRecovery(fixture.root, ID, fixture.request, fixture.observation);
  await recordMissionClosure(fixture.root, ID, 'controller-stop', 'void-harness:mission.dispatch');
  const stream = (await inspectMission(fixture.root, ID, { dependencies: {} })).stream;
  const closure = stream.events.at(-1);
  if (!closure) throw new Error('Expected premature closure');
  const request = { ...fixture.request, closureEventId: closure.eventId,
    expectedJournalHash: canonicalJsonHash(stream.events) };
  const path = await eventLogPath(fixture.root, ID);
  const before = await readFile(path, 'utf8');
  const results = await Promise.all([1, 2].map(() => recordStoppedMissionRecovery(
    fixture.root, ID, request, fixture.observation)));
  expect(results.filter(result => result.recorded)).toHaveLength(1);
  expect(new Set(results.map(result => result.recoveryEventId)).size).toBe(1);
  expect((await readFile(path, 'utf8')).startsWith(before)).toBe(true);
  const after = (await inspectMission(fixture.root, ID, { dependencies: {} })).stream.events;
  expect(after).toHaveLength(stream.events.length + 1);
  expect(after.at(-1)?.payload).toMatchObject({ consumedRounds: 1, remainingRounds: 1 });
});


it('parses exact preparation invocation replacement IDs without accepting budget or observation overrides', () => {
  const request = { schemaVersion: 1, closureEventId: 'evt_closure_preparation', expectedJournalHash: HASH,
    disposition: { kind: 'preparation-invocation', completionEventIds: ['evt_invalid_preparation'] } };
  expect(parseMissionRecoveryRequest(request)).toEqual(request);
  for (const disposition of [
    { ...request.disposition, reviewRound: 1 },
    { ...request.disposition, completionEventIds: [] },
    { ...request.disposition, completionEventIds: ['evt_invalid_preparation', 'evt_invalid_preparation'] },
    { ...request.disposition, completionEventIds: ['unbound'] },
  ]) expect(() => parseMissionRecoveryRequest({ ...request, disposition })).toThrow('MISSION_RECOVERY_INVALID');
});


it('records a one-time replacement episode, emits new requests and admits only genuinely distinct synthetic contexts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-preparation-invocation-')));
  roots.push(root);
  // Standalone fixture: no copied .git pointer can redirect writes to another journal.
  expect(await resolveProjectRoots(root)).toMatchObject({ workRoot: root, installRoot: root });
  await createMission(root, { missionId: ID, title: 'Synthetic reused preparation context', mode: 'team',
    teamController: { planHash: HASH, routingHash: HASH, runtime: 'codex', runtimeAttested: true,
      leadWriterId: 'writer:primary', reviewPolicy: 'bounded-corrections-v1' } });
  const envelope = (round: number): SpecialistDispatchEnvelope => {
    const inputHash = round === 1 ? `sha256:${'b'.repeat(64)}` : HASH;
    return { schemaVersion: 1 as const, missionId: ID, runtime: 'codex' as const, specialistId,
      agentName: 'test-qa-engineer', contractVersion: 2, stage: 'pre-implementation' as const,
      reviewRound: round, inputHash, contextPack: compileContextPack({ diff: '', touchedPaths: [], artifacts: [],
        lens: 'full', budgetTokens: 12_000, dispatch: { missionId: ID, specialistId,
          stage: 'pre-implementation', reviewRound: round, inputHash } }) };
  };
  const complete = (round: number, contextId: string, completionId: string) => ({
    envelope: envelope(round), contextId, completion: { schemaVersion: 1, specialistId, contractVersion: 2,
      completionId, verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } });
  for (const round of [1, 2]) {
    await recordSpecialistRequests(root, ID, [envelope(round)], HASH);
    await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('started', {
      envelope: envelope(round), contextId: 'context-original-synthetic' }));
    await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('completed',
      complete(round, 'context-original-synthetic', `completion-original-${round}`)));
    if (round === 1) {
      const writer = { planHash: HASH, actionKind: 'run-preparation-correction', writerId: 'writer:primary', implementationRound: 1 };
      const requested = await appendMissionEvent(root, ID, { kind: 'lead-writer.requested',
        source: 'void-harness:mission.dispatch', subject: 'writer:primary', correlationId: ID, payload: writer });
      await appendMissionEvent(root, ID, { kind: 'lead-writer.completed', source: 'writer:primary',
        subject: 'writer:primary', correlationId: ID, causationId: requested.eventId,
        payload: { ...writer, requestEventId: requested.eventId } });
    }
  }
  await recordMissionClosure(root, ID, 'controller-stop', 'void-harness:mission.dispatch');
  const path = await eventLogPath(root, ID);
  const original = await readFile(path, 'utf8');
  const before = (await inspectMission(root, ID, { dependencies: {} })).stream;
  const request = parseMissionRecoveryRequest({ schemaVersion: 1, closureEventId: before.events.at(-1)?.eventId,
    expectedJournalHash: canonicalJsonHash(before.events), disposition: { kind: 'preparation-invocation',
      completionEventIds: before.events.filter(e => e.kind === 'specialist.completed').slice(-1).map(e => e.eventId) } });
  const observation = { stage: 'pre-implementation' as const, expectedSource: 'runtime:codex' as const,
    maxRounds: 2, contractVersions: { [specialistId]: 2 }, currentInputHashes: { [specialistId]: HASH } };
  const recovery = await recordStoppedMissionRecovery(root, ID, request, observation);
  expect((await readFile(path, 'utf8')).startsWith(original)).toBe(true);
  await recordSpecialistRequests(root, ID, [envelope(2)], HASH);
  const dispatched = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
  const freshRequest = dispatched.at(-1);
  const originalRequest = before.events.filter(e => e.kind === 'specialist.requested').at(-1);
  if (freshRequest === undefined || originalRequest === undefined) throw new Error('Expected both requests');
  expect(freshRequest.eventId).not.toBe(originalRequest.eventId);
  expect(freshRequest.causationId).toBe(recovery.recoveryEventId);
  expect(freshRequest.payload).toMatchObject({ reviewRound: 2, inputHash: HASH });
  const untouched = await readFile(path, 'utf8');
  await expect(recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('started', {
    envelope: envelope(2), contextId: 'context-original-synthetic' }))).rejects.toThrow('already used');
  expect(await readFile(path, 'utf8')).toBe(untouched);
  await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('started', {
    envelope: envelope(2), contextId: 'context-fresh-synthetic' }));
  await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('completed',
    complete(2, 'context-fresh-synthetic', 'completion-fresh-synthetic')));
  const after = (await inspectMission(root, ID, { dependencies: {} })).stream;
  expect(after.events.at(-1)?.causationId).toBe(freshRequest.eventId);
  expect(after.events.find(e => e.kind === 'mission.recovered')?.payload).toMatchObject({
    consumedRounds: 2, remainingRounds: 0, consumedCorrectionBatches: 0, remainingCorrectionBatches: 2 });
  expect(orchestrateMissionTeam({ stream: after, plan: { planHash: HASH,
    context: { status: 'complete', issues: [] }, specialists: [{ specialistId,
      contractVersion: 2, state: 'applicable', stages: ['pre-implementation'] }] },
    evidenceContext: { dependencies: {} }, maxReviewRounds: 2,
    currentInputHashesByStage: { 'pre-implementation': { [specialistId]: HASH }, 'post-implementation': {} },
    specialistRuntime: { status: 'available', limitations: [] } }).action.kind).toBe('run-lead-writer');
  expect(await recordStoppedMissionRecovery(root, ID, request, observation)).toMatchObject({ recorded: false });
});
