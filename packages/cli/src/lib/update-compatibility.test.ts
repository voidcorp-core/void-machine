// @test-resource subprocess
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { init } from '../commands/init.js';
import { INSTALL_RECEIPT_PATH } from './receipts.js';

const roots: string[] = [];
const initialCwd = process.cwd();
afterEach(async () => {
  process.chdir(initialCwd);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('refuses a newer installation before init changes its files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  const receipt = JSON.stringify({ schemaVersion: 1, version: '99.0.0',
    source: 'local', runtimes: ['codex'], files: [] });
  await writeFile(join(root, INSTALL_RECEIPT_PATH), receipt);
  process.chdir(root);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });

  await expect(init(['--runtime', 'codex', '--no-interactive']))
    .rejects.toThrow(/newer.*99\.0\.0|99\.0\.0.*newer/i);
  expect(await readFile(join(root, INSTALL_RECEIPT_PATH), 'utf8')).toBe(receipt);
  expect(await readdir(root)).toEqual(['.void']);
});
