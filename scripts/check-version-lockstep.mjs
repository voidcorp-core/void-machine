#!/usr/bin/env node
// Lockstep version guard. Pre-1.0, ONE version governs everything (see
// docs/RELEASING.md). This fails CI if ANY version-carrying file diverges from
// the canonical version (marketplace.json plugins[0].version) — catching a miss
// by the release automation, the manual bumper, or a hand-edit, before it ships
// a skewed install. The mirror (core-assets) is included on purpose.
//
// Usage: node scripts/check-version-lockstep.mjs   (exit 0 aligned, 1 drift)
// Exported: findDrift(canonical, entries) — pure, unit-tested.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} canonical @param {{file:string,version:string}[]} entries */
export function findDrift(canonical, entries) {
  return entries.filter((e) => e.version !== canonical).map((e) => `${e.file} (${e.version} != ${canonical})`);
}

const PLUGIN_MANIFESTS = [
  'packages/core/dist/.claude-plugin/plugin.json',
  'packages/core/src/.claude-plugin/plugin.json',
  ...['monorepo', 'react', 'nextjs', 'server', 'pwa', 'mobile'].map((name) => `packages/packs/pack-${name}/dist/.claude-plugin/plugin.json`),
  'packages/packs/pack-monorepo/src/.claude-plugin/plugin.json',
  'packages/packs/pack-react/src/.claude-plugin/plugin.json',
  'packages/packs/pack-nextjs/src/.claude-plugin/plugin.json',
  'packages/packs/pack-server/src/.claude-plugin/plugin.json',
  'packages/packs/pack-pwa/src/.claude-plugin/plugin.json',
  'packages/packs/pack-mobile/src/.claude-plugin/plugin.json',
  'packages/cli/dist/core-assets/.claude-plugin/plugin.json', // generated mirror — must match
];
const NPM_PACKAGES = [
  'packages/cli/package.json',
  'packages/packs/pack-monorepo/package.json',
  'packages/packs/pack-nextjs/package.json',
];

async function readVersionField(root, rel) {
  const path = resolve(root, rel);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')).version;
}

export async function collect(root) {
  // The catalog is self-hosted in this repo; the core plugin manifest is the
  // canonical version.
  const canonical = await readVersionField(root, PLUGIN_MANIFESTS[0]);
  const entries = [];
  for (const rel of [...PLUGIN_MANIFESTS, ...NPM_PACKAGES]) {
    const v = await readVersionField(root, rel);
    if (v !== undefined) entries.push({ file: rel, version: v });
  }
  return { canonical, entries };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { canonical, entries } = await collect(root);
  if (!canonical) {
    console.error('check-version-lockstep: packages/core plugin.json version missing');
    process.exit(1);
  }
  const drift = findDrift(canonical, entries);
  if (drift.length > 0) {
    console.error(`check-version-lockstep: ${drift.length} file(s) off the canonical ${canonical}:`);
    for (const d of drift) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`check-version-lockstep: ${entries.length} files all at ${canonical}.`);
}

// Run only as CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`check-version-lockstep: ${err.message}`);
    process.exit(1);
  });
}
