import type { CanonicalEvent } from '../events/types.js';
import type { Evidence, EvidenceContext } from '../evidence/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { assessEvidence } from '../evidence/invalidation.js';
import { validNativeContextId } from '../orchestration/review-loop.js';
import { parseSpecialistCompletionValue, type SpecialistCompletion } from './completion.js';

export type EvidenceDue = 'current-review' | 'post-implementation' | 'completion';
export interface EvidenceObligation {
  readonly obligationId: string;
  readonly completionEventId: string;
  readonly specialistId: string;
  readonly requestIndex: number;
  readonly requestText: string;
  readonly requestTextHash: string;
  readonly due: EvidenceDue;
  readonly discharged: boolean;
}
export interface EvidenceObligationInput {
  readonly events: readonly CanonicalEvent[];
  readonly expectedSource: 'runtime:codex' | 'runtime:claude';
  readonly phase: 'pre-implementation' | 'post-implementation' | 'completion';
  readonly evidenceContext: EvidenceContext;
  readonly proofs: readonly { readonly eventId: string; readonly evidence: Evidence }[];
}
export interface EvidenceObligationState {
  readonly obligations: readonly EvidenceObligation[];
  readonly blockingObligationIds: readonly string[];
  readonly issues: readonly { readonly eventId: string; readonly detail: string }[];
}

interface Origin {
  readonly event: CanonicalEvent;
  readonly hash: string;
  readonly completion: SpecialistCompletion;
}
interface Binding {
  readonly completionEventId: string;
  readonly completionHash: string;
  readonly specialistId: string;
  readonly nativeContextId: string;
  readonly requestId: string;
}
const CONTROLLER = 'void-harness:mission.dispatch';
const PREFIX = 'specialist.evidence-';

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= 1_000 && !value.includes('\0');
}
function binding(value: unknown): Binding | undefined {
  if (!record(value)) return undefined;
  const { completionEventId, completionHash, specialistId, nativeContextId, requestId } = value;
  if (!text(completionEventId) || !text(completionHash) || !text(specialistId)
    || !validNativeContextId(nativeContextId) || !text(requestId)) return undefined;
  return { completionEventId, completionHash, specialistId, nativeContextId, requestId };
}
function due(value: unknown): value is EvidenceDue {
  return value === 'current-review' || value === 'post-implementation' || value === 'completion';
}
function sameMission(left: CanonicalEvent, right: CanonicalEvent): boolean {
  return left.missionId === right.missionId && left.correlationId === right.correlationId
    && left.correlationId === left.missionId;
}
function contextUsed(event: CanonicalEvent, contextId: string): boolean {
  return record(event.payload) && (
    event.payload['nativeContextId'] === contextId || event.payload['contextId'] === contextId
  );
}
function authorizedRequest(
  request: CanonicalEvent, target: Binding, origin: Origin, events: readonly CanonicalEvent[],
): boolean {
  return request.source === CONTROLLER && request.subject === target.specialistId
    && target.specialistId === origin.completion.specialistId
    && target.completionHash === origin.hash && sameMission(request, origin.event)
    && request.seq > origin.event.seq
    && !events.some(event => event.seq < request.seq && (
      contextUsed(event, target.nativeContextId)
      || (record(event.payload) && event.payload['requestId'] === target.requestId)
    ));
}
function collectOrigins(input: EvidenceObligationInput): {
  origins: Map<string, Origin>; obligations: Map<string, EvidenceObligation>;
  issues: { eventId: string; detail: string }[];
} {
  const origins = new Map<string, Origin>();
  const obligations = new Map<string, EvidenceObligation>();
  const issues: { eventId: string; detail: string }[] = [];
  for (const event of input.events) {
    if (event.kind !== 'specialist.completed') continue;
    const raw = record(event.payload) ? event.payload['completion'] : undefined;
    const completion = parseSpecialistCompletionValue(raw);
    if (!completion || event.source !== input.expectedSource
      || event.subject !== completion.specialistId || origins.has(event.eventId)
      || (input.evidenceContext.missionId !== undefined
        && event.missionId !== input.evidenceContext.missionId)) {
      issues.push({ eventId: event.eventId, detail: 'Invalid original specialist completion.' });
      continue;
    }
    origins.set(event.eventId, { event, hash: canonicalJsonHash(raw), completion });
    completion.evidenceRequests.forEach((requestText, requestIndex) => {
      const requestTextHash = canonicalJsonHash(requestText);
      const obligationId = canonicalJsonHash({ completionEventId: event.eventId,
        completionId: completion.completionId, requestIndex, requestTextHash });
      obligations.set(obligationId, { obligationId, completionEventId: event.eventId,
        specialistId: completion.specialistId, requestIndex, requestText, requestTextHash,
        due: 'current-review', discharged: false });
    });
  }
  return { origins, obligations, issues };
}
function classify(
  items: unknown, obligations: readonly EvidenceObligation[],
): readonly EvidenceObligation[] | undefined {
  if (!Array.isArray(items) || items.length !== obligations.length) return undefined;
  const classified: EvidenceObligation[] = [];
  for (const obligation of obligations) {
    const matches = items.filter(item => record(item)
      && item['requestIndex'] === obligation.requestIndex);
    const item: unknown = matches[0];
    if (matches.length !== 1 || !record(item) || !due(item['due']) || !text(item['reason'])
      || item['requestText'] !== obligation.requestText
      || item['requestTextHash'] !== obligation.requestTextHash) return undefined;
    classified.push({ ...obligation, due: item['due'] });
  }
  return classified;
}
function proofStatus(
  eventId: string, response: CanonicalEvent, origin: Origin, input: EvidenceObligationInput,
): 'fresh' | 'stale' | 'invalid' {
  const events = input.events.filter(event => event.eventId === eventId);
  const observations = input.proofs.filter(proof => proof.eventId === eventId);
  const event = events[0];
  const proof = observations[0]?.evidence;
  if (events.length !== 1 || observations.length !== 1 || !event || !proof
    || event.kind !== 'evidence.recorded' || !sameMission(event, response)
    || event.seq <= origin.event.seq || event.seq >= response.seq
    || event.subject !== proof.evidenceId || proof.missionId !== event.missionId
    || !record(event.payload) || !record(event.payload['evidence'])
    || canonicalJsonHash(event.payload['evidence']) !== canonicalJsonHash(proof)
    || proof.status !== 'passed' || proof.exitCode !== 0 || proof.dependencies.length === 0) {
    return 'invalid';
  }
  const assessment = assessEvidence(proof, input.evidenceContext);
  if (assessment.status === 'tampered') return 'invalid';
  return proof.dependencies.some(dependency =>
    input.evidenceContext.dependencies[dependency.key] !== dependency.hash) ? 'stale' : 'fresh';
}
function discharge(
  request: CanonicalEvent, response: CanonicalEvent, origin: Origin,
  obligations: readonly EvidenceObligation[], input: EvidenceObligationInput,
): readonly EvidenceObligation[] | undefined {
  const ids: unknown = record(request.payload) ? request.payload['obligationIds'] : undefined;
  const items: unknown = record(response.payload) ? response.payload['items'] : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > obligations.length
    || !ids.every(text) || new Set(ids).size !== ids.length
    || !Array.isArray(items) || items.length !== ids.length) return undefined;
  const result: EvidenceObligation[] = [];
  for (const id of ids) {
    const obligation = obligations.find(value => value.obligationId === id);
    const matches = items.filter(item => record(item) && item['obligationId'] === id);
    const item: unknown = matches[0];
    if (!obligation || matches.length !== 1 || !record(item) || !text(item['reason'])
      || !Array.isArray(item['proofEventIds']) || item['proofEventIds'].length === 0
      || item['proofEventIds'].length > 16 || !item['proofEventIds'].every(text)
      || new Set(item['proofEventIds']).size !== item['proofEventIds'].length) {
      return undefined;
    }
    const statuses = item['proofEventIds'].map(id => proofStatus(id, response, origin, input));
    if (statuses.includes('invalid')) return undefined;
    result.push({ ...obligation, discharged: statuses.every(status => status === 'fresh') });
  }
  return result;
}
function responseRequest(
  response: CanonicalEvent, input: EvidenceObligationInput, origins: ReadonlyMap<string, Origin>,
): { request: CanonicalEvent; origin: Origin } | undefined {
  const target = binding(response.payload);
  const origin = target ? origins.get(target.completionEventId) : undefined;
  const requests = input.events.filter(event => event.eventId === response.causationId);
  const request = requests[0];
  const expectedKind = response.kind === `${PREFIX}classified`
    ? `${PREFIX}classification-requested` : `${PREFIX}discharge-requested`;
  if (!target || !origin || requests.length !== 1 || !request
    || request.kind !== expectedKind || response.source !== input.expectedSource
    || response.subject !== target.specialistId || response.seq <= request.seq
    || !sameMission(response, request)
    || canonicalJsonHash(binding(request.payload) ?? {}) !== canonicalJsonHash(target)
    || !authorizedRequest(request, target, origin, input.events)) return undefined;
  return { request, origin };
}

/** Preserve original requests and admit only author-bound, controller-requested dispositions. */
export function reduceEvidenceObligations(input: EvidenceObligationInput): EvidenceObligationState {
  const { origins, obligations, issues } = collectOrigins(input);
  const answered = new Set<string>();
  const classified = new Set<string>();
  for (const event of [...input.events].sort((left, right) => left.seq - right.seq)) {
    if (event.kind !== `${PREFIX}classified` && event.kind !== `${PREFIX}discharged`) continue;
    const authorization = responseRequest(event, input, origins);
    if (!authorization || answered.has(authorization.request.eventId)) {
      issues.push({ eventId: event.eventId,
        detail: 'Evidence disposition needs one fresh author context and its exact controller request.' });
      continue;
    }
    const { request, origin } = authorization;
    answered.add(request.eventId);
    const owned = [...obligations.values()].filter(value =>
      value.completionEventId === origin.event.eventId);
    const isClassification = event.kind === `${PREFIX}classified`;
    const updated = isClassification
      ? (classified.has(origin.event.eventId) ? undefined
        : classify(record(event.payload) ? event.payload['items'] : undefined, owned))
      : discharge(request, event, origin, owned, input);
    if (!updated) {
      issues.push({ eventId: event.eventId, detail: isClassification
        ? 'Classify every original request exactly once with unchanged text/hash and a reason.'
        : 'Discharge exact obligation IDs with fresh successful canonical proofs and author reasons.' });
      continue;
    }
    if (isClassification) classified.add(origin.event.eventId);
    for (const obligation of updated) obligations.set(obligation.obligationId, obligation);
  }
  const all = [...obligations.values()];
  return { obligations: all, issues, blockingObligationIds: all.filter(value => !value.discharged
    && (value.due === 'current-review' || input.phase === 'completion'
      || (value.due === 'post-implementation' && input.phase === 'post-implementation')))
    .map(value => value.obligationId) };
}
