import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isUpdateProjectPath } from './candidate-plan.js';
import { applyFileTransaction, type FileMutation, inspectFileTransaction, prepareFileTransaction, recoverFileTransaction } from './transaction.js';
import { assertUpdateLease, type UpdateLease } from './update-lock.js';
import { STABLE_VERSION } from './update-release.js';

const kindSchema = z.enum(['project', 'launcher', 'active']);
type Kind = z.infer<typeof kindSchema>;
export interface UpdateSelection { readonly key: string; readonly projectRoots: readonly string[]; readonly binRoot: string }
export interface UpdateParticipant { readonly kind: Kind; readonly root: string; readonly mutations: readonly FileMutation[] }
const operationSchema = z.strictObject({ schemaVersion: z.literal(1), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  selectionKey: z.string().max(8192), target: z.string().regex(STABLE_VERSION),
  participants: z.array(z.strictObject({ kind: kindSchema, root: z.string().max(4096) })).min(1).max(128),
});
type Operation = z.infer<typeof operationSchema>;
const launcherPaths = new Set(['void-machine', 'voidmachine', 'vm', 'void-machine.cmd', 'voidmachine.cmd', 'vm.cmd', 'void-machine.mjs']);
function allowedPath(kind: Kind, path: string): boolean {
  return kind === 'project' ? isUpdateProjectPath(path) : kind === 'active' ? path === 'active.json' : launcherPaths.has(path);
}
async function validateScope(lease: UpdateLease, selection: UpdateSelection, operation: Operation): Promise<void> {
  if (operation.selectionKey !== selection.key) throw new Error('Pending update belongs to a different selection; repeat its original update command');
  const seen = new Set<string>();
  let phase = 0;
  for (const participant of operation.participants) {
    const expected = participant.kind === 'active' ? [lease.store]
      : participant.kind === 'launcher' ? [selection.binRoot] : selection.projectRoots;
    const next = participant.kind === 'project' ? 0 : participant.kind === 'launcher' ? 1 : 2;
    if (next < phase || seen.has(participant.root) || !expected.includes(participant.root)
      || await realpath(participant.root) !== participant.root) throw new Error('Invalid update participant root or activation order');
    seen.add(participant.root);
    phase = next;
  }
  if (operation.participants.at(-1)?.kind !== 'active') throw new Error('CLI activation must be the last participant');
}
async function boundedJson(path: string, limit = 65536): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid bounded update operation record');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Update operation record exceeds limit');
  return JSON.parse(bytes.toString('utf8'));
}
async function persist(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function recoverPendingUpdate(lease: UpdateLease, selection: UpdateSelection): Promise<void> {
  await assertUpdateLease(lease);
  const directory = join(lease.store, 'operation');
  if (!await exists(directory)) return;
  if (await realpath(directory) !== directory) throw new Error('Operation directory crosses a symbolic link');
  const ready = join(directory, 'operation.json');
  const operation = operationSchema.parse(await boundedJson(await exists(ready) ? ready : join(directory, 'preparing.json')));
  await validateScope(lease, selection, operation);
  if (!await exists(ready)) { await rm(directory, { recursive: true }); return; }
  // Validate every participant and backup before restoring even the first one.
  for (const [index, participant] of operation.participants.entries()) {
    const journal = await inspectFileTransaction(participant.root, join(directory, String(index)));
    if (journal.operationId !== operation.operationId || journal.entries.some(entry => !allowedPath(participant.kind, entry.path)
      || (participant.kind !== 'launcher' && entry.before.exists && entry.before.linkTarget !== undefined))) {
      throw new Error('Update journal escapes its declared participant scope');
    }
  }
  const committed = join(directory, 'committed.json');
  if (await exists(committed)) {
    z.strictObject({ operationId: z.literal(operation.operationId) }).parse(await boundedJson(committed));
    await rm(directory, { recursive: true });
    return;
  }
  const failures: unknown[] = [];
  for (let index = operation.participants.length - 1; index >= 0; index--) {
    const participant = operation.participants[index];
    if (!participant) continue;
    try {
      await assertUpdateLease(lease);
      await recoverFileTransaction(participant.root, join(directory, String(index)));
    } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, `Update recovery conflict; evidence retained in ${directory}`);
  await rm(directory, { recursive: true });
}

export async function executeUpdateOperation(lease: UpdateLease, input: {
  readonly selection: UpdateSelection; readonly operationId: string; readonly target: string;
  readonly participants: readonly UpdateParticipant[];
}, options: { readonly afterParticipant?: (kind: Kind) => void | Promise<void> } = {}): Promise<void> {
  await assertUpdateLease(lease);
  const operation = operationSchema.parse({ schemaVersion: 1, operationId: input.operationId,
    selectionKey: input.selection.key, target: input.target,
    participants: input.participants.map(({ kind, root }) => ({ kind, root })),
  });
  await validateScope(lease, input.selection, operation);
  for (const participant of input.participants) {
    if (participant.mutations.some(mutation => !allowedPath(participant.kind, mutation.path)
      || (participant.kind !== 'launcher' && 'replaceLink' in mutation))) throw new Error('Update mutation escapes participant scope');
  }
  const directory = join(lease.store, 'operation');
  await mkdir(directory, { mode: 0o700 });
  await persist(join(directory, 'preparing.json'), operation);
  try {
    for (const [index, participant] of input.participants.entries()) {
      await prepareFileTransaction(participant.root, participant.mutations, join(directory, String(index)), input.operationId);
    }
    await persist(join(directory, 'operation.json'), operation);
    for (const [index, participant] of input.participants.entries()) {
      await assertUpdateLease(lease);
      await applyFileTransaction(participant.root, join(directory, String(index)));
      await options.afterParticipant?.(participant.kind);
    }
    await persist(join(directory, 'committed.json'), { operationId: input.operationId });
    await rm(directory, { recursive: true });
  } catch (error) {
    try { await recoverPendingUpdate(lease, input.selection); }
    catch (recovery) { throw new AggregateError([error, recovery], `Update recovery conflict; evidence retained in ${directory}`); }
    throw error;
  }
}
