/**
 * Invariant: packages/cli/dist/core-assets is a faithful mirror of packages/core.
 *
 * The CLI ships packages/core as a committed mirror (packages/cli/dist/core-assets)
 * built by copy-core-assets.mjs. Version lockstep covers the manifests but NOT
 * the file contents, so editing a core hook/skill without rerunning
 * build:assets drifts the two copies silently (audit 2026-07-09, issue #66).
 *
 * This runs inside `pnpm test` (hence in CI) and fails on:
 *   - a modified core file not resynced,
 *   - a NEW core file not mirrored (the gap `git diff --quiet` misses — an
 *     untracked mirror file is invisible to it),
 *   - a deleted core file left orphaned in the mirror.
 * Test files are excluded; the pack mirror is checked against its own source.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const CORE = resolve(process.cwd(), 'packages/core/dist');
const MIRROR = resolve(process.cwd(), 'packages/cli/dist/core-assets');
const PACKS_SRC = resolve(process.cwd(), 'packages/packs');
const MIRROR_PACKS = join(MIRROR, 'packs'); // bundled from packages/packs/*/skills, not core

/** Same test-file exclusion as copy-core-assets; packs have their own source. */
function excluded(absPath: string): boolean {
  if (absPath.endsWith('.test.ts')) return true;
  if (absPath === MIRROR_PACKS || absPath.startsWith(`${MIRROR_PACKS}/`)) return true;
  return false;
}

/** Relative paths (from `root`) of every file under `root` not matched by `isExcluded`. */
function walk(root: string, isExcluded: (p: string) => boolean, dir: string = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcluded(abs)) continue; // skip an excluded subtree wholesale
      walk(root, isExcluded, abs, out);
    } else if (entry.isFile() && !isExcluded(abs)) {
      out.push(relative(root, abs));
    }
  }
  return out;
}

/** Pack-mirror exclusion: only test files (the packs dir is the subject here, not excluded). */
const notTest = (p: string): boolean => p.endsWith('.test.ts');

describe('core-assets mirror', () => {
  it('mirrors every runtime file from packages/core with identical content', () => {
    const drifted: string[] = [];
    for (const rel of walk(CORE, excluded)) {
      const mirror = join(MIRROR, rel);
      try {
        if (readFileSync(join(CORE, rel)).equals(readFileSync(mirror))) continue;
        drifted.push(`content differs: ${rel}`);
      } catch {
        drifted.push(`missing in mirror: ${rel}`);
      }
    }
    expect(drifted, `run: pnpm --filter ./packages/cli build:assets`).toEqual([]);
  });

  it('contains no orphan file absent from packages/core', () => {
    const orphans: string[] = [];
    for (const rel of walk(MIRROR, excluded)) {
      try {
        statSync(join(CORE, rel));
      } catch {
        orphans.push(rel);
      }
    }
    expect(orphans, `stale mirror files; run: pnpm --filter ./packages/cli build:assets`).toEqual([]);
  });

  it('mirrors every pack skill file from packages/packs with identical content', () => {
    // core-assets/packs/<pack>/skills/... is bundled from packages/packs/<pack>/skills/... so Codex
    // installs can materialize pack skills. Same content-drift guard as the core mirror.
    const drifted: string[] = [];
    for (const rel of walk(MIRROR_PACKS, notTest)) {
      // rel is `<pack>/skills/...`; the source lives under packages/packs/<pack>/skills/...
      const src = join(PACKS_SRC, rel.split('/')[0]!, 'src', ...rel.split('/').slice(1));
      try {
        if (readFileSync(join(MIRROR_PACKS, rel)).equals(readFileSync(src))) continue;
        drifted.push(`content differs: ${rel}`);
      } catch {
        drifted.push(`missing in source: ${rel}`);
      }
    }
    expect(drifted, `run: pnpm --filter ./packages/cli build:assets`).toEqual([]);
  });
});

// A stale already-dirty artifact must fail before any repair takes place.
it('checks assembly freshness without mutating the stale delivery', () => {
  const destination = mkdtempSync(join(tmpdir(), 'void delivery '));
  const copier = resolve('packages/cli/scripts/copy-core-assets.mjs');
  try {
    const built = spawnSync(process.execPath, [copier, destination], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    const doctrine = join(destination, 'PHILOSOPHY.md');
    writeFileSync(doctrine, 'stale artifact\n');
    const checked = spawnSync(process.execPath, [copier, destination, '--check'], { encoding: 'utf8' });
    expect(checked.status).toBe(1);
    expect(readFileSync(doctrine, 'utf8')).toBe('stale artifact\n');
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});
