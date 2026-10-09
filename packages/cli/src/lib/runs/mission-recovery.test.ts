import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJsonHash } from '@voidcorp/mission-engine';
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
