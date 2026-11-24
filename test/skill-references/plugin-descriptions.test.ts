import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function fixture(files: Readonly<Record<string, string>>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'void-plugin-references-')));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['check-skill-references.mjs', 'product-identity.mjs']) {
    copyFileSync(new URL(`../../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  // The checker reads the product's own names from the identity, which is never a skill.
  mkdirSync(join(root, 'packages/core/src/data'), { recursive: true });
  copyFileSync(new URL('../../packages/core/src/data/identity.json', import.meta.url), join(root, 'packages/core/src/data/identity.json'));
  for (const [path, content] of Object.entries({
    'packages/core/src/skills/void-tdd/SKILL.md': '---\nname: void-tdd\n---\n',
    'packages/hook-runner/src/retired-skills.ts': "export const retired = { 'void-compounding': 'void-tdd' };",
    ...files,
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return spawnSync(process.execPath, [join(root, 'scripts/check-skill-references.mjs')], {
    cwd: root, encoding: 'utf8',
  });
}

describe('plugin description CLI validation', () => {
  it.each([
    'packages/core/src/.claude-plugin/plugin.json',
    'packages/cli/dist/core-assets/.claude-plugin/plugin.json',
    'packages/packs/pack-react/src/.claude-plugin/plugin.json',
  ])('rejects a missing explicit skill in %s', (path) => {
    const result = fixture({ [path]: JSON.stringify({ description: 'Use void-does-not-exist.' }) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
    expect(result.stderr).toContain('void-does-not-exist');
  });

  it.each([
    { description: 'Use void-tdd with void-machine, void-harness and harness-react; plan context testing functional.' },
    { description: '' },
    {},
  ])('accepts live references and ordinary prose: %j', (manifest) => {
    expect(fixture({ 'packages/core/src/.claude-plugin/plugin.json': JSON.stringify(manifest) }).status).toBe(0);
  });

  it('resolves new core and pack skills from their shipped sources without generated data', () => {
    const result = fixture({
      'packages/core/src/skills/void-example/SKILL.md': '---\nname: void-example\n---\n',
      'packages/packs/pack-example/src/skills/void-pack-example/SKILL.md': '---\nname: void-pack-example\n---\n',
      'packages/core/src/.claude-plugin/plugin.json': '{"description":"void-example and void-pack-example"}',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('refuses retired names without treating historical records as live descriptions', () => {
    const history = { 'docs/decisions/retired.md': 'harness:retired and void-compounding' };
    expect(fixture(history).status).toBe(0);
    const result = fixture({
      ...history,
      'packages/core/src/.claude-plugin/plugin.json': '{"description":"void-compounding"}',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('void-compounding');
  });

  it('preserves the existing namespace refusal, including in plugin descriptions', () => {
    expect(fixture({ 'README.md': 'Use harness:tdd.' }).status).toBe(1);
    const result = fixture({
      'packages/core/src/.claude-plugin/plugin.json': '{"description":"Use harness:tdd."}',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('harness:tdd');
  });
});


describe('code reference CLI validation', () => {
  it.each(['packages/probe.ts', 'apps/probe.ts', 'scripts/probe.mjs'])(
    'rejects an unknown skill in %s', (path) => {
      const result = fixture({ [path]: "const skill = 'void-does-not-exist';" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(path);
      expect(result.stderr).toContain('void-does-not-exist');
    },
  );

  it('rejects an unprefixed skill path even without a void token', () => {
    const result = fixture({ 'packages/probe.ts': "const path = 'skills/tdd/SKILL.md';" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/probe.ts');
    expect(result.stderr).toContain('skills/tdd/SKILL.md');
  });

  it('accepts live and retired references, declared machinery and consumer-owned skills', () => {
    const result = fixture({
      'packages/probe.ts': "const names = ['void-tdd', 'void-compounding', 'void-tx', 'skills/private/SKILL.md'];",
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('does not scan tests, historical records or generated copies as live code', () => {
    const result = fixture(Object.fromEntries([
      'packages/probe.test.ts',
      'docs/decisions/old.md',
      'packages/cli/dist/core-assets/probe.ts',
      'packages/example/dist/probe.js',
      'packages/example/node_modules/probe.js',
      'packages/example/coverage/probe.js',
    ].map((path) => [path, "const skill = 'void-does-not-exist';"])));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
