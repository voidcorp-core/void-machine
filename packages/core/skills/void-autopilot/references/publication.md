# Guarded publication and human recovery

The coordinator runs from the checkout containing the ticket's original baseline.
The local candidate branch can belong to another worktree; no checkout movement
or evidence copy is needed. Workers remain commit-only.

```sh
void-machine autopilot publish --ticket DEV-42 --head <full-sha> --remote origin --branch fix/dev-42 --json
```

This checks the explicit local branch against the full SHA and the shared Git
guard, then pushes that literal SHA to the named remote branch in the same
command. A base or deploy branch is refused. It does not force push, disable
hooks, set an upstream, grant review or merge permission, or remove a merge hold.
Missing, invalid, unreadable and changed fingerprints launch zero pushes. A
transport error can follow a remote success: inspect the named remote branch
before a deliberate retry. Never automatically follow a refusal with direct Git.

## Coverage

Policy v4 excludes only a regular file exactly at common-Git-directory `info/refs`.
Git documents it as generated transport information, rebuilt by
[`git update-server-info`](https://git-scm.com/docs/git-update-server-info).
Its creation, update and removal are harmless to this guard. This does not identify
who created an incident file from its timestamp. `objects/info/packs` is Git's
other generated output; it is outside the existing fingerprint. `info/packs` is
not that output and stays guarded. Symlinks, nested `refs`, `info/exclude`,
`info/attributes`, hooks and their checksums, config/includes, bases, stash, tags,
notes, remotes and replace refs retain their previous coverage.

Version 3 aggregated the whole info directory. Its digest cannot be converted to
v4 without historical file contents. A legacy record refuses with an explicit
human-renewal instruction; it is never silently re-recorded.

## Explicit human renewal

Stop publication. Inspect the failure and the actual shared-state changes. A
person must authorize the exact repair or policy transition and affected candidate;
the ticket's implementation mandate alone is not that authorization.

```sh
void-machine autopilot fingerprint --record DEV-42 --json
```

Retain the output, including `recordDigest`, `currentDigest`, old fingerprint and
current fingerprint. After the human decision, use those exact digest values:

```sh
void-machine autopilot fingerprint --renew DEV-42 --head <full-sha> --branch fix/dev-42 \
  --previous <recordDigest> --expected <currentDigest> \
  --cause 'Reviewed authorized repair or v3 policy transition' \
  --decision '<reference to the explicit human decision>' --json
```

The original `fingerprints/DEV-42.json` remains byte-for-byte intact. The complete
renewal under `fingerprints/DEV-42.renewals/` retains both fingerprints, predecessor
digest, branch/SHA, cause and decision. Its atomic creation is the transition;
there is no separate baseline replacement. Identical replay returns the retained
record. Conflicting or stale replay and changed observations refuse. Preserve
all those files: deleting history is not recovery. Renewal changes no review,
merge hold, merge authorization or deployment permission.

Publication and renewal share `fingerprints/DEV-42.lock`. A competing operation
refuses immediately. A crashed process may leave that directory: a person must
establish the owning process ended and inspect retained evidence before removing
only that abandoned lock. An incomplete canonical record remains blocked and
must be recovered from retained evidence, never ignored. Unlinked unique temporary
files are not committed records; retain them for diagnosis after an interrupted write.

The lock coordinates these supported commands in this state directory. It cannot
serialize direct Git, hooks or other processes, nor prevent malicious edits to
local evidence. The command rechecks immediately before its side effect and uses
an immutable commit refspec, but does not claim an atomic snapshot of all Git state
through network completion. See [Git push](https://git-scm.com/docs/git-push) for
refspec and hook semantics. Direct Git is outside this guarantee.
