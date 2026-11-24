/**
 * A build must not read anything that belongs to the machine running it.
 *
 * Learned twice on 2026-08-19. `prepare-data.ts` read `.void/runs` -- the mission
 * journals of whoever ran the build -- and inlined the result into the studio,
 * itself inlined into `void-graph.mjs`, which is committed and published to npm.
 * The package therefore carried that person's real activity, and differed on
 * every build since a journal grows with every session. Hours later, a test run
 * with the locally built CLI wrote a bundle compiled from the working tree into
 * `.void/hooks/`, where only the published one belongs.
 *
 * `derive:check` could not see the first: `scripts/derive.mjs` deliberately
 * excludes `void-graph.mjs` from byte comparison, because a vite/esbuild bundle
 * is not guaranteed identical across toolchain versions. The exception is sound;
 * the hole was that nothing else looked.
 *
 * Checking the OUTPUT would mean building twice on every CI run, for ever.
 * Checking the INPUTS costs nothing and names the cause: a builder reads
 * versioned files, and nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What a build must never reach for, and why each one is machine-local. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /['"`]\.void\//, why: 'reads .void/, which holds what this machine observed' },
  { pattern: /\bhomedir\s*\(/, why: 'reads the home directory of whoever builds' },
  { pattern: /\bDate\.now\s*\(/, why: 'stamps the instant of compilation' },
  { pattern: /\bnew Date\s*\(\s*\)/, why: 'stamps the instant of compilation' },
  { pattern: /process\.env\[?['"`]?(HOME|USER|USERPROFILE)/, why: 'reads the identity of whoever builds' },
];

/** Scripts that FABRICATE an artefact, by the naming convention this repo uses. */
function builderScripts(): string[] {
  return [
    ...globSync('scripts/{build,prepare}-*.{ts,mjs}', { cwd: ROOT }),
    ...globSync('packages/*/scripts/{build,prepare}-*.{ts,mjs}', { cwd: ROOT }),
    ...globSync('apps/*/scripts/{build,prepare}-*.{ts,mjs}', { cwd: ROOT }),
  ].filter((path) => !path.includes('.test.'));
}

/** Forbidden reads in a source, as readable reasons. Pure. */
function machineLocalReads(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split('\n')) {
    // A comment explaining the rule is not a violation of it.
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(code)) found.push(why);
    }
  }
  return [...new Set(found)];
}

describe('machineLocalReads', () => {
  it('catches the exact line that shipped a developer telemetry into npm', () => {
    expect(machineLocalReads("const runs = resolve(root, '.void/runs');")).toEqual([
      'reads .void/, which holds what this machine observed',
    ]);
  });

  it('catches a home directory and a compilation timestamp', () => {
    expect(machineLocalReads('join(homedir(), ".cache")').length).toBe(1);
    expect(machineLocalReads('const builtAt = new Date();').length).toBe(1);
  });

  it('leaves a comment about the rule alone, or the rule could never be explained', () => {
    expect(machineLocalReads('// this used to read .void/runs, which was the defect')).toEqual([]);
    expect(machineLocalReads(' * reads `.void/runs` and inlines it')).toEqual([]);
  });

  it('leaves a versioned path alone, which is what a build is supposed to read', () => {
    expect(machineLocalReads("readFileSync(resolve(here, '../fixtures/demo-journal.jsonl'))")).toEqual([]);
  });
});

describe('every builder script', () => {
  it('is a real set, so an empty glob cannot pass this suite silently', () => {
    expect(builderScripts().length).toBeGreaterThan(0);
  });

  it('reads only versioned files', () => {
    const offenders = builderScripts()
      .map((path) => ({ path, reasons: machineLocalReads(readFileSync(join(ROOT, path), 'utf8')) }))
      .filter((entry) => entry.reasons.length > 0)
      .map((entry) => `${relative('', entry.path)}: ${entry.reasons.join('; ')}`);

    expect(offenders).toEqual([]);
  });
});
