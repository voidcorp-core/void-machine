---
title: Deliver explicit Orchestra selection for the Herdr cutover
date: 2026-10-12
status: executing
spec: docs/specs/2026-10-12-orchestra-explicit-selection.md
ticket: DEV-1017
author: Folpe + Codex
high_risk: true
---

# Execution plan

Enable the existing ORCH to select DEV-1017 while preserving the two blocked
missions. This is the smallest slice needed before native metadata activation.
The user's continuing implementation mandate and approved selection design govern
execution. Personal activation, server operations and merge retain their gates.

## 1. Freeze the work and prepare its boundaries

- Depends on: none. TDD mode: exploratory (documents only).
- Create a dedicated worktree from verified develop, preserving the immutable
  DEV-1017 guard worktree. One commit-only writer; coordinator owns shared Git.
- Compile the canonical plan from the complete ticket and approved scoped design.
  Use panel.provider: orchestrator; do not recreate the closed DEV-1017 team mission.
- Obtain real native architecture/security and QA preparation before production.
  Preserve plan routing limitations and actual returns; no synthetic receipts.
- Record one ADR via `void-machine decisions new`, preserving accepted decisions.
- Gate: exact base, criteria hash, ownership and actual preparation recorded.
- Expected commit: `docs(orchestra): record explicit selection boundary`.

## 2. Implement and prove the smallest complete behavior

- Depends on: 1. TDD mode: strict.
- Write failing behavioral tests before production and commit their RED result.
- Own `packages/hook-runner/src/lifecycle/orchestra-reader.ts`, its test, optional
  `orchestra-selection.ts` and test, plus `orchestra-codec.ts` and test only where
  sharing the existing strict document parsing avoids duplicate parsing machinery.
- Cover valid selection among blocked/running missions, no binding, malformed and
  duplicate keys, stale/foreign targets, symlinks/limits/concurrent reads, wrong
  coordinator, missing/duplicate live pane, worker isolation and terminal cleanup.
- Wire through `herdr-metadata-executor.ts` only if needed; extend its existing test
  and `herdr-metadata.test.ts` when they own the end-to-end projection assertion.
- Gate: focused lifecycle suites fail for the expected new behavior before the
  fix, then pass without weakening identity, discovery or cleanup checks.
- Expected commits: `test(orchestra): reproduce explicit mission selection gap`,
  then `feat(orchestra): resolve the coordinator's explicit mission selection`.

## 3. Document, build and verify the real surface

- Depends on: 2. TDD mode: strict for hook wiring, exploratory for documentation.
- Update `docs/ORCHESTRA.md`, the approved spec/plan and
  `packages/core/skills/void-orchestrate/SKILL.md`; update the existing skill contract
  test if behavior is asserted there. No unrelated skills or execution controller.
- Regenerate through official commands: hook bundle, core-assets mirror, graph,
  skill references and ADR index only as their source changes require. No hand edits.
- Gate: build, typecheck, lint, targeted tests, full `pnpm test`, derive:check,
  skills:check-references, decisions:check, sync:docs and version:check.
- After compilation, ORCH alone may create the approved local selection file and
  invoke the read-only source reader against the real central files. Retain hashes
  proving central manifests/reports unchanged and the unbound refusal preserved.
  Do not send invented lifecycle events as live proof or activate global hooks.
- Expected commit: documentation and regenerated assets accompanying the feature.

## 4. Independent review and delivery

- Depends on: 3. TDD mode: exploratory (review and delivery).
- Exact committed head, base and criteria hash receive one fresh independent review.
  Corrections remain with the writer; maximum two targeted correction batches.
- ORCH pushes, opens the PR, observes CI and requests the protected-path merge gate.
  Do not modify the active guard bundle or install new personal hooks in this PR.
- Gate: independent review and CI on exact head; human merge authorization.

## Execution handoff

One unit under DEV-1017, source contract extended from DEV-1016. Order 1 -> 2 -> 3 -> 4.
Worker ownership is the source/tests/docs listed above and their deterministic
generated outputs, one ADR and ignored local evidence. ORCH owns the tracker,
central mission and global configuration. No Cortex, server, collector, plugin,
permanent pane or consumer changes. Other writers' changes must be preserved.

## Self-review

Each step has a scope, mode and observable gate. No new CLI, daemon, registry or
automatic state migration. Runtime admission limitations are recorded separately
from actual native preparation/review. Archive readiness remains an operational
DEV-1017 gate after this code is delivered and activated.
