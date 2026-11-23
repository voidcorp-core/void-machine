// Whether two branch names risk naming the same branch.
//
// The loop refuses to merge into the branch that deploys, and that refusal is
// the one that must never be wrong: `target` is resolved from the remote and
// arrives canonical, while `deployBranch` is typed by a person into the
// config authority. Every error this module makes is therefore a refusal. Moved out of
// the cluster engine's union review when that engine was removed; the rules and
// their history are unchanged.

type BranchRef =
  | { readonly kind: 'branch'; readonly identity: string }
  | { readonly kind: 'unrecognised' };
export type BranchComparison = 'same' | 'different' | 'undecidable';

const UNRECOGNISED: BranchRef = Object.freeze({ kind: 'unrecognised' as const });
const BRANCH_PREFIXES = ['refs/heads/', 'refs/remotes/', 'remotes/'] as const;
const PSEUDO_REFS = new Set(['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']);
const OBJECT_NAME = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const MAX_BRANCH_NAME = 255;
const CONTROL_OR_FORBIDDEN = new RegExp('[\\u0000-\\u001f\\u007f ~^:?*[\\\\]');

/**
 * One branch name, in the one shape a comparison can be trusted on.
 *
 * `target` is resolved from the remote and arrives canonical. `deployBranch` is
 * typed by a person into a config authority descriptor and is validated by nothing --
 * so `origin/main`, `refs/heads/main`, `Main` and `main ` all failed to equal the
 * resolved `main`, and the branch that ships was granted to a machine. The one
 * refusal that must never be wrong was the only input with no shape.
 *
 * Case is folded deliberately. Git treats `Main` and `main` as two branches, so
 * folding can only ever refuse a pair git would have let through, and every error
 * this check makes has to be a refusal.
 */
function branchIdentity(name: string): string {
  const trimmed = name.trim();
  for (const prefix of BRANCH_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

/**
 * Is this a name git would accept for a branch?
 *
 * The rules are git's own, read from `git check-ref-format` for the installed
 * version rather than remembered: no component beginning with a dot or ending in
 * `.lock`, no `..`, no control character, space, tilde, caret or colon, no `?`,
 * `*` or `[`, no leading, trailing or doubled slash, no trailing dot, no `@{`,
 * not the single character `@`, and no backslash.
 */
function isBranchNameShape(identity: string): boolean {
  if (identity.length === 0 || identity.length > MAX_BRANCH_NAME) return false;
  if (identity === '@') return false;
  // Written as codepoints rather than literal control characters: git rule 4
  // bans everything below \\040 and DEL, and a literal one in source is itself
  // the kind of invisible input this check exists to refuse.
  if (CONTROL_OR_FORBIDDEN.test(identity)) return false;
  if (identity.includes('..') || identity.includes('@{')) return false;
  if (identity.startsWith('/') || identity.endsWith('/') || identity.includes('//')) return false;
  if (identity.endsWith('.')) return false;
  return identity.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * Read a ref the way the merge refusal needs it, or say it could not.
 *
 * The previous version was `string -> string` and therefore total: it lowercased
 * whatever it was handed, so every shape it did not understand became a token
 * that matched nothing, and matching nothing is what let a merge through. Probed on
 * 2026-08-30, six spellings reached production that way -- an empty target, a
 * bare object name, `HEAD`, `main^`, and a `deployBranch` of `refs/heads/` or
 * `origin/`, both of which normalise away to nothing after passing an emptiness
 * check that ran on the raw string.
 *
 * Shape only. Whether an unreadable ref refuses is the caller's decision, and it
 * lives at the point that authorizes rather than in a string helper.
 */
function parseBranchRef(name: unknown): BranchRef {
  if (typeof name !== 'string') return UNRECOGNISED;
  const trimmed = name.trim();
  // A ref under a namespace this function does not know is not a branch: a tag,
  // a pull-request head and a note all name something else entirely.
  if (trimmed.startsWith('refs/') && !BRANCH_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return UNRECOGNISED;
  }
  const identity = branchIdentity(trimmed);
  if (!isBranchNameShape(identity)) return UNRECOGNISED;
  // Legal branch names, but never a branch in practice. `HEAD` and its siblings
  // are symbolic refs, and a full object name is a commit. Refusing both costs a
  // false refusal to nobody, and admitting them costs a production merge.
  if (PSEUDO_REFS.has(identity.toUpperCase()) || OBJECT_NAME.test(identity)) return UNRECOGNISED;
  return { kind: 'branch', identity };
}

/**
 * Do these two names risk being the same branch?
 *
 * `origin/main` and `main` cannot be told apart from `release/main` and `main`
 * without knowing the remotes, and this function has no way to know them. So it
 * refuses both: a suffix match on a whole segment counts as the same branch.
 *
 * That costs a false refusal to a project integrating into `release/main` while
 * shipping from `main`. The trade is not symmetric. A false refusal is a merge a
 * person does by hand and can see; the other direction is a machine merging into
 * production, which nobody sees until it has shipped.
 *
 * `undecidable` is a third answer on purpose: a boolean cannot distinguish "not
 * the deploying branch" from "I could not read one of these", and the two must
 * not lead to the same outcome.
 */
export function sameBranch(target: unknown, deployBranch: unknown): BranchComparison {
  const left = parseBranchRef(target);
  const right = parseBranchRef(deployBranch);
  if (left.kind !== 'branch' || right.kind !== 'branch') return 'undecidable';
  if (left.identity === right.identity) return 'same';
  return left.identity.endsWith(`/${right.identity}`)
    || right.identity.endsWith(`/${left.identity}`)
    ? 'same'
    : 'different';
}
