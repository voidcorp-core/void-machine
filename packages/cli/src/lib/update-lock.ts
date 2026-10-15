import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, readFile, rename, rm, rmdir } from 'node:fs/promises';
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

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// Atomic directory creation carries the complete owner identity in its name.
// There is no ownerless claim-publication window and no lock to reclaim claims.
const claimPattern = /^update\.claim-([1-9]\d{0,9})-([a-zA-Z0-9-]{1,80})$/;
async function clearClaim(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid update claim; preserve its evidence');
    const entries: string[] = [];
    const directory = await opendir(path);
    for await (const entry of directory) {
      if (entries.length === 1 || entry.name !== 'owner.json' || !entry.isFile()) {
        throw new Error('Unknown update claim contents; preserve its evidence');
      }
      entries.push(entry.name);
    }
    // A dead claim may contain a partial staging record. It was never primary
    // ownership; only the fixed staging name in this immutable claim is ours.
    if (entries.length === 1) await rm(join(path, 'owner.json'));
    await rmdir(path);
  } catch (error) { if (!missing(error)) throw error; }
}

async function excludeContenders(store: string, claim: string): Promise<void> {
  const directory = await opendir(store);
  let count = 0;
  for await (const entry of directory) {
    if (++count > 256) throw new Error('Update ownership scan exceeds its entry limit');
    if (!entry.name.startsWith('update.claim-') || entry.name === claim) continue;
    const owner = claimPattern.exec(entry.name);
    const pid = Number(owner?.[1]);
    if (!owner || pid > 2147483647 || !entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('Invalid update claim; preserve its evidence');
    }
    if (isLive(pid)) throw new Error(`Another updater owns this store (PID ${pid})`);
    await clearClaim(join(store, entry.name));
  }
}

async function acquire(store: string, token: string, claim: string): Promise<void> {
  await excludeContenders(store, claim);
  // The old anonymous guard cannot establish a dead owner. Preserve and refuse
  // it; new attempts never create this unrecoverable legacy state.
  try {
    await lstat(join(store, 'update.lock-reclaim'));
    throw new Error('Legacy update lock reclamation has no owner; preserve its evidence');
  } catch (error) { if (!missing(error)) throw error; }
  const path = join(store, 'update.lock');
  try {
    const current = await readLock(path);
    if (isLive(current.pid)) throw new Error(`Another updater owns this store (PID ${current.pid})`);
  } catch (error) { if (!missing(error)) throw error; }
  const staged = join(store, claim, 'owner.json');
  const file = await open(staged, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, token }));
    await file.sync();
  } finally { await file.close(); }
  // The claim remains held over the re-read and atomic publication, and then
  // throughout the callback. A contender cannot replace a newly live owner.
  await rename(staged, path);
}

export async function withUpdateLock<T>(store: string, run: (lease: UpdateLease) => Promise<T>): Promise<T> {
  await ensureStoreDirectory(store);
  const lease = { store: resolve(store), token: randomUUID() };
  const claim = `update.claim-${process.pid}-${lease.token}`;
  const path = join(lease.store, claim);
  await mkdir(path, { mode: 0o700 });
  try {
    await acquire(lease.store, lease.token, claim);
    try { return await run(lease); }
    finally {
      await assertUpdateLease(lease);
      await rm(join(lease.store, 'update.lock'));
    }
  } finally { await clearClaim(path); }
}
