import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTestCatalog,
  type ClassificationRule,
  classifyExactlyOne,
  createVitestProjects,
} from './test-catalog.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..');

describe('test proof catalogue', () => {
  it('classifies every repository test into one proof tier and one resource class', () => {
    const catalog = buildTestCatalog(REPOSITORY_ROOT);
    const paths = catalog.map((entry) => entry.path);

    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('test/support/test-catalog.test.ts');
    expect(new Set(catalog.map((entry) => entry.tier))).toEqual(
      new Set(['pure', 'contract', 'consumer', 'system', 'certification']),
    );
  });

  it('fails closed when rules leave a value unclassified or classify it twice', () => {
    const never: ClassificationRule<'first'> = { value: 'first', matches: () => false };
    const always: ClassificationRule<'first'> = { value: 'first', matches: () => true };
    const alsoAlways: ClassificationRule<'second'> = { value: 'second', matches: () => true };

    expect(() => classifyExactlyOne('test/new.test.ts', [never], 'proof tier'))
      .toThrow('TEST_CLASSIFICATION_MISSING');
    expect(() => classifyExactlyOne('test/new.test.ts', [always, alsoAlways], 'proof tier'))
      .toThrow('TEST_CLASSIFICATION_DUPLICATE');
  });

  it('isolates the measured network and subprocess cohort from filesystem and CPU tests', () => {
    const byPath = new Map(
      buildTestCatalog(REPOSITORY_ROOT).map((entry) => [entry.path, entry]),
    );

    expect(byPath.get('packages/cli/src/lib/ui/server.test.ts')?.resource).toBe(
      'network-browser',
    );
    expect(byPath.get('test/autopilot/stdin-process.test.ts')?.resource).toBe('subprocess');
    expect(byPath.get('packages/void-machine/test/presentation-adapters-contract.test.ts')?.resource)
      .toBe('subprocess');
    expect(byPath.get('apps/eval-harness/src/runtime/mission-team.test.ts')?.resource).toBe(
      'subprocess',
    );
    expect(byPath.get('packages/cli/src/lib/projects/catalog.test.ts')?.resource).toBe(
      'filesystem',
    );
    expect(byPath.get('packages/harness-graph/src/project/build.test.ts')?.resource).toBe(
      'filesystem',
    );
    expect(
      byPath.get('packages/harness-graph/src/project/build-subprocess.test.ts')?.resource,
    ).toBe('subprocess');
    expect(byPath.get('packages/mission-engine/src/events/schema.test.ts')?.resource).toBe('cpu');
  });

  it.each([
    'test/cli/force-preserves-co-owned.test.ts',
    'test/cli/add-remove-parity.test.ts',
  ])('keeps indirect init subprocesses in the bounded system lane: %s', (path) => {
    const catalog = buildTestCatalog(REPOSITORY_ROOT);
    expect(catalog.find((entry) => entry.path === path)).toMatchObject({
      tier: 'system',
      resource: 'subprocess',
    });
    const project = createVitestProjects(catalog).find(
      (entry) => entry.test?.name === 'system:subprocess',
    );
    expect(project?.test?.include).toContain(path);
    expect(project?.test?.maxWorkers).toBe(1);
  });

  it('renders one non-empty Vitest project per tier/resource cohort with bounded workers', () => {
    const catalog = buildTestCatalog(REPOSITORY_ROOT);
    const projects = createVitestProjects(catalog);
    const included = projects.flatMap((project) => project.test.include ?? []);

    expect(included.toSorted()).toEqual(catalog.map((entry) => entry.path));
    expect(projects.every((project) => (project.test.include?.length ?? 0) > 0)).toBe(true);
    expect(projects.find((project) => project.test.name === 'pure:cpu')?.test.maxWorkers).toBe(4);
    expect(
      projects.find((project) => project.test.name === 'system:subprocess')?.test.maxWorkers,
    ).toBe(1);
    expect(
      projects.find((project) => project.test.name === 'contract:subprocess')?.test.maxWorkers,
    ).toBe(2);
    expect(
      projects.find((project) => project.test.name === 'contract:subprocess')?.test.sequence?.groupOrder,
    ).toBeLessThan(
      projects.find((project) => project.test.name === 'system:subprocess')?.test.sequence?.groupOrder
        ?? Number.POSITIVE_INFINITY,
    );
    const workersByGroup = new Map<number, number>();
    for (const project of projects) {
      const workers = project.test.maxWorkers;
      const groupOrder = project.test.sequence?.groupOrder;
      expect(workers).toBeTypeOf('number');
      expect(groupOrder).toBeTypeOf('number');
      if (typeof workers !== 'number' || typeof groupOrder !== 'number') continue;
      expect(workersByGroup.get(groupOrder) ?? workers).toBe(workers);
      workersByGroup.set(groupOrder, workers);
    }
    expect(projects.find((project) => project.test.name === 'pure:cpu')?.test.sequence)
      .toEqual(projects.find((project) => project.test.name === 'contract:cpu')?.test.sequence);
    expect(projects.find((project) => project.test.name === 'contract:filesystem')?.test.sequence)
      .not.toEqual(projects.find((project) => project.test.name === 'contract:subprocess')?.test.sequence);
  });
});
