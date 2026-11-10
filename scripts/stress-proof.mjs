#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireConformanceExit,
  runConformanceProcess,
  safeConformanceDiagnostic,
} from '../packages/cli/scripts/conformance-process.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITS = Object.freeze({ fast: 20, complete: 10 });
const COMPLETE_LANES = ['test:cpu', 'test:filesystem', 'test:subprocess', 'test:network'];

function fail(message) {
  throw new Error(`stress proof: ${message}`);
}

function commandFor(script, seed) {
  return ['pnpm', script, '--sequence.shuffle', `--sequence.seed=${seed}`];
}

export function stressPlan(mode, attempts, firstSeed) {
  if (!Object.hasOwn(LIMITS, mode)) fail(`unsupported mode: ${mode}`);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > LIMITS[mode]) {
    fail(`${mode} attempts must be an integer from 1 through ${LIMITS[mode]}`);
  }
  if (!Number.isInteger(firstSeed) || firstSeed < 1 || firstSeed > 2_147_483_647) {
    fail('first seed must be a positive 32-bit integer');
  }
  if (firstSeed + attempts - 1 > 2_147_483_647) {
    fail('seed range must stay within positive 32-bit integers');
  }
  return Array.from({ length: attempts }, (_, index) => {
    const seed = firstSeed + index;
    const scripts = mode === 'fast' ? ['test:fast'] : COMPLETE_LANES;
    return {
      attempt: index + 1,
      commands: scripts.map((script) => commandFor(script, seed)),
      seed,
    };
  });
}

async function sourceSha() {
  const result = await runConformanceProcess({
    command: 'git',
    args: ['-C', ROOT, 'rev-parse', '--verify', 'HEAD'],
    cwd: ROOT,
  });
  return requireConformanceExit(result, 'stress proof source SHA').stdout.trim();
}

async function execute(command) {
  const started = performance.now();
  const result = await runConformanceProcess({
    command: command[0],
    args: command.slice(1),
    cwd: ROOT,
    timeoutMs: 300_000,
  });
  return {
    argv: command,
    durationMs: Math.round(performance.now() - started),
    outcome: result.outcome,
    diagnostic: result.outcome.kind === 'exited' && result.outcome.code === 0
      ? undefined
      : safeConformanceDiagnostic(`${result.stdout}\n${result.stderr}`.trim()),
  };
}

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

async function campaign(mode, attempts, firstSeed) {
  const plan = stressPlan(mode, attempts, firstSeed);
  const sha = await sourceSha();
  const observations = [];
  let failed = false;
  for (const attempt of plan) {
    const commands = [];
    for (const command of attempt.commands) {
      const observation = await execute(command);
      commands.push(observation);
      if (observation.outcome.kind !== 'exited' || observation.outcome.code !== 0) {
        failed = true;
        break;
      }
    }
    observations.push({ attempt: attempt.attempt, seed: attempt.seed, commands });
    if (failed) break;
  }
  const report = Object.freeze({
    schemaVersion: 1,
    sourceSha: sha,
    mode,
    requestedAttempts: attempts,
    completedAttempts: observations.filter((entry) =>
      entry.commands.length === plan[0].commands.length
      && entry.commands.every((command) =>
        command.outcome.kind === 'exited' && command.outcome.code === 0,
      )).length,
    firstSeed,
    workerBudgets: { cpu: 4, filesystem: 2, subprocess: 1, networkBrowser: 1 },
    verdict: failed ? 'failed' : 'passed',
    attempts: observations,
  });
  const configured = process.env.VOID_STRESS_REPORT_PATH;
  const path = resolve(configured ?? `.void/machine/proofs/test-certification/${mode}.json`);
  await writeReport(path, report);
  if (failed) fail(`${mode} campaign failed; evidence: ${path}`);
  process.stdout.write(`${mode} stress passed ${attempts}/${attempts} for ${sha}; evidence: ${path}\n`);
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await campaign(process.argv[2], Number(process.argv[3]), Number(process.argv[4]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${safeConformanceDiagnostic(message)}\n`);
    process.exitCode = 1;
  }
}
