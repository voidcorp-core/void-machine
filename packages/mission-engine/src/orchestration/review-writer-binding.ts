import type { CanonicalEvent } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { parseSpecialistCompletionValue } from '../specialist/completion.js';
import { isReviewSubject, sameReviewSubject } from '../specialist/review-receipt.js';
import { projectMissionLifecycle } from './mission-lifecycle.js';

export interface ReviewWriterBindingRequest {
  readonly closureEventId: string;
  readonly expectedJournalHash: string;
  readonly completionEventId: string;
  readonly completionHash: string;
}
export interface ReviewWriterBindingAmendment {
  readonly completionEventId: string;
  readonly completionHash: string;
  readonly originalInvocationEventId: string;
  readonly contextId: string;
  readonly writerId: string;
}
export interface ReviewWriterBindingEnvelope extends ReviewWriterBindingRequest, ReviewWriterBindingAmendment {}
export function reviewBindingField(event: CanonicalEvent | undefined, key: string): unknown {
  const value = event?.payload;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
}
function refuse(): never {
  throw Error('REVIEW_WRITER_BINDING_INVALID: retain the active closure, original degraded review and actual author invocation');
}

/** This binds a coordinator-observed native response, not a cryptographic author identity. */
export function planReviewWriterBindingRequest(
  events: readonly CanonicalEvent[], request: ReviewWriterBindingRequest,
): ReviewWriterBindingEnvelope {
  const lifecycle = projectMissionLifecycle(events);
  const start = events[0];
  const original = events.find(event => event.eventId === request.completionEventId);
  const completion = parseSpecialistCompletionValue(reviewBindingField(original, 'completion'));
  const review = completion?.review;
  const writerId = reviewBindingField(start, 'leadWriterId');
  const originalSubject = reviewBindingField(original, 'reviewSubject');
  if (lifecycle.status !== 'closed' || lifecycle.closure.eventId !== request.closureEventId
    || reviewBindingField(lifecycle.closure, 'reason') !== 'controller-stop'
    || canonicalJsonHash(events) !== request.expectedJournalHash || !start || !original || !completion || !review
    || original.kind !== 'specialist.completed' || original.subject !== 'core:independent-code-reviewer'
    || completion.specialistId !== original.subject || completion.contractVersion !== reviewBindingField(original, 'contractVersion')
    || !isReviewSubject(originalSubject) || !sameReviewSubject(review, originalSubject)
    || canonicalJsonHash(review.scope) !== canonicalJsonHash(reviewBindingField(original, 'reviewScope'))
    || reviewBindingField(original, 'stage') !== 'post-implementation' || reviewBindingField(original, 'reviewRound') !== 1
    || original.source !== `runtime:${String(reviewBindingField(start, 'runtime'))}`
    || completion.verdict !== 'degraded' || review.scope.kind !== 'general' || review.resolutions.length !== 0
    || !completion.findings.some(finding => finding.classification === 'blocking')
    || completion.findings.some(finding => finding.classification === undefined)
    || canonicalJsonHash(completion) !== request.completionHash || typeof writerId !== 'string'
    || review.writerId === writerId || review.reviewerId === writerId || review.taskId !== original.missionId
    || review.provenance.kind !== 'native-context' || review.provenance.contextId !== reviewBindingField(original, 'contextId')
    || events.filter(event => event.kind === 'specialist.completed' && event.subject === original.subject
      && reviewBindingField(event, 'stage') === 'post-implementation').length !== 1
    || events.some(event => event.kind === 'specialist.review-amendment-requested')) refuse();
  const contextId = review.provenance.contextId;
  const sameDispatch = (event: CanonicalEvent) => event.subject === original.subject
    && ['stage', 'reviewRound', 'inputHash', 'contractVersion', 'reviewSubject', 'reviewScope'].every(key =>
      reviewBindingField(original, key) !== undefined
      && canonicalJsonHash(reviewBindingField(event, key)) === canonicalJsonHash(reviewBindingField(original, key)));
  const requested = events.filter(event => event.kind === 'specialist.requested' && sameDispatch(event)
    && event.seq < original.seq && event.source === 'void-harness:mission.dispatch'
    && reviewBindingField(event, 'planHash') === reviewBindingField(start, 'planHash')
    && reviewBindingField(event, 'runtime') === reviewBindingField(start, 'runtime'));
  const invoked = events.filter(event => event.kind === 'specialist.started' && sameDispatch(event)
    && event.source === original.source && reviewBindingField(event, 'contextId') === contextId
    && event.seq > (requested[0]?.seq ?? original.seq) && event.seq < original.seq);
  const invocation = invoked[0];
  if (requested.length !== 1 || invoked.length !== 1 || !invocation
    || [invocation, original].some(event => event.causationId !== undefined && event.causationId !== requested[0]?.eventId)
    || events.some(event => event.kind === 'specialist.failed' && sameDispatch(event)
      && event.seq > invocation.seq && event.seq < original.seq)) refuse();
  return { ...request, originalInvocationEventId: invocation.eventId, contextId, writerId };
}

export function amendmentFor(envelope: ReviewWriterBindingEnvelope): ReviewWriterBindingAmendment {
  return { completionEventId: envelope.completionEventId, completionHash: envelope.completionHash,
    originalInvocationEventId: envelope.originalInvocationEventId, contextId: envelope.contextId, writerId: envelope.writerId };
}

export function validatedReviewWriterBindingRequest(
  events: readonly CanonicalEvent[], requestEventId: string,
): { readonly event: CanonicalEvent; readonly envelope: ReviewWriterBindingEnvelope } | undefined {
  const index = events.findIndex(event => event.eventId === requestEventId);
  const event = events[index];
  if (!event || event.kind !== 'specialist.review-amendment-requested'
    || event.source !== 'void-harness:mission.recover' || event.subject !== 'core:independent-code-reviewer') return undefined;
  const closureEventId = reviewBindingField(event, 'closureEventId');
  const expectedJournalHash = reviewBindingField(event, 'expectedJournalHash');
  const completionEventId = reviewBindingField(event, 'completionEventId');
  const completionHash = reviewBindingField(event, 'completionHash');
  if (typeof closureEventId !== 'string' || typeof expectedJournalHash !== 'string'
    || typeof completionEventId !== 'string' || typeof completionHash !== 'string') return undefined;
  try {
    const envelope = planReviewWriterBindingRequest(events.slice(0, index), {
      closureEventId, expectedJournalHash, completionEventId, completionHash });
    return canonicalJsonHash(envelope) === canonicalJsonHash(event.payload) ? { event, envelope } : undefined;
  } catch { return undefined; }
}

export function validatedReviewWriterBindingResponse(events: readonly CanonicalEvent[], responseEventId: string) {
  const response = events.find(event => event.eventId === responseEventId);
  const requestId = reviewBindingField(response, 'requestEventId');
  const request = typeof requestId === 'string' ? validatedReviewWriterBindingRequest(events, requestId) : undefined;
  if (!request || !response || response.kind !== 'specialist.review-amendment-completed') return undefined;
  const lifecycle = projectMissionLifecycle(events);
  const starts = events.filter(event => event.kind === 'specialist.review-amendment-started'
    && reviewBindingField(event, 'requestEventId') === requestId);
  const started = starts[0];
  const source = `runtime:${String(reviewBindingField(events[0], 'runtime'))}`;
  const artifact = reviewBindingField(response, 'responseArtifact');
  if (lifecycle.status !== 'closed' || lifecycle.closure.eventId !== request.envelope.closureEventId
    || starts.length !== 1 || !started || started.seq <= request.event.seq || started.seq >= response.seq
    || [started, response].some(event => event.source !== source || event.subject !== request.event.subject
      || event.causationId !== requestId || reviewBindingField(event, 'contextId') !== request.envelope.contextId)
    || reviewBindingField(response, 'invocationEventId') !== started.eventId
    || canonicalJsonHash(started.payload) !== canonicalJsonHash({ requestEventId: requestId, contextId: request.envelope.contextId })
    || typeof response.payload !== 'object' || response.payload === null
    || Object.keys(response.payload).length !== 5
    || canonicalJsonHash(reviewBindingField(response, 'amendment')) !== canonicalJsonHash(amendmentFor(request.envelope))
    || typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)
    || !('path' in artifact) || typeof artifact.path !== 'string' || !artifact.path
    || artifact.path.length > 500 || artifact.path.includes('\0') || Object.keys(artifact).length !== 2
    || /^(?:[A-Za-z]:|[/\\])/.test(artifact.path) || artifact.path.replaceAll('\\', '/').split('/').includes('..')
    || !('sha256' in artifact) || typeof artifact.sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(artifact.sha256)
    || events.filter(event => event.kind === response.kind && reviewBindingField(event, 'requestEventId') === requestId).length !== 1) return undefined;
  const original = events.find(event => event.eventId === request.envelope.completionEventId);
  const completion = parseSpecialistCompletionValue(reviewBindingField(original, 'completion'));
  if (!completion?.review) return undefined;
  return { response, envelope: request.envelope, binding: { completionEventId: request.envelope.completionEventId,
    completionHash: request.envelope.completionHash, review: { ...completion.review, writerId: request.envelope.writerId } } };
}

/** Read only after recovery replay validation. Grants correction, never a passing verdict. */
export function writerBindingRecovery(events: readonly CanonicalEvent[]) {
  return events.find(event => {
    if (event.kind !== 'mission.recovered') return false;
    const request = reviewBindingField(event, 'request');
    if (typeof request !== 'object' || request === null || !('disposition' in request)) return false;
    const disposition = request.disposition;
    return typeof disposition === 'object' && disposition !== null && 'kind' in disposition
      && disposition.kind === 'review-writer-binding';
  });
}
