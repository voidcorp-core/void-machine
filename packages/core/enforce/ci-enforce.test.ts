import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Integration tests for the CI diff driver. It replays the SAME _checks.sh floor
// the local hooks enforce, but over a PR diff instead of a single edit, and
// reports GitHub annotations. Fail-closed: an unresolvable base is a red check,
// never a silent green (the #62-64 class the ticket forbids reproducing).
const here = dirname(fileURLToPath(import.meta.url));
const driver = join(here, 'ci-enforce.sh');
const repositoryAllowlist = join(
  here,
  '..',
  '..',
  '..',
  '.github',
  'void-enforce-allow',
);
// PATH resolves the installed Bash even when the runner omits login-shell state.
const BASH = 'bash';

const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE1'; // split so the driver's own repo never trips the secret hook

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Run the driver in `cwd` against `base`; capture exit + stdout (never throws). */
function run(cwd: string, base: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(BASH, [driver, '--base', base], { cwd, encoding: 'utf8' });
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

let repo = '';
let baselineRepo = '';
let base: string;

beforeAll(() => {
  baselineRepo = mkdtempSync(join(tmpdir(), 'enforce-baseline-'));
  git(baselineRepo, 'init', '-q', '-b', 'main');
  write(baselineRepo, 'src/app.ts', 'export const ok = 1;\n');
  write(baselineRepo, 'pnpm-lock.yaml', 'lockfileVersion: 1\n');
  git(baselineRepo, 'add', '-A');
  git(baselineRepo, 'commit', '-q', '-m', 'baseline');
  base = git(baselineRepo, 'rev-parse', 'HEAD').trim();
});

afterAll(() => {
  if (baselineRepo) rmSync(baselineRepo, { recursive: true, force: true });
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'enforce-'));
  // Copy the complete .git directory: every scenario owns its index, refs and objects.
  cpSync(baselineRepo, repo, { recursive: true, verbatimSymlinks: true });
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = '';
});

describe('ci-enforce — violations become red annotations', () => {
  it('flags an undeclared @repo import at the added line', () => {
    write(repo, 'packages/foo/package.json', JSON.stringify({ name: '@repo/foo' }) + '\n');
    write(repo, 'packages/foo/src/index.ts', "export const x = 1;\nimport { a } from '@repo/bar';\n");
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'boundary violation');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/::error file=packages\/foo\/src\/index\.ts,line=2/);
  });

  it('scans a file whose name has non-ASCII bytes (quotepath must not hide it)', () => {
    // Under git's default core.quotepath, `café.ts` is octal-escaped + quoted in
    // name-status; a naive driver then scans nothing and passes the leak green.
    write(repo, 'src/café.ts', `export const k = "${AWS_KEY}";\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'accented filename');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/::error file=src\/caf/);
  });

  it.each([false, true])('scans committed installed content instead of blocking ownership: leak=%s', (leak) => {
    const path = '.codex/hooks.json';
    write(repo, '.void/install-manifest.json', JSON.stringify({ files: [{ path }] }));
    write(repo, path, JSON.stringify({ command: leak ? AWS_KEY : 'node runner.mjs' }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'installed configuration');
    const result = run(repo, base);
    expect(result.code).toBe(leak ? 1 : 0);
    expect(result.stdout).not.toContain('delivered harness asset');
    if (leak) expect(result.stdout).toContain('leaked secret');
  });

  it('flags a leaked secret in a new source file', () => {
    write(repo, 'src/config.ts', `export const k = "${AWS_KEY}";\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/::error file=src\/config\.ts/);
  });

  it.each([false, true])('checks removal-only declarations with sibling=%s', (sibling) => {
    const path = 'apps/web/src/page.ts';
    const body = 'export const page = 1;\n';
    write(repo, path, '// tdd-cover: e2e tests/page.spec.ts\n' + body);
    write(repo, 'tests/page.spec.ts', 'test("page", () => {});\n');
    if (sibling) write(repo, 'apps/web/src/page.test.ts', 'test("page", () => {});\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'covered baseline');
    const covered = git(repo, 'rev-parse', 'HEAD').trim();
    write(repo, path, body);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'remove declaration only');
    const result = run(repo, covered);
    expect(result.code).toBe(sibling ? 0 : 1);
    if (!sibling) expect(result.stdout).toContain('TDD_SIBLING_TEST_MISSING');
  });

  it('flags frontend production code with no sibling test', () => {
    write(repo, 'apps/web/src/Card.tsx', 'export const Card = () => null;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'skip red');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/TDD_SIBLING_TEST_MISSING/);
    expect(stdout).toMatch(/apps\/web\/src\/Card\.tsx/);
  });

  it('reports every distinct violation in one run', () => {
    write(repo, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    write(repo, 'packages/foo/package.json', JSON.stringify({ name: '@repo/foo' }) + '\n');
    write(repo, 'packages/foo/src/index.ts', "import { a } from '@repo/bar';\n");
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'two violations');
    const { stdout } = run(repo, base);
    expect(stdout).toMatch(/pnpm-lock\.yaml/);
    expect(stdout).toMatch(/packages\/foo\/src\/index\.ts/);
  });
});

describe('ci-enforce — clean diff is green', () => {
  it('passes a benign change with no annotations', () => {
    write(repo, 'src/app.ts', 'export const ok = 2;\nexport const more = 3;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'benign');
    const { code, stdout } = run(repo, base);
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/::error/);
  });

  it('does not flag a secret added to a test fixture', () => {
    write(repo, 'src/auth.test.ts', `const k = "${AWS_KEY}";\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'fixture secret');
    expect(run(repo, base).code).toBe(0);
  });

  it('does not flag a declared import or a self import', () => {
    write(repo, 'packages/foo/package.json', JSON.stringify({ name: '@repo/foo', dependencies: { '@repo/core': 'workspace:*' } }) + '\n');
    write(repo, 'packages/foo/src/index.ts', "import { a } from '@repo/core';\nimport { b } from '@repo/foo';\n");
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'legit imports');
    expect(run(repo, base).code).toBe(0);
  });

  it('allows frontend production code when its sibling test exists', () => {
    write(repo, 'apps/web/src/Card.tsx', 'export const Card = () => null;\n');
    write(repo, 'apps/web/src/Card.test.tsx', 'test("Card", () => {});\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'red green');
    expect(run(repo, base).code).toBe(0);
  });

  it('allows a lockfile change accompanied by a manifest change (a legitimate dependency add)', () => {
    // The signature of a real `pnpm add`: package.json AND pnpm-lock.yaml move
    // together, and the reviewer sees the new dependency in the manifest.
    write(repo, 'package.json', '{\n  "name": "x",\n  "dependencies": { "marked": "^14.1.0" }\n}\n');
    write(repo, 'pnpm-lock.yaml', 'lockfileVersion: 9\ndependencies:\n  marked: 14.1.0\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add marked');
    const { code, stdout } = run(repo, base);
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/::error/);
    expect(stdout).toMatch(/lockfile diff requires dependency validation/);
  });

  it.each(['pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'apps/web/bun.lock'])(
    'allows a dependency refresh of %s without a manifest change', (path) => {
      write(repo, path, 'generated dependency resolution update\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'refresh dependencies');
      const { code, stdout } = run(repo, base);
      expect(code).toBe(0);
      expect(stdout).not.toMatch(/::error/);
      expect(stdout).toContain('lockfile diff requires dependency validation');
    },
  );

  it('still scans text lockfiles for leaked secrets', () => {
    write(repo, 'bun.lock', `registry: "${AWS_KEY}"\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak in lockfile');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/::error file=bun.lock/);
  });

  it('keeps credential files protected alongside a dependency refresh', () => {
    write(repo, 'bun.lock', 'generated dependency resolution update\n');
    write(repo, '.npmrc', 'registry=https://example.org\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'dependency refresh and credential file');
    const { code, stdout } = run(repo, base);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/protected file: credential file/);
  });

  it('skips a path listed in .github/void-enforce-allow (the committed override) and logs it', () => {
    // A file legitimately NAMED for secrets (like the harness's own detector) is
    // flagged by sensitive-path; the allowlist is the reviewable, committed
    // equivalent of the local VOID_HARNESS_ALLOW_SECRET_EDIT override.
    write(repo, '.github/void-enforce-allow', '# our own detector\npackages/core/hooks/secret-in-content.sh\n');
    write(repo, 'packages/core/hooks/secret-in-content.sh', 'echo hi\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'edit named-secret file + allow it');
    const { code, stdout } = run(repo, base);
    expect(code).toBe(0);
    expect(stdout).toMatch(/skipped|allowlist/i);
  });

  it('skips only certified generated artifacts and self-referential detector sources', () => {
    write(
      repo,
      '.github/void-enforce-allow',
      readFileSync(repositoryAllowlist, 'utf8'),
    );
    write(
      repo,
      'packages/core/graph/void-graph.mjs',
      `export const bundled = '${'x'.repeat(1_100_000)}';\n`,
    );
    write(
      repo,
      '.void/knowledge.json',
      `{"kind":"project-knowledge","snapshot":"${'x'.repeat(1_100_000)}"}\n`,
    );
    write(
      repo,
      'packages/hook-runner/src/rules/secret-content.ts',
      'export const detector = true;\n',
    );
    write(
      repo,
      'packages/hook-runner/src/rules/secret-content.test.ts',
      'test("detector", () => {});\n',
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'regenerate certified floor assets');

    const { code, stdout } = run(repo, base);
    expect(code).toBe(0);
    expect(stdout.match(/skipped/g)).toHaveLength(4);
  });
});

describe('ci-enforce — fail-closed', () => {
  it('exits nonzero with a clear message on an unresolvable base ref', () => {
    const { code, stdout, stderr } = run(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(code).not.toBe(0);
    expect(stdout + stderr).toMatch(/base/i);
  });

  it('fails closed when the base shares no merge-base with HEAD (shallow/disjoint history)', () => {
    // An orphan commit exists but has NO common ancestor with HEAD: `git diff
    // orphan...HEAD` errors and prints nothing. A naive driver reads that as a
    // clean diff and passes a real violation. It MUST fail closed instead.
    git(repo, 'checkout', '-q', '--orphan', 'orphan');
    write(repo, 'unrelated.txt', 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'orphan root');
    const orphan = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '-q', 'main');
    // A genuine violation on main — a fail-OPEN would wrongly wave it through.
    write(repo, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'touch lock');
    const { code, stdout, stderr } = run(repo, orphan);
    expect(code).not.toBe(0);
    expect(stdout + stderr).toMatch(/merge-base|base/i);
  });
});
