// @test-resource subprocess
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
    const { classifyLatencyObservation } = await import('./conformance-latency.mjs');
    expect(classifyLatencyObservation({ code: 0, stdout: campaign('a'.repeat(64)), workerSha256: 'a'.repeat(64) }))
      .toMatchObject({ status: 'complete', failures: 0 });
  });

  it('keeps a measured timeout as a visible latency anomaly, never as a success, and never fails the install for it', async () => {
    const { classifyLatencyObservation } = await import('./conformance-latency.mjs');
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
    const { classifyLatencyObservation } = await import('./conformance-latency.mjs');
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

const consumerSuites = ['install', 'update', 'hooks', 'autopilot', 'latency'];

it('qualifies the original PowerShell File invocation and preserves its failure without a comparison', async () => {
  const { measurePowerShellShim } = await import('./conformance-update.mjs');
  const env = { HOME: '/isolated', NODE_OPTIONS: '--import=file:///offline.mjs' };
  const calls: Array<{ args: string[]; env: typeof env; timeoutMs?: number; diagnosticStderr?: boolean }> = [];
  const result = await measurePowerShellShim({ shim: "C:/fixture's bin/launcher.ps1", args: ['--version', "space '$value"],
    cwd: '/isolated', env, control: true, label: 'native shim' }, async options => {
    calls.push(options);
    return { outcome: { kind: 'exited', code: calls.length === 1 ? 0 : 37 },
      stdout: calls.length === 1 ? 'ready' : 'original output', stderr: '' };
  });
  expect(calls).toHaveLength(2);
  expect(calls.every(call => call.env === env && call.timeoutMs === undefined)).toBe(true);
  expect(calls[0]?.args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "[Console]::Out.Write('ready')"]);
  expect(calls[1]?.args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    "C:/fixture's bin/launcher.ps1", '--version', "space '$value"]);
  expect(result).toMatchObject({ outcome: { kind: 'exited', code: 37 }, stdout: 'original output' });
});

it('compares Command only after successful original File qualification in the same environment', async () => {
  const { measurePowerShellShim } = await import('./conformance-update.mjs');
  const env = { HOME: '/isolated' };
  const calls: Array<{ args: string[]; env: typeof env; timeoutMs?: number; diagnosticStderr?: boolean }> = [];
  const qualified = { outcome: { kind: 'exited', code: 0 }, stdout: '5.0.2\n', stderr: '' };
  const result = await measurePowerShellShim({ shim: "C:/fixture's bin/launcher.ps1", args: ['--version'],
    cwd: '/isolated', env, control: true, label: 'native shim' }, async options => {
    calls.push(options);
    return calls.length === 1 ? { ...qualified, stdout: 'ready' } : qualified;
  });
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.env === env && call.timeoutMs === undefined)).toBe(true);
  expect(calls[1]?.args[3]).toBe('-File');
  expect(calls[2]?.args.at(-1)).toContain("& 'C:/fixture''s bin/launcher.ps1' '--version'");
  expect(calls[2]?.diagnosticStderr).toBe(true);
  expect(result).toBe(qualified);
});

it.each(['failure', 'different output'])('does not hide a PowerShell comparison %s behind successful File qualification', async kind => {
  const { measurePowerShellShim } = await import('./conformance-update.mjs');
  let invocation = 0;
  await expect(measurePowerShellShim({ shim: '/fixture/shim.ps1', args: ['--version'],
    cwd: '/fixture', env: {}, control: true, label: 'shim' }, async () => {
    invocation++;
    return { outcome: { kind: 'exited', code: invocation === 3 && kind === 'failure' ? 37 : 0 },
      stdout: invocation === 1 ? 'ready' : invocation === 2 ? 'version' : 'different', stderr: '' };
  })).rejects.toThrow();
  expect(invocation).toBe(3);
});

it('measures real fixture children, transport and publication without changing results or errors', async () => {
  const { stableUpdateTransportSource } = await import('./conformance-update.mjs');
  const { PRODUCT_IDENTITY } = await import('../../../scripts/product-identity.mjs');
  const { runConformanceProcess } = await import('./conformance-process.mjs');
  const root = mkdtempSync(join(tmpdir(), 'update-boundary-'));
  try {
    const archive = join(root, 'archive.tgz');
    const target = join(root, 'launcher.cmd');
    const fixture = join(root, 'transport.mjs');
    writeFileSync(archive, 'archive bytes');
    writeFileSync(fixture, stableUpdateTransportSource({ tarball: archive, target, version: '5.0.2', integrity: 'fixture-integrity' }));
    for (const name of ['npm-cli.js', 'void-machine.mjs', 'prepare-update.mjs']) {
      writeFileSync(join(root, name), "process.stdout.write('child-output'); process.stderr.write('child-error'); process.exitCode = Number(process.argv[2]);");
    }
    const probe = join(root, 'probe.mjs');
    writeFileSync(probe, `
      import assert from 'node:assert/strict';
      import {execFile} from 'node:child_process';
      import {promisify} from 'node:util';
      import {rename, writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      const root = ${JSON.stringify(root)};
      const metadata = await (await fetch('https://registry.npmjs.org/' + ${JSON.stringify(PRODUCT_IDENTITY.packageName)} + '/latest')).json();
      assert.equal(await (await fetch(metadata.dist.tarball)).text(), 'archive bytes');
      await assert.rejects(fetch('https://unreachable.invalid'), /Unexpected registry request/);
      for (const [name, code] of [['npm-cli.js',0], ['void-machine.mjs',0], ['prepare-update.mjs',37]]) {
        const promise = promisify(execFile)(process.execPath, [join(root,name), String(code)], {timeout:2000});
        assert.ok(promise.child.pid);
        if (code) await assert.rejects(promise, error => error.code === 37 && error.stdout === 'child-output' && error.stderr === 'child-error');
        else assert.deepEqual(await promise, {stdout:'child-output',stderr:'child-error'});
      }
      await new Promise((resolve,reject) => execFile(process.execPath, [join(root,'npm-cli.js'),'0'], {timeout:2000}, (error,stdout,stderr) => {
        if (error) return reject(error);
        assert.equal(stdout,'child-output'); assert.equal(stderr,'child-error'); resolve();
      }));
      await assert.rejects(rename(join(root,'missing'), ${JSON.stringify(target)}), {code:'ENOENT'});
      await writeFile(join(root,'replacement'), 'launcher bytes');
      await rename(join(root,'replacement'), ${JSON.stringify(target)});
      // Exhaust the diagnostic budget; transport and publication must still work.
      for (let index = 0; index < 100; index++) {
        assert.equal(await (await fetch(metadata.dist.tarball)).text(), 'archive bytes');
      }
      await assert.rejects(rename(join(root,'missing'), ${JSON.stringify(target)}), {code:'ENOENT'});
      process.stdout.write('unchanged-result');
    `);
    const events: Array<{ phase: string; detail?: string }> = [];
    const result = await runConformanceProcess({ command: process.execPath,
      args: ['--import', fixture, probe], cwd: root, env: {}, label: 'fixture boundaries', diagnosticStderr: true,
      report: event => events.push(event) });
    expect(result.outcome).toEqual({ kind: 'exited', code: 0 });
    expect(result.stdout).toBe('unchanged-result');
    const measured = result.stderr.trim().split('\n').map(line => JSON.parse(line));
    for (const label of ['npm-cli.js', 'void-machine.mjs', 'prepare-update.mjs', 'metadata', 'archive', 'launcher publication']) {
      expect(measured.some(event => event.label === label && event.phase === 'started')).toBe(true);
      expect(measured.some(event => event.label === label && event.phase === 'finished' && event.durationMs >= 0)).toBe(true);
    }
    expect(measured.some(event => event.label === 'prepare-update.mjs' && event.code === 37)).toBe(true);
    expect(measured.some(event => event.label === 'launcher publication' && event.code === 'ENOENT')).toBe(true);
    expect(events.some(event => event.phase === 'stderr')).toBe(true);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(4096);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('does not repeat a PowerShell control or proceed after a failed control', async () => {
  const { measurePowerShellShim } = await import('./conformance-update.mjs');
  const options = { shim: '/fixture/shim.ps1', args: ['--version'], cwd: '/fixture', env: {}, label: 'shim' };
  const execute = vi.fn(async () => ({ outcome: { kind: 'exited', code: 3 }, stdout: '', stderr: '' }));
  await expect(measurePowerShellShim({ ...options, control: true }, execute)).rejects.toThrow('PowerShell output-only control');
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mockClear();
  expect((await measurePowerShellShim({ ...options, control: false }, execute)).outcome.code).toBe(3);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('runs install and stable update as mandatory serial processes on the same artifact with default bounds', async () => {
  const { exerciseConsumerSuites } = await import('./conformance-consumer.mjs');
  const root = mkdtempSync(join(tmpdir(), 'consumer-suite-boundaries-'));
  const calls: Array<{ args: string[]; env: Record<string, string>; timeoutMs?: number }> = [];
  let active = 0;
  const names = await exerciseConsumerSuites(undefined, '/artifact/consumer.tgz', root, async (options) => {
    expect(active).toBe(0);
    active++;
    calls.push(options);
    await Promise.resolve();
    active--;
    return { outcome: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };
  });
  expect(names).toEqual(consumerSuites);
  expect(calls.map((call) => basename(call.args[0] ?? '')))
    .toEqual(consumerSuites.map((name) => `conformance-${name}.mjs`));
  expect(calls.every((call) => call.env.VOID_CONFORMANCE_TARBALL === '/artifact/consumer.tgz')).toBe(true);
  expect(calls.every((call) => call.timeoutMs === undefined)).toBe(true);
  await expect(exerciseConsumerSuites('latency', '/artifact/consumer.tgz', root, async () => ({
    outcome: { kind: 'timed-out' }, stdout: '', stderr: '',
  }))).rejects.toThrow('latency: timed-out');
});

it.each(consumerSuites)('selects only the requested %s suite through the same owner', async suite => {
  const { exerciseConsumerSuites } = await import('./conformance-consumer.mjs');
  const root = mkdtempSync(join(tmpdir(), 'consumer-suite-selection-'));
  const calls: string[] = [];
  expect(await exerciseConsumerSuites(suite, '/artifact/consumer.tgz', root, async options => {
    calls.push(basename(options.args[0]));
    expect(options.env.VOID_CONFORMANCE_TARBALL).toBe('/artifact/consumer.tgz');
    expect(options.timeoutMs).toBeUndefined();
    return { outcome: { kind: 'exited', code: 0 }, stdout: '', stderr: '' };
  })).toEqual([suite]);
  expect(calls).toEqual([`conformance-${suite}.mjs`]);
});

it.each(consumerSuites)('stops the mandatory chain on %s failure without launching any later proof', async suite => {
  const { exerciseConsumerSuites } = await import('./conformance-consumer.mjs');
  const root = mkdtempSync(join(tmpdir(), 'consumer-suite-failure-'));
  const calls: string[] = [];
  await expect(exerciseConsumerSuites(undefined, '/artifact/consumer.tgz', root, async options => {
    const name = basename(options.args[0], '.mjs').replace('conformance-', '');
    calls.push(name);
    return { outcome: { kind: 'exited', code: name === suite ? 1 : 0 }, stdout: '', stderr: 'proof failed' };
  })).rejects.toThrow(`${suite}: exited`);
  expect(calls).toEqual(consumerSuites.slice(0, consumerSuites.indexOf(suite) + 1));
});
