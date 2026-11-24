// The harness.yaml beside every shipped skill is read by two tolerant readers:
// the installer, which turns a manifest it cannot parse into "not eligible",
// and the graph, which skips what it does not recognise. Neither complains, so
// a duplicated key or a misspelt `runtime:` dropped a skill from Codex while CI
// stayed green. This suite is where such a manifest now fails, loudly, naming
// the file and the key.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateHarnessManifest } from './harness-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..'); // cli/src/lib -> repo root

// One block per required key, so a test can drop exactly one of them.
const REQUIRED_BLOCKS = {
  kind: 'kind: action',
  owner: 'owner: folpe',
  runtimes: 'runtimes: [claude, codex]',
  enforcement: 'enforcement:\n  floor: ci\n  inline:\n    claude: active\n    codex: pretooluse\n    hermes: ci-only',
  eval_targets: 'eval_targets: [claude/anthropic/opus]',
};
const manifestOf = (blocks: readonly string[]): string => `${blocks.join('\n')}\n`;
const VALID = manifestOf(Object.values(REQUIRED_BLOCKS));

function problemsOf(text: string): readonly string[] {
  const result = validateHarnessManifest(text);
  return result.ok ? [] : result.problems;
}

/** Every source manifest: core skills and pack skills. The core-assets mirror is generated from these. */
function sourceManifests(): string[] {
  const skillDirs = (root: string): string[] =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  const core = skillDirs(join(REPO_ROOT, 'packages', 'core', 'src', 'skills'));
  const packs = skillDirs(join(REPO_ROOT, 'packages', 'packs')).flatMap((pack) => {
    try {
      return skillDirs(join(pack, 'src', 'skills'));
    } catch {
      return []; // A pack that ships no skills has no skills/ directory.
    }
  });
  return [...core, ...packs].map((dir) => join(dir, 'harness.yaml'));
}

describe('validateHarnessManifest', () => {
  it('accepts a complete manifest', () => {
    expect(validateHarnessManifest(VALID)).toMatchObject({ ok: true, manifest: { kind: 'action' } });
  });

  it('accepts the optional keys a reader exists for, in block list form', () => {
    const text = [
      'kind: standard',
      'owner: folpe',
      'runtimes:',
      '  - claude',
      'enforcement:',
      '  floor: ci',
      'eval_targets:',
      '  - claude/anthropic/opus',
      'activation: always',
      'triggers:',
      '  globs: ["**/*.ts"]',
      '  extensions: [.tsx]',
      '  tools: [Edit]',
      'success_signal: the suite is green',
      '',
    ].join('\n');
    expect(problemsOf(text)).toEqual([]);
  });

  it('refuses an unknown top-level key, naming it', () => {
    expect(problemsOf(`${VALID}runtime: [claude]\n`)).toEqual(['(root): unrecognized key "runtime"']);
  });

  it.each([
    ['enforcement', VALID.replace('  floor: ci\n', '  floor: ci\n  ceiling: ci\n'), 'enforcement: unrecognized key "ceiling"'],
    ['enforcement.inline', VALID.replace('    hermes: ci-only\n', '    hermes: ci-only\n    gemini: active\n'), 'enforcement.inline: unrecognized key "gemini"'],
    ['triggers', `${VALID}triggers:\n  globs: [a]\n  paths: [b]\n`, 'triggers: unrecognized key "paths"'],
  ])('refuses an unknown key nested under %s, naming it', (_where, text, problem) => {
    expect(problemsOf(text)).toEqual([problem]);
  });

  it('refuses a duplicated key instead of reading it as nothing', () => {
    const problems = problemsOf(`${VALID}owner: someone-else\n`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^yaml: Map keys must be unique/);
  });

  it('refuses malformed YAML with the parser error', () => {
    const problems = problemsOf(VALID.replace('runtimes: [claude, codex]', 'runtimes: [claude, codex'));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.startsWith('yaml: '))).toBe(true);
  });

  it.each(Object.keys(REQUIRED_BLOCKS))('refuses a manifest without %s', (key) => {
    const text = manifestOf(Object.entries(REQUIRED_BLOCKS).filter(([name]) => name !== key).map(([, block]) => block));
    expect(problemsOf(text)).toEqual([`${key}: required`]);
  });

  it.each([
    ['an empty file', ''],
    ['a file of comments only', '# nothing declared yet\n'],
  ])('refuses %s rather than treating it as not eligible', (_label, text) => {
    expect(problemsOf(text)).toEqual(['(root): expected a mapping']);
  });

  it.each([
    ['kind', VALID.replace('kind: action', 'kind: workflow'), 'kind'],
    ['owner', VALID.replace('owner: folpe', 'owner: ""'), 'owner'],
    ['runtimes', VALID.replace('runtimes: [claude, codex]', 'runtimes: []'), 'runtimes'],
    ['runtimes entry', VALID.replace('runtimes: [claude, codex]', 'runtimes: [claude, hermes]'), 'runtimes.1'],
    ['floor', VALID.replace('floor: ci', 'floor: local'), 'enforcement.floor'],
    ['tier', VALID.replace('claude: active', 'claude: strict'), 'enforcement.inline.claude'],
    ['eval target', VALID.replace('claude/anthropic/opus', 'claude/anthropic'), 'eval_targets.0'],
    ['activation', `${VALID}activation: sometimes\n`, 'activation'],
    ['trigger entry', `${VALID}triggers:\n  tools: [1]\n`, 'triggers.tools.0'],
  ])('refuses an invalid %s value at its path', (_label, text, path) => {
    const problems = problemsOf(text);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.startsWith(`${path}: `)).toBe(true);
  });
});

describe('every source harness.yaml', () => {
  const manifests = sourceManifests();

  it('covers the core skills and the pack skills', () => {
    const rel = manifests.map((path) => relative(REPO_ROOT, path));
    expect(rel.some((path) => path.startsWith('packages/core/src/skills/'))).toBe(true);
    expect(rel.some((path) => path.startsWith('packages/packs/'))).toBe(true);
  });

  it('validates against the closed schema, parsed without a silent catch', () => {
    const failures = manifests.flatMap((path) =>
      problemsOf(readFileSync(path, 'utf8')).map((problem) => `${relative(REPO_ROOT, path)}: ${problem}`),
    );
    expect(failures).toEqual([]);
  });
});
