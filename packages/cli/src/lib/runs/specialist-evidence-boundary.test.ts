import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sealEvidence, reduceEvidenceObligations } from '@voidcorp/mission-engine';
import { parseMissionRecoveryRequest } from './mission-recovery.js';
import { parseMissionArgs } from '../../commands/mission.js';
import { resolveProjectRoots } from '../project-roots.js';
import { appendMissionEvent, createMission, inspectMission, recordMissionEvidence } from './store.js';
import { computeProjectState } from './project-state.js';
import { parseSpecialistEvidenceRequest, parseSpecialistEvidenceResponse, requestSpecialistEvidence, recordSpecialistEvidence } from './specialist-evidence.js';

const ID = 'mis_0123456789abcdef0123456789abcdef';
const HASH = `sha256:${'a'.repeat(64)}`;
it('routes bounded evidence request and started/completed author response commands', () => {
  expect(parseMissionArgs(['evidence-request', '--id', ID, '--input', 'request.json', '--json']))
    .toEqual({ kind: 'evidence-request', missionId: ID, inputPath: 'request.json', json: true });
  expect(parseMissionArgs(['evidence-event', '--id', ID, '--status', 'started', '--input', 'response.json']))
    .toEqual({ kind: 'evidence-event', missionId: ID, status: 'started', inputPath: 'response.json', json: false });
  expect(parseMissionArgs(['evidence-event', '--id', ID, '--status', 'pass', '--input', 'response.json']))
    .toMatchObject({ kind: 'invalid' });
});
it('accepts exact request/response contracts while refusing caller-supplied source and verdict', () => {
  const request = { operation: 'classification', completionEventId: 'evt_original_review_123', contextId: 'context_fresh' };
  expect(parseSpecialistEvidenceRequest(request)).toEqual(request);
  expect(() => parseSpecialistEvidenceRequest({ ...request, source: 'runtime:codex' }))
    .toThrow('SPECIALIST_EVIDENCE_INVALID');
  const response = { requestEventId: 'evt_request_review_123', contextId: 'context_fresh' };
  expect(parseSpecialistEvidenceResponse('started', response)).toEqual(response);
  expect(() => parseSpecialistEvidenceResponse('completed', { ...response, verdict: 'pass' }))
    .toThrow('SPECIALIST_EVIDENCE_INVALID');
  expect(() => parseSpecialistEvidenceRequest({ ...request, contextId: 'ctx\u007f' }))
    .toThrow('SPECIALIST_EVIDENCE_INVALID');
});
it.each(['fresh', 'stale', 'closed-fresh', 'closed-stale'] as const)('validates a %s canonical proof rather than accepting a discharge assertion', async freshness => {
  const root = await mkdtemp(join(tmpdir(), 'void-evidence-discharge-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const roots = resolveProjectRoots(root);
    await createMission(root, { missionId: ID, title: 'Discharge fixture', mode: 'team',
      teamController: { planHash: HASH, routingHash: HASH, runtime: 'codex', runtimeAttested: true, leadWriterId: 'writer:primary' } });
    const original = await appendMissionEvent(root, ID, { source: 'runtime:codex',
      kind: 'specialist.completed', subject: 'core:test-qa-engineer', correlationId: ID, payload: {
        contextId: 'context_original', completion: { schemaVersion: 1, specialistId: 'core:test-qa-engineer',
          contractVersion: 2, completionId: 'completion_original', verdict: 'pass', findings: [],
          evidenceRequests: ['Prove the current implementation.'], limitations: [] } } });
    const events = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    const obligation = reduceEvidenceObligations({ events, expectedSource: 'runtime:codex',
      phase: 'pre-implementation', proofs: [], evidenceContext: { dependencies: {} } }).obligations[0];
    if (!obligation) throw new Error('Expected obligation.');
    const project = await computeProjectState(root);
    const proof = sealEvidence({ schemaVersion: 1, evidenceId: 'evd_00000000-0000-4000-8000-000000000001',
      missionId: ID, type: 'command', producer: 'fixture:verification', source: 'command:fixture',
      environment: { runtime: 'node', platform: 'test', arch: 'test' }, confidence: 'high',
      inputHash: HASH, diffHash: project.diffHash, startedAt: '2026-09-19T00:00:00.000Z',
      finishedAt: '2026-09-19T00:00:01.000Z', durationMs: 1_000, status: 'passed', exitCode: 0,
      command: ['fixture'], affectedNodes: [], output: { stdout: 'passed', stderr: '', truncated: false },
      dependencies: [{ kind: 'diff', key: 'git:working-tree', hash: project.diffHash }] });
    await recordMissionEvidence(root, proof);
    const proofEvent = (await inspectMission(root, ID, { dependencies: {} })).stream.events
      .find(value => value.kind === 'evidence.recorded');
    if (!proofEvent) throw new Error('Expected canonical proof event.');
    const request = await requestSpecialistEvidence(roots, ID, parseSpecialistEvidenceRequest({
      operation: 'discharge', completionEventId: original.eventId,
      contextId: '/root/discharge', obligationIds: [obligation.obligationId],
    }));
    const response = parseSpecialistEvidenceResponse('started', {
      requestEventId: request.eventId, contextId: '/root/discharge',
    });
    await recordSpecialistEvidence(roots, ID, 'started', response);
    if (freshness.startsWith('closed')) await appendMissionEvent(root, ID, {
      source: 'void-harness:mission.dispatch', kind: 'mission.closed', subject: 'mission',
      correlationId: ID, payload: { reason: 'controller-stop' } });
    if (freshness.endsWith('stale')) await writeFile(join(root, 'changed.ts'), 'export const changed = true;\n');
    if (freshness.startsWith('closed')) {
      await expect(recordSpecialistEvidence(roots, ID, 'started', response)).rejects.toThrow('MISSION_CLOSED');
      await expect(recordSpecialistEvidence(roots, ID, 'completed', { ...response, contextId: '/root/forged', items: [] }))
        .rejects.toThrow('MISSION_CLOSED');
    }
    const complete = recordSpecialistEvidence(roots, ID, 'completed',
      parseSpecialistEvidenceResponse('completed', { ...response, items: [{
      obligationId: obligation.obligationId, proofEventIds: [proofEvent.eventId], reason: 'Observed proof addresses this request.',
    }] }));
    if (freshness.endsWith('stale')) await expect(complete).rejects.toThrow('SPECIALIST_EVIDENCE_INVALID');
    else {
      await expect(complete).resolves.toBeUndefined();
      const beforeReplay = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
      await recordSpecialistEvidence(roots, ID, 'completed', parseSpecialistEvidenceResponse('completed', {
        ...response, items: [{ obligationId: obligation.obligationId, proofEventIds: [proofEvent.eventId],
          reason: 'Observed proof addresses this request.' }],
      }));
      expect((await inspectMission(root, ID, { dependencies: {} })).stream.events).toEqual(beforeReplay);
    }
    const after = (await inspectMission(root, ID, { dependencies: {} })).stream.events;
    expect(after.filter(value => value.kind === 'specialist.evidence-discharged'))
      .toHaveLength(freshness.endsWith('fresh') ? 1 : 0);
  } finally { await rm(root, { recursive: true }); }
});

it.each(['', '   ', 'ctx\0', 'ctx\n', 'ctx\u001f', 'ctx\u007f', 'ctx\u0080',
  'ctx\u009f', 'x'.repeat(161)])('rejects invalid evidence context %j in every CLI payload', contextId => {
  for (const operation of ['classification', 'discharge']) {
    expect(() => parseSpecialistEvidenceRequest({ operation,
      completionEventId: 'evt_original_review_123', contextId,
      ...(operation === 'discharge' ? { obligationIds: [HASH] } : {}),
    })).toThrow('SPECIALIST_EVIDENCE_INVALID');
  }
  const response = { requestEventId: 'evt_request_review_123', contextId };
  expect(() => parseSpecialistEvidenceResponse('started', response)).toThrow('SPECIALIST_EVIDENCE_INVALID');
  expect(() => parseSpecialistEvidenceResponse('completed', { ...response, items: [{
    obligationId: HASH, proofEventIds: ['evt_proof_review_123'], reason: 'Observed proof.',
  }] })).toThrow('SPECIALIST_EVIDENCE_INVALID');
});

it('diagnoses the author reason length without rewriting its content', () => {
  expect(() => parseSpecialistEvidenceResponse('completed', {
    requestEventId: 'evt_request_review_123', contextId: 'context_fresh', items: [{
      obligationId: HASH, proofEventIds: ['evt_proof_review_123'], reason: 'x'.repeat(1010),
    }],
  })).toThrow('reason has 1010 characters; maximum is 1000');
});

it('accepts only exact bounded response identifiers for disposition recovery', () => {
  const request = { schemaVersion: 1, closureEventId: 'evt_closure_review_123', expectedJournalHash: HASH,
    disposition: { kind: 'evidence-disposition', responseEventIds: ['evt_discharge_review_123'] } };
  expect(parseMissionRecoveryRequest(request)).toEqual(request);
  for (const disposition of [{ ...request.disposition, responseEventIds: [] },
    { ...request.disposition, responseEventIds: ['evt_discharge_review_123', 'evt_discharge_review_123'] },
    { ...request.disposition, observation: { verified: true } }]) {
    expect(() => parseMissionRecoveryRequest({ ...request, disposition })).toThrow('MISSION_RECOVERY_INVALID');
  }
});
