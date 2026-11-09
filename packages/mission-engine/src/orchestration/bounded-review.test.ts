import { describe, expect, it } from 'vitest';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import { event } from '../test/events.js';
import { reduceReviewLoop } from './review-loop.js';

const REVIEWER = 'core:independent-code-reviewer';
const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER_HASH = `sha256:${'b'.repeat(64)}`;
const finding = (classification: 'blocking' | 'advisory', id = 'authorization'): JsonValue => ({
  id, severity: 'high', summary: 'Authorization check',
  evidence: [{ path: 'src/auth.ts', line: 8, detail: 'Untrusted role controls access.' }],
  recommendation: 'Use the authenticated principal.',
  classification,
  ...(classification === 'blocking' ? {
    criterion: 'Only authorized principals may access another tenant.',
    consequence: 'An unauthenticated request can read another tenant.',
    resolutionCondition: 'The unauthorized request is rejected by the regression test.',
    basis: 'initial-scope-defect',
  } : {}),
});
function completed(seq: number, round: number, findings: readonly JsonValue[] = [], hash = HASH): CanonicalEvent {
  return event({ seq, eventId: `evt_review_${seq}`, kind: 'specialist.completed',
    subject: REVIEWER, payload: { stage: 'post-implementation', reviewRound: round,
      inputHash: hash, contextId: `ctx_review_${seq}`, completion: {
        schemaVersion: 1, specialistId: REVIEWER, contractVersion: 1,
        completionId: `cmp_review_${seq}`, verdict: findings.length > 0 ? 'changes-requested' : 'pass',
        findings, evidenceRequests: [], limitations: [],
      } } });
}
function writer(seq: number, actionKind: 'run-lead-writer' | 'run-correction'): CanonicalEvent {
  return event({ seq, eventId: `evt_writer_${seq}`, kind: 'lead-writer.completed',
    subject: 'writer:primary', payload: { writerId: 'writer:primary', actionKind } });
}
function reduce(events: readonly CanonicalEvent[], hash = HASH, validProofIds: readonly string[] = []) {
  const boundary = events.filter(item => item.kind === 'lead-writer.completed').at(-1)?.seq ?? 1;
  return reduceReviewLoop({ stage: 'post-implementation', expectedSource: 'runtime:codex',
    stageStartSeqExclusive: 1, afterSeqExclusive: boundary, events,
    requiredSpecialists: [REVIEWER], contractVersions: { [REVIEWER]: 1 },
    currentInputHashes: { [REVIEWER]: hash }, maxRounds: 3,
    maxCorrectionBatches: 2, validProofIds,
  });
}
describe('bounded correction batches', () => {
  it('does not turn an advisory verdict into a correction', () => {
    expect(reduce([writer(1, 'run-lead-writer'), completed(2, 1, [finding('advisory')])]))
      .toMatchObject({ status: 'ready-for-verdict', reviewRound: 1, readyForVerdict: true });
  });
  it('does not let an advisory suppress a blocker sharing the same evidence', () => {
    expect(reduce([writer(1, 'run-lead-writer'), completed(2, 1, [
      finding('advisory', 'naming'), finding('blocking'),
    ])])).toMatchObject({ status: 'correction-required', readyForVerdict: false });
  });
  it('does not spend a correction batch on transport or incomplete review', () => {
    const events = [writer(1, 'run-lead-writer'), event({ seq: 2, kind: 'specialist.failed',
      subject: REVIEWER, payload: { stage: 'post-implementation', reviewRound: 1,
        reason: 'Transport interrupted', inputHash: HASH, contextId: 'ctx_failed' } })];
    expect(reduce(events)).toMatchObject({ status: 'awaiting-review', reviewRound: 1 });
    expect(reduce([...events, completed(3, 1)])).toMatchObject({ status: 'ready-for-verdict' });
  });
  it('allows the second correction batch and never a third', () => {
    const initial = [writer(1, 'run-lead-writer'), completed(2, 1, [finding('blocking')]),
      writer(3, 'run-correction'), completed(4, 2, [finding('blocking')])];
    expect(reduce(initial)).toMatchObject({ status: 'correction-required' });
    expect(reduce([...initial, writer(5, 'run-correction'), completed(6, 3, [finding('blocking')])]))
      .toMatchObject({ status: 'blocked', readyForVerdict: false });
  });
  it('replays the same budget and history on resume', () => {
    const events = [writer(1, 'run-lead-writer'), completed(2, 1, [finding('blocking')]),
      writer(3, 'run-correction'), completed(4, 2, [finding('blocking')]),
      writer(5, 'run-correction'), completed(6, 3, [finding('blocking')])];
    expect(reduce(events)).toEqual(reduce(JSON.parse(JSON.stringify(events))));
    expect(reduce(events).status).toBe('blocked');
  });
  it('invalidates a changed review input without accepting an old proof', () => {
    expect(reduce([writer(1, 'run-lead-writer'), completed(2, 1)], OTHER_HASH))
      .toMatchObject({ readyForVerdict: false, staleSpecialists: [REVIEWER] });
  });
});

import { replayEventLog, serializeEvent } from '../events/index.js';
import { orchestrateMissionTeam } from './controller.js';

const ARCHITECT = 'core:solution-architect';
const PLAN_HASH = `sha256:${'f'.repeat(64)}`;
function controller(events: readonly CanonicalEvent[]) {
  return orchestrateMissionTeam({
    plan: { planHash: PLAN_HASH, context: { status: 'complete', issues: [] }, specialists: [
      { specialistId: ARCHITECT, state: 'applicable', contractVersion: 1,
        stages: ['pre-implementation', 'post-implementation'] },
      { specialistId: REVIEWER, state: 'applicable', contractVersion: 1,
        stages: ['post-implementation'] },
    ] },
    stream: replayEventLog(`${events.map(serializeEvent).join('\n')}\n`),
    evidenceContext: { dependencies: {} },
    currentInputHashesByStage: { 'pre-implementation': { [ARCHITECT]: HASH },
      'post-implementation': { [ARCHITECT]: HASH, [REVIEWER]: HASH } },
    specialistRuntime: { status: 'available', limitations: [] }, maxReviewRounds: 2,
  });
}
function history(): CanonicalEvent[] {
  const preparation = completed(2, 1);
  if (typeof preparation.payload !== 'object' || preparation.payload === null
    || Array.isArray(preparation.payload)) throw new Error('Expected completion payload');
  const result = preparation.payload.completion;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Expected result');
  return [event({ kind: 'mission.started', payload: { title: 'Authorization', mode: 'team',
    runtime: 'codex', leadWriterId: 'writer:primary', planHash: PLAN_HASH,
    reviewPolicy: 'bounded-corrections-v1' } }),
    { ...preparation, subject: ARCHITECT, payload: { ...preparation.payload,
      stage: 'pre-implementation', completion: { ...result, specialistId: ARCHITECT } } },
    writer(3, 'run-lead-writer')];
}
describe('bounded controller routing', () => {
  it('runs one general reviewer after the preparation specialists', () => {
    expect(controller(history()).action).toMatchObject({ kind: 'invoke-specialists',
      specialistIds: [REVIEWER], reviewRound: 1,
      reviewScope: { kind: 'general' } });
  });
  it('targets the recorded blocker after correction without rerunning the preparation panel', () => {
    expect(controller([...history(), completed(4, 1, [finding('blocking')]), writer(5, 'run-correction')]).action)
      .toMatchObject({ kind: 'invoke-specialists', specialistIds: [REVIEWER], reviewRound: 2,
        reviewScope: { kind: 'targeted', findingIds: ['authorization'], affectedPaths: ['src/auth.ts'] } });
  });
});

describe('retained review conclusions', () => {
  it('retains an unaffected resolution across the second correction batch', () => {
    const resolved = (seq: number, round: number, id: string, findings: readonly JsonValue[], hash: string,
      status: 'resolved' | 'unresolved' = 'resolved') =>
      event({ seq, eventId: `evt_review_${seq}`, kind: 'specialist.completed', subject: REVIEWER,
        payload: { stage: 'post-implementation', reviewRound: round, inputHash: hash,
          contextId: `ctx_review_${seq}`, completion: {
            schemaVersion: 1, specialistId: REVIEWER, contractVersion: 1,
            completionId: `cmp_review_${seq}`, verdict: findings.length > 0 ? 'changes-requested' : 'pass',
            findings, evidenceRequests: [], limitations: [],
            review: { taskId: event().missionId, reviewerId: 'reviewer:independent',
              writerId: 'writer:primary', baseCommit: 'a'.repeat(40), reviewedCommit: 'b'.repeat(40),
              acceptanceCriteriaHash: HASH, readOnly: true,
              scope: { kind: 'targeted', findingIds: [id], affectedPaths: ['src/auth.ts'] },
              proofIds: [`evd_proof_${id}`],
              resolutions: [{ findingId: id, status, proofIds: [`evd_proof_${id}`] }],
              provenance: { kind: 'native-context', contextId: `ctx_review_${seq}` },
            },
          } },
      });
    const firstBatch = [writer(1, 'run-lead-writer'), completed(2, 1, [finding('blocking', 'defect-a')]),
      writer(3, 'run-correction'), resolved(4, 2, 'defect-a', [finding('blocking', 'defect-b')], HASH)];
    expect(reduce(firstBatch, HASH, ['evd_proof_defect-a']).findings.map(item => item.sourceId))
      .toEqual(['defect-b']);
    const secondBatch = [...firstBatch, writer(5, 'run-correction'), resolved(6, 3, 'defect-b', [], OTHER_HASH)];
    expect(reduce(secondBatch, OTHER_HASH, ['evd_proof_defect-a', 'evd_proof_defect-b']))
      .toMatchObject({ status: 'ready-for-verdict', readyForVerdict: true, findings: [] });
    const expiredProof = reduce(secondBatch, OTHER_HASH, ['evd_proof_defect-b']);
    expect(expiredProof).toMatchObject({ status: 'blocked', readyForVerdict: false });
    expect(expiredProof.findings.map(item => item.sourceId)).toEqual(['defect-a']);
    const reopened = [...firstBatch, writer(5, 'run-correction'),
      resolved(6, 3, 'defect-a', [], OTHER_HASH, 'unresolved')];
    expect(reduce(reopened, OTHER_HASH, ['evd_proof_defect-a']).findings.map(item => item.sourceId))
      .toContain('defect-a');
  });
  it('does not silently drop an original blocker when targeted verification says pass', () => {
    expect(reduce([writer(1, 'run-lead-writer'), completed(2, 1, [finding('blocking')]),
      writer(3, 'run-correction'), completed(4, 2)]))
      .toMatchObject({ status: 'correction-required', readyForVerdict: false });
  });
  it('carries advisory history without scheduling another correction', () => {
    const result = reduce([writer(1, 'run-lead-writer'), completed(2, 1, [finding('advisory')]),
      writer(3, 'run-correction'), completed(4, 2)]);
    expect(result.status).toBe('ready-for-verdict');
    expect(result.findings).toHaveLength(1);
  });
});
