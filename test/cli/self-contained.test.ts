/**
 * The published CLI must run from its tarball alone.
 *
 * `npx` of the npm package is the primary install channel, and the offline install
 * conformance in CI proves the tarball extracts and runs with no registry. That
 * gate is slow and platform-matrixed; this one is instant and says why.
 *
 * The failure it catches is easy to cause and easy to miss: adding a runtime
 * dependency instead of bundling it. Everything the CLI needs is inlined by
 * tsup's `noExternal`, so its `dependencies` map stays empty by construction.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/cli/package.json'), 'utf8'));
const tsup = readFileSync(resolve(ROOT, 'packages/cli/tsup.config.ts'), 'utf8');

describe('the published CLI is self-contained', () => {
  it('declares no runtime dependency', () => {
    // A dependency here means `npm install --offline <tarball>` needs the
    // registry, which is exactly what the offline conformance forbids.
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });

  it('bundles every third-party package it imports', () => {
    const bundled = /noExternal:\s*\[([\s\S]*?)\]/.exec(tsup)?.[1] ?? '';
    const declared = [...bundled.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    // Each of these is imported at runtime and must be inlined, not resolved.
    for (const pkg of ['@voidcorp/hook-runner', '@voidcorp/mission-engine', '@voidcorp/void-machine', 'picomatch', 'yaml', 'zod']) {
      expect(declared).toContain(pkg);
    }
  });

  it('keeps every bundled package a devDependency, so it never reaches the tarball', () => {
    const bundled = /noExternal:\s*\[([\s\S]*?)\]/.exec(tsup)?.[1] ?? '';
    const declared = [...bundled.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const dev = Object.keys(manifest.devDependencies ?? {});

    for (const pkg of declared) {
      expect(dev, `${pkg} is bundled but not a devDependency`).toContain(pkg);
    }
  });
});
