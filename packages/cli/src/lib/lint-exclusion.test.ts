import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInstallReceipt, encodeReceipt, INSTALL_RECEIPT_PATH } from './receipts.js';
import { ownedDerivedPaths } from './void-migration.js';
import { inspectHarnessLintExclusion } from './lint-exclusion.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const SCRIPT = '.claude/skills/void-verify/references/ci-admission.mjs';

function project(files: Record<string, string> = {}, owned: readonly string[] = [SCRIPT]): string {
  const root = mkdtempSync(join(tmpdir(), 'void-lint-'));
  roots.push(root);
  const manifest = JSON.stringify({ schemaVersion: 1, version: '7.0.1', files: owned.map((path) => ({ path, sha256: 'a'.repeat(64) })) });
  const assets = Object.fromEntries(owned.map((path) => [path, 'export {};']));
  for (const [name, body] of Object.entries({ ...assets, '.void/install-manifest.json': manifest, ...files })) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

async function inspect(root: string) {
  const checks = await inspectHarnessLintExclusion(root);
  const check = checks[0];
  if (check === undefined) throw new Error('missing diagnostic');
  return check;
}

describe('inspectHarnessLintExclusion', () => {
  it('reports a missing exclusion without writing anything', async () => {
    // A diagnostic that repairs what it measures always reports health, having
    // just created it. `doctor` must be able to tell the truth.
    const root = project({ 'biome.json': JSON.stringify({ files: { includes: ['**'] } }, null, 2) });
    const before = readFileSync(join(root, 'biome.json'), 'utf8');

    const state = await inspect(root);

    expect(state.status).toBe('advisory');
    expect(readFileSync(join(root, 'biome.json'), 'utf8')).toBe(before);
  });

  it('accepts an equivalent exclusion the project wrote in its own words', async () => {
    // `!.claude/**` and `!.claude` mean the same thing to Biome. Reporting the
    // first as missing would send a reader to add a rule they already have.
    const root = project({
      'biome.json': JSON.stringify({ files: { includes: ['**', '!.claude/**'] } }, null, 2),
    });

    expect((await inspect(root)).status).toBe('pass');
  });

  it('accepts an exclusion inherited from an extended Biome config', async () => {
    const root = project({
      'config/biome.shared.json': JSON.stringify({
        files: { includes: ['**', '!**/.claude/**'] },
      }),
      'config/biome.base.json': JSON.stringify({ extends: './biome.shared.json' }),
      'biome.json': JSON.stringify({ extends: ['./config/biome.base.json'] }),
    });

    expect((await inspect(root)).status).toBe('pass');
  });

  it('accepts a positive scope that never includes the harness directory', async () => {
    const root = project({
      'biome.json': JSON.stringify({ files: { includes: ['src/**'] } }),
    });

    expect((await inspect(root)).status).toBe('pass');
  });

  it('lets a local includes list replace an inherited exclusion', async () => {
    const root = project({
      'biome.base.json': JSON.stringify({ files: { includes: ['**', '!**/.claude/**'] } }),
      'biome.json': JSON.stringify({
        extends: './biome.base.json',
        files: { includes: ['**'] },
      }),
    });

    expect((await inspect(root)).status).toBe('advisory');
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
    const state = await inspect(project(files));

    expect(state.status).toBe('unknown');
    expect(state.message).toContain(reason);
  });

  it('reports no linter when the project has none', async () => {
    const root = project();

    expect((await inspect(root)).message).toContain('no analyzer config');
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

    expect((await inspect(stage)).message).toContain('no analyzer config');
    expect((await inspect(real)).status).toBe('advisory');
  });
});


describe('attested analyzer boundaries', () => {
  const codex = '.agents/skills/void-verify/references/ci-admission.mjs';
  const hook = '.void/hooks/_void-hook.mjs';

  it('evaluates each file independently across runtimes and load-bearing hooks', async () => {
    const root = project({ 'biome.json': JSON.stringify({ files: { includes: ['**', `!${SCRIPT}`] } }) }, [SCRIPT, codex, hook]);
    const check = await inspect(root);
    expect(check.status).toBe('advisory');
    expect(check.message).toContain('2 owned');
    expect(check.message).toContain(codex);
    expect(check.message).toContain(hook);
    expect(check.fix).not.toContain(`!${SCRIPT}`);
  });

  it('does not propose excluding project neighbors or co-owned files even if the manifest lists them', async () => {
    const root = project({ 'biome.json': '{}' }, [hook, '.void/config.json', '.claude/settings.json', 'AGENTS.md']);
    const check = await inspect(root);
    expect(check.message).toContain('1 owned');
    expect(check.fix).toContain(hook);
    expect(check.fix).not.toContain('.void/config.json');
    expect(check.fix).not.toContain('.claude/settings.json');
    expect(check.fix).not.toContain('AGENTS.md');
    expect(check.fix).not.toContain('!.void/**');
  });

  it('reports unknown ownership without inventing paths or accepting traversal', async () => {
    for (const body of ['{ broken', JSON.stringify({ schemaVersion: 1, version: '7.0.1', files: [{ path: '../outside.mjs', sha256: 'a'.repeat(64) }] })]) {
      const root = project({ 'biome.json': '{}', '.void/install-manifest.json': body });
      expect((await inspect(root)).status).toBe('unknown');
    }
  });

  it('does not report absent files and keeps diagnostics bounded', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `.agents/skills/void-verify/references/helper${i}.mjs`);
    const root = project({ 'biome.json': '{}' }, paths);
    rmSync(join(root, paths[0] ?? 'missing'));
    const check = await inspect(root);
    expect(check.message).toContain('11 owned');
    expect(check.message.match(/helper/g)?.length).toBeLessThanOrEqual(5);
    expect(check.fix).toContain('remaining');
  });

  it('inspects Knip as well as Biome and never edits either config', async () => {
    const files = { 'biome.json': JSON.stringify({ files: { includes: ['src/**'] } }),
      'knip.json': JSON.stringify({ ignore: [SCRIPT] }) };
    const root = project(files, [SCRIPT, codex]);
    const checks = await inspectHarnessLintExclusion(root);
    expect(checks).toHaveLength(2);
    expect(checks[0]?.status).toBe('pass');
    expect(checks[1]?.status).toBe('advisory');
    expect(checks[1]?.message).toContain(codex);
    expect(checks[1]?.fix).toContain('ignore');
    for (const [file, body] of Object.entries(files)) expect(readFileSync(join(root, file), 'utf8')).toBe(body);
  });

  it('accepts Knip ignore but keeps ignoreFiles distinct from all-issue exclusions', async () => {
    expect((await inspect(project({ 'knip.json': JSON.stringify({ ignore: [SCRIPT] }) }))).status).toBe('pass');
    const partial = await inspect(project({ 'knip.json': JSON.stringify({ ignoreFiles: [SCRIPT] }) }));
    expect(partial.status).toBe('advisory');
    expect(partial.message).toContain('unused files only');
  });

  it.each([
    { file: 'knip.ts', body: 'throw new Error("must not execute");' },
    { file: 'knip.json', body: '{ broken' },
    { file: 'knip.json', body: JSON.stringify({ workspaces: { '.': { ignore: [SCRIPT] } } }) },
    { file: 'knip.json', body: JSON.stringify({ ignore: [`${SCRIPT}!`] }) },
  ])('keeps unsupported Knip configuration manual: $body', async ({ file, body }) => {
    const root = project({ [file]: body });
    expect((await inspect(root)).status).toBe('unknown');
    expect(readFileSync(join(root, file), 'utf8')).toBe(body);
  });
});


it('names the still-exposed Codex and hook scripts when Claude files are excluded', async () => {
  const root = project({ 'biome.json': JSON.stringify({ files: { includes: ['**', '!.claude/**'] } }) },
    [SCRIPT, '.agents/skills/void-verify/references/ci-admission.mjs', '.void/hooks/_void-hook.mjs']);
  const result = await inspectHarnessLintExclusion(root);
  expect(JSON.stringify(result)).toContain('.void/hooks/_void-hook.mjs');
  expect(JSON.stringify(result)).toContain('.agents/skills/void-verify/references/ci-admission.mjs');
});


describe('ownership evidence and filesystem boundaries', () => {
  it.each(['absent', 'invalid'])('uses a valid receipt when the manifest is %s, preserving the Git filter', async (manifest) => {
    const hook = '.void/hooks/_void-hook.mjs';
    const receipt = buildInstallReceipt({ version: '7.0.1', source: 'local', runtimes: ['codex'],
      files: [{ path: hook, content: Buffer.from('export {};'), mode: 0o644 }] });
    const root = project({ 'biome.json': '{}', [INSTALL_RECEIPT_PATH]: encodeReceipt(receipt) }, [hook]);
    if (manifest === 'absent') rmSync(join(root, '.void/install-manifest.json'));
    else writeFileSync(join(root, '.void/install-manifest.json'), '{ broken');
    expect((await inspect(root)).message).toContain(hook);
    expect(await ownedDerivedPaths(root)).toEqual(new Set());
  });

  it('keeps missing ownership unknown and does not infer it from directories', async () => {
    const root = project({ 'biome.json': '{}' });
    rmSync(join(root, '.void/install-manifest.json'));
    expect((await inspect(root)).message).toContain('ownership unknown');
  });

  it('does not inspect owned paths or analyzer configuration symlinked outside the root', async () => {
    const outside = project({ 'external.mjs': 'export {};', 'external.json': '{"ignore": []}' });
    const root = project({ 'biome.json': '{}' });
    rmSync(join(root, SCRIPT));
    symlinkSync(join(outside, 'external.mjs'), join(root, SCRIPT));
    expect((await inspect(root)).status).toBe('unknown');
    rmSync(join(root, 'biome.json'));
    rmSync(join(root, SCRIPT));
    writeFileSync(join(root, SCRIPT), 'export {};');
    symlinkSync(join(outside, 'external.json'), join(root, 'knip.json'));
    expect((await inspect(root)).message).toContain('outside the project');
  });

  it('reads static Knip from package.json without changing the package manifest', async () => {
    const content = JSON.stringify({ name: 'consumer', knip: { ignore: [SCRIPT] } });
    const root = project({ 'package.json': content });
    expect((await inspect(root)).status).toBe('pass');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(content);
  });
});
