import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { TestProjectInlineConfiguration } from 'vitest/config';

export const PROOF_TIERS = [
  'pure',
  'contract',
  'consumer',
  'system',
  'certification',
] as const;
export type ProofTier = (typeof PROOF_TIERS)[number];

export const RESOURCE_CLASSES = [
  'cpu',
  'filesystem',
  'subprocess',
  'network-browser',
  'external-state',
] as const;
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

export interface ClassificationRule<T extends string> {
  readonly value: T;
  readonly matches: (path: string) => boolean;
}

export interface TestCatalogEntry {
  readonly path: string;
  readonly tier: ProofTier;
  readonly resource: ResourceClass;
}

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.void',
  'coverage',
  'dist',
  'dist-singlefile',
  'node_modules',
  'target',
]);

const SYSTEM_PREFIXES = ['test/autopilot/', 'test/cli/'];
const CONSUMER_PREFIX = 'packages/cli/scripts/conformance-';
const CERTIFICATION_PREFIX = 'packages/harness-graph/src/certification/';
const RESOURCE_OVERRIDES: Readonly<Record<string, ResourceClass>> = {
  // These tests call an injected adapter whose implementation owns the import,
  // so source scanning cannot see the subprocess at the test boundary.
};

const NETWORK_IMPORT = /(?:from\s+|require\()['"]node:(?:http|https|net|tls)['"]/;
const SUBPROCESS_IMPORT = /(?:from\s+|require\()['"]node:(?:child_process|cluster|worker_threads)['"]/;
const FILESYSTEM_IMPORT = /(?:from\s+|require\()['"]node:fs(?:\/promises)?['"]/;
const RESOURCE_MARKER = /@test-resource\s+(cpu|filesystem|subprocess|network-browser|external-state)\b/g;

const WORKERS: Readonly<Record<ResourceClass, number>> = {
  cpu: 4,
  filesystem: 2,
  subprocess: 1,
  'network-browser': 1,
  'external-state': 1,
};

const GROUP_ORDER: Readonly<Record<ResourceClass, number>> = {
  cpu: 0,
  filesystem: 1,
  subprocess: 2,
  'network-browser': 3,
  'external-state': 4,
};

function workerBudget(tier: ProofTier, resource: ResourceClass): number {
  if (resource !== 'subprocess') return WORKERS[resource];
  return tier === 'contract' ? 2 : 1;
}

function groupOrder(tier: ProofTier, resource: ResourceClass): number {
  if (resource !== 'subprocess') return GROUP_ORDER[resource];
  if (tier === 'contract') return GROUP_ORDER[resource];
  if (tier === 'consumer') return GROUP_ORDER[resource] + 1;
  return GROUP_ORDER[resource] + 2;
}

function normalized(path: string): string {
  return path.split(sep).join('/');
}

function isSystem(path: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isConsumer(path: string): boolean {
  return path.startsWith(CONSUMER_PREFIX);
}

function isCertification(path: string): boolean {
  return path.startsWith(CERTIFICATION_PREFIX);
}

function tierRules(resource: ResourceClass): readonly ClassificationRule<ProofTier>[] {
  return [
    { value: 'certification', matches: isCertification },
    { value: 'consumer', matches: isConsumer },
    { value: 'system', matches: isSystem },
    {
      value: 'contract',
      matches: (path) =>
        (path.startsWith('test/') && !isSystem(path))
        || ((path.startsWith('packages/') || path.startsWith('apps/'))
          && resource !== 'cpu'
          && !isCertification(path)
          && !isConsumer(path)),
    },
    {
      value: 'pure',
      matches: (path) =>
        (path.startsWith('packages/') || path.startsWith('apps/'))
        && resource === 'cpu'
        && !isCertification(path)
        && !isConsumer(path),
    },
  ];
}

export function classifyExactlyOne<T extends string>(
  path: string,
  rules: readonly ClassificationRule<T>[],
  dimension: string,
): T {
  const matches = rules.filter((rule) => rule.matches(path));
  if (matches.length === 0) {
    throw new Error(`TEST_CLASSIFICATION_MISSING: ${path} has no ${dimension}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `TEST_CLASSIFICATION_DUPLICATE: ${path} has ${dimension}s ${matches.map((rule) => rule.value).join(', ')}`,
    );
  }
  const match = matches[0];
  if (match === undefined) throw new Error('TEST_CLASSIFICATION_INTERNAL');
  return match.value;
}

function markedResource(path: string, source: string): ResourceClass | undefined {
  const markers = [...source.matchAll(RESOURCE_MARKER)].map((match) => match[1]);
  const unique = new Set(markers);
  if (unique.size > 1) {
    throw new Error(
      `TEST_CLASSIFICATION_DUPLICATE: ${path} has resource classes ${[...unique].join(', ')}`,
    );
  }
  const marker = markers[0];
  return RESOURCE_CLASSES.find((candidate) => candidate === marker);
}

function resourceClass(path: string, source: string): ResourceClass {
  const marker = markedResource(path, source);
  if (marker !== undefined) return marker;
  const override = RESOURCE_OVERRIDES[path];
  if (override !== undefined) return override;
  // A file belongs to the most constrained resource it opens. This makes the
  // classes exclusive while keeping mixed server/process tests in the safer lane.
  if (NETWORK_IMPORT.test(source)) return 'network-browser';
  if (SUBPROCESS_IMPORT.test(source)) return 'subprocess';
  if (FILESYSTEM_IMPORT.test(source)) return 'filesystem';
  return 'cpu';
}

function discoverTestPaths(repositoryRoot: string): string[] {
  const paths: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        paths.push(normalized(relative(repositoryRoot, absolute)));
      }
    }
  }

  visit(repositoryRoot);
  return paths.sort();
}

export function buildTestCatalog(repositoryRoot: string): TestCatalogEntry[] {
  return discoverTestPaths(repositoryRoot).map((path) => {
    const source = readFileSync(resolve(repositoryRoot, path), 'utf8');
    const resource = resourceClass(path, source);
    return {
      path,
      tier: classifyExactlyOne(path, tierRules(resource), 'proof tier'),
      resource,
    };
  });
}

export function createVitestProjects(
  catalog: readonly TestCatalogEntry[],
): TestProjectInlineConfiguration[] {
  const cohorts = new Map<string, TestCatalogEntry[]>();
  for (const entry of catalog) {
    const name = `${entry.tier}:${entry.resource}`;
    const cohort = cohorts.get(name) ?? [];
    cohort.push(entry);
    cohorts.set(name, cohort);
  }

  return [...cohorts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => {
      const resource = entries[0]?.resource;
      const tier = entries[0]?.tier;
      if (resource === undefined || tier === undefined) {
        throw new Error('TEST_CLASSIFICATION_INTERNAL');
      }
      return {
        extends: true,
        test: {
          name,
          include: entries.map((entry) => entry.path),
          maxWorkers: workerBudget(tier, resource),
          sequence: { groupOrder: groupOrder(tier, resource) },
        },
      };
    });
}
