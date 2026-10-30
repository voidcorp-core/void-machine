import type { CanonicalEvent } from '../events/types.js';
import { assessEvidence } from '../evidence/invalidation.js';
import { parseEvidence } from '../evidence/schema.js';
import type { EvidenceContext } from '../evidence/types.js';
import { isReviewScope, isReviewSubject, sameReviewSubject } from '../specialist/review-receipt.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import {
  parseSpecialistCompletionValue,
  type SpecialistCompletion,
  type SpecialistEvidence,
  type SpecialistFinding,
  type SpecialistFindingSeverity,
} from '../specialist/completion.js';
import type { EvidenceObligationState } from '../specialist/evidence-obligations.js';
import type {
  SpecialistId,
  SpecialistInvocationStage,
} from '../specialist/routing.js';

export const BOUNDED_REVIEW_BUDGET = { maxRounds: 3, maxCorrectionBatches: 2 } as const;

export type ReviewLoopStatus =
  | 'awaiting-review'
  | 'correction-required'
  | 'ready-for-verdict'
  | 'blocked'
  | 'degraded';
export type ReviewFindingSeverity = SpecialistFindingSeverity;
export type ReviewEvidence = SpecialistEvidence;

export interface NormalizedReviewFinding extends Omit<SpecialistFinding, 'id'> {
  readonly findingId: string;
  readonly sourceId: string;
  readonly severity: ReviewFindingSeverity;
  readonly summary: string;
  readonly evidence: readonly ReviewEvidence[];
  readonly recommendation: string;
  readonly reportedBy: readonly SpecialistId[];
}

export type ReviewLoopIssueCode =
  | 'invalid-completion'
  | 'wrong-specialist'
  | 'wrong-contract-version'
  | 'duplicate-completion'
  | 'reused-context'
  | 'missing-input-hash'
  | 'out-of-order-completion'
  | 'wrong-review-round'
  | 'wrong-source';

export interface ReviewLoopIssue {
  readonly code: ReviewLoopIssueCode;
  readonly eventId: string;
  readonly detail: string;
}

export interface ReviewLoopInput {
  readonly stage: SpecialistInvocationStage;
  readonly expectedSource: 'runtime:claude' | 'runtime:codex';
  readonly stageStartSeqExclusive?: number;
  readonly afterSeqExclusive?: number;
  readonly beforeSeqExclusive?: number;
  readonly events: readonly CanonicalEvent[];
  readonly requiredSpecialists: readonly SpecialistId[];
  readonly contractVersions: Readonly<Record<string, number>>;
  readonly currentInputHashes: Readonly<Record<string, string>>;
  readonly maxRounds: number;
  /** Enabled by the durable bounded-review policy; writer batches alone consume this budget. */
  readonly maxCorrectionBatches?: 2;
  readonly validProofIds?: readonly string[];
  readonly evidenceObligations?: EvidenceObligationState;
  readonly retainedSpecialists?: readonly SpecialistId[];
  /** Admission-validated contract transition; never supplied by a runtime caller. */
  readonly contractMigration?: { readonly specialistId: string; readonly afterSeq: number; readonly reviewRound: number };
}

export interface ReviewLoopState {
  readonly stage: SpecialistInvocationStage;
  readonly status: ReviewLoopStatus;
  readonly reviewRound: number;
  readonly missingSpecialists: readonly SpecialistId[];
  readonly staleSpecialists: readonly SpecialistId[];
  readonly specialistsToRun: readonly SpecialistId[];
  readonly findings: readonly NormalizedReviewFinding[];
  readonly issues: readonly ReviewLoopIssue[];
  readonly readyForVerdict: boolean;
  readonly limitations: readonly string[];
}

interface CompletionEnvelope {
  readonly event: CanonicalEvent;
  readonly stage: SpecialistInvocationStage;
  readonly reviewRound: number;
  readonly inputHash: string;
  readonly contextId?: string;
  readonly completion: SpecialistCompletion;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
/** Native context identity is opaque data, matching lifecycle ingestion. */
export function validNativeContextId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
    && [...value].every(char => char.charCodeAt(0) >= 32
      && (char.charCodeAt(0) < 127 || char.charCodeAt(0) > 159));
}
const SEVERITY_RANK: Readonly<Record<ReviewFindingSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

interface ReviewRecord extends Readonly<Record<string, unknown>> {
  readonly reviewRound?: unknown;
  readonly completion?: unknown;
  readonly inputHash?: unknown;
  readonly contextId?: unknown;
  readonly stage?: unknown;
}

function record(value: unknown): ReviewRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as ReviewRecord;
}

function specialistId(value: unknown): value is SpecialistId {
  return typeof value === 'string'
    && /^core:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function parseEnvelope(event: CanonicalEvent): CompletionEnvelope | undefined {
  const payload = record(event.payload);
  const reviewRound = payload?.reviewRound;
  const completion = parseSpecialistCompletionValue(payload?.completion);
  if (
    payload === undefined
    || !Number.isSafeInteger(reviewRound)
    || Number(reviewRound) < 1
    || Number(reviewRound) > 8
    || typeof payload.inputHash !== 'string'
    || !SHA256.test(payload.inputHash)
    || (!validNativeContextId(payload.contextId)
      && completion?.review?.provenance.kind !== 'review-artifact')
    || (payload.stage !== 'pre-implementation' && payload.stage !== 'post-implementation')
    || completion === undefined
  ) {
    return undefined;
  }
  return {
    event,
    stage: payload.stage,
    reviewRound: Number(reviewRound),
    inputHash: payload.inputHash,
    ...(typeof payload.contextId === 'string' ? { contextId: payload.contextId } : {}),
    completion,
  };
}

/** One proof-freshness rule for dispatch and recovery; callers supply observed dependencies. */
export function freshReviewProofIds(events: readonly CanonicalEvent[], context: EvidenceContext): readonly string[] {
  return events.flatMap(event => {
    if (event.kind !== 'evidence.recorded') return [];
    const parsed = parseEvidence(record(event.payload)?.['evidence']);
    return parsed.ok && parsed.value.evidenceId === event.subject
      && parsed.value.missionId === event.missionId && parsed.value.status === 'passed'
      && assessEvidence(parsed.value, context).status === 'fresh' ? [parsed.value.evidenceId] : [];
  });
}

function reviewField(event: CanonicalEvent | undefined, key: string): unknown {
  return record(event?.payload)?.[key];
}
function sameNativeDispatch(left: CanonicalEvent, right: CanonicalEvent): boolean {
  return left.missionId === right.missionId && left.subject === right.subject
    && ['stage', 'reviewRound', 'inputHash', 'contractVersion', 'reviewSubject', 'reviewScope']
      .every(key => reviewField(left, key) !== undefined && reviewField(right, key) !== undefined
        && canonicalJsonHash(reviewField(left, key)) === canonicalJsonHash(reviewField(right, key)));
}

/** Native identity is reusable only through an intact committed-subject invocation. */
function boundNativeRequest(events: readonly CanonicalEvent[], envelope: CompletionEnvelope): CanonicalEvent | undefined {
  const { event, completion, contextId } = envelope;
  const receipt = completion.review;
  const subject = reviewField(event, 'reviewSubject');
  const scope = reviewField(event, 'reviewScope');
  const start = events[0];
  if (!start || !receipt || !isReviewSubject(subject) || !isReviewScope(scope)
    || !sameReviewSubject(receipt, subject) || canonicalJsonHash(receipt.scope) !== canonicalJsonHash(scope)
    || receipt.taskId !== event.missionId || receipt.writerId !== reviewField(start, 'leadWriterId')
    || receipt.provenance.kind !== 'native-context' || receipt.provenance.contextId !== contextId
    || contextId === receipt.writerId || event.source !== `runtime:${String(reviewField(start, 'runtime'))}`
    || event.subject !== completion.specialistId || reviewField(event, 'contractVersion') !== completion.contractVersion) return undefined;
  const requests = events.filter(candidate => candidate.kind === 'specialist.requested'
    && candidate.seq < event.seq && candidate.source === 'void-harness:mission.dispatch'
    && sameNativeDispatch(candidate, event)
    && reviewField(candidate, 'planHash') === reviewField(start, 'planHash')
    && reviewField(candidate, 'runtime') === reviewField(start, 'runtime'));
  const request = requests[0];
  if (requests.length !== 1 || !request) return undefined;
  const started = events.filter(candidate => candidate.kind === 'specialist.started'
    && candidate.seq > request.seq && candidate.seq < event.seq && candidate.source === event.source
    && sameNativeDispatch(candidate, event) && reviewField(candidate, 'contextId') === contextId
    && (candidate.causationId === undefined || candidate.causationId === request.eventId));
  return started.length === 1 && (event.causationId === undefined || event.causationId === request.eventId)
    && (reviewField(event, 'reviewInvocationEventId') === undefined
      || reviewField(event, 'reviewInvocationEventId') === started[0]?.eventId) ? request : undefined;
}

function sameMembers(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === new Set(expected).size
    && new Set(actual).size === actual.length && actual.every(value => expected.includes(value));
}

function authorizedTargetedRequest(
  events: readonly CanonicalEvent[], request: CanonicalEvent, history: readonly CompletionEnvelope[],
): boolean {
  const original = history[0]?.completion.review;
  const previous = history.at(-1);
  const subject = reviewField(request, 'reviewSubject');
  const scope = reviewField(request, 'reviewScope');
  if (!original || !previous || !isReviewSubject(subject) || !isReviewScope(scope) || scope.kind !== 'targeted'
    || subject.taskId !== original.taskId || subject.baseCommit !== original.baseCommit
    || subject.acceptanceCriteriaHash !== original.acceptanceCriteriaHash
    || reviewField(request, 'contractVersion') !== previous.completion.contractVersion) return false;
  const blockers = history.flatMap(item => item.completion.findings).filter(item => item.classification === 'blocking');
  if (blockers.length === 0 || !sameMembers(scope.findingIds, blockers.map(item => item.id))
    || !sameMembers(scope.affectedPaths, blockers.flatMap(item => item.evidence.map(proof => proof.path)))) return false;
  const writers = events.filter(event => event.kind === 'lead-writer.completed'
    && event.seq > previous.event.seq && event.seq < request.seq);
  const writer = writers[0];
  const correction = events.find(event => event.eventId === reviewField(writer ?? request, 'requestEventId'));
  const count = events.filter(event => event.kind === 'lead-writer.completed' && event.seq < request.seq
    && reviewField(event, 'actionKind') === 'run-correction').length;
  if (writers.length !== 1 || !writer || !correction || count < 1 || count > 2
    || reviewField(request, 'reviewRound') !== count + 1
    || correction.kind !== 'lead-writer.requested' || correction.source !== 'void-harness:mission.dispatch'
    || correction.seq <= previous.event.seq || correction.seq >= writer.seq
    || correction.subject !== original.writerId || writer.subject !== original.writerId
    || writer.source !== original.writerId || writer.causationId !== correction.eventId
    || reviewField(writer, 'actionKind') !== 'run-correction'
    || reviewField(writer, 'planHash') !== reviewField(events[0], 'planHash')
    || reviewField(writer, 'implementationRound') !== count + 1
    || !['actionKind', 'planHash', 'writerId', 'implementationRound'].every(key =>
      reviewField(writer, key) === reviewField(correction, key))) return false;
  const open = reconcileReviewFindings(history, freshReviewProofIds(events.filter(event => event.seq < correction.seq), { dependencies: {} }))
    .filter(finding => finding.classification === 'blocking');
  return open.length > 0 && sameMembers(reviewField(correction, 'findingIds'), open.map(finding => finding.findingId));
}

/** Retained native reviewer may start a targeted correction, including after recovery. */
export function canContinueNativeReview(
  events: readonly CanonicalEvent[], request: CanonicalEvent, contextId: string,
): boolean {
  const start = events[0];
  if (!start || start.kind !== 'mission.started'
    || reviewField(request, 'planHash') !== reviewField(start, 'planHash')
    || reviewField(request, 'runtime') !== reviewField(start, 'runtime')
    || request.kind !== 'specialist.requested' || request.source !== 'void-harness:mission.dispatch'
    || request.subject !== 'core:independent-code-reviewer' || reviewField(request, 'stage') !== 'post-implementation'
    || !validNativeContextId(contextId) || events.some(event => event.missionId !== request.missionId)) return false;
  const history = events.filter(event => event.kind === 'specialist.completed' && event.seq < request.seq
    && reviewField(event, 'contextId') === contextId).map(parseEnvelope);
  if (history.length === 0 || history.some(item => !item)) return false;
  const prior = history.filter((item): item is CompletionEnvelope => item !== undefined);
  const first = prior[0];
  if (!first || first.completion.review?.scope.kind !== 'general'
    || first.completion.verdict !== 'changes-requested'
    || new Set(prior.map(item => item.completion.completionId)).size !== prior.length
    || events.some(event => event.seq < request.seq && ['specialist.started', 'specialist.completed'].includes(event.kind)
      && reviewField(event, 'contextId') === contextId
      && (event.subject !== request.subject || reviewField(event, 'stage') !== 'post-implementation'))
    || events.filter(event => event.kind === 'specialist.completed' && event.subject === request.subject
      && reviewField(event, 'stage') === 'post-implementation' && event.seq < request.seq).at(-1)?.eventId !== prior.at(-1)?.event.eventId) return false;
  for (const [index, item] of prior.entries()) {
    const bound = boundNativeRequest(events, item);
    if (!bound || item.completion.review?.reviewerId !== first.completion.review.reviewerId
      || (index > 0 && !authorizedTargetedRequest(events, bound, prior.slice(0, index)))) return false;
  }
  return authorizedTargetedRequest(events, request, prior);
}

export function validNativeReviewContinuation(
  events: readonly CanonicalEvent[], completion: CanonicalEvent,
): boolean {
  const envelope = parseEnvelope(completion);
  if (!envelope || !envelope.contextId) return false;
  const request = boundNativeRequest(events, envelope);
  const receipt = envelope.completion.review;
  if (!request || !receipt || !canContinueNativeReview(events, request, envelope.contextId)
    || receipt.scope.kind !== 'targeted') return false;
  const previous = events.filter(event => event.kind === 'specialist.completed' && event.seq < request.seq
    && reviewField(event, 'contextId') === envelope.contextId).at(-1);
  const previousReceipt = previous && parseEnvelope(previous)?.completion.review;
  const correction = events.filter(event => event.kind === 'lead-writer.requested'
    && event.seq < request.seq && reviewField(event, 'actionKind') === 'run-correction').at(-1);
  // Authenticate historical proof references, not their freshness against a later worktree.
  // Current finding resolution is owned by reconcileReviewFindings and its observed proof set.
  const historicalProofIds = freshReviewProofIds(events.filter(event => event.seq < completion.seq), { dependencies: {} });
  return receipt.reviewerId === previousReceipt?.reviewerId && correction !== undefined
    && receipt.resolutions.every(resolution => receipt.scope.kind === 'targeted'
      && receipt.scope.findingIds.includes(resolution.findingId)
      && (resolution.status !== 'resolved' || resolution.proofIds.every(id => historicalProofIds.includes(id)
        && receipt.proofIds.includes(id) && events.some(event => event.kind === 'evidence.recorded'
          && event.subject === id && event.seq > correction.seq && event.seq < completion.seq))));
}

function collectCompletions(
  events: readonly CanonicalEvent[],
  stage: SpecialistInvocationStage,
  expectedSource: ReviewLoopInput['expectedSource'],
  stageStartSeqExclusive: number | undefined,
  afterSeqExclusive: number | undefined,
  beforeSeqExclusive: number | undefined,
  maxRounds: number,
  retainedSpecialists: readonly SpecialistId[],
  contractMigration: ReviewLoopInput['contractMigration'],
  correctionBatches: number | undefined,
): {
  readonly accepted: readonly CompletionEnvelope[];
  readonly history: readonly CompletionEnvelope[];
  readonly issues: readonly ReviewLoopIssue[];
  readonly highestRound: number;
  readonly nextRound: number;
} {
  const accepted: CompletionEnvelope[] = [];
  const retained: CompletionEnvelope[] = [];
  const history: CompletionEnvelope[] = [];
  const issues: ReviewLoopIssue[] = [];
  const completionIds = new Set<string>();
  const contextIds = new Set<string>();
  const currentFailedRounds: { readonly event: CanonicalEvent; readonly round: number }[] = [];
  let historicalHighestRound = 0;
  const inStageWindow = (event: CanonicalEvent): boolean => {
    let seq = event.seq;
    // Advice belongs to the invocation that asked for it. A writer correction
    // cannot turn a genuine late round-one response into a round-two replay.
    if (stage === 'pre-implementation' && event.kind === 'specialist.completed') {
      const payload = record(event.payload);
      const mission = events.find(candidate => candidate.kind === 'mission.started'
        && candidate.missionId === event.missionId && candidate.seq < event.seq);
      const planHash = record(mission?.payload)?.['planHash'];
      const matches = (candidate: CanonicalEvent): boolean => candidate.missionId === event.missionId
        && candidate.subject === event.subject && ['stage', 'reviewRound', 'inputHash', 'contractVersion']
          .every(key => record(candidate.payload)?.[key] === payload?.[key]);
      const invocation = events.find(candidate => candidate.seq < event.seq
        && candidate.kind === 'specialist.started' && candidate.source === expectedSource
        && matches(candidate) && typeof payload?.contextId === 'string'
        && record(candidate.payload)?.contextId === payload.contextId);
      if (invocation !== undefined && events.some(candidate => candidate.seq < invocation.seq
        && candidate.kind === 'specialist.requested' && candidate.source === 'void-harness:mission.dispatch'
        && typeof planHash === 'string' && SHA256.test(planHash)
        && record(candidate.payload)?.['planHash'] === planHash
        && `runtime:${record(candidate.payload)?.['runtime']}` === expectedSource
        && matches(candidate))) seq = invocation.seq;
    }
    return (afterSeqExclusive === undefined || seq > afterSeqExclusive)
      && (beforeSeqExclusive === undefined || seq < beforeSeqExclusive);
  };
  for (const event of events) {
    const payload = record(event.payload);
    if (event.kind === 'specialist.failed') {
      // A transport failure is an unfinished review, never a writer correction.
      if (correctionBatches !== undefined) continue;
      const round = payload?.reviewRound;
      if (payload?.stage === stage && event.source !== expectedSource) {
        issues.push({
          code: 'wrong-source',
          eventId: event.eventId,
          detail: `${event.source} != ${expectedSource}`,
        });
      } else if (
        payload?.stage === stage
        && Number.isSafeInteger(round)
      ) {
        if (
          stageStartSeqExclusive !== undefined
          && event.seq > stageStartSeqExclusive
          && !inStageWindow(event)
        ) {
          historicalHighestRound = Math.max(historicalHighestRound, Number(round));
        } else if (inStageWindow(event)) {
          currentFailedRounds.push({ event, round: Number(round) });
        }
      }
      continue;
    }
    if (event.kind !== 'specialist.completed') continue;
    const envelope = parseEnvelope(event);
    if (envelope === undefined) {
      const code = specialistId(event.subject) ? 'invalid-completion' : 'wrong-specialist';
      issues.push({ code, eventId: event.eventId, detail: 'completion envelope is invalid' });
      continue;
    }
    if (envelope.completion.specialistId !== event.subject) {
      issues.push({
        code: 'wrong-specialist',
        eventId: event.eventId,
        detail: 'event subject does not match completion specialist',
      });
      continue;
    }
    if (event.source !== expectedSource) {
      issues.push({
        code: 'wrong-source',
        eventId: event.eventId,
        detail: `${event.source} != ${expectedSource}`,
      });
      continue;
    }
    const duplicateCompletion = completionIds.has(envelope.completion.completionId);
    const contextKey = envelope.contextId ?? (envelope.completion.review?.provenance.kind === 'review-artifact'
      ? `artifact:${envelope.completion.review.provenance.sha256}` : undefined);
    const reusedContext = contextKey !== undefined && contextIds.has(contextKey)
      && !(envelope.stage === 'post-implementation'
        && validNativeReviewContinuation(events, event));
    if (duplicateCompletion) {
      issues.push({
        code: 'duplicate-completion',
        eventId: event.eventId,
        detail: envelope.completion.completionId,
      });
    }
    if (reusedContext) {
      issues.push({ code: 'reused-context', eventId: event.eventId, detail: contextKey ?? 'missing' });
    }
    if (duplicateCompletion || reusedContext) {
      continue;
    }
    completionIds.add(envelope.completion.completionId);
    if (contextKey !== undefined) contextIds.add(contextKey);
    if (envelope.stage !== stage) continue;
    if (stageStartSeqExclusive !== undefined && event.seq <= stageStartSeqExclusive) {
      issues.push({
        code: 'out-of-order-completion',
        eventId: event.eventId,
        detail: `${stage} completion is outside its implementation boundary`,
      });
      continue;
    }
    if (!inStageWindow(event)) {
      if (stageStartSeqExclusive !== undefined
        && (beforeSeqExclusive === undefined || event.seq < beforeSeqExclusive)) {
        historicalHighestRound = Math.max(historicalHighestRound, envelope.reviewRound);
        history.push(envelope);
        if (retainedSpecialists.includes(envelope.completion.specialistId)) retained.push(envelope);
        continue;
      }
      issues.push({
        code: 'out-of-order-completion',
        eventId: event.eventId,
        detail: `${stage} completion is outside its implementation boundary`,
      });
      continue;
    }
    accepted.push(envelope);
  }
  const firstCurrentRound = correctionBatches === undefined
    ? historicalHighestRound + 1 : correctionBatches + 1;
  const currentRounds = [
    ...accepted.map((envelope) => ({
      event: envelope.event,
      round: envelope.reviewRound,
      specialistId: envelope.completion.specialistId,
      succeeded: true,
      envelope,
    })),
    ...currentFailedRounds.map(({ event, round }) => ({
      event,
      round,
      specialistId: specialistId(event.subject) ? event.subject : undefined,
      succeeded: false,
    })),
  ].sort((left, right) => left.event.seq - right.event.seq);
  const invalidRoundEvents = new Set<string>();
  const completedInWindow = new Set<SpecialistId>();
  const failedRoundBySpecialist = new Map<SpecialistId, number>();
  let activeRound: number | undefined;
  for (const current of currentRounds) {
    const canRetryFailure = activeRound !== undefined
      && [...failedRoundBySpecialist.values()].some((round) => round === activeRound);
    const expected = activeRound === undefined
      ? [firstCurrentRound]
      : canRetryFailure ? [activeRound, activeRound + 1] : [activeRound];
    const migratedReview = contractMigration !== undefined && stage === 'post-implementation'
      && current.specialistId === contractMigration.specialistId && current.event.seq > contractMigration.afterSeq;
    const migratedAlreadyCompleted = migratedReview && currentRounds.some(candidate =>
      candidate.event.seq < current.event.seq && candidate.event.seq > contractMigration.afterSeq
      && candidate.specialistId === current.specialistId);
    const specialistAlreadyCompleted = current.specialistId !== undefined
      && completedInWindow.has(current.specialistId);
    const priorFailureRound = current.specialistId === undefined
      ? undefined
      : failedRoundBySpecialist.get(current.specialistId);
    const retriesFailureInNextRound = priorFailureRound === undefined
      || current.round === priorFailureRound + 1;
    const respectsImplementationBoundary = stageStartSeqExclusive === undefined
      || (!specialistAlreadyCompleted && retriesFailureInNextRound);
    if (
      current.round <= maxRounds
      && (migratedReview
        ? current.round === contractMigration.reviewRound && !migratedAlreadyCompleted
        : expected.includes(current.round) && respectsImplementationBoundary)
    ) {
      activeRound = Math.max(activeRound ?? current.round, current.round);
      if (current.specialistId !== undefined) {
        if (current.succeeded) {
          completedInWindow.add(current.specialistId);
        } else {
          failedRoundBySpecialist.set(current.specialistId, current.round);
        }
      }
      continue;
    }
    invalidRoundEvents.add(current.event.eventId);
    issues.push({
      code: 'wrong-review-round',
      eventId: current.event.eventId,
      detail: specialistAlreadyCompleted
        ? `${current.specialistId} already completed within the current implementation boundary`
        : `${current.round} not in [${expected.join(', ')}], max ${maxRounds}`,
    });
  }
  const validAccepted = accepted.filter((envelope) =>
    !invalidRoundEvents.has(envelope.event.eventId)
    && !(contractMigration !== undefined && stage === 'post-implementation'
      && envelope.completion.specialistId === contractMigration.specialistId
      && envelope.event.seq < contractMigration.afterSeq));
  const highestRound = Math.max(historicalHighestRound, activeRound ?? 0);
  const pendingFailureRounds = [...failedRoundBySpecialist.entries()]
    .filter(([id]) => !validAccepted.some(item => item.completion.specialistId === id))
    .map(([, round]) => round + 1);
  const nextRound = Math.max(firstCurrentRound, highestRound, ...pendingFailureRounds);
  return { accepted: [...retained, ...validAccepted], history, issues, highestRound, nextRound };
}

function latestBySpecialist(
  completions: readonly CompletionEnvelope[],
): ReadonlyMap<SpecialistId, CompletionEnvelope> {
  const latest = new Map<SpecialistId, CompletionEnvelope>();
  for (const completion of completions) {
    const current = latest.get(completion.completion.specialistId);
    if (current === undefined || completion.event.seq > current.event.seq) {
      latest.set(completion.completion.specialistId, completion);
    }
  }
  return latest;
}

/** Shared canonical reconciliation for controller and native local review admission. */
export type ReviewFindingCompletion = Pick<CompletionEnvelope, 'event' | 'completion'>;
export function reconcileReviewFindings(
  completions: readonly ReviewFindingCompletion[], validProofIds: readonly string[],
): readonly NormalizedReviewFinding[] {
  const resolved = new Set<string>();
  for (const item of [...completions].sort((left, right) => left.event.seq - right.event.seq)) {
    for (const resolution of item.completion.review?.resolutions ?? []) {
      if (resolution.status === 'resolved' && resolution.proofIds.length > 0
        && resolution.proofIds.every(id => validProofIds.includes(id))) {
        resolved.add(resolution.findingId);
      } else {
        resolved.delete(resolution.findingId);
      }
    }
  }
  return mergeFindings([...completions])
    .filter(finding => !resolved.has(finding.sourceId));
}

function mergeFindings(
  completions: readonly ReviewFindingCompletion[],
): readonly NormalizedReviewFinding[] {
  const findings = new Map<string, NormalizedReviewFinding>();
  for (const envelope of completions) {
    for (const finding of envelope.completion.findings) {
      const proofKey = canonicalJsonHash({ evidence: finding.evidence,
        ...(finding.classification === undefined ? {} : {
          sourceId: finding.id, classification: finding.classification,
        }),
      });
      const current = findings.get(proofKey);
      if (current === undefined) {
        findings.set(proofKey, {
          ...(finding.classification === undefined ? {} : finding),
          findingId: `fnd_${proofKey.slice('sha256:'.length, 29)}`,
          sourceId: finding.id,
          severity: finding.severity,
          summary: finding.summary,
          evidence: finding.evidence,
          recommendation: finding.recommendation,
          reportedBy: [envelope.completion.specialistId],
        });
        continue;
      }
      findings.set(proofKey, {
        ...current,
        severity: SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity]
          ? finding.severity
          : current.severity,
        reportedBy: [...new Set([
          ...current.reportedBy,
          envelope.completion.specialistId,
        ])].sort(),
      });
    }
  }
  return [...findings.values()].sort((left, right) =>
    left.summary.localeCompare(right.summary)
  );
}

function decideStatus(input: {
  readonly issues: readonly ReviewLoopIssue[];
  readonly current: readonly CompletionEnvelope[];
  readonly missing: readonly SpecialistId[];
  readonly stale: readonly SpecialistId[];
  readonly findings: readonly NormalizedReviewFinding[];
  readonly correctionBatches?: number;
  readonly attemptedRound: number;
  readonly nextRound: number;
  readonly maxRounds: number;
  readonly evidenceObligations?: EvidenceObligationState;
}): ReviewLoopStatus {
  if (input.issues.length > 0) return 'degraded';
  if (input.current.some((item) => item.completion.verdict === 'degraded')) {
    return 'degraded';
  }
  if (input.stale.length > 0) {
    return input.attemptedRound >= input.maxRounds ? 'blocked' : 'awaiting-review';
  }
  if (input.missing.length > 0) {
    return input.nextRound > input.maxRounds ? 'blocked' : 'awaiting-review';
  }
  const requestsEvidence = input.evidenceObligations === undefined
    ? input.current.some((item) => item.completion.evidenceRequests.length > 0)
    : input.evidenceObligations.blockingObligationIds.length > 0;
  const requestsChanges = input.correctionBatches === undefined
    ? input.current.some((item) => item.completion.verdict === 'changes-requested'
      || item.completion.verdict === 'blocked')
    : input.findings.some(finding => finding.classification === 'blocking');
  if (requestsEvidence || requestsChanges) {
    const exhausted = input.correctionBatches === undefined
      ? input.attemptedRound >= input.maxRounds : input.correctionBatches >= 2;
    return exhausted ? 'blocked' : 'correction-required';
  }
  return 'ready-for-verdict';
}

export function reduceReviewLoop(input: ReviewLoopInput): ReviewLoopState {
  if (!Number.isSafeInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 8) {
    throw new Error('REVIEW_LOOP_INVALID: maxRounds must be an integer in [1, 8]');
  }
  if (
    new Set(input.requiredSpecialists).size !== input.requiredSpecialists.length
    || input.requiredSpecialists.some((id) => !specialistId(id))
  ) {
    throw new Error('REVIEW_LOOP_INVALID: required specialists must be unique core ids');
  }
  if (
    (input.stageStartSeqExclusive !== undefined
      && (!Number.isSafeInteger(input.stageStartSeqExclusive)
        || input.stageStartSeqExclusive < 1))
    || (input.afterSeqExclusive !== undefined
      && (!Number.isSafeInteger(input.afterSeqExclusive) || input.afterSeqExclusive < 1))
    || (input.beforeSeqExclusive !== undefined
      && (!Number.isSafeInteger(input.beforeSeqExclusive) || input.beforeSeqExclusive < 1))
    || (
      input.stageStartSeqExclusive !== undefined
      && input.afterSeqExclusive !== undefined
      && input.stageStartSeqExclusive > input.afterSeqExclusive
    )
    || (
      input.afterSeqExclusive !== undefined
      && input.beforeSeqExclusive !== undefined
      && input.afterSeqExclusive >= input.beforeSeqExclusive
    )
  ) {
    throw new Error('REVIEW_LOOP_INVALID: event sequence boundaries are invalid');
  }
  if (input.retainedSpecialists !== undefined && (
    input.stageStartSeqExclusive === undefined || input.afterSeqExclusive === undefined
    || input.retainedSpecialists.some((id) => !input.requiredSpecialists.includes(id))
  )) {
    throw new Error('REVIEW_LOOP_INVALID: retained specialists require an explicit correction window');
  }
  if (input.maxCorrectionBatches !== undefined && input.maxCorrectionBatches !== 2) {
    throw new Error('REVIEW_LOOP_INVALID: bounded review allows exactly two correction batches');
  }
  const correctionBatches = input.maxCorrectionBatches === undefined ? undefined
    : input.events.filter(event => event.kind === 'lead-writer.completed'
      && record(event.payload)?.['actionKind'] === 'run-correction').length;
  const collected = collectCompletions(
    input.events,
    input.stage,
    input.expectedSource,
    input.stageStartSeqExclusive,
    input.afterSeqExclusive,
    input.beforeSeqExclusive,
    input.maxRounds,
    input.retainedSpecialists ?? [],
    input.contractMigration,
    correctionBatches,
  );
  const configurationIssues: ReviewLoopIssue[] = input.requiredSpecialists.flatMap((id) => {
    const version = input.contractVersions[id];
    if (!Number.isSafeInteger(version) || Number(version) < 1 || Number(version) > 10_000) {
      throw new Error(`REVIEW_LOOP_INVALID: missing contract version for '${id}'`);
    }
    return SHA256.test(input.currentInputHashes[id] ?? '')
      ? []
      : [{
        code: 'missing-input-hash' as const,
        eventId: 'configuration',
        detail: id,
      }];
  });
  const latest = latestBySpecialist(collected.accepted);
  const versionIssues: ReviewLoopIssue[] = input.requiredSpecialists.flatMap((id) => {
    const completion = latest.get(id);
    return completion !== undefined
      && completion.completion.contractVersion !== input.contractVersions[id]
      ? [{
        code: 'wrong-contract-version' as const,
        eventId: completion.event.eventId,
        detail: `${completion.completion.contractVersion} != ${input.contractVersions[id]}`,
      }]
      : [];
  });
  const issues = Object.freeze([
    ...collected.issues,
    ...configurationIssues,
    ...versionIssues,
  ]);
  const missing = input.requiredSpecialists.filter((id) => !latest.has(id));
  const stale = input.requiredSpecialists.filter((id) => {
    const completion = latest.get(id);
    return completion !== undefined && (
      completion.inputHash !== input.currentInputHashes[id]
      || completion.completion.contractVersion !== input.contractVersions[id]
    );
  });
  const current = input.requiredSpecialists.flatMap((id) => {
    const completion = latest.get(id);
    return completion === undefined || stale.includes(id) ? [] : [completion];
  });
  const migrationPending = input.stage === 'post-implementation' && input.contractMigration !== undefined
    && !current.some(x => x.completion.specialistId === input.contractMigration?.specialistId);
  const nextRound = migrationPending
    ? Math.max(collected.nextRound, input.contractMigration?.reviewRound ?? 1) : collected.nextRound;
  const history = input.maxCorrectionBatches === undefined ? [] : collected.history.filter(item =>
    input.requiredSpecialists.includes(item.completion.specialistId));
  const findings = reconcileReviewFindings([...history, ...current], input.validProofIds ?? []);
  const status = decideStatus({
    issues,
    current,
    missing,
    stale,
    findings,
    ...(correctionBatches === undefined ? {} : { correctionBatches }),
    attemptedRound: collected.highestRound,
    nextRound,
    maxRounds: input.maxRounds,
    ...(input.evidenceObligations === undefined ? {} : {
      evidenceObligations: input.evidenceObligations,
    }),
  });
  const reviewRound = status === 'awaiting-review'
    ? Math.min(input.maxRounds, nextRound)
    : Math.max(1, collected.highestRound);
  return {
    stage: input.stage,
    status,
    reviewRound,
    missingSpecialists: missing,
    staleSpecialists: stale,
    specialistsToRun: input.requiredSpecialists.filter((id) =>
      missing.includes(id) || stale.includes(id)
    ),
    findings,
    issues,
    readyForVerdict: status === 'ready-for-verdict',
    limitations: current.flatMap((item) => item.completion.limitations.map((limitation) =>
      `${item.completion.specialistId}: ${limitation}`)),
  };
}
