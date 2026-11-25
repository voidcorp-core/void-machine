// Every `.js` this repo installs into a consumer project lands in their lint.
//
// The autopilot workflow script is valid for the Workflow engine and invalid
// for a standard JavaScript parser: it carries `export const meta` (so a parser
// reads it as an ES module) alongside a top-level `return` (which no ES module
// may contain). The engine's contract comes from Claude Code, not from here, so
// the file cannot simply be rewritten — but its cost must not land silently on
// every consumer's `lint` script.
//
// This test does two things: it pins the exact set of files that carry the
// contradiction, and it fails when a new one appears. Adding one is then a
// decision somebody makes on purpose, with the consumer-side exclusion in mind,
// rather than a defect discovered three files into someone else's afternoon.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core', 'dist');

/**
 * Scripts that are valid for their engine and invalid as ES modules.
 *
 * Keep this list as short as the engine allows. Every entry is a file that
 * would break `biome lint` / `eslint` in a consumer project if `.claude/` were
 * not excluded for them at install time.
 */
// Empty since the cluster engine's Workflow script left with the engine. An
// entry added here must be a real file, which the last test below enforces.
const ENGINE_SCRIPTS: readonly string[] = [];

function distributedScripts(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'graph') distributedScripts(path, found);
      continue;
    }
    if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) found.push(path);
  }
  return found;
}

/** Does a standard ES-module parser accept this file? */
function parsesAsModule(path: string): boolean {
  const staging = join(mkdtempSync(join(tmpdir(), 'void-script-')), 'candidate.mjs');
  copyFileSync(path, staging);
  try {
    execFileSync(process.execPath, ['--check', staging], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe('scripts this repo installs into a consumer project', () => {
  const scripts = distributedScripts(CORE).filter((path) => statSync(path).isFile());

  it('finds the scripts it is meant to be checking', () => {
    // A traversal that silently matched nothing would make every assertion
    // below vacuously true.
    expect(scripts.length).toBeGreaterThan(0);
  });

  it('parses as an ES module, unless it is a known engine script', () => {
    const broken = scripts
      .filter((path) => !parsesAsModule(path))
      .map((path) => relative(CORE, path).split(sep).join('/'));

    expect(broken.sort()).toEqual([...ENGINE_SCRIPTS].sort());
  });

  it('keeps every declared engine script real, so the list cannot rot', () => {
    for (const entry of ENGINE_SCRIPTS) {
      expect(() => statSync(join(CORE, entry)), entry).not.toThrow();
    }
  });
});
