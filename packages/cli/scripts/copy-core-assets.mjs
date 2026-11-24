#!/usr/bin/env node
// Copy the void-machine core (skills/agents/hooks) into the CLI package
// at publish time so the published npm tarball is self-sufficient.
//
// Source: ../core/claude/  (monorepo sibling)
// Target: ./core-assets/claude/
//
// Runs during `prepack` so npm pack / npm publish bundles the assets.
//
// An optional first argument names another target directory. The copy empties
// its target before refilling it, so a test must copy into a directory of its
// own: the CLI reads ./core-assets first, and a concurrent test would read it
// half-built.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '..', 'core');
const TARGET = resolve(process.argv[2] ?? resolve(HERE, '..', 'core-assets'));

try {
  await stat(SOURCE);
} catch {
  console.error(`copy-core-assets: source not found at ${SOURCE}`);
  process.exit(1);
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(dirname(TARGET), { recursive: true });
// Mirror runtime assets only. Excluded:
//  - test files (*.test.ts): dev-time, must not ship in the consumer tarball.
// What `packages/core/` is allowed to put in the published tarball, and why.
//
// The copy below is recursive, so without this list anything dropped into
// packages/core/ ships to every consumer from that moment on, read or not, and
// nothing ever asks whether it should. That is how `workflows/` survived: two
// dead YAML descriptors whose only remaining reference was a test asserting the
// skill must NOT route through one of them.
//
// The list says what ships, not what is read -- a declared entry everybody
// forgot still ships. It narrows the class rather than closing it, which is
// worth stating rather than pretending. See the shipped-core-surface-is-declared
// decision.
const SHIPPED = new Map([
  ['PHILOSOPHY.md', 'the universal doctrine, read from the package'],
  ['PROJECT-DOCTRINE.template.md', 'seeds .void/PROJECT-DOCTRINE.md once at init'],
  ['adapters', 'security scanner manifests'],
  ['agents', 'the specialist agent definitions each runtime stages'],
  ['codex', 'the Codex safety floor (hooks.json)'],
  ['contract-history', 'immutable released contracts required by declared open-mission migrations'],
  ['data', 'the product identity consumed by the runtime'],
  ['enforce', 'the enforcement floor configuration'],
  ['hooks', 'the runtime hook bundle a consumer executes'],
  ['modules', 'extension point `install --global` copies when present'],
  ['policies', 'the routing policies the mission engine merges'],
  ['profiles', 'stack profiles compiled into a project'],
  ['skills', 'the skills themselves'],
  ['specialists', 'native specialist contracts per runtime'],
  ['templates', 'the GitHub workflow a project can adopt'],
]);

const present = await readdir(SOURCE);
const undeclared = present.filter((entry) => !SHIPPED.has(entry) && !entry.startsWith('.'));
if (undeclared.length > 0) {
  console.error(
    `copy-core-assets: ${undeclared.join(', ')} would ship to every consumer, undeclared.\n`
    + '  Add it to SHIPPED with the reason it ships, or delete it. A published\n'
    + '  tarball is not the place to find out something was never read.',
  );
  process.exit(1);
}

await cp(SOURCE, TARGET, {
  recursive: true,
  filter: (src) => !src.endsWith('.test.ts'),
});
console.log(`copy-core-assets: copied ${SOURCE} -> ${TARGET}`);

// Bundle each pack's skills so a --pack install can materialize them for Codex
// (packs are not a separate npm package; without this a pack install on Codex
// would stage nothing — the fake-success the audit caught). Only skills ship;
// pack runtime code reaches Claude via the marketplace, not this tarball.
const PACKS_SRC = resolve(HERE, '..', '..', 'packs');
const PACKS_DST = join(TARGET, 'packs');
try {
  const entries = await readdir(PACKS_SRC, { withFileTypes: true });
  let bundled = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillsSrc = join(PACKS_SRC, entry.name, 'skills');
    try {
      await stat(skillsSrc);
    } catch {
      continue; // pack has no skills
    }
    const skillsDst = join(PACKS_DST, entry.name, 'skills');
    await mkdir(dirname(skillsDst), { recursive: true });
    await cp(skillsSrc, skillsDst, { recursive: true, filter: (src) => !src.endsWith('.test.ts') });
    bundled += 1;
  }
  console.log(`copy-core-assets: bundled ${bundled} pack(s) skills -> ${PACKS_DST}`);
} catch {
  console.log('copy-core-assets: no packs dir to bundle');
}
