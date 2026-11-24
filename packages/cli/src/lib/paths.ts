// Locate a complete assembled delivery for installation and inspection.
// Prefer the npm bundle, then the sibling marketplace dist tree.

import { existsSync, readFileSync } from 'node:fs';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This CLI's own version, read from its package.json. Used to pin packs that a
 * project activates when no marketplace pin is available (e.g. a Codex install,
 * where skills are materialized from THIS CLI, not a versioned marketplace) — so
 * `.void/config.json` records the packs it actually staged instead of leaving
 * them unpinned/absent. Falls back to 0.0.0 rather than throwing in an install path.
 */
export function cliVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'package.json'), // dist/main.js -> package root (tarball + build)
    resolve(here, '..', '..', 'package.json'), // src/lib -> package root (dev via tsx)
  ];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === PRODUCT_IDENTITY.packageName && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

export async function findCoreSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));

  const candidates = [
    resolve(here, 'core-assets'), // bundled dist/main.js
    resolve(here, '../../dist/core-assets'), // src/lib
    resolve(here, '../../core/dist'), // bundled workspace
    resolve(here, '../../../core/dist'), // src/lib workspace
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'skills')) && existsSync(join(candidate, '.claude-plugin'))) {
      return candidate;
    }
  }

  throw new Error(
    `findCoreSource: could not locate core source tree. Searched:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}
