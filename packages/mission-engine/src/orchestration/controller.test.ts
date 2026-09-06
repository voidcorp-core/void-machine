import { describe, expect, it } from 'vitest';
import { replayEventLog, serializeEvent } from '../events/index.js';
import type { CanonicalEvent } from '../events/types.js';
import { sealEvidence } from '../evidence/schema.js';
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
  verdict: 'pass' | 'changes-requested' = 'pass',
  stage: 'pre-implementation' | 'post-implementation' = 'post-implementation',
  inputHash = HASH,
  reviewRound = 1,
  identitySuffix = String(reviewRound),
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
        findings: verdict === 'pass' ? [] : [{
          id: 'auth-bypass',
          severity: 'high',
          summary: 'Authorization can be bypassed.',
          evidence: [{ path: 'src/auth.ts', line: 8, detail: 'Role comes from input.' }],
          recommendation: 'Derive authorization from the authenticated principal.',
        }],
        evidenceRequests: [],
        limitations: [],
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

describe('mission team controller', () => {
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

  it('accepts a bounded retry without inventing another writer correction', () => {
    const partialReviews = [
      completion('core:solution-architect', 6),
      completion('core:security-engineer', 7),
    ];
    const retry = decide([started(), ...preReviews(), writer(), ...partialReviews]);

    expect(retry.phase).toBe('review');
    expect(retry.review.reviewRound).toBe(2);
    expect(retry.review.specialistsToRun).toEqual(['core:test-qa-engineer']);

    const reconciled = decide([
      started(),
      ...preReviews(),
      writer(),
      ...partialReviews,
      completion('core:test-qa-engineer', 8, 'pass', 'post-implementation', HASH, 2),
    ]);

    expect(reconciled.phase).toBe('verification');
    expect(reconciled.review).toMatchObject({
      reviewRound: 2,
      readyForVerdict: true,
      issues: [],
    });
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
