// @test-resource subprocess
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseInstallManifest } from '../../packages/cli/src/lib/install-manifest.js';
import { readInstallReceipt } from '../../packages/cli/src/lib/receipts.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/cli/dist/bin/void-machine.mjs');

it('preserves project-owned Codex hooks through local init and update without claiming them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-project-hooks-'));
  const path = '.codex/hooks.json';
  const target = join(root, path);
  const original = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{
    type: 'command', command: 'user-owned-hook',
  }] }] } })}\n`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, original);
    for (const args of [['init', '--runtime', 'codex', '--no-interactive'], ['update']]) {
      const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, VOID_GLOBAL_DIR: join(root, '.global') },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(readFileSync(target, 'utf8')).toBe(original);
      const manifest = parseInstallManifest(readFileSync(join(root, '.void/install-manifest.json'), 'utf8'));
      const receipt = await readInstallReceipt(root);
      expect(manifest).toBeDefined();
      expect(receipt).toBeDefined();
      expect(manifest?.files.map(file => file.path)).not.toContain(path);
      expect(receipt?.files.map(file => file.path)).not.toContain(path);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
