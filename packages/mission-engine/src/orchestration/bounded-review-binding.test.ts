import { describe, expect, it } from 'vitest';
import { parseEvent, replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { event } from '../test/events.js';
import { evidenceDraft, DIFF_A } from '../test/evidence.js';
import { sealEvidence } from '../evidence/schema.js';
import { orchestrateMissionTeam, type MissionSpecialistPlan } from './controller.js';

const ID = 'core:independent-code-reviewer';
const HASH = `sha256:${'a'.repeat(64)}`;
const subject = { taskId: event().missionId, baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40),
  acceptanceCriteriaHash: HASH };
const receipt = { ...subject, reviewerId: 'reviewer:independent', writerId: 'writer:primary',
  readOnly: true, scope: { kind: 'general' }, proofIds: [], resolutions: [],
  provenance: { kind: 'native-context', contextId: 'ctx_independent' } };
const common = { stage: 'post-implementation', reviewRound: 1, contractVersion: 1, inputHash: HASH };
function history(review: JsonValue | undefined = receipt,
  stage = 'post-implementation'): readonly CanonicalEvent[] {
  const events = [event({ kind: 'mission.started', payload: { title: 'Bound receipt', mode: 'team',
    planHash: HASH, leadWriterId: 'writer:primary', runtime: 'codex', reviewPolicy: 'bounded-corrections-v1' } }),
    event({ seq: 2, eventId: 'evt_writer_12345678', kind: 'lead-writer.completed', subject: 'writer:primary',
      payload: { writerId: 'writer:primary', actionKind: 'run-lead-writer' } }),
    event({ seq: 3, eventId: 'evt_request_12345678', kind: 'specialist.requested', subject: ID,
      source: 'void-harness:mission.dispatch', payload: { ...common, stage, planHash: HASH, runtime: 'codex' } }),
    event({ seq: 4, eventId: 'evt_started_12345678', kind: 'specialist.started', subject: ID,
      payload: { ...common, stage, contextId: 'ctx_independent' } }),
    event({ seq: 5, eventId: 'evt_result_12345678', kind: 'specialist.completed', subject: ID,
      payload: { ...common, stage, contextId: 'ctx_independent', completion: {
        schemaVersion: 1, specialistId: ID, contractVersion: 1, completionId: 'cmp_bound_12345678',
        verdict: 'pass', findings: [], evidenceRequests: [], limitations: [],
        ...(review === undefined ? {} : { review }),
      } } })];
  return stage === 'post-implementation' ? events : events.map(item => ({ ...item,
    seq: item.kind === 'lead-writer.completed' ? 5 : item.seq > 2 ? item.seq - 1 : item.seq,
  })).sort((left, right) => left.seq - right.seq);
}
const reviewer: MissionSpecialistPlan['specialists'][number] = {
  specialistId: ID, contractVersion: 1, state: 'applicable', stages: ['post-implementation'],
};
const specialists: MissionSpecialistPlan['specialists'] = [reviewer];
function decide(events: readonly CanonicalEvent[], status: 'available' | 'unavailable' = 'available',
  routing = specialists) {
  return orchestrateMissionTeam({ plan: { planHash: HASH, context: { status: 'complete', issues: [] },
    specialists: routing },
    stream: replayEventLog(`${events.map(serializeEvent).join('\n')}\n`),
    evidenceContext: { dependencies: { 'git:working-tree': DIFF_A } },
    currentInputHashesByStage: { 'pre-implementation': { [ID]: HASH }, 'post-implementation': { [ID]: HASH } },
    maxReviewRounds: 2, reviewSubject: subject,
    specialistRuntime: { status, limitations: status === 'available' ? [] : ['Native context observation unavailable.'] },
  });
}
function commandProof(seq = 6): CanonicalEvent {
  const proof = sealEvidence(evidenceDraft());
  const parsed = parseEvent({ ...event({ seq, eventId: 'evt_proof_12345678',
    kind: 'evidence.recorded', subject: proof.evidenceId }), payload: { evidence: proof } });
  if (!parsed.ok) throw new Error('Expected valid command evidence event');
  return parsed.value;
}
describe('bounded receipt subject and invocation', () => {
  it.each([
    ['absent', []],
    ['not applicable', [{ ...reviewer, state: 'not-applicable' }]],
    ['without post stage', [{ ...reviewer, stages: ['pre-implementation'] }]],
  ] satisfies readonly (readonly [string, MissionSpecialistPlan['specialists']])[])(
    'refuses a frozen reviewer %s despite fresh command proof', (_label, routing) => {
      const events = routing[0]?.stages.includes('pre-implementation')
        ? history(receipt, 'pre-implementation') : history().slice(0, 2);
      const decision = decide([...events, commandProof(events.length + 1)], 'available', routing);
      expect(decision.action.kind).toBe('stop');
      expect(decision.verdict.status).not.toBe('verified');
      expect(decision.reasons.join(' ')).toMatch(/independent.*review.*plan/i);
      expect(decision.reasons.join(' ')).toMatch(/new mission/i);
    },
  );
  it('dispatches the mandatory reviewer before accepting fresh command proof', () => {
    expect(decide([...history().slice(0, 2), commandProof(3)]).action).toMatchObject({
      kind: 'invoke-specialists', specialistIds: [ID], stage: 'post-implementation',
      reviewScope: { kind: 'general' },
    });
    expect(decide([...history(), commandProof()]).action).toEqual({ kind: 'complete' });
  });
  it('preserves unbounded empty-panel completion', () => {
    const events = history().slice(0, 2).map(item => item.kind === 'mission.started'
      ? { ...item, payload: { title: 'Legacy', mode: 'team', planHash: HASH,
        leadWriterId: 'writer:primary', runtime: 'codex' } } : item);
    expect(decide([...events, commandProof(3)], 'available', []).action).toEqual({ kind: 'complete' });
  });
  it('accepts an independent result bound to the actual request and observed subject', () => {
    expect(decide(history()).action.kind).toBe('run-verification');
  });
  it('refuses missing receipt and changed committed subject', () => {
    const missing = history().map(item => {
      if (item.kind !== 'specialist.completed' || typeof item.payload !== 'object'
        || item.payload === null || Array.isArray(item.payload)
        || !('completion' in item.payload)) return item;
      const value = item.payload.completion;
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !('review' in value)) throw new Error('Expected result with review');
      const { review: ignored, ...completion } = value;
      return { ...item, payload: { ...item.payload, completion } };
    });
    expect(decide(missing).action.kind).toBe('stop');
    expect(decide(history({ ...receipt, reviewedCommit: 'c'.repeat(40) })).action.kind).toBe('stop');
  });
  it.each([
    { baseCommit: 'c'.repeat(40) },
    { reviewedCommit: 'd'.repeat(40) },
    { acceptanceCriteriaHash: `sha256:${'b'.repeat(64)}` },
  ])('does not retain a final PASS for changed subject %j', changed => {
    expect(decide([...history(), commandProof()]).action.kind).toBe('complete');
    const result = decide([...history({ ...receipt, ...changed }), commandProof()]);
    expect(result.action.kind).toBe('stop');
    expect(result.verdict.status).not.toBe('verified');
  });

  it('does not retain a final PASS under a changed specialist contract', () => {
    const result = decide([...history(), commandProof()], 'available', [{ ...reviewer, contractVersion: 2 }]);
    expect(result.action.kind).toBe('stop');
    expect(result.verdict.status).not.toBe('verified');
  });

  it('does not accept a declared reviewer without its real invocation', () => {
    expect(decide(history().filter(item => item.kind !== 'specialist.started')).action.kind).toBe('stop');
  });
  it('does not invalidate an already traceable independent review solely for unavailable native context observation', () => {
    expect(decide(history(), 'unavailable').action.kind).toBe('run-verification');
  });
});
