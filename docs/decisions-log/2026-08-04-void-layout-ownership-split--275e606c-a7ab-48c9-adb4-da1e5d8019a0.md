---
schemaVersion: 1
id: "adr:275e606c-a7ab-48c9-adb4-da1e5d8019a0"
createdAt: "2026-08-04T10:27:20.716Z"
title: "void/ splits by ownership: observed state moves under .void/local"
status: accepted
deciders: []
supersedes: []
---

# void/ splits by ownership: observed state moves under .void/local

## Context

`.void/` held two things with opposite lifecycles and nothing separated them:
what the project DECLARES (`config.json`, `PROJECT-DOCTRINE.md` — authored,
reviewed, pushed) and what the harness OBSERVES (telemetry, run journals, caches,
install receipts — machine-local, never shipped).

The harness wrote no `.gitignore` at all, so every consumer improvised one over
that vacuum. The improvisation that surfaced this read:

```
.void/*
!.void/PROJECT-DOCTRINE.md
```

It rescued the doctrine and silently ignored `config.json` with it — the file
carrying the pack pins and `paths.business`, the glob the enforcement runner
reads to decide what the TDD guard covers. A teammate cloning that repo got the
doctrine and no enforcement configuration, and nothing reported it.

This repo did the opposite: twelve enumerated ignore lines, one per runtime
artifact, growing with each new one. Two contradictory answers to the same
question, neither of them doctrine. Meanwhile the classification already existed
in code — `local-install.ts` distinguishes `SHARED_FILES` (co-owned) from
`MANAGED_PREFIXES` (harness-owned, regenerated) to decide what may be
overwritten — but git could not see it.

## Decision

Classify every path the harness materializes into `project` / `derived` /
`observed` in one map (`VOID_OWNERSHIP`, `packages/hook-runner/src/void-layout.ts`),
and move `observed` state under `.void/local/`.

`init` writes a marked `.gitignore` block; `update` migrates a pre-split project;
`doctor` proves the outcome with git rather than trusting the block is present.

Three properties carry the decision:

- **The rule stops needing maintenance.** One line, no `!` exception. A new
  runtime artifact is born inside `local/` and no ignore file learns about it.
- **One source of truth.** The ignore block, the migration and `doctor` all read
  the same map, so `update` can never move a file the rule does not cover.
- **Proof, not declaration.** `doctor` asks `git check-ignore` and `git ls-files`,
  because an ignore rule has no effect on a path that was already tracked — the
  one failure the block cannot fix by itself.

An unknown entry at the top of `.void/` answers `project`. `local/` is a closed
set, so a stranger there cannot be harness telemetry; guessing `observed` would
have `doctor` tell a project to untrack its own data, which it did for this
repo's own `.void/harness-feedback/` before the default was corrected.

`derived` is classified and deliberately still tracked (see Alternatives).

## Consequences

Positive:

- What a consumer commits is now exactly what it authored, and the fresh-clone
  failure that started this — `config.json` missing, enforcement unconfigured,
  silent — is structurally impossible.
- `doctor` gained three checks that fail on a real leak instead of assuming one
  cannot happen.
- This repo's twelve enumerated ignore lines collapsed to one.

Negative:

- A layout change for every existing consumer. Mitigated by `update` migrating
  automatically, and by every reader falling back to the pre-split path so an
  un-migrated project keeps working and keeps its history.
- Paths in tooling and docs moved (`.void/runs/` → `.void/machine/runs/`, likewise
  receipts, cache, state), which is churn for anything that hardcoded them.
- One more directory level on every observed path.

## Alternatives considered

- **Only move `PROJECT-DOCTRINE.md` out** (the initial framing). Rejected: it
  fixes the file that was noticed and leaves `config.json` in the same trap. The
  axis is not "doctrine vs the rest" but "declared vs observed".
- **Put the doctrine at the repo root.** Rejected: `CLAUDE.md` and `AGENTS.md`
  already occupy the root by runtime requirement, `config.json` would still need
  `.void/`, so it yields three locations instead of two in the most contested
  namespace of the repo — and breaks the `@.void/PROJECT-DOCTRINE.md` import in
  every existing consumer.
- **Keep enumerating ignore rules, one per artifact** (this repo's prior
  approach). Rejected: correct only until the next artifact, and it failed
  exactly that way — `outcomes.jsonl` and `state.json` were each added later, by
  hand, to a list nobody could see was incomplete.
- **Also ignore `derived` (`hooks/`, `PHILOSOPHY.md`, and by extension
  `.claude/skills/`, `.agents/skills/`).** Defensible — they are reproducible
  from the pin, and committing them puts thousands of lines of vendored prose in
  a product repo's history and its review diffs. Deferred, because the class can
  only move as a whole: `.claude/settings.json` is `project` and references
  `.void/hooks/_void-hook.mjs`, so ignoring the hooks alone leaves a repo whose
  every tool call fails on a fresh clone. It also mass-untracks files in every
  consumer repository, which is a decision to take deliberately and not as a side
  effect of this one.

## Reversal cost

Medium. The map and the read-fallback make the code side cheap to invert, but
consumer repositories have already moved files and committed the deletions, so
reverting means a second migration rather than a flag flip.
