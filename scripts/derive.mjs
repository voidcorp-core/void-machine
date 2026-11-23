#!/usr/bin/env node
// Regenerate everything this repository derives from its own assets.
//
// Repository projections are generated from skills, agents, hooks, commands,
// packs and the verification catalogue. They include the graph catalogue and
// compatibility model, certification manifest, consumer bundle, cheat sheet,
// npm mirror and CI gate block. Each once had its own
// build command or hand-maintained copy, and nothing declared the complete set.
//
// The cost of that showed up the day thirteen skills were renamed: the gates
// fired one at a time, in series, each after a push, and a late artefact was
// found by CI rather than by the commit that caused it. Enumerating output paths
// does not fix this: the next projection would still be omitted.
//
// So the check here is not a list. It derives, then asserts the working tree is
// unchanged. Anything generated is covered the day it is added, without anyone
// remembering to say so.
//
// Usage: node scripts/derive.mjs [--check]

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * In dependency order, and the order is load-bearing: the catalogue feeds the
 * certification and the bundle, the model feeds the cheat sheet, and the mirror
 * copies whatever the four before it produced.
 */
const STEPS = [
  { label: 'CI gates', argv: ['node', 'scripts/render-ci-gates.mjs'] },
  { label: 'graph kernel', argv: ['pnpm', '--filter', '@voidcorp/harness-graph', 'build'] },
  { label: 'cli', argv: ['pnpm', 'build:cli'] },
  { label: 'catalogue', argv: ['node', 'packages/cli/bin/void-machine.mjs', 'graph'] },
  { label: 'certification', argv: ['pnpm', '-F', './packages/cli', 'build:certification'] },
  { label: 'consumer bundle', argv: ['pnpm', '-F', './packages/cli', 'build:void-graph'] },
  { label: 'cheat sheet', argv: ['node', 'scripts/build-cheatsheet.mjs'] },
  { label: 'npm mirror', argv: ['pnpm', '--filter', './packages/cli', 'build:assets'] },
];

/**
 * The one artefact whose bytes are not compared. `void-graph.mjs` is a vite and
 * esbuild bundle, and its byte-determinism across environments is not
 * guaranteed, so comparing it here would fail on a CI runner whose toolchain
 * differs by a patch release. It is not left unguarded: `graph:check-bundle`
 * asserts that the model it bakes matches the committed one, which is the fact
 * that actually matters and does not depend on the bundler.
 *
 * This is an exception, not a list of what to check. Everything else is covered
 * by being generated, with nothing to add when another artefact appears.
 */
const NOT_BYTE_COMPARED = new Set(['packages/core/graph/void-graph.mjs']);

/** Paths git reports as changed, staged or not, as a set for cheap comparison. */
export function dirtyPaths(porcelain) {
  return new Set(
    porcelain
      .split('\n')
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim())
      .filter((path) => path.length > 0),
  );
}

/** What derivation produced: dirty now, and not dirty before it ran. */
export function producedBy(before, after, excluded = NOT_BYTE_COMPARED) {
  return [...after].filter((path) => !before.has(path) && !excluded.has(path)).sort();
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.stdout ?? '';
}

function run(step) {
  const [command, ...args] = step.argv;
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(`derive: ${step.label} failed\n`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const check = process.argv.includes('--check');
  const before = dirtyPaths(git(['status', '--porcelain']));
  for (const step of STEPS) run(step);
  const produced = producedBy(before, dirtyPaths(git(['status', '--porcelain'])));

  if (!check) {
    process.stdout.write(
      produced.length === 0
        ? 'derive: everything already current.\n'
        : `derive: regenerated ${String(produced.length)} artefact(s).\n${produced.map((p) => `  ${p}\n`).join('')}`,
    );
    return;
  }
  if (produced.length === 0) {
    process.stdout.write('derive:check — every generated artefact matches its sources.\n');
    return;
  }
  process.stderr.write(
    `derive:check — ${String(produced.length)} generated artefact(s) are stale:\n`
    + produced.map((path) => `  ${path}\n`).join('')
    + '\nRun `pnpm derive` and commit the result.\n',
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
