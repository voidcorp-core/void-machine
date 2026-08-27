#!/usr/bin/env node
// One command that runs locally what CI's `validate` job runs remotely.
//
// The gates all existed; what did not was a single entry point. A contributor
// had to KNOW that adding a skill moves three generated artefacts — the graph,
// the consumer bundle, and certification.json — plus the core-assets mirror,
// and had to know the order to regenerate them in. The alternative to knowing
// was learning it from CI, one round trip at a time.
//
// So each step names the command that fixes it, and `--fix` runs those commands
// for the derived artefacts instead of only reporting them. `--fix` is never
// implicit: regenerating a committed artefact is a change, and a change happens
// because someone asked for it.
//
// Usage:
//   node scripts/verify.mjs              full parity with CI's validate job
//   node scripts/verify.mjs --artifacts  only the generated-artefact gates
//   node scripts/verify.mjs --fix        regenerate derived artefacts, then verify
//   node scripts/verify.mjs --list       print the steps without running them
//
// Exported: STEPS, selectSteps, parseArgs — pure, unit-tested.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The validate job, in its order. `artifact: true` marks a gate over a
 * committed generated file — the class `--artifacts` runs and `--fix` repairs.
 *
 * @type {{name: string, run: string[], artifact?: boolean, fix?: string[], slow?: boolean}[]}
 */
export const STEPS = [
  { name: 'sister-doc parity', run: ['pnpm', 'sync:docs'] },
  { name: 'version lockstep', run: ['pnpm', 'version:check'] },
  { name: 'anti-bloat', run: ['pnpm', 'anti-bloat:check'] },
  { name: 'decision records', run: ['pnpm', 'decisions:check'] },
  {
    name: 'hook runner current',
    run: ['pnpm', 'hooks:build'],
    artifact: true,
    fix: ['pnpm', 'hooks:build'],
    drift: ['packages/core/hooks/_void-hook.mjs'],
  },
  {
    name: 'core-assets in sync',
    run: ['pnpm', '--filter', 'voidharness', 'build:assets'],
    artifact: true,
    fix: ['pnpm', '--filter', 'voidharness', 'build:assets'],
    drift: ['packages/cli/core-assets'],
  },
  { name: 'lint', run: ['pnpm', 'lint'] },
  { name: 'publish safety', run: ['pnpm', 'check:publish'] },
  { name: 'build', run: ['pnpm', 'build'], slow: true },
  { name: 'project graph benchmark', run: ['pnpm', 'benchmark:project'], slow: true },
  { name: 'context continuity benchmark', run: ['pnpm', 'benchmark:hooks'], slow: true },
  {
    name: 'self-host release gate',
    run: ['node', 'packages/cli/bin/void-harness.mjs', 'self-host', 'sync', '--mode', 'release-gate'],
    slow: true,
  },
  {
    name: 'self-host doctor',
    run: ['node', 'packages/cli/bin/void-harness.mjs', 'self-host', 'doctor', '--mode', 'release-gate'],
    slow: true,
  },
  {
    name: 'graph integrity',
    run: ['pnpm', 'graph:check'],
    artifact: true,
    fix: ['node', 'packages/cli/bin/void-harness.mjs', 'graph', 'build'],
  },
  {
    // One gate for every generated artefact. They used to have one each, and
    // nothing declared the set, so a seventh and then an eighth kept falling off
    // whichever list was updated last. This derives and asserts the tree did not
    // move, which covers what gets added later without naming anything.
    name: 'generated artefacts current',
    run: ['pnpm', 'derive:check'],
    artifact: true,
    fix: ['pnpm', 'derive'],
  },
  {
    // The one artefact `derive:check` does not byte-compare, because the bundler
    // output is not guaranteed identical across environments. Gated on the model
    // it bakes instead, which does not depend on the bundler.
    name: 'consumer bundle freshness',
    run: ['pnpm', 'graph:check-bundle'],
    artifact: true,
    fix: ['pnpm', '--filter', 'voidharness', 'build:void-graph'],
  },
  { name: 'tests', run: ['pnpm', 'vitest', 'run'], slow: true },
  { name: 'typecheck', run: ['pnpm', '-r', 'typecheck'], slow: true },
];

/** @param {readonly string[]} argv */
export function parseArgs(argv) {
  const known = new Set(['--artifacts', '--fix', '--list', '--help', '-h']);
  const unknown = argv.filter((arg) => arg.startsWith('-') && !known.has(arg));
  return {
    artifactsOnly: argv.includes('--artifacts'),
    fix: argv.includes('--fix'),
    list: argv.includes('--list'),
    help: argv.includes('--help') || argv.includes('-h'),
    unknown,
  };
}

/**
 * Steps to run for these options.
 *
 * `--fix` implies the artefact subset: regenerating is only defined for derived
 * files, and quietly running the whole suite after a fix would bury the result.
 *
 * @param {{artifactsOnly: boolean, fix: boolean}} options
 */
export function selectSteps(options) {
  if (options.artifactsOnly || options.fix) return STEPS.filter((step) => step.artifact === true);
  return STEPS;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, { quiet = false } = {}) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Snapshot of the working-tree state of some paths.
 *
 * Compared BEFORE and AFTER a regeneration step rather than against HEAD.
 * Against HEAD is right in CI, where the tree starts clean, and wrong locally,
 * where the contributor already has uncommitted work — including the artefacts
 * `--fix` just regenerated. What the gate actually asks is "did regenerating
 * change anything", and that is a before/after question.
 */
function snapshot(paths) {
  if (paths === undefined) return null;
  return run(['git', 'status', '--porcelain', '--', ...paths], { quiet: true }).output;
}

function newlyDrifted(before, after) {
  if (before === null || after === null || before === after) return [];
  const previous = new Set(before.split('\n').filter((line) => line.trim() !== ''));
  return after.split('\n').filter((line) => line.trim() !== '' && !previous.has(line));
}

function usage() {
  return [
    'void-harness verify — run locally what CI runs on your pull request.',
    '',
    'Usage:',
    '  pnpm verify              every gate of the validate job, in its order',
    '  pnpm verify --artifacts  only the generated-artefact gates (fast)',
    '  pnpm verify --fix        regenerate derived artefacts, then verify them',
    '  pnpm verify --list       print the steps without running them',
    '',
    'Generated artefacts a change can move: the hook runner, the core-assets',
    'mirror, the graph, certification.json and the consumer bundle. `--fix`',
    'regenerates those; it never touches anything else.',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.unknown.length > 0) {
    process.stderr.write(`verify: unknown option ${options.unknown.join(', ')}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const steps = selectSteps(options);
  if (options.list) {
    for (const step of steps) process.stdout.write(`${step.name}: ${step.run.join(' ')}\n`);
    return;
  }

  if (options.fix) {
    process.stdout.write('verify --fix: regenerating derived artefacts\n');
    for (const step of steps) {
      if (step.fix === undefined) continue;
      process.stdout.write(`  ${step.name}: ${step.fix.join(' ')}\n`);
      const result = run(step.fix);
      if (!result.ok) {
        process.stderr.write(`verify: could not regenerate ${step.name}.\n`);
        process.exitCode = 1;
        return;
      }
    }
    process.stdout.write('\n');
  }

  const failures = [];
  for (const step of steps) {
    process.stdout.write(`\n── ${step.name} ${'─'.repeat(Math.max(0, 60 - step.name.length))}\n`);
    const before = snapshot(step.drift);
    const result = run(step.run);

    // A regeneration step passes only if it changed nothing: its exit code says
    // the generator worked, the before/after says the committed artefact matched.
    const dirty = result.ok ? newlyDrifted(before, snapshot(step.drift)) : [];
    if (result.ok && dirty.length === 0) continue;

    failures.push({
      step,
      reason: dirty.length > 0 ? `left ${dirty.length} path(s) modified` : 'exited non-zero',
      dirty,
    });
  }

  if (failures.length === 0) {
    process.stdout.write(`\nverify: ${steps.length} gate(s) passed.\n`);
    return;
  }

  process.stderr.write(`\nverify: ${failures.length} gate(s) failed.\n`);
  for (const failure of failures) {
    process.stderr.write(`\n  ${failure.step.name} — ${failure.reason}\n`);
    for (const path of failure.dirty) process.stderr.write(`    ${path}\n`);
    if (failure.step.fix !== undefined) {
      process.stderr.write(`    fix: ${failure.step.fix.join(' ')}   (or run: pnpm verify --fix)\n`);
    }
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
