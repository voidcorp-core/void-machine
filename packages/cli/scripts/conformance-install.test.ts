// @test-resource subprocess
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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

// The packed worker's latency campaign measured a shared runner and decided the install: one
// sample past its 5 s hang guard failed the package (macOS run 37300273151). The worker contract
// defines 5 s as a bounded refusal, not a latency target, so the install keeps a blocking proof
// of the worker itself and reports the campaign as an observation that is never hidden.
describe('the installed syntax worker: a blocking proof, and a latency observation', () => {
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const installed = (content: string) => {
    const path = join(mkdtempSync(join(tmpdir(), 'conformance-worker-')), '_syntax-worker.cjs');
    writeFileSync(path, content);
    return path;
  };
  const exact = async (input: string) => {
    const request = JSON.parse(input) as { source: string };
    const kind = request.source === 'const = ;' ? { kind: 'invalid-source' } : { kind: 'inspected', lines: [1] };
    return { outcome: { kind: 'exited', code: 0 }, stdout: JSON.stringify({ version: 1, ...kind }) };
  };

  it('reads the identity the runtime itself verifies', async () => {
    const { expectedSyntaxWorkerIdentity } = await import('./conformance-install.mjs');
    expect(expectedSyntaxWorkerIdentity('export const SYNTAX_WORKER_IDENTITY = {"sha256":"' + 'a'.repeat(64) + '","bytes":12};'))
      .toEqual({ sha256: 'a'.repeat(64), bytes: 12 });
    expect(() => expectedSyntaxWorkerIdentity('export const OTHER = 1;')).toThrow(/SYNTAX_WORKER_IDENTITY/);
  });

  it('passes the worker that has its identity and answers exactly', async () => {
    const { proveInstalledSyntaxWorker } = await import('./conformance-install.mjs');
    const worker = installed('worker');
    await expect(proveInstalledSyntaxWorker({ worker, identity: { sha256: sha256('worker'), bytes: 6 }, execute: exact }))
      .resolves.toBeDefined();
  });

  it.each([
    ['absent', /SYNTAX_WORKER_ABSENT/, (w: string) => `${w}.missing`, exact],
    ['corrupt', /SYNTAX_WORKER_IDENTITY/, (w: string) => (writeFileSync(w, 'worked'), w), exact],
    ['wrong answer', /SYNTAX_WORKER_ANSWER/, (w: string) => w, async () => ({ outcome: { kind: 'exited', code: 0 },
      stdout: JSON.stringify({ version: 1, kind: 'inspected', lines: [] }) })],
    ['timed out', /SYNTAX_WORKER_ANSWER/, (w: string) => w, async () => ({ outcome: { kind: 'timed-out' }, stdout: '' })],
  ])('blocks the install on a worker that is %s', async (_case, refusal, locate, execute) => {
    const { proveInstalledSyntaxWorker } = await import('./conformance-install.mjs');
    const worker = installed('worker');
    await expect(proveInstalledSyntaxWorker({ worker: locate(worker),
      identity: { sha256: sha256('worker'), bytes: 6 }, execute })).rejects.toThrow(refusal);
  });

  const CASES = ['node-baseline', 'typescript', 'tsx', 'large', 'invalid-source', 'invalid-request'];
  // A failed sample is a timeout the campaign measured, unless another failure is named.
  const TIMEOUT = { wallMs: 5004.7, valid: false, error: 'ETIMEDOUT' };
  const campaign = (workerSha256: string, failed: Readonly<Record<string, number>> = {}, drop?: string,
    failure: Readonly<Record<string, unknown>> = TIMEOUT) => [
    JSON.stringify({ node: 'v24.20.0', platform: 'darwin', arch: 'arm64', workerSha256, samplesPerCase: 30 }),
    ...CASES.filter((name) => name !== drop).map((name) => {
      const count = failed[name] ?? 0;
      const samples = Array.from({ length: 30 }, (_, index) => index < count
        ? failure : { wallMs: 120, cpuMs: 110, rssKiB: 74000, valid: true });
      return JSON.stringify({ case: name, failures: count, samples });
    }),
  ].join('\n') + '\n';

  it('reports a complete campaign without a failed sample as complete', async () => {
    const { classifyLatencyObservation } = await import('./conformance-install.mjs');
    expect(classifyLatencyObservation({ code: 0, stdout: campaign('a'.repeat(64)), workerSha256: 'a'.repeat(64) }))
      .toMatchObject({ status: 'complete', failures: 0 });
  });

  it('keeps a measured timeout as a visible latency anomaly, never as a success, and never fails the install for it', async () => {
    const { classifyLatencyObservation } = await import('./conformance-install.mjs');
    const observation = classifyLatencyObservation({ code: 1,
      stdout: campaign('a'.repeat(64), { 'invalid-request': 1 }), workerSha256: 'a'.repeat(64) });
    expect(observation).toMatchObject({ status: 'latency-anomaly', failures: 1 });
    expect(observation.anomalies).toEqual([expect.objectContaining({ case: 'invalid-request', error: 'ETIMEDOUT', valid: false })]);
    expect(observation.cases.reduce((sum: number, item: { samples: unknown[] }) => sum + item.samples.length, 0)).toBe(180);
  });

  it.each([
    ['a crashed campaign', /LATENCY_OBSERVATION_EXIT/, 2, campaign('a'.repeat(64))],
    ['an incomplete campaign', /LATENCY_OBSERVATION_INCOMPLETE/, 0, campaign('a'.repeat(64), {}, 'large')],
    ['another worker', /LATENCY_OBSERVATION_WORKER/, 0, campaign('b'.repeat(64))],
    ['an exit that contradicts its samples', /LATENCY_OBSERVATION_EXIT/, 0, campaign('a'.repeat(64), { tsx: 1 })],
    ['unreadable output', /LATENCY_OBSERVATION_UNREADABLE/, 1, 'not json\n'],
    // Only a measured timeout is a latency anomaly: a wrong answer or a launch error is a defect.
    ['a sample with a wrong answer', /LATENCY_OBSERVATION_PROTOCOL/, 1, campaign('a'.repeat(64), { typescript: 1 }, undefined,
      { wallMs: 130, cpuMs: 120, rssKiB: 74000, valid: false })],
    ['a sample that could not launch', /LATENCY_OBSERVATION_PROTOCOL/, 1, campaign('a'.repeat(64), { tsx: 1 }, undefined,
      { wallMs: 3, valid: false, error: 'ENOENT' })],
    // A sample counted valid must carry the metrics its validity was read from.
    ['a valid sample without metrics', /LATENCY_OBSERVATION_INCOHERENT/, 0, campaign('a'.repeat(64)).replace('{"wallMs":120,"cpuMs":110,"rssKiB":74000,"valid":true}',
      '{"wallMs":120,"valid":true}')],
  ])('refuses to read %s as an observation', async (_case, refusal, code, stdout) => {
    const { classifyLatencyObservation } = await import('./conformance-install.mjs');
    expect(() => classifyLatencyObservation({ code, stdout, workerSha256: 'a'.repeat(64) })).toThrow(refusal);
  });
});

// Reproduce the shared deadline without a wall-clock race: the external CLI writes a
// conformant fixture, while the separate measurement process exhausts its budget.
// The real installer still checks doctrine, receipts, preservation and worker answers.
vi.mock('./conformance-process.mjs', async (original) => {
  const actual = await original<typeof import('./conformance-process.mjs')>();
  return { ...actual, runConformanceStep: async (_label: string, options: { cwd: string; args: string[] }) => {
    const fixture = options.cwd;
    const bin = options.args[0];
    const write = (path: string, contents: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    };
    const receipt = join(fixture, '.void/machine/receipts/install-v1.json');
    if (!existsSync(receipt)) write(receipt, JSON.stringify({ source: 'fixture', runtimes: ['codex'], files: [] }));
    if (options.args[1] === 'init') {
      const assets = join(dirname(bin), '../core-assets');
      for (const [source, target] of [
        ['PHILOSOPHY.md', '.void/installed/PHILOSOPHY.md'],
        ['hooks/_syntax-worker.cjs', '.void/hooks/_syntax-worker.cjs'],
      ]) {
        mkdirSync(dirname(join(fixture, target)), { recursive: true });
        copyFileSync(join(assets, source), join(fixture, target));
      }
      write(join(fixture, '.void/hooks/_void-hook.mjs'), 'fixture');
      write(join(fixture, '.agents/skills/void-tdd/SKILL.md'), 'fixture');
      write(join(fixture, '.codex/hooks.json'), '{}');
    }
    return { outcome: { kind: 'exited', code: 0 }, stdout: '', stderr: '', durationMs: 1 };
  }, runConformanceProcess: async (options: Parameters<typeof actual.runConformanceProcess>[0]) => {
    if (options.args?.some((arg: string) => arg.endsWith('benchmarks/syntax-worker.mjs'))) {
      return { outcome: { kind: 'timed-out' }, stdout: '', stderr: '', durationMs: 120_000 };
    }
    return actual.runConformanceProcess(options);
  } };
});

it('completes Codex installation proofs independently of the latency campaign', async () => {
  const { exerciseRuntime } = await import('./conformance-install.mjs');
  const root = mkdtempSync(join(tmpdir(), 'install-without-latency-'));
  const bin = fileURLToPath(new URL('../bin/void-machine.mjs', import.meta.url));
  await expect(exerciseRuntime(root, bin, 'codex')).resolves.toBeGreaterThan(0);
});
