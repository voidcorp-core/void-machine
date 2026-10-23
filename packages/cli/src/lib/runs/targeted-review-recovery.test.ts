import { readFileSync } from 'node:fs';
import { parseSpecialistLifecycleInput, recordSpecialistLifecycle, recordSpecialistRequests } from './specialist-lifecycle.js';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalJsonHash, compileContextPack, serializeEvent, replayEventLog, isReviewSubject, type CanonicalEvent } from '@voidcorp/mission-engine';
// Synthetic protocol-only journal shared with the reducer regression's scenario.
// Kept as data: CLI tests must exercise package exports, not import engine internals.
const REVIEWER = 'core:independent-code-reviewer' as const;
const CONTEXT = '/root/independent_reviewer';
const PLAN_HASH = `sha256:${'a'.repeat(64)}`;
function stoppedTargetedReview() {
  const stream = replayEventLog(readFileSync(new URL('./__fixtures__/targeted-review.jsonl', import.meta.url), 'utf8'));
  const events = stream.events;
  const last = events.at(-1);
  const payload = events.at(-2)?.payload;
  if (!last || !payload || typeof payload !== 'object' || !('reviewSubject' in payload)
    || !isReviewSubject(payload.reviewSubject)) throw new Error('Expected complete synthetic journal');
  const subject = payload.reviewSubject;
  const currentInputHashes = { [REVIEWER]: `sha256:${'c'.repeat(64)}` };
  return { events, subject, input: { currentInputHashes }, recovery: { stream,
    request: { schemaVersion: 1 as const, closureEventId: last.eventId, expectedJournalHash: canonicalJsonHash(events),
      disposition: { kind: 'controller-defect' as const, defect: 'targeted-review-context' as const } },
    observation: { stage: 'post-implementation' as const, expectedSource: 'runtime:codex' as const,
      reviewPolicy: 'bounded-corrections-v1' as const, maxRounds: 2, reviewSubject: subject,
      contractVersions: { [REVIEWER]: 1 }, currentInputHashes,
      evidenceDependencies: { 'git:working-tree': `sha256:${'d'.repeat(64)}` } } } };
}
function fixtureEvent(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  const first = stoppedTargetedReview().events[0];
  if (!first) throw new Error('Expected synthetic mission start');
  return { ...first, ...overrides };
}
import { appendMissionEvent, createMission, eventLogPath, inspectMission } from './store.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from './mission-recovery.js';

it('accepts the exact targeted-context recovery request at the CLI boundary', () => {
  const { recovery } = stoppedTargetedReview();
  expect(parseMissionRecoveryRequest(recovery.request)).toEqual(recovery.request);
});
it('appends recovery once to an isolated synthetic journal and retains its exact prefix', async () => {
  const fixture = stoppedTargetedReview();
  const root = await mkdtemp(join(tmpdir(), 'targeted-review-cli-'));
  const missionId = fixture.subject.taskId;
  await createMission(root, { missionId, title: 'Synthetic targeted review', mode: 'team' });
  const path = await eventLogPath(root, missionId);
  const before = fixture.events.map(serializeEvent).join('\n') + '\n';
  await writeFile(path, before);
  const request = parseMissionRecoveryRequest(fixture.recovery.request);
  const result = await recordStoppedMissionRecovery(root, missionId, request, fixture.recovery.observation);
  expect(result.recorded).toBe(true);
  expect((await readFile(path, 'utf8')).startsWith(before)).toBe(true);
  expect((await inspectMission(root, missionId, { dependencies: {} })).stream.events).toHaveLength(fixture.events.length + 1);
  expect(await recordStoppedMissionRecovery(root, missionId, request, fixture.recovery.observation))
    .toEqual({ ...result, recorded: false });
});

it('continues the original reviewer through CLI ingestion after a supported recovery', async () => {
  const fixture = stoppedTargetedReview();
  const root = await mkdtemp(join(tmpdir(), 'targeted-review-resumed-cli-'));
  const missionId = fixture.subject.taskId;
  await createMission(root, { missionId, title: 'Synthetic correction after recovery', mode: 'team' });
  const path = await eventLogPath(root, missionId);
  const closure = fixtureEvent({ seq: 7, eventId: 'evt_review_blocker_close', kind: 'mission.closed',
    source: 'void-harness:mission.dispatch', subject: 'mission', payload: { reason: 'controller-stop' } });
  const events = [...fixture.events.slice(0, 6), closure];
  await writeFile(path, events.map(serializeEvent).join('\n') + '\n');
  const artifact = { path: 'clarification.md', sha256: PLAN_HASH };
  await recordStoppedMissionRecovery(root, missionId, {
    schemaVersion: 1, closureEventId: closure.eventId, expectedJournalHash: canonicalJsonHash(events),
    disposition: { kind: 'review-blocker', completionEventIds: ['evt_targeted_6'], resolutionArtifact: artifact },
  }, { stage: 'post-implementation', expectedSource: 'runtime:codex', maxRounds: 2,
    reviewPolicy: 'bounded-corrections-v1', contractVersions: { [REVIEWER]: 1 },
    currentInputHashes: { [REVIEWER]: `sha256:${'b'.repeat(64)}` }, resolutionArtifact: artifact });
  const before = await readFile(path, 'utf8');
  const correctionRequest = fixture.events[6];
  const proof = fixture.events[7];
  if (!correctionRequest || !proof) throw new Error('Expected correction fixture');
  const requested = await appendMissionEvent(root, missionId, { kind: 'lead-writer.requested', subject: 'writer:primary',
    source: 'void-harness:mission.dispatch', correlationId: missionId, payload: correctionRequest.payload });
  await appendMissionEvent(root, missionId, { kind: 'evidence.recorded', subject: proof.subject,
    source: 'void-harness:mission.verify', correlationId: missionId, payload: proof.payload });
  await appendMissionEvent(root, missionId, { kind: 'lead-writer.completed', subject: 'writer:primary',
    source: 'writer:primary', correlationId: missionId, causationId: requested.eventId,
    payload: { writerId: 'writer:primary', planHash: PLAN_HASH, actionKind: 'run-correction',
      implementationRound: 2, requestEventId: requested.eventId } });
  const dispatch = { missionId, specialistId: REVIEWER, stage: 'post-implementation' as const, reviewRound: 2,
    inputHash: fixture.input.currentInputHashes[REVIEWER] };
  const envelope = { ...dispatch, schemaVersion: 1, runtime: 'codex', agentName: 'independent-code-reviewer', contractVersion: 1,
    reviewSubject: fixture.subject, reviewScope: { kind: 'targeted', findingIds: ['stale-history'], affectedPaths: ['src/history.ts'] },
    contextPack: compileContextPack({ diff: '', touchedPaths: [], artifacts: [], lens: 'full', budgetTokens: 12_000, dispatch }) };
  const start = parseSpecialistLifecycleInput('started', { envelope, contextId: CONTEXT });
  await recordSpecialistRequests(root, missionId, [start.envelope], PLAN_HASH);
  await expect(recordSpecialistLifecycle(root, missionId, start)).resolves.toBeUndefined();
  const completionPayload = fixture.events[11]?.payload;
  if (!completionPayload || typeof completionPayload !== 'object' || !('completion' in completionPayload)) throw new Error('Expected fixture result');
  await recordSpecialistLifecycle(root, missionId, parseSpecialistLifecycleInput('completed', {
    envelope, contextId: CONTEXT, completion: completionPayload['completion'],
  }));
  const after = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
  expect(after.at(-1)?.kind).toBe('specialist.completed');
  expect(after.at(-1)?.payload).toMatchObject({ contextId: CONTEXT, completion: { verdict: 'pass' } });
  expect((await readFile(path, 'utf8')).startsWith(before)).toBe(true);
});
