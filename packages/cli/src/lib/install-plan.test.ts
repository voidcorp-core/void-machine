// @test-resource subprocess
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { init } from '../commands/init.js';

const roots: string[] = [];
const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('refuses the actual retained broken hook instead of smoking only pristine staged assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'void-projected-install-'));
  roots.push(root);
  mkdirSync(join(root, '.void/hooks'), { recursive: true });
  const hook = join(root, '.void/hooks/_void-hook.mjs');
  const content = 'process.exitCode = 73;\n';
  writeFileSync(hook, content);
  process.chdir(root);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  await expect(init(['--no-interactive', '--runtime', 'codex'])).rejects.toThrow();
  expect(readFileSync(hook, 'utf8')).toBe(content);
  expect(existsSync(join(root, '.void/install-manifest.json'))).toBe(false);
  expect(existsSync(join(root, '.codex/hooks.json'))).toBe(false);
});

it('prepares finite bundled mutations without changing project files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'void-prepared-install-'));
  roots.push(root);
  mkdirSync(join(root, '.void'), { recursive: true });
  const config = '{"packs":{},"projectPreference":"keep"}\n';
  writeFileSync(join(root, '.void/config.json'), config);
  process.chdir(root);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  let paths: readonly string[] = [];
  await init(['--no-interactive', '--runtime', 'codex'], {
    projectRoot: root,
    onPrepared: plan => { paths = plan.mutations.map(mutation => mutation.path); },
  });
  expect(existsSync(join(root, '.void/install-manifest.json'))).toBe(false);
  expect(readFileSync(join(root, '.void/config.json'), 'utf8')).toBe(config);
  expect(paths).toContain('.void/install-manifest.json');
  expect(paths).toContain('.void/machine/receipts/install-v1.json');
});
