import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '../events/types.js';
import { event } from '../test/events.js';
import { reduceReviewLoop } from './review-loop.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const TEST_SPECIALIST_IDS = Object.freeze([
  'core:solution-architect',
  'core:security-engineer',
  'core:test-qa-engineer',
] as const);
type TestSpecialistId = typeof TEST_SPECIALIST_IDS[number];

const INPUTS: Readonly<Record<TestSpecialistId, string>> = {
  'core:solution-architect': HASH_A,
  'core:security-engineer': HASH_A,
  'core:test-qa-engineer': HASH_A,
};
const CONTRACT_VERSIONS = Object.fromEntries(
  TEST_SPECIALIST_IDS.map((id) => [id, 1]),
);

describe('opaque native context identity', () => {
  it.each(['/root/proof1_observability', '/root/proof1_product', '/root/proof1_security',
    '/root/proof1_qa', '/', `/${'a'.repeat(159)}`])('preserves %s as identity data', contextId => {
    const state = review(TEST_SPECIALIST_IDS.map((id, index) => completion(id,
      index === 0 ? { contextId } : {})));
    expect(state.status).toBe('ready-for-verdict');
    expect(state.issues).toEqual([]);
  });

  it.each(['', ' ', '   ', 'a'.repeat(161),
    ...Array.from({ length: 32 }, (_, index) => `/root/${String.fromCharCode(index)}probe`),
    ...Array.from({ length: 33 }, (_, index) => `/root/${String.fromCharCode(index + 127)}probe`),
  ])('rejects blank, control or oversized identity %j', contextId => {
    expect(review([completion('core:solution-architect', { contextId })])).toMatchObject({
      status: 'degraded', issues: [{ code: 'invalid-completion' }],
    });
  });

  it('still rejects reuse of an opaque native context by another specialist', () => {
    const state = review(TEST_SPECIALIST_IDS.map(id => completion(id, { contextId: '/root/proof1_shared' })));
    expect(state.status).toBe('degraded');
    expect(state.issues.map(issue => issue.code)).toContain('reused-context');
  });
});

function completion(
  specialistId: TestSpecialistId,
  overrides: {
    readonly seq?: number;
    readonly inputHash?: string;
    readonly contextId?: string;
    readonly completionId?: string;
    readonly verdict?: 'pass' | 'changes-requested' | 'blocked' | 'degraded';
    readonly findings?: readonly Record<string, unknown>[];
    readonly evidenceRequests?: readonly string[];
    readonly limitations?: readonly string[];
    readonly reviewRound?: number;
    readonly contractVersion?: number;
    readonly stage?: 'pre-implementation' | 'post-implementation';
  } = {},
): CanonicalEvent {
  const seq = overrides.seq ?? TEST_SPECIALIST_IDS.indexOf(specialistId) + 1;
  return event({
    seq,
    eventId: `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    source: 'runtime:codex',
    kind: 'specialist.completed',
    subject: specialistId,
    payload: {
      stage: overrides.stage ?? 'post-implementation',
      reviewRound: overrides.reviewRound ?? 1,
      inputHash: overrides.inputHash ?? HASH_A,
      contextId: overrides.contextId ?? `ctx_${specialistId.slice(5)}`,
      completion: {
        schemaVersion: 1,
        specialistId,
        contractVersion: overrides.contractVersion ?? 1,
        completionId: overrides.completionId ?? `cmp_${specialistId.slice(5)}`,
        verdict: overrides.verdict ?? 'pass',
        findings: overrides.findings ?? [],
        evidenceRequests: overrides.evidenceRequests ?? [],
        limitations: overrides.limitations ?? [],
      },
    },
  });
}

function review(events: readonly CanonicalEvent[], currentInputHashes = INPUTS) {
  return reduceReviewLoop({
    stage: 'post-implementation',
    expectedSource: 'runtime:codex',
    events,
    requiredSpecialists: TEST_SPECIALIST_IDS,
    contractVersions: CONTRACT_VERSIONS,
    currentInputHashes,
    maxRounds: 2,
  });
}

function finding(
  id: string,
  severity: 'critical' | 'high' | 'medium' | 'low',
  path: string,
  line: number,
): Record<string, unknown> {
  return {
    id,
    severity,
    summary: `${id} detected`,
    evidence: [{ path, line, detail: `evidence for ${id}` }],
    recommendation: `fix ${id}`,
  };
}

describe('MVP specialist review loop', () => {
  it('requires every applicable specialist completion before verdict', () => {
    const state = review([]);

    expect(state.status).toBe('awaiting-review');
    expect(state.specialistsToRun).toEqual(TEST_SPECIALIST_IDS);
    expect(state.readyForVerdict).toBe(false);
  });

  it('keeps an unchanged partial panel in its current round on repeated observation', () => {
    const events = [completion('core:solution-architect')];
    const first = review(events);
    const resumed = review(events);

    expect(first).toMatchObject({
      status: 'awaiting-review',
      reviewRound: 1,
      specialistsToRun: ['core:security-engineer', 'core:test-qa-engineer'],
    });
    expect(resumed).toEqual(first);
  });

  it('collects missing peers within the last permitted round', () => {
    const state = reduceReviewLoop({
      stage: 'post-implementation',
      expectedSource: 'runtime:codex',
      events: [completion('core:solution-architect')],
      requiredSpecialists: TEST_SPECIALIST_IDS,
      contractVersions: CONTRACT_VERSIONS,
      currentInputHashes: INPUTS,
      maxRounds: 1,
    });

    expect(state).toMatchObject({
      status: 'awaiting-review',
      reviewRound: 1,
      specialistsToRun: ['core:security-engineer', 'core:test-qa-engineer'],
      readyForVerdict: false,
    });
  });

  it('turns architecture, security, and QA findings into a bounded correction', () => {
    const state = review([
      completion('core:solution-architect', {
        findings: [finding('wrong-boundary', 'high', 'src/domain.ts', 2)],
        verdict: 'changes-requested',
      }),
      completion('core:security-engineer', {
        findings: [finding('auth-bypass', 'critical', 'src/auth.ts', 8)],
        verdict: 'blocked',
        limitations: ['The vulnerable branch prevents approval.'],
      }),
      completion('core:test-qa-engineer', {
        findings: [finding('untested-branch', 'high', 'src/feature.ts', 12)],
        verdict: 'changes-requested',
      }),
    ]);

    expect(state.status).toBe('correction-required');
    expect(state.findings.map((item) => item.summary)).toEqual([
      'auth-bypass detected',
      'untested-branch detected',
      'wrong-boundary detected',
    ]);
    expect(state.readyForVerdict).toBe(false);
  });

  it('reruns only specialists whose declared input hash changed', () => {
    const state = review(
      TEST_SPECIALIST_IDS.map((specialistId) => completion(specialistId)),
      {
        'core:solution-architect': HASH_A,
        'core:security-engineer': HASH_B,
        'core:test-qa-engineer': HASH_A,
      },
    );

    expect(state.status).toBe('awaiting-review');
    expect(state.staleSpecialists).toEqual(['core:security-engineer']);
    expect(state.specialistsToRun).toEqual(['core:security-engineer']);
  });

  it('retains advisory findings from a PASS without demanding another correction', () => {
    const advisory = finding('optional-clarity', 'low', 'src/domain.ts', 2);
    const state = review([
      completion('core:solution-architect', { findings: [advisory], verdict: 'pass' }),
      completion('core:security-engineer'), completion('core:test-qa-engineer'),
    ]);

    expect(state.status).toBe('ready-for-verdict');
    expect(state.readyForVerdict).toBe(true);
    expect(state.findings).toEqual([expect.objectContaining({ sourceId: 'optional-clarity' })]);
  });

  it('becomes ready only after three fresh passing completions', () => {
    const state = review(
      TEST_SPECIALIST_IDS.map((specialistId) => completion(specialistId)),
    );

    expect(state.status).toBe('ready-for-verdict');
    expect(state.readyForVerdict).toBe(true);
    expect(state.specialistsToRun).toEqual([]);
  });

  it('blocks instead of turning green when a required specialist times out', () => {
    const failed = (seq: number, reviewRound: number) => event({
      seq,
      eventId: `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      kind: 'specialist.failed',
      subject: 'core:test-qa-engineer',
      payload: {
        stage: 'post-implementation',
        reviewRound,
        inputHash: HASH_A,
        reason: 'timeout',
      },
    });
    const state = review([
      completion('core:solution-architect'),
      completion('core:security-engineer'),
      failed(3, 1),
      failed(4, 2),
    ]);

    expect(state.status).toBe('blocked');
    expect(state.missingSpecialists).toEqual(['core:test-qa-engineer']);
    expect(state.readyForVerdict).toBe(false);
  });

  it('advances a failed specialist retry and blocks after the bounded second attempt', () => {
    const failure = (seq: number, reviewRound: number) => event({
      seq,
      eventId: `evt_00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      kind: 'specialist.failed',
      subject: 'core:test-qa-engineer',
      payload: {
        stage: 'post-implementation',
        reviewRound,
        inputHash: HASH_A,
        reason: 'timeout',
      },
    });
    const firstAttempt = [
      completion('core:solution-architect'),
      completion('core:security-engineer'),
      failure(3, 1),
    ];

    const retry = review(firstAttempt);
    expect(retry.status).toBe('awaiting-review');
    expect(retry.reviewRound).toBe(2);
    expect(retry.specialistsToRun).toEqual(['core:test-qa-engineer']);

    const exhausted = review([...firstAttempt, failure(4, 2)]);
    expect(exhausted.status).toBe('blocked');
    expect(exhausted.reviewRound).toBe(2);
  });

  it('degrades malformed, duplicate, and reused-context completions', () => {
    const duplicateId = 'cmp_duplicate';
    const reusedContext = 'ctx_reused';
    const state = review([
      completion('core:solution-architect', {
        completionId: duplicateId,
        contextId: reusedContext,
      }),
      completion('core:security-engineer', {
        completionId: duplicateId,
        contextId: reusedContext,
      }),
      event({
        seq: 3,
        eventId: 'evt_00000000-0000-4000-8000-000000000003',
        kind: 'specialist.completed',
        subject: 'core:unknown-reviewer',
        payload: {},
      }),
    ]);

    expect(state.status).toBe('degraded');
    expect(state.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'duplicate-completion',
        'reused-context',
        'invalid-completion',
      ]),
    );
    expect(state.readyForVerdict).toBe(false);
  });

  it('degrades stale contract versions and missing current-input evidence', () => {
    const wrongVersion = reduceReviewLoop({
      stage: 'post-implementation',
      expectedSource: 'runtime:codex',
      events: TEST_SPECIALIST_IDS.map((specialistId) => completion(specialistId)),
      requiredSpecialists: TEST_SPECIALIST_IDS,
      contractVersions: { ...CONTRACT_VERSIONS, 'core:security-engineer': 2 },
      currentInputHashes: { ...INPUTS, 'core:test-qa-engineer': '' },
      maxRounds: 2,
    });

    expect(wrongVersion.status).toBe('degraded');
    expect(wrongVersion.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['wrong-contract-version', 'missing-input-hash']),
    );
    expect(wrongVersion.readyForVerdict).toBe(false);
  });

  it('deduplicates by concrete evidence rather than reviewer majority', () => {
    const shared = finding('shared-risk', 'medium', 'src/shared.ts', 7);
    const sharedWithDifferentTaxonomy = { ...shared, id: 'same-proof-different-id' };
    const distinct = finding('shared-risk', 'medium', 'src/other.ts', 7);
    const state = review([
      completion('core:solution-architect', {
        findings: [shared],
        verdict: 'changes-requested',
      }),
      completion('core:security-engineer', {
        findings: [sharedWithDifferentTaxonomy],
        verdict: 'changes-requested',
      }),
      completion('core:test-qa-engineer', {
        inputHash: HASH_C,
        findings: [distinct],
        verdict: 'changes-requested',
      }),
    ], {
      ...INPUTS,
      'core:test-qa-engineer': HASH_C,
    });

    expect(state.findings).toHaveLength(2);
    expect(state.findings[0]?.reportedBy).toHaveLength(2);
    expect(state.findings[1]?.reportedBy).toHaveLength(1);
  });

  it.each([
    {
      label: 'a Windows absolute evidence path',
      code: 'invalid-completion',
      event: completion('core:solution-architect', {
        findings: [finding('absolute-path', 'high', 'C:\\repo\\src\\domain.ts', 1)],
        verdict: 'changes-requested',
      }),
    },
    {
      label: 'a Windows UNC evidence path',
      code: 'invalid-completion',
      event: completion('core:solution-architect', {
        findings: [finding('unc-path', 'high', '\\\\server\\share\\secret', 1)],
        verdict: 'changes-requested',
      }),
    },
    {
      label: 'a Windows root-relative evidence path',
      code: 'invalid-completion',
      event: completion('core:solution-architect', {
        findings: [finding('root-path', 'high', '\\Windows\\System32\\file', 1)],
        verdict: 'changes-requested',
      }),
    },
    {
      label: 'a critical finding without a blocked verdict',
      code: 'invalid-completion',
      event: completion('core:security-engineer', {
        findings: [finding('critical-auth', 'critical', 'src/auth.ts', 1)],
        verdict: 'changes-requested',
      }),
    },
    {
      label: 'a degraded completion without a limitation',
      code: 'invalid-completion',
      event: completion('core:test-qa-engineer', { verdict: 'degraded' }),
    },
    {
      label: 'a finding id outside the canonical lowercase kebab format',
      code: 'invalid-completion',
      event: completion('core:solution-architect', {
        findings: [finding('ARCH-001', 'high', 'src/domain.ts', 1)],
        verdict: 'changes-requested',
      }),
    },
    {
      label: 'a completion from a different contract version',
      code: 'wrong-contract-version',
      event: completion('core:solution-architect', { contractVersion: 2 }),
    },
  ])('degrades $label instead of accepting unsafe specialist output', ({ event, code }) => {
    const state = review([event]);

    expect(state.status).toBe('degraded');
    expect(state.issues).toEqual([
      expect.objectContaining({ code }),
    ]);
  });

  it('keeps pre-implementation completions isolated from post-implementation review', () => {
    const state = review(TEST_SPECIALIST_IDS.map((specialistId) =>
      completion(specialistId, { stage: 'pre-implementation' })));

    expect(state.stage).toBe('post-implementation');
    expect(state.status).toBe('awaiting-review');
    expect(state.missingSpecialists).toEqual(TEST_SPECIALIST_IDS);
  });

  it('rejects reused completion and context identities regardless of stage order', () => {
    const post = completion('core:solution-architect', { seq: 1 });
    const pre = completion('core:solution-architect', {
      seq: 2,
      stage: 'pre-implementation',
    });
    const state = review([post, pre]);

    expect(state.status).toBe('degraded');
    expect(state.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate-completion',
      'reused-context',
    ]));
  });

  it('rejects unknown completion fields through the shared strict parser', () => {
    const valid = completion('core:solution-architect');
    const payload = valid.payload as Record<string, unknown>;
    const malformed = {
      ...valid,
      payload: {
        ...payload,
        completion: {
          ...(payload.completion as Record<string, unknown>),
          commentary: 'looks good',
        },
      },
    } as CanonicalEvent;

    expect(review([malformed]).issues).toEqual([
      expect.objectContaining({ code: 'invalid-completion' }),
    ]);
  });
});
