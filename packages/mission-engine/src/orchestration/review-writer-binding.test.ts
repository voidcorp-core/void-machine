import { expect, it } from 'vitest';
import { replayEventLog, serializeEvent } from '../events/index.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { event } from '../test/events.js';
import { planStoppedMissionRecovery, validatedRecoveredReviewEvents } from './mission-recovery.js';
import { planReviewWriterBindingRequest } from './review-writer-binding.js';
import { orchestrateMissionTeam } from './controller.js';
import { canContinueNativeReview, reconcileReviewFindings, validNativeReviewContinuation } from './review-loop.js';
import { parseSpecialistCompletionValue } from '../specialist/completion.js';
import { sealEvidence } from '../evidence/schema.js';
import { evidenceDraft } from '../test/evidence.js';

const hash = `sha256:${'a'.repeat(64)}`;
const subject = { taskId: event().missionId, baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40), acceptanceCriteriaHash: hash };
const reviewer = '/root/retained-reviewer';
const specialist = 'core:independent-code-reviewer';
const binding = { stage: 'post-implementation', reviewRound: 1, inputHash: hash, contractVersion: 1,
  reviewSubject: subject, reviewScope: { kind: 'general' } };
const completion = { schemaVersion: 1, specialistId: specialist, contractVersion: 1, completionId: 'cmp_original_12345678',
  verdict: 'degraded', findings: [{ id: 'finding-blocker', severity: 'high', classification: 'blocking',
    summary: 'Broken behavior', consequence: 'Users lose their work', criterion: 'Preserve work',
    resolutionCondition: 'A regression proves preservation', basis: 'initial-scope-defect',
    evidence: [{ path: 'source.ts', line: 1, detail: 'Observed failure' }],
    recommendation: 'Correct the behavior' }], evidenceRequests: [], limitations: ['Original degraded observation'],
  review: { ...subject, reviewerId: reviewer, writerId: '/root/native-writer', readOnly: true,
    scope: { kind: 'general' }, proofIds: ['historical-file.md'], resolutions: [],
    provenance: { kind: 'native-context', contextId: reviewer } } };
function fixture() {
  return [
    event({ kind: 'mission.started', source: 'void-harness:mission', subject: 'mission', payload: {
      title: 'Recover writer binding', mode: 'team', runtime: 'codex', runtimeAttested: true, planHash: hash,
      leadWriterId: 'writer:primary', reviewPolicy: 'bounded-corrections-v1' } }),
    event({ kind: 'lead-writer.completed', subject: 'writer:primary', source: 'writer:primary', payload: { actionKind: 'run-lead-writer', writerId: 'writer:primary', planHash: hash } }),
    event({ kind: 'specialist.requested', subject: specialist, source: 'void-harness:mission.dispatch', payload: { ...binding, runtime: 'codex', planHash: hash } }),
    event({ kind: 'specialist.started', subject: specialist, payload: { ...binding, contextId: reviewer } }),
    event({ kind: 'specialist.completed', subject: specialist, payload: { ...binding, contextId: reviewer, completion } }),
    event({ kind: 'mission.closed', subject: 'mission', source: 'void-harness:mission.dispatch', payload: { reason: 'controller-stop' } }),
  ].map((value, index) => ({ ...value, seq: index + 1, eventId: `evt_binding_${index + 1}0000000` }));
}
it('requires an actual retained-author response before admitting a writer-only amendment', () => {
  let events = fixture();
  const prior = planStoppedMissionRecovery({ stream: replayEventLog(events.map(serializeEvent).join('\n')),
    request: { schemaVersion: 1, closureEventId: events[5]!.eventId, expectedJournalHash: canonicalJsonHash(events),
      disposition: { kind: 'review-blocker', completionEventIds: [events[4]!.eventId], resolutionArtifact: { path: 'prior.md', sha256: hash } } },
    observation: { stage: 'post-implementation', reviewPolicy: 'bounded-corrections-v1', expectedSource: 'runtime:codex',
      maxRounds: 2, contractVersions: { [specialist]: 1 }, currentInputHashes: { [specialist]: hash },
      resolutionArtifact: { path: 'prior.md', sha256: hash } } });
  if (prior.kind !== 'recover') throw Error('Expected original ineffective blocker recovery');
  const priorEvent = event({ seq: 7, eventId: 'evt_prior_recovery_12345678', kind: 'mission.recovered',
    source: 'void-harness:mission.recover', subject: 'mission', payload: JSON.parse(JSON.stringify(prior.receipt)) });
  events = [...events, priorEvent, event({ seq: 8, eventId: 'evt_reclosure_12345678', kind: 'mission.closed',
    subject: 'mission', source: 'void-harness:mission.dispatch', payload: { reason: 'controller-stop', episodeId: priorEvent.eventId } })];
  const requested = planReviewWriterBindingRequest(events, { closureEventId: events.at(-1)!.eventId,
    expectedJournalHash: canonicalJsonHash(events), completionEventId: events[4]!.eventId,
    completionHash: canonicalJsonHash(completion) });
  expect(requested).toMatchObject({ writerId: 'writer:primary', originalInvocationEventId: events[3]!.eventId });
  const request = event({ seq: 9, eventId: 'evt_amend_request_12345678', kind: 'specialist.review-amendment-requested',
    subject: specialist, source: 'void-harness:mission.recover', payload: { ...requested } });
  const started = event({ seq: 10, eventId: 'evt_amend_started_12345678', kind: 'specialist.review-amendment-started',
    subject: specialist, causationId: request.eventId, payload: { requestEventId: request.eventId, contextId: reviewer } });
  const response = event({ seq: 11, eventId: 'evt_amend_response_12345678', kind: 'specialist.review-amendment-completed',
    subject: specialist, causationId: request.eventId, payload: { requestEventId: request.eventId, contextId: reviewer,
      invocationEventId: started.eventId, amendment: { completionEventId: events[4]!.eventId,
        completionHash: canonicalJsonHash(completion), originalInvocationEventId: events[3]!.eventId,
        contextId: reviewer, writerId: 'writer:primary' },
      responseArtifact: { path: 'returned-amendment.json', sha256: hash } } });
  const history = [...events, request, started, response];
  const input = { stream: replayEventLog(history.map(serializeEvent).join('\n')),
    request: { schemaVersion: 1 as const, closureEventId: events.at(-1)!.eventId,
      expectedJournalHash: canonicalJsonHash(history), disposition: { kind: 'review-writer-binding' as const, responseEventId: response.eventId } },
    observation: { stage: 'post-implementation' as const, reviewPolicy: 'bounded-corrections-v1' as const,
      reviewSubject: { ...subject, reviewedCommit: 'c'.repeat(40) }, expectedSource: 'runtime:codex' as const,
      maxRounds: 2, contractVersions: { [specialist]: 1 }, currentInputHashes: { [specialist]: `sha256:${'b'.repeat(64)}` } } };
  const decision = planStoppedMissionRecovery(input);
  expect(decision).toMatchObject({ kind: 'recover', receipt: { nextAction: 'correction', consumedRounds: 1, remainingRounds: 2 } });
  if (decision.kind !== 'recover') throw Error('Recovery expected');
  const recovered = event({ seq: 12, eventId: 'evt_recovery_12345678', kind: 'mission.recovered',
    source: 'void-harness:mission.recover', subject: 'mission', payload: JSON.parse(JSON.stringify(decision.receipt)) });
  const projected = validatedRecoveredReviewEvents([...history, recovered]);
  expect(projected.ok).toBe(true);
  if (projected.ok) expect(projected.events[4]?.payload).toMatchObject({ completion: {
    ...completion, review: { ...completion.review, writerId: 'writer:primary' } } });
  expect(events[4]?.payload).toMatchObject({ completion });
  const controllerInput = { plan: { planHash: hash, context: { status: 'complete' as const, issues: [] },
    specialists: [{ specialistId: specialist, contractVersion: 1, state: 'applicable' as const,
      stages: ['post-implementation' as const] }] },
    stream: replayEventLog([...history, recovered].map(serializeEvent).join('\n')),
    reviewSubject: input.observation.reviewSubject, evidenceContext: { dependencies: {} }, maxReviewRounds: 2,
    currentInputHashesByStage: { 'pre-implementation': {}, 'post-implementation': input.observation.currentInputHashes },
    specialistRuntime: { status: 'available' as const, limitations: [] } };
  const correctedDecision = orchestrateMissionTeam(controllerInput);
  expect(correctedDecision.action.kind, correctedDecision.reasons.join('; ')).toBe('run-correction');
  expect(orchestrateMissionTeam({ ...controllerInput, stream: input.stream }).action.kind).toBe('stop');
  const parsedCompletion = parseSpecialistCompletionValue(completion);
  if (!parsedCompletion || !projected.ok) throw Error('Expected validated fixture');
  const findingIds = reconcileReviewFindings([{ event: events[4]!, completion: parsedCompletion }], []).map(item => item.findingId);
  expect(correctedDecision.action).toMatchObject({ findingIds });
  const correction = event({ seq: 13, eventId: 'evt_correction_request_12345678', kind: 'lead-writer.requested',
    subject: 'writer:primary', source: 'void-harness:mission.dispatch', payload: { actionKind: 'run-correction',
      planHash: hash, writerId: 'writer:primary', implementationRound: 2, findingIds } });
  const corrected = event({ seq: 14, eventId: 'evt_writer_corrected_12345678', kind: 'lead-writer.completed',
    subject: 'writer:primary', source: 'writer:primary', causationId: correction.eventId,
    payload: { actionKind: 'run-correction', planHash: hash, writerId: 'writer:primary', implementationRound: 2,
      requestEventId: correction.eventId } });
  const targeted = event({ seq: 15, eventId: 'evt_targeted_request_12345678', kind: 'specialist.requested',
    subject: specialist, source: 'void-harness:mission.dispatch', payload: { ...binding, runtime: 'codex', planHash: hash,
      reviewRound: 2, reviewSubject: input.observation.reviewSubject,
      reviewScope: { kind: 'targeted', findingIds: ['finding-blocker'], affectedPaths: ['source.ts'] } } });
  const continuation = [...projected.events, correction, corrected, targeted];
  expect(canContinueNativeReview(continuation, targeted, reviewer)).toBe(true);
  // Historical fixture: preserve the defective empty request, deriving no replacement journal event.
  const empty = { ...correction, payload: { ...correction.payload as object, findingIds: [] } };
  const retainedEmpty = [...projected.events, empty, corrected, targeted];
  expect(canContinueNativeReview(retainedEmpty, targeted, reviewer)).toBe(true);
  expect(canContinueNativeReview(retainedEmpty, targeted, reviewer)).toBe(true);
  expect(empty.payload.findingIds).toEqual([]);
  for (const invalid of [
    [...projected.events, { ...empty, payload: { ...empty.payload, findingIds: ['fnd_unrelated'] } }, corrected, targeted],
    [...projected.events, empty, { ...corrected, causationId: 'evt_unrelated_12345678' }, targeted],
    [...projected.events, empty, { ...corrected, payload: { ...corrected.payload as object, planHash: 'wrong' } }, targeted],
    [...projected.events, empty, { ...empty, eventId: 'evt_extra_correction_12345678' }, corrected, targeted],
    [...projected.events.filter(item => item.eventId !== recovered.eventId), empty, corrected, targeted],
  ]) expect(canContinueNativeReview(invalid, targeted, reviewer)).toBe(false);
  const wrongScope = { ...targeted, payload: { ...targeted.payload as object,
    reviewScope: { kind: 'targeted', findingIds: ['other'], affectedPaths: ['source.ts'] } } };
  expect(canContinueNativeReview([...projected.events, empty, corrected, wrongScope], wrongScope, reviewer)).toBe(false);

  expect(canContinueNativeReview([...history, recovered, correction, corrected, targeted], targeted, reviewer)).toBe(false);
  expect(canContinueNativeReview(continuation, targeted, '/root/replacement-reviewer')).toBe(false);
  const proof = sealEvidence(evidenceDraft());
  const proofEvent = event({ seq: 15, eventId: 'evt_fresh_proof_12345678', kind: 'evidence.recorded',
    subject: proof.evidenceId, payload: { evidence: { ...proof } } });
  const targetedRequest = { ...targeted, seq: 16 };
  const targetedStarted = event({ seq: 17, eventId: 'evt_targeted_started_12345678', kind: 'specialist.started',
    subject: specialist, causationId: targeted.eventId, payload: { ...targeted.payload as object, contextId: reviewer } });
  const targetedCompletion = event({ seq: 18, eventId: 'evt_targeted_completed_12345678', kind: 'specialist.completed',
    subject: specialist, causationId: targeted.eventId, payload: { ...targeted.payload as object, contextId: reviewer,
      completion: { ...completion, completionId: 'cmp_targeted_12345678', verdict: 'pass', findings: [], limitations: [],
        review: { ...completion.review, ...input.observation.reviewSubject, writerId: 'writer:primary',
          scope: { kind: 'targeted', findingIds: ['finding-blocker'], affectedPaths: ['source.ts'] },
          proofIds: [proof.evidenceId], resolutions: [{ findingId: 'finding-blocker', status: 'resolved', proofIds: [proof.evidenceId] }] } } } });
  const freshHistory = [...projected.events, correction, corrected, proofEvent, targetedRequest, targetedStarted, targetedCompletion];
  expect(validNativeReviewContinuation(freshHistory, targetedCompletion)).toBe(true);
  expect(validNativeReviewContinuation(freshHistory.map(item => item === correction ? empty : item), targetedCompletion)).toBe(true);
  const staleProofHistory = [...projected.events, proofEvent, correction, corrected, targetedRequest, targetedStarted, targetedCompletion]
    .map((item, index) => ({ ...item, seq: index + 1 }));
  expect(validNativeReviewContinuation(staleProofHistory, staleProofHistory.at(-1)!)).toBe(false);
  const secondRequest = { ...targetedRequest, seq: 19, eventId: 'evt_second_target_12345678' };
  expect(canContinueNativeReview([...freshHistory, secondRequest], secondRequest, reviewer)).toBe(false);
  for (const changed of [history.slice(0, -1), history.filter(item => item !== started),
    history.map(item => item !== response ? item : { ...response, source: 'runtime:claude' })]) {
    const normalized = changed.map((item, index) => ({ ...item, seq: index + 1 }));
    expect(planStoppedMissionRecovery({ ...input, stream: replayEventLog(normalized.map(serializeEvent).join('\n')),
      request: { ...input.request, expectedJournalHash: canonicalJsonHash(normalized) } })).toMatchObject({
      kind: 'refused', code: 'invalid-writer-binding-amendment' });
  }
  expect(validatedRecoveredReviewEvents([...history, { ...recovered, payload: { ...JSON.parse(JSON.stringify(decision.receipt)),
    writerBinding: { ...decision.receipt.writerBinding, completionHash: hash } } }]).ok).toBe(false);
});

it.each(['pass', 'changes-requested', 'blocked'])('cannot amend an original %s verdict', verdict => {
  const events = fixture().map(item => item.kind !== 'specialist.completed' ? item : {
    ...item, payload: { ...binding, contextId: reviewer, completion: { ...completion, verdict } } });
  expect(() => planReviewWriterBindingRequest(events, { closureEventId: events.at(-1)!.eventId,
    expectedJournalHash: canonicalJsonHash(events), completionEventId: events[4]!.eventId,
    completionHash: canonicalJsonHash({ ...completion, verdict }) })).toThrow('REVIEW_WRITER_BINDING_INVALID');
});
