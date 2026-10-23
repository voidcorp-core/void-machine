import { describe, expect, it } from 'vitest';
import { planStoppedMissionRecovery } from './mission-recovery.js';
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
