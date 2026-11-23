// Move a project from the pre-split `.void/` to the declared/observed layout.
//
// Runs from `update`, on every install source, because this is a layout concern
// and not a marketplace one. It is deliberately conservative: it MOVES observed
// artifacts and never merges, never overwrites, and never deletes. A destination
// that already exists is reported as a conflict and left untouched — telemetry is
// cheap, but silently clobbering a run journal that a reconciliation is reading
// is not.
//
// The migration itself never touches git: moving a tracked file already shows up
// as a deletion plus an ignored path, which is exactly the change the project
// should commit. `untrackDerived` is the one git-touching function here, and it
// runs only behind an explicit `--untrack-derived` — rewriting someone's index is
// their call, not a side effect of updating.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INSTALL_MANIFEST_PATH, parseInstallManifest } from './install-manifest.js';
import { readInstallReceipt } from './receipts.js';
import { writeExcludeBlock } from './git-exclude.js';
import {
  isOwnedDerived,
  legacyVoidPath,
  migratedName,
  ownershipOf,
  stripManagedBlock,
  pendingMigrations,
  previousMachinePath,
  voidInstalledDir,
  voidMachineDir,
  voidMachinePath,
} from '@voidcorp/hook-runner';

export interface VoidMigrationResult {
  /** Entries moved under `.void/local/`. */
  readonly moved: readonly string[];
  /** Entries the move could not finish — a permission, a lock, a cross-device link. */
  readonly conflicts: readonly string[];
  /** Entries where a legacy copy was preserved beside the destination. */
  readonly parked: readonly string[];
  /**
   * True when the managed block was taken back out of the project's
   * `.gitignore`. The rules live in `.git/info/exclude` now, which no checkout
   * can revert; a copy left here would keep one branch-dependent source alive.
   */
  readonly gitignoreBlockRemoved: boolean;
}

const EMPTY: VoidMigrationResult = Object.freeze({
  moved: [],
  conflicts: [],
  parked: [],
  gitignoreBlockRemoved: false,
});

/**
 * A free name to park a legacy file under, beside the destination that won.
 *
 * Never overwrites an earlier parked copy: a second migration would otherwise
 * destroy what the first one saved, which is the failure this whole path exists
 * to avoid.
 */
async function freeParkedName(target: string): Promise<string> {
  if (!existsSync(`${target}.legacy`)) return `${target}.legacy`;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = `${target}.legacy.${String(attempt)}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${target}.legacy.overflow`;
}

/**
 * Merge one legacy path into the target layout.
 *
 * The TARGET WINS on a per-file collision and the legacy copy is parked beside
 * it. Choosing a winner by size or date was rejected: measured on the real
 * park, the legacy copy held more data in one journal (31 events against 1) and
 * far less in another (1190 against 17054), so no rule picks correctly. Parking
 * loses nothing, and these are gitignored machine-local artefacts, so the extra
 * file costs nothing either.
 *
 * Returns true when at least one file was parked.
 */
async function mergeInto(source: string, destination: string): Promise<boolean> {
  const info = await stat(source);

  if (!info.isDirectory()) {
    if (!existsSync(destination)) {
      await mkdir(join(destination, '..'), { recursive: true });
      await rename(source, destination);
      return false;
    }
    await rename(source, await freeParkedName(destination));
    return true;
  }

  await mkdir(destination, { recursive: true });
  let parked = false;
  for (const entry of await readdir(source)) {
    if (await mergeInto(join(source, entry), join(destination, entry))) parked = true;
  }
  // The legacy directory must disappear, or every reader keeps falling back to
  // it and the drift is reported again on the next run.
  await rm(source, { recursive: true, force: true });
  return parked;
}

/**
 * What a migration would do, without doing it. Pure apart from the existence
 * checks it needs, and the exact list `migrateVoidLayout` will act on.
 */
export function planVoidMigration(root: string): { readonly movable: string[]; readonly conflicts: string[] } {
  const movable: string[] = [];
  const conflicts: string[] = [];
  for (const entry of pendingMigrations(root)) {
    if (existsSync(voidMachinePath(root, entry))) conflicts.push(entry);
    else movable.push(entry);
  }
  return { movable, conflicts };
}

/**
 * The repo-relative paths attested by the installation, before policy filtering.
 * `undefined` when nothing proves ownership: "prove nothing, touch nothing".
 *
 * The MANIFEST is consulted first, and that ordering is load-bearing: the receipt
 * is `observed`, so it is gitignored and simply ABSENT on a fresh clone. Sourcing
 * the ignore entries from it would have `update` regenerate a block with no
 * derived paths on exactly the checkout that needs them most — un-ignoring the
 * whole vendored catalogue in one command. The manifest is `project`, committed,
 * and always there. The receipt remains the fallback for a project installed by a
 * CLI old enough to predate the manifest.
 */
export async function ownedInstallPaths(root: string): Promise<Set<string> | undefined> {
  const manifestPath = join(root, ...INSTALL_MANIFEST_PATH.split('/'));
  if (existsSync(manifestPath)) {
    try {
      const manifest = parseInstallManifest(await readFile(manifestPath, 'utf8'));
      if (manifest !== undefined) {
        return new Set(manifest.files.map((file) => file.path));
      }
    } catch {
      // An unreadable manifest falls through to the receipt rather than claiming
      // nothing: doctor reports the damaged manifest on its own line.
    }
  }
  const receipt = await readInstallReceipt(root);
  if (receipt === undefined) return undefined;
  return new Set(receipt.files.map((file) => file.path));
}

/** Git keeps load-bearing assets; analyzer diagnostics use a different filter. */
export async function ownedDerivedPaths(root: string): Promise<Set<string> | undefined> {
  const paths = await ownedInstallPaths(root);
  return paths === undefined ? undefined : new Set([...paths].filter(isOwnedDerived));
}

export interface UntrackResult {
  /** Paths dropped from the index (still on disk), or that would be. */
  readonly untracked: readonly string[];
  /** Set when git refused or was unavailable; nothing was changed. */
  readonly error?: string;
}

/**
 * Drop regenerated content from the index while leaving every byte on disk.
 *
 * Explicit by construction — `update` only does this behind `--untrack-derived`.
 * Rewriting a project's index is the project's call: the files are theirs, the
 * commit is theirs, and a migration that quietly staged 126 deletions would be a
 * side effect nobody asked for.
 */
export async function untrackDerived(root: string, dryRun = false): Promise<UntrackResult> {
  // The manifest (then the receipt) is the ownership truth. Without either there
  // is nothing this may safely claim: `.claude/skills/` also holds skills the
  // project wrote itself, and dropping one of those from the index would be data
  // loss by inference.
  const owned = await ownedDerivedPaths(root);
  if (owned === undefined) {
    return { untracked: [], error: 'no readable install manifest or receipt — nothing here can be proven harness-owned' };
  }

  let listed: string;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--', '.void', '.claude', '.agents', '.codex'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { untracked: [], error: 'not a git repository, or git is unavailable' };
  }

  const untracked = listed
    .split('\0')
    .filter((path) => path !== '' && owned.has(path.split('\\').join('/')));
  if (untracked.length === 0 || dryRun) return { untracked };

  try {
    // `--cached` is the whole point: the index forgets them, the working tree
    // keeps them, and the runtimes keep loading them until the next install.
    // Batched to stay under the platform argument limit on a large catalogue.
    for (let index = 0; index < untracked.length; index += 200) {
      execFileSync('git', ['rm', '--cached', '--quiet', '--', ...untracked.slice(index, index + 200)], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    }
  } catch (error) {
    return { untracked: [], error: error instanceof Error ? error.message.split('\n')[0] ?? 'git rm failed' : 'git rm failed' };
  }
  return { untracked };
}

/**
 * Move observed state under `.void/machine/`, and take the managed block back
 * out of the project's `.gitignore` if an older install left one there.
 * Idempotent: a migrated project reports nothing moved and no block removed.
 * `dryRun` computes the same answer and writes nothing.
 */
export async function migrateVoidLayout(root: string, dryRun = false): Promise<VoidMigrationResult> {
  if (!existsSync(join(root, '.void'))) return EMPTY;

  const { movable, conflicts } = planVoidMigration(root);
  // The rules move in one motion. Stripping the block without writing the
  // exclude first would leave a window -- a crash, a full disk, an interrupt --
  // in which nothing at all covers the installed assets, and the next
  // `git clean` would take them. Write first, then remove.
  // Scoped to what the receipt owns, same as `init`. A migration that wrote an
  // unscoped block would hide the project's own agents until the next install.
  if (!dryRun) writeExcludeBlock(root, [...((await ownedDerivedPaths(root)) ?? [])]);

  // Never create the file: a project with no `.gitignore` has no block of ours
  // to remove, and writing an empty one would be a file it never asked for.
  const gitignorePath = join(root, '.gitignore');
  const original = existsSync(gitignorePath) ? await readFile(gitignorePath, 'utf8') : '';
  const stripped = stripManagedBlock(original);
  const gitignoreBlockRemoved = stripped !== original;

  // Everything pending moves, including what the destination already holds.
  // Leaving a half-migrated entry in place meant the drift never resolved:
  // readers fall back, so nothing pushed anyone to decide, and `update`
  // reprinted "merge or delete one" forever while supplying none of the facts
  // needed to decide. The target layout is the answer; the legacy path goes.
  const pending = [...movable, ...conflicts].sort();
  const failed: string[] = [];

  if (dryRun) return { moved: pending, conflicts: [], parked: [], gitignoreBlockRemoved };

  if (pending.length > 0) {
    await mkdir(voidMachineDir(root), { recursive: true });
    await mkdir(voidInstalledDir(root), { recursive: true });
  }
  const moved: string[] = [];
  const parked: string[] = [];
  for (const entry of pending) {
    try {
      // Both older layouts are sources: never migrated at all, or migrated once
      // to `local/` and not since.
      const sources = [legacyVoidPath(root, entry), previousMachinePath(root, entry)]
        .filter((source) => existsSync(source));

      if (ownershipOf(entry) === 'derived') {
        // Restorable content is DROPPED, not moved. `installed/` is filled by
        // the install that runs immediately after, and only by it — moving a
        // file there by hand hands the install a managed path it cannot prove
        // it wrote, which it then refuses to overwrite. Measured on a real
        // project: the layout pass succeeded, the install rolled the whole
        // update back, and the receipt turned out never to have owned the file
        // at its old path in the first place.
        for (const source of sources) await rm(source, { recursive: true, force: true });
        if (sources.length > 0) moved.push(entry);
        continue;
      }

      let touched = false;
      for (const source of sources) {
        if (await mergeInto(source, voidMachinePath(root, migratedName(entry)))) touched = true;
      }
      if (touched) parked.push(entry);
      moved.push(entry);
    } catch {
      // A move that cannot finish (permissions, a cross-device `.void`, a file
      // held open by a running session) is reported rather than aborting the
      // whole update: the old path still works, because every reader falls back.
      failed.push(entry);
    }
  }
  // Whatever is LEFT in the previous machine directory moves too, by name or
  // not. `local/` was a closed set on purpose — "a new runtime artifact is born
  // inside local/ and this file never has to learn about it" — so everything in
  // it is machine state regardless of what the table knows. Migrating only known
  // entries stranded the rest: found on this repo, where `.registered` stayed
  // behind and kept the directory alive.
  try {
    const previous = join(root, '.void', 'local');
    if (existsSync(previous)) {
      for (const entry of await readdir(previous)) {
        await mergeInto(join(previous, entry), voidMachinePath(root, entry));
      }
    }
  } catch {
    // Reported by the emptiness check below rather than failing the update.
  }

  // The emptied legacy directory goes too. Leaving it is not merely untidy: a
  // `local/` still on disk reads as "not migrated" to anyone looking, and the
  // whole point of this pass is that the old shape stops existing.
  try {
    const previous = join(root, '.void', 'local');
    if (existsSync(previous) && (await readdir(previous)).length === 0) {
      await rm(previous, { recursive: true, force: true });
    }
  } catch {
    // An empty directory that will not go is cosmetic; never fail the update for it.
  }

  if (gitignoreBlockRemoved) await writeFile(gitignorePath, stripped);

  return { moved, conflicts: failed.sort(), parked: parked.sort(), gitignoreBlockRemoved };
}
