import { describe, expect, it } from 'vitest';
import { admitLocalReview } from './judgments.js';

const subject = { taskId: 'mis_native_12345678', baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40),
  acceptanceCriteriaHash: `sha256:${'c'.repeat(64)}` };
const receipt = { ...subject, writerId: 'writer:primary', reviewerId: 'reviewer:independent', readOnly: true,
  scope: { kind: 'general' }, proofIds: [], resolutions: [],
  provenance: { kind: 'native-context', contextId: '/root/review' } };
const review = { schemaVersion: 1, ticketId: 'DEV-1016', pullRequest: 42, headSha: subject.reviewedCommit,
  subject, attempts: [{ startedAt: 1, endedAt: 2, invocationEventId: 'evt_actual_start' }],
  verdict: { receipt, invocationEventId: 'evt_actual_start', completionEventId: 'evt_actual_completion',
    recordedAt: 2, verdict: { headSha: subject.reviewedCommit, round: 1, blocking: [], advisory: [] } } };
describe('local native verdict admission', () => {
  it('admits a canonical receipt bound to its actual invocation and exact subject', () => {
    expect(admitLocalReview(review).ok).toBe(true);
  });
  it.each([
    { ...receipt, reviewedCommit: 'd'.repeat(40) }, { ...receipt, baseCommit: 'd'.repeat(40) },
    { ...receipt, acceptanceCriteriaHash: `sha256:${'d'.repeat(64)}` },
    { ...receipt, reviewerId: receipt.writerId }, { ...receipt, readOnly: false },
  ])('refuses changed or self-declared review provenance (%#)', changed => {
    expect(admitLocalReview({ ...review, verdict: { ...review.verdict, receipt: changed } }).ok).toBe(false);
  });
  it('refuses receipt without its attempt and refuses a done report as a verdict', () => {
    expect(admitLocalReview({ ...review, attempts: [] }).ok).toBe(false);
    expect(admitLocalReview({ ...review, verdict: { status: 'done', tests: 'passed' } }).ok).toBe(false);
  });
});
