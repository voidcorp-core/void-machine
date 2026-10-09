import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJsonHash, reduceEvidenceObligations } from '@voidcorp/mission-engine';
import { resolveProjectRoots } from '../project-roots.js';
import { appendMissionEvent, createMission, inspectMission } from './store.js';
import { requestSpecialistEvidence, recordSpecialistEvidence,
  parseSpecialistEvidenceRequest, parseSpecialistEvidenceResponse } from './specialist-evidence.js';

const ID = 'mis_0123456789abcdef0123456789abcdef';
const HASH = `sha256:${'a'.repeat(64)}`;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'void-evidence-clarification-'));
  roots.push(root);
  await createMission(root, { missionId: ID, title: 'Clarify proof', mode: 'team',
    teamController: { planHash: HASH, routingHash: HASH, leadWriterId: 'writer:primary',
      runtime: 'codex', runtimeAttested: true } });
  const text = 'Provide package installation verification.';
  const original = await appendMissionEvent(root, ID, { source: 'runtime:codex',
    kind: 'specialist.completed', subject: 'core:test-qa-engineer', correlationId: ID, payload: {
      stage: 'pre-implementation', reviewRound: 1, inputHash: HASH, contextId: '/root/original',
      completion: { schemaVersion: 1, specialistId: 'core:test-qa-engineer', contractVersion: 2,
        completionId: 'completion_original', verdict: 'pass', findings: [], evidenceRequests: [text], limitations: [] },
    } });
  return { root, roots: resolveProjectRoots(root), original, item: { requestIndex: 0,
    requestText: text, requestTextHash: canonicalJsonHash(text), due: 'post-implementation',
    reason: 'Packaging requires completed implementation.' } };
}
async function state(root: string) {
  const inspected = await inspectMission(root, ID, { dependencies: {} });
  return reduceEvidenceObligations({ events: inspected.stream.events, phase: 'pre-implementation',
    expectedSource: 'runtime:codex', evidenceContext: { missionId: ID, dependencies: {} }, proofs: [] });
}
describe('controller-issued specialist evidence clarification', () => {
  it.each(['/root/classifier', 'x', '/'.repeat(160)])(
    'records an opaque author classification %s idempotently without replacing its origin', async contextId => {
    const value = await fixture();
    const request = await requestSpecialistEvidence(value.roots, ID, parseSpecialistEvidenceRequest({
      operation: 'classification', completionEventId: value.original.eventId, contextId,
    }));
    expect(request.source).toBe('void-harness:mission.dispatch');
    const input = parseSpecialistEvidenceResponse('started', { requestEventId: request.eventId, contextId });
    await recordSpecialistEvidence(value.roots, ID, 'started', input);
    await recordSpecialistEvidence(value.roots, ID, 'completed',
      parseSpecialistEvidenceResponse('completed', { ...input, items: [value.item] }));
    await recordSpecialistEvidence(value.roots, ID, 'completed',
      parseSpecialistEvidenceResponse('completed', { ...input, items: [value.item] }));
    const after = await state(value.root);
    expect(after.issues).toEqual([]);
    expect(after.obligations[0]?.due).toBe('post-implementation');
    expect(after.blockingObligationIds).toEqual([]);
    const events = (await inspectMission(value.root, ID, { dependencies: {} })).stream.events;
    expect(events.filter(event => event.kind === 'specialist.evidence-classified')).toHaveLength(1);
    expect(events.find(event => event.eventId === value.original.eventId)).toEqual(value.original);
    const obligation = after.obligations[0];
    if (!obligation) throw new Error('Expected retained original obligation.');
    await expect(requestSpecialistEvidence(value.roots, ID, { operation: 'discharge',
      completionEventId: value.original.eventId, contextId,
      obligationIds: [obligation.obligationId] })).rejects.toThrow('fresh native author context');
  });
  it('refuses an unstarted response and a context reused from the original review', async () => {
    const value = await fixture();
    await expect(requestSpecialistEvidence(value.roots, ID, { operation: 'classification',
      completionEventId: value.original.eventId, contextId: '/root/original' }))
      .rejects.toThrow('SPECIALIST_EVIDENCE_INVALID');
    const request = await requestSpecialistEvidence(value.roots, ID, { operation: 'classification',
      completionEventId: value.original.eventId, contextId: 'context_fresh' });
    await expect(recordSpecialistEvidence(value.roots, ID, 'completed', {
      requestEventId: request.eventId, contextId: 'context_fresh', items: [value.item],
    })).rejects.toThrow('SPECIALIST_EVIDENCE_INVALID');
    expect((await state(value.root)).blockingObligationIds).toHaveLength(1);
  });
  it('refuses altered request text without appending or weakening the outstanding obligation', async () => {
    const value = await fixture();
    const request = await requestSpecialistEvidence(value.roots, ID, { operation: 'classification',
      completionEventId: value.original.eventId, contextId: 'context_fresh' });
    const input = { requestEventId: request.eventId, contextId: 'context_fresh' };
    await recordSpecialistEvidence(value.roots, ID, 'started', input);
    await expect(recordSpecialistEvidence(value.roots, ID, 'completed', {
      ...input, items: [{ ...value.item, requestText: 'A different requirement' }],
    })).rejects.toThrow('SPECIALIST_EVIDENCE_INVALID');
    expect((await state(value.root)).blockingObligationIds).toHaveLength(1);
  });
  it('does not discharge current obligations without canonical fresh proof events', async () => {
    const value = await fixture();
    const obligationId = (await state(value.root)).obligations[0]?.obligationId;
    if (!obligationId) throw new Error('Expected original obligation.');
    const request = await requestSpecialistEvidence(value.roots, ID, { operation: 'discharge',
      completionEventId: value.original.eventId, contextId: 'context_proof', obligationIds: [obligationId] });
    const input = { requestEventId: request.eventId, contextId: 'context_proof' };
    await recordSpecialistEvidence(value.roots, ID, 'started', input);
    await expect(recordSpecialistEvidence(value.roots, ID, 'completed', {
      ...input, items: [{ obligationId, proofEventIds: ['evt_missing_proof'], reason: 'Claim only' }],
    })).rejects.toThrow('SPECIALIST_EVIDENCE_INVALID');
    expect((await state(value.root)).blockingObligationIds).toHaveLength(1);
  });
});

it.each(['classification', 'discharge'] as const)(
  'rejects invalid fresh contexts before appending a %s request', async operation => {
    const value = await fixture();
    const before = (await inspectMission(value.root, ID, { dependencies: {} })).stream.events;
    for (const contextId of ['', '   ', 'ctx\0', 'ctx\n', 'ctx\u001f', 'ctx\u007f',
      'ctx\u0080', 'ctx\u009f', 'x'.repeat(161)]) {
      await expect(requestSpecialistEvidence(value.roots, ID, { operation,
        completionEventId: value.original.eventId, contextId }))
        .rejects.toThrow('fresh native author context');
    }
    expect((await inspectMission(value.root, ID, { dependencies: {} })).stream.events).toEqual(before);
  },
);

it.each(['classification', 'discharge'] as const)(
  'admits a fresh opaque context at the %s storage boundary', async operation => {
    const value = await fixture();
    const obligation = (await state(value.root)).obligations[0];
    if (!obligation) throw new Error('Expected original obligation.');
    const request = await requestSpecialistEvidence(value.roots, ID, { operation,
      completionEventId: value.original.eventId, contextId: '/root/evidence_author',
      ...(operation === 'discharge' ? { obligationIds: [obligation.obligationId] } : {}),
    });
    expect(request.payload).toMatchObject({ nativeContextId: '/root/evidence_author' });
    expect((await inspectMission(value.root, ID, { dependencies: {} })).stream.events)
      .toContainEqual(request);
  },
);
