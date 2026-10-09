#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformanceArtifactFromEnvironment } from './conformance-artifact.mjs';
import { conformanceFixtureEnvironment, requireConformanceExit, runConformanceProcess } from './conformance-process.mjs';
import { expectedSyntaxWorkerIdentity, installPackage, proveInstalledSyntaxWorker } from './conformance-install.mjs';

const LATENCY_CASES = ['node-baseline', 'typescript', 'tsx', 'large', 'invalid-source', 'invalid-request'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function classifyLatencyObservation({ code, stdout, workerSha256 }) {
  if (code !== 0 && code !== 1) throw new Error(`LATENCY_OBSERVATION_EXIT: the campaign exited ${code}`);
  let lines;
  try { lines = stdout.trim().split('\n').map((line) => JSON.parse(line)); } catch { lines = undefined; }
  const header = lines?.[0];
  if (header === undefined || typeof header.workerSha256 !== 'string' || !Number.isSafeInteger(header.samplesPerCase)) {
    throw new Error('LATENCY_OBSERVATION_UNREADABLE: no campaign header');
  }
  if (header.workerSha256 !== workerSha256) {
    throw new Error(`LATENCY_OBSERVATION_WORKER: measured ${header.workerSha256}, installed ${workerSha256}`);
  }
  const cases = lines.slice(1);
  if (canonical(cases.map((item) => item.case)) !== canonical(LATENCY_CASES)
    || cases.some((item) => !Array.isArray(item.samples) || item.samples.length !== header.samplesPerCase)) {
    throw new Error('LATENCY_OBSERVATION_INCOMPLETE: every case needs every sample');
  }
  const anomalies = [];
  for (const item of cases) {
    for (const sample of item.samples) {
      if (sample.valid === true) {
        if (typeof sample.cpuMs !== 'number' || typeof sample.rssKiB !== 'number') {
          throw new Error(`LATENCY_OBSERVATION_INCOHERENT: ${item.case} counts a sample valid without its metrics`);
        }
      } else if (sample.error === 'ETIMEDOUT') {
        anomalies.push({ case: item.case, ...sample });
      } else {
        throw new Error(`LATENCY_OBSERVATION_PROTOCOL: ${item.case} sample failed with ${sample.error ?? 'a wrong answer'}`);
      }
    }
    if (item.failures !== item.samples.filter((sample) => sample.valid !== true).length) {
      throw new Error(`LATENCY_OBSERVATION_INCOHERENT: ${item.case} reports ${item.failures} failures`);
    }
  }
  if (code !== (anomalies.length > 0 ? 1 : 0)) {
    throw new Error(`LATENCY_OBSERVATION_EXIT: exit ${code} with ${anomalies.length} failed samples`);
  }
  return { status: anomalies.length > 0 ? 'latency-anomaly' : 'complete', failures: anomalies.length, workerSha256,
    environment: { node: header.node, platform: header.platform, arch: header.arch }, cases, anomalies };
}

async function observeSyntaxWorkerLatency(fixture, environment, worker, workerSha256) {
  const label = 'packed TypeScript worker latency observation';
  process.stdout.write(`${JSON.stringify({ phase: 'started', label })}\n`);
  const result = await runConformanceProcess({ command: process.execPath,
    args: [fileURLToPath(new URL('../../hook-runner/benchmarks/syntax-worker.mjs', import.meta.url))],
    cwd: fixture, env: { ...environment, VOID_BENCHMARK_WORKER: worker } });
  // Exit 1 is only admitted when the classification below proves a measured timeout.
  requireConformanceExit(result, label, [0, 1]);
  process.stdout.write(result.stdout);
  const observation = classifyLatencyObservation({ code: result.outcome.code, stdout: result.stdout, workerSha256 });
  process.stdout.write(`${JSON.stringify({ observation: 'syntax-worker-latency', status: observation.status,
    failures: observation.failures, workerSha256, environment: observation.environment,
    anomalies: observation.anomalies })}\n`);
  if (observation.status === 'latency-anomaly') {
    process.stderr.write(`latency anomaly (not an install verdict): ${observation.failures} measured timeout(s) in ${label}\n`);
  }
}


async function main() {
  const { tarball } = await conformanceArtifactFromEnvironment();
  const temporary = await mkdtemp(join(tmpdir(), 'void-latency-conformance-'));
  try {
    const bin = await installPackage(temporary, tarball);
    const worker = join(dirname(bin), '../core-assets/hooks/_syntax-worker.cjs');
    await mkdir(join(temporary, 'tmp'), { recursive: true });
    const environment = conformanceFixtureEnvironment(temporary);
    const identitySource = new URL('../../hook-runner/src/enforcement/syntax-worker-identity.generated.ts', import.meta.url);
    const proof = await proveInstalledSyntaxWorker({ worker,
      identity: expectedSyntaxWorkerIdentity(await readFile(identitySource, 'utf8')),
      execute: (input) => runConformanceProcess({ command: process.execPath,
        args: ['--max-old-space-size=128', worker], cwd: temporary, env: {}, input, timeoutMs: 5_000 }) });
    await observeSyntaxWorkerLatency(temporary, environment, worker, proof.sha256);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
