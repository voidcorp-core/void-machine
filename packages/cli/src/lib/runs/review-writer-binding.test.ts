import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { amendmentFor, canonicalJsonHash, projectMissionLifecycle, validatedReviewWriterBindingRequest } from '@voidcorp/mission-engine';
import { appendMissionEvent, createMission, inspectMission } from './store.js';
import { recordReviewWriterBindingLifecycle } from './review-writer-binding.js';
import { parseMissionRecoveryRequest, recordStoppedMissionRecovery } from './mission-recovery.js';
import { collectNativeReview } from '../autopilot/native-review.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const ID = 'mis_writer_binding_12345678';
const specialist = 'core:independent-code-reviewer';
const contextId = '/root/original-reviewer';
it('records only a returned amendment artifact and preserves a failed earlier recovery and its budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-amendment-'));
  try {
    await createMission(root, { missionId: ID, title: 'Writer binding recovery', mode: 'team',
      teamController: { planHash: HASH, routingHash: HASH, leadWriterId: 'writer:primary', runtime: 'codex',
        runtimeAttested: true, reviewPolicy: 'bounded-corrections-v1' } });
    const subject = { taskId: ID, baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40), acceptanceCriteriaHash: HASH };
    const binding = { stage: 'post-implementation', reviewRound: 1, inputHash: HASH, contractVersion: 1,
      reviewSubject: subject, reviewScope: { kind: 'general' } };
    const completion = { schemaVersion: 1, specialistId: specialist, contractVersion: 1, completionId: 'cmp_original_12345678',
      verdict: 'degraded', findings: [{ id: 'blocker', severity: 'high', classification: 'blocking',
        criterion: 'Preserve work', consequence: 'Work is lost', resolutionCondition: 'Work is retained', basis: 'initial-scope-defect',
        summary: 'Lost work', evidence: [{ path: 'source.ts', line: 1, detail: 'Observed loss' }], recommendation: 'Fix loss' }],
      evidenceRequests: [], limitations: ['Original limitation'], review: { ...subject, reviewerId: contextId,
        writerId: '/root/native-writer', readOnly: true, scope: { kind: 'general' }, proofIds: ['old-proof.md'], resolutions: [],
        provenance: { kind: 'native-context', contextId } } };
    for (const [kind, payload] of [['requested', { ...binding, runtime: 'codex', planHash: HASH }],
      ['started', { ...binding, contextId }], ['completed', { ...binding, contextId, completion }]] as const) {
      await appendMissionEvent(root, ID, { source: kind === 'requested' ? 'void-harness:mission.dispatch' : 'runtime:codex',
        kind: `specialist.${kind}`, subject: specialist, correlationId: ID, payload });
    }
    await appendMissionEvent(root, ID, { source: 'void-harness:mission.dispatch', kind: 'mission.closed',
      subject: 'mission', correlationId: ID, payload: { reason: 'controller-stop' } });
    const read = async () => (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const original = await read();
    const completed = original[3]!;
    const observation = { stage: 'post-implementation' as const, reviewPolicy: 'bounded-corrections-v1' as const,
      reviewSubject: { ...subject, reviewedCommit: 'c'.repeat(40) }, expectedSource: 'runtime:codex' as const, maxRounds: 2,
      contractVersions: { [specialist]: 1 }, currentInputHashes: { [specialist]: HASH } };
    const earlier = await recordStoppedMissionRecovery(root, ID, { schemaVersion: 1, closureEventId: original.at(-1)!.eventId,
      expectedJournalHash: canonicalJsonHash(original), disposition: { kind: 'review-blocker', completionEventIds: [completed.eventId],
        resolutionArtifact: { path: 'earlier.md', sha256: HASH } } },
    { ...observation, resolutionArtifact: { path: 'earlier.md', sha256: HASH } });
    await appendMissionEvent(root, ID, { source: 'void-harness:mission.dispatch', kind: 'mission.closed',
      subject: 'mission', correlationId: ID, payload: { reason: 'controller-stop', episodeId: earlier.recoveryEventId } });
    const stopped = await read();
    const requestInput = { closureEventId: stopped.at(-1)!.eventId, expectedJournalHash: canonicalJsonHash(stopped),
      completionEventId: completed.eventId, completionHash: canonicalJsonHash(completion) };
    const requested = await recordReviewWriterBindingLifecycle(root, ID, 'amendment-requested', requestInput);
    expect(await recordReviewWriterBindingLifecycle(root, ID, 'amendment-requested', requestInput)).toMatchObject({ recorded: false });
    expect(projectMissionLifecycle(await read()).status).toBe('closed');
    const request = validatedReviewWriterBindingRequest(await read(), requested.eventId)!;
    await expect(recordReviewWriterBindingLifecycle(root, ID, 'amendment-started', {
      requestEventId: requested.eventId, contextId: '/root/impostor' })).rejects.toThrow('original author');
    const started = await recordReviewWriterBindingLifecycle(root, ID, 'amendment-started', { requestEventId: requested.eventId, contextId });
    const body = JSON.stringify({ requestEventId: requested.eventId, invocationEventId: started.eventId,
      amendment: amendmentFor(request.envelope) });
    await writeFile(join(root, 'response.json'), body);
    const responseInput = { requestEventId: requested.eventId, contextId, responseArtifact: { path: 'response.json',
      sha256: `sha256:${createHash('sha256').update(body).digest('hex')}` } };
    const response = await recordReviewWriterBindingLifecycle(root, ID, 'amendment-completed', responseInput);
    expect(await recordReviewWriterBindingLifecycle(root, ID, 'amendment-completed', responseInput)).toMatchObject({ recorded: false });
    const events = await read();
    const recovery = parseMissionRecoveryRequest({ schemaVersion: 1, closureEventId: requestInput.closureEventId,
      expectedJournalHash: canonicalJsonHash(events), disposition: { kind: 'review-writer-binding', responseEventId: response.eventId } });
    await recordStoppedMissionRecovery(root, ID, recovery, observation);
    const after = await read();
    expect(after.slice(0, stopped.length)).toEqual(stopped);
    expect(after.at(-1)?.payload).toMatchObject({ consumedRounds: 1, remainingRounds: 2,
      nextAction: 'correction', observation: { maxRounds: 2 } });
    await writeFile(join(root, 'response.json'), '{}');
    await expect(recordReviewWriterBindingLifecycle(root, ID, 'amendment-completed', responseInput)).rejects.toThrow('bytes changed');
    expect(after.filter(event => event.kind === 'specialist.completed')).toHaveLength(1);
    const targeted = { ...binding, reviewRound: 2, reviewSubject: observation.reviewSubject,
      reviewScope: { kind: 'targeted', findingIds: ['blocker'], affectedPaths: ['source.ts'] } };
    const targetResult = { ...completion, completionId: 'cmp_targeted_12345678', verdict: 'pass', findings: [],
      review: { ...completion.review, ...observation.reviewSubject, writerId: 'writer:primary', scope: targeted.reviewScope } };
    for (const [kind, payload] of [['requested', { ...targeted, runtime: 'codex', planHash: HASH }],
      ['started', { ...targeted, contextId }], ['completed', { ...targeted, contextId, completion: targetResult }]] as const) {
      await appendMissionEvent(root, ID, { source: kind === 'requested' ? 'void-harness:mission.dispatch' : 'runtime:codex',
        kind: `specialist.${kind}`, subject: specialist, correlationId: ID, payload });
    }
    await expect(collectNativeReview(root, await read(), observation.reviewSubject, 'writer:primary', 2))
      .rejects.toThrow('actual correction and fresh in-window proof');
  } finally { await rm(root, { recursive: true }); }
});
