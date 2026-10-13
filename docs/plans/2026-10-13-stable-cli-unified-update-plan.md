---
title: Deliver one stable CLI and project update operation
date: 2026-10-13
status: executing
spec: docs/specs/2026-10-13-stable-cli-unified-update.md
ticket: DEV-1022
author: Folpe + Codex
high_risk: true
---

# DEV-1022 execution plan

## Goal and authorization

Implement the approved spec as one cohesive delivery: published versioned CLI,
`update` for CLI plus current project, explicit `--all`, preservation and truthful
compatibility/recovery. Folpe approved the written contract for implementation on
2026-10-13. This plan makes its technical execution concrete; no new product scope,
background updating, multi-project default or permission widening is introduced.

Base: 7c17790eb70d3ab489c9bab9138ad01e5fcc50f4. Assigned branch/worktree:
`feat/stable-cli-update`, under the durable git-worktrees root. Preserve the primary
personal checkout, the existing programme and all consumer work. One commit-only
writer owns implementation; coordinator owns tracker, independent preparation/review,
PR/release and actual launcher/project migration. No recursive writer delegation.

## Concrete boundaries

- `voidGlobalDir()/cli` owns releases, active selection, a bounded operation journal
  and lock. Reuse `voidGlobalDir`, not a second discovery registry. Release prefixes
  `releases/<exact stable version>` contain npm-installed `voidmachine`. Staging and
  completed releases are distinct; completed packages are never modified in place.
- `active.json` stores exact version and prior selection, never a caller executable
  path. A shipped stable Node launcher imports only the validated selected package
  and calls existing `run(invokedAs, argv)`. POSIX uses env Node; Windows a `.cmd`
  adapter. New PATH conflicts are diagnosed, never hidden by shell configuration edits.
- Acquire from npm via structured argv, scripts/audit/funding disabled, exact pinned
  version, fixed registry metadata/integrity, bounded output and explicit timeout.
  Reuse/extract the proven Windows npm JS-entrypoint resolver from conformance code;
  do not import test scripts into production. Do not read or print authentication.
- A narrow versioned internal candidate process prepares its own bundled project
  plan; it is not a second public command or permission bypass. Bind candidate,
  target, operation and roots; validate its output and bound paths/files/bytes.
  Production never executes a arbitrary path supplied by registry metadata or a
  project. A target lacking the updater protocol refuses before project effects.
- One release compatibility descriptor declares supported schemas/contracts; versions
  come from release-please-owned package metadata. Runtime requirements reuse existing
  adapter declarations when available; do not invent a certified runtime version.
  Unknown required capability blocks; absence of an optional probe is explicitly unknown.
- Extract read-only install preparation from `init`, reusing local-install ownership,
  config merge and runtime adapters. Both init and update use that compiler.
  The actual projection includes retained collisions before smoke. Prepared effects
  include manifest/receipt and supported migrations, not only generated assets.
- Extend `transaction.ts` to durable snapshots and compare-before-write recovery.
  A thin operation coordinator orders participants and activates the CLI last. It
  must not implement a second byte/mode writer or a second rollback engine.
- Preflight all selected targets before publication. Reuse project-root resolution and
  configured discovery; malformed discovery config cannot fall back silently for
  `--all`, and unreadable/incomplete results refuse. Canonical install roots deduplicate.
- Unsupported legacy layout, marketplace or index-rewrite combinations receive a
  specific refusal before effects until their effects can be prepared and recovered.
  Do not run legacy registry retirement or `--untrack-derived` outside this operation.
  Unnecessary Git-exclude rewrites are omitted from update; any necessary write has
  its own validated canonical participant through the same transaction primitive.

## Step 1: update one compatible project from a prepared release

- Depends on: none. TDD: strict; structural extraction commits separately if needed.
- Goal: a finite project plan reports compatibility, preserves custom config/packs,
  and applies through existing ownership/transaction semantics without global effects.
- Files: `packages/cli/src/commands/init.ts`, `commands/update.ts`,
  `lib/local-install.ts`, `lib/receipts.ts`, `lib/install-manifest.ts`,
  `lib/runtime-adapters.ts`, and focused new `lib/install-plan.ts`,
  `lib/update-compatibility.ts` with adjacent tests. `main.ts` and `doctor.ts` consume
  the shared preflight for relevant mutation/diagnostic paths; help/version stay safe.
- Fixtures: stale CLI/newer manifest; absent versus malformed/unsupported receipt;
  manifest-only clone; retired pack; invalid selected runtime or schema; user hooks,
  custom config fields, authored doctrine, source-repo canonical docs and retained
  asset affecting smoke. No unknown pack is dropped.
- Preserve exact offline `hydrate`; retain an internal bundled-materialization seam
  for init and tests, rather than keeping the obsolete public update-is-offline promise.
- Gate: focused strict RED then GREEN; existing local-install/init/update preservation
  and main routing tests pass; CLI typecheck, no source-repository mutation in fixtures.
- Commits: `test(cli): reproduce unsafe versioned update boundaries`, then
  `feat(cli): prepare compatible project updates without side effects`.

## Step 2: acquire a stable CLI and update one project recoverably

- Depends on: step 1. TDD: strict.
- Files: `lib/transaction.ts` and tests; focused `lib/cli-installation.ts`,
  `lib/update-operation.ts`, `lib/update-release.ts`, narrow adjacent adapters/tests;
  shipped launcher assets under `packages/cli/bin/`; existing build/package file list
  only if required (no manual version change). Shared npm resolution has one owner.
- Implement fixed metadata resolution, staging prefix install, SRI/identity/engine and
  candidate-contract validation before execution; smoke from an unrelated directory.
  Follow npm11 official options from the spec; use explicit finite process limits.
- Persist validated before/after bytes/hashes/modes, operation identity, canonical roots,
  target, previous selection and publication phase before writes. Lock ownership must
  distinguish a live updater from a dead interrupted one; arbitrary old age never
  authorizes stealing a live lock. Refuse symlink/traversal and unreadable state.
- Handle the rename-before-journal-update crash window by inspecting actual bytes,
  not just a step counter. Rollback only operation-owned states; retain backups on
  conflict or rollback failure. Repeated same-command invocation recovers first.
- The known checkout-based launcher is backed up, hash-revalidated and replaced only
  after the candidate/project pass. Unknown executables, links, aliases or functions
  stay unchanged. Do not claim PATH selection from file existence alone.
  The coordinator's later 2026-10-13 observation identifies the current launcher as
  an npm-owned symlink to `voidmachine@5.0.1`, with a `voidmachine` alias. Include
  verified npm-bin adoption in isolated bootstrap tests; validate package identity,
  declared bin mapping and resolved target before any replacement. Preserve unknown
  symlinks and recover the original verified link on failure. The coordinator alone
  qualifies the actual home installation after publication.
- Gate: targeted acquisition/activation/recovery tests, deterministic child-process
  interruption at publication boundaries, concurrent invocation and later user edit;
  actual launcher runs without original checkout and preserves arguments/exit/signals.
- Commits: RED cases then `feat(cli): activate stable releases with recoverable updates`.

## Step 3: update an explicit project set and preserve programme policy

- Depends on: step 2. TDD: strict.
- Files: `commands/update.ts`, `lib/projects/catalog.ts`, `config.ts`, `discover.ts`
  and their tests; `lib/project-roots.ts` only when necessary; new
  `lib/autopilot/program-migration.ts` and tests, reusing `program.ts` and `merge-hold.ts`.
- Default target is current canonical installation, or CLI-only outside an installed
  project. `--all` uses complete existing discovery, validates every target, applies
  serially with one immutable target release, then activates. No new registry.
- Root programme schema stays 1. Only equivalent autopilot schema1-to2 transformations
  are automatic. Human mode publishes/retains its hold before removing the gate,
  preserving existing hold bytes, enabled consent, comments, all unrelated YAML/body.
  Missing/unknown gate, damaged hold or any policy change without proven equivalence
  refuses. Do not assume union-reviewed server-check policy equals the new local
  review policy; if equivalence cannot be proven, name the decision instead of
  broadening permission. Disabled consent is never silently enabled.
- Refuse unsupported flags/combinations explicitly. All-project failure uses the same
  journal/recovery, never partial green. `--dry-run` plans the same compatibility and
  projected targets without active/project mutations; caches are reported separately.
- Gate: two real isolated fixture projects, linked-worktree deduplication, incomplete
  discovery, second-project failure/recovery, unchanged unselected project, and later
  incompatible mutation refusal there. Programme+hold restore together in tests.
- Commits: RED cases then `feat(cli): coordinate explicit project updates safely`.

## Step 4: prove the packed product, review and deliver

- Depends on: steps 1-3. TDD: strict for changed logic, exploratory for delivery proofs.
- Files: one packed integration owner alongside `test/cli/self-contained.test.ts`;
  extend `test/cli/retained-packs.test.ts`, `force-preserves-co-owned.test.ts`,
  `ignore-block-follows-the-transaction.test.ts` where their behaviors change. Adapt
  conformance tests, README/CLI help/architecture/release or migration docs. New ADR
  via `decisions new` records explicit-update acquisition while hydrate stays offline.
- Acceptance: map all eight spec outcomes to exact proof commands on the frozen
  commit. Isolated fixture homes; no real project/launcher writes by the writer.
  No real secrets, no implicit force, permission changes or Git commit/push by updater.
- Build once before bundled probes; local Vitest maxWorkers1, one heavy process.
  Focused tests, CLI/hook-runner typecheck where affected, scoped lint, version/docs/
  generated checks and ordinary commit hooks. Full CI and OS conformance remote.
  No retry-to-green, timeout inflation, tests mirroring implementation or fake review.
- Coordinator obtains independent review on exact head/base/criteria, batches concrete
  corrections through the same writer, then normal PR/merge/release publication.
  Versions/changelog belong to release-please; provenance/integrity verified.
- After publication, coordinator backs up and migrates only the identified source
  launcher, Machine and Cortex using the new command. If a non-equivalent personal
  policy blocks rollout, report it before changing policy. Never silently write other
  projects or restart their sessions. Verify versions, preserved hashes, doctor and
  actual hook probes; close the worker after report collection.

## Review checkpoints and execution handoff

One standalone unit DEV-1022; no replacement of the existing global programme. Native
risk-focused preparation reviews this written plan before writer launch. Coordinator
resolves mechanical findings within the approved spec; a real new product/permission
choice alone returns to Folpe. Final exact-commit independent review is mandatory.
The spec's explicit approval for implementation already authorizes this execution;
no duplicate generic approval is introduced for routine plan details.

Resume point: step 1 not started. Dependency chain 1 -> 2 -> 3 -> 4; one writer owns
all colliding installer/update files. Linear owns ticket lifecycle; local reports
preserve exact commits, genuine failures, tests and remaining effects.

Self-review: four vertical slices, strict behavioral gates, explicit compatibility
and recovery boundaries, no background writes or new external service. Published
qualification is a separate observed outcome from implementation completion.
