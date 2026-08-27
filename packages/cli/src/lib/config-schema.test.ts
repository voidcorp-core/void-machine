/**
 * Tests for the .void/config.json Zod schema (#68). A malformed config must be
 * reported with the offending JSON path; a valid or legacy-but-well-typed
 * config must pass without noise.
 */

import { describe, expect, it } from 'vitest';
import { configSchema, packsCoherenceIssues, validateConfig } from './config-schema.js';

const VALID = {
  core: '^0.14.0',
  packs: { '@voidcorp/harness-nextjs': '^0.14.0' },
  stack: { packageManager: 'pnpm', testRunner: 'vitest', e2eRunner: 'none' },
  paths: { business: 'apps/*/src/**', tests: 'apps/*/src/**/*.test.ts' },
  commands: { test: ['pnpm', 'test'] },
  modes: { tdd: 'auto', codeReview: 'auto' },
};

describe('validateConfig', () => {
  it('accepts a well-formed config', () => {
    expect(validateConfig(VALID)).toEqual({ ok: true, issues: [], warnings: [] });
  });

  it('accepts a legacy minimal config (all fields optional)', () => {
    expect(validateConfig({ paths: { business: 'src/**' } }).ok).toBe(true);
    expect(validateConfig({}).ok).toBe(true);
  });

  it('accepts legacy command strings with a migration warning', () => {
    const result = validateConfig({ commands: { test: 'pnpm test' } });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([
      'commands.test: legacy shell string; migrate to argv, e.g. ["pnpm","test"]',
    ]);
  });

  it('rejects empty argv commands and non-string arguments', () => {
    const empty = validateConfig({ commands: { test: [] } });
    expect(empty.ok).toBe(false);
    expect(empty.issues.some((issue) => issue.startsWith('commands.test:'))).toBe(true);

    const typed = validateConfig({ commands: { test: ['pnpm', 42] } });
    expect(typed.ok).toBe(false);
    expect(typed.issues.some((issue) => issue.startsWith('commands.test.1:'))).toBe(true);
  });

  it('tolerates unknown/extra top-level keys (forward compatible)', () => {
    expect(validateConfig({ ...VALID, futureField: { anything: true } }).ok).toBe(true);
  });

  it('flags a non-string paths value with its JSON path', () => {
    const r = validateConfig({ ...VALID, paths: { business: 42 } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.startsWith('paths.business:'))).toBe(true);
  });

  it('flags a non-semver core pin with its JSON path', () => {
    const r = validateConfig({ ...VALID, core: 'latest' });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.startsWith('core:') && i.includes('semver'))).toBe(true);
  });

  it('flags a non-semver pack pin with the pack path', () => {
    const r = validateConfig({ ...VALID, packs: { '@voidcorp/harness-nextjs': 'garbage' } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('packs.@voidcorp/harness-nextjs'))).toBe(true);
  });

  it('flags a malformed stack (missing/typed field)', () => {
    const r = validateConfig({ ...VALID, stack: { packageManager: 'pnpm', testRunner: 5, e2eRunner: 'none' } });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.startsWith('stack.testRunner:'))).toBe(true);
  });

  it('accepts caret, tilde and bare semver ranges', () => {
    expect(validateConfig({ core: '^1.2.3' }).ok).toBe(true);
    expect(validateConfig({ core: '~1.2.3' }).ok).toBe(true);
    expect(validateConfig({ core: '1.2.3' }).ok).toBe(true);
    expect(validateConfig({ core: '1.2.3-beta.1' }).ok).toBe(true);
  });
});

describe('context continuity config', () => {
  it('keeps old configs valid and defaults the threshold only inside context config', () => {
    expect(configSchema.parse({})).not.toHaveProperty('context');
    expect(configSchema.parse({ context: { windowTokens: 200_000 } })).toMatchObject({
      context: { windowTokens: 200_000, checkpointThresholdPercent: 50 },
    });
  });

  it.each([40, 50, 60])('accepts the bounded %i percent threshold', (threshold) => {
    expect(validateConfig({
      context: { windowTokens: 200_000, checkpointThresholdPercent: threshold },
    }).ok).toBe(true);
  });

  it.each([0, -1, 1.5])('rejects the invalid window size %s without clamping', (windowTokens) => {
    const result = validateConfig({ context: { windowTokens } });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toContain('context.windowTokens');
  });

  it.each([39, 61, 49.5])('rejects the out-of-bounds threshold %s without clamping', (threshold) => {
    const result = validateConfig({
      context: { windowTokens: 200_000, checkpointThresholdPercent: threshold },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toContain('context.checkpointThresholdPercent');
  });
});

describe('packsCoherenceIssues', () => {
  it('reports nothing when enabled and pinned packs match', () => {
    expect(packsCoherenceIssues(['harness-nextjs', 'harness-react'], ['harness-nextjs', 'harness-react'])).toEqual([]);
  });

  it('flags a pack enabled in settings but not pinned in config', () => {
    const issues = packsCoherenceIssues(['harness-nextjs'], []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('harness-nextjs');
    expect(issues[0]).toContain('not pinned');
  });

  it('flags a pack pinned in config but not enabled in settings', () => {
    const issues = packsCoherenceIssues([], ['harness-react']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('harness-react');
    expect(issues[0]).toContain('not enabled');
  });

  it('reports both directions of divergence', () => {
    const issues = packsCoherenceIssues(['harness-nextjs'], ['harness-react']);
    expect(issues).toHaveLength(2);
  });

  it('treats empty/empty as in sync (zero packs)', () => {
    expect(packsCoherenceIssues([], [])).toEqual([]);
  });
});

// A project whose business logic lives in two roots could not declare both while
// this accepted a single string. void-harness is the case in point: its own
// densest logic sits in packages/, which no single glob reached alongside apps/.
describe('paths accepts a list of globs', () => {
  it('accepts a list', () => {
    expect(validateConfig({ paths: { business: ['apps/*/src/**', 'packages/*/src/**'] } }).ok).toBe(true);
  });

  it('still accepts the single string every project declares today', () => {
    expect(validateConfig({ paths: { business: 'apps/*/src/**' } }).ok).toBe(true);
  });

  it('still refuses a non-string member, with its JSON path', () => {
    const result = validateConfig({ ...VALID, paths: { business: ['ok', 42] } });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('paths.business');
  });
})
