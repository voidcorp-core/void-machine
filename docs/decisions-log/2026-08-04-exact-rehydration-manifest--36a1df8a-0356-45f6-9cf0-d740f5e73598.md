---
schemaVersion: 1
id: "adr:36a1df8a-0356-45f6-9cf0-d740f5e73598"
createdAt: "2026-08-04T13:16:29.668Z"
title: "an exact manifest and a hydrate that proves the restore"
status: accepted
deciders: []
supersedes: []
---

# an exact manifest and a hydrate that proves the restore

## Context

Review of the layout work (#197) blocked the decision to stop committing
regenerated harness content on a premise the code did not hold: that a clone
could get the same content back. It could not.

- `.void/config.json` carries `core: "^2.5.1"` — a caret **range**, not a lock.
- `init` materializes whatever assets the **running CLI** carries, not the pinned
  version.
- On an existing config, `init` keeps the old pin rather than resolving it.

So two checkouts of one commit can hold different harness content, and nothing
reports it. On top of that, the ADR for the derived decision prescribed
`npx voidharness install`, which refuses a project install and redirects to
`init` (`packages/cli/src/commands/install.ts:56`) — a documented command that
cannot work, the same defect class that work existed to remove.

The derived-content decision was reverted out of #197 and preserved on
`folpe/derived-not-committed` pending this.

## Decision

Add `.void/install-manifest.json`: an **exact** version plus a sha256 per file,
written by `init` inside the same transaction as every other asset, and
committed. It is `project` class, and its mirror image is the install receipt,
which is `observed`:

| artifact | class | says |
| --- | --- | --- |
| `.void/machine/receipts/install-v1.json` | `observed` | what THIS MACHINE installed |
| `.void/install-manifest.json` | `project` | what THIS PROJECT expects |

Add `void-harness hydrate`, which restores from it under two rules:

1. **It refuses to run unless the running CLI is the version the manifest names**,
   and prints `npx voidharness@<version> hydrate`. It does not fetch that version.
2. **It verifies every restored file against the manifest and exits non-zero on
   any drift.** Materialization stays `init`'s job — hydrate calls it — so the
   restore can never diverge from what an install produces.

`doctor` reports the same fact without repairing: matching, drifted (failure, with
the pinned command), unreadable (failure), or absent (advisory).

## Consequences

Positive:

- "The same bytes" becomes checkable rather than assumed, which is the
  precondition the derived-content decision was missing.
- Drift is detectable at rest: a hand-edited or differently-versioned asset shows
  up in `doctor` without anyone running a restore.
- Version selection has one obvious answer (`npx voidharness@X`), and a wrong
  version fails loudly instead of quietly substituting.

Negative:

- One more committed file per project, rewritten whenever the installed set
  changes.
- `hydrate` cannot repair a hand-edited harness asset without `--force`, because
  the install transaction refuses to overwrite a file it no longer owns. That is
  the right default and it is an extra step for the person who wanted the restore.
- The manifest records the version that installed, not a resolved lock of
  `config.core`; a project that never re-runs `init` after a pin bump keeps a
  manifest naming the older version. That is accurate — it is what the project
  actually has — but it is not the same thing as pinning intent.

## Alternatives considered

- **Have `hydrate` fetch the exact version itself** (npm pack into a temp dir).
  Rejected: it adds a network surface, an offline failure mode and a class of
  partial-download states, to reimplement what `npx voidharness@X` already does
  correctly. Printing the exact command is smaller and more honest.
- **Hydrate with whatever CLI is running, and just report the drift.** Rejected:
  it makes the common path silently wrong. The command's value is that "hydrated"
  means something.
- **Resolve `config.core` to an exact version instead of adding a manifest.**
  Rejected: a resolved pin says which package, not which bytes. It would catch a
  version mismatch and miss an edited or partially-restored asset, which is
  exactly what the hashes catch.
- **Reuse the receipt as the shared record.** Rejected on ownership: the receipt
  describes one machine's install and is `observed` by construction. Committing it
  would put one developer's state in everyone's checkout — the conflation the
  layout split exists to remove.

## Reversal cost

Low. The manifest is additive and inert if unused; `hydrate` is a new command
that no existing flow depends on. Removing it means deleting the command and
dropping one file from the install.
