import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveMissionSignals,
  routeSpecialists,
  type ProfileRoutingDecision,
  type SpecialistRoutingDecision,
} from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { loadSpecialists } from './load.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'core', 'dist');
const HASH = `sha256:${'a'.repeat(64)}`;

function profile(name: string, patterns: readonly string[]): ProfileRoutingDecision {
  return {
    profileId: `core:${name}`,
    profileVersion: 1,
    state: 'applicable',
    activePatternIds: patterns,
    reasons: [],
    sourceReviewRequired: false,
    proof: { predicateId: `profile:${name}:detectors`, inputs: ['fixture'], inputHash: HASH },
  };
}

async function evaluate(
  signals: readonly string[],
  profiles: readonly ProfileRoutingDecision[] = [],
): Promise<readonly SpecialistRoutingDecision[]> {
  return routeSpecialists(await loadSpecialists(CORE_ROOT), {
    signals: new Set(signals),
    profiles,
    contextStatus: 'complete',
    inputHash: HASH,
  });
}

function applicable(decisions: readonly SpecialistRoutingDecision[]): readonly string[] {
  return decisions
    .filter((decision) => decision.state === 'applicable')
    .map((decision) => decision.specialistId);
}

describe('canonical specialist behavioral routing eval', () => {
  it('evaluates every role across representative backend, UI, product, DevEx, and PDF missions', async () => {
    const backend = await evaluate([
      'architecture',
      'domain-design',
      'migration',
      'api-integration',
      'runtime-change',
      'observability',
      'security',
      'qa',
      'code-change',
    ], [profile('sql', ['schema-migration']), profile('node-server', ['request-boundary'])]);
    const ui = await evaluate([
      'ux-ui',
      'frontend-change',
      'accessibility',
      'qa',
      'code-change',
    ], [profile('react', ['visual-change'])]);
    const product = await evaluate(['product', 'performance']);
    const docs = await evaluate(['devex-docs']);
    const pdf = await evaluate(['pdf']);
    const exercised = new Set([
      ...applicable(backend),
      ...applicable(ui),
      ...applicable(product),
      ...applicable(docs),
      ...applicable(pdf),
    ]);

    expect(backend).toHaveLength(16);
    expect(exercised).toEqual(new Set((await loadSpecialists(CORE_ROOT)).map((item) => item.id)));
    expect([...exercised]).toEqual(expect.arrayContaining([
      'core:domain-architect',
      'core:data-migration-engineer',
      'core:api-integration-engineer',
      'core:observability-sre-engineer',
      'core:frontend-engineer',
      'core:accessibility-specialist',
      'core:performance-engineer',
      'core:devex-docs-engineer',
      'core:independent-code-reviewer',
      'core:pdf-specialist',
    ]));
  });

  it('keeps negative controls narrow and proof-complete', async () => {
    const css = await evaluate(
      ['ux-ui', 'frontend-change', 'accessibility', 'code-change'],
      [profile('react', ['visual-change'])],
    );
    const ordinaryCode = await evaluate([
      'qa-baseline',
      'security-baseline',
      'code-change',
    ]);

    expect(css.find((item) => item.specialistId === 'core:data-migration-engineer')).toMatchObject({
      state: 'not-applicable',
      proof: {
        predicateId: 'specialist:data-migration-engineer:applies-when',
        inputs: ['ticket', 'diff.files', 'stack.technologies', 'profiles'],
        reason: expect.stringContaining('did not match'),
        inputHash: HASH,
        classifierVersion: expect.any(String),
      },
    });
    expect(ordinaryCode.find((item) => item.specialistId === 'core:pdf-specialist')?.state).toBe(
      'not-applicable',
    );
    expect(ordinaryCode.find((item) => item.specialistId === 'core:independent-code-reviewer')?.state).toBe(
      'applicable',
    );
    expect(ordinaryCode.find((item) => item.specialistId === 'core:security-engineer')?.state).toBe(
      'applicable',
    );
  });

  it('derives migration, observability, and QA specialists from schema evidence', async () => {
    const signals = deriveMissionSignals({
      ticket: 'Change the customer data contract.',
      files: ['packages/db/schema.prisma'],
      stack: ['postgres'],
    });
    const decisions = await evaluate([...signals, 'security-baseline', 'qa-baseline']);

    expect(applicable(decisions)).toEqual(expect.arrayContaining([
      'core:data-migration-engineer',
      'core:observability-sre-engineer',
      'core:test-qa-engineer',
      'core:security-engineer',
    ]));
  });
});
