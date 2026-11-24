import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapterFor } from './runtime-adapters.js';
import { prepareInstallCommit } from './local-install.js';
import { buildInstallReceipt, encodeReceipt, INSTALL_RECEIPT_PATH } from './receipts.js';
import { commitFileTransaction } from './transaction.js';

it('reports the configured local runner missing even when a healthy marketplace cache exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-local-health-'));
  try {
    const cache = join(root, 'cache');
    cpSync(resolve('packages/core/dist'), join(cache, 'voidcorp', 'harness', '3.8.0'), { recursive: true });
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ hooks: {
      PreToolUse: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.void/hooks/_void-hook.mjs"' }] }],
    } }));
    const { checks } = await adapterFor('claude').inspect(root, { claudeCacheRoot: cache });
    expect(checks.find((check) => check.name === 'local assets')?.ok).toBe(false);
    expect(checks.some((check) => check.name === 'plugin cache')).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

describe.each(['claude', 'codex'] as const)('%s obsolete worker migration', runtime => {
  it.each([false, true])('removes only unchanged receipt-owned worker, edited=%s', async edited => {
    const root = mkdtempSync(join(tmpdir(), 'retired-worker-'));
    const stage = mkdtempSync(join(tmpdir(), 'retired-worker-stage-'));
    const path = '.void/hooks/_syntax-worker.cjs';
    const original = 'previous released worker\n';
    try {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), edited ? 'user modification\n' : original, { mode: 0o644 });
      mkdirSync(dirname(join(root, INSTALL_RECEIPT_PATH)), { recursive: true });
      writeFileSync(join(root, INSTALL_RECEIPT_PATH), encodeReceipt(buildInstallReceipt({
        version: '3.8.0', source: 'local', runtimes: [runtime],
        files: [{ path, content: Buffer.from(original), mode: 0o644 }],
      })));
      await adapterFor(runtime).wire({ stageRoot: stage, installRoot: root,
        sourceRoot: resolve('packages/cli/dist/core-assets'), enabledPlugins: ['harness'], enabledPacks: [],
        source: 'local', marketplaceRepo: 'test/harness', pinVersion: '0.0.0' });
      expect(existsSync(join(stage, path))).toBe(false);
      const prepared = await prepareInstallCommit({ projectRoot: root, stageRoot: stage,
        version: '3.8.1', source: 'local', runtimes: [runtime], force: false });
      await commitFileTransaction(root, prepared.mutations);
      expect(prepared.preserved).toEqual(edited ? [path] : []);
      expect(existsSync(join(root, path))).toBe(edited);
      if (edited) expect(readFileSync(join(root, path), 'utf8')).toBe('user modification\n');
      expect(prepared.receipt.files.some(file => file.path === path)).toBe(false);
      const inspected = await adapterFor(runtime).inspect(root);
      expect(inspected.checks.some(check => /syntax worker/i.test(check.name))).toBe(false);
      expect(inspected.checks.find(check => check.name === `${runtime} hook smoke`)?.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stage, { recursive: true, force: true });
    }
  });
});
