import { createHash } from 'node:crypto';
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import { amendmentFor, canonicalJsonHash, type CanonicalEvent, type JsonValue,
  planReviewWriterBindingRequest, projectMissionLifecycle, reviewBindingField,
  validatedRecoveredReviewEvents, validatedReviewWriterBindingRequest,
  validatedReviewWriterBindingResponse } from '@voidcorp/mission-engine';
import { readBoundedProjectFile } from '../safe-read.js';
import { inspectMission } from './store.js';

export type ReviewAmendmentStatus = 'amendment-requested' | 'amendment-started' | 'amendment-completed';
function invalid(detail: string): never { throw Error(`REVIEW_WRITER_BINDING_INVALID: ${detail}`); }
function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !value.includes('\0');
}
async function payloadFor(
  artifactRoot: string, events: readonly CanonicalEvent[], status: ReviewAmendmentStatus, input: unknown,
): Promise<{ readonly payload: JsonValue; readonly requestEventId?: string }> {
  if (!object(input)) invalid('provide the exact amendment input');
  if (status === 'amendment-requested') {
    if (!exact(input, ['closureEventId', 'expectedJournalHash', 'completionEventId', 'completionHash'])
      || !text(input['closureEventId']) || !text(input['expectedJournalHash'])
      || !text(input['completionEventId']) || !text(input['completionHash'])) invalid('request fields are invalid');
    return { payload: { ...planReviewWriterBindingRequest(events, {
      closureEventId: input['closureEventId'], expectedJournalHash: input['expectedJournalHash'],
      completionEventId: input['completionEventId'], completionHash: input['completionHash'] }) } };
  }
  if (!exact(input, ['requestEventId', 'contextId', ...(status === 'amendment-completed' ? ['responseArtifact'] : [])])
    || !text(input['requestEventId']) || !text(input['contextId'])) invalid('invocation fields are invalid');
  const request = validatedReviewWriterBindingRequest(events, input['requestEventId']);
  const lifecycle = projectMissionLifecycle(events);
  if (!request || lifecycle.status !== 'closed' || lifecycle.closure.eventId !== request.envelope.closureEventId
    || input['contextId'] !== request.envelope.contextId) invalid('observe the original author in the active stopped episode');
  const common = { requestEventId: request.event.eventId, contextId: request.envelope.contextId };
  if (status === 'amendment-started') return { payload: common, requestEventId: request.event.eventId };
  const artifact = input['responseArtifact'];
  if (!object(artifact) || !exact(artifact, ['path', 'sha256'])
    || !text(artifact['path']) || !text(artifact['sha256'])) invalid('retain the actual returned response artifact');
  const loaded = await readBoundedProjectFile({ root: artifactRoot, inputPath: artifact['path'], maxBytes: 65536,
    pathEscapeMessage: 'REVIEW_WRITER_BINDING_INVALID: response artifact escapes project',
    invalidMessage: 'REVIEW_WRITER_BINDING_INVALID: response artifact must be bounded and stable' });
  if (`sha256:${createHash('sha256').update(loaded.body).digest('hex')}` !== artifact['sha256']) invalid('response artifact bytes changed');
  const started = events.filter(event => event.kind === 'specialist.review-amendment-started'
    && reviewBindingField(event, 'requestEventId') === request.event.eventId);
  if (started.length !== 1 || !started[0]) invalid('record the actual retained-author invocation first');
  const expected = { requestEventId: request.event.eventId, invocationEventId: started[0].eventId,
    amendment: { ...amendmentFor(request.envelope) } };
  let returned: unknown;
  try { returned = JSON.parse(loaded.body); } catch { invalid('response artifact is not JSON'); }
  if (canonicalJsonHash(returned) !== canonicalJsonHash(expected)) invalid('returned author amendment must preserve the exact original result');
  return { requestEventId: request.event.eventId, payload: { ...common, ...expected,
    responseArtifact: { path: artifact['path'], sha256: artifact['sha256'] } } };
}

/** Caller observes a real native invocation. Integrity checks cannot authenticate a malicious coordinator. */
export async function recordReviewWriterBindingLifecycle(
  root: string, missionId: string, status: ReviewAmendmentStatus, input: unknown, artifactRoot = root,
): Promise<{ readonly eventId: string; readonly recorded: boolean }> {
  const events = (await inspectMission(root, missionId, { dependencies: {} })).stream.events;
  const recovered = validatedRecoveredReviewEvents(events);
  if (!recovered.ok) invalid(recovered.reasons.join('; '));
  const eventId = `evt_${canonicalJsonHash({ missionId, status, input }).slice(7)}`;
  const existing = events.find(event => event.eventId === eventId);
  const prefix = existing ? events.slice(0, events.indexOf(existing)) : events;
  const prepared = await payloadFor(artifactRoot, prefix, status, input);
  const source = status === 'amendment-requested' ? 'void-harness:mission.recover'
    : `runtime:${String(reviewBindingField(events[0], 'runtime'))}`;
  const draft = { source, kind: `specialist.review-${status}`, subject: 'core:independent-code-reviewer',
    correlationId: missionId, ...(prepared.requestEventId === undefined ? {} : { causationId: prepared.requestEventId }),
    payload: prepared.payload };
  if (existing) {
    if (existing.source !== draft.source || existing.kind !== draft.kind || existing.subject !== draft.subject
      || existing.causationId !== draft.causationId || canonicalJsonHash(existing.payload) !== canonicalJsonHash(draft.payload)) {
      invalid('conflicting amendment retry');
    }
    return { eventId, recorded: false };
  }
  const candidate: CanonicalEvent = { ...draft, schemaVersion: 1, missionId, eventId,
    seq: events.length + 1, ts: new Date().toISOString() };
  if (status === 'amendment-completed' && !validatedReviewWriterBindingResponse([...events, candidate], eventId)) {
    invalid('returned author response lacks its original invocation chain');
  }
  if (events.some(event => event.kind === draft.kind
    && (status === 'amendment-requested' || reviewBindingField(event, 'requestEventId') === prepared.requestEventId))) {
    invalid('a different immutable amendment event already exists');
  }
  const written = await writeSequencedEventOnce({ root, missionId, eventId, draft, validate: async current => {
    if (canonicalJsonHash(current) !== canonicalJsonHash(events)) invalid('journal changed; observe the stopped episode again');
    await payloadFor(artifactRoot, current, status, input);
  } });
  return { eventId, recorded: written.appended };
}
