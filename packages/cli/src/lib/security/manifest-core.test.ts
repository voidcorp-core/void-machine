// The manifest that actually ships, checked against the schema that guards it.
//
// The unit tests prove the schema refuses a bad entry. This one proves the file
// we distribute is a good one — and that it stays vendor-free, which is a
// promise the core makes and a schema cannot express.

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSecurityManifest, SECURITY_MANIFEST_PATH } from './manifest.js';

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'core', 'dist');

describe('the manifest shipped in packages/core', () => {
  it('parses against the schema that guards it', async () => {
    const manifest = await loadSecurityManifest(CORE_ROOT);

    expect(manifest?.adapters.length).toBeGreaterThan(0);
  });

  it('keeps every scanner optional, so no project inherits a vendor', async () => {
    const manifest = await loadSecurityManifest(CORE_ROOT);

    // The schema cannot express this: it is a promise about what the core is,
    // checked here because breaking it is easy and silent.
    for (const adapter of manifest?.adapters ?? []) {
      expect(adapter.command, adapter.id).not.toMatch(/npx|pnpm|npm|yarn|docker|curl|wget/);
    }
  });

  it('never writes a scan target into the file', async () => {
    // A target reaches a scanner from an authorization checked at run time. A
    // URL sitting in the manifest would be a target nobody authorized.
    const manifest = await loadSecurityManifest(CORE_ROOT);

    for (const adapter of manifest?.adapters ?? []) {
      for (const argument of [...adapter.args, ...adapter.versionArgs]) {
        expect(argument, `${adapter.id}: ${argument}`).not.toMatch(/^https?:|^\/\//);
      }
    }
  });

  it('bounds every adapter it ships', async () => {
    const manifest = await loadSecurityManifest(CORE_ROOT);

    for (const adapter of manifest?.adapters ?? []) {
      expect(adapter.limits.timeoutSeconds, adapter.id).toBeGreaterThan(0);
      expect(adapter.limits.maxOutputBytes, adapter.id).toBeGreaterThan(0);
    }
  });
});

describe('loadSecurityManifest', () => {
  it('treats an absent manifest as no scanners rather than as a failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-no-manifest-'));

    await expect(loadSecurityManifest(root)).resolves.toBeUndefined();
  });

  it('refuses a symlinked manifest, which could point anywhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-manifest-link-'));
    const outside = join(mkdtempSync(join(tmpdir(), 'void-manifest-outside-')), 'evil.yaml');
    writeFileSync(outside, 'schemaVersion: 1\nadapters: []\n');
    mkdirSync(dirname(join(root, SECURITY_MANIFEST_PATH)), { recursive: true });
    symlinkSync(outside, join(root, SECURITY_MANIFEST_PATH));

    await expect(loadSecurityManifest(root)).rejects.toThrow(/symbolic link/i);
  });

  it('fails loudly on a manifest that exists but does not parse', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-manifest-broken-'));
    mkdirSync(dirname(join(root, SECURITY_MANIFEST_PATH)), { recursive: true });
    writeFileSync(join(root, SECURITY_MANIFEST_PATH), 'schemaVersion: 1\nadapters: [{id: "x"}]\n');

    // Falling back to "no scanners" here would report a clean baseline for a
    // project that meant to run four of them.
    await expect(loadSecurityManifest(root)).rejects.toThrow(/SECURITY_MANIFEST_INVALID/);
  });
});
