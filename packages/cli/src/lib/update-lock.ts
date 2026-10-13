import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rm, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { ensureStoreDirectory } from './cli-installation.js';

const lockSchema = z.strictObject({ schemaVersion: z.literal(1), pid: z.number().int().positive().max(2147483647),
  token: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/) });
export interface UpdateLease { readonly store: string; readonly token: string }
async function readLock(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Invalid update lock file');
  const body = await readFile(path, 'utf8');
  const parsed = lockSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new Error('Invalid update lock state; preserve it for diagnosis');
  return parsed.data;
}
function isLive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    return true;
  }
}

export async function assertUpdateLease(lease: UpdateLease): Promise<void> {
  const record = await readLock(join(lease.store, 'update.lock'));
  if (record.token !== lease.token || record.pid !== process.pid) throw new Error('Update lock ownership changed; preserving the foreign lock');
}

async function acquire(store: string, token: string): Promise<void> {
  const path = join(store, 'update.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, token }));
        await file.sync();
      } finally { await file.close(); }
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const current = await readLock(path);
    if (isLive(current.pid)) throw new Error(`Another updater owns this store (PID ${current.pid})`);
    const reclaim = join(store, 'update.lock-reclaim');
    try { await mkdir(reclaim, { mode: 0o700 }); }
    catch { throw new Error('Update lock reclamation is already in progress; preserve its evidence'); }
    try {
      const checked = await readLock(path);
      if (isLive(checked.pid)) throw new Error(`Another updater owns this store (PID ${checked.pid})`);
      await rm(path);
    } finally { await rmdir(reclaim); }
  }
  throw new Error('Another updater acquired the store during recovery');
}

export async function withUpdateLock<T>(store: string, run: (lease: UpdateLease) => Promise<T>): Promise<T> {
  await ensureStoreDirectory(store);
  const lease = { store: resolve(store), token: randomUUID() };
  await acquire(lease.store, lease.token);
  try { return await run(lease); }
  finally {
    await assertUpdateLease(lease);
    await rm(join(lease.store, 'update.lock'));
  }
}
