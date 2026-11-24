#!/usr/bin/env node

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
  runConformanceStep,
  runConformanceProcess,
} from './conformance-process.mjs';

async function run(label, command, args, cwd, env) {
  return runConformanceStep(`install conformance ${label}`, { command, args, cwd, env });
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
  return join(fixture, 'node_modules', PRODUCT_IDENTITY.packageName, 'dist', 'bin', `${PRODUCT_IDENTITY.commands.primary}.mjs`);
}

// `npx <package>` resolves the command from the package manifest, not from a
// path: with several bin files, npm runs only the one named after the package.
// Every other step here calls the installed bin directly and cannot see that.
// Keep the file spec for manifest inference, but reuse the installed tree/cache.
export async function execByPackageName(temporary, tarball) {
  const fixture = join(temporary, 'package');
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

export async function proveInstalledCiAdmission(fixture, skillRoot, environment) {
  const skill = join(fixture, skillRoot, 'skills', 'void-verify');
  const guide = await readFile(join(skill, 'SKILL.md'), 'utf8');
  if (!guide.includes('references/ci-feedback.md')) throw new Error('CI skill adoption guide missing');
  const references = join(skill, 'references');
  for (const name of ['ci-feedback.md', 'quality.yml', 'ci-admission.mjs']) {
    requirePath(join(references, name), `installed CI reference ${name}`);
  }
  const eventPath = join(fixture, 'ci-admission-event.json');
  for (const draft of [true, false]) {
    await writeFile(eventPath, JSON.stringify({ pull_request: { draft }, action: 'ready_for_review' }));
    const result = await runConformanceProcess({ command: process.execPath,
      args: [join(references, 'ci-admission.mjs')], cwd: fixture,
      env: { ...environment, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath },
      timeoutMs: 5_000 });
    if (result.outcome.kind !== 'exited' || result.outcome.code !== (draft ? 1 : 0)
      || !(draft ? result.stderr.includes('CI_DEFERRED_DRAFT') : result.stdout.includes('CI_ADMITTED'))) {
      throw new Error(`installed CI admission failed for draft=${draft}: ${result.stderr}`);
    }
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
  if (runtime !== 'codex') {
    requirePath(join(fixture, '.claude', 'skills', 'void-tdd', 'SKILL.md'), `${runtime} Claude skill`);
    requirePath(join(fixture, '.claude', 'agents', 'doctrine-critic.md'), `${runtime} Claude agent`);
  }
  if (runtime !== 'claude') {
    requirePath(join(fixture, '.agents', 'skills', 'void-tdd', 'SKILL.md'), `${runtime} Codex skill`);
    requirePath(join(fixture, '.codex', 'hooks.json'), `${runtime} Codex hooks`);
  }

  const skillRoot = runtime === 'codex' ? '.agents' : '.claude';
  await proveInstalledCiAdmission(fixture, skillRoot, environment);
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
