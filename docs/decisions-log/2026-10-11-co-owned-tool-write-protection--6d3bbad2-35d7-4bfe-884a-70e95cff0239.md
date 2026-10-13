---
schemaVersion: 1
id: "adr:6d3bbad2-35d7-4bfe-884a-70e95cff0239"
createdAt: "2026-10-11T10:32:07.896Z"
title: "Protect exclusively owned installed assets while preserving co-owned project edits"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:0ee50693-062d-4eb8-b870-840ef6453879"]
---

# Protect exclusively owned installed assets while preserving co-owned project edits

## Context

DEV-1018 exposes a mismatch between installation and pre-write enforcement. The
installer and manifest verifier recognize six exact co-owned project paths, but
protected-file refuses every manifest entry. Legitimate edits to CLAUDE.md,
AGENTS.md and project doctrine consequently fail as delivered-asset mutations.

This decision supersedes adr:0ee50693-062d-4eb8-b870-840ef6453879 for its blanket
tool-write ownership restriction. Its checked-out evidence boundary, lexical
protections, content checks and bounded source reader remain in force. The old
accepted record remains unchanged.

## Decision

Apply manifest ownership refusal only to exclusively owned installed assets,
using the existing exact co-owned policy shared by installation and enforcement.

Move the pure CO_OWNED_FILES, PROJECT_DOCTRINE_PATH and isCoOwned definitions from
the CLI into hook-runner and export them through its index. The CLI's existing
module re-exports those definitions along the existing CLI-to-hook-runner
dependency; callers retain their imports. There is no new package, schema or
second list.

The six project-relative paths remain .gitignore, .void/config.json,
.void/PROJECT-DOCTRINE.md, .claude/settings.json, CLAUDE.md and AGENTS.md. Compare
the normalized project-relative path exactly: a prefix, nested namesake or
case-folded basename does not establish co-ownership. Manifest-listed skills,
agents, commands, hooks and other exclusive assets remain refused with the
existing route to void-learn.

Co-ownership removes only the ownership refusal. Lexical checks for secret and
credential paths, private keys, lockfiles and Git metadata still run, as do
independent content checks. Co-owned paths never enter an all-checks allowlist.
Claude and Codex use the same predicate, including multi-file requests where
one forbidden target refuses the operation.

The rule does not enforce marked blocks or prove approval. Installation keeps
its existing reconciliation responsibilities; explicit human approval still
governs doctrine changes through void-learn. No consumer reinstall, personal
configuration change or inferred doctrine content is part of this decision.

Checked-out CI evidence still skips pre-write manifest ownership and retains
lexical protected-path and content checks. CI does not certify installation
provenance or approval. Its existing lockfile policy is unchanged.

## Consequences

Positive:

- Project edits permitted by installation are also permitted by the hook.
- One pure policy prevents installation and enforcement from disagreeing.
- Exclusive asset protection and the rest of the enforcement floor remain active.

Negative:

- File-level ownership does not distinguish edits within managed blocks from
  project text. This is the existing contract, not an authorization check.
- The CLI compatibility re-export remains to avoid migrating unrelated callers.

## Alternatives considered

- Duplicate the six paths in protected-file: rejected because two lists can drift.
- Add co-owned files to an all-checks allowlist: rejected because content scans
  and lexical protections must remain active.
- Match basenames or directory prefixes: rejected because nested namesakes and
  exclusive assets could inherit permissions they do not own.
- Introduce block-aware enforcement or a manifest schema field: rejected because
  neither is required by the current file-level contract; each adds a new policy.

## Reversal cost

Low. Revert the predicate and compatibility relocation, adjust regression tests
and regenerate the official portable bundles. No persisted schema or runtime
configuration changes. Restoring the blanket refusal would restore DEV-1018.
