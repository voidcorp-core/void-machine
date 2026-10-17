import { describe, expect, it } from 'vitest';
import { replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { event } from '../test/events.js';
import { orchestrateMissionTeam, type MissionTeamControllerInput } from './controller.js';
import { planStoppedMissionRecovery, validatedRecoveredReviewEvents } from './mission-recovery.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const OLD = `sha256:${'b'.repeat(64)}`;
const IDS = ['core:security-engineer', 'core:test-qa-engineer'] as const;
const id = (seq: number) => `evt_preparation_${seq.toString().padStart(8, '0')}`;
function entry(seq: number, kind: string, subject: string, payload: JsonValue,
  source = 'runtime:codex', causationId?: string): CanonicalEvent {
  return event({ seq, eventId: id(seq), kind, subject, payload, source,
    ...(causationId === undefined ? {} : { causationId }) });
}
function triplet(seq: number, specialist: string, round: number, fresh = false) {
  const common = { stage: 'pre-implementation', reviewRound: round,
    inputHash: round === 1 ? OLD : HASH, contractVersion: 1 };
  const contextId = `context-${specialist}-${fresh ? 'fresh' : 'original'}`;
  return [entry(seq, 'specialist.requested', specialist, { ...common, runtime: 'codex', planHash: HASH }, 'void-harness:mission.dispatch'),
    entry(seq + 1, 'specialist.started', specialist, { ...common, contextId }),
    entry(seq + 2, 'specialist.completed', specialist, { ...common, contextId, completion: {
      schemaVersion: 1, specialistId: specialist, contractVersion: 1, completionId: `completion-${seq}`,
      verdict: 'pass', findings: [], evidenceRequests: [], limitations: ['Preparation scope only.'],
    } })];
}
function incident(partial = false) {
  const writer = { writerId: 'writer:primary', planHash: HASH,
    actionKind: 'run-preparation-correction', implementationRound: 1 };
  return [entry(1, 'mission.started', 'mission', { planHash: HASH, routingHash: HASH,
    runtime: 'codex', runtimeAttested: true, mode: 'fortress', leadWriterId: 'writer:primary',
    reviewPolicy: 'bounded-corrections-v1' }, 'void-harness:mission'),
  ...triplet(2, IDS[0], 1), ...triplet(5, IDS[1], 1),
  entry(8, 'lead-writer.requested', 'writer:primary', writer, 'void-harness:mission.dispatch'),
  entry(9, 'lead-writer.completed', 'writer:primary', { ...writer, requestEventId: id(8) }, 'writer:primary', id(8)),
  ...triplet(10, IDS[0], 2), ...triplet(13, IDS[1], 2, partial),
  entry(16, 'mission.closed', 'mission', { reason: 'controller-stop', episodeId: id(1) }, 'void-harness:mission.dispatch')];
}
function stream(events: readonly CanonicalEvent[]) { return replayEventLog(events.map(serializeEvent).join('\n')); }
function candidate(events = incident(), completionEventIds = [id(12), id(15)]) {
  return { stream: stream(events), request: { schemaVersion: 1 as const, closureEventId: events.at(-1)!.eventId,
    expectedJournalHash: canonicalJsonHash(events), disposition: { kind: 'preparation-invocation' as const, completionEventIds } },
  observation: { stage: 'pre-implementation' as const, expectedSource: 'runtime:codex' as const,
    maxRounds: 2, contractVersions: Object.fromEntries(IDS.map(id => [id, 1])),
    currentInputHashes: Object.fromEntries(IDS.map(id => [id, HASH])) } };
}
function recovered(events = incident(), completionEventIds = [id(12), id(15)]) {
  const result = planStoppedMissionRecovery(candidate(events, completionEventIds));
  expect(result.kind).toBe('recover');
  if (result.kind !== 'recover') throw new Error(JSON.stringify(result));
  return [...events, entry(17, 'mission.recovered', 'mission', JSON.parse(JSON.stringify(result.receipt)), 'void-harness:mission.recover')];
}
function decide(events: readonly CanonicalEvent[]) {
  const input: MissionTeamControllerInput = { plan: { planHash: HASH,
    context: { status: 'complete', issues: [] }, specialists: IDS.map(specialistId => ({ specialistId, contractVersion: 1,
      state: 'applicable', stages: ['pre-implementation'] })) }, stream: stream(events),
  evidenceContext: { dependencies: {} }, maxReviewRounds: 2,
  currentInputHashesByStage: { 'pre-implementation': Object.fromEntries(IDS.map(id => [id, HASH])), 'post-implementation': {} },
  specialistRuntime: { status: 'available', limitations: [] } };
  return orchestrateMissionTeam(input);
}

describe('bounded preparation invocation replacement', () => {
  it('reproduces a reused-context stop and replaces only those completions at consumed round two', () => {
    const events = incident();
    const before = canonicalJsonHash(events);
    expect(decide(events).review.issues.map(issue => issue.code)).toEqual(['reused-context', 'reused-context']);
    const next = recovered(events);
    expect(next.at(-1)?.payload).toMatchObject({ consumedRounds: 2, remainingRounds: 0,
      consumedCorrectionBatches: 0, remainingCorrectionBatches: 2,
      inadmissibleCompletionEventIds: [id(12), id(15)], roundCorrections: [], nextAction: 'verification' });
    expect(canonicalJsonHash(events)).toBe(before);
    expect(validatedRecoveredReviewEvents(next).ok).toBe(true);
    expect(decide(next).action).toEqual({ kind: 'invoke-specialists', specialistIds: IDS,
      stage: 'pre-implementation', reviewRound: 2 });
    const first = [...next, ...triplet(18, IDS[0], 2, true)];
    expect(decide(first).action).toMatchObject({ kind: 'invoke-specialists', specialistIds: [IDS[1]], reviewRound: 2 });
    expect(decide([...first, ...triplet(21, IDS[1], 2, true)]).action.kind).toBe('run-lead-writer');
  });

  it('retains a valid round-two panel member without redispatching it', () => {
    const next = recovered(incident(true), [id(12)]);
    expect(next.at(-1)?.payload).toMatchObject({ preservedCompletionEventIds: [id(15)],
      inadmissibleCompletionEventIds: [id(12)], consumedRounds: 2, remainingRounds: 0 });
    expect(decide(next).action).toMatchObject({ specialistIds: [IDS[0]], reviewRound: 2 });
  });

  it('refuses old context reuse, replacement failure and another repair without restoring budget', () => {
    const next = recovered();
    expect(decide([...next, ...triplet(18, IDS[0], 2)]).review.issues).toContainEqual(expect.objectContaining({ code: 'reused-context' }));
    const failed = [...next, entry(18, 'specialist.failed', IDS[0], { stage: 'pre-implementation', reviewRound: 2 })];
    expect(decide(failed).action.kind).toBe('stop');
    const closed = [...failed, entry(19, 'mission.closed', 'mission', { reason: 'controller-stop', episodeId: id(17) }, 'void-harness:mission.dispatch')];
    expect(planStoppedMissionRecovery(candidate(closed)).kind).toBe('refused');
  });

  it('authenticates receipts and handles identical replay without another episode', () => {
    const next = recovered();
    expect(planStoppedMissionRecovery({ ...candidate(), stream: stream(next) }).kind).toBe('already-recovered');
    const receipt = next.at(-1)!;
    const payload = receipt.payload as Record<string, JsonValue>;
    for (const edit of [{ consumedRounds: 1 }, { remainingRounds: 2 }, { inadmissibleCompletionEventIds: [id(4)] }]) {
      expect(validatedRecoveredReviewEvents([...next.slice(0, -1), { ...receipt, payload: { ...payload, ...edit } }]).ok).toBe(false);
    }
  });

  it.each(['subset', 'extra', 'duplicate', 'stale-input', 'wrong-contract', 'max-rounds', 'stale-closure', 'stale-hash'])('refuses %s recovery requests', cause => {
    const c = candidate();
    const ids = cause === 'subset' ? [id(12)] : cause === 'extra' ? [id(4), id(12), id(15)]
      : cause === 'duplicate' ? [id(12), id(12)] : c.request.disposition.completionEventIds;
    const result = planStoppedMissionRecovery({ ...c, request: { ...c.request,
      closureEventId: cause === 'stale-closure' ? id(1) : c.request.closureEventId,
      expectedJournalHash: cause === 'stale-hash' ? OLD : c.request.expectedJournalHash,
      disposition: { ...c.request.disposition, completionEventIds: ids } }, observation: { ...c.observation,
      maxRounds: cause === 'max-rounds' ? 1 : 2,
      currentInputHashes: cause === 'stale-input' ? { [IDS[0]]: OLD, [IDS[1]]: HASH } : c.observation.currentInputHashes,
      contractVersions: cause === 'wrong-contract' ? { [IDS[0]]: 2, [IDS[1]]: 1 } : c.observation.contractVersions } });
    expect(result.kind).toBe('refused');
  });

  it.each(['wrong-source', 'wrong-plan', 'missing-start', 'wrong-context', 'duplicate-completion', 'unrelated-effect', 'writer', 'human-close', 'blocker'])('refuses %s histories', cause => {
    const events = incident().map(e => {
      if (e.seq === 10 && cause === 'wrong-plan') return { ...e, payload: { ...(e.payload as Record<string, JsonValue>), planHash: OLD } };
      if (e.seq === 11 && cause === 'missing-start') return { ...e, kind: 'runtime.unknown' };
      if (e.seq === 11 && cause === 'wrong-context') return { ...e, payload: { ...(e.payload as Record<string, JsonValue>), contextId: 'other-context' } };
      if (e.seq === 12 && cause === 'wrong-source') return { ...e, source: 'runtime:claude' };
      if (e.seq === 12 && (cause === 'duplicate-completion' || cause === 'blocker')) {
        const p = e.payload as Record<string, JsonValue>;
        return { ...e, payload: { ...p, completion: { ...(p['completion'] as Record<string, JsonValue>),
          ...(cause === 'blocker' ? { verdict: 'blocked' } : { completionId: 'completion-2' }) } } };
      }
      if (e.seq === 8 && cause === 'unrelated-effect') return { ...e, kind: 'orchestration.node-started' };
      if (e.seq === 9 && cause === 'writer') return { ...e, payload: { ...(e.payload as Record<string, JsonValue>), actionKind: 'run-lead-writer' } };
      if (e.seq === 16 && cause === 'human-close') return { ...e, source: 'void-harness:mission.close' };
      return e;
    });
    expect(planStoppedMissionRecovery(candidate(events)).kind).toBe('refused');
  });
});
