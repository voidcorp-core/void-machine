/**
 * The shipped hook bundle must not write into the operator's home directory.
 *
 * `registerProjectRoot` wrote one pointer per project root into
 * `~/.void/projects` on every hook invocation. Exercised against temporary roots
 * it accumulated 15 997 pointers by 2026-08-17 and **54 853** by 2026-09-04 on
 * this machine — measured, not estimated. The registry it fed was replaced by
 * marker discovery, which finds every installed project without any prior
 * registration, so the writes bought nothing at all.
 *
 * The sibling test in this directory proves the Vitest process is contained.
 * That is not the same claim: it protects THIS repository's runs, while the
 * defect ships to consumers inside the hook bundle. Version 3.6.0 is published
 * with `registerProjectRoot` still in it — verified by unpacking the tarball —
 * which is exactly the gap a containment check on our own process cannot see.
 *
 * So this holds the artifact, not the run. A hook may read the home directory;
 * writing durable state there is the operator's disk, and nothing in a hook has
 * earned it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLES = [
  'packages/core/dist/hooks/_void-hook.mjs',
  'packages/cli/dist/core-assets/hooks/_void-hook.mjs',
] as const;

/**
 * Deliberately excluded: `.void/hooks/_void-hook.mjs`. That bundle is a RELEASED
 * artifact, pinned to the version this repository installs, and it legitimately
 * differs from the working tree — holding it here would fail the build for a
 * defect that shipped before the fix existed.
 */
function bundle(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('the shipped hook bundle keeps no state in the home directory', () => {
  it.each(BUNDLES)('%s does not register a project root', (path) => {
    expect(bundle(path)).not.toMatch(/registerProjectRoot/);
  });

  // The name is not the mechanism. Renaming the function while keeping the write
  // would leave the assertion above green, so the write itself is named: a
  // pointer file under a `projects` directory of the Void global dir.
  it.each(BUNDLES)('%s writes no pointer into a projects registry', (path) => {
    const source = bundle(path);

    expect(source).not.toMatch(/HOOK_UNSAFE_REGISTRY/);
    expect(source).not.toMatch(/HOOK_REGISTRY_ESCAPE/);
    expect(source).not.toMatch(/HOOK_REGISTRY_COLLISION/);
    expect(source).not.toMatch(/\.path`\)/);
  });

  it('reads the bundles it claims to hold, so a missing file cannot pass', () => {
    for (const path of BUNDLES) expect(bundle(path).length).toBeGreaterThan(1000);
  });
});
