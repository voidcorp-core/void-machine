import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { wireSelfHostRuntimeSurfaces } from './wire.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'core');

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Self-host compiles into an artifact that is not where the harness will live,
// so this module is the one place where the two roots are guaranteed to differ.
// The bytes go to the artifact, and the Codex manifest must name neither root:
// its commands find the runner from the session directory (DEV-918). A root
// leaking into it would point every hook at a staging directory deleted minutes
// later, or at one machine's checkout, and nothing downstream would notice until
// a hook failed to launch.
describe('wireSelfHostRuntimeSurfaces', () => {
  it('writes into the artifact a Codex manifest that names neither root', async () => {
    const artifactRoot = scratch('void-selfhost-artifact-');
    const finalRoot = scratch('void-selfhost-final-');

    await wireSelfHostRuntimeSurfaces({
      artifactRoot,
      overlayRoot: CORE_ROOT,
      finalRoot,
      sourceHash: 'deadbeef',
      mode: 'shadow',
    });

    const manifest = readFileSync(join(artifactRoot, '.codex', 'hooks.json'), 'utf8');
    expect(manifest).not.toContain(artifactRoot);
    expect(manifest).not.toContain(finalRoot);
  });
});
