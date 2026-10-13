import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContextPack } from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { parseSpecialistLifecycleInput, recordSpecialistLifecycle, recordSpecialistRequests } from './specialist-lifecycle.js';
import { createMission, inspectMission } from './store.js';
import { collectNativeReview } from '../autopilot/native-review.js';

const ID = 'mis_artifact_12345678';
const HASH = `sha256:${'a'.repeat(64)}`;
const subject = { taskId: ID, baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40), acceptanceCriteriaHash: HASH };
const envelope = { schemaVersion: 1, missionId: ID, runtime: 'codex',
  specialistId: 'core:independent-code-reviewer', agentName: 'independent-code-reviewer',
  contractVersion: 1, stage: 'post-implementation', reviewRound: 1, inputHash: HASH,
  reviewSubject: subject, reviewScope: { kind: 'general' },
  contextPack: compileContextPack({ diff: '+authenticate();', touchedPaths: ['auth.ts'], artifacts: [],
    lens: 'full', budgetTokens: 12_000, dispatch: { missionId: ID,
      specialistId: 'core:independent-code-reviewer', stage: 'post-implementation', reviewRound: 1, inputHash: HASH } }),
} as const;
const result = { schemaVersion: 1, specialistId: envelope.specialistId, contractVersion: 1,
  completionId: 'cmp_artifact_12345678', verdict: 'pass', findings: [], evidenceRequests: [], limitations: [] } as const;
const review = { ...subject, reviewerId: 'reviewer:external', writerId: 'writer:primary', readOnly: true,
  scope: { kind: 'general' }, proofIds: [], resolutions: [] } as const;
async function fixture(invoke = true) {
  const root = await mkdtemp(join(tmpdir(), 'void-review-artifact-'));
  await createMission(root, { missionId: ID, title: 'Artifact provenance', mode: 'team' });
  await recordSpecialistRequests(root, ID, [envelope], HASH);
  if (invoke) await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('started', {
    envelope, reviewerId: review.reviewerId,
    provenanceLimitation: 'Runtime context identity is unavailable; independent invocation recorded.',
  }));
  const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
  const requestEventId = events.find(item => item.kind === 'specialist.requested')?.eventId;
  const invocationEventId = events.find(item => item.kind === 'specialist.started')?.eventId ?? 'evt_missing_12345678';
  const body = JSON.stringify({ requestEventId, invocationEventId, result, review });
  const path = '.void/machine/reviews/independent.json';
  await mkdir(join(root, '.void/machine/reviews'), { recursive: true });
  await writeFile(join(root, path), body);
  const completion = { ...result, review: { ...review, provenance: { kind: 'review-artifact', path,
    sha256: `sha256:${createHash('sha256').update(body).digest('hex')}`,
    limitation: 'Native context ID unavailable; original invocation and structured result retained.' } } };
  return { root, completion, invocationEventId };
}
describe('artifact backed independent invocation', () => {
  it('records a checked result tied to a real invocation without manufacturing a native ID', async () => {
    const { root, completion, invocationEventId } = await fixture();
    await recordSpecialistLifecycle(root, ID, parseSpecialistLifecycleInput('completed', { envelope, completion }));
    const terminal = (await inspectMission(root, ID, { dependencies: {} })).stream.events.at(-1);
    expect(terminal).toMatchObject({ kind: 'specialist.completed',
      payload: { reviewInvocationEventId: invocationEventId, completion } });
    expect(terminal?.payload).not.toHaveProperty('contextId');
    const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const collected = await collectNativeReview(root, events, subject, review.writerId, 1);
    expect(collected.invocationEventId).toBe(invocationEventId);
    const otherInvocation = events.map(event => event.kind === 'specialist.started'
      ? { ...event, payload: { reviewerId: 'reviewer:different', stage: 'post-implementation',
        reviewRound: 1, inputHash: HASH, contractVersion: 1, reviewSubject: subject, reviewScope: { kind: 'general' } } }
      : event);
    await expect(collectNativeReview(root, otherInvocation, subject, review.writerId, 1))
      .rejects.toThrow('matching actual independent invocation');
    await writeFile(join(root, completion.review.provenance.path), '{}');
    await expect(collectNativeReview(root, events, subject, review.writerId, 1)).rejects.toThrow('artifact bytes changed');
  });
  it('refuses a self-declared artifact without the independent invocation it claims', async () => {
    const { root, completion } = await fixture(false);
    await expect(recordSpecialistLifecycle(root, ID,
      parseSpecialistLifecycleInput('completed', { envelope, completion }))).rejects.toThrow('invocation');
  });
  it('refuses changed artifact bytes even when the receipt itself is well formed', async () => {
    const { root, completion } = await fixture();
    await writeFile(join(root, completion.review.provenance.path), '{}');
    await expect(recordSpecialistLifecycle(root, ID,
      parseSpecialistLifecycleInput('completed', { envelope, completion }))).rejects.toThrow('artifact');
  });
});
