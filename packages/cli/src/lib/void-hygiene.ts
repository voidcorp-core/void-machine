// Does this project actually keep observed state out of its history?
//
// The ignore block is a declaration, and a declaration is not a proof: a rule can
// be absent, overridden by a later rule, or simply powerless because the file was
// already tracked before the rule existed (git ignores nothing it already
// tracks). So `doctor` asks git rather than assuming, which is the same
// installed/wired/fired distinction the runtime checks already make.
//
// Pure. The caller observes with git; this judges.

import {
  judgeKeptTracked,
  type KeptTrackedObservation,
} from './kept-tracked-paths.js';
import { PRODUCT_COMMAND, PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import {
  judgeObservedIgnore,
  type ObservedPathObservation,
} from './observed-write-paths.js';
import type { CheckResult } from './prerequisites.js';

export interface ManifestObservation {
  /** Absent, unreadable, or the version it names. */
  readonly kind: 'absent' | 'unreadable' | 'present';
  readonly version?: string;
  /** Files whose bytes differ from the manifest, when it was verifiable. */
  readonly drifted?: number;
  /**
   * WHICH files differ, capped by the verification itself. A count alone sends
   * the reader to rehash the manifest by hand to find the one that moved, and
   * the verification already knows.
   */
  readonly driftedPaths?: readonly string[];
  /**
   * Co-owned files whose bytes differ. Counted apart from `drifted`: the project
   * is invited to write into these, so a difference is the file being used.
   */
  readonly coEdited?: number;
}

/**
 * What `.void/machine/receipts/install-v1.json` claims this machine wrote.
 *
 * The receipt and the install manifest record the same event, but only one of
 * them is tracked. The manifest is, so git can revert it; the receipt sits under
 * the ignored `.void/machine/` and cannot be reverted with the working tree.
 * That makes it the only witness left when the installed assets are rolled back
 * underneath the harness, which is why it is observed separately.
 */
export interface ReceiptObservation {
  /** Absent, unreadable, or the version it names. */
  readonly kind: 'absent' | 'unreadable' | 'present';
  readonly version?: string;
  /** Receipt-owned paths that are not on disk, sampled for the message. */
  readonly missing?: readonly string[];
  /** How many are missing in total; `missing` may carry only the first few. */
  readonly missingTotal?: number;
}

export interface LayoutObservation {
  /** Observed artifacts still sitting at the pre-split location. */
  readonly pending: readonly string[];
  /** Whether git ignores `.void/machine/`; null when it could not be asked. */
  readonly localIgnored: boolean | null;
  /**
   * Every path observed state can land in, present or not, ignored or not.
   *
   * `localIgnored` answers for the declared location only, and a project can be
   * clean there while a legacy bundle writes elsewhere. This carries the whole
   * surface so the verdict is about where state actually lands.
   */
  readonly observedPaths: readonly ObservedPathObservation[];
  /** Observed paths git currently tracks, which the ignore rule cannot undo. */
  readonly trackedObserved: readonly string[];
  /** What `.void/install-manifest.json` says about this project, if anything. */
  readonly manifest: ManifestObservation;
  /** What the local install receipt claims it wrote, if anything. */
  readonly receipt: ReceiptObservation;
  /**
   * Every path the block declares git must KEEP, proven one by one.
   *
   * The mirror of `localIgnored`, and the half that failed silently: a project
   * rule above the managed block wins over it, and a clone then arrives without
   * the enforcement floor the committed `.claude/settings.json` points at.
   */
  readonly keptTracked: readonly KeptTrackedObservation[];
  /** How many ignorable derived files git still tracks (regenerated content). */
  readonly trackedDerivedCount: number;
  /**
   * Assets that carry the harness's own frontmatter and that the manifest does
   * not own. A renamed skill preserved because it was edited by hand goes on
   * loading beside its replacement, and after the first update nothing says so.
   */
  readonly orphanedAssets: readonly string[];
}

function pass(name: string, message: string): CheckResult {
  return { name, ok: true, status: 'pass', message };
}

function fail(name: string, message: string, fix: string): CheckResult {
  return { name, ok: false, status: 'fail', message, fix };
}

function unknown(name: string, message: string, fix: string): CheckResult {
  return { name, ok: false, status: 'unknown', message, fix };
}

function layoutCheck(observation: LayoutObservation): CheckResult {
  const name = 'void layout';
  if (observation.pending.length === 0) return pass(name, 'observed state is under .void/machine/');
  return fail(
    name,
    `${observation.pending.length} observed path(s) still at the old location: ${observation.pending.join(', ')}`,
    `${PRODUCT_COMMAND} update — it moves them under .void/machine/ and never overwrites`,
  );
}

function ignoreCheck(observation: LayoutObservation): CheckResult {
  const name = 'void ignore';
  if (observation.localIgnored === null) {
    return unknown(name, 'not a git repository, so nothing ignores anything here', 'run this inside the repository the project ships from');
  }
  return observation.localIgnored
    ? pass(name, '.void/machine/ is ignored')
    : fail(
        name,
        '.void/machine/ is NOT ignored, so telemetry and run journals would be committed',
        `${PRODUCT_COMMAND} update — it writes the managed block; check no later rule re-includes .void/`,
      );
}

function trackedCheck(observation: LayoutObservation): CheckResult {
  const name = 'void tracked';
  if (observation.trackedObserved.length === 0) return pass(name, 'no observed state in the index');
  // Worth its own check: an ignore rule has no effect on an already-tracked file,
  // so this is the one failure the block cannot fix by itself.
  return fail(
    name,
    `git tracks ${observation.trackedObserved.length} observed path(s): ${observation.trackedObserved.join(', ')}`,
    `git rm --cached -r ${observation.trackedObserved.join(' ')} — the ignore rule cannot untrack what is already in the index`,
  );
}

/**
 * Advisory, not a failure: nothing is broken, the agent simply has two versions
 * of a doctrine and answers from whichever it loads first. It is also not ours
 * to delete, since the bytes were changed by hand, so the remedy belongs to the
 * person who changed them.
 */
function orphanCheck(observation: LayoutObservation): CheckResult {
  const name = 'void orphans';
  const orphans = observation.orphanedAssets;
  if (orphans.length === 0) {
    return { name, ok: true, message: 'no harness asset on disk that the manifest lost track of' };
  }
  return {
    name,
    ok: true,
    status: 'advisory',
    message:
      `${String(orphans.length)} harness asset(s) the manifest no longer owns still load: `
      + `${orphans.slice(0, 3).join(', ')}${orphans.length > 3 ? ', ...' : ''}`,
    fix: 'they were edited locally, so update kept them; delete them to stop loading two versions',
  };
}

function manifestCheck(observation: LayoutObservation): CheckResult {
  const name = 'void manifest';
  const manifest = observation.manifest;
  if (manifest.kind === 'absent') {
    // Not a failure: a project can run perfectly without ever recording what it
    // expects. It just cannot prove another checkout got the same bytes.
    return {
      name,
      ok: true,
      status: 'advisory',
      message: 'no install manifest — another checkout cannot prove it restored the same assets',
      fix: `${PRODUCT_COMMAND} init writes it; commit .void/install-manifest.json`,
    };
  }
  if (manifest.kind === 'unreadable') {
    return fail(name, 'the install manifest is present but not readable', `restore it from git, or re-run ${PRODUCT_COMMAND} init`);
  }
  // Drift is a real failure: the working tree claims a version it does not hold.
  if ((manifest.drifted ?? 0) > 0) {
    const paths = manifest.driftedPaths ?? [];
    const named = paths.length === 0 ? '' : `: ${paths.join(', ')}`;
    return fail(
      name,
      `${manifest.drifted} file(s) differ from manifest ${manifest.version ?? 'unknown'}${named}`,
      `npx ${PRODUCT_IDENTITY.packageFor(manifest.version ?? 'x.y.z')}@${manifest.version ?? 'x.y.z'} hydrate — it restores and proves every file`,
    );
  }
  // A co-owned file carrying project edits is not drift, and is not an advisory
  // either: writing a rule into `.void/PROJECT-DOCTRINE.md` is what the file is
  // for. It is still named, because "assets match manifest" alone would read as
  // byte-identical and send whoever compares hashes by hand looking for a bug.
  const coEdited = manifest.coEdited ?? 0;
  const version = manifest.version ?? 'unknown';
  return pass(
    name,
    coEdited === 0
      ? `assets match manifest ${version}`
      : `assets match manifest ${version}; ${String(coEdited)} co-owned file(s) carry project edits`,
  );
}

/**
 * Does the disk still hold what the install said it wrote?
 *
 * The manifest cannot answer this. It is tracked, so whatever reverts the assets
 * usually reverts the manifest with them, and the two then agree on a version
 * the project no longer runs. The receipt is not tracked, so it survives, and
 * the disagreement between the two is the only thing left that knows.
 */
function receiptCheck(observation: LayoutObservation): CheckResult {
  const name = 'void receipt';
  const receipt = observation.receipt;
  if (receipt.kind === 'absent') {
    // A marketplace install records nothing locally, and a project can run fine
    // without a receipt. It just cannot prove its assets are the ones installed.
    return {
      name,
      ok: true,
      status: 'advisory',
      message: 'no install receipt — nothing records which assets this machine wrote',
      fix: `${PRODUCT_COMMAND} update writes one; a marketplace install records none`,
    };
  }
  if (receipt.kind === 'unreadable') {
    return unknown(name, 'the install receipt is present but not readable', `${PRODUCT_COMMAND} update rewrites it`);
  }
  const version = receipt.version ?? 'unknown';
  const missingTotal = receipt.missingTotal ?? 0;
  const fix = `npx ${PRODUCT_IDENTITY.packageFor(version)}@${version} update — it rewrites every recorded asset`;
  if (missingTotal === 0) return pass(name, `every file receipt ${version} recorded is on disk`);
  const example = receipt.missing?.[0];
  const shown = example === undefined ? '' : `, for example ${example}`;
  const manifest = observation.manifest;
  // Only when the two records name different versions is "rolled back" a claim
  // rather than a guess: the receipt moved forward and the manifest did not, and
  // a tracked file cannot move backwards on its own.
  const rolledBack = manifest.kind === 'present'
    && manifest.version !== undefined
    && manifest.version !== version;
  if (rolledBack) {
    return fail(
      name,
      `receipt ${version} records ${String(missingTotal)} file(s) that are gone while the manifest says ${manifest.version ?? 'unknown'}`
      + `: the installed assets were rolled back after the update${shown}`,
      fix,
    );
  }
  return fail(name, `receipt ${version} records ${String(missingTotal)} file(s) that are not on disk${shown}`, fix);
}

function derivedCheck(observation: LayoutObservation): CheckResult {
  const name = 'void derived';
  if (observation.trackedDerivedCount === 0) return pass(name, 'no regenerated content in the index');
  // Advisory, not a failure: nothing is broken, and untracking rewrites the
  // project's index — that is the project's call, and it is offered as one
  // explicit command rather than done as a side effect of `update`.
  return {
    name,
    ok: true,
    status: 'advisory',
    message: `git tracks ${observation.trackedDerivedCount} file(s) that \`hydrate\` restores from the manifest`,
    fix: 'review the tracked generated paths, then use git rm --cached on only those paths (keeps files on disk); update never rewrites the index',
  };
}

/** Every layout-hygiene verdict, in the order a reader should meet them. */
/**
 * Skills the project wrote itself that git no longer sees.
 *
 * This used to be the mechanism: the block ignored `.claude/skills/*` wholesale,
 * every project skill fell under it, and this check told the project which line
 * to write by hand to get its own work back. That is not a guarantee -- it
 * assumes somebody runs doctor before the clone that drops the work.
 *
 * The block now hides the shipped skills by their `void-` prefix and leaves
 * everything else alone, so this became the net it should always have been. What
 * can still hide a project skill is a name: one whose own name opens with the
 * prefix reserved for shipped skills falls under the pattern. That is the likely
 * cause, so it is the one reported --
 * teaching the exception line again would be teaching a workaround for a name
 * collision. Anything else is a rule the project itself wrote, and git names it
 * more precisely than this check ever could.
 *
 * Advisory rather than a failure: an ignored skill still loads at runtime, so
 * nothing is broken today; what is at risk is the next clone.
 */
export function judgeProjectSkills(ignored: readonly string[]): CheckResult {
  const name = 'project skills';
  if (ignored.length === 0) return pass(name, 'no project skill hidden from git');
  const names = ignored.map((path) => path.split('/').pop() ?? path);
  const reserved = names.filter((skill) => skill.startsWith('void-'));
  const fix = reserved.length > 0
    ? `rename without the reserved void- prefix, which marks a shipped skill: ${reserved.join(', ')}`
    : `a project rule hides these; run git check-ignore -v ${ignored[0] ?? ''} to see which`;
  return {
    name,
    ok: false,
    status: 'advisory',
    message: `${ignored.length} project skill(s) hidden from git: ${names.join(', ')}`,
    fix,
  };
}

export function judgeLayout(observation: LayoutObservation): readonly CheckResult[] {
  return Object.freeze([
    layoutCheck(observation),
    ignoreCheck(observation),
    // Generalizes the check above from the one declared path to every path the
    // harness can write observed state to, legacy locations included.
    judgeObservedIgnore(observation.observedPaths),
    // The same question the other way round: a declaration that a path stays
    // TRACKED is no more a proof than one that a path is ignored.
    judgeKeptTracked(observation.keptTracked),
    orphanCheck(observation),
    trackedCheck(observation),
    manifestCheck(observation),
    // After the manifest, deliberately: when the assets were rolled back the
    // manifest reads green, and the reader needs the two lines side by side to
    // see that the green one is answering about the wrong version.
    receiptCheck(observation),
    derivedCheck(observation),
  ]);
}
