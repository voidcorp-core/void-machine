import { createHash } from 'node:crypto';
import { writeSequencedEventOnce } from '@voidcorp/hook-runner';
import {
  canonicalJsonHash, parseEvidence, parseSpecialistCompletionValue, reduceEvidenceObligations,
  validNativeContextId,
  type CanonicalEvent, type EventDraft, type JsonValue,
} from '@voidcorp/mission-engine';
import type { ProjectRoots } from '../project-roots.js';
import { inspectMission } from './store.js';
import { computeProjectState } from './project-state.js';
import { requireOpenMission } from './mission-lifecycle.js';

export type SpecialistEvidenceRequest = {
  readonly operation: 'classification' | 'discharge';
  readonly completionEventId: string;
  readonly contextId: string;
  readonly obligationIds?: readonly string[];
};
export interface SpecialistEvidenceResponse {
  readonly requestEventId: string;
  readonly contextId: string;
  readonly items?: readonly JsonValue[];
}
function record(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function field(value: JsonValue, key: string): JsonValue | undefined {
  return record(value) ? value[key] : undefined;
}
function invalid(detail: string): never {
  throw new Error(`SPECIALIST_EVIDENCE_INVALID: ${detail}`);
}
function identity(events: readonly CanonicalEvent[]): 'runtime:codex' | 'runtime:claude' {
  const start = events.find(event => event.kind === 'mission.started');
  const runtime = start ? field(start.payload, 'runtime') : undefined;
  if (!start || field(start.payload, 'runtimeAttested') !== true
    || (runtime !== 'codex' && runtime !== 'claude')) invalid('native mission runtime is not attested');
  return runtime === 'codex' ? 'runtime:codex' : 'runtime:claude';
}
function freshContext(events: readonly CanonicalEvent[], contextId: string): void {
  if (!validNativeContextId(contextId)
    || events.some(event => field(event.payload, 'contextId') === contextId
      || field(event.payload, 'nativeContextId') === contextId)) invalid('provide a fresh native author context');
}
function eventId(value: unknown): string {
  return `evt_${createHash('sha256').update(canonicalJsonHash(value)).digest('hex')}`;
}
function obligationState(events: readonly CanonicalEvent[], expectedSource: 'runtime:codex' | 'runtime:claude') {
  return reduceEvidenceObligations({ events, expectedSource, phase: 'pre-implementation',
    evidenceContext: { dependencies: {} }, proofs: [] });
}
export async function requestSpecialistEvidence(
  roots: ProjectRoots, missionId: string, input: SpecialistEvidenceRequest,
): Promise<CanonicalEvent> {
  const inspected = await inspectMission(roots.installRoot, missionId, { dependencies: {} });
  const events = inspected.stream.events;
  requireOpenMission(events);
  const source = identity(events);
  const original = events.find(event => event.eventId === input.completionEventId);
  const completion = original ? parseSpecialistCompletionValue(field(original.payload, 'completion')) : undefined;
  if (!original || original.kind !== 'specialist.completed' || !completion
    || original.source !== source || original.subject !== completion.specialistId
    || completion.evidenceRequests.length === 0) invalid('original author completion with evidence requests is required');
  const requestId = eventId({ missionId, ...input, completionHash: canonicalJsonHash(field(original.payload, 'completion')) });
  const existing = events.find(event => event.eventId === requestId);
  if (existing) return existing;
  freshContext(events, input.contextId);
  const ids = input.obligationIds;
  if (input.operation === 'discharge') {
    const owned = obligationState(events, source).obligations.filter(value => value.completionEventId === original.eventId);
    if (!ids || ids.length === 0 || ids.length > owned.length || new Set(ids).size !== ids.length
      || ids.some(id => !owned.some(value => value.obligationId === id))) invalid('discharge needs exact original obligation IDs');
  } else if (ids !== undefined) invalid('classification does not accept discharge IDs');
  const draft: EventDraft = { source: 'void-harness:mission.dispatch',
    kind: `specialist.evidence-${input.operation}-requested`, subject: completion.specialistId,
    correlationId: missionId, payload: { completionEventId: original.eventId,
      completionHash: canonicalJsonHash(field(original.payload, 'completion')),
      specialistId: completion.specialistId, nativeContextId: input.contextId, requestId,
      ...(ids === undefined ? {} : { obligationIds: ids }) } };
  const result = await writeSequencedEventOnce({ root: roots.installRoot, missionId,
    eventId: requestId, draft, validate: current => {
      requireOpenMission(current);
      freshContext(current, input.contextId);
      if (canonicalJsonHash(current) !== canonicalJsonHash(events)) invalid('journal changed; re-observe before requesting clarification');
    } });
  return result.event;
}
function exactRequest(events: readonly CanonicalEvent[], input: SpecialistEvidenceResponse): CanonicalEvent {
  const request = events.find(event => event.eventId === input.requestEventId);
  if (!request || request.source !== 'void-harness:mission.dispatch'
    || !['specialist.evidence-classification-requested', 'specialist.evidence-discharge-requested'].includes(request.kind)
    || field(request.payload, 'nativeContextId') !== input.contextId || !record(request.payload)) {
    invalid('response must match its controller request and native context');
  }
  return request;
}
async function validateCompletion(
  events: readonly CanonicalEvent[], candidate: CanonicalEvent, roots: ProjectRoots,
  expectedSource: 'runtime:codex' | 'runtime:claude',
): Promise<void> {
  const proofs = events.flatMap(event => {
    if (event.kind !== 'evidence.recorded') return [];
    const parsed = parseEvidence(field(event.payload, 'evidence'));
    return parsed.ok ? [{ eventId: event.eventId, evidence: parsed.value }] : [];
  });
  const discharge = candidate.kind === 'specialist.evidence-discharged';
  const dependencies: Readonly<Record<string, string>> = discharge && proofs.length > 0
    ? { 'git:working-tree': (await computeProjectState(roots.workRoot)).diffHash } : {};
  const state = reduceEvidenceObligations({ events: [...events, candidate], expectedSource,
    phase: 'pre-implementation', evidenceContext: { missionId: candidate.missionId, dependencies }, proofs });
  if (state.issues.length > 0) invalid(state.issues.map(value => value.detail).join('; '));
  if (discharge) {
    const items = field(candidate.payload, 'items');
    if (!Array.isArray(items) || items.some(item => !record(item)
      || !state.obligations.some(value => value.obligationId === item['obligationId'] && value.discharged))) {
      invalid('requested obligations need fresh successful canonical proofs');
    }
  }
}
export async function recordSpecialistEvidence(
  roots: ProjectRoots, missionId: string, status: 'started' | 'completed',
  input: SpecialistEvidenceResponse,
): Promise<void> {
  const events = (await inspectMission(roots.installRoot, missionId, { dependencies: {} })).stream.events;
  requireOpenMission(events);
  const source = identity(events);
  const request = exactRequest(events, input);
  const kind = status === 'started' ? 'specialist.evidence-started'
    : request.kind === 'specialist.evidence-classification-requested'
      ? 'specialist.evidence-classified' : 'specialist.evidence-discharged';
  if (!record(request.payload)) invalid('malformed controller request');
  if (status === 'started' && input.items !== undefined) invalid('started receipt cannot supply a verdict');
  const { obligationIds: _ids, ...binding } = request.payload;
  const draft: EventDraft = { source, kind, subject: request.subject, correlationId: missionId,
    causationId: request.eventId, payload: { ...binding, ...(status === 'completed' ? { items: input.items ?? [] } : {}) } };
  const id = eventId({ missionId, requestEventId: request.eventId, status });
  const existing = events.find(event => event.eventId === id);
  if (existing && canonicalJsonHash(existing.payload) !== canonicalJsonHash(draft.payload)) invalid('conflicting existing author response');
  await writeSequencedEventOnce({ root: roots.installRoot, missionId, eventId: id, draft,
    validate: async current => {
      requireOpenMission(current);
      exactRequest(current, input);
      if (status === 'completed') {
        const started = current.find(event => event.kind === 'specialist.evidence-started'
          && event.source === source && event.subject === request.subject
          && event.causationId === request.eventId
          && field(event.payload, 'nativeContextId') === input.contextId);
        if (!started) invalid('author response needs its observed native started receipt');
        await validateCompletion(current, { schemaVersion: 1, seq: current.length + 1,
          eventId: id, missionId, ts: new Date().toISOString(), ...draft }, roots, source);
      }
    } });
}

function exact(value: Readonly<Record<string, JsonValue>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^evt_[A-Za-z0-9_-]{8,100}$/.test(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_000 && !value.includes('\0');
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}
export function parseSpecialistEvidenceRequest(value: unknown): SpecialistEvidenceRequest {
  if (!record(value) || !identifier(value['completionEventId']) || !validNativeContextId(value['contextId'])
    || (value['operation'] !== 'classification' && value['operation'] !== 'discharge')) invalid('malformed evidence request');
  const base = { completionEventId: value['completionEventId'], contextId: value['contextId'] };
  if (value['operation'] === 'classification') {
    if (!exact(value, ['operation', 'completionEventId', 'contextId'])) invalid('unexpected classification request fields');
    return { ...base, operation: 'classification' };
  }
  const ids = value['obligationIds'];
  if (!exact(value, ['operation', 'completionEventId', 'contextId', 'obligationIds'])
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 16 || !ids.every(hash)
    || new Set(ids).size !== ids.length) invalid('provide exact unique discharge obligation IDs');
  return { ...base, operation: 'discharge', obligationIds: ids };
}
function responseItem(value: unknown): JsonValue {
  if (!record(value) || !text(value['reason'])) invalid('an author reason is required for each disposition');
  if ('requestIndex' in value) {
    const due = value['due'];
    if (!exact(value, ['requestIndex', 'requestText', 'requestTextHash', 'due', 'reason'])
      || typeof value['requestIndex'] !== 'number' || !Number.isSafeInteger(value['requestIndex'])
      || value['requestIndex'] < 0 || value['requestIndex'] > 15 || !text(value['requestText'])
      || !hash(value['requestTextHash'])
      || (due !== 'current-review' && due !== 'post-implementation' && due !== 'completion')) {
      invalid('classification must bind the indexed original request and an explicit due phase');
    }
    return { requestIndex: value['requestIndex'], requestText: value['requestText'],
      requestTextHash: value['requestTextHash'], due, reason: value['reason'] };
  }
  const ids = value['proofEventIds'];
  if (!exact(value, ['obligationId', 'proofEventIds', 'reason']) || !hash(value['obligationId'])
    || !Array.isArray(ids) || ids.length < 1 || ids.length > 16 || !ids.every(identifier)
    || new Set(ids).size !== ids.length) invalid('discharge requires exact obligation and canonical proof IDs');
  return { obligationId: value['obligationId'], proofEventIds: ids, reason: value['reason'] };
}
export function parseSpecialistEvidenceResponse(
  status: 'started' | 'completed', value: unknown,
): SpecialistEvidenceResponse {
  if (!record(value) || !identifier(value['requestEventId']) || !validNativeContextId(value['contextId'])
    || !exact(value, ['requestEventId', 'contextId', ...(status === 'completed' ? ['items'] : [])])) {
    invalid('response fields must match the requested native context and lifecycle status');
  }
  const base = { requestEventId: value['requestEventId'], contextId: value['contextId'] };
  if (status === 'started') return base;
  const items = value['items'];
  if (!Array.isArray(items) || items.length < 1 || items.length > 16) invalid('completed response needs bounded disposition items');
  return { ...base, items: items.map(responseItem) };
}
