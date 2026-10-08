import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContextPack } from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { parseSpecialistLifecycleInput, recordSpecialistLifecycle, recordSpecialistRequests } from '../runs/specialist-lifecycle.js';
import { createMission, inspectMission } from '../runs/store.js';
import { collectNativeReview } from './native-review.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const subject = { taskId: 'mis_native_review_1234', baseCommit: 'a'.repeat(40),
  reviewedCommit: 'b'.repeat(40), acceptanceCriteriaHash: HASH };
const envelope = { schemaVersion: 1, missionId: subject.taskId, runtime: 'codex',
  specialistId: 'core:independent-code-reviewer', agentName: 'independent-code-reviewer',
  contractVersion: 1, stage: 'post-implementation', reviewRound: 1, inputHash: HASH,
  reviewSubject: subject, reviewScope: { kind: 'general' },
  contextPack: compileContextPack({ diff: '+checked();', touchedPaths: ['auth.ts'], artifacts: [],
    lens: 'full', budgetTokens: 12000, dispatch: { missionId: subject.taskId,
      specialistId: 'core:independent-code-reviewer', stage: 'post-implementation', reviewRound: 1, inputHash: HASH } }),
} as const;
const contextId = '/root/review/independent';
const completion = { schemaVersion: 1, specialistId: envelope.specialistId, contractVersion: 1,
  completionId: 'cmp_native_1234', verdict: 'pass', findings: [], evidenceRequests: [], limitations: [],
  review: { ...subject, writerId: 'writer:primary', reviewerId: 'reviewer:independent', readOnly: true,
    scope: { kind: 'general' }, proofIds: [], resolutions: [],
    provenance: { kind: 'native-context', contextId } } } as const;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-review-'));
  await createMission(root, { missionId: subject.taskId, title: 'DEV-1016', mode: 'team' });
  await recordSpecialistRequests(root, subject.taskId, [envelope], HASH);
  await recordSpecialistLifecycle(root, subject.taskId,
    parseSpecialistLifecycleInput('started', { envelope, contextId }));
  await recordSpecialistLifecycle(root, subject.taskId,
    parseSpecialistLifecycleInput('completed', { envelope, contextId, completion }));
  const events = (await inspectMission(root, subject.taskId, { dependencies: {} })).stream.events;
  return { root, events };
}
describe('native independent review collection', () => {
  it('collects the actual canonical invocation without manufacturing a kernel run or UUID', async () => {
    const f = await fixture();
    const accepted = await collectNativeReview(f.root, f.events, subject, 'writer:primary', 1);
    expect(accepted.receipt.provenance).toEqual({ kind: 'native-context', contextId });
    expect(accepted.completion).toEqual(completion);
    expect(accepted.invocationEventId).toBe(f.events.find(event => event.kind === 'specialist.started')?.eventId);
    expect(accepted).not.toHaveProperty('runId');
  });
  it.each(['reviewedCommit', 'baseCommit', 'acceptanceCriteriaHash'] as const)
  ('refuses a different exact review subject: %s', async field => {
    const f = await fixture();
    const changed = { ...subject, [field]: field === 'acceptanceCriteriaHash' ? `sha256:${'c'.repeat(64)}` : 'c'.repeat(40) };
    await expect(collectNativeReview(f.root, f.events, changed, 'writer:primary', 1)).rejects.toThrow();
  });
  it('refuses a wrong writer and a review with no authentic started event', async () => {
    const f = await fixture();
    await expect(collectNativeReview(f.root, f.events, subject, 'reviewer:independent', 1)).rejects.toThrow();
    await expect(collectNativeReview(f.root, f.events.filter(event => event.kind !== 'specialist.started'),
      subject, 'writer:primary', 1)).rejects.toThrow();
  });
  it('refuses report done alone and a general review for a targeted correction round', async () => {
    const f = await fixture();
    await expect(collectNativeReview(f.root, [], subject, 'writer:primary', 1)).rejects.toThrow();
    await expect(collectNativeReview(f.root, f.events, subject, 'writer:primary', 2)).rejects.toThrow();
  });
});
