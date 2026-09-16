// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it } from 'vitest';
const CLI = resolve(__dirname, '../../packages/cli/bin/void-harness.mjs');
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function run(root: string, executable: string, args: string[]) {
  return spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Hook Test', GIT_AUTHOR_EMAIL: 'hook@example.test',
      GIT_COMMITTER_NAME: 'Hook Test', GIT_COMMITTER_EMAIL: 'hook@example.test' } });
}
function git(root: string, ...args: string[]) {
  const result = run(root, 'git', args);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result.stdout + result.stderr;
}
function cli(root: string, ...args: string[]) { return run(root, process.execPath, [CLI, ...args]); }
function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "knowledge hook 'space'-")); roots.push(root);
  git(root, 'init', '--initial-branch=main');
  put(root, '.void/.gitignore', 'machine/\n');
  put(root, 'src/a.ts', 'export const value = 1;\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Initial source');
  return root;
}
function install(root: string) {
  const result = cli(root, 'knowledge', 'hook', 'install');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout;
}
it('help and invalid arguments cannot install a hook', () => {
  const root = fixture();
  const result = cli(root, 'knowledge', 'hook', 'install', '--help');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('knowledge hook install|uninstall');
  for (const args of [[], ['hook'], ['hook', 'install', '--force'], ['unknown']]) {
    expect(cli(root, 'knowledge', ...args).status).toBe(2);
  }
  expect(existsSync(join(root, '.git/hooks/post-commit'))).toBe(false);
});
it('explicit installation is idempotent and reversible without replacing user hooks', () => {
  const root = fixture(); const hook = join(root, '.git/hooks/post-commit');
  install(root);
  const adapter = readFileSync(hook, 'utf8');
  expect(adapter.split('\n').length).toBeLessThanOrEqual(100);
  expect(statSync(hook).mode & 0o111).not.toBe(0);
  utimesSync(hook, 1000, 1000); install(root);
  expect(statSync(hook).mtimeMs).toBe(1000000);
  writeFileSync(hook, `${adapter}# user customization\n`);
  expect(cli(root, 'knowledge', 'hook', 'uninstall').status).toBe(1);
  expect(readFileSync(hook, 'utf8')).toContain('user customization');
  expect(cli(root, 'knowledge', 'hook', 'install').status).toBe(1);
  writeFileSync(hook, adapter);
  expect(cli(root, 'knowledge', 'hook', 'uninstall').status).toBe(0);
  expect(cli(root, 'knowledge', 'hook', 'uninstall').status).toBe(0);
  expect(existsSync(hook)).toBe(false);
  writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  expect(cli(root, 'knowledge', 'hook', 'install').status).toBe(1);
  expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
});
it('commits once, leaves changed knowledge unstaged, and does not rewrite an empty commit artifact', () => {
  const root = fixture(); install(root);
  put(root, 'src/a.ts', 'export const value = 2;\n'); git(root, 'add', 'src/a.ts');
  const result = git(root, 'commit', '-m', 'Changed source');
  expect(result).toContain('later commit');
  expect(git(root, 'rev-list', '--count', 'HEAD').trim()).toBe('2');
  expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
  const artifact = join(root, '.void/knowledge.json');
  const bytes = readFileSync(artifact);
  utimesSync(artifact, 1000, 1000);
  const empty = git(root, 'commit', '--allow-empty', '-m', 'No source change');
  expect(empty).toContain('unchanged');
  expect(readFileSync(artifact)).toEqual(bytes);
  expect(statSync(artifact).mtimeMs).toBe(1000000);
});
it('reports missing installation and a failed publication without failing the completed commit', () => {
  const root = fixture(); install(root);
  rmSync(join(root, '.void'), { recursive: true });
  expect(git(root, 'commit', '--allow-empty', '-m', 'Missing install')).toContain('skipped');
  expect(existsSync(join(root, '.void'))).toBe(false);
  mkdirSync(join(root, '.void/knowledge.json'), { recursive: true });
  const failed = git(root, 'commit', '--allow-empty', '-m', 'Failed publication');
  expect(failed).toContain('graph project-build');
  expect(failed).toContain('commit completed');
  expect(statSync(join(root, '.void/knowledge.json')).isDirectory()).toBe(true);
});
it('honors a local hooksPath but refuses external and symlink destinations', () => {
  const root = fixture();
  git(root, 'config', 'core.hooksPath', '.custom-hooks');
  install(root); expect(existsSync(join(root, '.custom-hooks/post-commit'))).toBe(true);
  expect(git(root, 'commit', '--allow-empty', '-m', 'Configured path')).toContain('later commit');
  expect(cli(root, 'knowledge', 'hook', 'uninstall').status).toBe(0);
  const outside = mkdtempSync(join(tmpdir(), 'knowledge-external-')); roots.push(outside);
  git(root, 'config', 'core.hooksPath', outside);
  expect(cli(root, 'knowledge', 'hook', 'install').status).toBe(1);
  expect(readdirSync(outside)).toEqual([]);
  git(root, 'config', 'core.hooksPath', '.escape'); symlinkSync(outside, join(root, '.escape'));
  expect(cli(root, 'knowledge', 'hook', 'install').status).toBe(1);
  expect(readdirSync(outside)).toEqual([]);
});
it('resolves the invoking linked worktree rather than the installing worktree', () => {
  const root = fixture();
  expect(install(root)).toContain('worktree');
  const linked = join(root, '../', `${root.split('/').at(-1)} linked`); roots.push(linked);
  git(root, 'worktree', 'add', '-b', 'linked', linked);
  put(linked, 'src/linked.ts', 'export const linked = true;'); git(linked, 'add', '.');
  expect(git(linked, 'commit', '-m', 'Linked source')).toContain('later commit');
  expect(existsSync(join(root, '.void/knowledge.json'))).toBe(false);
  expect(readFileSync(join(linked, '.void/knowledge.json'), 'utf8')).toContain('src/linked.ts');
});
it('terminates the sole stalled writer while its read-only Git child owns no publication', () => {
  const root = fixture();
  const wrapper = join(root, '.git', 'local runner.mjs');
  const mainUrl = pathToFileURL(resolve(dirname(CLI), '../dist/main.js')).href;
  writeFileSync(wrapper, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (process.argv.includes('build-internal')) {
  process.on('SIGTERM', () => {});
  writeFileSync('.git/build.pid', String(process.pid));
  const reader = spawn('git', ['hash-object', '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'] });
  reader.stdin.on('error', () => {});
  setTimeout(() => { writeFileSync('.git/late-write', 'must not happen'); process.exit(0); }, 18000);
} else {
  const { main } = await import(${JSON.stringify(mainUrl)});
  await main(process.argv.slice(2));
}
`);
  const installed = run(root, process.execPath, [wrapper, 'knowledge', 'hook', 'install']);
  expect(installed.status, installed.stderr).toBe(0);
  const start = performance.now();
  const output = git(root, 'commit', '--allow-empty', '-m', 'Stalled regeneration');
  const elapsed = performance.now() - start;
  expect(output).toContain('timed out');
  expect(output).toContain('graph project-build');
  expect(elapsed).toBeLessThan(17000);
  for (const name of ['build.pid']) {
    const pid = Number(readFileSync(join(root, '.git', name), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  }
  // Observe beyond the delayed writer's scheduled action, not just the kill call.
  run(root, process.execPath, ['-e', 'setTimeout(() => {}, 3500)']);
  expect(existsSync(join(root, '.git/late-write'))).toBe(false);
}, 25000);

it('refuses to place a hook inside an independent nested repository', () => {
  const root = fixture(); const nested = join(root, 'independent');
  mkdirSync(nested); git(nested, 'init');
  git(root, 'config', 'core.hooksPath', 'independent/.git/hooks');
  const result = cli(root, 'knowledge', 'hook', 'install');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('independent');
  expect(existsSync(join(nested, '.git/hooks/post-commit'))).toBe(false);
});
it('preserves knowledge freshness gating after a post-commit update', () => {
  const root = fixture(); install(root);
  git(root, 'commit', '--allow-empty', '-m', 'Generate');
  expect(cli(root, 'graph', 'project-check').status).toBe(0);
  put(root, 'src/a.ts', 'export const added = true;');
  expect(cli(root, 'graph', 'project-check').status).toBe(1);
});
it('observes merge and rebase events without installing additional hooks', () => {
  const root = fixture(); install(root);
  git(root, 'checkout', '-b', 'feature');
  put(root, 'src/feature.ts', 'export const feature = 1;'); git(root, 'add', 'src/feature.ts');
  git(root, 'commit', '-m', 'Feature');
  git(root, 'checkout', 'main');
  const merged = git(root, 'merge', '--no-ff', 'feature', '-m', 'Merge feature');
  // Git's merge event is post-merge, not post-commit. Preserve that boundary.
  expect(merged).not.toContain('knowledge observation:');
  git(root, 'checkout', '-b', 'rebased');
  put(root, 'src/rebased.ts', 'export const rebased = true;'); git(root, 'add', 'src/rebased.ts');
  git(root, 'commit', '-m', 'Rebased source');
  git(root, 'checkout', 'main');
  put(root, 'src/main.ts', 'export const main = true;'); git(root, 'add', 'src/main.ts');
  git(root, 'commit', '-m', 'Main source');
  git(root, 'checkout', 'rebased');
  const output = git(root, 'rebase', 'main');
  expect(output).toMatch(/Successfully rebased|up to date/);
  expect(existsSync(join(root, '.git/hooks/post-merge'))).toBe(false);
  expect(existsSync(join(root, '.git/hooks/post-rewrite'))).toBe(false);
});
it('keeps commit success and manual recovery visible when the installed executable disappears', () => {
  const root = fixture();
  const wrapper = join(root, '.git', 'temporary executable.mjs');
  const mainUrl = pathToFileURL(resolve(dirname(CLI), '../dist/main.js')).href;
  writeFileSync(wrapper, `const { main } = await import(${JSON.stringify(mainUrl)}); await main(process.argv.slice(2));`);
  expect(run(root, process.execPath, [wrapper, 'knowledge', 'hook', 'install']).status).toBe(0);
  rmSync(wrapper);
  const output = git(root, 'commit', '--allow-empty', '-m', 'Unavailable CLI');
  expect(output).toContain('commit completed');
  expect(output).toContain('graph project-build');
  expect(existsSync(join(root, '.void/knowledge.json'))).toBe(false);
});
it('keeps the artifact review instruction visible when declarations produce many diagnostics', () => {
  const root = fixture(); install(root);
  for (let index = 0; index < 700; index++) {
    put(root, `.void/knowledge/invariants/invalid-${index}.yaml`, 'not-a-valid-declaration: true\n');
  }
  const output = git(root, 'commit', '--allow-empty', '-m', 'Many declaration diagnostics');
  expect(output).toContain('later commit');
  expect(output).toContain('knowledge observation:');
  expect(output).toContain('knowledge diagnostic:');
  expect(output.length).toBeLessThan(16 * 1024);
});
