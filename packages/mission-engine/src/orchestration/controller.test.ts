import { describe, expect, it } from 'vitest';
import { parseEvent, replayEventLog, serializeEvent } from '../events/index.js';
import { planSpecialistContractMigration } from './specialist-contract-migration.js';
import { planStoppedMissionRecovery } from './mission-recovery.js';
import { sealEvidence } from '../evidence/schema.js';
import { canonicalJsonHash } from '../evidence/canonical-json.js';
import type { CanonicalEvent, JsonValue } from '../events/types.js';
import type { MissionPlan } from '../mission/plan.js';
import type { SpecialistId } from '../specialist/routing.js';
import { event } from '../test/events.js';
import { DIFF_A, evidenceDraft } from '../test/evidence.js';
import { orchestrateMissionTeam } from './controller.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const TEST_SPECIALIST_IDS = Object.freeze([
  'core:solution-architect',
  'core:security-engineer',
  'core:test-qa-engineer',
] as const);
const INPUTS: Readonly<Record<string, string>> = {
  'core:solution-architect': HASH,
  'core:security-engineer': HASH,
  'core:test-qa-engineer': HASH,
};

const PLAN = {
  planHash: `sha256:${'f'.repeat(64)}`,
  applicability: [
    { pass: 'architecture', state: 'pending' },
    { pass: 'security', state: 'pending' },
    { pass: 'qa', state: 'pending' },
  ],
  specialists: TEST_SPECIALIST_IDS.map((specialistId) => ({
    specialistId,
    contractVersion: 1,
    state: 'applicable',
    stages: ['pre-implementation', 'post-implementation'],
  })),
} as MissionPlan;

function started(strictLifecycle = false): CanonicalEvent {
  return event({
    kind: 'mission.started',
    subject: 'mission',
    payload: {
      title: 'Review a vulnerable change',
      mode: 'team',
      planHash: PLAN.planHash,
      leadWriterId: 'writer:primary',
      runtime: 'codex',
      ...(strictLifecycle ? { routingHash: `sha256:${'d'.repeat(64)}` } : {}),
    },
  });
}

function writer(
  seq = 5,
  writerId = 'writer:primary',
  actionKind?: 'run-lead-writer' | 'run-correction' | 'run-preparation-correction',
): CanonicalEvent {
  return event({
    seq,
    eventId: `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind: 'lead-writer.completed',
    subject: writerId,
    payload: {
      writerId,
      planHash: PLAN.planHash,
      ...(actionKind === undefined ? {} : { actionKind }),
    },
  });
}

function completion(
  specialistId: SpecialistId,
  seq: number,
  verdict: 'pass' | 'changes-requested' | 'degraded' = 'pass',
  stage: 'pre-implementation' | 'post-implementation' = 'post-implementation',
  inputHash = HASH,
  reviewRound = 1,
  identitySuffix = String(reviewRound),
  evidenceRequests: readonly string[] = [],
  limitations: readonly string[] = [],
): CanonicalEvent {
  return event({
    seq,
    eventId: `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind: 'specialist.completed',
    subject: specialistId,
    payload: {
      stage,
      reviewRound,
      inputHash,
      contractVersion: 1,
      contextId: `ctx_${stage}_${identitySuffix}_${specialistId.slice(5)}`,
      completion: {
        schemaVersion: 1,
        specialistId,
        contractVersion: 1,
        completionId: `cmp_${stage}_${identitySuffix}_${specialistId.slice(5)}`,
        verdict,
        findings: verdict === 'changes-requested' ? [{
          id: 'auth-bypass',
          severity: 'high',
          summary: 'Authorization can be bypassed.',
          evidence: [{ path: 'src/auth.ts', line: 8, detail: 'Role comes from input.' }],
          recommendation: 'Derive authorization from the authenticated principal.',
        }] : [],
        evidenceRequests,
        limitations,
      },
    },
  });
}

function lifecycleCompletion(
  specialistId: SpecialistId,
  startSeq: number,
  stage: 'pre-implementation' | 'post-implementation',
  requestAfterStart = false,
  requestSource = 'void-harness:mission.dispatch',
): readonly CanonicalEvent[] {
  const contextId = `ctx_${stage}_1_${specialistId.slice(5)}`;
  const common = {
    contractVersion: 1,
    stage,
    reviewRound: 1,
    inputHash: HASH,
  };
  const requested = event({
      seq: startSeq + (requestAfterStart ? 1 : 0),
      eventId: `evt_requested_${startSeq}_${specialistId.slice(5)}`,
      source: requestSource,
      kind: 'specialist.requested',
      subject: specialistId,
      payload: {
        ...common,
        planHash: PLAN.planHash,
        runtime: 'codex',
        agentName: specialistId.slice(5),
      },
    });
  const startedEvent = event({
      seq: startSeq + (requestAfterStart ? 0 : 1),
      eventId: `evt_started_${startSeq}_${specialistId.slice(5)}`,
      source: 'runtime:codex',
      kind: 'specialist.started',
      subject: specialistId,
      payload: { ...common, contextId },
    });
  return [
    ...(requestAfterStart ? [startedEvent, requested] : [requested, startedEvent]),
    completion(specialistId, startSeq + 2, 'pass', stage),
  ];
}

function preReviews(inputHash = HASH): readonly CanonicalEvent[] {
  return TEST_SPECIALIST_IDS.map((specialistId, index) =>
    completion(specialistId, index + 2, 'pass', 'pre-implementation', inputHash));
}

function stream(events: readonly CanonicalEvent[]) {
  return replayEventLog(`${events.map(serializeEvent).join('\n')}\n`);
}

function decide(
  events: readonly CanonicalEvent[],
  plan: MissionPlan = PLAN,
  postInputHashes: Readonly<Record<string, string>> = INPUTS,
  preInputHashes: Readonly<Record<string, string>> = INPUTS,
  specialistRuntime: Parameters<typeof orchestrateMissionTeam>[0]['specialistRuntime'] = {
    status: 'available',
    limitations: [],
  },
) {
  return orchestrateMissionTeam({
    plan,
    stream: stream(events),
    evidenceContext: { dependencies: { 'git:working-tree': DIFF_A } },
    currentInputHashesByStage: {
      'pre-implementation': preInputHashes,
      'post-implementation': postInputHashes,
    },
    maxReviewRounds: 2,
    specialistRuntime,
  });
}

function preparationReceipt(seq = 6): readonly [CanonicalEvent, CanonicalEvent] {
  const payload = {
    writerId: 'writer:primary', planHash: PLAN.planHash,
    actionKind: 'run-preparation-correction', implementationRound: 1,
  };
  const request = event({
    seq: seq - 1,
    eventId: `evt_preparation_request_${seq}`,
    source: 'void-harness:mission.dispatch',
    kind: 'lead-writer.requested',
    subject: 'writer:primary',
    payload,
  });
  return [request, event({
    ...writer(seq),
    causationId: request.eventId,
    payload: { ...payload, requestEventId: request.eventId },
  })];
}

function preparationReviews(round: number, firstSeq: number, needsEvidence = false) {
  return TEST_SPECIALIST_IDS.map((id, index) => completion(
    id, firstSeq + index, 'pass', 'pre-implementation', HASH, round, String(round),
    needsEvidence && index === 2 ? ['Explain the preparation correction boundary.'] : [],
  ));
}

const PROOF_REQUEST = 'Provide observed packaged installation evidence.';

function jsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classifyEvidence(
  origin: CanonicalEvent,
  seq: number,
  due: 'post-implementation' | 'completion',
): readonly CanonicalEvent[] {
  if (!jsonRecord(origin.payload)) throw new Error('Expected a completion payload');
  const binding = {
    completionEventId: origin.eventId,
    completionHash: canonicalJsonHash(origin.payload['completion']),
    specialistId: origin.subject,
    nativeContextId: `ctx_classification_${seq}`,
    requestId: `request_classification_${seq}`,
  };
  const request = event({
    seq, eventId: `evt_classification_request_${seq}`,
    source: 'void-harness:mission.dispatch', subject: origin.subject,
    kind: 'specialist.evidence-classification-requested', payload: binding,
  });
  return [request, event({
    seq: seq + 1, eventId: `evt_classification_response_${seq}`,
    causationId: request.eventId, subject: origin.subject,
    kind: 'specialist.evidence-classified', payload: {
      ...binding, items: [{ requestIndex: 0, requestText: PROOF_REQUEST,
        requestTextHash: canonicalJsonHash(PROOF_REQUEST), due,
        reason: 'The executable implementation must exist before its package can be verified.' }],
    },
  })];
}

describe('mission team controller', () => {
  it('starts implementation after a finding preparation correction without replaying the panel', () => {
    const initial = [completion(TEST_SPECIALIST_IDS[0], 2, 'changes-requested', 'pre-implementation'),
      ...preReviews().slice(1)];
    const events = [started(true), ...initial];
    expect(decide(events).action.kind).toBe('run-preparation-correction');
    const corrected = [...events, ...preparationReceipt()];
    expect(decide(corrected).action).toMatchObject({
      kind: 'run-lead-writer', writerId: 'writer:primary',
    });
    expect(decide([...corrected, ...preparationReviews(2, 7)]).action.kind).toBe('stop');
  });

  it('collects every missing preparation review after correcting changed partial panel inputs', () => {
    const initial = [started(true),
      completion('core:solution-architect', 2, 'pass', 'pre-implementation')];
    const changedInputs = Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, HASH_B]));
    expect(decide(initial, PLAN, INPUTS, changedInputs).action.kind)
      .toBe('run-preparation-correction');

    const corrected = [...initial, ...preparationReceipt(4)];
    expect(decide(corrected, PLAN, INPUTS, changedInputs).action).toMatchObject({
      kind: 'invoke-specialists', specialistIds: TEST_SPECIALIST_IDS,
      stage: 'pre-implementation', reviewRound: 2,
    });
    const reviewed = [...corrected, ...TEST_SPECIALIST_IDS.map((id, index) => completion(
      id, index + 5, 'pass', 'pre-implementation', HASH_B, 2,
    ))];
    expect(decide(reviewed, PLAN, INPUTS, changedInputs).action.kind).toBe('run-lead-writer');
  });

  it.each([HASH, HASH_B])('requires a fresh targeted review after recovered preparation clarification with input %s', (architectureHash) => {
    const degraded = completion('core:test-qa-engineer', 4, 'degraded', 'pre-implementation',
      HASH, 1, 'limited', [], ['The package execution contract needs clarification.']);
    const closed = [started(), ...preReviews().slice(0, 2), degraded,
      event({ seq: 5, eventId: 'evt_recovery_closed', kind: 'mission.closed',
        payload: { reason: 'controller-stop' } })];
    const artifact = { path: 'docs/clarification.md', sha256: HASH };
    const recovery = planStoppedMissionRecovery({
      stream: stream(closed), request: {
        schemaVersion: 1, closureEventId: 'evt_recovery_closed',
        expectedJournalHash: canonicalJsonHash(closed), disposition: {
          kind: 'review-blocker', completionEventIds: [degraded.eventId],
          resolutionArtifact: artifact,
        },
      }, observation: {
        stage: 'pre-implementation', currentInputHashes: INPUTS, maxRounds: 2,
        contractVersions: Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, 1])),
        expectedSource: 'runtime:codex', resolutionArtifact: artifact,
      },
    });
    expect(recovery.kind).toBe('recover');
    if (recovery.kind !== 'recover') throw new Error('Expected supported recovery admission');
    const resumed = parseEvent({
      ...event({ seq: 6, eventId: 'evt_recovered', kind: 'mission.recovered',
        source: 'void-harness:mission.recover' }), payload: recovery.receipt,
    });
    if (!resumed.ok) throw new Error('Expected a canonical recovery receipt');
    const recovered = [...closed, resumed.value];
    expect(decide(recovered).action.kind).toBe('run-preparation-correction');
    const corrected = [...recovered, ...preparationReceipt(8)];
    const inputs = { ...INPUTS, 'core:solution-architect': architectureHash };
    const specialistIds = architectureHash === HASH
      ? ['core:test-qa-engineer'] : ['core:solution-architect', 'core:test-qa-engineer'];
    expect(decide(corrected, PLAN, INPUTS, inputs).action).toMatchObject({
      kind: 'invoke-specialists', specialistIds,
      stage: 'pre-implementation', reviewRound: 2,
    });
    const reviewed = [...corrected, completion('core:test-qa-engineer', 9, 'pass',
      'pre-implementation', HASH, 2, 'clarified'),
      ...(architectureHash === HASH ? [] : [completion('core:solution-architect', 10, 'pass',
        'pre-implementation', architectureHash, 2, 'changed')])];
    expect(decide(reviewed, PLAN, INPUTS, inputs).action.kind).toBe('run-lead-writer');
    expect(reviewed.filter((item) => item.kind === 'specialist.completed'))
      .toHaveLength(architectureHash === HASH ? 4 : 5);
  });

  it('allows only the recovered corrective work while its current-review regression proof remains due', () => {
    const request = (seq: number, reviewRound: number, inputHash: string) => event({
      seq, eventId: `evt_correction_review_request_${seq}`,
      kind: 'specialist.requested', source: 'void-harness:mission.dispatch',
      subject: 'core:test-qa-engineer', payload: { stage: 'post-implementation',
        reviewRound, inputHash, contractVersion: 1, runtime: 'codex', planHash: PLAN.planHash },
    });
    const regression = event({ seq: 9, eventId: 'evt_correction_regression_review',
      kind: 'specialist.completed', subject: 'core:test-qa-engineer', payload: {
        stage: 'post-implementation', reviewRound: 2, inputHash: HASH_B,
        contextId: 'context_corrective_regression', completion: {
          schemaVersion: 1, specialistId: 'core:test-qa-engineer', contractVersion: 1,
          completionId: 'completion_corrective_regression', verdict: 'changes-requested',
          findings: [{ id: 'selective-cleanup-regression', severity: 'high',
            summary: 'Mixed included and excluded cleanup assignments are not protected.',
            evidence: [{ path: 'src/cleanup.ts', line: 1, detail: 'Excluded assignments enter cleanup.' }],
            recommendation: 'Correct assignment filtering and prove mixed included/excluded behavior.' }],
          evidenceRequests: ['Provide the mixed included/excluded cleanup regression result.'],
          limitations: [],
        },
      } });
    const closed = [started(), ...preReviews(), writer(), request(6, 1, HASH),
      completion('core:solution-architect', 7), request(8, 2, HASH_B), regression,
      event({ seq: 10, eventId: 'evt_correction_closed', kind: 'mission.closed',
        payload: { reason: 'controller-stop' } })];
    const inputs = Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, HASH_B]));
    const recovery = planStoppedMissionRecovery({
      stream: stream(closed), request: { schemaVersion: 1,
        closureEventId: 'evt_correction_closed', expectedJournalHash: canonicalJsonHash(closed),
        disposition: { kind: 'controller-defect', defect: 'stale-input-dispatch' } },
      observation: { stage: 'post-implementation', currentInputHashes: inputs, maxRounds: 2,
        contractVersions: Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, 1])),
        expectedSource: 'runtime:codex' },
    });
    expect(recovery.kind).toBe('recover');
    if (recovery.kind !== 'recover') throw new Error('Expected correction recovery admission');
    expect(recovery.receipt).toMatchObject({ nextAction: 'correction', remainingRounds: 1 });
    const resumed = parseEvent({
      ...event({ seq: 11, eventId: 'evt_correction_recovered', kind: 'mission.recovered',
        source: 'void-harness:mission.recover' }), payload: recovery.receipt,
    });
    if (!resumed.ok) throw new Error('Expected a canonical recovery receipt');
    const recovered = [...closed, resumed.value];
    expect(decide(recovered, PLAN, inputs, INPUTS, {
      status: 'unavailable', limitations: ['Native isolation is not available.'],
    }).action.kind).toBe('stop');
    const invalidDisposition = event({ seq: 12, eventId: 'evt_unrequested_discharge',
      kind: 'specialist.evidence-discharged', subject: 'core:test-qa-engineer',
      causationId: 'evt_missing_controller_request', payload: {} });
    expect(decide([...recovered, invalidDisposition], PLAN, inputs).action.kind).toBe('stop');
    const correction = decide(recovered, PLAN, inputs);
    const regressionFindingId = `fnd_${canonicalJsonHash({
      evidence: [{ path: 'src/cleanup.ts', line: 1, detail: 'Excluded assignments enter cleanup.' }],
    }).slice('sha256:'.length, 29)}`;
    expect(correction.action).toMatchObject({
      kind: 'run-correction', writerId: 'writer:primary', findingIds: [regressionFindingId],
    });
    expect(correction.review.readyForVerdict).toBe(false);
    expect(correction.verdict.status).not.toBe('verified');
    const corrected = decide([...recovered, writer(12, 'writer:primary', 'run-correction')], PLAN, inputs);
    expect(corrected.action.kind).toBe('stop');
    expect(corrected.reasons.join(' ')).toContain('Provide the mixed included/excluded cleanup regression result.');
  });

  it('dispatches only migrated visual assessment after admitted preparation correction while degraded peer verdicts remain', () => {
    const visual = 'core:visual-craft-director';
    const devex = 'core:devex-docs-engineer';
    const migrationPlan = { ...PLAN, context: { status: 'complete' as const, issues: [] },
      specialists: [...PLAN.specialists, { specialistId: visual, contractVersion: 2,
        state: 'applicable', stages: ['post-implementation'] },
      { specialistId: devex, contractVersion: 1, state: 'applicable', stages: ['post-implementation'] }],
    } as MissionPlan;
    const events = [started(), ...preReviews(), ...preparationReceipt(6), writer(7, 'writer:primary', 'run-lead-writer'),
      completion('core:solution-architect', 8), completion('core:security-engineer', 9),
      completion('core:test-qa-engineer', 10, 'degraded', 'post-implementation', HASH, 1,
        'qa_degraded', [], ['Package proof remains incomplete.']),
      completion(devex, 11, 'degraded', 'post-implementation', HASH, 1,
        'devex_degraded', [], ['Documented examples still need verification.']),
      event({ seq: 12, eventId: 'evt_queued_visual_migration', kind: 'specialist.requested',
        source: 'void-harness:mission.dispatch', subject: visual, payload: {
          stage: 'post-implementation', reviewRound: 1, inputHash: HASH, contractVersion: 2,
          runtime: 'codex', planHash: PLAN.planHash } })];
    const hashes = { ...INPUTS, [visual]: HASH, [devex]: HASH };
    const admission = planSpecialistContractMigration({ stream: stream(events), request: {
      schemaVersion: 1, expectedEpisodeId: events[0]!.eventId,
      expectedJournalHash: canonicalJsonHash(events), migrationId: 'visual-craft-director-v2-v3' },
    observation: { declaration: { id: 'visual-craft-director-v2-v3', specialistId: visual,
      fromVersion: 2, toVersion: 3, fromContractSha256: HASH, toContractSha256: HASH_B,
      fromContractPath: 'contract-history/visual-craft-director/v2.yaml', policy: 'fresh-review-required' },
      observedFromContractSha256: HASH, observedToContractSha256: HASH_B, nativeAgentSha256: HASH_B,
      nativeContractVersion: 3, reviewSubjectHash: HASH, targetInputHash: HASH_B,
      plan: migrationPlan, currentInputHashes: hashes, maxRounds: 2, expectedSource: 'runtime:codex' } });
    expect(admission).toMatchObject({ kind: 'migrate' });
    if (admission.kind !== 'migrate') throw new Error('Authentic migration admission required');
    const migrated = parseEvent({ ...event({ seq: 13, eventId: 'evt_post_preparation_migration',
      kind: 'specialist.contract-migrated', source: 'void-harness:mission.migrate-specialist',
      subject: visual }), payload: admission.receipt });
    if (!migrated.ok) throw new Error('Canonical migration required');
    const decision = decide([...events, migrated.value], migrationPlan, { ...hashes, [visual]: HASH_B }, hashes);
    expect(decision.action).toEqual({ kind: 'invoke-specialists', specialistIds: [visual],
      stage: 'post-implementation', reviewRound: 1 });
    expect(decision.verdict.status).not.toBe('verified');
    expect(events.filter(item => item.kind === 'specialist.completed' && item.seq >= 10)).toHaveLength(2);
  });

  it('keeps a current evidence obligation blocking after a preparation writer receipt', () => {
    const events = [started(true), ...preparationReviews(1, 2, true), ...preparationReceipt()];
    const decision = decide(events);

    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons.join(' ')).toContain('Explain the preparation correction boundary.');
    expect(decision.reasons.join(' ')).toMatch(/classify|discharge/i);
  });

  it.each(['post-implementation', 'completion'] as const)(
    'defers classified %s evidence during preparation and gates it when due', (due) => {
      const origin = completion('core:test-qa-engineer', 4, 'pass', 'pre-implementation',
        HASH, 1, 'future', [PROOF_REQUEST]);
      const prepared = [started(), ...preReviews().slice(0, 2), origin,
        ...classifyEvidence(origin, 5, due)];
      expect(decide(prepared).action.kind).toBe('run-lead-writer');
      const implemented = [...prepared, writer(7)];
      if (due === 'completion') {
        expect(decide(implemented).action.kind).toBe('invoke-specialists');
      }
      const reviews = TEST_SPECIALIST_IDS.map((id, index) => completion(id, index + 8));
      const decision = decide(due === 'completion' ? [...implemented, ...reviews] : implemented);
      expect(decision.action.kind).toBe('stop');
      expect(decision.reasons.join(' ')).toContain(PROOF_REQUEST);
    },
  );

  it('retains original evidence obligations after writer correction invalidates their review window', () => {
    const origin = completion('core:test-qa-engineer', 8, 'pass', 'post-implementation',
      HASH, 1, 'original', [PROOF_REQUEST]);
    const events = [started(), ...preReviews(), writer(),
      completion('core:solution-architect', 6), completion('core:security-engineer', 7), origin,
      ...classifyEvidence(origin, 9, 'completion'), writer(11, 'writer:primary', 'run-correction'),
      ...TEST_SPECIALIST_IDS.map((id, index) => completion(
        id, index + 12, 'pass', 'post-implementation', HASH, 2,
      ))];
    const decision = decide(events);
    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons.join(' ')).toContain(PROOF_REQUEST);
  });

  it('rejects a preparation receipt whose action differs from its request', () => {
    const [request, receipt] = preparationReceipt();
    const payload = request.payload as Record<string, JsonValue>;
    const decision = decide([started(true), ...preReviews(),
      event({ ...request, payload: { ...payload, actionKind: 'run-lead-writer' } }), receipt]);
    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons).toContain('lead writer completion is not bound to a controller request');
  });

  it('still rejects a late preparation review after a corrected preparation', () => {
    const events = [started(), ...preparationReviews(1, 2, true),
      ...preparationReceipt(), ...preparationReviews(2, 7), writer(10)];
    expect(decide(events).action.kind).toBe('stop');
    const late = completion(TEST_SPECIALIST_IDS[0], 11, 'pass', 'pre-implementation', HASH, 2, 'late');
    expect(decide([...events, late]).action.kind).toBe('stop');
  });

  it('runs pre-implementation specialists before keeping one lead writer as owner', () => {
    const beforePreparation = decide([started()]);

    expect(beforePreparation.phase).toBe('preparation');
    expect(beforePreparation.action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: TEST_SPECIALIST_IDS,
      stage: 'pre-implementation',
    });
    const beforeImplementation = decide([started(), ...preReviews()]);

    expect(beforeImplementation.phase).toBe('implementation');
    expect(beforeImplementation.action).toEqual({
      kind: 'run-lead-writer',
      writerId: 'writer:primary',
    });

    const violation = decide([
      started(),
      ...preReviews(),
      writer(),
      writer(6, 'writer:other'),
    ]);
    expect(violation.phase).toBe('degraded');
    expect(violation.action.kind).toBe('stop');
  });

  it('invokes all three fresh-context reviewers after implementation', () => {
    const decision = decide([started(), ...preReviews(), writer()]);

    expect(decision.phase).toBe('review');
    expect(decision.action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: TEST_SPECIALIST_IDS,
      reviewRound: 1,
      stage: 'post-implementation',
    });
  });

  it('invokes every applicable routed specialist without a hard-coded role ceiling', () => {
    const plan = {
      ...PLAN,
      specialists: [
        ...PLAN.specialists,
        {
          specialistId: 'core:frontend-engineer',
          contractVersion: 3,
          state: 'applicable',
          stages: ['post-implementation'],
        },
      ],
    } as MissionPlan;
    const decision = decide([started(), ...preReviews(), writer()], plan, {
      ...INPUTS,
      'core:frontend-engineer': HASH,
    });

    expect(decision.action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: [...TEST_SPECIALIST_IDS, 'core:frontend-engineer'],
    });
  });

  it('finishes a reviewed ticket with an explicit degraded runtime note', () => {
    const limitation = 'parent sandbox can override read-only specialist policy';
    const preparing = decide(
      [started()],
      PLAN,
      INPUTS,
      INPUTS,
      { status: 'degraded', limitations: [limitation] },
    );

    expect(preparing.action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: TEST_SPECIALIST_IDS,
    });
    expect(preparing.verdict.status).toBe('degraded');
    expect(preparing.reasons).toContain(`specialist runtime: ${limitation}`);

    const proof = sealEvidence(evidenceDraft());
    const reviews = TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
      lifecycleCompletion(specialistId, 12 + (index * 3), 'post-implementation')
    );
    const finished = decide(
      [
        started(),
        ...TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
          lifecycleCompletion(specialistId, 2 + (index * 3), 'pre-implementation')),
        writer(11),
        ...reviews,
        event({
          seq: 21,
          eventId: 'evt_00000000-0000-4000-8000-000000000009',
          kind: 'evidence.recorded',
          subject: proof.evidenceId,
          payload: { evidence: proof },
        }),
      ],
      PLAN,
      INPUTS,
      INPUTS,
      { status: 'degraded', limitations: [limitation] },
    );

    expect(finished.phase).toBe('verified');
    expect(finished.action).toMatchObject({ kind: 'complete' });
    expect(finished.verdict.status).toBe('degraded');
    expect(finished.reasons).toContain(`specialist runtime: ${limitation}`);
  });

  it('names the unavailable runtime cause and the capability needed to resume', () => {
    const decision = decide([started()], PLAN, INPUTS, INPUTS, {
      status: 'unavailable', limitations: ['fresh contexts cannot be created'],
    });

    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons.join(' ')).toContain('fresh contexts cannot be created');
    expect(decision.reasons.join(' ')).toMatch(/(restore|provide|configure).*runtime/i);
    expect(decision.action).toMatchObject({ reasons: decision.reasons });
  });

  it('explains exhausted real corrections without suggesting a budget reset', () => {
    const initial = TEST_SPECIALIST_IDS.map((id, index) => completion(
      id, index + 6, id === 'core:security-engineer' ? 'changes-requested' : 'pass',
    ));
    const final = TEST_SPECIALIST_IDS.map((id, index) => completion(
      id, index + 10, id === 'core:security-engineer' ? 'changes-requested' : 'pass',
      'post-implementation', HASH, 2,
    ));
    const decision = decide([started(), ...preReviews(), writer(), ...initial,
      writer(9, 'writer:primary', 'run-correction'), ...final,
    ]);

    expect(decision.action.kind).toBe('stop');
    expect(decision.phase).toBe('blocked');
    expect(decision.reasons.join(' ')).toMatch(/(round|budget|bounded)/i);
    expect(decision.reasons.join(' ')).toMatch(/(escalate|arbitrat|operator|human)/i);
    expect(decision.review.readyForVerdict).toBe(false);
  });

  it('explains inconsistent empty degradation instead of returning an empty stop', () => {
    const decision = decide([started()], {
      ...PLAN, context: { status: 'degraded', issues: [] },
    });

    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons.join(' ')).toMatch(/context/i);
    expect(decision.reasons.join(' ')).toMatch(/(rebuild|restore|provide|resolve)/i);
    expect(decision.action).toMatchObject({ reasons: decision.reasons });
  });

  it('still blocks before dispatch when the specialist runtime is unavailable', () => {
    const decision = decide(
      [started()],
      PLAN,
      INPUTS,
      INPUTS,
      { status: 'unavailable', limitations: ['native agents are not installed'] },
    );

    expect(decision.phase).toBe('blocked');
    expect(decision.action).toMatchObject({ kind: 'stop' });
  });

  it('stops when specialist routing is degraded instead of completing without review', () => {
    const plan = {
      ...PLAN,
      specialists: [{
        specialistId: 'core:pdf-specialist',
        contractVersion: 1,
        state: 'degraded',
        stages: ['pre-implementation', 'post-implementation'],
      }],
    } as MissionPlan;

    const decision = decide([started()], plan, {});

    expect(decision.phase).toBe('degraded');
    expect(decision.action).toMatchObject({ kind: 'stop' });
  });

  it('fails closed for a legacy plan without specialist routing', () => {
    const { specialists: _specialists, ...legacyPlan } = PLAN;
    const decision = decide([started()], legacyPlan as MissionPlan, {});

    expect(decision.phase).toBe('degraded');
    expect(decision.reasons).toContain('specialist routing is missing from the plan');
  });

  it('routes structured findings back to the same writer', () => {
    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      completion('core:solution-architect', 6),
      completion('core:security-engineer', 7, 'changes-requested'),
      completion('core:test-qa-engineer', 8),
    ]);

    expect(decision.phase).toBe('correction');
    expect(decision.action).toMatchObject({
      kind: 'run-correction',
      writerId: 'writer:primary',
    });
    expect(decision.review.findings[0]?.summary).toContain('Authorization');
  });

  it('moves from preparation correction to implementation without replaying the panel', () => {
    const preFindings = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 2,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
        'pre-implementation',
      ));
    const decision = decide([
      started(),
      ...preFindings,
      writer(6, 'writer:primary', 'run-preparation-correction'),
    ]);

    expect(decision.phase).toBe('implementation');
    expect(decision.action).toEqual({
      kind: 'run-lead-writer',
      writerId: 'writer:primary',
    });
    expect(decision.review.stage).toBe('pre-implementation');
    expect(decision.reasons).toContain(
      'preparation correction completed; implementation is pending',
    );
  });

  it('starts post-implementation review after preparation correction and implementation', () => {
    const preFindings = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 2,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
        'pre-implementation',
      ));
    const decision = decide([
      started(),
      ...preFindings,
      writer(6, 'writer:primary', 'run-preparation-correction'),
      writer(7, 'writer:primary', 'run-lead-writer'),
    ]);

    expect(decision.phase).toBe('review');
    expect(decision.action).toMatchObject({
      kind: 'invoke-specialists',
      stage: 'post-implementation',
    });
    expect(decision.review.stage).toBe('post-implementation');
  });

  it('cannot verify when one required specialist completion is absent', () => {
    const proof = sealEvidence(evidenceDraft());
    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      completion('core:solution-architect', 6),
      completion('core:security-engineer', 7),
      event({
        seq: 8,
        eventId: 'evt_00000000-0000-4000-8000-000000000008',
        kind: 'evidence.recorded',
        subject: proof.evidenceId,
        payload: { evidence: proof },
      }),
    ]);

    expect(decision.phase).toBe('review');
    expect(decision.verdict.status).not.toBe('verified');
    expect(decision.review.missingSpecialists).toEqual(['core:test-qa-engineer']);
  });

  it('verifies only with complete reviews and fresh command proof', () => {
    const proof = sealEvidence(evidenceDraft());
    const pre = TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
      lifecycleCompletion(specialistId, 2 + (index * 3), 'pre-implementation'));
    const reviews = TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
      lifecycleCompletion(specialistId, 12 + (index * 3), 'post-implementation'));
    const decision = decide([
      started(),
      ...pre,
      writer(11),
      ...reviews,
      event({
        seq: 21,
        eventId: 'evt_00000000-0000-4000-8000-000000000021',
        kind: 'evidence.recorded',
        subject: proof.evidenceId,
        payload: { evidence: proof },
      }),
    ]);

    expect(decision.phase).toBe('verified');
    expect(decision.action).toEqual({ kind: 'complete' });
    expect(decision.verdict.status).toBe('verified');
  });

  it('cannot certify completion-only specialist events as green', () => {
    const proof = sealEvidence(evidenceDraft());
    const reviews = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(specialistId, index + 6));
    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      ...reviews,
      event({
        seq: 9,
        eventId: 'evt_00000000-0000-4000-8000-000000000009',
        kind: 'evidence.recorded',
        subject: proof.evidenceId,
        payload: { evidence: proof },
      }),
    ]);

    expect(decision.phase).toBe('degraded');
    expect(decision.action.kind).toBe('stop');
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('specialist lifecycle is unbound'),
    ]));
  });

  it.each([
    ['start-before-request', true, 'void-harness:mission.dispatch'],
    ['wrong-request-source', false, 'runtime:codex'],
  ] as const)('cannot certify a %s specialist chain', (_name, reversed, source) => {
    const proof = sealEvidence(evidenceDraft());
    const pre = TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
      lifecycleCompletion(specialistId, 2 + (index * 3), 'pre-implementation'));
    const reviews = TEST_SPECIALIST_IDS.flatMap((specialistId, index) =>
      lifecycleCompletion(
        specialistId,
        12 + (index * 3),
        'post-implementation',
        index === 0 ? reversed : false,
        index === 0 ? source : 'void-harness:mission.dispatch',
      ));
    const decision = decide([
      started(),
      ...pre,
      writer(11),
      ...reviews,
      event({
        seq: 21,
        eventId: 'evt_00000000-0000-4000-8000-000000000021',
        kind: 'evidence.recorded',
        subject: proof.evidenceId,
        payload: { evidence: proof },
      }),
    ]);

    expect(decision.phase).toBe('degraded');
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('specialist lifecycle is unbound'),
    ]));
  });

  it('rejects a strict-mode writer completion without its controller receipt', () => {
    const decision = decide([started(true), ...preReviews(), writer()]);

    expect(decision.phase).toBe('degraded');
    expect(decision.reasons).toContain(
      'lead writer completion is not bound to a controller request',
    );
  });

  it('does not let a pre-implementation completion satisfy post-implementation review', () => {
    const decision = decide([started(), ...preReviews(), writer()]);

    expect(decision.phase).toBe('review');
    expect(decision.review.stage).toBe('post-implementation');
    expect(decision.review.missingSpecialists).toEqual(TEST_SPECIALIST_IDS);
  });

  it('reconciles fresh post-build reviews after a bounded writer correction', () => {
    const postInputs = Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, HASH_B]));
    const correctedInputs = Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, HASH_C]));
    const initialReviews = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 6,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
        'post-implementation',
        HASH_B,
      ));
    const initialEvents = [started(), ...preReviews(HASH), writer(), ...initialReviews];

    const correction = decide(initialEvents, PLAN, postInputs, INPUTS);
    expect(correction.phase).toBe('correction');
    expect(correction.review).toMatchObject({
      stage: 'post-implementation',
      reviewRound: 1,
    });

    const correctedEvents = [...initialEvents, writer(9)];
    const afterCorrection = decide(correctedEvents, PLAN, correctedInputs, INPUTS);
    expect(afterCorrection.phase).toBe('review');
    expect(afterCorrection.review).toMatchObject({
      stage: 'post-implementation',
      reviewRound: 2,
      missingSpecialists: TEST_SPECIALIST_IDS,
      issues: [],
    });

    const freshReviews = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(specialistId, index + 10, 'pass', 'post-implementation', HASH_C, 2));
    const reconciled = decide([...correctedEvents, ...freshReviews], PLAN, correctedInputs, INPUTS);

    expect(reconciled.phase).toBe('verification');
    expect(reconciled.review).toMatchObject({
      stage: 'post-implementation',
      reviewRound: 2,
      readyForVerdict: true,
      issues: [],
    });
  });

  it('reruns the complete post-implementation panel after a correction', () => {
    const initialReviews = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 6,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
        'post-implementation',
        HASH,
      ));
    const initialEvents = [started(), ...preReviews(), writer(), ...initialReviews];

    const correction = decide(initialEvents, PLAN, INPUTS, INPUTS);
    expect(correction.phase).toBe('correction');

    const afterCorrection = decide(
      [...initialEvents, writer(9, 'writer:primary', 'run-correction')],
      PLAN,
      INPUTS,
      INPUTS,
    );

    expect(afterCorrection.phase).toBe('review');
    expect(afterCorrection.review.reviewRound).toBe(2);
    expect(afterCorrection.review.missingSpecialists).toEqual(TEST_SPECIALIST_IDS);
    expect(afterCorrection.review.specialistsToRun).toEqual(TEST_SPECIALIST_IDS);
  });

  it('rejects post-review completions recorded before implementation', () => {
    const earlyPost = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(specialistId, index + 5));
    const decision = decide([
      started(),
      ...preReviews(),
      ...earlyPost,
      writer(8),
    ]);

    expect(decision.phase).toBe('degraded');
    expect(decision.review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'out-of-order-completion' }),
    ]));
  });

  it('rejects a repeated review round after a writer correction boundary', () => {
    const correctedInputs = Object.fromEntries(TEST_SPECIALIST_IDS.map((id) => [id, HASH_C]));
    const initialReviews = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 6,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
        'post-implementation',
        HASH_B,
      ));
    const repeatedRound = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 10,
        'pass',
        'post-implementation',
        HASH_C,
        1,
        'after-correction',
      ));

    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      ...initialReviews,
      writer(9),
      ...repeatedRound,
    ], PLAN, correctedInputs, INPUTS);

    expect(decision.phase).toBe('degraded');
    expect(decision.review.readyForVerdict).toBe(false);
    expect(decision.review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'wrong-review-round' }),
    ]));
  });

  it('resumes missing peers without inventing a correction or consuming another round', () => {
    const partialReviews = [
      completion('core:solution-architect', 6),
      completion('core:security-engineer', 7),
    ];
    const retry = decide([started(), ...preReviews(), writer(), ...partialReviews]);

    expect(retry.phase).toBe('review');
    expect(retry.review.reviewRound).toBe(1);
    expect(decide([started(), ...preReviews(), writer(), ...partialReviews])).toEqual(retry);
    expect(retry.review.specialistsToRun).toEqual(['core:test-qa-engineer']);

    const reconciled = decide([
      started(),
      ...preReviews(),
      writer(),
      ...partialReviews,
      completion('core:test-qa-engineer', 8, 'pass', 'post-implementation', HASH, 1),
    ]);

    expect(reconciled.phase).toBe('verification');
    expect(reconciled.review).toMatchObject({
      reviewRound: 1,
      readyForVerdict: true,
      issues: [],
    });
  });

  it('rejects an unrequested extra round for a peer with no failure or correction', () => {
    const decision = decide([started(), ...preReviews(), writer(),
      completion('core:solution-architect', 6),
      completion('core:security-engineer', 7),
      completion('core:test-qa-engineer', 8, 'pass', 'post-implementation', HASH, 2),
    ]);

    expect(decision.action.kind).toBe('stop');
    expect(decision.review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'wrong-review-round' }),
    ]));
  });

  it('finishes collecting a corrected panel in the last legal round', () => {
    const initial = [started(), ...preReviews(), writer(),
      ...TEST_SPECIALIST_IDS.map((id, index) => completion(
        id, index + 6, id === 'core:security-engineer' ? 'changes-requested' : 'pass',
      )),
      writer(9, 'writer:primary', 'run-correction'),
      completion('core:solution-architect', 10, 'pass', 'post-implementation', HASH, 2),
    ];
    expect(decide(initial).action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: ['core:security-engineer', 'core:test-qa-engineer'],
      reviewRound: 2,
    });
    const completed = [...initial,
      completion('core:security-engineer', 11, 'pass', 'post-implementation', HASH, 2),
      completion('core:test-qa-engineer', 12, 'pass', 'post-implementation', HASH, 2),
    ];
    expect(decide(completed).phase).toBe('verification');
  });

  it('requires a writer correction before reviewing changed completed inputs', () => {
    const initial = [started(), ...preReviews(), writer(),
      ...TEST_SPECIALIST_IDS.map((id, index) => completion(id, index + 6))];
    const changedInputs: Readonly<Record<string, string>> = {
      ...INPUTS, 'core:security-engineer': HASH_B,
    };
    const next = decide(initial, PLAN, changedInputs);

    expect(next.action).toMatchObject({ kind: 'run-correction', writerId: 'writer:primary' });
    const corrected = [...initial, writer(9, 'writer:primary', 'run-correction')];
    expect(decide(corrected, PLAN, changedInputs).action).toMatchObject({
      kind: 'invoke-specialists',
      specialistIds: TEST_SPECIALIST_IDS,
      reviewRound: 2,
    });
    const reviewed = decide([...corrected,
      ...TEST_SPECIALIST_IDS.map((id, index) => completion(
        id, index + 10, 'pass', 'post-implementation', changedInputs[id], 2,
      )),
    ], PLAN, changedInputs);

    expect(reviewed.phase).toBe('verification');
    expect(reviewed.review).toMatchObject({ readyForVerdict: true, issues: [] });
  });

  it('explains a degraded specialist stop with its limitation and recovery action', () => {
    const limitation = 'The native runtime cannot prove fresh-context isolation.';
    const decision = decide([started(), ...preReviews().slice(0, 2),
      completion('core:test-qa-engineer', 4, 'degraded', 'pre-implementation',
        HASH, 1, 'degraded', [], [limitation]),
    ]);

    expect(decision.action.kind).toBe('stop');
    expect(decision.phase).toBe('degraded');
    expect(decision.reasons.join(' ')).toContain(limitation);
    expect(decision.reasons.join(' ')).toMatch(/(resolve|restore|provide|rerun|retry|resume)/i);
  });

  it('cannot erase findings with a higher review round before writer correction', () => {
    const firstRound = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(
        specialistId,
        index + 6,
        specialistId === 'core:security-engineer' ? 'changes-requested' : 'pass',
      ));
    const bypassRound = TEST_SPECIALIST_IDS.map((specialistId, index) =>
      completion(specialistId, index + 9, 'pass', 'post-implementation', HASH, 2));

    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      ...firstRound,
      ...bypassRound,
    ]);

    expect(decision.phase).toBe('degraded');
    expect(decision.review.readyForVerdict).toBe(false);
    expect(decision.review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'wrong-review-round',
        detail: expect.stringContaining('already completed'),
      }),
    ]));
  });

  it('rejects specialist completions not attributed to the selected runtime', () => {
    const impersonated = {
      ...completion('core:solution-architect', 6),
      source: 'writer:primary',
    } as CanonicalEvent;
    const decision = decide([
      started(),
      ...preReviews(),
      writer(),
      impersonated,
      completion('core:security-engineer', 7),
      completion('core:test-qa-engineer', 8),
    ]);

    expect(decision.phase).toBe('degraded');
    expect(decision.review.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'wrong-source' }),
    ]));
  });

  it('fails closed when the effective specialist runtime is unavailable', () => {
    const decision = orchestrateMissionTeam({
      plan: PLAN,
      stream: stream([started()]),
      evidenceContext: { dependencies: { 'git:working-tree': DIFF_A } },
      currentInputHashesByStage: {
        'pre-implementation': INPUTS,
        'post-implementation': INPUTS,
      },
      maxReviewRounds: 2,
      specialistRuntime: {
        status: 'unavailable',
        limitations: ['fresh-context isolation is not enforced'],
      },
    });

    expect(decision.phase).toBe('blocked');
    expect(decision.action.kind).toBe('stop');
    expect(decision.verdict.status).not.toBe('verified');
  });
});


it('keeps missing preparation proof actionable without closing or accepting the mission', () => {
  const origin = completion('core:test-qa-engineer', 4, 'pass', 'pre-implementation',
    HASH, 1, 'pending-proof', [PROOF_REQUEST]);
  const events = [started(), ...preReviews().slice(0, 2), origin];
  const before = canonicalJsonHash(events);
  const waiting = decide(events);
  expect(waiting.action).toMatchObject({ kind: 'await-evidence' });
  expect(waiting.verdict.status).toBe('blocked');
  expect(waiting.reasons.join(' ')).toContain('mission evidence-request');
  expect(decide(events)).toEqual(waiting);
  expect(canonicalJsonHash(events)).toBe(before);
  expect(decide([...events, ...classifyEvidence(origin, 5, 'post-implementation')]).action.kind)
    .toBe('run-lead-writer');
});
