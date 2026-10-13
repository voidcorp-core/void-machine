---
title: Deliver portable adaptive delegation
date: 2026-10-13
status: executing
spec: docs/specs/2026-10-13-adaptive-delegation.md
ticket: DEV-1019
author: Folpe + Codex
high_risk: false
---

# Plan

Record the implementation of the first slice approved by Folpe on 2026-10-13.
One standalone issue, not an autonomous expansion of the executing programme.

## Step 1: make the existing delegation policy portable

- Depends on: none. TDD mode: souple (instruction contracts).
- Ownership: one implementation writer for source and tests; coordinator owns
  this spec/plan, ADR creation, generation, integration and shipping.
- Edit packages/core/skills/void-orchestrate/SKILL.md and .source; document
  distillation in docs/plans/skill-audits/void-orchestrate.md.
- Scope Herdr recovery/files/projection to the adapter; add ordinary research,
  context choice, dispatch budget, writer isolation, result/continuity contract.
- Update docs/NATIVE-SUPERVISION.md and docs/ORCHESTRA.md only where this boundary
  changes; preserve schemas and real Herdr launch safeguards.
- Verify: test/skills/orchestrate-native.test.ts and precise new contract cases;
  no invented native API, no legacy kernel launcher.

## Step 2: activate from workflows and installed instructions

- Depends on: step 1. TDD mode: souple; any new logic requires strict RED first.
- Edit core skills void-brainstorm, void-plan, void-implement, void-autopilot and
  void-context; callers compose, never duplicate the policy. Remove the stale
  superpowers delegation references in void-context while replacing their owner.
- Update packages/cli/src/lib/claude-md.ts plus its tests for both runtime blocks;
  mirror relevant root AGENTS.md/CLAUDE.md wording together if appropriate.
- Preserve single-writer, formal panel, exact-review, protected-path and merge rules.
- Verify focused orchestration, implement, autopilot, composition, instruction tests.

## Step 3: prove distribution and behavior, then prepare the PR

- Depends on: steps 1-2. TDD mode: souple (integration/behavior evidence).
- Coordinator runs official pnpm derive and generated checks, build/typecheck/lint,
  pnpm test and required references, anti-bloat, doc parity, decision checks.
- Run bounded native probes with the actual resulting instruction text, covering
  independent research, trivial direct work and no-recursive delegated writer.
  Record observed tool actions and limits separately from text-contract tests.
  Keep delegation tools available in negative probes; otherwise no-spawn proves
  nothing. Missing-capability/isolation scenarios may be contract-only and must
  be labelled so. A read-only assigned-writer probe does not prove code delivery.
- Obtain one independent read-only review of the exact candidate. Fix targeted
  blockers, preserve review provenance and rerun affected checks only.
- Commit with why and AI attribution, push task branch and open PR against develop.
  Protected workflow changes require human merge; no publish or global install.

## Acceptance and handoff

Linear DEV-1019 owns mutable progress. Source and generated assets ship together.
The existing .void/program.md is preserved. Final report distinguishes source/PR
readiness from active installation and measured behavior from promised speedups.

## Verification scope adjustment

The first required suite exposed oversized and misclassified existing test proofs.
Five test files were corrected in separate commits without changing runtime code,
assertion deadlines or acceptance responsibilities: invocation, presentation, test
catalogue, native review and mission dispatch. This bounded work is necessary to
obtain reliable evidence for the requested workflow change. Initial failures and
changed-case results are preserved in
`docs/plans/2026-10-13-adaptive-delegation-verification.md`; the final independent
review checks the assertion mapping as well as the delegation contract.
