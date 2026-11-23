// @test-resource subprocess
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('one package installation proof across runtime consumers', () => {
  it('installs the immutable package once and exercises all three isolated runtime roots', async () => {
    const { exerciseInstalledRuntimes } = await import('./conformance-install.mjs');
    let installations = 0;
    const exercises: string[] = [];
    const durations = await exerciseInstalledRuntimes(async () => {
      installations += 1;
      return '/package/node_modules/pkg/bin/cli.mjs';
    }, async (bin: string, runtime: string) => {
      exercises.push(runtime);
      expect(bin).toBe('/package/node_modules/pkg/bin/cli.mjs');
      return 12;
    });
    expect(installations).toBe(1);
    expect(exercises).toEqual(['claude', 'codex', 'both']);
    expect(durations).toEqual([12, 12, 12]);
  });

  it('does not install or execute later consumers after a failed runtime proof', async () => {
    const { exerciseInstalledRuntimes } = await import('./conformance-install.mjs');
    let installations = 0;
    const exercises: string[] = [];
    await expect(exerciseInstalledRuntimes(async () => {
      installations += 1;
      return '/package/bin';
    }, async (_bin: string, runtime: string) => {
      exercises.push(runtime);
      throw new Error('ownership mismatch');
    })).rejects.toThrow('ownership mismatch');
    expect(installations).toBe(1);
    expect(exercises).toEqual(['claude']);
  });
});

it('runs each consumer suite on the same artifact', async () => {
  const { exerciseConsumerSuites } = await import('./conformance-consumer.mjs');
  const root = mkdtempSync(join(tmpdir(), 'consumer-suite-boundaries-'));
  const calls: Array<{ args: string[]; env: Record<string, string>; timeoutMs?: number }> = [];
  const names = await exerciseConsumerSuites(undefined, '/artifact/consumer.tgz', root, async (options) => {
    calls.push(options);
    return { outcome: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };
  });
  expect(names).toEqual(['install', 'hooks', 'autopilot']);
  expect(calls).toHaveLength(3);
  expect(new Set(calls.map((call) => call.args[0])).size).toBe(3);
  expect(calls.every((call) => call.env.VOID_CONFORMANCE_TARBALL === '/artifact/consumer.tgz')).toBe(true);
  expect(calls.every((call) => call.timeoutMs === undefined)).toBe(true);
  await expect(exerciseConsumerSuites('hooks', '/artifact/consumer.tgz', root, async () => ({
    outcome: { kind: 'timed-out' }, stdout: '', stderr: '',
  }))).rejects.toThrow('hooks: timed-out');
});


it('executes the installed CI admission driver for draft and ready pull requests', async () => {
  const { proveInstalledCiAdmission } = await import('./conformance-install.mjs');
  const root = mkdtempSync(join(tmpdir(), 'installed-ci-admission-'));
  try {
    cpSync(resolve('packages/core/skills/void-verify'), join(root, '.claude/skills/void-verify'), { recursive: true });
    await proveInstalledCiAdmission(root, '.claude', {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});
