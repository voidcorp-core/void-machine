// How one declared area is read, for every step that reads one.
//
// A footprint area is written by a human in a ticket, so all three forms appear
// there: the exact path, the directory that contains a file, and the glob. Two
// steps consume them and they disagreed: `worker-order` compared areas by exact
// string equality to decide who runs in parallel, `footprint-audit` matched by
// prefix and glob to decide whose file is whose. So `packages/cli/src` and
// `packages/cli/src/lib/x.ts` were never sequenced, ran at once, and the second
// ticket's own neighbouring file was then refused as a breach on behalf of the
// first. One relation, read once, is the fix -- not two readings kept in step by
// review.
//
// Normalisation is the other half, and it was a silent guard failure rather than
// a cosmetic one. `packages/core/src/templates/` -- the most natural way to write a
// directory in a path list -- claimed nothing: not the exact path, not the
// prefix (which would need a doubled slash), and picomatch matches no file
// against a trailing slash either. A file stolen from that area came back
// `within-scope`, reported as a widening, which is the audit's word for
// approval. A leading `./` does the same thing.
//
// An area that still claims nothing after normalisation is refused rather than
// accepted as an empty claim, because an empty claim is indistinguishable from a
// clean audit -- the failure this whole module exists to remove.

import picomatch from 'picomatch';
import { autopilotFailure } from './errors.js';

export interface CompiledArea {
  /** The area as every consumer reads it: trimmed, no `./`, no trailing `/`. */
  readonly area: string;
  readonly match: (value: string) => boolean;
  /**
   * The directory every file this area claims lies under. `''` is the
   * repository root, which bounds nothing.
   */
  readonly reach: string;
}

/**
 * Does any segment of this path make it unable to name a file git reports?
 *
 * git reports a path relative to the repository root, with single separators
 * and no dot segment. So `packages//core` is not `packages/core` for the exact
 * comparison, not a prefix of it, and picomatch collapses nothing either; `/abs`
 * leads with an empty segment; `../x` and `a/./b` are the same failure written
 * differently. All of them read as ordinary areas and claim nothing, which is
 * how a spelling disarms the guard rather than tripping it.
 */
function claimsNothing(value: string): boolean {
  return value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * The one spelling of an area, so two readers cannot disagree about it.
 *
 * Refuses what would claim nothing: an empty area, an absolute path, and any
 * spelling carrying an empty or a dot segment. None of them matches a path git
 * ever reports for a range. The stripping runs first, so the two forms a human
 * legitimately writes -- a leading `./`, a trailing `/` -- survive it.
 */
export function normaliseArea(area: string): string {
  let value = typeof area === 'string' ? area.trim() : '';
  while (value.startsWith('./')) value = value.slice(2);
  while (value.endsWith('/')) value = value.slice(0, -1);
  if (value.length === 0 || claimsNothing(value)) {
    throw autopilotFailure(
      'AUTOPILOT_CONTRACT',
      'a declared area claims nothing',
      `the area ${JSON.stringify(area)} reads as ${JSON.stringify(value)}, which matches no file git reports`,
      'declare each area as a repository-relative path, directory or glob, for example `packages/cli/src`',
    );
  }
  return value;
}

/**
 * The directory beyond which this area reaches nothing.
 *
 * `picomatch.scan` is the parser that compiles the matcher, so this is the
 * pattern's own idea of where its literal ground ends rather than a second
 * reading of it invented here: its documented `base` is "the leading non-glob",
 * so `packages/**\/*.test.ts` reaches only inside `packages`, and a literal
 * area reaches only inside itself. A negated pattern claims everything it does
 * NOT name -- `scan` documents `negated` as a leading `!` that is not `!(` --
 * so its base bounds nothing and it is read as reaching the whole repository.
 */
function reachOf(area: string): string {
  const scanned = picomatch.scan(area);
  return scanned.negated ? '' : scanned.base;
}

/**
 * A dot is a character, not a category, so `dot: true`.
 *
 * picomatch 4.0.5 documents `dot` as defaulting to false and `*` as matching no
 * "hidden file or directory" unless the pattern spells the dot itself. Applied
 * to a footprint that is not a filter, it is a hole: `packages/core/src/skills/**`
 * -- the shape an estimator writes for "touch the skills" -- claimed every
 * `SKILL.md` and not one of the `.source` files the sourcing discipline puts
 * beside them. The DIRECTORY spelling of that same area claims them, through
 * the prefix branch, so one area answered two ways about one file and the
 * theft landed in `widened`, which is the audit's word for approval. 183
 * tracked files of this repository sit on a hidden path.
 *
 * The option only ever adds matches, which is why it is safe in both readings:
 * more claims mean more pairs sequenced, and a carrier detected where a
 * widening was reported. It cannot separate a pair that overlapped or clear a
 * range that breached.
 */
export function compileArea(area: string): CompiledArea {
  const value = normaliseArea(area);
  return { area: value, match: picomatch(value, { dot: true }), reach: reachOf(value) };
}

/**
 * Does this area claim this file?
 *
 * Deliberately generous, and symmetric -- the same reading decides both what a
 * ticket owns and what its neighbour owns, so being generous never refuses a
 * range it would otherwise have accepted.
 */
export function areaClaims(compiled: CompiledArea, file: string): boolean {
  return file === compiled.area || file.startsWith(`${compiled.area}/`) || compiled.match(file);
}

/**
 * Do two reaches nest, read as paths rather than as strings?
 *
 * Symmetric in one expression rather than a directed test applied twice, so a
 * reversal inside it is a change a test can see. `packages/core` is a prefix of
 * the STRING `packages/coreutils` and of no path under it, which is why the
 * separator is part of the comparison; the repository root nests with
 * everything.
 */
function reachesNest(left: string, right: string): boolean {
  return (
    left === '' ||
    right === '' ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

/**
 * Do two areas contend for the same ground?
 *
 * Symmetric on purpose: `packages/cli/src` claims `packages/cli/src/lib/x.ts`,
 * so the pair overlaps whichever way round the two tickets declared them.
 *
 * Asking whether one area claims the other's NAME is not asking whether their
 * files intersect, and for a glob the two questions come apart. An extension
 * glob matches no bare directory, so `packages/**\/*.test.ts` and
 * `packages/core/src/b` -- "add tests across the packages" beside "refactor
 * packages/core/src/b", the shape an estimator writes -- read as disjoint and ran
 * at once, while the audit was willing to read both claims on
 * `packages/core/src/b/x.test.ts` and call it a draw. That leniency is justified by
 * THIS step having sequenced them, so the pair it cannot see is the one that
 * arrives unrefused and unreported.
 *
 * So a pair separates only when it is PROVEN to: every file an area claims lies
 * under its `reach`, and two reaches neither of which contains the other can
 * hold no file in common. Anything else takes its turn. That gives up a lane on
 * two globs rooted in the same subtree that a wider comparison would keep --
 * `packages/core/**\/*.md` beside `packages/core/src/**\/*.ts` -- and gives up
 * every lane to an area rooted at the repository, which is honest about what a
 * repository-wide glob claims. Two areas in different directories, which is
 * how a cluster is normally scoped, are untouched.
 *
 * This subsumes the name reading rather than sitting beside it. An area whose
 * name `areaClaims` claims lies under the claimant's reach, and its own reach
 * is a prefix of its name, so the two reaches are prefixes of one path and
 * always nest -- testing the name again could refuse nothing more. The
 * guarantee that matters is that every pair the audit can relate is a pair this
 * sequences, and that is asserted over a corpus in the tests rather than
 * restated as a branch no input can reach.
 */
export function areasOverlap(left: CompiledArea, right: CompiledArea): boolean {
  return reachesNest(left.reach, right.reach);
}
