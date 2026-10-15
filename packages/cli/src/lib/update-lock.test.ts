// @test-resource subprocess
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
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

it('excludes a real contender across stale-owner re-read, publication and callback', async () => {
  const { withUpdateLock } = await import('./update-lock.js');
  const root = await fixture();
  const old = JSON.stringify({ schemaVersion: 1, pid: 2147483647, token: 'old-token' });
  await writeFile(join(root, 'update.lock'), old);
  const script = join(root, 'contender.mjs');
  await writeFile(script, `
    import fs from 'node:fs/promises';
    import {basename} from 'node:path';
    import {once} from 'node:events';
    import {syncBuiltinESMExports} from 'node:module';
    const pause = async phase => {
      const resume = once(process, 'message', {signal:AbortSignal.timeout(10000)});
      process.send(phase);
      await resume;
    };
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (basename(String(to)) === 'update.lock') await pause('publishing');
      return rename(from, to);
    };
    syncBuiltinESMExports();
    const {withUpdateLock} = await import(${JSON.stringify(new URL('./update-lock.ts', import.meta.url).href)});
    await withUpdateLock(${JSON.stringify(root)}, async () => { await pause('entered'); });
    process.disconnect();
  `);
  const child = fork(script, [], { silent: true,
    execArgv: ['--import', fileURLToPath(import.meta.resolve('tsx'))] });
  const next = () => once(child, 'message', { signal: AbortSignal.timeout(10_000) });
  try {
    expect(await next()).toEqual(['publishing', undefined]);
    expect(await readFile(join(root, 'update.lock'), 'utf8')).toBe(old);
    await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow(/another updater/i);
    const entered = next();
    child.send('continue');
    expect(await entered).toEqual(['entered', undefined]);
    await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow(/another updater/i);
    const exit = once(child, 'exit', { signal: AbortSignal.timeout(10_000) });
    child.send('finish');
    expect((await exit)[0]).toBe(0);
    await expect(withUpdateLock(root, async () => 'next')).resolves.toBe('next');
  } finally { child.kill('SIGKILL'); }
});

it.each(['empty-primary', 'unknown-claim', 'foreign-content', 'scan-limit'] as const)(
  'preserves %s ownership state instead of guessing or scanning without a bound', async kind => {
    const { withUpdateLock } = await import('./update-lock.js');
    const root = await fixture();
    if (kind === 'empty-primary') await writeFile(join(root, 'update.lock'), '');
    if (kind === 'unknown-claim') await mkdir(join(root, 'update.claim-unknown'));
    const foreign = join(root, 'update.claim-2147483647-dead');
    if (kind === 'foreign-content') {
      await mkdir(foreign);
      await writeFile(join(foreign, 'user-file'), 'preserve');
    }
    if (kind === 'scan-limit') {
      for (let index = 0; index < 256; index++) await writeFile(join(root, `unrelated-${index}`), '');
    }
    await expect(withUpdateLock(root, async () => 'wrong')).rejects.toThrow();
    if (kind === 'empty-primary') expect(await readFile(join(root, 'update.lock'), 'utf8')).toBe('');
    if (kind === 'foreign-content') expect(await readFile(join(foreign, 'user-file'), 'utf8')).toBe('preserve');
  },
);
