import type { EventStreamState } from '../events/reducer.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { assessEvidence } from '../evidence/invalidation.js';
import { parseEvidence } from '../evidence/schema.js';
import type { EvidenceContext } from '../evidence/types.js';
import {
  deriveMissionVerdict,
  type MissionVerdict,
  type MissionVerdictStatus,
} from '../evidence/verdict.js';
import { parseSpecialistCompletionValue } from '../specialist/completion.js';
import {
  type EvidenceObligationState,
  reduceEvidenceObligations,
} from '../specialist/evidence-obligations.js';
import { type ReviewScope, type ReviewSubject, sameReviewSubject } from '../specialist/review-receipt.js';
import type {
  SpecialistId,
  SpecialistInvocationStage,
  SpecialistRoutingDecision,
} from '../specialist/routing.js';
import { validatedRecoveredReviewEvents } from './mission-recovery.js';
import {
  type ReviewLoopState,
  reduceReviewLoop,
} from './review-loop.js';
import { validatedSpecialistContractMigrations } from './specialist-contract-migration.js';

export interface MissionSpecialistPlan {
  readonly planHash: string;
  readonly context: {
    readonly status: 'complete' | 'degraded';
    readonly issues: readonly string[];
  };
  readonly specialists: readonly (Pick<
    SpecialistRoutingDecision,
    'specialistId' | 'contractVersion' | 'state' | 'stages'
  > & { readonly inputHash?: string })[];
}

export type MissionTeamPhase =
  | 'preparation'
  | 'implementation'
  | 'review'
  | 'correction'
  | 'verification'
  | 'verified'
  | 'blocked'
  | 'degraded';

export type MissionTeamAction =
  | { readonly kind: 'run-lead-writer'; readonly writerId: string }
  | {
      readonly kind: 'invoke-specialists';
      readonly specialistIds: readonly SpecialistId[];
      readonly reviewRound: number;
      readonly stage: SpecialistInvocationStage;
      readonly reviewScope?: ReviewScope;
    }
  | {
      readonly kind: 'run-preparation-correction';
      readonly writerId: string;
      readonly findingIds: readonly string[];
    }
  | {
      readonly kind: 'run-correction';
      readonly writerId: string;
      readonly findingIds: readonly string[];
    }
  | { readonly kind: 'await-evidence'; readonly reasons: readonly string[] }
  | { readonly kind: 'run-verification' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'stop'; readonly reasons: readonly string[] };

export interface SpecialistRuntimeCapability {
  readonly status: 'available' | 'degraded' | 'unavailable';
  readonly limitations: readonly string[];
}

export interface MissionTeamControllerInput {
  readonly plan: MissionSpecialistPlan;
  readonly stream: EventStreamState;
  readonly evidenceContext: EvidenceContext;
  readonly currentInputHashesByStage: Readonly<Record<
    SpecialistInvocationStage,
    Readonly<Record<string, string>>
  >>;
  readonly maxReviewRounds: number;
  readonly reviewSubject?: ReviewSubject;
  readonly specialistRuntime: SpecialistRuntimeCapability;
}

export interface MissionTeamDecision {
  readonly phase: MissionTeamPhase;
  readonly action: MissionTeamAction;
  readonly review: ReviewLoopState;
  readonly verdict: MissionVerdict;
  readonly reasons: readonly string[];
}

interface MissionStart {
  readonly leadWriterId: string;
  readonly planHash: string;
  readonly valid: boolean;
  readonly runtime: 'claude' | 'codex' | undefined;
  readonly strictLifecycle: boolean;
  readonly boundedReview: boolean;
}

interface TeamEventPayload extends Readonly<Record<string, JsonValue>> {
  readonly leadWriterId?: JsonValue;
  readonly planHash?: JsonValue;
  readonly runtime?: JsonValue;
  readonly routingHash?: JsonValue;
  readonly mode?: JsonValue;
  readonly writerId?: JsonValue;
}

function record(value: JsonValue): TeamEventPayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as TeamEventPayload;
}

function missionStart(input: MissionTeamControllerInput): MissionStart {
  const events = input.stream.events.filter((item) => item.kind === 'mission.started');
  const payload = record(events[0]?.payload ?? null);
  const leadWriterId = payload?.leadWriterId;
  const planHash = payload?.planHash;
  const runtime = payload?.runtime;
  const routingHash = payload?.routingHash;
  return {
    boundedReview: payload?.['reviewPolicy'] === 'bounded-corrections-v1'
      || input.stream.events.some(event => {
        if (event.kind !== 'mission.recovered') return false;
        const request = record(lifecycleField(event, 'request') ?? null);
        return record(request?.['disposition'] ?? null)?.['kind'] === 'review-provenance';
      }),
    leadWriterId: typeof leadWriterId === 'string' ? leadWriterId : '',
    planHash: typeof planHash === 'string' ? planHash : '',
    runtime: runtime === 'claude' || runtime === 'codex' ? runtime : undefined,
    strictLifecycle: typeof routingHash === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(routingHash),
    valid: events.length === 1
      && (payload?.mode === 'team' || payload?.mode === 'fortress')
      && typeof leadWriterId === 'string'
      && leadWriterId.length > 0
      && leadWriterId.length <= 128
      && planHash === input.plan.planHash
      && (runtime === 'claude' || runtime === 'codex'),
  };
}

function writerLifecycleViolation(
  input: MissionTeamControllerInput,
  start: MissionStart,
): boolean {
  if (!start.strictLifecycle) return false;
  return writerCompletions(input).some((completion) => {
    const requestEventId = lifecycleField(completion, 'requestEventId');
    const implementationRound = lifecycleField(completion, 'implementationRound');
    const request = typeof requestEventId === 'string'
      ? input.stream.events.find((event) => event.eventId === requestEventId)
      : undefined;
    return request === undefined
      || request.seq >= completion.seq
      || request.kind !== 'lead-writer.requested'
      || request.source !== 'void-harness:mission.dispatch'
      || request.subject !== start.leadWriterId
      || completion.subject !== start.leadWriterId
      || completion.causationId !== request.eventId
      || lifecycleField(request, 'writerId') !== start.leadWriterId
      || lifecycleField(request, 'planHash') !== start.planHash
      || lifecycleField(request, 'implementationRound') !== implementationRound
      || lifecycleField(request, 'actionKind') !== lifecycleField(completion, 'actionKind');
  });
}

function requiredSpecialists(
  plan: MissionSpecialistPlan,
  stage: SpecialistInvocationStage,
  boundedReview = false,
): readonly SpecialistId[] {
  if (!Array.isArray(plan.specialists)) return [];
  return plan.specialists
    .filter((specialist) =>
      specialist.state === 'applicable' && specialist.stages?.includes(stage)
      && (!boundedReview || stage !== 'post-implementation'
        || specialist.specialistId === 'core:independent-code-reviewer'))
    .map((specialist) => specialist.specialistId);
}

function contractVersions(plan: MissionSpecialistPlan): Readonly<Record<string, number>> {
  if (!Array.isArray(plan.specialists)) return {};
  return Object.fromEntries(plan.specialists.map((specialist) => [
    specialist.specialistId,
    specialist.contractVersion,
  ]));
}

function writerViolation(input: MissionTeamControllerInput, expected: string): boolean {
  return input.stream.events
    .filter((event) => event.kind.startsWith('lead-writer.'))
    .some((event) => {
      const payload = record(event.payload);
      return event.subject !== expected || payload?.writerId !== expected;
    });
}

function writerCompletions(input: MissionTeamControllerInput): readonly CanonicalEvent[] {
  return input.stream.events.filter((event) => event.kind === 'lead-writer.completed');
}

type LeadWriterActionKind =
  | 'run-lead-writer'
  | 'run-correction'
  | 'run-preparation-correction';

function leadWriterActionKind(event: CanonicalEvent): LeadWriterActionKind | undefined {
  const actionKind = lifecycleField(event, 'actionKind');
  return actionKind === 'run-lead-writer'
    || actionKind === 'run-correction'
    || actionKind === 'run-preparation-correction'
    ? actionKind
    : undefined;
}

function lifecycleField(event: CanonicalEvent, key: string): JsonValue | undefined {
  const payload = record(event.payload);
  return payload?.[key];
}

function sameSpecialistDispatch(
  left: CanonicalEvent,
  right: CanonicalEvent,
): boolean {
  return left.missionId === right.missionId
    && left.subject === right.subject
    && lifecycleField(left, 'contractVersion') === lifecycleField(right, 'contractVersion')
    && lifecycleField(left, 'stage') === lifecycleField(right, 'stage')
    && lifecycleField(left, 'reviewRound') === lifecycleField(right, 'reviewRound')
    && lifecycleField(left, 'inputHash') === lifecycleField(right, 'inputHash');
}

function unboundCompletionReasons(
  input: MissionTeamControllerInput,
  runtime: 'claude' | 'codex' | undefined,
): readonly string[] {
  const reasons: string[] = [];
  for (const completion of input.stream.events.filter((event) =>
    event.kind === 'specialist.completed')) {
    const started = input.stream.events.find((event) =>
      event.seq < completion.seq
      && event.kind === 'specialist.started'
      && event.source === `runtime:${runtime ?? 'invalid'}`
      && sameSpecialistDispatch(event, completion)
      && (lifecycleField(completion, 'reviewInvocationEventId') === undefined
        ? lifecycleField(event, 'contextId') === lifecycleField(completion, 'contextId')
        : event.eventId === lifecycleField(completion, 'reviewInvocationEventId')
          && lifecycleField(event, 'reviewerId') === parseSpecialistCompletionValue(
            lifecycleField(completion, 'completion'))?.review?.reviewerId));
    const requested = started === undefined ? undefined : input.stream.events.find((event) =>
      event.seq < started.seq
      && event.kind === 'specialist.requested'
      && event.source === 'void-harness:mission.dispatch'
      && sameSpecialistDispatch(event, completion)
      && lifecycleField(event, 'planHash') === input.plan.planHash
      && lifecycleField(event, 'runtime') === runtime);
    if (requested === undefined || started === undefined) {
      reasons.push(`specialist lifecycle is unbound: ${completion.subject}`);
    }
  }
  return [...new Set(reasons)].sort();
}

function overrideVerdict(
  verdict: MissionVerdict,
  status: MissionVerdictStatus,
  reasons: readonly string[],
): MissionVerdict {
  return {
    ...verdict,
    status,
    reasons: [...new Set([...verdict.reasons, ...reasons])],
  };
}

function stopped(
  phase: 'blocked' | 'degraded',
  review: ReviewLoopState,
  verdict: MissionVerdict,
  reasons: readonly string[],
  nextAction = 'Resolve the reported contract or evidence violation, then resume through the supported mission recovery path.',
): MissionTeamDecision {
  const status = phase === 'blocked' ? 'blocked' : 'degraded';
  const diagnostics = [
    ...(reasons.length > 0 ? reasons : ['Mission controller stopped without a valid cause.']),
    `Next action: ${nextAction}`,
  ];
  return {
    phase,
    action: { kind: 'stop', reasons: diagnostics },
    review,
    verdict: overrideVerdict(verdict, status, diagnostics),
    reasons: diagnostics,
  };
}

function applyRuntimeCertification(
  decision: MissionTeamDecision,
  capability: SpecialistRuntimeCapability,
): MissionTeamDecision {
  // A degraded runtime still ran the declared review. Keep its limitation in
  // the verdict, but do not turn a valid ticket into a dead end: only an
  // unavailable runtime is a hard gate (handled before this function).
  if (capability.status === 'available') return decision;
  const runtimeReasons = capability.limitations.map((item) => `specialist runtime: ${item}`);
  const reasons = [...new Set([...decision.reasons, ...runtimeReasons])];
  return {
    ...decision,
    verdict: overrideVerdict(
      decision.verdict,
      decision.verdict.status === 'blocked' ? 'blocked' : 'degraded',
      runtimeReasons,
    ),
    reasons,
  };
}

function decideReviewPhase(
  start: MissionStart,
  review: ReviewLoopState,
  baseVerdict: MissionVerdict,
  stage: SpecialistInvocationStage,
): MissionTeamDecision {
  if (review.status === 'degraded') {
    const reasons = [
      ...review.issues.map((issue) => `review issue: ${issue.code}: ${issue.detail}`),
      ...review.limitations,
      'Resolve the reported review limitation or invalid evidence before resuming review.',
    ];
    return stopped('degraded', review, baseVerdict, reasons);
  }
  if (review.status === 'blocked') {
    return stopped('blocked', review, baseVerdict,
      ['bounded specialist review did not converge'],
      'Escalate the unresolved findings or failed attempts for operator arbitration; preserve the consumed round budget.');
  }
  if (review.status === 'awaiting-review' && review.staleSpecialists.length === 0) {
    const reasons = ['required specialist completion is missing or stale'];
    return {
      phase: stage === 'pre-implementation' ? 'preparation' : 'review',
      action: {
        kind: 'invoke-specialists',
        specialistIds: review.specialistsToRun,
        reviewRound: review.reviewRound,
        stage,
      },
      review,
      verdict: overrideVerdict(baseVerdict, 'unverified', reasons),
      reasons,
    };
  }
  if (review.status === 'correction-required' || review.staleSpecialists.length > 0) {
    const reasons = [review.staleSpecialists.length > 0
      ? 'reviewed inputs changed; record a lead-writer correction before opening the next round'
      : stage === 'pre-implementation'
      ? 'specialist findings require preparation correction'
      : 'specialist findings require lead-writer correction'];
    return {
      phase: stage === 'pre-implementation' ? 'preparation' : 'correction',
      action: stage === 'pre-implementation'
        ? {
            kind: 'run-preparation-correction',
            writerId: start.leadWriterId,
            findingIds: review.findings.filter(finding => !start.boundedReview
              || finding.classification === 'blocking').map((finding) => finding.findingId),
          }
        : {
            kind: 'run-correction',
            writerId: start.leadWriterId,
            findingIds: review.findings.filter(finding => !start.boundedReview
              || finding.classification === 'blocking').map((finding) => finding.findingId),
          },
      review,
      verdict: overrideVerdict(baseVerdict, 'blocked', reasons),
      reasons,
    };
  }
  if (baseVerdict.status === 'verified') {
    return {
      phase: 'verified',
      action: { kind: 'complete' },
      review,
      verdict: baseVerdict,
      reasons: [],
    };
  }
  if (baseVerdict.status === 'blocked' || baseVerdict.status === 'degraded') {
    return stopped(baseVerdict.status, review, baseVerdict, baseVerdict.reasons);
  }
  return {
    phase: 'verification',
    action: { kind: 'run-verification' },
    review,
    verdict: baseVerdict,
    reasons: baseVerdict.reasons,
  };
}

function boundedReceiptReasons(
  input: MissionTeamControllerInput, start: MissionStart, events: readonly CanonicalEvent[],
): readonly string[] {
  const lastWriter = writerCompletions(input).at(-1)?.seq ?? 0;
  return events.filter(event => event.kind === 'specialist.completed' && event.seq > lastWriter
    && event.subject === 'core:independent-code-reviewer'
    && lifecycleField(event, 'stage') === 'post-implementation').flatMap(event => {
    const result = parseSpecialistCompletionValue(lifecycleField(event, 'completion'));
    const receipt = result?.review;
    if (result === undefined || receipt === undefined || input.reviewSubject === undefined) {
      return ['Independent review requires its durable committed subject and reviewer receipt'];
    }
    if (!sameReviewSubject(receipt, input.reviewSubject) || receipt.taskId !== event.missionId
      || receipt.writerId !== start.leadWriterId || receipt.reviewerId === start.leadWriterId) {
      return ['Independent review receipt does not match the observed task, commit, base, or writer'];
    }
    if (receipt.provenance.kind === 'native-context'
      && receipt.provenance.contextId !== lifecycleField(event, 'contextId')) {
      return ['Independent reviewer native provenance does not match its actual invocation'];
    }
    if (result.findings.some(finding => finding.classification === undefined)) {
      return ['Bounded findings require an explicit consequence classification'];
    }
    return [];
  });
}

function recoveredPreparationTargets(events: readonly CanonicalEvent[]): {
  readonly recoverySeq: number;
  readonly specialistIds: readonly string[];
} | undefined {
  const recovery = events.filter((item) => item.kind === 'mission.recovered').at(-1);
  if (recovery === undefined) return undefined;
  const payload = record(recovery.payload);
  const observation = record(payload?.['observation'] ?? null);
  const request = record(payload?.['request'] ?? null);
  const disposition = record(request?.['disposition'] ?? null);
  const ids = disposition?.['completionEventIds'];
  if (observation?.['stage'] !== 'pre-implementation'
    || disposition?.['kind'] !== 'review-blocker' || !Array.isArray(ids)) return undefined;
  return {
    recoverySeq: recovery.seq,
    specialistIds: events.filter((item) =>
      item.kind === 'specialist.completed' && ids.includes(item.eventId)).map((item) => item.subject),
  };
}

function retainedPreparationSpecialists(
  input: MissionTeamControllerInput,
  events: readonly CanonicalEvent[],
  boundary: number,
  targets: readonly string[],
): readonly SpecialistId[] {
  return requiredSpecialists(input.plan, 'pre-implementation').filter((id) => {
    if (targets.includes(id)) return false;
    const latest = events.filter((item) => item.kind === 'specialist.completed'
      && item.subject === id && item.seq < boundary
      && lifecycleField(item, 'stage') === 'pre-implementation').at(-1);
    if (latest === undefined) return false;
    const result = record(lifecycleField(latest, 'completion') ?? null);
    return result?.['verdict'] === 'pass'
      && result['contractVersion'] === contractVersions(input.plan)[id]
      && lifecycleField(latest, 'inputHash') === input.currentInputHashesByStage['pre-implementation'][id];
  });
}

function preparationHasMissingOrStaleReviews(
  input: MissionTeamControllerInput,
  events: readonly CanonicalEvent[],
  boundary: number,
): boolean {
  return requiredSpecialists(input.plan, 'pre-implementation').some((id) => {
    const latest = events.filter((item) => item.kind === 'specialist.completed'
      && item.subject === id && item.seq < boundary
      && lifecycleField(item, 'stage') === 'pre-implementation').at(-1);
    if (latest === undefined) return true;
    const result = record(lifecycleField(latest, 'completion') ?? null);
    return result?.['contractVersion'] !== contractVersions(input.plan)[id]
      || lifecycleField(latest, 'inputHash') !== input.currentInputHashesByStage['pre-implementation'][id];
  });
}

/** Called only after recovery receipts have reproduced their original admission. */
function pendingRecoveredCorrectionFindingIds(events: readonly CanonicalEvent[]): readonly string[] {
  const recovery = events.filter((event) => event.kind === 'mission.recovered').at(-1);
  if (recovery === undefined || events.some((event) => event.seq > recovery.seq
    && event.kind === 'lead-writer.completed')) return [];
  const payload = record(recovery.payload);
  const observation = record(payload?.['observation'] ?? null);
  const invalidated = payload?.['invalidatedCompletionEventIds'];
  const remaining = payload?.['remainingRounds'];
  if (payload?.['nextAction'] !== 'correction'
    || observation?.['stage'] !== 'post-implementation'
    || typeof remaining !== 'number' || remaining < 1 || !Array.isArray(invalidated)) return [];
  return [...new Set(events.flatMap((event) => {
    if (event.kind !== 'specialist.completed' || event.seq >= recovery.seq
      || !invalidated.includes(event.eventId)
      || lifecycleField(event, 'stage') !== 'post-implementation') return [];
    const completion = parseSpecialistCompletionValue(lifecycleField(event, 'completion'));
    return completion === undefined || completion.verdict === 'pass' ? []
      : completion.findings.map((finding) =>
        `fnd_${canonicalJsonHash({ evidence: finding.evidence }).slice('sha256:'.length, 29)}`);
  }))];
}

function evidenceObligations(
  input: MissionTeamControllerInput,
  expectedSource: 'runtime:claude' | 'runtime:codex',
  phase: 'pre-implementation' | 'post-implementation' | 'completion',
): EvidenceObligationState {
  const proofs = input.stream.events.flatMap((event) => {
    if (event.kind !== 'evidence.recorded') return [];
    const parsed = parseEvidence(record(event.payload)?.['evidence']);
    return parsed.ok && parsed.value.evidenceId === event.subject
      && parsed.value.missionId === event.missionId
      ? [{ eventId: event.eventId, evidence: parsed.value }]
      : [];
  });
  return reduceEvidenceObligations({
    events: input.stream.events, expectedSource, phase, proofs,
    evidenceContext: input.evidenceContext,
  });
}

function obligationStop(
  state: EvidenceObligationState,
  review: ReviewLoopState,
  verdict: MissionVerdict,
  preparation = false,
): MissionTeamDecision | undefined {
  if (state.issues.length > 0) {
    return stopped('degraded', review, verdict,
      state.issues.map((issue) => `Evidence obligation ${issue.eventId}: ${issue.detail}`),
      'Resolve the invalid specialist evidence disposition, then classify or discharge the original obligation through its authorized specialist.');
  }
  const blocking = new Set(state.blockingObligationIds);
  if (blocking.size === 0) return undefined;
  const decision = stopped('blocked', review, verdict,
    state.obligations.filter((item) => blocking.has(item.obligationId)).map((item) =>
      `Evidence obligation ${item.obligationId} (${item.due}): ${item.requestText}`),
    'Use mission evidence-request, then record the authorized author response with mission evidence-event to classify or discharge the obligation; a writer completion does not replace the required proof.');
  // Preparation proof can require an author response before any writer may run.
  return preparation
    ? { ...decision, action: { kind: 'await-evidence', reasons: decision.reasons } }
    : decision;
}

export function orchestrateMissionTeam(
  originalInput: MissionTeamControllerInput,
): MissionTeamDecision {
  const migrated = validatedSpecialistContractMigrations(originalInput.stream.events, originalInput.plan);
  const input = migrated.ok ? { ...originalInput, plan: migrated.plan } : originalInput;
  const start = missionStart(input);
  const recovered = validatedRecoveredReviewEvents(input.stream.events);
  const reviewEvents = recovered.ok ? recovered.events : input.stream.events;
  const preparationRecovery = recovered.ok ? recoveredPreparationTargets(reviewEvents) : undefined;
  const writerEvents = writerCompletions(input);
  const preparationCorrections = writerEvents.filter((event) =>
    lifecycleField(event, 'actionKind') === 'run-preparation-correction');
  const completions = writerEvents.filter((event) =>
    lifecycleField(event, 'actionKind') !== 'run-preparation-correction');
  const lastPreparationSeq = preparationCorrections.length === 0
    ? undefined
    : Math.max(...preparationCorrections.map((event) => event.seq));
  const firstWriterSeq = completions.length === 0
    ? undefined
    : Math.min(...completions.map((event) => event.seq));
  const implementationCompletions = completions.filter((event) =>
    leadWriterActionKind(event) !== 'run-preparation-correction');
  const firstImplementationSeq = implementationCompletions.length === 0
    ? undefined
    : Math.min(...implementationCompletions.map((event) => event.seq));
  const preparationCorrectionCompleted = preparationCorrections.length > 0;
  const preparationFollowupRequired = preparationRecovery !== undefined
    || (lastPreparationSeq !== undefined
      && preparationHasMissingOrStaleReviews(input, reviewEvents, lastPreparationSeq));

  const latePreparationCompletion = lastPreparationSeq !== undefined
    && input.stream.events.some((event) =>
      event.seq > lastPreparationSeq
      && event.kind === 'specialist.completed'
      && lifecycleField(event, 'stage') === 'pre-implementation');
  const lastWriterSeq = completions.length === 0
    ? undefined
    : Math.max(...completions.map((event) => event.seq));
  const missionStartSeq = input.stream.events.find((event) => event.kind === 'mission.started')?.seq;
  const expectedSource = start.runtime === 'claude' ? 'runtime:claude' : 'runtime:codex';
  const obligations = evidenceObligations(input, expectedSource,
    firstImplementationSeq === undefined ? 'pre-implementation' : 'post-implementation');
  const preparationObligationIds = new Set(obligations.obligations.filter((obligation) =>
    input.stream.events.some((event) => event.eventId === obligation.completionEventId
      && lifecycleField(event, 'stage') === 'pre-implementation'))
    .map((obligation) => obligation.obligationId));
  const preReview = reduceReviewLoop({
    stage: 'pre-implementation',
    expectedSource,
    ...(lastPreparationSeq === undefined || missionStartSeq === undefined ? {} : {
      stageStartSeqExclusive: missionStartSeq,
      afterSeqExclusive: lastPreparationSeq,
    }),
    ...(firstWriterSeq === undefined ? {} : { beforeSeqExclusive: firstWriterSeq }),
    events: reviewEvents,
    requiredSpecialists: requiredSpecialists(input.plan, 'pre-implementation'),
    contractVersions: contractVersions(input.plan),
    currentInputHashes: input.currentInputHashesByStage['pre-implementation'],
    maxRounds: input.maxReviewRounds,
    evidenceObligations: {
      ...obligations,
      blockingObligationIds: obligations.blockingObligationIds.filter((id) => preparationObligationIds.has(id)),
    },
    ...(!preparationFollowupRequired || lastPreparationSeq === undefined
      || (preparationRecovery !== undefined
        && lastPreparationSeq <= preparationRecovery.recoverySeq) ? {} : {
      retainedSpecialists: retainedPreparationSpecialists(
        input, reviewEvents, lastPreparationSeq, preparationRecovery?.specialistIds ?? [],
      ),
    }),
  });
  const baseVerdict = deriveMissionVerdict(input.stream, input.evidenceContext);
  const invalidRuntime = input.specialistRuntime === undefined
    || !Array.isArray(input.specialistRuntime.limitations)
    || input.specialistRuntime.limitations.some((item) =>
      typeof item !== 'string' || item.trim() === '')
    || !['available', 'degraded', 'unavailable'].includes(input.specialistRuntime.status);
  if (invalidRuntime) {
    return stopped('degraded', preReview, baseVerdict, [
      'effective specialist runtime capability is invalid or missing',
    ]);
  }
  const traceableReview = start.boundedReview && input.reviewSubject !== undefined
    && reviewEvents.some(event => event.kind === 'specialist.completed'
      && event.subject === 'core:independent-code-reviewer'
      && parseSpecialistCompletionValue(lifecycleField(event, 'completion'))?.review !== undefined)
    && boundedReceiptReasons(input, start, reviewEvents).length === 0
    && unboundCompletionReasons(input, start.runtime).length === 0;
  if (input.specialistRuntime.status === 'unavailable' && !traceableReview) {
    const limitations = input.specialistRuntime.limitations.length > 0
      ? input.specialistRuntime.limitations
      : ['effective specialist runtime capability is not available'];
    return stopped('blocked', preReview, baseVerdict, limitations.map((item) =>
      `specialist runtime: ${item}`),
      'Restore an admissible specialist runtime with the reported missing capabilities before resuming.');
  }
  if (!Array.isArray(input.plan.specialists)) {
    return stopped('degraded', preReview, baseVerdict, ['specialist routing is missing from the plan']);
  }
  const invalidStages = input.plan.specialists.filter((specialist) =>
    !Array.isArray(specialist.stages)
    || specialist.stages.length === 0
    || specialist.stages.some((stage: SpecialistInvocationStage) =>
      stage !== 'pre-implementation' && stage !== 'post-implementation'));
  if (invalidStages.length > 0) {
    return stopped('degraded', preReview, baseVerdict, invalidStages.map((specialist) =>
      `specialist invocation stages missing or invalid: ${specialist.specialistId}`));
  }
  if (input.plan.context?.status === 'degraded') {
    const causes = input.plan.context.issues.length > 0
      ? input.plan.context.issues.map((issue) => `mission context degraded: ${issue}`)
      : ['mission context is degraded but its required diagnostic issues are missing'];
    return stopped('degraded', preReview, baseVerdict, causes,
      'Rebuild the mission context with explicit diagnostics and resolve its missing or stale inputs.');
  }
  const degradedRouting = Array.isArray(input.plan.specialists)
    ? input.plan.specialists.filter((specialist) => specialist.state === 'degraded')
    : [];
  if (degradedRouting.length > 0) {
    return stopped('degraded', preReview, baseVerdict, degradedRouting.map((specialist) =>
      `specialist routing degraded: ${specialist.specialistId}`));
  }
  if (!start.valid) {
    return stopped('degraded', preReview, baseVerdict, ['team mission metadata is invalid']);
  }
  if (writerViolation(input, start.leadWriterId)) {
    return stopped('degraded', preReview, baseVerdict, ['lead writer ownership changed']);
  }
  if (writerLifecycleViolation(input, start)) {
    return stopped('degraded', preReview, baseVerdict, [
      'lead writer completion is not bound to a controller request',
    ]);
  }

  if (!recovered.ok) {
    return stopped('degraded', preReview, baseVerdict, recovered.reasons,
      'Reconcile the invalid recovery receipt through the supported admission path without editing history.');
  }
  if (!migrated.ok) return stopped('degraded', preReview, baseVerdict, migrated.reasons);
  const pendingEvidence = obligationStop(
    obligations, preReview, baseVerdict, firstImplementationSeq === undefined,
  );
  const migration = migrated.migration;
  if (migration !== undefined) {
    const receipt = migration.receipt;
    if (input.currentInputHashesByStage['post-implementation'][receipt.specialistId] !== receipt.targetInputHash
      || receipt.reviewRound > input.maxReviewRounds) {
      return stopped('blocked', preReview, baseVerdict, ['Migrated review inputs or budget changed; observe the admitted subject before dispatch']);
    }
    const terminal = input.stream.events.some(event => event.seq > migration.seq
      && event.subject === receipt.specialistId && ['specialist.completed', 'specialist.failed'].includes(event.kind));
    const onlyAuthorObligations = obligations.issues.length === 0
      && obligations.blockingObligationIds.every(id => receipt.pendingAuthorObligationIds.includes(id));
    const preparationAdmitted = preReview.readyForVerdict
      || (preparationCorrectionCompleted && !preparationFollowupRequired && firstImplementationSeq !== undefined);
    if (!terminal && onlyAuthorObligations && preparationAdmitted) {
      const reasons = ['Explicit contract migration requires one fresh visual assessment; historical evidence obligations remain due'];
      return applyRuntimeCertification({ phase: 'review',
        action: { kind: 'invoke-specialists', specialistIds: ['core:visual-craft-director'],
          stage: 'post-implementation', reviewRound: receipt.reviewRound },
        review: preReview, verdict: overrideVerdict(baseVerdict, 'blocked', reasons), reasons,
      }, input.specialistRuntime);
    }
  }
  const correctiveFindingIds = pendingRecoveredCorrectionFindingIds(input.stream.events);
  const correctiveContinuation = pendingEvidence !== undefined && obligations.issues.length === 0
    && firstImplementationSeq !== undefined && correctiveFindingIds.length > 0;
  if (pendingEvidence !== undefined && !correctiveContinuation) {
    return applyRuntimeCertification(pendingEvidence, input.specialistRuntime);
  }

  if (preparationRecovery !== undefined && (lastPreparationSeq === undefined
    || lastPreparationSeq < preparationRecovery.recoverySeq)) {
    if (preReview.issues.length > 0) {
      return decideReviewPhase(start, preReview, baseVerdict, 'pre-implementation');
    }
    const reasons = ['Recovered preparation requires clarification followed by a fresh targeted review.'];
    return applyRuntimeCertification({
      phase: 'preparation',
      action: { kind: 'run-preparation-correction', writerId: start.leadWriterId,
        findingIds: preReview.findings.map((finding) => finding.findingId) },
      review: preReview, verdict: overrideVerdict(baseVerdict, 'unverified', reasons), reasons,
    }, input.specialistRuntime);
  }
  if (!preparationFollowupRequired && preparationCorrectionCompleted && latePreparationCompletion) {
    return applyRuntimeCertification(stopped(
      'blocked',
      preReview,
      baseVerdict,
      ['pre-implementation review was replayed after preparation correction'],
    ), input.specialistRuntime);
  }
  if (!preparationFollowupRequired && preparationCorrectionCompleted && firstImplementationSeq === undefined) {
    const reasons = ['preparation correction completed; implementation is pending'];
    return applyRuntimeCertification({
      phase: 'implementation',
      action: { kind: 'run-lead-writer', writerId: start.leadWriterId },
      review: preReview,
      verdict: overrideVerdict(baseVerdict, 'unverified', reasons),
      reasons,
    }, input.specialistRuntime);
  }

  if (!preReview.readyForVerdict && (!preparationCorrectionCompleted || preparationFollowupRequired)) {
    return applyRuntimeCertification(
      decideReviewPhase(start, preReview, baseVerdict, 'pre-implementation'),
      input.specialistRuntime,
    );
  }
  if (completions.length === 0) {
    const reasons = ['lead writer implementation is incomplete'];
    return applyRuntimeCertification({
      phase: 'implementation',
      action: { kind: 'run-lead-writer', writerId: start.leadWriterId },
      review: preReview,
      verdict: overrideVerdict(baseVerdict, 'unverified', reasons),
      reasons,
    }, input.specialistRuntime);
  }
  if (firstWriterSeq === undefined || firstImplementationSeq === undefined || lastWriterSeq === undefined) {
    throw new Error('MISSION_TEAM_INVARIANT: writer completion boundary is missing');
  }
  const postReview = reduceReviewLoop({
    stage: 'post-implementation',
    expectedSource,
    stageStartSeqExclusive: firstImplementationSeq,
    afterSeqExclusive: lastWriterSeq,
    events: reviewEvents,
    requiredSpecialists: requiredSpecialists(input.plan, 'post-implementation', start.boundedReview),
    contractVersions: contractVersions(input.plan),
    currentInputHashes: input.currentInputHashesByStage['post-implementation'],
    maxRounds: start.boundedReview ? 3 : input.maxReviewRounds,
    ...(start.boundedReview ? { maxCorrectionBatches: 2 as const } : {}),
    evidenceObligations: obligations,
    validProofIds: input.stream.events.flatMap(event => {
      if (event.kind !== 'evidence.recorded') return [];
      const parsed = parseEvidence(lifecycleField(event, 'evidence'));
      return parsed.ok && parsed.value.evidenceId === event.subject
        && parsed.value.missionId === event.missionId && parsed.value.status === 'passed'
        && assessEvidence(parsed.value, input.evidenceContext).status === 'fresh'
        ? [parsed.value.evidenceId] : [];
    }),
    ...(migration === undefined ? {} : { contractMigration: {
      specialistId: migration.receipt.specialistId, afterSeq: migration.seq,
      reviewRound: migration.receipt.reviewRound,
    } }),
  });
  if (start.boundedReview && postReview.missingSpecialists.length === 0) {
    const receiptReasons = boundedReceiptReasons(input, start, reviewEvents);
    if (receiptReasons.length > 0) return stopped('degraded', postReview, baseVerdict, receiptReasons);
  }
  if (postReview.readyForVerdict) {
    const completionEvidence = obligationStop(
      evidenceObligations(input, expectedSource, 'completion'), postReview, baseVerdict,
    );
    if (completionEvidence !== undefined) {
      return applyRuntimeCertification(completionEvidence, input.specialistRuntime);
    }
  }
  let postDecision = decideReviewPhase(
    start,
    postReview,
    baseVerdict,
    'post-implementation',
  );
  if (start.boundedReview && postDecision.action.kind === 'invoke-specialists') {
    const previous = reviewEvents.filter(event => event.kind === 'specialist.completed'
      && event.subject === 'core:independent-code-reviewer'
      && lifecycleField(event, 'stage') === 'post-implementation' && event.seq < lastWriterSeq)
      .map(event => parseSpecialistCompletionValue(lifecycleField(event, 'completion')))
      .filter(completion => completion !== undefined);
    const blockers = previous.flatMap(completion => completion.findings)
      .filter(finding => finding.classification === 'blocking');
    const reviewScope: ReviewScope = previous.length === 0 ? { kind: 'general' } : {
      kind: 'targeted', findingIds: [...new Set(blockers.map(finding => finding.id))],
      affectedPaths: [...new Set(blockers.flatMap(finding => finding.evidence.map(proof => proof.path)))],
    };
    postDecision = { ...postDecision, action: { ...postDecision.action, reviewScope } };
  }
  if (pendingEvidence !== undefined) {
    // Due proof still refuses review acceptance. Only the admitted correction can produce it.
    const reasons = [...postDecision.reasons, ...pendingEvidence.reasons];
    if (postDecision.action.kind !== 'run-correction') {
      return applyRuntimeCertification(stopped(
        postDecision.phase === 'degraded' ? 'degraded' : 'blocked', postReview, baseVerdict, reasons,
      ), input.specialistRuntime);
    }
    return applyRuntimeCertification({
      ...postDecision,
      action: { ...postDecision.action,
        findingIds: [...new Set([...postDecision.action.findingIds, ...correctiveFindingIds])] },
      reasons, verdict: overrideVerdict(postDecision.verdict, 'blocked', reasons),
    }, input.specialistRuntime);
  }
  if (postDecision.action.kind === 'complete') {
    const lifecycleReasons = unboundCompletionReasons(input, start.runtime);
    if (lifecycleReasons.length > 0) {
      return stopped('degraded', postReview, baseVerdict, lifecycleReasons);
    }
  }
  return applyRuntimeCertification(postDecision, input.specialistRuntime);
}
