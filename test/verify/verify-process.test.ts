import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const REPORT_ROOT = resolve(ROOT, '.void', 'machine', `gate-runner-test-${String(process.pid)}`);
const REPORT = resolve(REPORT_ROOT, 'version-lockstep.json');
const SCRIPT = resolve(ROOT, 'scripts', 'verify.mjs');

function gitHead(): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
}

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

beforeAll(() => {
  mkdirSync(REPORT_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(REPORT_ROOT, { recursive: true, force: true });
});

describe('single gate process', () => {
  it('writes one atomic report bound to the checked-out commit and exact argv', () => {
    const sha = gitHead();
    const result = run([
      '--gate',
      'version-lockstep',
      '--sha',
      sha,
      '--report',
      `.void/machine/gate-runner-test-${String(process.pid)}/version-lockstep.json`,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(REPORT, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      gateId: 'version-lockstep',
      sha,
      argv: ['pnpm', 'version:check'],
      status: 'passed',
      exitCode: 0,
    });
  });

  it('refuses a claimed SHA that is not the checked-out commit', () => {
    const path = `.void/machine/gate-runner-test-${String(process.pid)}/stale.json`;
    const result = run([
      '--gate',
      'version-lockstep',
      '--sha',
      'a'.repeat(40),
      '--report',
      path,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/checked-out|HEAD|SHA/i);
  });

  it('refuses to overwrite an existing report', () => {
    const sha = gitHead();
    const path = `.void/machine/gate-runner-test-${String(process.pid)}/existing.json`;
    const original = '{"preserved":true}\n';
    writeFileSync(resolve(ROOT, path), original, { flag: 'wx' });
    const result = run(['--gate', 'version-lockstep', '--sha', sha, '--report', path]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/already exists/);
    expect(readFileSync(resolve(ROOT, path), 'utf8')).toBe(original);
  });
});
