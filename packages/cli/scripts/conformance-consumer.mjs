#!/usr/bin/env node

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  packConformanceArtifact,
  verifyConformanceArtifactForCheckout,
} from './conformance-artifact.mjs';
import {
  conformanceFixtureEnvironment,
  safeConformanceDiagnostic,
  runConformanceProcess,
  runConformanceSuites,
} from './conformance-process.mjs';
import { loadLegacyOracle } from './conformance-legacy-oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const SUITES = Object.freeze({
  install: join(HERE, 'conformance-install.mjs'),
  hooks: join(HERE, 'conformance-hooks.mjs'),
  autopilot: join(HERE, 'conformance-autopilot.mjs'),
  latency: join(HERE, 'conformance-latency.mjs'),
});

function fail(message) {
  throw new Error(`consumer conformance: ${message}`);
}

function parseArguments(args) {
  if (args.length > 8) fail('too many arguments');
  let suite;
  let tarball;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) fail(`${flag} requires a value`);
    if (flag === '--suite' && suite === undefined) suite = value;
    else if (flag === '--tarball' && tarball === undefined) tarball = value;
    else fail(`unsupported or repeated argument: ${flag}`);
  }
  if (suite !== undefined && !(suite in SUITES)) fail(`unknown suite: ${suite}`);
  return { suite, tarball };
}

async function runSuite(name, script, tarball, temporary, execute) {
  const processRoot = join(temporary, `suite-${name}`);
  await mkdir(join(processRoot, 'tmp'), { recursive: true });
  const result = await execute({
    command: process.execPath,
    args: [script],
    cwd: REPO_ROOT,
    env: conformanceFixtureEnvironment(processRoot, {
      VOID_CONFORMANCE_TARBALL: tarball,
    }),
  });
  if (result.outcome.kind === 'exited' && result.outcome.code === 0) {
    process.stdout.write(result.stdout);
    return undefined;
  }
  const diagnostic = safeConformanceDiagnostic(
    `${result.stdout}\n${result.stderr}`.trim(),
  );
  return [
    `${name}: ${result.outcome.kind}`,
    diagnostic === '' ? undefined : diagnostic,
  ].filter(Boolean).join('\n');
}

export async function exerciseConsumerSuites(suite, tarball, temporary, execute = runConformanceProcess) {
  if (suite !== undefined && !(suite in SUITES)) fail(`unknown suite: ${suite}`);
  const selected = suite === undefined ? Object.entries(SUITES) : [[suite, SUITES[suite]]];
  await runConformanceSuites(selected, ([name, script]) =>
    runSuite(name, script, tarball, temporary, execute));
  return selected.map(([name]) => name);
}

async function main() {
  const oracle = loadLegacyOracle();
  if (!oracle.ok) fail(`legacy oracle: ${oracle.reason}`);
  const options = parseArguments(process.argv.slice(2));
  const temporary = await mkdtemp(join(tmpdir(), 'harness-consumer-conformance-'));
  try {
    const artifact = options.tarball === undefined
      ? await packConformanceArtifact(join(temporary, 'artifact'))
      : await verifyConformanceArtifactForCheckout(options.tarball);
    const selected = await exerciseConsumerSuites(options.suite, artifact.tarball, temporary);
    process.stdout.write(
      `consumer conformance passed for ${artifact.manifest.sourceSha}: ${selected.join(', ')}\n`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${safeConformanceDiagnostic(message)}\n`);
    process.exitCode = 1;
  }
}
