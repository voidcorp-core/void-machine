// `void-machine update` — bring a project's harness materializations to the
// current version without the heavier `init --force` (which rewrites everything).
//
// Local receipts recompile every selected runtime from the running CLI's
// bundled assets, then smoke + publish through the same transaction as init.
// Marketplace receipts keep the legacy cache/pin reconciliation below.
//
// Use case: after `/plugin marketplace update` inside Claude Code the runtime
// loads the new plugin version but the local pin is unchanged; and after a CLI
// upgrade a Codex project's staged floor scripts lag the shipped ones. This
// command reconciles both in one shot.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isHarnessSourceRepo } from '../lib/self-repo.js';
import { CODEX_HOOKS_DIR, refreshCodexFloor } from '../lib/codex-floor.js';
import { CODEX_SKILLS_DIR, wireCodexSkills } from '../lib/codex-skills.js';
import { readInstallManifest, sha256Of, INSTALL_MANIFEST_PATH } from '../lib/install-manifest.js';
import { computePinBumps } from '../lib/pack-config.js';
import { configPackDirs, CORE_PLUGIN_NAME, MARKETPLACE_NAME, MARKETPLACE_REPO } from '../lib/packs.js';
import { cliVersion, findCoreSource } from '../lib/paths.js';
import { fetchPinnedPluginVersion, fetchRemoteMarketplace } from '../lib/remote.js';
import { banner, blank, c, footer, glyph, line, meta, row, status } from '../lib/render.js';
import { voidGlobalDir } from '../lib/projects/catalog.js';
import { retireLegacyProjectRegistry } from '../lib/projects/legacy-registry.js';
import { readSettings, settingsPathFor } from '../lib/settings.js';
import { migrateVoidLayout, untrackDerived } from '../lib/void-migration.js';
import type { InstallManifest } from '../lib/install-manifest.js';
import {
  encodeReceipt,
  INSTALL_RECEIPT_PATH,
  type InstallReceipt,
  type OwnedFile,
  readInstallReceipt,
} from '../lib/receipts.js';
import type { Runtime } from '../lib/runtime.js';
import { init } from './init.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';


interface LocalConfig {
  core?: string;
  packs?: Record<string, string>;
  [k: string]: unknown;
}

interface UpdateOptions {
  readonly dryRun: boolean;
  readonly skipPins: boolean;
  readonly skipCache: boolean;
  /** Explicit opt-in: rewrite the index to drop regenerated content. Never implied. */
  readonly untrackDerived: boolean;
  /**
   * Overwrite a managed file the receipt cannot prove this install wrote. It is
   * what `init` tells the operator to do when it refuses one, so `update` has to
   * accept it — otherwise the printed remedy has no way of being applied.
   */
  readonly force: boolean;
}

function parseArgs(args: readonly string[]): UpdateOptions {
  return {
    dryRun: args.includes('--dry-run'),
    skipPins: args.includes('--cache-only'),
    skipCache: args.includes('--pins-only'),
    untrackDerived: args.includes('--untrack-derived'),
    force: args.includes('--force'),
  };
}

export async function update(args: readonly string[]): Promise<void> {
  const opts = parseArgs(args);
  const projectRoot = process.cwd();
  const legacyRegistryNotice = await retireLegacyRegistry(opts.dryRun);
  // Layout first, and on every install source: this is not a marketplace concern.
  // It also runs before the receipt is read, since the receipt itself is observed
  // state and moves with the rest.
  await reportVoidMigration(projectRoot, opts.dryRun);
  if (opts.untrackDerived) await reportUntrackDerived(projectRoot, opts.dryRun);
  const receipt = await readInstallReceipt(projectRoot);
  const route = updateRouteFor(receipt, existsSync(join(projectRoot, INSTALL_MANIFEST_PATH)));
  if (route === 'local-rehydrate') {
    const rehydrated = rehydrateFromManifest(projectRoot);
    if (rehydrated === undefined) {
      banner('update');
      blank();
      line(c.red(`${INSTALL_MANIFEST_PATH} is not a readable manifest, so ownership cannot be reclaimed.`));
      line(c.dim(`Restore it from git, or re-run ${PRODUCT_COMMAND} init to rewrite it.`));
      blank();
      footer(c.red('nothing was changed'));
      process.exit(1);
    }
    // Written to disk, because the install transaction reads the receipt from
    // there rather than taking one in hand. It is machine-local and disposable,
    // exactly what `hydrate` restores.
    if (!opts.dryRun) await writeReceipt(projectRoot, rehydrated);
    // Said once, quietly: it is a repair, not a decision the operator has to make.
    // Stopping here to ask for `hydrate` then `update --force` turned the common
    // case -- a fresh clone, which never carries a machine-local receipt -- into
    // two commands and a scary flag.
    await updateLocal(
      projectRoot,
      rehydrated,
      opts.dryRun,
      opts.force,
      `absent; ownership reclaimed from ${INSTALL_MANIFEST_PATH} (${String(rehydrated.files.length)} files)`,
      legacyRegistryNotice,
    );
    return;
  }
  if (route === 'local' && receipt !== undefined) {
    const reclaimed = reclaimMissingPaths(projectRoot, receipt);
    // A receipt amputated by an earlier install is repaired, not raised: the
    // operator has no decision to make about it.
    const regained = reclaimed.files.length - receipt.files.length;
    if (regained > 0 && !opts.dryRun) await writeReceipt(projectRoot, reclaimed);
    await updateLocal(
      projectRoot,
      reclaimed,
      opts.dryRun,
      opts.force,
      regained > 0
        ? `incomplete; ${String(regained)} path(s) reclaimed from ${INSTALL_MANIFEST_PATH}`
        : undefined,
      legacyRegistryNotice,
    );
    return;
  }

  banner('update');
  renderLegacyRegistryNotice(legacyRegistryNotice);

  const repo = await resolveMarketplaceRepo(projectRoot);
  meta('marketplace', repo);

  const remote = fetchRemoteMarketplace(repo);
  if (!remote.ok) {
    blank();
    status(`could not fetch marketplace: ${remote.error}`, 'err');
    process.exit(1);
  }
  const core = remote.value.plugins.find((p) => p.name === CORE_PLUGIN_NAME);
  const headFetch = core ? fetchPinnedPluginVersion(core, repo) : undefined;
  if (!headFetch?.ok) {
    blank();
    status(`could not resolve the pinned ${CORE_PLUGIN_NAME} version: ${headFetch?.error ?? 'entry missing from catalog'}`, 'err');
    process.exit(1);
  }
  const head = headFetch.value;
  meta('remote', head);
  blank();

  let pinsTouched = 0;
  let cacheRefreshed: 'fresh' | 'pulled' | 'missing' | 'skipped' | 'failed' = 'skipped';

  // Step 1: refresh Claude Code's marketplace cache (git pull).
  if (!opts.skipCache) {
    cacheRefreshed = refreshMarketplaceCache(opts.dryRun);
  }

  // Step 2: bump .void/config.json pins.
  if (!opts.skipPins) {
    pinsTouched = await bumpPins(projectRoot, head, opts.dryRun);
  }

  // Step 3: re-stage the Codex safety floor to the running CLI's version. The
  // floor scripts ship inside this CLI, so `update` is where a Codex project
  // catches version drift (the marketplace cache/pins above are Claude-only).
  const floorApplied = await refreshCodexFloorStep(projectRoot, opts.dryRun);

  // Step 4: mark the tree. The receipt is machine-local and younger than some
  // marketplace installs, and this route was the one that never wrote it: the
  // local routes rebuild it from the manifest, and a marketplace install has
  // no manifest. An unmarked tree costs nothing in the main checkout; in a
  // linked worktree that is itself the install, every reader of the
  // installation prefers the main checkout, which holds nothing (DEV-740). The
  // receipt claims no file, because nothing here proves which bytes this
  // machine wrote; it records the channel, the runtimes and the version the
  // pins now name, which is what `doctor` and `check` read from it.
  const receiptWritten = receipt === undefined && !opts.dryRun;
  if (receipt === undefined) {
    if (receiptWritten) await writeReceipt(projectRoot, marketplaceReceipt(head, projectRoot));
    line(`${c.green(glyph.check)}  ${c.dim('receipt'.padEnd(12))}${receiptWritten ? 'written' : 'will be written'} ${c.dim(glyph.to)} ${INSTALL_RECEIPT_PATH}`);
  }

  blank();
  if (opts.dryRun) {
    footer(c.dim(`dry-run ${glyph.emdash} no changes written. Drop --dry-run to apply.`));
    return;
  }
  if (
    pinsTouched === 0 &&
    (cacheRefreshed === 'fresh' || cacheRefreshed === 'skipped') &&
    !floorApplied &&
    !receiptWritten
  ) {
    footer(c.dim(`already at ^${head} ${glyph.emdash} nothing to update`));
    return;
  }
  const parts: string[] = [];
  if (pinsTouched > 0) parts.push(c.green(`${pinsTouched} pin${pinsTouched > 1 ? 's' : ''} bumped`));
  if (receiptWritten) parts.push(c.green('receipt written'));
  if (cacheRefreshed === 'pulled') parts.push(c.green('cache refreshed'));
  if (cacheRefreshed === 'fresh') parts.push(c.dim('cache already fresh'));
  if (cacheRefreshed === 'missing') parts.push(c.dim('cache not present (Claude Code never ran the plugin here?)'));
  if (cacheRefreshed === 'failed') parts.push(c.yellow('cache pull failed (manual `/plugin marketplace update` in Claude)'));
  if (floorApplied) parts.push(c.green('codex floor refreshed'));

  const claudeTouched = pinsTouched > 0 || cacheRefreshed === 'pulled';
  const tail = claudeTouched ? ` ${glyph.emdash} ${c.bold('restart Claude Code to load the new version')}` : '';
  footer(`${parts.join(' + ')}${tail}`);
}

export function updateModeFor(receipt: InstallReceipt | undefined): InstallReceipt['source'] {
  return receipt?.source ?? 'marketplace';
}

/** Where an update should go, and the one case where it must not go anywhere. */
export type UpdateRoute = InstallReceipt['source'] | 'local-rehydrate';

/**
 * The receipt says what the harness owns, and it is observed state: gitignored,
 * and therefore absent from every clone. Routing on it alone sent a colleague's
 * fresh checkout down the marketplace branch, where `update` pulled a plugin
 * cache, bumped the pins, materialised nothing, and reported success.
 *
 * The install manifest is the committed half of the same fact. When it is there
 * and the receipt is not, the project is a local install that cannot be updated
 * yet: the ownership diff that removes a renamed skill has no input, so guessing
 * would either duplicate the doctrine or delete a file we do not own. Saying so
 * is the whole fix.
 */
export function updateRouteFor(
  receipt: InstallReceipt | undefined,
  hasInstallManifest: boolean,
): UpdateRoute {
  if (receipt !== undefined) return receipt.source;
  return hasInstallManifest ? 'local-rehydrate' : 'marketplace';
}

/**
 * The receipt of a marketplace install that never had one. It owns no file:
 * the plugin's assets live in Claude Code's cache, and the files this route
 * touches in the project were written by a version that recorded nothing, so
 * claiming them would turn "content we cannot account for" into "content we
 * wrote" -- the same guess `ownedFromManifestPaths` refuses.
 */
function marketplaceReceipt(version: string, projectRoot: string): InstallReceipt {
  return {
    schemaVersion: 1,
    version,
    source: 'marketplace',
    runtimes: wiredRuntimes(projectRoot),
    files: [],
  };
}

/** Persist the machine-local receipt the install transaction reads back. */
async function writeReceipt(projectRoot: string, receipt: InstallReceipt): Promise<void> {
  const receiptPath = join(projectRoot, ...INSTALL_RECEIPT_PATH.split('/'));
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, encodeReceipt(receipt));
}

/** What the harness claims, and the bytes the manifest attests for each. */
export interface ClaimedFile {
  readonly path: string;
  /** `undefined` when the manifest cannot attest this path -- see `claimedFiles`. */
  readonly sha256: string | undefined;
}

/** Every path the manifest claims, itself included. */
function claimedFiles(manifest: InstallManifest): readonly ClaimedFile[] {
  return [
    // The manifest is never listed inside itself -- a file cannot carry its own
    // hash -- yet it is the harness's by construction. Left out, it conflicts on
    // every update, since a new version always rewrites it. Nothing attests it,
    // and nothing has to.
    { path: INSTALL_MANIFEST_PATH, sha256: undefined },
    ...manifest.files,
  ];
}

/** What a path holds right now, or nothing when the disk no longer has it. */
function diskProbe(projectRoot: string) {
  return (path: string): { readonly sha256: string; readonly mode: number } | undefined => {
    try {
      const target = join(projectRoot, ...path.split('/'));
      return { sha256: sha256Of(readFileSync(target)), mode: statSync(target).mode & 0o777 };
    } catch {
      return undefined;
    }
  };
}

function wiredRuntimes(projectRoot: string): Runtime[] {
  // Read from what is actually wired, not from the manifest, which does not
  // record them.
  const runtimes: Runtime[] = [];
  if (existsSync(join(projectRoot, '.claude', 'settings.json'))) runtimes.push('claude');
  if (existsSync(join(projectRoot, '.codex', 'hooks.json'))) runtimes.push('codex');
  return runtimes.length > 0 ? runtimes : ['claude'];
}

/**
 * The receipt this project would have had, rebuilt from its committed manifest.
 *
 * The receipt is machine-local, so EVERY fresh clone arrives without one, and
 * the command used to stop there with two commands to type, one of them
 * `--force`. The manifest is the committed half of the same fact: it names the
 * paths the harness owns, which is the only thing an update needs from it.
 *
 * The content comes from disk, never from the manifest's hashes -- those
 * describe the version that wrote them, and comparing against them would fail
 * on every file the new version changes, which is the conflict this removes. A
 * path the manifest names and the disk no longer has is simply dropped: it was
 * ours, it is gone, and the install about to run decides whether it comes back.
 *
 * `undefined` when the manifest cannot be read: that is a real dead end, and
 * inventing ownership from a directory listing is exactly the guess this whole
 * mechanism exists to avoid.
 */
function rehydrateFromManifest(projectRoot: string): InstallReceipt | undefined {
  const manifest = readInstallManifest(projectRoot);
  if (manifest === undefined) return undefined;
  return {
    schemaVersion: 1,
    version: manifest.version,
    source: 'local',
    runtimes: wiredRuntimes(projectRoot),
    files: ownedFromManifestPaths(claimedFiles(manifest), diskProbe(projectRoot)),
  };
}

/**
 * The receipt, extended with any path the committed manifest names and it does
 * not cover. Returns the receipt unchanged when nothing was missing, so the
 * caller can stay quiet on the nominal case.
 */
function reclaimMissingPaths(projectRoot: string, receipt: InstallReceipt): InstallReceipt {
  const manifest = readInstallManifest(projectRoot);
  // An unreadable manifest is not a dead end here: the receipt still proves
  // everything it covers, and stopping would refuse an update that can proceed.
  if (manifest === undefined) return receipt;
  const files = completeOwnership(receipt.files, claimedFiles(manifest), diskProbe(projectRoot));
  return files.length === receipt.files.length ? receipt : { ...receipt, files };
}

/**
 * Ownership as the union of the two proofs the project carries.
 *
 * The receipt records what this machine wrote and is machine-local; the
 * committed manifest names the paths this version owns and travels with the
 * repository. Treating them as alternatives -- receipt, else manifest -- left
 * the state a real consumer actually reaches unhandled: a receipt that is
 * present but covers 17 of 97 paths, every dropped one becoming an asset the
 * next update refuses to touch.
 *
 * The receipt wins on any path both name. Its hashes say what was written here,
 * which is what tells a hand-edited file from an untouched one; the manifest
 * only ever proves that a path is the harness's.
 */
export function completeOwnership(
  owned: readonly OwnedFile[],
  claimed: readonly ClaimedFile[],
  onDisk: (path: string) => { readonly sha256: string; readonly mode: number } | undefined,
): OwnedFile[] {
  const covered = new Set(owned.map((file) => file.path));
  return [
    ...owned,
    ...ownedFromManifestPaths(claimed.filter((file) => !covered.has(file.path)), onDisk),
  ];
}

export function ownedFromManifestPaths(
  claimed: readonly ClaimedFile[],
  onDisk: (path: string) => { readonly sha256: string; readonly mode: number } | undefined,
): OwnedFile[] {
  const owned: OwnedFile[] = [];
  for (const file of claimed) {
    const found = onDisk(file.path);
    // Gone from disk: it was ours, it is gone, and the install about to run
    // decides whether it comes back.
    if (found === undefined) continue;
    // Present, but holding something the manifest does not attest. The manifest
    // proves a PATH is ours; it never proves the bytes sitting there today are.
    // Claiming them anyway turned "content we cannot account for" into "content
    // we wrote", and the install then overwrote a project's own edit instead of
    // refusing it -- measured on a real project, 2026-08-20.
    if (file.sha256 !== undefined && found.sha256 !== file.sha256) continue;
    owned.push({ path: file.path, sha256: found.sha256, mode: found.mode });
  }
  return owned;
}

/**
 * Move observed state under `.void/machine/` and install the managed ignore block,
 * reporting what moved. Silent on a project that is already migrated, so a
 * routine update does not grow a paragraph about a one-time change.
 */
async function reportVoidMigration(projectRoot: string, dryRun: boolean): Promise<void> {
  const result = await migrateVoidLayout(projectRoot, dryRun);
  if (result.moved.length === 0 && result.conflicts.length === 0 && !result.gitignoreBlockRemoved) return;

  const verb = dryRun ? 'would move' : 'moved';
  if (result.moved.length > 0) {
    line(`${c.green(glyph.check)}  ${c.dim('layout'.padEnd(12))}${verb} ${result.moved.length} path(s) ${c.dim(glyph.to)} .void/machine/ (${result.moved.join(', ')})`);
    if (!dryRun) {
      // Anything that was committed now shows as a deletion. Saying so is the
      // difference between a clean commit and a confusing `git status`.
      line(`${c.dim(' '.repeat(4))}${c.dim('git may show these as deletions — commit them; the new path is ignored')}`);
    }
  }
  if (result.gitignoreBlockRemoved) {
    line(`${c.green(glyph.check)}  ${c.dim('gitignore'.padEnd(12))}${dryRun ? 'would move' : 'moved'} the managed block to .git/info/exclude, where no checkout can revert it`);
  }
  // Say it when git will notice. Moving a TRACKED file shows up as a deletion
  // plus an untracked one, and finding nine staged deletions you did not ask for
  // is alarming even when every one of them is correct. Announced at the moment
  // it happens, it reads as the migration it is.
  if (!dryRun && result.moved.length > 0) {
    const trackedMoved = countTrackedUnder(projectRoot, result.moved);
    if (trackedMoved > 0) {
      line(
        `${c.dim(glyph.dot)}  ${c.dim('layout'.padEnd(12))}${c.dim(`${String(trackedMoved)} of them were tracked, so git now shows deletions at the old paths — review and commit`)}`,
      );
    }
  }

  // A parked copy is reported, not asked about: the merge already happened and
  // nothing was lost. Telling the operator where the old bytes went is enough.
  for (const entry of result.parked) {
    line(`${c.dim(glyph.dot)}  ${c.dim('layout'.padEnd(12))}${c.dim(`.void/${entry} merged; the previous copy is kept beside it as *.legacy`)}`);
  }
  // What is left here could not be moved at all — a permission, a lock, a
  // cross-device .void. The old path still works because readers fall back.
  for (const entry of result.conflicts) {
    line(`${c.yellow(glyph.up)}  ${c.dim('layout'.padEnd(12))}${c.yellow('could not move')}: .void/${entry} — check permissions and re-run; readers still fall back`);
  }
}

/**
 * Report the explicit untrack. Only ever reached behind `--untrack-derived`:
 * the files stay on disk, the index forgets them, and the project commits the
 * result — which is why this is offered rather than done.
 */
async function reportUntrackDerived(projectRoot: string, dryRun: boolean): Promise<void> {
  const result = await untrackDerived(projectRoot, dryRun);
  if (result.error !== undefined) {
    line(`${c.yellow(glyph.up)}  ${c.dim('untrack'.padEnd(12))}${c.yellow('skipped')}: ${result.error}`);
    return;
  }
  if (result.untracked.length === 0) {
    line(`${c.dim(glyph.dot)}  ${c.dim('untrack'.padEnd(12))}${c.dim('no regenerated content in the index')}`);
    return;
  }
  const verb = dryRun ? 'would drop' : 'dropped';
  line(`${c.green(glyph.check)}  ${c.dim('untrack'.padEnd(12))}${verb} ${result.untracked.length} regenerated file(s) from the index (kept on disk)`);
  if (!dryRun) {
    line(`${c.dim(' '.repeat(4))}${c.dim(`review and commit the staged deletions; \`${PRODUCT_COMMAND} install\` regenerates them anywhere`)}`);
  }
}

/**
 * The argv `update` hands to `init`.
 *
 * `--force` is forwarded rather than dropped. Reported from a real consumer
 * project: `init` refuses to overwrite a managed file it cannot prove it wrote
 * and prints "preserve it or re-run with --force", but `update` never parsed
 * the flag nor passed it on — so the remedy the tool printed could not be
 * applied through the command that printed it, and the operator was left with
 * an instruction that does nothing. An impossible instruction is worse than
 * none, because it costs the reader their trust in every other message.
 */
export function localInitArgs(
  receipt: InstallReceipt,
  packs: readonly string[],
  options: { readonly force: boolean; readonly preserveDoctrine?: boolean },
): string[] {
  const args = [
    '--no-interactive',
    '--replace-packs',
    '--runtime',
    receipt.runtimes.join(','),
  ];
  for (const pack of packs) args.push('--pack', pack);
  if (options.force) args.push('--force');
  // The source repo owns its doctrine rather than deriving it, so recompiling
  // everything else and leaving those files alone is the whole update there.
  // Refusing outright would end a routine command on an error after it had
  // already done half its work.
  if (options.preserveDoctrine === true) args.push('--preserve-doctrine');
  return args;
}

/**
 * How many of the moved entries git was tracking at their old location. Best
 * effort: not a repository, or git unusable, simply answers zero.
 */
function countTrackedUnder(projectRoot: string, moved: readonly string[]): number {
  try {
    const listed = execFileSync('git', ['ls-files', '--', '.void'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tracked = listed.split(/\r?\n/).filter((path) => path.trim() !== '');
    return tracked.filter((path) =>
      moved.some((entry) => path === `.void/${entry}` || path.startsWith(`.void/${entry}/`)),
    ).length;
  } catch {
    return 0;
  }
}

async function updateLocal(
  projectRoot: string,
  receipt: InstallReceipt,
  dryRun: boolean,
  force: boolean,
  /** Ownership repair to report under the banner, when one happened. */
  ownershipNotice?: string,
  legacyRegistryNotice?: LegacyRegistryNotice,
): Promise<void> {
  let packs: string[] = [];
  try {
    const config = JSON.parse(await readFile(join(projectRoot, '.void', 'config.json'), 'utf8')) as {
      packs?: Record<string, string>;
    };
    packs = Object.keys(config.packs ?? {}).map((key) => key.replace(/^@voidcorp\//, ''));
  } catch {
    // init will surface the invalid/missing config and rebuild only when safe.
  }
  banner('update');
  renderLegacyRegistryNotice(legacyRegistryNotice);
  // Under the banner rather than before it: printed first, it opened a second
  // `update` header above the real one.
  if (ownershipNotice !== undefined) {
    line(`${c.dim(glyph.dot)}  ${c.dim('receipt'.padEnd(12))}${ownershipNotice}`);
  }
  meta('source', 'bundled local package');
  meta('installed', receipt.version);
  meta('available', cliVersion());
  if (dryRun) {
    blank();
    footer(c.dim('dry-run — local assets would be recompiled, smoked and reconciled transactionally'));
    return;
  }
  await init(localInitArgs(receipt, packs, { force, preserveDoctrine: isHarnessSourceRepo(projectRoot) }));
}

interface LegacyRegistryNotice {
  readonly kind: 'retired' | 'skipped';
  readonly message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function retireLegacyRegistry(dryRun: boolean): Promise<LegacyRegistryNotice | undefined> {
  try {
    const result = await retireLegacyProjectRegistry({
      globalDir: voidGlobalDir(),
      limit: 10_000,
      dryRun,
    });
    if (result.found === 0) return undefined;
    if (dryRun) {
      return {
        kind: 'retired',
        message: `would retire ${String(result.found)} obsolete project pointer(s)`,
      };
    }
    const suffix = result.remaining === 0
      ? ''
      : `; ${String(result.remaining)} remain, re-run update`;
    return {
      kind: 'retired',
      message: `retired ${String(result.removed)} obsolete project pointer(s)${suffix}`,
    };
  } catch (error) {
    return {
      kind: 'skipped',
      message: `legacy project registry left untouched: ${errorMessage(error)}`,
    };
  }
}

function renderLegacyRegistryNotice(notice: LegacyRegistryNotice | undefined): void {
  if (notice === undefined) return;
  const mark = notice.kind === 'retired' ? c.green(glyph.check) : c.yellow(glyph.up);
  line(`${mark}  ${c.dim('registry'.padEnd(12))}${notice.message}`);
}

/**
 * Print the Codex-floor refresh step and report whether files were actually
 * re-staged (true only on a real, non-dry-run refresh). Thin I/O glue over the
 * tested `refreshCodexFloor`: it owns the "is Codex even wired" + "can we locate
 * the source" guards, so `update` never breaks on a Codex-less project or an
 * unlocatable harness source.
 */
async function refreshCodexFloorStep(projectRoot: string, dryRun: boolean): Promise<boolean> {
  if (!existsSync(join(projectRoot, '.codex'))) return false;

  let sourceRoot: string;
  try {
    sourceRoot = await findCoreSource();
  } catch {
    line(`${c.yellow(glyph.up)}  ${c.dim('codex floor'.padEnd(12))}${c.yellow('skipped')}: could not locate the harness source`);
    return false;
  }

  // Skills re-stage alongside the floor: an idempotent overwrite to the running
  // CLI's version, so `update` keeps a Codex project's .agents/skills current —
  // core plus whatever packs the config activated.
  if (!dryRun) {
    let packDirs: string[] = [];
    try {
      const cfg = JSON.parse(await readFile(join(projectRoot, '.void', 'config.json'), 'utf8'));
      packDirs = configPackDirs(cfg);
    } catch {
      // no/unreadable config -> core skills only
    }
    const n = await wireCodexSkills(projectRoot, sourceRoot, packDirs);
    line(`${c.green(glyph.check)}  ${c.dim('codex skills'.padEnd(12))}${n} skill(s) staged → ${CODEX_SKILLS_DIR}/`);
  }

  const result = await refreshCodexFloor(projectRoot, sourceRoot, dryRun);
  const drift = result.drift.join(', ');
  if (result.status === 'fresh') {
    line(`${c.green(glyph.check)}  ${c.dim('codex floor'.padEnd(12))}already at CLI version`);
    return false;
  }
  if (result.status === 'would-refresh') {
    line(`${c.yellow(glyph.up)}  ${c.dim('codex floor'.padEnd(12))}${drift} ${c.yellow('will re-stage')}`);
    return false;
  }
  line(`${c.green(glyph.check)}  ${c.dim('codex floor'.padEnd(12))}re-staged (${drift}) → ${CODEX_HOOKS_DIR}/`);
  return true;
}

function refreshMarketplaceCache(dryRun: boolean): 'fresh' | 'pulled' | 'missing' | 'failed' {
  const cacheDir = join(homedir(), '.claude', 'plugins', 'marketplaces', MARKETPLACE_NAME);
  if (!existsSync(cacheDir)) {
    line(`${c.dim(glyph.dot)}  ${c.dim('cache'.padEnd(12))}not present at ~/.claude/plugins/marketplaces/${MARKETPLACE_NAME}`);
    return 'missing';
  }

  // Compare local HEAD with remote HEAD via git rev-list cheaply.
  try {
    const before = execFileSync('git', ['-C', cacheDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (dryRun) {
      // Just fetch to see if there are upstream commits, don't pull.
      execFileSync('git', ['-C', cacheDir, 'fetch', '--quiet'], { stdio: 'pipe' });
      const remoteHead = execFileSync('git', ['-C', cacheDir, 'rev-parse', '@{u}'], { encoding: 'utf8' }).trim();
      if (before === remoteHead) {
        line(`${c.green(glyph.check)}  ${c.dim('cache'.padEnd(12))}already at ${before.slice(0, 7)}`);
        return 'fresh';
      }
      line(`${c.yellow(glyph.up)}  ${c.dim('cache'.padEnd(12))}${before.slice(0, 7)} ${c.dim(glyph.to)} ${remoteHead.slice(0, 7)} ${c.yellow('will pull')}`);
      return 'pulled';
    }
    // Fast-forward only pull — refuse to merge or rebase unexpected local commits.
    execFileSync('git', ['-C', cacheDir, 'pull', '--ff-only', '--quiet'], { stdio: 'pipe' });
    const after = execFileSync('git', ['-C', cacheDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (before === after) {
      line(`${c.green(glyph.check)}  ${c.dim('cache'.padEnd(12))}already at ${after.slice(0, 7)}`);
      return 'fresh';
    }
    line(`${c.green(glyph.check)}  ${c.dim('cache'.padEnd(12))}${before.slice(0, 7)} ${c.dim(glyph.to)} ${after.slice(0, 7)} ${c.green('pulled')}`);
    return 'pulled';
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8');
    line(`${c.yellow(glyph.up)}  ${c.dim('cache'.padEnd(12))}${c.yellow('pull failed')}: ${(stderr ?? e.message ?? '').trim().split('\n')[0]}`);
    return 'failed';
  }
}

async function bumpPins(projectRoot: string, head: string, dryRun: boolean): Promise<number> {
  const configPath = join(projectRoot, '.void', 'config.json');
  if (!existsSync(configPath)) {
    line(`${c.dim(glyph.dot)}  ${c.dim('pins'.padEnd(12))}no .void/config.json (run \`${PRODUCT_COMMAND} init\` first)`);
    return 0;
  }

  let config: LocalConfig;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    line(`${c.yellow(glyph.up)}  ${c.dim('pins'.padEnd(12))}invalid .void/config.json: ${msg}`);
    return 0;
  }

  // Pure core: which pins move to `head` + the next config. The fs write,
  // rendering, and dry-run are the shell around it.
  const { changes, next } = computePinBumps(config, head);

  if (changes.length === 0) {
    line(`${c.green(glyph.check)}  ${c.dim('pins'.padEnd(12))}already at ^${head}`);
    return 0;
  }

  for (const ch of changes) {
    row({
      mark: 'warn',
      label: ch.name,
      versions: [ch.from, ch.to],
      suffix: dryRun ? c.yellow('will update') : c.green('updated'),
    });
  }

  if (dryRun) return changes.length;

  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return changes.length;
}

async function resolveMarketplaceRepo(projectRoot: string): Promise<string> {
  const settings = await readSettings(settingsPathFor(projectRoot));
  const entry = (settings.extraKnownMarketplaces as Record<string, unknown> | undefined)?.[MARKETPLACE_NAME];
  if (entry && typeof entry === 'object') {
    const source = (entry as { source?: { repo?: string } }).source;
    if (source?.repo) return source.repo;
  }
  return MARKETPLACE_REPO;
}
