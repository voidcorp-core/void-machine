import { describe, expect, it } from 'vitest';
import type { Evidence } from '../evidence/types.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import { sealEvidence } from '../evidence/schema.js';
import { evidenceDraft, DIFF_A, INPUT_A } from '../test/evidence.js';
import { event } from '../test/events.js';
import { reduceEvidenceObligations, type EvidenceObligationInput } from './evidence-obligations.js';

const specialistId = 'core:test-qa-engineer';
const completion = {
  schemaVersion: 1, specialistId, contractVersion: 1, completionId: 'cmp_original_01',
  verdict: 'pass', findings: [], evidenceRequests: ['Provide packaged installation proof.'],
  limitations: [],
};
const original = event({
  seq: 1, eventId: 'evt_original', subject: specialistId, kind: 'specialist.completed',
  payload: { contextId: 'ctx_original', inputHash: INPUT_A, stage: 'pre-implementation',
    reviewRound: 1, completion },
});
const binding = {
  completionEventId: original.eventId, completionHash: canonicalJsonHash(completion),
  specialistId, nativeContextId: 'ctx_clarifier', requestId: 'request_classify_1',
};
const item = {
  requestIndex: 0, requestText: completion.evidenceRequests[0],
  requestTextHash: canonicalJsonHash(completion.evidenceRequests[0]),
  due: 'post-implementation', reason: 'The implementation must exist before packaging it.',
};
function clarification(items: readonly JsonValue[] = [item], changes: Record<string, JsonValue> = {}) {
  const request = event({ seq: 2, eventId: 'evt_request',
    kind: 'specialist.evidence-classification-requested', source: 'void-harness:mission.dispatch',
    subject: specialistId, payload: binding });
  const response = event({ seq: 3, eventId: 'evt_response', causationId: request.eventId,
    kind: 'specialist.evidence-classified', subject: specialistId,
    payload: { ...binding, items, ...changes } });
  return [request, response];
}
function reduce(events: readonly CanonicalEvent[], input: Partial<EvidenceObligationInput> = {}) {
  return reduceEvidenceObligations({ events, expectedSource: 'runtime:codex',
    phase: 'pre-implementation', proofs: [], evidenceContext: {
      missionId: original.missionId,
      dependencies: { 'git:working-tree': DIFF_A, 'command:pnpm-test': INPUT_A },
    }, ...input });
}

describe('persistent specialist evidence obligations', () => {
  it('keeps legacy PASS requests blocking by default', () => {
    const state = reduce([original]);
    expect(state.obligations).toHaveLength(1);
    expect(state.blockingObligationIds).toEqual([state.obligations[0]?.obligationId]);
  });
  it('defers an explicitly classified future request and enforces it when due', () => {
    const events = [original, ...clarification()];
    const early = reduce(events);
    expect(early.obligations[0]?.due).toBe('post-implementation');
    expect(early.blockingObligationIds).toEqual([]);
    expect(reduce(events, { phase: 'post-implementation' }).blockingObligationIds)
      .toEqual([early.obligations[0]?.obligationId]);
  });
  it('retains obligations when a later completion no longer requests evidence', () => {
    const replacement = event({ seq: 4, eventId: 'evt_replacement', subject: specialistId,
      kind: 'specialist.completed', payload: { contextId: 'ctx_replacement', inputHash: DIFF_A,
        completion: { ...completion, completionId: 'cmp_replacement', evidenceRequests: [] } } });
    expect(reduce([original, ...clarification(), replacement], { phase: 'completion' })
      .blockingObligationIds).toHaveLength(1);
  });
  it.each([
    ['partial', []], ['duplicate', [item, item]],
    ['changed text', [{ ...item, requestText: 'Different request' }]],
    ['wrong text hash', [{ ...item, requestTextHash: DIFF_A }]],
    ['empty justification', [{ ...item, reason: '' }]],
  ])('refuses %s classification without dropping the original obligation', (_name, items) => {
    const state = reduce([original, ...clarification(items)]);
    expect(state.issues).not.toHaveLength(0);
    expect(state.blockingObligationIds).toHaveLength(1);
  });
  it.each([
    { completionHash: DIFF_A }, { nativeContextId: 'ctx_original' },
    { specialistId: 'core:security-engineer' }, { requestId: 'unrequested' },
  ])('refuses a response with inconsistent authorization %j', (changes) => {
    const state = reduce([original, ...clarification([item], changes)]);
    expect(state.issues).not.toHaveLength(0);
    expect(state.blockingObligationIds).toHaveLength(1);
  });
  it('refuses an unrequested or orchestrator-authored classification', () => {
    const response = clarification()[1];
    expect(response).toBeDefined();
    if (!response) return;
    expect(reduce([original, response]).issues).not.toHaveLength(0);
    expect(reduce([original, clarification()[0]!,
      { ...response, source: 'void-harness:mission.dispatch' }]).issues).not.toHaveLength(0);
  });
  it('requires fresh sealed proof and a requested author disposition for discharge', () => {
    const state = reduce([original]);
    const obligationId = state.obligations[0]?.obligationId;
    expect(obligationId).toBeDefined();
    const proof = sealEvidence(evidenceDraft());
    const proofEvent = event({ seq: 2, eventId: 'evt_proof', kind: 'evidence.recorded',
      subject: proof.evidenceId, payload: { evidence: { ...proof, environment: { ...proof.environment },
        output: { ...proof.output }, dependencies: proof.dependencies.map(value => ({ ...value })) } } });
    const request = event({ seq: 3, eventId: 'evt_discharge_request',
      source: 'void-harness:mission.dispatch', kind: 'specialist.evidence-discharge-requested',
      subject: specialistId, payload: { ...binding, nativeContextId: 'ctx_discharge',
        requestId: 'request_discharge_1', obligationIds: [obligationId ?? 'missing'] } });
    const response = event({ seq: 4, eventId: 'evt_discharge', causationId: request.eventId,
      subject: specialistId, kind: 'specialist.evidence-discharged', payload: {
        ...binding, nativeContextId: 'ctx_discharge', requestId: 'request_discharge_1',
        items: [{ obligationId: obligationId ?? 'missing', proofEventIds: [proofEvent.eventId],
          reason: 'The observed package verification addresses the original request.' }],
      } });
    const events = [original, proofEvent, request, response];
    const accepted = reduce(events, { proofs: [{ eventId: proofEvent.eventId, evidence: proof }] });
    expect(accepted.issues).toEqual([]);
    expect(accepted.obligations[0]?.discharged).toBe(true);
    expect(accepted.blockingObligationIds).toEqual([]);
    const stale = reduce(events, { proofs: [{ eventId: proofEvent.eventId, evidence: proof }],
      evidenceContext: { dependencies: { 'git:working-tree': INPUT_A } } });
    expect(stale.issues).toEqual([]);
    expect(stale.blockingObligationIds).toHaveLength(1);
    expect(reduce(events).blockingObligationIds).toHaveLength(1);
  });
});

function dischargeScenario(proof: Evidence = sealEvidence(evidenceDraft())) {
  const obligation = reduce([original]).obligations[0];
  if (!obligation) throw new Error('Original obligation required by this scenario.');
  const proofEvent = event({ seq: 2, eventId: 'evt_proof', kind: 'evidence.recorded',
    subject: proof.evidenceId, payload: { evidence: { ...proof,
      environment: { ...proof.environment }, output: { ...proof.output },
      dependencies: proof.dependencies.map(value => ({ ...value })) } } });
  const target = { ...binding, nativeContextId: 'ctx_discharge', requestId: 'request_discharge_1' };
  const request = event({ seq: 3, eventId: 'evt_discharge_request',
    source: 'void-harness:mission.dispatch', kind: 'specialist.evidence-discharge-requested',
    subject: specialistId, payload: { ...target, obligationIds: [obligation.obligationId] } });
  const response = event({ seq: 4, eventId: 'evt_discharge', causationId: request.eventId,
    subject: specialistId, kind: 'specialist.evidence-discharged', payload: {
      ...target, items: [{ obligationId: obligation.obligationId,
        proofEventIds: [proofEvent.eventId], reason: 'Requested installation is verified.' }],
    } });
  return { proof, proofEvent, request, response, obligation,
    events: [original, proofEvent, request, response] };
}

describe('evidence disposition refusal boundaries', () => {
  it.each(['failed', 'tampered', 'cross-mission'] as const)('refuses %s command proof', kind => {
    const valid = sealEvidence(evidenceDraft());
    const proof = kind === 'failed'
      ? sealEvidence(evidenceDraft({ status: 'failed', exitCode: 1 }))
      : kind === 'tampered' ? { ...valid, durationMs: valid.durationMs + 1 }
      : sealEvidence(evidenceDraft({ missionId: 'mis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    const fixture = dischargeScenario(proof);
    const state = reduce(fixture.events, { proofs: [{ eventId: fixture.proofEvent.eventId, evidence: proof }] });
    expect(state.issues).not.toHaveLength(0);
    expect(state.blockingObligationIds).toEqual([fixture.obligation.obligationId]);
  });
  it.each(['unknown-dependency', 'wrong-subject', 'before-request-origin', 'after-disposition',
    'wrong-runtime', 'missing-request', 'wrong-obligation', 'reused-context'] as const)(
    'refuses discharge with %s', kind => {
      const fixture = dischargeScenario();
      let events = fixture.events;
      if (kind === 'wrong-subject') events = events.map(value => value === fixture.proofEvent
        ? { ...value, subject: 'unrelated-proof' } : value);
      if (kind === 'before-request-origin') events = events.map(value => value === fixture.proofEvent
        ? { ...value, seq: 0 } : value);
      if (kind === 'after-disposition') events = events.map(value => value === fixture.proofEvent
        ? { ...value, seq: 5 } : value);
      if (kind === 'wrong-runtime') events = events.map(value => value === fixture.response
        ? { ...value, source: 'runtime:claude' } : value);
      if (kind === 'missing-request') events = events.filter(value => value !== fixture.request);
      if (kind === 'wrong-obligation') events = events.map(value => value === fixture.request
        ? { ...value, payload: { ...binding, nativeContextId: 'ctx_discharge',
          requestId: 'request_discharge_1', obligationIds: ['unrelated-obligation'] } } : value);
      if (kind === 'reused-context') events = events.map(value => value === fixture.request
        ? { ...value, payload: { ...binding, nativeContextId: 'ctx_original',
          requestId: 'request_discharge_1', obligationIds: [fixture.obligation.obligationId] } } : value);
      const state = reduce(events, {
        proofs: [{ eventId: fixture.proofEvent.eventId, evidence: fixture.proof }],
        ...(kind === 'unknown-dependency' ? { evidenceContext: { dependencies: {} } } : {}),
      });
      if (kind === 'unknown-dependency') expect(state.issues).toEqual([]);
      else expect(state.issues).not.toHaveLength(0);
      expect(state.blockingObligationIds).toEqual([fixture.obligation.obligationId]);
    },
  );
});

describe('future discharge freshness on resume', () => {
  it('reopens a stale future obligation only when due without treating staleness as forgery', () => {
    const fixture = dischargeScenario();
    const events = [original, ...clarification(),
      { ...fixture.proofEvent, seq: 4 }, { ...fixture.request, seq: 5 },
      { ...fixture.response, seq: 6 }];
    const proofs = [{ eventId: fixture.proofEvent.eventId, evidence: fixture.proof }];
    expect(reduce(events, { proofs }).obligations[0]?.discharged).toBe(true);
    const evidenceContext = { dependencies: {
      'git:working-tree': INPUT_A, 'command:pnpm-test': INPUT_A,
    } };
    const before = reduce(events, { proofs, evidenceContext });
    expect(before.issues).toEqual([]);
    expect(before.obligations[0]?.discharged).toBe(false);
    expect(before.blockingObligationIds).toEqual([]);
    const after = reduce(events, { proofs, evidenceContext, phase: 'post-implementation' });
    expect(after.issues).toEqual([]);
    expect(after.blockingObligationIds).toEqual([fixture.obligation.obligationId]);
  });
});

function withContext(events: readonly CanonicalEvent[], nativeContextId: string): CanonicalEvent[] {
  return events.map(value => value.kind.startsWith('specialist.evidence-')
    && typeof value.payload === 'object' && value.payload !== null && !Array.isArray(value.payload)
    ? { ...value, payload: { ...value.payload, nativeContextId } } : value);
}

describe.each(['classification', 'discharge'] as const)('opaque context %s replay', operation => {
  function scenario() {
    const fixture = dischargeScenario();
    return { events: operation === 'classification' ? [original, ...clarification()] : fixture.events,
      proofs: [{ eventId: fixture.proofEvent.eventId, evidence: fixture.proof }] };
  }
  it.each(['/root/proof_author', 'x', '/'.repeat(160)])('accepts exact fresh opaque context %j', contextId => {
    const fixture = scenario();
    const state = reduce(withContext(fixture.events, contextId), { proofs: fixture.proofs });
    expect(state.issues).toEqual([]);
    expect(state.blockingObligationIds).toEqual([]);
    if (operation === 'classification') expect(state.obligations[0]?.due).toBe('post-implementation');
    else expect(state.obligations[0]?.discharged).toBe(true);
  });
  it.each(['', '   ', 'ctx\0', 'ctx\n', 'ctx\u001f', 'ctx\u007f', 'ctx\u0080',
    'ctx\u009f', 'x'.repeat(161)])('rejects matching invalid request and response %j', contextId => {
    const fixture = scenario();
    const state = reduce(withContext(fixture.events, contextId), { proofs: fixture.proofs });
    expect(state.issues).not.toHaveLength(0);
    expect(state.blockingObligationIds).toHaveLength(1);
    expect(state.obligations[0]?.discharged).toBe(false);
    expect(state.obligations[0]?.due).toBe('current-review');
  });
  it('rejects an opaque context already used by the original specialist', () => {
    const fixture = scenario();
    const events = withContext(fixture.events, '/root/original').map(value => value === original
      ? { ...original, payload: { contextId: '/root/original', inputHash: INPUT_A,
        stage: 'pre-implementation', reviewRound: 1, completion } } : value);
    const state = reduce(events, { proofs: fixture.proofs });
    expect(state.issues).not.toHaveLength(0);
    expect(state.blockingObligationIds).toHaveLength(1);
  });
});
