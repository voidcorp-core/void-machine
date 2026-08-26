import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARNESS_LINT_EXCLUSION, inspectHarnessLintExclusion } from './lint-exclusion.js';

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'void-lint-'));
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

describe('inspectHarnessLintExclusion', () => {
  it('reports a missing exclusion without writing anything', async () => {
    // A diagnostic that repairs what it measures always reports health, having
    // just created it. `doctor` must be able to tell the truth.
    const root = project({ 'biome.json': JSON.stringify({ files: { includes: ['**'] } }, null, 2) });
    const before = readFileSync(join(root, 'biome.json'), 'utf8');

    const state = await inspectHarnessLintExclusion(root);

    expect(state.kind).toBe('missing');
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toBe(before);
  });

  it('accepts an equivalent exclusion the project wrote in its own words', async () => {
    // `!.claude/**` and `!.claude` mean the same thing to Biome. Reporting the
    // first as missing would send a reader to add a rule they already have.
    const root = project({
      'biome.json': JSON.stringify({ files: { includes: ['**', '!.claude/**'] } }, null, 2),
    });

    expect((await inspectHarnessLintExclusion(root)).kind).toBe('excluded');
  });

  it('accepts an exclusion inherited from an extended Biome config', async () => {
    const root = project({
      'config/biome.shared.json': JSON.stringify({
        files: { includes: ['**', '!**/.claude/**'] },
      }),
      'config/biome.base.json': JSON.stringify({ extends: './biome.shared.json' }),
      'biome.json': JSON.stringify({ extends: ['./config/biome.base.json'] }),
    });

    expect(await inspectHarnessLintExclusion(root)).toEqual({
      kind: 'excluded',
      file: 'biome.json',
    });
  });

  it('accepts a positive scope that never includes the harness directory', async () => {
    const root = project({
      'biome.json': JSON.stringify({ files: { includes: ['src/**'] } }),
    });

    expect((await inspectHarnessLintExclusion(root)).kind).toBe('excluded');
  });

  it('lets a local includes list replace an inherited exclusion', async () => {
    const root = project({
      'biome.base.json': JSON.stringify({ files: { includes: ['**', '!**/.claude/**'] } }),
      'biome.json': JSON.stringify({
        extends: './biome.base.json',
        files: { includes: ['**'] },
      }),
    });

    expect((await inspectHarnessLintExclusion(root)).kind).toBe('missing');
  });

  it.each([
    {
      name: 'an extends cycle',
      files: {
        'biome.json': JSON.stringify({ extends: './base.json' }),
        'base.json': JSON.stringify({ extends: './biome.json' }),
      },
      reason: 'cycle',
    },
    {
      name: 'a missing extended config',
      files: { 'biome.json': JSON.stringify({ extends: './missing.json' }) },
      reason: 'cannot read',
    },
    {
      name: 'an extended config outside the project',
      files: { 'biome.json': JSON.stringify({ extends: '../outside.json' }) },
      reason: 'outside the project',
    },
    {
      name: 'an invalid extended config',
      files: {
        'biome.json': JSON.stringify({ extends: './base.json' }),
        'base.json': '{ invalid',
      },
      reason: 'not plain JSON',
    },
    {
      name: 'a scalar files.includes value',
      files: {
        'biome.json': JSON.stringify({ files: { includes: '**' } }),
      },
      reason: 'invalid files.includes',
    },
  ])('reports $name for manual resolution', async ({ files, reason }) => {
    const state = await inspectHarnessLintExclusion(project(files));

    expect(state.kind).toBe('manual');
    if (state.kind === 'manual') expect(state.instruction).toContain(reason);
  });

  it('names the exclusion with the leading ** Biome requires', () => {
    // A lone negation matches nothing in Biome, so an instruction that omitted
    // the positive pattern would tell a reader to switch their linter off.
    expect(HARNESS_LINT_EXCLUSION).toBe('!.claude');
  });

  it('reports no linter when the project has none', async () => {
    const root = project();

    expect((await inspectHarnessLintExclusion(root)).kind).toBe('no-linter');
  });
});

describe('the root that gets inspected', () => {
  it('finds a config that sits in the project, not in a staging directory', async () => {
    // The defect this pins: `wire` was handed the transaction's isolated stage
    // and reported "no linter config found" for every project on earth, because
    // the stage holds none of the project's own files. Reading the wrong root
    // is indistinguishable from a project having no linter.
    const stage = project({});
    const real = project({ 'biome.json': JSON.stringify({ files: { includes: ['**'] } }, null, 2) });

    expect((await inspectHarnessLintExclusion(stage)).kind).toBe('no-linter');
    expect((await inspectHarnessLintExclusion(real)).kind).toBe('missing');
  });
});
