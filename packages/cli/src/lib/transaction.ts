import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { pruneEmptyParents } from './receipts.js';

export interface FileWriteMutation {
  readonly path: string;
  readonly content: Uint8Array;
  readonly mode?: number;
}

export interface FileRemoveMutation {
  readonly path: string;
  readonly remove: true;
}

export type FileMutation = FileWriteMutation | FileRemoveMutation;

export interface TransactionOptions {
  /** Test-only fault injection: throw immediately after this zero-based mutation. */
  readonly failAfterMutation?: number;
}

export function isSafeRelativePath(path: string): boolean {
  if (path === '' || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

async function infoOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function rejectSymlinkPath(projectRoot: string, relativePath: string): Promise<void> {
  let cursor = resolve(projectRoot);
  for (const segment of relativePath.split('/')) {
    cursor = join(cursor, segment);
    const info = await infoOrUndefined(cursor);
    if (info?.isSymbolicLink()) throw new Error(`transaction target crosses a symbolic link: ${relativePath}`);
  }
}

function targetFor(projectRoot: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) throw new Error(`unsafe transaction path: ${relativePath}`);
  const root = resolve(projectRoot);
  const target = resolve(root, ...relativePath.split('/'));
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`unsafe transaction path: ${relativePath}`);
  }
  return target;
}

async function atomicWrite(target: string, content: Uint8Array, mode: number): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.void-tx-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', mode);
    try {
      await file.writeFile(content);
      await file.chmod(mode);
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function removeEmptyCreatedDirectories(projectRoot: string, created: readonly string[]): Promise<void> {
  const root = resolve(projectRoot);
  const deepestFirst = [...created].sort((a, b) => b.length - a.length);
  for (const path of deepestFirst) {
    if (path === root) continue;
    try {
      await rmdir(path);
    } catch {
      // Non-empty means it contains pre-existing/user state and must survive.
    }
  }
}

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const relativePath = z.string().max(1024).refine(isSafeRelativePath);
const fileState = z.discriminatedUnion('exists', [
  z.strictObject({ exists: z.literal(false) }),
  z.strictObject({ exists: z.literal(true), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.number().int().min(0).max(0o777) }),
]);
const journalSchema = z.strictObject({
  schemaVersion: z.literal(1), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  root: z.string().max(4096),
  entries: z.array(z.strictObject({ path: relativePath, before: fileState, after: fileState }))
    .max(MAX_FILES),
  createdDirectories: z.array(relativePath).max(MAX_FILES),
});
type FileState = z.infer<typeof fileState>;
type Journal = z.infer<typeof journalSchema>;

function hash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function canonicalDirectory(path: string): Promise<string> {
  const physical = await realpath(path);
  if (physical !== resolve(path) || !(await lstat(path)).isDirectory()) {
    throw new Error(`transaction directory crosses a symbolic link: ${path}`);
  }
  return physical;
}

async function boundedRead(path: string, limit = MAX_FILE_BYTES): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) {
    throw new Error(`transaction input is not a bounded regular file: ${path}`);
  }
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error(`transaction input exceeded byte limit: ${path}`);
  return bytes;
}

async function observe(path: string): Promise<{ state: FileState; bytes?: Buffer }> {
  const info = await infoOrUndefined(path);
  if (info === undefined) return { state: { exists: false } };
  const bytes = await boundedRead(path);
  return { state: { exists: true, sha256: hash(bytes), mode: info.mode & 0o777 }, bytes };
}

function equalState(a: FileState, b: FileState): boolean {
  return a.exists === b.exists && (!a.exists || (b.exists
    && a.sha256 === b.sha256 && a.mode === b.mode));
}

/** Persist every snapshot before publishing; caller owns the exclusive operation lock. */
export async function prepareFileTransaction(
  projectRoot: string, mutations: readonly FileMutation[], journalRoot: string, operationId: string,
): Promise<void> {
  const root = await canonicalDirectory(projectRoot);
  if (mutations.length > MAX_FILES) throw new Error('transaction file limit exceeded');
  await canonicalDirectory(dirname(journalRoot));
  const seen = new Set<string>();
  const entries: Journal['entries'] = [];
  const created = new Set<string>();
  const snapshots: { before?: Buffer; after?: Uint8Array }[] = [];
  let bytes = 0;
  for (const mutation of mutations) {
    const target = targetFor(root, mutation.path);
    if (seen.has(target)) throw new Error(`duplicate transaction path: ${mutation.path}`);
    if (target === resolve(journalRoot) || target.startsWith(`${resolve(journalRoot)}${sep}`)) {
      throw new Error('transaction cannot mutate its journal');
    }
    seen.add(target);
    await rejectSymlinkPath(root, mutation.path);
    const before = await observe(target);
    const content = 'remove' in mutation ? undefined : mutation.content;
    bytes += (before.bytes?.length ?? 0) + (content?.length ?? 0);
    if ((content?.length ?? 0) > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) {
      throw new Error('transaction byte limit exceeded');
    }
    const after: FileState = content === undefined ? { exists: false }
      : { exists: true, sha256: hash(content), mode: 'mode' in mutation ? mutation.mode ?? 0o644 : 0o644 };
    entries.push({ path: mutation.path, before: before.state, after });
    snapshots.push({ ...(before.bytes === undefined ? {} : { before: before.bytes }),
      ...(content === undefined ? {} : { after: content }) });
    let parent = dirname(target);
    while (parent !== root && parent.startsWith(`${root}${sep}`)) {
      if (await infoOrUndefined(parent)) break;
      created.add(parent.slice(root.length + 1).split(sep).join('/'));
      parent = dirname(parent);
    }
  }
  const journal = journalSchema.parse({ schemaVersion: 1, operationId, root,
    entries, createdDirectories: [...created] });
  await mkdir(journalRoot, { mode: 0o700 });
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshot.before) await atomicWrite(join(journalRoot, `${index}.before`), snapshot.before, 0o600);
    if (snapshot.after) await atomicWrite(join(journalRoot, `${index}.after`), snapshot.after, 0o600);
  }
  await atomicWrite(join(journalRoot, 'journal.json'), Buffer.from(JSON.stringify(journal)), 0o600);
}

async function readJournal(projectRoot: string, journalRoot: string): Promise<Journal> {
  const root = await canonicalDirectory(projectRoot);
  await canonicalDirectory(journalRoot);
  const body = await boundedRead(join(journalRoot, 'journal.json'), 4 * 1024 * 1024);
  const journal = journalSchema.parse(JSON.parse(body.toString('utf8')));
  if (journal.root !== root) throw new Error('transaction journal belongs to a foreign root');
  const paths = new Set<string>();
  let total = 0;
  for (const [index, entry] of journal.entries.entries()) {
    if (paths.has(entry.path)) throw new Error('duplicate transaction path in journal');
    paths.add(entry.path);
    targetFor(root, entry.path);
    await rejectSymlinkPath(root, entry.path);
    for (const side of ['before', 'after'] as const) {
      const state = entry[side];
      if (!state.exists) continue;
      const backup = await boundedRead(join(journalRoot, `${index}.${side}`));
      total += backup.length;
      if (hash(backup) !== state.sha256 || total > MAX_TOTAL_BYTES) {
        throw new Error(`transaction snapshot integrity failure: ${entry.path}`);
      }
    }
  }
  for (const directory of journal.createdDirectories) {
    if (!journal.entries.some(entry => !entry.before.exists && entry.path.startsWith(`${directory}/`))) {
      throw new Error('transaction journal contains an unrelated directory');
    }
    await rejectSymlinkPath(root, directory);
  }
  return journal;
}

/** Forward writes require prepared bytes AND mode, never a timestamp. */
export async function applyFileTransaction(
  projectRoot: string, journalRoot: string,
  options: { readonly afterMutation?: (index: number) => void | Promise<void> } = {},
): Promise<void> {
  const journal = await readJournal(projectRoot, journalRoot);
  for (const [index, entry] of journal.entries.entries()) {
    await rejectSymlinkPath(journal.root, entry.path);
    const target = targetFor(journal.root, entry.path);
    if (!equalState((await observe(target)).state, entry.before)) {
      throw new Error(`transaction forward conflict at ${entry.path}; snapshots retained in ${journalRoot}`);
    }
    if (entry.after.exists) {
      const bytes = await boundedRead(join(journalRoot, `${index}.after`));
      if (hash(bytes) !== entry.after.sha256) throw new Error('transaction snapshot changed');
      await atomicWrite(target, bytes, entry.after.mode);
    } else {
      await rm(target, { force: true });
      await pruneEmptyParents(journal.root, target);
    }
    await options.afterMutation?.(index);
  }
}

/** Inspect actual bytes across rename/crash windows; preserve later edits and evidence. */
export async function recoverFileTransaction(projectRoot: string, journalRoot: string): Promise<void> {
  const journal = await readJournal(projectRoot, journalRoot);
  const conflicts: string[] = [];
  for (let index = journal.entries.length - 1; index >= 0; index -= 1) {
    const entry = journal.entries[index];
    if (entry === undefined) continue;
    await rejectSymlinkPath(journal.root, entry.path);
    const target = targetFor(journal.root, entry.path);
    const actual = (await observe(target)).state;
    if (equalState(actual, entry.before)) continue;
    if (!equalState(actual, entry.after)) { conflicts.push(entry.path); continue; }
    if (entry.before.exists) {
      const bytes = await boundedRead(join(journalRoot, `${index}.before`));
      if (hash(bytes) !== entry.before.sha256) throw new Error('transaction backup changed');
      await atomicWrite(target, bytes, entry.before.mode);
    } else await rm(target, { force: true });
  }
  await removeEmptyCreatedDirectories(journal.root,
    journal.createdDirectories.map(path => targetFor(journal.root, path)));
  if (conflicts.length > 0) {
    throw new Error(`transaction rollback conflict at ${conflicts.slice(0, 10).join(', ')}; `
      + `snapshots retained in ${journalRoot}`);
  }
}

/** Existing immediate API uses the same snapshot, publication and recovery engine. */
export async function commitFileTransaction(
  projectRoot: string, mutations: readonly FileMutation[], options: TransactionOptions = {},
): Promise<void> {
  const root = await realpath(projectRoot);
  const workspace = await mkdtemp(join(root, `.${basename(root)}.void-tx-`));
  const journal = join(workspace, 'journal');
  let prepared = false;
  let keepEvidence = false;
  try {
    await prepareFileTransaction(root, mutations, journal, randomUUID());
    prepared = true;
    await applyFileTransaction(root, journal, { afterMutation: index => {
      if (options.failAfterMutation === index) {
        throw new Error(`injected transaction failure after mutation ${index}`);
      }
    } });
  } catch (error) {
    if (prepared) {
      try { await recoverFileTransaction(root, journal); }
      catch (recoveryError) {
        keepEvidence = true;
        throw new AggregateError([error, recoveryError], `transaction recovery failed; evidence: ${journal}`);
      }
    }
    throw error;
  } finally {
    if (!keepEvidence) await rm(workspace, { recursive: true, force: true });
  }
}
