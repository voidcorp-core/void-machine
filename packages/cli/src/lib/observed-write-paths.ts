// Is every path the harness WRITES observed state to actually ignored by git?
//
// The neighbouring `void ignore` check asks one question — is `.void/machine/`
// ignored — and a project can answer yes while leaking, because the harness does
// not only write there. The published hook bundle a project still runs writes to
// `.void/outputs/` on every session, and that path was matched by no rule at all:
// a session log sat untracked in this very repo until a `git add .` nearly
// committed it, in a repository that had already committed 2.4 MB of images that
// way. Checking the DECLARED path proves nothing about the ones a shipped bundle
// still uses.
//
// So the candidate list is derived from the layout truth table rather than from
// the ignore block: every observed entry of `VOID_OWNERSHIP`, at the top of
// `.void/` where the older bundles put it, plus the two directory names the
// split introduced. A project on a current harness has none of them on disk and
// hears nothing; a project running an older bundle hears about the exact path
// that bundle writes to.
//
// Two properties this must never lose:
//
//   - a path absent from disk is never reported, or the check fires in every
//     project at once and becomes a report nobody reads;
//   - a path the project is SUPPOSED to commit is never reported, because
//     ignoring `.void/hooks/` or `.codex/hooks.json` breaks every fresh clone.
//
// Observed writes are diagnostic evidence, never an automatic repair: moving
// project state requires ownership and a deliberate migration.
// Pure. The caller asks git and stats the disk; this decides what that means.

import {
  DERIVED_LOAD_BEARING,
  MACHINE_ENTRIES,
  PRODUCT_COMMAND,
  VOID_DIR,
  VOID_MACHINE_DIR,
  VOID_PREVIOUS_MACHINE_DIR,
} from '@voidcorp/hook-runner';
import type { CheckResult } from './prerequisites.js';

/**
 * The sentinel appended to a candidate before handing it to `git check-ignore`.
 *
 * Deliberately not a plausible project pattern. The probe only proves anything
 * if no rule of the project happens to match the sentinel itself: a project
 * ignoring `*.probe` would make every candidate answer "ignored", which is the
 * one failure mode this whole check exists to prevent.
 */
const IGNORE_PROBE = '.void-probe';

export interface ObservedWriteCandidate {
  /** Project-relative, slash-separated, no trailing slash. */
  readonly path: string;
  /** What to hand `git check-ignore`, which is never the bare path. */
  readonly probe: string;
}

/**
 * Paths that stay TRACKED whatever else is true, so no verdict here may call
 * them a defect. `.void/` itself carries the declared half (`config.json` and
 * the doctrine), and `DERIVED_LOAD_BEARING` carries what a fresh clone cannot
 * start without.
 */
export function isDeliberatelyTracked(path: string): boolean {
  const target = bare(path);
  if (target === VOID_DIR) return true;
  return DERIVED_LOAD_BEARING.some((kept) => target === bare(kept) || target.startsWith(`${bare(kept)}/`));
}

function bare(path: string): string {
  return path.split('\\').join('/').replace(/\/+$/, '');
}

/**
 * Every path observed state can land in, current layout and legacy alike.
 *
 * The probe is the path plus a sentinel child, never the path itself. Measured
 * against git: with the rule `x/`, `git check-ignore x` answers "not ignored"
 * whenever `x` is absent from disk, while `x/<child>` answers "ignored" in both
 * cases. Probing the bare name would report a correct rule as a leak.
 */
export function observedWriteCandidates(): readonly ObservedWriteCandidate[] {
  const paths = new Set<string>([
    `${VOID_DIR}/${VOID_MACHINE_DIR}`,
    `${VOID_DIR}/${VOID_PREVIOUS_MACHINE_DIR}`,
    ...MACHINE_ENTRIES.map((entry) => `${VOID_DIR}/${entry}`),
  ]);
  return Object.freeze(
    [...paths]
      .filter((path) => !isDeliberatelyTracked(path))
      .sort()
      .map((path) => ({ path, probe: `${path}/${IGNORE_PROBE}` })),
  );
}

export interface ObservedPathObservation {
  /** The candidate path, as `observedWriteCandidates` names it. */
  readonly path: string;
  /** Whether it exists in this project. An absent path is never reported. */
  readonly present: boolean;
  /** Whether git ignores it. `undefined` when git could not be asked at all. */
  readonly ignored: boolean | undefined;
}

const CHECK_NAME = 'void observed';

const FIX =
  `${PRODUCT_COMMAND} update — it moves observed state under .void/machine/, which the managed `
  + 'block ignores; a path that must stay where it is needs its own .gitignore line';

/**
 * The verdict on where observed state can leak from.
 *
 * A measured leak outranks an unmeasured path: one path git refused to answer
 * for does not soften a leak git did answer for. And a path nobody could measure
 * is `unknown`, never `fail` — a fact this run could not read is not a defect of
 * the project.
 */
export function judgeObservedIgnore(observations: readonly ObservedPathObservation[]): CheckResult {
  const reportable = observations.filter(
    (observation) => observation.present && !isDeliberatelyTracked(observation.path),
  );
  const leaking = reportable
    .filter((observation) => observation.ignored === false)
    .map((observation) => observation.path)
    .sort();
  if (leaking.length > 0) {
    return {
      name: CHECK_NAME,
      ok: false,
      status: 'fail',
      message:
        `git does NOT ignore ${String(leaking.length)} path(s) the harness writes observed state to: `
        + `${leaking.join(', ')} — the next \`git add .\` would commit a session log`,
      fix: FIX,
    };
  }

  const unmeasured = reportable
    .filter((observation) => observation.ignored === undefined)
    .map((observation) => observation.path)
    .sort();
  if (unmeasured.length > 0) {
    return {
      name: CHECK_NAME,
      ok: false,
      status: 'unknown',
      message: `could not ask git about ${unmeasured.join(', ')}, so nothing here is proven either way`,
      fix: 'run this inside the repository the project ships from, with git on the PATH',
    };
  }

  return {
    name: CHECK_NAME,
    ok: true,
    status: 'pass',
    message:
      reportable.length === 0
        ? 'no observed write path exists here yet'
        : `git ignores all ${String(reportable.length)} observed write path(s) present`,
  };
}
