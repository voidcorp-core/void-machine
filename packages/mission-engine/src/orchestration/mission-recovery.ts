import { parseEvidence } from '../evidence/schema.js';
import { reduceEvidenceObligations } from '../specialist/evidence-obligations.js';
import { validatedSpecialistContractMigrationBoundary } from './specialist-contract-migration.js';
import { initialEventStream, reduceEventStream, type EventStreamState } from '../events/reducer.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJson, canonicalJsonHash } from '../evidence/canonical-json.js';
import { parseSpecialistCompletionValue, type SpecialistCompletion } from '../specialist/completion.js';
import type { SpecialistInvocationStage, SpecialistId } from '../specialist/routing.js';
import { projectMissionLifecycle } from './mission-lifecycle.js';
import { reduceReviewLoop } from './review-loop.js';

export interface RecoveryResolutionArtifact {
  readonly path: string;
  readonly sha256: string;
}
export interface MissionRecoveryRequest {
  readonly schemaVersion: 1;
  readonly closureEventId: string;
  readonly expectedJournalHash: string;
  readonly disposition:
    | { readonly kind: 'controller-defect'; readonly defect: 'partial-fanout-round' | 'stale-input-dispatch' }
    | { readonly kind: 'review-blocker'; readonly completionEventIds: readonly string[];
        readonly resolutionArtifact: RecoveryResolutionArtifact };
}
export interface MissionRecoveryObservation {
  readonly stage: SpecialistInvocationStage;
  readonly contractVersions: Readonly<Record<string, number>>;
  readonly resolutionArtifact?: RecoveryResolutionArtifact;
  readonly evidenceDependencies?: Readonly<Record<string, string>>;
  readonly currentInputHashes: Readonly<Record<string, string>>;
  readonly maxRounds: number;
  readonly expectedSource: 'runtime:codex' | 'runtime:claude';
}
export interface MissionRecoveryInput {
  readonly stream: EventStreamState;
  readonly request: MissionRecoveryRequest;
  readonly observation: MissionRecoveryObservation;
}
export interface RecoveryRoundCorrection {
  readonly eventId: string;
  readonly fromRound: number;
  readonly toRound: number;
}
export interface MissionRecoveryReceipt {
  readonly schemaVersion: 1;
  readonly closureEventId: string;
  readonly previousEpisodeId: string;
  readonly priorJournalHash: string;
  readonly priorJournalLastSeq: number;
  readonly requestHash: string;
  readonly request: MissionRecoveryRequest;
  readonly observation: MissionRecoveryObservation;
  readonly preservedCompletionEventIds: readonly string[];
  readonly invalidatedCompletionEventIds: readonly string[];
  readonly inadmissibleCompletionEventIds: readonly string[];
  readonly roundCorrections: readonly RecoveryRoundCorrection[];
  readonly consumedRounds: number;
  readonly remainingRounds: number;
  readonly nextAction: 'correction' | 'clarification';
}
export type MissionRecoveryDecision =
  | { readonly kind: 'refused'; readonly code: string; readonly reasons: readonly string[] }
  | { readonly kind: 'recover'; readonly receipt: MissionRecoveryReceipt }
  | { readonly kind: 'already-recovered'; readonly receipt: MissionRecoveryReceipt; readonly recoveryEventId: string };

function record(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function field(event: CanonicalEvent, key: string): JsonValue | undefined {
  return record(event.payload) ? event.payload[key] : undefined;
}
function refuse(code: string, reason: string): MissionRecoveryDecision {
  return { kind: 'refused', code, reasons: [reason] };
}
interface Completion {
  readonly event: CanonicalEvent;
  readonly completion: SpecialistCompletion;
}
function completions(events: readonly CanonicalEvent[]): readonly Completion[] {
  return events.flatMap((event) => {
    if (event.kind !== 'specialist.completed') return [];
    const completion = parseSpecialistCompletionValue(field(event, 'completion'));
    return completion === undefined ? [] : [{ event, completion }];
  });
}
function matchesRequest(completion: CanonicalEvent, request: CanonicalEvent): boolean {
  return request.kind === 'specialist.requested'
    && request.source === 'void-harness:mission.dispatch'
    && completion.subject === request.subject
    && ['stage', 'reviewRound', 'inputHash'].every((key) => field(completion, key) === field(request, key));
}

/** Only the observed initial preparation fanout defect is eligible for a round correction. */
function partialFanoutCorrections(events: readonly CanonicalEvent[]): readonly RecoveryRoundCorrection[] {
  if (events.some((event) => event.kind === 'lead-writer.completed' || event.kind === 'specialist.failed')) return [];
  const corrections: RecoveryRoundCorrection[] = [];
  for (const item of completions(events)) {
    const current = item.event;
    if (field(current, 'stage') !== 'pre-implementation' || field(current, 'reviewRound') !== 2) continue;
    const requested = events.find((candidate) => candidate.seq < current.seq && matchesRequest(current, candidate));
    if (requested === undefined) continue;
    const initial = events.find((candidate) => candidate.seq < requested.seq
      && candidate.kind === 'specialist.requested' && candidate.source === 'void-harness:mission.dispatch'
      && candidate.subject === current.subject && field(candidate, 'reviewRound') === 1
      && ['inputHash', 'stage', 'contractVersion', 'runtime', 'planHash'].every((key) =>
        field(candidate, key) === field(requested, key)));
    const priorAttempt = events.some((candidate) => candidate.seq < requested.seq
      && candidate.subject === current.subject
      && ['specialist.started', 'specialist.completed', 'specialist.failed'].includes(candidate.kind));
    const partial = events.some((candidate) => candidate.seq < requested.seq
      && candidate.kind === 'specialist.completed' && candidate.subject !== current.subject
      && field(candidate, 'stage') === 'pre-implementation' && field(candidate, 'reviewRound') === 1
      && field(candidate, 'inputHash') === field(current, 'inputHash'));
    if (initial !== undefined && !priorAttempt && partial
      && field(requested, 'contractVersion') === item.completion.contractVersion
      && `runtime:${String(field(requested, 'runtime'))}` === current.source) {
      corrections.push({ eventId: current.eventId, fromRound: 2, toRound: 1 });
    }
  }
  return corrections;
}
function applyRoundCorrections(events: readonly CanonicalEvent[], corrections: readonly RecoveryRoundCorrection[]): readonly CanonicalEvent[] {
  return events.map((event) => {
    const corrected = corrections.find((item) => {
      const completion = events.find((candidate) => candidate.eventId === item.eventId);
      return completion !== undefined && event.seq <= completion.seq
        && event.subject === completion.subject
        && ['specialist.requested', 'specialist.started', 'specialist.completed'].includes(event.kind)
        && ['stage', 'reviewRound', 'inputHash'].every((key) => field(event, key) === field(completion, key));
    });
    return corrected === undefined || !record(event.payload) ? event
      : { ...event, payload: { ...event.payload, reviewRound: corrected.toRound } };
  });
}
export function ambiguousEffects(events: readonly CanonicalEvent[]): boolean {
  return events.some((started) => {
    if (started.kind === 'lead-writer.requested') {
      return !events.some((completed) => completed.kind === 'lead-writer.completed'
        && completed.seq > started.seq && field(completed, 'requestEventId') === started.eventId
        && completed.subject === started.subject);
    }
    if (started.kind !== 'orchestration.node-started') return false;
    const definition = events.find((event) => event.kind === 'orchestration.node-defined'
      && event.subject === started.subject && event.seq < started.seq);
    if (definition === undefined) return true;
    const effectKey = field(definition, 'sideEffectKey');
    if (typeof effectKey === 'string') {
      return !events.some((event) => event.kind === 'side-effect.completed' && event.seq > started.seq
        && event.subject === effectKey && field(event, 'nodeId') === started.subject
        && field(event, 'inputHash') === field(definition, 'inputHash')
        && typeof field(event, 'receiptId') === 'string');
    }
    return !events.some((event) => event.seq > started.seq && event.subject === started.subject
      && ['orchestration.node-completed', 'orchestration.node-failed'].includes(event.kind));
  });
}
function staleDispatchCompletions(events: readonly CanonicalEvent[]): readonly string[] {
  return completions(events).filter(({ event: current }) => {
    if (field(current, 'stage') !== 'post-implementation' || field(current, 'reviewRound') !== 2) return false;
    const requested = events.find((item) => item.seq < current.seq && matchesRequest(current, item));
    if (requested === undefined) return false;
    const initial = events.find((item) => item.seq < requested.seq
      && item.kind === 'specialist.requested' && item.source === 'void-harness:mission.dispatch'
      && item.subject === current.subject && field(item, 'stage') === 'post-implementation'
      && field(item, 'reviewRound') === 1 && field(item, 'inputHash') !== field(current, 'inputHash')
      && ['contractVersion', 'runtime', 'planHash'].every((key) => field(item, key) === field(requested, key)));
    if (initial === undefined) return false;
    return !events.some((item) => item.seq > initial.seq && item.seq < requested.seq
      && (item.kind === 'lead-writer.completed' || item.kind === 'specialist.failed'))
      && events.some((item) => item.kind === 'specialist.completed' && item.seq < requested.seq
        && field(item, 'stage') === 'post-implementation' && field(item, 'reviewRound') === 1);
  }).map((item) => item.event.eventId);
}
function specialistId(value: string): value is SpecialistId {
  return /^core:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function admitStoppedMission(input: MissionRecoveryInput, projectedHistory = input.stream.events): MissionRecoveryDecision {
  const { stream, request, observation } = input;
  const events = stream.events;
  if (stream.continuity !== 'complete' || stream.duplicateEventIds > 0 || stream.invalidLines > 0) {
    return refuse('invalid-journal', 'Restore a complete unambiguous original journal before recovery');
  }
  const lifecycle = projectMissionLifecycle(events);
  if (lifecycle.status !== 'closed' || field(lifecycle.closure, 'reason') !== 'controller-stop') {
    return refuse('unsupported-closure', 'Only the active controller-stop closure admits explicit recovery');
  }
  if (lifecycle.closure.eventId !== request.closureEventId) {
    return refuse('stale-closure', 'Read the current closure and prepare a new recovery request');
  }
  const journalHash = canonicalJsonHash(events);
  if (request.expectedJournalHash !== journalHash) return refuse('stale-journal', 'Re-observe the journal before requesting recovery');
  if (ambiguousEffects(events)) return refuse('ambiguous-effect', 'Reconcile the unfinished external effect; recovery cannot replay it');
  const previousRecovery = events.filter((event) => event.kind === 'mission.recovered').at(-1);
  if (previousRecovery !== undefined && !events.some((event) => event.seq > previousRecovery.seq
    && event.kind === 'lead-writer.completed')) {
    return refuse('no-recovery-progress', 'Record actual corrective progress before reopening another stopped episode');
  }
  const existing = completions(events).filter((item) => field(item.event, 'stage') === observation.stage);
  const roundCorrections = partialFanoutCorrections(projectedHistory);
  const inadmissible = staleDispatchCompletions(projectedHistory);
  const disposition = request.disposition;
  if (disposition.kind === 'controller-defect' && (disposition.defect === 'partial-fanout-round'
    ? roundCorrections.length === 0 : inadmissible.length === 0)) {
    return refuse('unproven-controller-defect', 'The journal must prove the requested controller defect; do not reset its budget');
  }
  if (disposition.kind === 'review-blocker') {
    let eligible = existing;
    if (observation.stage === 'post-implementation' && disposition.completionEventIds.some(id =>
      !existing.some(item => item.event.eventId === id))) {
      const proofs = events.flatMap(event => {
        if (event.kind !== 'evidence.recorded') return [];
        const parsed = parseEvidence(field(event, 'evidence'));
        return parsed.ok ? [{ eventId: event.eventId, evidence: parsed.value }] : [];
      });
      const obligations = reduceEvidenceObligations({ events, expectedSource: observation.expectedSource,
        phase: observation.stage, proofs, evidenceContext: {
          missionId: events[0]!.missionId, dependencies: observation.evidenceDependencies ?? {},
        } });
      if (obligations.issues.length > 0) return refuse('invalid-evidence', 'Resolve invalid author dispositions before requesting recovery');
      const blocking = new Set(obligations.blockingObligationIds);
      const owners = new Set(obligations.obligations.filter(item => blocking.has(item.obligationId))
        .map(item => item.completionEventId));
      eligible = [...existing, ...completions(events).filter(item =>
        field(item.event, 'stage') === 'pre-implementation' && owners.has(item.event.eventId)
        && observation.contractVersions[item.event.subject] !== undefined)];
    }
    const blockers = eligible.filter(({ event, completion }) => disposition.completionEventIds.includes(event.eventId)
      && (completion.verdict !== 'pass' || completion.findings.length > 0
        || completion.evidenceRequests.length > 0 || completion.limitations.length > 0));
    if (blockers.length !== disposition.completionEventIds.length || blockers.length === 0
      || new Set(disposition.completionEventIds).size !== blockers.length) {
      return refuse('missing-review-blocker', 'Name existing unresolved review completions before requesting clarification');
    }
    if (observation.resolutionArtifact?.path !== disposition.resolutionArtifact.path
      || observation.resolutionArtifact.sha256 !== disposition.resolutionArtifact.sha256) {
      return refuse('stale-resolution-artifact', 'Read and hash the resolution artifact again before recovery');
    }
  }
  const projected = applyRoundCorrections(projectedHistory, roundCorrections)
    .filter((event) => !inadmissible.includes(event.eventId));
  const required = Object.keys(observation.contractVersions).filter(specialistId);
  const writers = projected.filter((event) => event.kind === 'lead-writer.completed');
  const stageStart = observation.stage === 'post-implementation'
    ? writers.find((event) => field(event, 'actionKind') !== 'run-preparation-correction')?.seq
    : undefined;
  const lastWriter = observation.stage === 'post-implementation' ? writers.at(-1)?.seq : undefined;
  const migration = validatedSpecialistContractMigrationBoundary(events);
  if (!migration.ok) return refuse('invalid-migration-receipt', migration.reasons.join('; '));
  const boundary = observation.stage === 'post-implementation' ? migration.migration : undefined;
  if (boundary !== undefined && observation.contractVersions[boundary.receipt.specialistId] !== boundary.receipt.toVersion) {
    return refuse('inconsistent-review', 'Recovery must observe the authenticated effective specialist contract');
  }
  const reviewInput = { stage: observation.stage, expectedSource: observation.expectedSource,
    ...(boundary === undefined ? {} : { contractMigration: {
      specialistId: boundary.receipt.specialistId, afterSeq: boundary.seq,
      reviewRound: boundary.receipt.reviewRound,
    } }),
    ...(stageStart === undefined ? {} : { stageStartSeqExclusive: stageStart }),
    ...(lastWriter === undefined ? {} : { afterSeqExclusive: lastWriter }),
    requiredSpecialists: required, contractVersions: observation.contractVersions,
    currentInputHashes: observation.currentInputHashes, maxRounds: observation.maxRounds };
  const originalReview = reduceReviewLoop({ ...reviewInput, events: projectedHistory });
  if (originalReview.issues.some((issue) => issue.code !== 'wrong-review-round')) {
    return refuse('inconsistent-review', 'Resolve inconsistent source, contract or context evidence before recovery');
  }
  const review = reduceReviewLoop({ ...reviewInput, events: projected });
  if (review.issues.length > 0) {
    return refuse('inconsistent-review', 'Resolve inconsistent source, contract, context or round evidence before recovery');
  }
  const consumedRounds = Math.max(0, ...projected.filter((event) =>
    ['specialist.completed', 'specialist.failed'].includes(event.kind)
      && field(event, 'stage') === observation.stage).map((event) => Number(field(event, 'reviewRound'))));
  if (consumedRounds >= observation.maxRounds) return refuse('review-budget-exhausted', 'The real review budget is exhausted; recovery cannot reset it');
  const preserved = existing.filter((item) => !inadmissible.includes(item.event.eventId)
    && item.completion.contractVersion === observation.contractVersions[item.event.subject]
    && field(item.event, 'inputHash') === observation.currentInputHashes[item.event.subject]);
  const preservedIds = new Set(preserved.map((item) => item.event.eventId));
  const receipt: MissionRecoveryReceipt = {
    schemaVersion: 1, closureEventId: lifecycle.closure.eventId, previousEpisodeId: lifecycle.episodeId,
    priorJournalHash: journalHash, priorJournalLastSeq: stream.lastSeq,
    requestHash: canonicalJsonHash(request), request, observation,
    preservedCompletionEventIds: [...preservedIds],
    invalidatedCompletionEventIds: existing.filter((item) => !preservedIds.has(item.event.eventId)).map((item) => item.event.eventId),
    inadmissibleCompletionEventIds: inadmissible, roundCorrections, consumedRounds, remainingRounds: observation.maxRounds - consumedRounds,
    nextAction: disposition.kind === 'review-blocker' ? 'clarification' : 'correction',
  };
  if (new TextEncoder().encode(canonicalJson(receipt)).length > 16_384) {
    return refuse('recovery-receipt-too-large', 'Narrow the recovery scope to the supported bounded incident');
  }
  return { kind: 'recover', receipt };
}


export type RecoveredReviewEvents =
  | { readonly ok: true; readonly events: readonly CanonicalEvent[] }
  | { readonly ok: false; readonly reasons: readonly string[] };
function exactKeys(value: Readonly<Record<string, JsonValue>>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function artifact(value: JsonValue | undefined): value is JsonValue & RecoveryResolutionArtifact {
  return value !== undefined && record(value) && exactKeys(value, ['path', 'sha256'])
    && typeof value['path'] === 'string' && value['path'].length > 0 && value['path'].length <= 500
    && typeof value['sha256'] === 'string' && /^sha256:[a-f0-9]{64}$/.test(value['sha256']);
}
function recoveryRequest(value: JsonValue | undefined): value is JsonValue & MissionRecoveryRequest {
  if (value === undefined || !record(value)
    || !exactKeys(value, ['schemaVersion', 'closureEventId', 'expectedJournalHash', 'disposition'])
    || value['schemaVersion'] !== 1 || typeof value['closureEventId'] !== 'string'
    || typeof value['expectedJournalHash'] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value['expectedJournalHash'])
    || value['disposition'] === undefined || !record(value['disposition'])) return false;
  const disposition = value['disposition'];
  return disposition['kind'] === 'controller-defect'
    ? exactKeys(disposition, ['kind', 'defect'])
      && ['partial-fanout-round', 'stale-input-dispatch'].includes(String(disposition['defect']))
    : disposition['kind'] === 'review-blocker'
      && exactKeys(disposition, ['kind', 'completionEventIds', 'resolutionArtifact'])
      && Array.isArray(disposition['completionEventIds']) && disposition['completionEventIds'].length <= 64
      && disposition['completionEventIds'].every((item) => typeof item === 'string')
      && artifact(disposition['resolutionArtifact']);
}
function recoveryObservation(value: JsonValue | undefined): value is JsonValue & MissionRecoveryObservation {
  if (value === undefined || !record(value)
    || !exactKeys(value, ['stage', 'contractVersions', 'currentInputHashes', 'maxRounds', 'expectedSource',
      ...(value['resolutionArtifact'] === undefined ? [] : ['resolutionArtifact']),
      ...(value['evidenceDependencies'] === undefined ? [] : ['evidenceDependencies'])])
    || !['pre-implementation', 'post-implementation'].includes(String(value['stage']))
    || !['runtime:codex', 'runtime:claude'].includes(String(value['expectedSource']))
    || typeof value['maxRounds'] !== 'number' || !Number.isSafeInteger(value['maxRounds']) || value['maxRounds'] < 1 || value['maxRounds'] > 8
    || value['contractVersions'] === undefined || !record(value['contractVersions'])
    || value['currentInputHashes'] === undefined || !record(value['currentInputHashes'])) return false;
  return Object.keys(value['contractVersions']).length <= 64 && Object.keys(value['currentInputHashes']).length <= 64
    && Object.entries(value['contractVersions']).every(([key, version]) => specialistId(key)
      && typeof version === 'number' && Number.isSafeInteger(version) && version >= 1 && version <= 10_000)
    && Object.entries(value['currentInputHashes']).every(([key, hash]) => specialistId(key)
      && typeof hash === 'string' && /^sha256:[a-f0-9]{64}$/.test(hash))
    && (value['resolutionArtifact'] === undefined || artifact(value['resolutionArtifact']))
    && (value['evidenceDependencies'] === undefined || (record(value['evidenceDependencies'])
      && Object.keys(value['evidenceDependencies']).length <= 64
      && Object.entries(value['evidenceDependencies']).every(([key, hash]) => key.length > 0 && key.length <= 500
        && typeof hash === 'string' && /^sha256:[a-f0-9]{64}$/.test(hash))));
}
function streamFrom(events: readonly CanonicalEvent[]): EventStreamState {
  return events.reduce(reduceEventStream, initialEventStream());
}
interface ValidatedRecovery {
  readonly event: CanonicalEvent;
  readonly receipt: MissionRecoveryReceipt;
}
function projectRecoveries(events: readonly CanonicalEvent[], recoveries: readonly ValidatedRecovery[]): readonly CanonicalEvent[] {
  return recoveries.reduce((projected, item) => applyRoundCorrections(projected, item.receipt.roundCorrections)
    .filter((event) => !item.receipt.inadmissibleCompletionEventIds.includes(event.eventId)), events);
}
function validateRecoveries(events: readonly CanonicalEvent[]): readonly ValidatedRecovery[] | undefined {
  const validated: ValidatedRecovery[] = [];
  for (const [index, event] of events.entries()) {
    if (event.kind !== 'mission.recovered') continue;
    const request = field(event, 'request');
    const observation = field(event, 'observation');
    if (event.source !== 'void-harness:mission.recover' || !recoveryRequest(request) || !recoveryObservation(observation)) return undefined;
    const prefix = events.slice(0, index);
    const decision = admitStoppedMission({ stream: streamFrom(prefix), request, observation }, projectRecoveries(prefix, validated));
    if (decision.kind !== 'recover' || canonicalJsonHash(decision.receipt) !== canonicalJsonHash(event.payload)) return undefined;
    validated.push({ event, receipt: decision.receipt });
  }
  return validated;
}

export function validatedRecoveredReviewEvents(events: readonly CanonicalEvent[]): RecoveredReviewEvents {
  if (events.some((event) => event.kind === 'mission.recovered')
    && projectMissionLifecycle(events).status === 'invalid') {
    return { ok: false, reasons: ['Recovered mission journal has inconsistent identity or episode linkage'] };
  }
  const migration = validatedSpecialistContractMigrationBoundary(events);
  if (!migration.ok) return migration;
  const validated = validateRecoveries(events);
  return validated === undefined
    ? { ok: false, reasons: ['Recovery receipt does not reproduce admission from its exact journal prefix'] }
    : { ok: true, events: projectRecoveries(events, validated) };
}

export function planStoppedMissionRecovery(input: MissionRecoveryInput): MissionRecoveryDecision {
  if (input.stream.continuity !== 'complete' || input.stream.duplicateEventIds > 0
    || input.stream.invalidLines > 0 || projectMissionLifecycle(input.stream.events).status === 'invalid') {
    return refuse('invalid-journal', 'Reconcile the complete original journal before reusing any recovery receipt');
  }
  const recoveries = validateRecoveries(input.stream.events);
  if (recoveries === undefined) return refuse('invalid-recovery-receipt', 'Reconcile the invalid recovery receipt without rewriting original evidence');
  const prior = recoveries.find((item) => item.receipt.closureEventId === input.request.closureEventId);
  if (prior !== undefined) {
    if (prior.receipt.requestHash !== canonicalJsonHash(input.request)) {
      return refuse('conflicting-recovery', 'This closure already has a different immutable recovery disposition');
    }
    if (canonicalJsonHash(prior.receipt.observation) !== canonicalJsonHash(input.observation)) {
      return refuse('stale-recovery-observation', 'Re-observe the active episode; the historical receipt cannot authorize changed inputs');
    }
    return { kind: 'already-recovered', recoveryEventId: prior.event.eventId, receipt: prior.receipt };
  }
  return admitStoppedMission(input, projectRecoveries(input.stream.events, recoveries));
}
