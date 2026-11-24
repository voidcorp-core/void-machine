import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSpecialistDispatch,
  reduceReviewLoop,
  routeSpecialists,
  type CanonicalEvent,
  type MissionPlan,
  type SpecialistId,
  type SpecialistInvocationStage,
  type SpecialistRoutingDecision,
} from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { loadSpecialists } from './load.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'core', 'dist');
const HASH = `sha256:${'a'.repeat(64)}`;
const MISSION_ID = 'mis_0123456789abcdef0123456789abcdef';

interface RoutingCase {
  readonly id: string;
  readonly signals: readonly string[];
  readonly expected: readonly SpecialistId[];
  /** Independent oracle for the selected stage. Never derive this from live contracts. */
  readonly expectedDispatched: readonly SpecialistId[];
  readonly stage: SpecialistInvocationStage;
}

const directCases: readonly RoutingCase[] = [
  { id: 'accessibility', signals: ['accessibility'], expected: ['core:accessibility-specialist'], expectedDispatched: ['core:accessibility-specialist'], stage: 'pre-implementation' },
  { id: 'frontend', signals: ['frontend-change'], expected: ['core:accessibility-specialist', 'core:experience-designer', 'core:frontend-engineer', 'core:visual-craft-director'], expectedDispatched: ['core:accessibility-specialist', 'core:frontend-engineer', 'core:visual-craft-director'], stage: 'post-implementation' },
  { id: 'api', signals: ['api-integration'], expected: ['core:api-integration-engineer'], expectedDispatched: ['core:api-integration-engineer'], stage: 'pre-implementation' },
  { id: 'node-server', signals: ['profile-node-server'], expected: ['core:api-integration-engineer'], expectedDispatched: ['core:api-integration-engineer'], stage: 'post-implementation' },
  { id: 'migration', signals: ['migration'], expected: ['core:data-migration-engineer'], expectedDispatched: ['core:data-migration-engineer'], stage: 'pre-implementation' },
  { id: 'sql', signals: ['profile-sql'], expected: ['core:data-migration-engineer'], expectedDispatched: ['core:data-migration-engineer'], stage: 'post-implementation' },
  { id: 'devex', signals: ['devex-docs'], expected: ['core:devex-docs-engineer'], expectedDispatched: ['core:devex-docs-engineer'], stage: 'post-implementation' },
  { id: 'domain', signals: ['domain-design'], expected: ['core:domain-architect'], expectedDispatched: ['core:domain-architect'], stage: 'pre-implementation' },
  { id: 'ux', signals: ['ux-ui'], expected: ['core:experience-designer', 'core:visual-craft-director'], expectedDispatched: ['core:experience-designer'], stage: 'pre-implementation' },
  { id: 'react', signals: ['profile-react'], expected: ['core:experience-designer', 'core:frontend-engineer', 'core:visual-craft-director'], expectedDispatched: ['core:frontend-engineer', 'core:visual-craft-director'], stage: 'post-implementation' },
  { id: 'expo', signals: ['profile-expo'], expected: ['core:experience-designer', 'core:frontend-engineer', 'core:visual-craft-director'], expectedDispatched: ['core:experience-designer'], stage: 'pre-implementation' },
  { id: 'nextjs', signals: ['profile-nextjs'], expected: ['core:frontend-engineer'], expectedDispatched: ['core:frontend-engineer'], stage: 'post-implementation' },
  { id: 'code', signals: ['code-change'], expected: ['core:independent-code-reviewer', 'core:test-qa-engineer'], expectedDispatched: ['core:independent-code-reviewer', 'core:test-qa-engineer'], stage: 'post-implementation' },
  { id: 'observability', signals: ['observability'], expected: ['core:observability-sre-engineer'], expectedDispatched: ['core:observability-sre-engineer'], stage: 'pre-implementation' },
  { id: 'runtime', signals: ['runtime-change'], expected: ['core:observability-sre-engineer'], expectedDispatched: ['core:observability-sre-engineer'], stage: 'post-implementation' },
  { id: 'pdf', signals: ['pdf'], expected: ['core:pdf-specialist'], expectedDispatched: ['core:pdf-specialist'], stage: 'pre-implementation' },
  { id: 'performance', signals: ['performance'], expected: ['core:performance-engineer'], expectedDispatched: ['core:performance-engineer'], stage: 'post-implementation' },
  { id: 'product', signals: ['product'], expected: ['core:product-challenger'], expectedDispatched: ['core:product-challenger'], stage: 'pre-implementation' },
  { id: 'security-baseline', signals: ['security-baseline'], expected: ['core:security-engineer'], expectedDispatched: ['core:security-engineer'], stage: 'post-implementation' },
  { id: 'auth', signals: ['auth'], expected: ['core:security-engineer'], expectedDispatched: ['core:security-engineer'], stage: 'pre-implementation' },
  { id: 'supply-chain', signals: ['supply-chain'], expected: ['core:security-engineer'], expectedDispatched: ['core:security-engineer'], stage: 'post-implementation' },
  { id: 'architecture', signals: ['architecture'], expected: ['core:solution-architect'], expectedDispatched: ['core:solution-architect'], stage: 'pre-implementation' },
  { id: 'monorepo', signals: ['profile-monorepo'], expected: ['core:solution-architect'], expectedDispatched: ['core:solution-architect'], stage: 'post-implementation' },
  { id: 'qa-baseline', signals: ['qa-baseline'], expected: ['core:test-qa-engineer'], expectedDispatched: ['core:test-qa-engineer'], stage: 'pre-implementation' },
];

const combinedCases: readonly RoutingCase[] = [
  {
    id: 'backend-platform',
    signals: ['architecture', 'domain-design', 'api-integration', 'runtime-change', 'observability', 'qa-baseline', 'code-change'],
    expected: ['core:api-integration-engineer', 'core:domain-architect', 'core:independent-code-reviewer', 'core:observability-sre-engineer', 'core:solution-architect', 'core:test-qa-engineer'],
    expectedDispatched: ['core:api-integration-engineer', 'core:domain-architect', 'core:observability-sre-engineer', 'core:solution-architect', 'core:test-qa-engineer'],
    stage: 'pre-implementation',
  },
  {
    id: 'destructive-data-change',
    signals: ['migration', 'profile-sql', 'destructive-migration', 'code-change'],
    expected: ['core:data-migration-engineer', 'core:independent-code-reviewer', 'core:security-engineer', 'core:test-qa-engineer'],
    expectedDispatched: ['core:data-migration-engineer', 'core:security-engineer', 'core:test-qa-engineer'],
    stage: 'pre-implementation',
  },
  {
    id: 'react-ui',
    signals: ['ux-ui', 'frontend-change', 'accessibility', 'profile-react', 'code-change'],
    expected: ['core:accessibility-specialist', 'core:experience-designer', 'core:frontend-engineer', 'core:independent-code-reviewer', 'core:test-qa-engineer', 'core:visual-craft-director'],
    expectedDispatched: ['core:accessibility-specialist', 'core:frontend-engineer', 'core:independent-code-reviewer', 'core:test-qa-engineer', 'core:visual-craft-director'],
    stage: 'post-implementation',
  },
  {
    id: 'next-api',
    signals: ['profile-nextjs', 'api-integration', 'runtime-change', 'security-baseline', 'code-change'],
    expected: ['core:api-integration-engineer', 'core:frontend-engineer', 'core:independent-code-reviewer', 'core:observability-sre-engineer', 'core:security-engineer', 'core:test-qa-engineer'],
    expectedDispatched: ['core:api-integration-engineer', 'core:frontend-engineer', 'core:independent-code-reviewer', 'core:observability-sre-engineer', 'core:security-engineer', 'core:test-qa-engineer'],
    stage: 'post-implementation',
  },
  { id: 'product-performance', signals: ['product', 'performance'], expected: ['core:performance-engineer', 'core:product-challenger'], expectedDispatched: ['core:performance-engineer', 'core:product-challenger'], stage: 'pre-implementation' },
  { id: 'sdk-docs', signals: ['devex-docs', 'api-integration'], expected: ['core:api-integration-engineer', 'core:devex-docs-engineer'], expectedDispatched: ['core:api-integration-engineer', 'core:devex-docs-engineer'], stage: 'post-implementation' },
  { id: 'accessible-pdf', signals: ['pdf', 'accessibility'], expected: ['core:accessibility-specialist', 'core:pdf-specialist'], expectedDispatched: ['core:accessibility-specialist', 'core:pdf-specialist'], stage: 'pre-implementation' },
  { id: 'llm-runtime', signals: ['llm-tools', 'runtime-change', 'observability', 'code-change'], expected: ['core:independent-code-reviewer', 'core:observability-sre-engineer', 'core:security-engineer', 'core:test-qa-engineer'], expectedDispatched: ['core:independent-code-reviewer', 'core:observability-sre-engineer', 'core:security-engineer', 'core:test-qa-engineer'], stage: 'post-implementation' },
];

const negativeCases: readonly RoutingCase[] = [
  'retrospective',
  'stack-patterns',
  'pattern-visual-change',
  'product-research',
  'documentation-only',
  'low-risk',
  'text-change',
  'unknown',
].map((signal, index) => ({
  id: `negative-${signal}`,
  signals: [signal],
  expected: [],
  expectedDispatched: [],
  stage: index % 2 === 0 ? 'pre-implementation' : 'post-implementation',
}));

const corpus = Object.freeze([...directCases, ...combinedCases, ...negativeCases]);

function applicable(decisions: readonly SpecialistRoutingDecision[]): readonly SpecialistId[] {
  return decisions
    .filter((decision) => decision.state === 'applicable')
    .map((decision) => decision.specialistId);
}

function completionEvent(
  routingCase: RoutingCase,
  decision: SpecialistRoutingDecision,
  index: number,
): CanonicalEvent {
  const seq = index + 1;
  return {
    schemaVersion: 1,
    seq,
    eventId: `evt_${routingCase.id}_${String(seq).padStart(4, '0')}`,
    missionId: MISSION_ID,
    ts: '2026-08-21T12:00:00.000Z',
    source: 'runtime:codex',
    kind: 'specialist.completed',
    subject: decision.specialistId,
    correlationId: MISSION_ID,
    payload: {
      stage: routingCase.stage,
      reviewRound: 1,
      inputHash: HASH,
      contextId: `ctx_${routingCase.id}_${index}_${decision.specialistId.slice(5)}`,
      completion: {
        schemaVersion: 1,
        specialistId: decision.specialistId,
        contractVersion: decision.contractVersion,
        completionId: `cmp_${routingCase.id}_${index}_${decision.specialistId.slice(5)}`,
        verdict: 'pass',
        findings: [],
        evidenceRequests: [],
        limitations: [],
      },
    },
  };
}

const CORPUS_CONTENT = {
  diff: 'diff --git a/a.ts b/a.ts\n+const a = 1;\n',
  touchedPaths: ['a.ts'],
  artifacts: [],
  lens: 'full',
  budgetTokens: 12_000,
} as const;

describe('canonical 40-case specialist routing corpus', () => {
  it('keeps routing, dispatch, completion recognition, and false greens at 100/100/100/0', async () => {
    const contracts = await loadSpecialists(CORE_ROOT);
    let truePositive = 0;
    let routedTotal = 0;
    let expectedTotal = 0;
    let dispatchedExpected = 0;
    let dispatchExpectedTotal = 0;
    let completedExpected = 0;
    let completionExpectedTotal = 0;
    let falseGreens = 0;

    expect(corpus).toHaveLength(40);
    for (const routingCase of corpus) {
      const decisions = routeSpecialists(contracts, {
        signals: new Set(routingCase.signals),
        profiles: [],
        contextStatus: 'complete',
        inputHash: HASH,
      });
      const routed = applicable(decisions);
      const expected = new Set(routingCase.expected);
      truePositive += routed.filter((id) => expected.has(id)).length;
      routedTotal += routed.length;
      expectedTotal += expected.size;
      expect(routed, routingCase.id).toEqual([...routingCase.expected].sort());

      const expectedForStage = routingCase.expectedDispatched;
      const routedForStage = decisions.filter((decision) =>
        decision.state === 'applicable' && decision.stages.includes(routingCase.stage));
      const envelopes = routedForStage.length === 0
        ? []
        : createSpecialistDispatch({
            missionId: MISSION_ID,
            runtime: 'codex',
            plan: { specialists: decisions } as MissionPlan,
            action: {
              kind: 'invoke-specialists',
              specialistIds: routedForStage.map((decision) => decision.specialistId),
              stage: routingCase.stage,
              reviewRound: 1,
            },
            currentInputHashes: Object.fromEntries(decisions.map((decision) => [
              decision.specialistId,
              HASH,
            ])),
            contextContent: CORPUS_CONTENT,
          });
      const envelopeIds = envelopes.map((envelope) => envelope.specialistId);
      dispatchedExpected += envelopeIds.filter((id) => expectedForStage.includes(id)).length;
      dispatchExpectedTotal += expectedForStage.length;
      expect(envelopeIds, `${routingCase.id}:dispatch`).toEqual(expectedForStage);

      if (routedForStage.length === 0) continue;
      const events = routedForStage.map((decision, index) =>
        completionEvent(routingCase, decision, index));
      const reviewInput = {
        stage: routingCase.stage,
        expectedSource: 'runtime:codex' as const,
        requiredSpecialists: routedForStage.map((decision) => decision.specialistId),
        contractVersions: Object.fromEntries(routedForStage.map((decision) => [
          decision.specialistId,
          decision.contractVersion,
        ])),
        currentInputHashes: Object.fromEntries(routedForStage.map((decision) => [
          decision.specialistId,
          HASH,
        ])),
        maxRounds: 2,
      };
      const complete = reduceReviewLoop({ ...reviewInput, events });
      completedExpected += expectedForStage.length - complete.missingSpecialists.length;
      completionExpectedTotal += expectedForStage.length;
      expect(complete.readyForVerdict, `${routingCase.id}:complete`).toBe(true);
      expect(complete.issues, `${routingCase.id}:issues`).toEqual([]);

      const missingOne = reduceReviewLoop({ ...reviewInput, events: events.slice(0, -1) });
      if (missingOne.readyForVerdict) falseGreens += 1;
    }

    expect({
      precision: truePositive / routedTotal,
      recall: truePositive / expectedTotal,
      dispatchCoverage: dispatchedExpected / dispatchExpectedTotal,
      completionCoverage: completedExpected / completionExpectedTotal,
      falseGreens,
    }).toEqual({
      precision: 1,
      recall: 1,
      dispatchCoverage: 1,
      completionCoverage: 1,
      falseGreens: 0,
    });
  });

  it('fails the independent dispatch oracle when a contract stage regresses', async () => {
    const contracts = (await loadSpecialists(CORE_ROOT)).map((contract) =>
      contract.id === 'core:frontend-engineer'
        ? { ...contract, stages: ['pre-implementation' as const] }
        : contract);
    const routingCase = directCases.find((candidate) => candidate.id === 'frontend');
    expect(routingCase).toBeDefined();
    if (routingCase === undefined) return;
    const decisions = routeSpecialists(contracts, {
      signals: new Set(routingCase.signals),
      profiles: [],
      contextStatus: 'complete',
      inputHash: HASH,
    });
    const routedForStage = decisions.filter((decision) =>
      decision.state === 'applicable' && decision.stages.includes(routingCase.stage));
    const envelopes = createSpecialistDispatch({
      missionId: MISSION_ID,
      runtime: 'codex',
      plan: { specialists: decisions } as MissionPlan,
      action: {
        kind: 'invoke-specialists',
        specialistIds: routedForStage.map((decision) => decision.specialistId),
        stage: routingCase.stage,
        reviewRound: 1,
      },
      currentInputHashes: Object.fromEntries(decisions.map((decision) => [
        decision.specialistId,
        HASH,
      ])),
      contextContent: CORPUS_CONTENT,
    });

    expect(envelopes.map((envelope) => envelope.specialistId)).not.toEqual(
      routingCase.expectedDispatched,
    );
  });
});
