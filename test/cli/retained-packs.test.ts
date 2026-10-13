// @test-resource subprocess
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../packages/cli/src/commands/init.js';
import { hydrate } from '../../packages/cli/src/commands/hydrate.js';
import { PACKS, packDirForName } from '../../packages/cli/src/lib/packs.js';
import { cliVersion } from '../../packages/cli/src/lib/paths.js';

const PACK_ROOT = resolve(import.meta.dirname, '../../packages/packs');
const ARGS = ['--runtime', 'both', '--no-interactive'];
const RETAINED = {
  '@voidcorp/harness-monorepo': '^3.1.1',
  '@voidcorp/harness-react': '~3.2.0',
  '@voidcorp/harness-nextjs': '^3.0.0',
  '@voidcorp/harness-server': '^3.1.0',
};
let root: string;
let previousCwd: string;
let output: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'void-retained-packs-'));
  previousCwd = process.cwd();
  process.chdir(root);
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${String(code ?? 0)})`);
  }) as never);
});
afterEach(() => {
  process.chdir(previousCwd);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function seed(packs: Record<string, string> = RETAINED) {
  const config = { core: '^3.1.0', packs, paths: { business: ['services/**', 'web/**'] },
    modes: { tdd: 'strict' }, projectSetting: 'keep' };
  mkdirSync(join(root, '.void'), { recursive: true });
  writeFileSync(join(root, '.void/config.json'), `${JSON.stringify(config)}\n`);
  return config;
}
function readConfig(): { packs: Record<string, string>; readonly [key: string]: unknown } {
  return JSON.parse(readFileSync('.void/config.json', 'utf8'));
}
function expectAssets(names: readonly string[]) {
  for (const pack of PACKS) {
    const directory = packDirForName(pack.name);
    if (directory === undefined) throw new Error('Expected a pack directory');
    const skills = readdirSync(join(PACK_ROOT, directory, 'skills'));
    for (const skill of skills) {
      for (const runtime of ['.claude', '.agents']) {
        const path = join(runtime, 'skills', skill, 'SKILL.md');
        expect(existsSync(path), `${pack.name}: ${path}`).toBe(names.includes(pack.name));
      }
    }
  }
}
function expectSelection(names: readonly string[]) {
  const summary = output.split('\n').find(line => /doctrine\s+harness/.test(line));
  expect(summary).toBeDefined();
  expect(summary?.match(/harness-[a-z]+/g) ?? []).toEqual(names);
}

describe('retained pack reconciliation', () => {
  it('materializes retained declarations in both runtimes without pack flags', async () => {
    const config = seed();
    mkdirSync('.claude', { recursive: true });
    mkdirSync('.codex', { recursive: true });
    writeFileSync('.claude/settings.json', '{"permissions":{"allow":["Read(project.md)"]}}\n');
    writeFileSync('.codex/config.toml', 'model = "project-model"\n');
    await init(ARGS);
    expect(readConfig()).toEqual(config);
    expectAssets(Object.keys(RETAINED).map(key => key.replace('@voidcorp/', '')));
    expect(JSON.parse(readFileSync('.claude/settings.json', 'utf8')).permissions.allow)
      .toContain('Read(project.md)');
    expect(readFileSync('.codex/config.toml', 'utf8')).toContain('model = "project-model"');
  });

  it.each([{ requested: ['nextjs'] }, { requested: ['nextjs', 'pack-nextjs', 'react'] }])(
    'unions retained and explicit packs $requested once without moving pins', async ({ requested }) => {
    const config = seed({ '@voidcorp/harness-react': '~3.2.0' });
    await init([...ARGS, ...requested.flatMap(name => ['--pack', name])]);
    expect(readConfig()).toEqual({ ...config, packs: { ...config.packs,
      '@voidcorp/harness-nextjs': `^${cliVersion()}` } });
    expectAssets(['harness-react', 'harness-nextjs']);
    expectSelection(['harness-react', 'harness-nextjs']);
    },
  );

  it('deduplicates retained packs under all-packs without moving their pins', async () => {
    seed();
    await init([...ARGS, '--all-packs']);
    expect(readConfig().packs).toMatchObject(RETAINED);
    expect(Object.keys(readConfig().packs)).toHaveLength(PACKS.length);
    expectAssets(PACKS.map(pack => pack.name));
    expectSelection(PACKS.map(pack => pack.name));
  });

  it.each([{ names: ['react'] }, { names: [] }])(
    'replaces with the exact selection $names and removes only owned assets', async ({ names }) => {
    await init([...ARGS, '--pack', 'react', '--pack', 'nextjs']);
    const previous = readConfig();
    mkdirSync('.agents/skills/project-owned', { recursive: true });
    writeFileSync('.agents/skills/project-owned/SKILL.md', '# Project skill\n');
    await init([...ARGS, '--replace-packs', ...names.flatMap(name => ['--pack', name])]);
    const expected = names.map(name => `harness-${name}`);
    expect(readConfig()).toEqual({ ...previous, packs: Object.fromEntries(expected.map(name =>
      [`@voidcorp/${name}`, previous.packs[`@voidcorp/${name}`]])) });
    expectAssets(expected);
    expect(readFileSync('.agents/skills/project-owned/SKILL.md', 'utf8')).toBe('# Project skill\n');
    },
  );

  it('keeps a fresh noninteractive installation core-only', async () => {
    await init(ARGS);
    expect(readConfig().packs).toEqual({});
    expectAssets([]);
    expect(existsSync('.claude/skills/void-tdd/SKILL.md')).toBe(true);
    expect(existsSync('.agents/skills/void-tdd/SKILL.md')).toBe(true);
  });

  it('restores retained pack files after a real clone through hydrate without pack flags', async () => {
    execFileSync('git', ['init', '-q']);
    await init([...ARGS, '--pack', 'react', '--pack', 'nextjs']);
    const before = readConfig();
    execFileSync('git', ['add', '.']);
    execFileSync('git', ['-c', 'user.name=Void Test', '-c', 'user.email=void@example.test',
      'commit', '-qm', 'test: seed installed project']);
    const clone = mkdtempSync(join(tmpdir(), 'void-pack-clone-'));
    try {
      execFileSync('git', ['clone', '-q', root, clone]);
      process.chdir(clone);
      expect(readConfig()).toEqual(before);
      expectAssets([]);
      await hydrate(['--runtime', 'both']);
      expect(readConfig()).toEqual(before);
      expectAssets(['harness-react', 'harness-nextjs']);
    } finally {
      process.chdir(root);
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it.each([
    '{ broken', '[]', '"not an object"', 'null', '{"packs":[]}', '{"packs":"react"}',
    '{"packs":{"@voidcorp/harness-unknown":"^3.1.0"}}',
    '{"packs":{"@voidcorp/harness-react":42}}',
    '{"packs":{"@voidcorp/harness-react":"not-a-pin"}}',
  ])('refuses an unreadable or invalid retained declaration %s without changing it', async body => {
    mkdirSync('.void');
    writeFileSync('.void/config.json', body);
    await expect(init(ARGS)).rejects.toThrow(/\.void\/config\.json/);
    expect(readFileSync('.void/config.json', 'utf8')).toBe(body);
    expect(existsSync('.void/install-manifest.json')).toBe(false);
  });

  it('allows force to replace unparseable config through the existing config verdict', async () => {
    mkdirSync('.void');
    writeFileSync('.void/config.json', '{ broken');
    await init([...ARGS, '--force', '--pack', 'react']);
    expect(readConfig().packs).toEqual({ '@voidcorp/harness-react': `^${cliVersion()}` });
    expect(output).toContain('overwriting unparseable config');
    expectAssets(['harness-react']);
  });

  it('does not let force erase a readable config with invalid pack declarations', async () => {
    const body = '{"packs":[],"projectSetting":"keep"}';
    mkdirSync('.void');
    writeFileSync('.void/config.json', body);
    await expect(init([...ARGS, '--force'])).rejects.toThrow(/\.void\/config\.json/);
    expect(readFileSync('.void/config.json', 'utf8')).toBe(body);
  });
});
