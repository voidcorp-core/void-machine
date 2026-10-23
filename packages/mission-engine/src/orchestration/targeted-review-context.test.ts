import { orchestrateMissionTeam } from './controller.js';
import { DIFF_HASH, PLAN_HASH } from '../test/targeted-review.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { replayEventLog, serializeEvent } from '../events/index.js';
import { event } from '../test/events.js';
import { CONTEXT, REVIEWER } from '../test/targeted-review.js';
import { describe, expect, it } from 'vitest';
import { planStoppedMissionRecovery, validatedRecoveredReviewEvents } from './mission-recovery.js';
import { stoppedTargetedReview, targetedReviewFixture } from '../test/targeted-review.js';
import { reduceReviewLoop } from './review-loop.js';

describe('native targeted review continuity', () => {
  it('retains the initial reviewer for a bound correction and resolves its finding', () => {
    const fixture = targetedReviewFixture();
    expect(reduceReviewLoop(fixture.input)).toMatchObject({ status: 'ready-for-verdict',
      issues: [], findings: [], reviewRound: 2, limitations: ['core:independent-code-reviewer: Unchanged conclusions remain valid.'] });
  });
  it('allows a second bounded correction in the same native context', () => {
    expect(reduceReviewLoop(targetedReviewFixture(2).input)).toMatchObject({
      status: 'ready-for-verdict', issues: [], findings: [], reviewRound: 3 });
  });
  it('still refuses a third correction', () => {
    expect(reduceReviewLoop(targetedReviewFixture(3).input).readyForVerdict).toBe(false);
  });
});


it('recovers the false-positive closure without spending or resetting corrections', () => {
  expect(planStoppedMissionRecovery(stoppedTargetedReview().recovery)).toMatchObject({ kind: 'recover',
    receipt: { nextAction: 'verification', consumedCorrectionBatches: 1, remainingCorrectionBatches: 1,
      consumedRounds: 2, remainingRounds: 1, inadmissibleCompletionEventIds: [], roundCorrections: [] } });
});
it('admits completed verification at the correction limit without granting another correction', () => {
  expect(planStoppedMissionRecovery(stoppedTargetedReview(2).recovery)).toMatchObject({ kind: 'recover',
    receipt: { nextAction: 'verification', consumedCorrectionBatches: 2, remainingCorrectionBatches: 0,
      consumedRounds: 3, remainingRounds: 0 } });
});

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object fixture');
  return value as Record<string, JsonValue>;
}
function edited(events: readonly CanonicalEvent[], match: (event: CanonicalEvent) => boolean,
  change: (payload: Record<string, JsonValue>) => void): readonly CanonicalEvent[] {
  return events.map(event => {
    if (!match(event)) return event;
    const payload = object(structuredClone(event.payload));
    change(payload);
    return { ...event, payload };
  });
}
const lastCompletion = (event: CanonicalEvent) => event.kind === 'specialist.completed' && event.seq === 12;
const lastInvocation = (event: CanonicalEvent) => event.seq >= 10 && event.seq <= 12;

it.each([
  ['duplicate completion', (p: Record<string, JsonValue>) => { object(p['completion'])['completionId'] = 'cmp_targeted_0'; }],
  ['wrong commit', (p: Record<string, JsonValue>) => { object(object(p['completion'])['review'])['reviewedCommit'] = 'e'.repeat(40); }],
  ['self-review', (p: Record<string, JsonValue>) => { object(object(p['completion'])['review'])['reviewerId'] = 'writer:primary'; }],
  ['wrong input hash', (p: Record<string, JsonValue>) => { p['inputHash'] = `sha256:${'e'.repeat(64)}`; }],
  ['forged invocation link', (p: Record<string, JsonValue>) => { p['reviewInvocationEventId'] = 'evt_foreign_invocation'; }],
  ['foreign resolution', (p: Record<string, JsonValue>) => { object(object(p['completion'])['review'])['resolutions'] = [{ findingId: 'other-finding', status: 'resolved', proofIds: ['evd_targeted_proof_1'] }]; }],
] as const)('refuses %s without accepting native context reuse', (_name, change) => {
  const fixture = targetedReviewFixture();
  expect(reduceReviewLoop({ ...fixture.input, events: edited(fixture.events, lastCompletion, change) }).readyForVerdict).toBe(false);
});

it.each(['general', 'wrong base', 'wrong acceptance', 'wrong scope', 'wrong finding'] as const)(
  'refuses a consistently forged %s invocation', kind => {
    const fixture = targetedReviewFixture();
    const events = edited(fixture.events, lastInvocation, p => {
      const receipt = p['completion'] ? object(object(p['completion'])['review']) : undefined;
      const subject = object(p['reviewSubject']);
      if (kind === 'wrong base' || kind === 'wrong acceptance') {
        const key = kind === 'wrong base' ? 'baseCommit' : 'acceptanceCriteriaHash';
        const value = kind === 'wrong base' ? 'e'.repeat(40) : `sha256:${'e'.repeat(64)}`;
        subject[key] = value;
        if (receipt) receipt[key] = value;
      } else {
        const scope = kind === 'general' ? { kind: 'general' } : { kind: 'targeted',
          findingIds: [kind === 'wrong finding' ? 'unrelated-finding' : 'stale-history'],
          affectedPaths: [kind === 'wrong scope' ? 'other.ts' : 'src/history.ts'] };
        p['reviewScope'] = scope;
        if (receipt) receipt['scope'] = scope;
      }
    });
    expect(reduceReviewLoop({ ...fixture.input, events }).readyForVerdict).toBe(false);
  });
it.each(['missing start', 'missing correction request', 'unauthorized finding', 'wrong runtime', 'other specialist', 'other mission'] as const)(
  'refuses %s in the correction chain', kind => {
    const fixture = targetedReviewFixture();
    let events: readonly CanonicalEvent[] = fixture.events;
    if (kind === 'missing start') events = events.filter(event => event.seq !== 11);
    if (kind === 'missing correction request') events = events.filter(event => event.seq !== 7);
    if (kind === 'unauthorized finding') events = edited(events, event => event.seq === 7, p => { p['findingIds'] = ['fnd_unrelated']; });
    if (kind === 'wrong runtime') events = events.map(event => event.seq === 11 ? { ...event, source: 'runtime:claude' } : event);
    if (kind === 'other specialist') events = events.map(event => lastInvocation(event) ? { ...event, subject: 'core:security-engineer' } : event);
    if (kind === 'other mission') events = events.map(event => lastInvocation(event) ? { ...event, missionId: 'mis_other_12345678' } : event);
    expect(reduceReviewLoop({ ...fixture.input, events }).readyForVerdict).toBe(false);
  });
it('retains an unresolved finding and refuses stale resolution evidence', () => {
  const fixture = targetedReviewFixture();
  const events = edited(fixture.events, lastCompletion, p => {
    object(object(p['completion'])['review'])['resolutions'] = [{ findingId: 'stale-history', status: 'unresolved', proofIds: [] }];
  });
  expect(reduceReviewLoop({ ...fixture.input, events })).toMatchObject({ status: 'correction-required',
    findings: [{ sourceId: 'stale-history' }] });
  expect(reduceReviewLoop({ ...fixture.input, validProofIds: [] }).readyForVerdict).toBe(false);
});
it('rejects recycling the first correction proof in a second correction', () => {
  const fixture = targetedReviewFixture(2);
  const events = edited(fixture.events, event => event.seq === 18, p => {
    object(object(p['completion'])['review'])['resolutions'] = [{ findingId: 'stale-history', status: 'resolved', proofIds: ['evd_targeted_proof_1'] }];
  });
  expect(reduceReviewLoop({ ...fixture.input, events }).readyForVerdict).toBe(false);
});
it('does not admit reuse from a preparation specialist or from artifact provenance', () => {
  const fixture = targetedReviewFixture();
  const foreign = event({ seq: 2, eventId: 'evt_foreign_context', kind: 'specialist.started',
    subject: 'core:security-engineer', payload: { stage: 'pre-implementation', contextId: CONTEXT } });
  expect(reduceReviewLoop({ ...fixture.input, events: [foreign, ...fixture.events] }).readyForVerdict).toBe(false);
  const events = edited(fixture.events, lastCompletion, p => {
    object(object(p['completion'])['review'])['provenance'] = { kind: 'review-artifact', path: 'review.json',
      sha256: `sha256:${'e'.repeat(64)}`, limitation: 'artifact only' };
  });
  expect(reduceReviewLoop({ ...fixture.input, events }).readyForVerdict).toBe(false);
});
it('keeps legacy fresh-context completions compatible', () => {
  const fixture = targetedReviewFixture();
  const events = edited(fixture.events, lastInvocation, p => {
    if (p['contextId']) p['contextId'] = '/root/fresh_targeted';
    if (p['completion']) {
      const receipt = object(object(p['completion'])['review']);
      receipt['reviewerId'] = '/root/fresh_targeted';
      receipt['provenance'] = { kind: 'native-context', contextId: '/root/fresh_targeted' };
    }
  });
  expect(reduceReviewLoop({ ...fixture.input, events }).readyForVerdict).toBe(true);
});
it.each(['wrong subject', 'stale proof', 'stale input', 'wrong contract', 'unresolved', 'third correction', 'wrong closure', 'ambiguous effect'] as const)(
  'refuses recovery with %s', kind => {
    const fixture = stoppedTargetedReview(kind === 'third correction' ? 3 : 1);
    let input = fixture.recovery;
    if (kind === 'wrong subject') input = { ...input, observation: { ...input.observation,
      reviewSubject: { ...input.observation.reviewSubject, reviewedCommit: 'f'.repeat(40) } } };
    if (kind === 'stale proof') input = { ...input, observation: { ...input.observation, evidenceDependencies: { 'git:working-tree': `sha256:${'f'.repeat(64)}` } } };
    if (kind === 'stale input') input = { ...input, observation: { ...input.observation, currentInputHashes: { [REVIEWER]: `sha256:${'f'.repeat(64)}` } } };
    if (kind === 'wrong contract') input = { ...input, observation: { ...input.observation, contractVersions: { [REVIEWER]: 2 } } };
    if (kind === 'wrong closure' || kind === 'unresolved' || kind === 'ambiguous effect') {
      let events = edited(fixture.events, event => kind === 'wrong closure' ? event.kind === 'mission.closed' : lastCompletion(event), p => {
        if (kind === 'wrong closure') p['reason'] = 'completed';
        if (kind === 'unresolved') object(object(p['completion'])['review'])['resolutions'] = [];
      });
      const closure = events.at(-1);
      if (!closure) throw new Error('Expected closure fixture');
      if (kind === 'ambiguous effect') events = [...events.slice(0, -1), event({ seq: 13,
        eventId: 'evt_external_unknown', kind: 'orchestration.node-started', subject: 'node:effect', payload: {} }),
        { ...closure, seq: 14 }];
      input = { ...input, stream: replayEventLog(events.map(serializeEvent).join('\n')),
        request: { ...input.request, expectedJournalHash: canonicalJsonHash(events) } };
    }
    expect(planStoppedMissionRecovery(input).kind).toBe('refused');
  });
it('authenticates the recovery receipt and refuses reopening again without progress', () => {
  const fixture = stoppedTargetedReview();
  const admitted = planStoppedMissionRecovery(fixture.recovery);
  if (admitted.kind !== 'recover') throw new Error('Expected recovery');
  expect(admitted.receipt.preservedCompletionEventIds).toEqual(['evt_targeted_6', 'evt_targeted_12']);
  const recovery = event({ seq: 14, eventId: 'evt_targeted_recovered', kind: 'mission.recovered',
    subject: 'mission', source: 'void-harness:mission.recover', payload: JSON.parse(JSON.stringify(admitted.receipt)) });
  const events = [...fixture.events, recovery];
  expect(validatedRecoveredReviewEvents(events)).toEqual({ ok: true, events });
  const forged = edited(events, item => item.kind === 'mission.recovered', p => { p['remainingCorrectionBatches'] = 2; });
  expect(validatedRecoveredReviewEvents(forged).ok).toBe(false);
  const closed = event({ seq: 15, eventId: 'evt_targeted_closed_again', source: 'void-harness:mission.dispatch',
    kind: 'mission.closed', subject: 'mission', payload: { reason: 'controller-stop', episodeId: recovery.eventId } });
  const next = [...events, closed];
  expect(planStoppedMissionRecovery({ ...fixture.recovery, stream: replayEventLog(next.map(serializeEvent).join('\n')),
    request: { ...fixture.recovery.request, closureEventId: closed.eventId, expectedJournalHash: canonicalJsonHash(next) } }))
    .toMatchObject({ kind: 'refused', code: 'no-recovery-progress' });
});

it('does not let the preparation projection reject valid post-implementation continuity', () => {
  const fixture = targetedReviewFixture();
  const decision = orchestrateMissionTeam({ stream: replayEventLog(fixture.events.map(serializeEvent).join('\n')),
    plan: { planHash: PLAN_HASH, context: { status: 'complete', issues: [] }, specialists: [{ specialistId: REVIEWER,
      contractVersion: 1, state: 'applicable', stages: ['post-implementation'] }] },
    evidenceContext: { dependencies: { 'git:working-tree': DIFF_HASH } }, maxReviewRounds: 2,
    currentInputHashesByStage: { 'pre-implementation': {}, 'post-implementation': fixture.input.currentInputHashes },
    reviewSubject: fixture.subject, specialistRuntime: { status: 'available', limitations: [] } });
  expect(decision.action.kind).toBe('complete');
  expect(decision.review.issues).toEqual([]);
});

it('allows an authorized proof correction without inventing a new product commit', () => {
  const fixture = targetedReviewFixture();
  const events = edited(fixture.events, lastInvocation, p => {
    p['inputHash'] = `sha256:${'b'.repeat(64)}`;
    object(p['reviewSubject'])['reviewedCommit'] = 'b'.repeat(40);
    if (p['completion']) object(object(p['completion'])['review'])['reviewedCommit'] = 'b'.repeat(40);
  });
  expect(reduceReviewLoop({ ...fixture.input, events,
    currentInputHashes: { [REVIEWER]: `sha256:${'b'.repeat(64)}` } }).readyForVerdict).toBe(true);
});

it.each(['missing sequence', 'duplicate event', 'malformed line'] as const)(
  'refuses an altered journal with %s before considering continuation', alteration => {
    const fixture = stoppedTargetedReview();
    const lines = fixture.events.map(serializeEvent);
    if (alteration === 'missing sequence') lines.splice(4, 1);
    if (alteration === 'duplicate event') lines.push(lines[0] ?? 'invalid');
    if (alteration === 'malformed line') lines.push('{incomplete');
    const stream = replayEventLog(lines.join('\n'));
    expect(planStoppedMissionRecovery({ ...fixture.recovery, stream,
      request: { ...fixture.recovery.request, expectedJournalHash: canonicalJsonHash(stream.events) } }))
      .toMatchObject({ kind: 'refused', code: 'invalid-journal' });
  });
