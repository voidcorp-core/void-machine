import { type EventStreamState, initialEventStream, reduceEventStream } from '../events/reducer.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJson, canonicalJsonHash } from '../evidence/canonical-json.js';
import { type CommandEvidenceCorrection, isCommandEvidenceCorrections, validCommandEvidenceCorrections } from '../evidence/command-correction.js';
import { parseEvidence } from '../evidence/schema.js';
import { parseSpecialistCompletionValue, type SpecialistCompletion } from '../specialist/completion.js';
import { reduceEvidenceObligations } from '../specialist/evidence-obligations.js';
import { type IndependentReviewReceipt, isReviewSubject, parseReviewReceipt, type ReviewSubject, sameReviewSubject } from '../specialist/review-receipt.js';
import type { SpecialistId, SpecialistInvocationStage } from '../specialist/routing.js';
import { projectMissionLifecycle } from './mission-lifecycle.js';
import { reduceReviewLoop, validNativeContextId } from './review-loop.js';
import { validatedSpecialistContractMigrationBoundary } from './specialist-contract-migration.js';

export interface RecoveryResolutionArtifact {
  readonly path: string;
  readonly sha256: string;
}
export interface MissionRecoveryRequest {
  readonly schemaVersion: 1;
  readonly closureEventId: string;
  readonly expectedJournalHash: string;
  readonly disposition:
    | { readonly kind: 'controller-defect'; readonly defect: 'partial-fanout-round' | 'stale-input-dispatch' | 'opaque-native-context' }
    | { readonly kind: 'command-correction'; readonly pairs: readonly CommandEvidenceCorrection[];
        readonly resolutionArtifact: RecoveryResolutionArtifact }
    | { readonly kind: 'review-blocker' | 'review-provenance'; readonly completionEventIds: readonly string[];
        readonly resolutionArtifact: RecoveryResolutionArtifact };
}
export interface RecoveredReviewBinding {
  readonly completionEventId: string;
  readonly completionHash: string;
  readonly review: IndependentReviewReceipt;
}
export interface MissionRecoveryObservation {
  readonly reviewSubject?: ReviewSubject;
  readonly reviewBindings?: readonly RecoveredReviewBinding[];
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
  readonly consumedCorrectionBatches?: number;
  readonly remainingCorrectionBatches?: number;
  readonly nextAction: 'correction' | 'clarification' | 'verification';
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

/** Admit only the initial Codex PASS panel rejected by the former identity regex. */
function opaqueNativeContextDefect(input: MissionRecoveryInput): boolean {
  const { events } = input.stream;
  const { observation } = input;
  const start = events[0];
  const closure = events.at(-1);
  if (start === undefined || closure?.kind !== 'mission.closed'
    || closure.source !== 'void-harness:mission.dispatch'
    || start.source !== 'void-harness:mission' || field(start, 'mode') !== 'team'
    || field(start, 'runtime') !== 'codex' || field(start, 'runtimeAttested') !== true
    || observation.expectedSource !== 'runtime:codex' || observation.stage !== 'pre-implementation'
    || !/^sha256:[a-f0-9]{64}$/.test(String(field(start, 'planHash')))) return false;
  const panel = events.slice(1, -1);
  if (panel.some(event => !['specialist.requested', 'specialist.started', 'specialist.completed'].includes(event.kind)
    || field(event, 'stage') !== 'pre-implementation' || field(event, 'reviewRound') !== 1)) return false;
  const requests = panel.filter(event => event.kind === 'specialist.requested');
  const completed = completions(panel);
  if (requests.length === 0 || completed.length !== requests.length || panel.length !== requests.length * 3
    || new Set(requests.map(event => event.subject)).size !== requests.length
    || new Set(completed.map(item => item.event.subject)).size !== requests.length
    || !completed.some(({ event }) => {
      const context = field(event, 'contextId');
      // The old predicate is incident evidence only, never the current contract.
      return validNativeContextId(context) && !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,159}$/.test(context);
    })) return false;
  return completed.every(({ event, completion }) => {
    const context = field(event, 'contextId');
    if (!validNativeContextId(context) || event.source !== observation.expectedSource
      || completion.verdict !== 'pass' || completion.findings.length > 0
      || completion.evidenceRequests.length > 0 || completion.limitations.length > 0
      || completion.specialistId !== event.subject
      || completion.contractVersion !== observation.contractVersions[event.subject]
      || field(event, 'contractVersion') !== completion.contractVersion
      || field(event, 'inputHash') !== observation.currentInputHashes[event.subject]) return false;
    const requested = requests.find(request => matchesRequest(event, request)
      && request.seq < event.seq && field(request, 'planHash') === field(start, 'planHash')
      && field(request, 'runtime') === 'codex'
      && field(request, 'contractVersion') === completion.contractVersion);
    if (requested === undefined) return false;
    const starts = panel.filter(candidate => candidate.kind === 'specialist.started' && candidate.subject === event.subject);
    const started = starts[0];
    return starts.length === 1 && started !== undefined
      && started.source === event.source && started.seq > requested.seq && started.seq < event.seq
      && ['stage', 'reviewRound', 'inputHash', 'contractVersion', 'contextId'].every(key =>
        field(started, key) === field(event, key));
  });
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

function validProvenanceRecovery(input: MissionRecoveryInput, existing: readonly Completion[]): boolean {
  const disposition = input.request.disposition;
  const observation = input.observation;
  const bindings = observation.reviewBindings;
  if (disposition.kind !== 'review-provenance' || observation.stage !== 'post-implementation'
    || observation.reviewSubject === undefined || bindings === undefined || bindings.length === 0
    || bindings.length !== disposition.completionEventIds.length
    || new Set(disposition.completionEventIds).size !== bindings.length
    || observation.resolutionArtifact?.path !== disposition.resolutionArtifact.path
    || observation.resolutionArtifact.sha256 !== disposition.resolutionArtifact.sha256) return false;
  const events = input.stream.events;
  const start = events[0];
  if (start === undefined) return false;
  const writerId = field(start, 'leadWriterId');
  const observedSubject = observation.reviewSubject;
  return bindings.every(binding => {
    const original = existing.find(item => item.event.eventId === binding.completionEventId);
    if (original === undefined || !disposition.completionEventIds.includes(binding.completionEventId)
      || original.event.subject !== 'core:independent-code-reviewer'
      || original.event.source !== observation.expectedSource || original.completion.verdict !== 'pass'
      || original.completion.findings.some(finding => finding.classification !== 'advisory')
      || original.completion.contractVersion !== observation.contractVersions[original.event.subject]
      || field(original.event, 'inputHash') !== observation.currentInputHashes[original.event.subject]
      || canonicalJsonHash(original.completion) !== binding.completionHash
      || !sameReviewSubject(binding.review, observedSubject)
      || binding.review.taskId !== original.event.missionId || binding.review.writerId !== writerId
      || binding.review.provenance.kind !== 'native-context'
      || binding.review.provenance.contextId !== field(original.event, 'contextId')) return false;
    const requested = events.find(event => event.seq < original.event.seq && matchesRequest(original.event, event)
      && field(event, 'contractVersion') === original.completion.contractVersion
      && `runtime:${String(field(event, 'runtime'))}` === observation.expectedSource);
    return requested !== undefined && events.some(event => event.kind === 'specialist.started'
      && event.source === observation.expectedSource && event.subject === original.event.subject
      && event.seq > requested.seq && event.seq < original.event.seq
      && ['stage', 'reviewRound', 'inputHash', 'contextId'].every(key =>
        field(event, key) === field(original.event, key)));
  });
}

/** Admit one clarification reclosure; authenticated history proves whether it was spent. */
function pendingPreparationClarification(
  input: MissionRecoveryInput, previousRecovery: CanonicalEvent,
): boolean {
  const { stream, request, observation } = input;
  const precedingRecovery = stream.events.filter(event => event.kind === 'mission.recovered'
    && event.seq < previousRecovery.seq).at(-1);
  // Without a writer boundary, that admitted receipt already consumed the exception.
  if (precedingRecovery !== undefined && !stream.events.some(event =>
    event.kind === 'lead-writer.completed' && event.seq > precedingRecovery.seq
      && event.seq < previousRecovery.seq)) return false;
  const priorRequest = field(previousRecovery, 'request');
  const priorDisposition = priorRequest !== undefined && record(priorRequest)
    ? priorRequest['disposition'] : undefined;
  const priorObservation = field(previousRecovery, 'observation');
  if (observation.stage !== 'pre-implementation' || request.disposition.kind !== 'review-blocker'
    || field(previousRecovery, 'nextAction') !== 'clarification'
    || priorObservation === undefined || !record(priorObservation)
    || priorObservation['stage'] !== 'pre-implementation'
    || priorDisposition === undefined || !record(priorDisposition)
    || priorDisposition['kind'] !== 'review-blocker'
    || canonicalJsonHash(priorDisposition['completionEventIds'])
      !== canonicalJsonHash(request.disposition.completionEventIds)) return false;
  // Any intervening work, human decision or unknown event requires reconciliation.
  const intervening = stream.events.filter(event => event.seq > previousRecovery.seq);
  if (intervening.length !== 1 || intervening[0]?.kind !== 'mission.closed'
    || intervening[0].source !== 'void-harness:mission.dispatch') return false;
  const proofs = stream.events.flatMap(event => {
    if (event.kind !== 'evidence.recorded') return [];
    const parsed = parseEvidence(field(event, 'evidence'));
    return parsed.ok ? [{ eventId: event.eventId, evidence: parsed.value }] : [];
  });
  const obligations = reduceEvidenceObligations({ events: stream.events,
    expectedSource: observation.expectedSource, phase: 'pre-implementation', proofs,
    evidenceContext: { dependencies: observation.evidenceDependencies ?? {} } });
  const blocking = new Set(obligations.blockingObligationIds);
  const completionEventIds = request.disposition.completionEventIds;
  return obligations.issues.length === 0 && obligations.obligations.some(item =>
    blocking.has(item.obligationId) && completionEventIds.includes(item.completionEventId));
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
    && event.kind === 'lead-writer.completed')
    && !pendingPreparationClarification(input, previousRecovery)) {
    return refuse('no-recovery-progress', 'Record actual corrective progress before reopening another stopped episode');
  }
  const existing = completions(events).filter((item) => field(item.event, 'stage') === observation.stage);
  const roundCorrections = partialFanoutCorrections(projectedHistory);
  const inadmissible = staleDispatchCompletions(projectedHistory);
  const disposition = request.disposition;
  if (disposition.kind === 'controller-defect' && (disposition.defect === 'partial-fanout-round'
    ? roundCorrections.length === 0 : disposition.defect === 'stale-input-dispatch'
      ? inadmissible.length === 0 : !opaqueNativeContextDefect(input))) {
    return refuse('unproven-controller-defect', 'The journal must prove the requested controller defect; do not reset its budget');
  }
  if (disposition.kind === 'review-provenance' && !validProvenanceRecovery(input, existing)) {
    return refuse('invalid-review-provenance', 'Preserve the actual independent invocation, exact subject, original passing result and contract; provenance cannot upgrade degraded evidence');
  }
  if (disposition.kind === 'command-correction') {
    if (observation.resolutionArtifact?.path !== disposition.resolutionArtifact.path
      || observation.resolutionArtifact.sha256 !== disposition.resolutionArtifact.sha256) {
      return refuse('stale-resolution-artifact', 'Read and hash the command correction artifact again before recovery');
    }
    if (!validCommandEvidenceCorrections(events, disposition.pairs, observation.evidenceDependencies ?? {})) {
      return refuse('invalid-command-correction', 'Name intact fresh command proofs with exact argv correspondence; exit 127 or a matching basename cannot authorize replacement');
    }
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
  if (disposition.kind !== 'review-provenance' && consumedRounds >= observation.maxRounds) return refuse('review-budget-exhausted', 'The real review budget is exhausted; recovery cannot reset it');
  const consumedCorrectionBatches = projected.filter(event => event.kind === 'lead-writer.completed'
    && field(event, 'actionKind') === 'run-correction').length;
  if (disposition.kind === 'review-provenance' && consumedCorrectionBatches > 2) {
    return refuse('review-budget-exhausted', 'The real correction budget is exhausted; recovery cannot reset it');
  }
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
    inadmissibleCompletionEventIds: inadmissible, roundCorrections, consumedRounds, remainingRounds: Math.max(0, observation.maxRounds - consumedRounds),
    ...(disposition.kind !== 'review-provenance' ? {} : { consumedCorrectionBatches,
      remainingCorrectionBatches: 2 - consumedCorrectionBatches }),
    nextAction: disposition.kind === 'review-provenance' || disposition.kind === 'command-correction'
      || (disposition.kind === 'controller-defect' && disposition.defect === 'opaque-native-context')
      ? 'verification' : disposition.kind === 'review-blocker' ? 'clarification' : 'correction',
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
  if (disposition['kind'] === 'command-correction') {
    return exactKeys(disposition, ['kind', 'pairs', 'resolutionArtifact'])
      && isCommandEvidenceCorrections(disposition['pairs']) && artifact(disposition['resolutionArtifact']);
  }
  return disposition['kind'] === 'controller-defect'
    ? exactKeys(disposition, ['kind', 'defect'])
      && ['partial-fanout-round', 'stale-input-dispatch', 'opaque-native-context'].includes(String(disposition['defect']))
    : (disposition['kind'] === 'review-blocker' || disposition['kind'] === 'review-provenance')
      && exactKeys(disposition, ['kind', 'completionEventIds', 'resolutionArtifact'])
      && Array.isArray(disposition['completionEventIds']) && disposition['completionEventIds'].length <= 64
      && disposition['completionEventIds'].every((item) => typeof item === 'string')
      && artifact(disposition['resolutionArtifact']);
}
function reviewBinding(value: unknown): value is RecoveredReviewBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length === 3 && 'completionEventId' in value
    && typeof value.completionEventId === 'string' && 'completionHash' in value
    && typeof value.completionHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.completionHash)
    && 'review' in value && parseReviewReceipt(value.review) !== undefined;
}
export function parseRecoveredReviewBindings(value: unknown): readonly RecoveredReviewBinding[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(reviewBinding)
    ? value : undefined;
}
function recoveryObservation(value: JsonValue | undefined): value is JsonValue & MissionRecoveryObservation {
  if (value === undefined || !record(value)
    || !exactKeys(value, ['stage', 'contractVersions', 'currentInputHashes', 'maxRounds', 'expectedSource',
      ...(value['resolutionArtifact'] === undefined ? [] : ['resolutionArtifact']),
      ...(value['reviewSubject'] === undefined ? [] : ['reviewSubject']),
      ...(value['reviewBindings'] === undefined ? [] : ['reviewBindings']),
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
    && (value['reviewSubject'] === undefined || isReviewSubject(value['reviewSubject']))
    && (value['reviewBindings'] === undefined || (Array.isArray(value['reviewBindings'])
      && value['reviewBindings'].length <= 64 && value['reviewBindings'].every(reviewBinding)))
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
    .filter((event) => !item.receipt.inadmissibleCompletionEventIds.includes(event.eventId))
    .filter(event => item.receipt.request.disposition.kind !== 'command-correction'
      || !item.receipt.request.disposition.pairs.some(pair => pair.failedEventId === event.eventId))
    .map(event => {
      const binding = item.receipt.observation.reviewBindings?.find(value => value.completionEventId === event.eventId);
      const completion = field(event, 'completion');
      if (binding === undefined || !record(event.payload) || completion === undefined || !record(completion)) return event;
      const receipt = binding.review;
      return { ...event, payload: { ...event.payload, completion: { ...completion, review: {
        ...receipt, scope: { ...receipt.scope }, provenance: { ...receipt.provenance },
        resolutions: receipt.resolutions.map(resolution => ({ ...resolution })),
      } } } };
    }), events);
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
