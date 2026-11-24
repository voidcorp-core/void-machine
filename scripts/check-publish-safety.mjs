#!/usr/bin/env node
// Release safety: verify the artifact pnpm actually publishes carries no
// `workspace:` specifier.
//
// Internal packages MUST use the workspace: protocol in source: they are not on
// npm, so pnpm has to link them locally (a plain ^range would resolve against
// the registry and fail). pnpm pack/publish rewrites `workspace:^` to a real
// range (^x.y.z) at pack time. This script packs each publishable package the
// same way `pnpm publish` would and fails if a `workspace:` specifier survives
// into the tarball — that would ship a broken package to npm consumers.
//
// It catches a regression in the conversion (a bad .npmrc, a pnpm version
// change), not a manual `npm publish` (which bypasses our tooling entirely;
// RELEASING.md mandates pnpm). Run by the `release` script and in CI.

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// Packages that publish to npm (mirror NPM_PACKAGES in bump-version.mjs).
const PACKAGES = [
  'packages/cli',
  'packages/packs/pack-monorepo',
  'packages/packs/pack-nextjs',
];

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const failures = [];

for (const rel of PACKAGES) {
  const dir = resolve(ROOT, rel);
  const out = mkdtempSync(join(tmpdir(), 'publish-check-'));
  try {
    execSync(`pnpm pack --pack-destination "${out}"`, { cwd: dir, stdio: 'ignore' });
    const tgz = readdirSync(out).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`no tarball produced for ${rel}`);
    execSync(`tar -xzf "${join(out, tgz)}" -C "${out}" package/package.json`, { stdio: 'ignore' });
    const pkg = JSON.parse(readFileSync(join(out, 'package', 'package.json'), 'utf8'));
    for (const field of DEP_FIELDS) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (String(range).startsWith('workspace:')) {
          failures.push(`${rel}: ${field}.${name} = "${range}"`);
        }
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error('check-publish-safety: a workspace: specifier survived into a packed tarball:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('pnpm rewrites workspace:^ at pack time; publish via pnpm, never npm publish.');
  process.exit(1);
}

console.log(`check-publish-safety: ${PACKAGES.length} packed tarball(s) clean (workspace:^ correctly rewritten).`);
