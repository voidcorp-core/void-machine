---
schemaVersion: 1
id: "adr:f3e97601-5e6a-4896-a026-2d59096d32b1"
createdAt: "2026-08-04T12:05:57.518Z"
title: "derived content is not committed; what breaks a fresh clone stays"
status: accepted
deciders: []
supersedes: []
---

# derived content is not committed; what breaks a fresh clone stays

## Context

The observed/declared split (`void-layout-ownership-split`) classified `derived`
state — everything `void-harness init` re-materializes from the harness assets pinned in
`.void/config.json` — and deliberately left it tracked, because the class could
not move one path at a time.

Measured on a freshly wired consumer project, that class is:

| directory | files | size |
| --- | --- | --- |
| `.claude/skills/` | 39 | 464 KB |
| `.agents/skills/` | 39 | 464 KB |
| `.claude/agents/` | 21 | 104 KB |
| `.codex/agents/` | 21 | 104 KB |
| `.claude/commands/` | 6 | 24 KB |
| `.void/hooks/` | 1 | 88 KB |

126 files and roughly 1.2 MB of vendored harness prose per repository, tracked by
default because nothing classified them — rewritten in full on every version
bump, and present in every review diff of every product PR that happens to follow
an update.

It is the relationship a lockfile has with `node_modules`, and since
`exact-rehydration-manifest` the analogy holds properly: `.void/install-manifest.json`
names an exact version and hashes every file, `hydrate` restores from it and
proves the result. `config.core` alone would not have been enough — it is a
caret RANGE, and `init` materializes whatever assets the running CLI carries.

## Decision

Ignore `derived` state, except the paths whose absence from a fresh clone is an
**error** rather than a degradation. The line is exactly that:

- `.void/hooks/` stays tracked. It is named from `.claude/settings.json`, which
  is `project` state and therefore committed; ignoring the runner while keeping
  the reference gives a clone a settings file pointing at a missing file, and
  every tool call fails on it.
- `.codex/hooks.json` stays tracked. It *is* the Codex safety floor. Absent, the
  floor is not there — a silently weaker clone, which is worse than either a
  working one or a loudly broken one.

Everything else (`.claude/skills/`, `.claude/agents/`, `.claude/commands/`,
`.agents/skills/`, `.codex/agents/`, `.void/installed/PHILOSOPHY.md`) is ignored: without
them the agent has fewer capabilities until the next `hydrate`, and nothing
errors.

An ignore rule cannot untrack what the index already holds, so existing projects
need an explicit step: `void-harness update --untrack-derived` drops them from
the index and leaves every byte on disk. It is opt-in and never implied, and
`doctor` reports the count as **advisory** rather than a failure — nothing is
broken by committing them.

## Consequences

Positive:

- A consumer repository commits what it authored and nothing else: on the test
  project, 136 tracked files became 9.
- A product PR stops carrying harness prose in its diff, so review sees the
  change under review.
- A version bump stops rewriting a megabyte of tracked content.

Negative:

- A teammate cloning gets no project-local skills until someone runs
  `npx voidharness@<version> hydrate`, the version being the one
  `.void/install-manifest.json` names. The doctrine docs (`CLAUDE.md`,
  `AGENTS.md`) and the enforcement runner still ship, so the clone is functional
  and guarded, but it is less capable until restored.
- **Rehydration is exact, and that is what makes this decision safe.** It was not
  when this was first attempted, and the gap is why it was reverted out of #197.
  `exact-rehydration-manifest` closed it: the manifest records an exact version
  plus a sha256 per file, `hydrate` refuses to run on any other version, and it
  verifies every restored file and exits non-zero on drift. The guarantee is now
  "you get THE set back, and it is proven" — the content this decision stops
  committing is content a clone can reproduce byte for byte.
- Existing consumers must run one extra command once, and commit the resulting
  staged deletions.

## Alternatives considered

- **Keep committing everything** (the prior state, by default rather than by
  decision). Rejected: it is the reason a product repo's diff can carry thousands
  of lines nobody wrote, and it makes an update indistinguishable from a
  refactor at review time.
- **Ignore the whole derived class, including the hooks and the Codex floor.**
  Rejected on the fresh-clone test: the settings file names the runner, so the
  clone fails on every tool call, and a missing floor is a safety regression
  nobody would notice. Cleanliness is not worth a broken or silently unguarded
  clone.
- **Untrack automatically during `update`.** Rejected: it stages deletions across
  a repository the harness does not own. The user asked to update the harness,
  not to rewrite their index. Offering it as one explicit flag keeps the action
  available and the consent real.
- **Make it configurable per project.** Rejected: this repo is opinionated by
  construction, and a knob here would mean every consumer re-deciding a question
  that has one defensible answer.

## Reversal cost

Low on the harness side — reverting means classing those paths `project` in
`MATERIALIZED_OWNERSHIP`, and the ignore block regenerates on the next `update`.
Medium in the field: a consumer that ran `--untrack-derived` and committed would
need to re-add the files, which `hydrate` restores anyway.
