import { createHash } from 'node:crypto';
import { existsSync, type Stats } from 'node:fs';
import {
  cp,
  lstat,
  rm,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { CO_OWNED_FILES } from './co-owned.js';
import {
  buildInstallManifest,
  INSTALL_MANIFEST_PATH,
  parseInstallManifest,
  readInstallManifest,
  sha256Of,
} from './install-manifest.js';
import {
  buildInstallReceipt,
  encodeReceipt,
  INSTALL_RECEIPT_PATH,
  type InstallReceipt,
  type ReceiptFileInput,
  readInstallReceipt,
} from './receipts.js';
import type { Runtime } from './runtime.js';
import type { InstallSource } from './runtime-assets.js';
import type { FileMutation } from './transaction.js';

// Co-owned in the strongest sense: the harness owns exactly its marked block,
// the project owns every other line. Seeding these is what lets init patch the
// block instead of writing a file over whatever the project had.
//
// Read from `co-owned.ts` rather than listed here: the manifest verification
// needs the same answer to tell a project's own writing apart from drift, and a
// second copy is how the two start disagreeing.
const SHARED_FILES = CO_OWNED_FILES;

const MANAGED_PREFIXES = [
  '.void/hooks/',
  '.claude/skills/',
  '.claude/agents/',
  '.claude/commands/',
  '.agents/skills/',
  '.codex/agents/',
] as const;

const MANAGED_FILES = new Set([
  INSTALL_MANIFEST_PATH,
  '.void/installed/PHILOSOPHY.md',
  '.codex/hooks.json',
]);

function digest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function isManaged(path: string): boolean {
  return MANAGED_FILES.has(path) || MANAGED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function infoOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

export async function seedInstallStage(projectRoot: string, stageRoot: string): Promise<void> {
  for (const path of SHARED_FILES) {
    const source = join(projectRoot, ...path.split('/'));
    if (!existsSync(source)) continue;
    const destination = join(stageRoot, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

/**
 * Remove from the stage every managed path the project already fills, and name
 * them, on first install and subsequent updates alike.
 *
 * A project that already carried skills could not install at all: `init` ran to
 * the end, met a name it shares with one of ours, and rolled everything back.
 * `--force` would have overwritten a file the project owned before us.
 *
 * Withheld from the STAGE rather than skipped at commit time, so that one truth
 * governs everything downstream: the manifest does not claim it, the ignore block
 * does not list it, the receipt does not own it, and no later update mistakes it
 * for an asset of ours that someone edited.
 *
 * Receipt or manifest ownership is checked per path. Previously claimed paths
 * stay staged so the transaction can restore and report local edits.
 */
export async function withholdProjectOwned(
  projectRoot: string,
  stageRoot: string,
): Promise<string[]> {
  // Per PATH, never per install. "Have we been here before?" is too coarse: on the
  // second update the answer is yes, and a file that was the project's since
  // before we arrived would become a conflict again. The question that holds is
  // "has this path ever been ours?", and the committed manifest answers it -- the
  // same rule the ownership decision already states.
  const ours = new Set<string>((await readInstallReceipt(projectRoot))?.files.map((file) => file.path) ?? []);
  try {
    const manifest = parseInstallManifest(
      await readFile(join(projectRoot, ...INSTALL_MANIFEST_PATH.split('/')), 'utf8'),
    );
    for (const file of manifest?.files ?? []) ours.add(file.path);
    ours.add(INSTALL_MANIFEST_PATH);
  } catch {
    // No manifest: nothing has ever been claimed here, so nothing is ours yet.
  }

  const withheld: string[] = [];
  for (const file of await collectStageFiles(stageRoot)) {
    if (!isManaged(file.path) || ours.has(file.path)) continue;
    const target = join(projectRoot, ...file.path.split('/'));
    const info = await infoOrUndefined(target);
    if (info === undefined) continue;
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`unowned asset conflict at non-regular file ${file.path}`);
    }
    if (info.isFile() && !info.isSymbolicLink()) {
      const current = await readFile(target);
      // Identical bytes are not a collision: it is the same content, so installing
      // it changes nothing and claiming it is correct.
      if (current.equals(Buffer.from(file.content))) continue;
    }
    withheld.push(file.path);
    await rm(join(stageRoot, ...file.path.split('/')), { force: true });
  }
  return withheld.sort();
}

export async function collectStageFiles(stageRoot: string): Promise<ReceiptFileInput[]> {
  const files: ReceiptFileInput[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`staged asset is a symbolic link: ${path}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const info = await lstat(path);
        files.push({
          path: relative(resolve(stageRoot), path).split('\\').join('/'),
          content: await readFile(path),
          mode: info.mode & 0o777,
        });
      }
    }
  }
  await visit(stageRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function sameOwnedFile(
  content: Uint8Array,
  mode: number,
  owned: InstallReceipt['files'][number],
): boolean {
  return digest(content) === owned.sha256 && (mode & 0o777) === owned.mode;
}

export interface PrepareInstallInput {
  readonly projectRoot: string;
  readonly stageRoot: string;
  readonly version: string;
  readonly source: InstallSource;
  readonly runtimes: readonly Runtime[];
  readonly force: boolean;
  /** Update alone recovers missing receipt claims attested by the prior manifest. */
  readonly recoverManifestOwnership?: boolean;
  /** Runtime-add mode: keep unchanged ownership not represented in this partial stage. */
  readonly retainPreviousOwned?: boolean;
}

export interface PreparedInstall {
  readonly mutations: readonly FileMutation[];
  readonly receipt: InstallReceipt;
  /** Previously claimed managed files whose local edits this transaction restores. */
  readonly restored: readonly string[];
  /**
   * Assets the previous receipt owned that this install refuses to remove,
   * because their bytes no longer match what we wrote. Kept on purpose, and
   * surfaced so the caller can say so: a renamed skill preserved this way goes
   * on loading beside its replacement, and a silent success reads as a project
   * with one doctrine when it has two.
   */
  readonly preserved: readonly string[];
}

/**
 * Turn an isolated compiled stage into a finite, receipt-backed transaction.
 * Existing shared files may be patched but are never claimed. Existing native
 * assets need a prior receipt or explicit force; force still does not seize
 * deletion ownership.
 */
/**
 * Write the committed manifest into the stage, so it publishes with everything
 * else and describes exactly this install. Called before `prepareInstallCommit`,
 * which then picks it up as one more staged file — the manifest excludes itself,
 * since a file cannot carry the hash of contents that include that hash.
 */
export async function stageInstallManifest(stageRoot: string, version: string, projectDoctrineTemplateSha256?: string): Promise<void> {
  const staged = await collectStageFiles(stageRoot);
  const manifest = buildInstallManifest(
    version,
    staged.map((file) => ({ path: file.path, sha256: sha256Of(file.content) })),
    projectDoctrineTemplateSha256,
  );
  const target = join(stageRoot, ...INSTALL_MANIFEST_PATH.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** How many conflicting paths are spelled out before the message gives a count. */
const MAX_NAMED_CONFLICTS = 5;

/**
 * One message for every asset the install cannot prove it wrote.
 *
 * Named rather than counted, because the operator's next move is to look at
 * those exact files; capped, because a project whose whole receipt was lost
 * would otherwise print a hundred paths and bury the remedy under them.
 */
export function conflictMessage(paths: readonly string[]): string {
  const named = paths.slice(0, MAX_NAMED_CONFLICTS).join(', ');
  const rest = paths.length - MAX_NAMED_CONFLICTS;
  const tail = rest > 0 ? `, and ${String(rest)} more` : '';
  const remedy = paths.length === 1 ? 'preserve it' : 'preserve them';
  return `unowned asset conflict at ${named}${tail}; ${remedy} or re-run with --force`;
}

export async function prepareInstallCommit(input: PrepareInstallInput): Promise<PreparedInstall> {
  const staged = await collectStageFiles(input.stageRoot);
  const previous = await readInstallReceipt(input.projectRoot);
  const previousFiles = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  const manifest = readInstallManifest(input.projectRoot);
  const manifestFiles = new Map((manifest?.files ?? []).map((file) => [file.path, file]));
  const stagedPaths = new Set(staged.map((file) => file.path));
  const owned: ReceiptFileInput[] = [];
  const mutations: FileMutation[] = [];
  const conflicts: string[] = [];
  const restored: string[] = [];

  for (const file of staged) {
    const target = join(input.projectRoot, ...file.path.split('/'));
    const info = await infoOrUndefined(target);
    if (info?.isSymbolicLink()) throw new Error(`unowned asset conflict at symbolic link ${file.path}`);
    if (info !== undefined && !info.isFile()) throw new Error(`unowned asset conflict at ${file.path}`);
    const current = info === undefined ? undefined : await readFile(target);
    const currentMode = info?.mode ?? 0;
    const priorOwnership = previousFiles.get(file.path);
    const recoveredOwnership = input.recoverManifestOwnership === true
      && priorOwnership === undefined && current !== undefined
      && digest(current) === manifestFiles.get(file.path)?.sha256;
    const stillOwned = current !== undefined
      && priorOwnership !== undefined
      && sameOwnedFile(current, currentMode, priorOwnership);
    const changed = current === undefined
      || !current.equals(Buffer.from(file.content))
      || (currentMode & 0o777) !== file.mode;
    const claimedManaged = isManaged(file.path) && (
      priorOwnership !== undefined || manifestFiles.has(file.path)
      || (file.path === INSTALL_MANIFEST_PATH && manifest !== undefined)
    );

    if (
      changed
      && current !== undefined
      && isManaged(file.path)
      && !stillOwned
      && !claimedManaged
      && !input.force
    ) {
      // Collected rather than thrown on. Rendered one at a time, the operator
      // fixes a file, re-runs, and meets the next one: a project carrying
      // dozens of them pays the round trip once per file.
      conflicts.push(file.path);
      continue;
    }
    if (changed) mutations.push({ path: file.path, content: file.content, mode: file.mode });
    if (changed && current !== undefined && claimedManaged) {
      const attested = manifestFiles.get(file.path);
      // Rehydration attests current permissions, not delivered ones. Report any
      // mode correction even when that reconstructed receipt matches the disk.
      if ((currentMode & 0o777) !== file.mode || (!stillOwned && (
        priorOwnership !== undefined || (attested !== undefined && digest(current) !== attested.sha256)
      ))) {
        restored.push(file.path);
      }
    }
    // Bytes and mode identical to what we just compiled are proof enough of
    // ownership for a managed asset: whoever wrote that file wrote ours. Without
    // this, a file the install had nothing to write left the receipt in silence,
    // and the first version to change it met an asset it could not recognise.
    // Resemblance applies only to managed assets. Update may also recover a
    // missing claim from the prior manifest's attested bytes, never resemblance
    // to a newly compiled shared file or over authoritative receipt evidence.
    if (current === undefined || stillOwned || recoveredOwnership || claimedManaged
      || (!changed && isManaged(file.path))) owned.push(file);
  }

  if (conflicts.length > 0) throw new Error(conflictMessage(conflicts));

  const preserved: string[] = [];
  for (const prior of previous?.files ?? []) {
    if (stagedPaths.has(prior.path)) continue;
    const target = join(input.projectRoot, ...prior.path.split('/'));
    const info = await infoOrUndefined(target);
    if (info?.isFile() && !info.isSymbolicLink()) {
      const content = await readFile(target);
      // Edited by hand since we wrote it, so it is not ours to delete. Reported
      // rather than skipped in silence: a renamed skill kept this way stays on
      // disk and keeps loading, and `update` used to print a clean success over
      // a project running two versions of its own doctrine.
      if (!sameOwnedFile(content, info.mode, prior)) {
        preserved.push(prior.path);
        continue;
      }
      if (input.retainPreviousOwned) {
        owned.push({ path: prior.path, content, mode: prior.mode });
      } else {
        mutations.push({ path: prior.path, remove: true });
      }
    }
  }

  const receipt = buildInstallReceipt({
    version: input.version,
    source: input.source,
    runtimes: input.runtimes,
    files: owned,
  });
  mutations.push({
    path: INSTALL_RECEIPT_PATH,
    content: Buffer.from(encodeReceipt(receipt)),
    mode: 0o644,
  });
  return { mutations, receipt, preserved, restored };
}
