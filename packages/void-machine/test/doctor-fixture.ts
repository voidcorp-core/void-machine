import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { onTestFinished } from 'vitest';

const project = resolve(import.meta.dirname, '../../..');
// Same source-loader mechanism as test/autopilot/stdin-process.test.ts.
const loader = pathToFileURL(resolve(project, 'packages/cli/node_modules/tsx/dist/loader.mjs')).href;
const entry = resolve(project, 'packages/void-machine/src/application/cli.ts');
// Bounds stop a hang; they never measure speed. One generous value for every process, and a
// test bound above it, so a hung child is reported by its own bound before the test's.
const childTimeoutMs = 20_000;
export const processTestTimeoutMs = 30_000;

export function doctorFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'machine-doctor-')));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(home);
  // Hermetic, but not empty: a commit otherwise leaves a detached `git maintenance` writing in
  // the repository while `rmSync` removes it, which fails the test after its assertions passed.
  const gitConfig = join(home, '.gitconfig');
  writeFileSync(gitConfig, '[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    SystemRoot: process.env['SystemRoot'],
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const git = (args: readonly string[], cwd = root) => execFileSync('git', [...args], {
    cwd, env, encoding: 'utf8', timeout: childTimeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(['init', '--quiet', repository]);
  mkdirSync(join(repository, '.void'));
  // Test hosts run through the same source loader as the CLI entry.
  const invokeScript = (script: string, args: readonly string[], cwd = repository,
    extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(process.execPath, ['--import', loader, script, ...args], {
      cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: childTimeoutMs,
      maxBuffer: 1024 * 1024, windowsHide: true,
    });
    if (result.error) throw result.error;
    return result;
  };
  const invoke = (args: readonly string[], cwd = repository, extra: NodeJS.ProcessEnv = {}) =>
    invokeScript(entry, args, cwd, extra);
  // Concurrent processes need an asynchronous launch; the bound stays explicit.
  const launchScript = (script: string, args: readonly string[], cwd = repository) => new Promise<{
    status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string;
  }>((settle, reject) => {
    const child = spawn(process.execPath, ['--import', loader, script, ...args], {
      cwd, env, windowsHide: true, timeout: childTimeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    // A RED failure must not leave a Machine process behind the test.
    onTestFinished(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', (status, signal) => settle({ status, signal, stdout, stderr }));
  });
  const launch = (args: readonly string[], cwd = repository) => launchScript(entry, args, cwd);
  return { root, repository, home, git, invoke, invokeScript, launch, launchScript };
}

export function contentsDigest(root: string): string {
  const hash = createHash('sha256');
  function visit(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
      const file = join(path, entry.name);
      hash.update(file);
      if (entry.isDirectory()) visit(file);
      else hash.update(readFileSync(file));
    }
  }
  visit(root);
  return hash.digest('hex');
}
