#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_IDENTITY } from '../../../scripts/product-identity.mjs';
import { conformanceArtifactFromEnvironment } from './conformance-artifact.mjs';
import {
  conformanceFixtureEnvironment,
  packageManagerCommand,
  runConformanceProcess,
  runConformanceStep,
} from './conformance-process.mjs';

async function run(label, command, args, cwd, env) {
  return runConformanceStep(`install conformance ${label}`, { command, args, cwd, env });
}

// The installed syntax worker is proven, not measured: it must be the bytes the runtime verifies
// and answer representative requests exactly, or the install fails. Its latency campaign is an
// observation: the worker contract makes 5 s a bounded refusal, not a latency target.
const SYNTAX_WORKER_IDENTITY_SOURCE = new URL(
  '../../hook-runner/src/enforcement/syntax-worker-identity.generated.ts', import.meta.url);
const SYNTAX_WORKER_BUDGET_MS = 5_000;
const SYNTAX_WORKER_REQUESTS = [
  { input: { version: 1, path: 'view.test.ts', source: 'test.only("case", () => {});', purpose: 'focused-tests' },
    answer: { version: 1, kind: 'inspected', lines: [1] } },
  { input: { version: 1, path: 'view.test.ts', source: 'const = ;', purpose: 'focused-tests' },
    answer: { version: 1, kind: 'invalid-source' } },
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function expectedSyntaxWorkerIdentity(source) {
  const match = /SYNTAX_WORKER_IDENTITY\s*=\s*(\{[^}]*\})/.exec(source);
  let identity;
  try { identity = match === null ? undefined : JSON.parse(match[1]); } catch { identity = undefined; }
  if (identity === undefined || !/^[a-f0-9]{64}$/.test(identity.sha256 ?? '')
    || !Number.isSafeInteger(identity.bytes) || identity.bytes < 1) {
    throw new Error('SYNTAX_WORKER_IDENTITY: the generated worker identity is unreadable');
  }
  return { sha256: identity.sha256, bytes: identity.bytes };
}

export async function proveInstalledSyntaxWorker({ worker, identity, execute }) {
  if (!existsSync(worker)) throw new Error(`SYNTAX_WORKER_ABSENT: ${worker}`);
  const bytes = await readFile(worker);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== identity.bytes || sha256 !== identity.sha256) {
    throw new Error(`SYNTAX_WORKER_IDENTITY: installed ${sha256} (${bytes.length} bytes), expected ${identity.sha256}`);
  }
  for (const request of SYNTAX_WORKER_REQUESTS) {
    const result = await execute(JSON.stringify(request.input));
    let answer;
    try { answer = JSON.parse(result.stdout); } catch { answer = undefined; }
    if (result.outcome.kind !== 'exited' || result.outcome.code !== 0 || canonical(answer) !== canonical(request.answer)) {
      throw new Error(`SYNTAX_WORKER_ANSWER: ${result.outcome.kind} ${result.outcome.code ?? ''}, expected ${canonical(request.answer)}`);
    }
  }
  return { worker, sha256, answers: SYNTAX_WORKER_REQUESTS.length };
}


function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`conformance missing ${label}: ${path}`);
}

export async function installPackage(temporary, tarball) {
  const fixture = join(temporary, 'package');
  await mkdir(join(fixture, 'tmp'), { recursive: true });
  const environment = conformanceFixtureEnvironment(fixture);
  const npm = packageManagerCommand('npm');
  await run(
    'package install',
    npm.executable,
    [
      ...npm.prefixArguments,
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    fixture,
    environment,
  );
  return join(fixture, 'node_modules', PRODUCT_IDENTITY.packageName, 'bin', `${PRODUCT_IDENTITY.commands.primary}.mjs`);
}

// `npx <package>` resolves the command from the package manifest, not from a
// path: with several bin files, npm runs only the one named after the package.
// Every other step here calls the installed bin directly and cannot see that.
async function execByPackageName(temporary, tarball) {
  const fixture = join(temporary, 'exec');
  await mkdir(join(fixture, 'tmp'), { recursive: true });
  const npm = packageManagerCommand('npm');
  const result = await run(
    'package exec',
    npm.executable,
    [...npm.prefixArguments, 'exec', '--offline', '--yes', '--', `file:${tarball}`, '--version'],
    fixture,
    conformanceFixtureEnvironment(fixture),
  );
  if (!/\d+\.\d+\.\d+/.test(result.stdout)) {
    throw new Error(`install conformance package exec printed no version: ${result.stdout.trim()}`);
  }
}

const CUSTOM_DOCTRINE = '# Project rules\r\n\r\n- Preserve accents: dépôt, and this custom rule.\r\n';

async function assertDoctrine(fixture, bin, stage) {
  const custom = await readFile(join(fixture, '.void', 'PROJECT-DOCTRINE.md'), 'utf8');
  if (custom !== CUSTOM_DOCTRINE) throw new Error(`${stage} changed customized PROJECT-DOCTRINE bytes`);
  const expected = await readFile(join(dirname(bin), '..', 'core-assets', 'PHILOSOPHY.md'), 'utf8');
  const installed = await readFile(join(fixture, '.void', 'installed', 'PHILOSOPHY.md'), 'utf8');
  if (installed !== expected || !installed.includes('${VOID_WORKTREES:-${XDG_DATA_HOME:-$HOME/.local/share}/git-worktrees}')
    || !installed.includes('git worktree move') || !installed.includes('git worktree prune')) {
    throw new Error(`${stage} did not deliver the packaged universal worktree invariant`);
  }
}

export async function exerciseRuntime(temporary, bin, runtime) {
  const fixture = join(temporary, `fixture-${runtime}`);
  await mkdir(join(fixture, 'tmp'), { recursive: true });
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    name: `conformance-${runtime}`, private: true,
  }));
  await mkdir(join(fixture, '.void'), { recursive: true });
  await writeFile(join(fixture, '.void', 'PROJECT-DOCTRINE.md'), CUSTOM_DOCTRINE);
  const environment = conformanceFixtureEnvironment(fixture);
  const started = performance.now();
  await run(
    `${runtime} init`,
    process.execPath,
    [bin, 'init', '--runtime', runtime, '--no-interactive'],
    fixture,
    environment,
  );

  await assertDoctrine(fixture, bin, `${runtime} init`);
  await run(`${runtime} re-init`, process.execPath, [bin, 'init', '--runtime', runtime, '--no-interactive'], fixture, environment);
  await assertDoctrine(fixture, bin, `${runtime} re-init`);

  requirePath(join(fixture, '.void', 'machine', 'receipts', 'install-v1.json'), `${runtime} receipt`);
  requirePath(join(fixture, '.void', 'hooks', '_void-hook.mjs'), `${runtime} hook runner`);
  const syntaxWorker = join(fixture, '.void', 'hooks', '_syntax-worker.cjs');
  requirePath(syntaxWorker, `${runtime} syntax worker`);
  await proveInstalledSyntaxWorker({ worker: syntaxWorker,
    identity: expectedSyntaxWorkerIdentity(await readFile(SYNTAX_WORKER_IDENTITY_SOURCE, 'utf8')),
    execute: (input) => runConformanceProcess({ command: process.execPath,
      args: ['--max-old-space-size=128', syntaxWorker], cwd: fixture, env: {}, input,
      timeoutMs: SYNTAX_WORKER_BUDGET_MS }) });
  if (runtime !== 'codex') {
    requirePath(join(fixture, '.claude', 'skills', 'void-tdd', 'SKILL.md'), `${runtime} Claude skill`);
    requirePath(join(fixture, '.claude', 'agents', 'doctrine-critic.md'), `${runtime} Claude agent`);
  }
  if (runtime !== 'claude') {
    requirePath(join(fixture, '.agents', 'skills', 'void-tdd', 'SKILL.md'), `${runtime} Codex skill`);
    requirePath(join(fixture, '.codex', 'hooks.json'), `${runtime} Codex hooks`);
  }

  const skillRoot = runtime === 'codex' ? '.agents' : '.claude';
  const receiptPath = join(fixture, '.void', 'machine', 'receipts', 'install-v1.json');
  const adjacent = join(fixture, skillRoot, 'skills', 'private', 'SKILL.md');
  await mkdir(dirname(adjacent), { recursive: true });
  await writeFile(adjacent, '# private user skill\n');
  await run(
    `${runtime} update`,
    process.execPath,
    [bin, 'update'],
    fixture,
    environment,
  );
  await assertDoctrine(fixture, bin, `${runtime} update`);
  if ((await readFile(adjacent, 'utf8')) !== '# private user skill\n') {
    throw new Error(`${runtime} update changed an adjacent user file`);
  }
  // Normal update may complete ownership from the manifest. The recovery
  // baseline is that current receipt, not the earlier init receipt.
  const installed = JSON.parse(await readFile(receiptPath, 'utf8'));
  const doctrineBeforeRecovery = await readFile(join(fixture, '.void', 'PROJECT-DOCTRINE.md'));
  const adjacentBeforeRecovery = await readFile(adjacent);
  // A fresh clone has the versioned manifest, but no machine-local receipt.
  // Preserve the current fixture evidence rather than manufacturing ownership.
  await rename(receiptPath, join(fixture, 'original-install-receipt.json'));
  await run(
    `${runtime} update without machine receipt`,
    process.execPath,
    [bin, 'update'],
    fixture,
    environment,
  );
  await assertDoctrine(fixture, bin, `${runtime} receipt recovery`);
  if (!(await readFile(join(fixture, '.void', 'PROJECT-DOCTRINE.md'))).equals(doctrineBeforeRecovery)
    || !(await readFile(adjacent)).equals(adjacentBeforeRecovery)) {
    throw new Error(`${runtime} receipt recovery changed preserved user bytes`);
  }
  const recovered = JSON.parse(await readFile(receiptPath, 'utf8'));
  const identity = (receipt) => JSON.stringify({
    source: receipt.source,
    runtimes: [...receipt.runtimes].sort(),
    files: receipt.files.map((file) => file.path).sort(),
  });
  if (identity(recovered) !== identity(installed)) {
    throw new Error(`${runtime} update failed to recover installed ownership from the manifest`);
  }
  if ((await readFile(adjacent, 'utf8')) !== '# private user skill\n') {
    throw new Error(`${runtime} receipt recovery changed an adjacent user file`);
  }
  return performance.now() - started;
}

export async function exerciseInstalledRuntimes(install, exercise) {
  const bin = await install();
  const durations = [];
  for (const runtime of ['claude', 'codex', 'both']) {
    durations.push(await exercise(bin, runtime));
  }
  return durations;
}

async function main() {
  const { manifest, tarball } = await conformanceArtifactFromEnvironment();
  const temporary = await mkdtemp(join(tmpdir(), 'void-install-conformance-'));
  try {
    const durations = await exerciseInstalledRuntimes(
      () => installPackage(temporary, tarball),
      (bin, runtime) => exerciseRuntime(temporary, bin, runtime),
    );
    await execByPackageName(temporary, tarball);
    durations.sort((left, right) => left - right);
    const medianMs = Math.round(durations[Math.floor(durations.length / 2)] ?? 0);
    process.stdout.write(
      `install conformance passed (${process.platform}) for ${manifest.sourceSha}; runtime init/update p50 ${medianMs}ms (package install excluded)\n`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
