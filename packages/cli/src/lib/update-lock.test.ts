// @test-resource subprocess
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-update-lock-')));
  roots.push(root);
  return root;
}

it('refuses another updater while the owner is alive and releases only its own token', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  await withUpdateLock(root, async lease => {
    expect(lease.store).toBe(root);
    await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow(/another updater/i);
  });
  await expect(withUpdateLock(root, async () => 'next')).resolves.toBe('next');
});

it('refuses malformed lock state rather than assuming the owner is dead', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  await writeFile(join(root, 'update.lock'), '{}');
  await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow(/invalid.*lock/i);
  expect(await readFile(join(root, 'update.lock'), 'utf8')).toBe('{}');
});

it('preserves a lock replaced by another token while the callback runs', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  const replacement = JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'foreign-token' });
  await expect(withUpdateLock(root, async () => {
    await writeFile(join(root, 'update.lock'), replacement);
  })).rejects.toThrow(/ownership.*changed/i);
  expect(await readFile(join(root, 'update.lock'), 'utf8')).toBe(replacement);
});

it('refuses concurrent stale-lock reclamation without waiting', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  await writeFile(join(root, 'update.lock'), JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: 'old-token' }));
  await mkdir(join(root, 'update.lock-reclaim'));
  await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow(/reclamation/i);
});

it('reclaims a proven dead PID without using lock age as authority', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  await writeFile(join(root, 'update.lock'), JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: 'dead-token' }));
  await expect(withUpdateLock(root, async () => 'recovered')).resolves.toBe('recovered');
});

it.each(['claim', 'publication'] as const)('recovers after SIGKILL at %s without leaving ownerless lock state', async boundary => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  if (boundary === 'claim') await writeFile(join(root, 'update.lock'), JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: 'dead-token' }));
  const script = join(root, 'interrupted-reclaimer.mjs');
  await writeFile(script, `
    import fs from 'node:fs/promises';
    import {basename} from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    const stop = async () => {
      await fs.writeFile(${JSON.stringify(join(root, 'interrupted'))}, String(process.pid));
      process.kill(process.pid, 'SIGKILL');
    };
    const open = fs.open;
    fs.open = async (path, ...args) => {
      const file = await open(path, ...args);
      if (${JSON.stringify(boundary)} === 'publication' && ['update.lock', 'owner.json'].includes(basename(String(path)))) await stop();
      return file;
    };
    const mkdir = fs.mkdir;
    fs.mkdir = async (path, options) => {
      const result = await mkdir(path, options);
      if (${JSON.stringify(boundary)} === 'claim' && /^update\\.(lock-reclaim|claim-)/.test(basename(String(path)))) await stop();
      return result;
    };
    syncBuiltinESMExports();
    const {withUpdateLock} = await import(${JSON.stringify(new URL('./update-lock.ts', import.meta.url).href)});
    await withUpdateLock(${JSON.stringify(root)}, async () => { throw new Error('must stop before acquisition'); });
  `);
  await expect(promisify(execFile)(process.execPath, ['--import', fileURLToPath(import.meta.resolve('tsx')), script], {
    timeout: 10_000,
  })).rejects.toMatchObject({ signal: 'SIGKILL' });
  expect(Number(await readFile(join(root, 'interrupted'), 'utf8'))).toBeGreaterThan(0);
  await expect(withUpdateLock(root, async () => 'recovered')).resolves.toBe('recovered');
});
