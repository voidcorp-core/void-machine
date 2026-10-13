import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContextPack, sealEvidence, type CanonicalEvent } from '@voidcorp/mission-engine';
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


const blocker = { id: 'authorization', severity: 'high', classification: 'blocking',
  summary: 'Authorization absent', evidence: [{ path: 'auth.ts', line: 8, detail: 'Role unchecked' }],
  recommendation: 'Check role', criterion: 'Only authorized access', consequence: 'Unauthorized access',
  resolutionCondition: 'Unauthorized request rejected', basis: 'initial-scope-defect' } as const;
const proofId = 'evd_00000000-0000-4000-8000-000000000001';

describe('native targeted review historical blockers', () => {
  it.each(['unresolved', 'omitted', 'missing-proof', 'tampered', 'failed', 'stale', 'foreign', 'future', 'fresh'] as const)
  ('reconciles %s evidence before accepting a clean review', async mode => {
    const f = await fixture();
    const prior = f.events.find(event => event.kind === 'specialist.completed');
    if (prior === undefined) throw Error('fixture missing completion');
    const resolutions = mode === 'omitted' ? [] : [{ findingId: blocker.id,
      status: mode === 'unresolved' ? 'unresolved' : 'resolved', proofIds: [proofId] }];
    const scope = { kind: 'targeted', findingIds: [blocker.id], affectedPaths: ['auth.ts'] } as const;
    const corrected = { ...completion, completionId: 'cmp_correction_1234', review: {
      ...completion.review, scope, resolutions,
      provenance: { kind: 'native-context', contextId: '/root/correction/reviewer' } } };
    const { contextPack: _contextPack, ...dispatch } = envelope;
    const historical: CanonicalEvent = { ...prior, payload: { ...dispatch, contextId,
      completion: { ...completion, verdict: 'changes-requested', findings: [blocker] } } };
    const current = f.events.filter(event => event.kind.startsWith('specialist.')).map((event, i) => ({
      ...event, seq: prior.seq + 3 + i, eventId: `evt_correction_${i}`, payload: {
        ...dispatch, reviewRound: 2, reviewScope: scope, contextId: '/root/correction/reviewer',
        ...(event.kind === 'specialist.completed' ? { completion: corrected } : {}),
      },
    }));
    const hash = mode === 'stale' ? `sha256:${'b'.repeat(64)}` : HASH;
    const proof = sealEvidence({ schemaVersion: 1, evidenceId: proofId,
      missionId: mode === 'foreign' ? 'mis_other_12345678' : subject.taskId,
      type: 'command', producer: 'void-harness:mission.verify', source: 'command:pnpm',
      environment: { runtime: 'node:v24', platform: 'darwin', arch: 'arm64' }, confidence: 'high',
      inputHash: HASH, diffHash: hash, startedAt: '2026-10-08T12:00:00Z', finishedAt: '2026-10-08T12:00:01Z',
      durationMs: 1000, status: mode === 'failed' ? 'failed' : 'passed', exitCode: mode === 'failed' ? 1 : 0,
      command: ['pnpm', 'test'], affectedNodes: [], output: { stdout: 'ok', stderr: '', truncated: false },
      dependencies: [{ kind: 'diff', key: 'git:working-tree', hash }],
    });
    const evidence: CanonicalEvent = { ...prior, kind: 'evidence.recorded', subject: proofId,
      seq: mode === 'future' ? prior.seq + 10 : prior.seq + 1, eventId: 'evt_proof_1234',
      payload: { evidence: { ...proof, environment: { ...proof.environment }, output: { ...proof.output },
        dependencies: proof.dependencies.map(dependency => ({ ...dependency })), ...(mode === 'tampered' ? { durationMs: 2 } : {}) } } };
    const events = [...f.events.filter(event => event !== prior), historical,
      ...(mode === 'missing-proof' ? [] : [evidence]), ...current].sort((a, b) => a.seq - b.seq);
    const collected = collectNativeReview(f.root, events, subject, 'writer:primary', 2,
      { dependencies: { 'git:working-tree': HASH } });
    if (mode === 'fresh') await expect(collected).resolves.toMatchObject({ completion: corrected });
    else await expect(collected).rejects.toThrow(/NATIVE_REVIEW_REFUSED/);
  });
});
