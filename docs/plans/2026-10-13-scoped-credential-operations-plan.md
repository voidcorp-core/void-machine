---
title: Ship the approved scoped credential policy
date: 2026-10-13
status: executing
spec: docs/specs/2026-10-13-scoped-credential-operations.md
ticket: DEV-1020
author: Folpe + Codex
high_risk: true
---

# Scoped credential policy execution

The user approved the written contract and its implementation in the current release on
13 October. Deliver the portable policy in the existing security standard and session context.
No live secret operation, provider integration or file-guard exception is in scope.

## Step 1: align emitted context and operational policy

- Depends on: approved spec; actual security preparation context
  `/root/credential_policy_preparation`, verdict pass with least-privilege clarification folded in.
- TDD mode: strict for the emitted context change; source-policy and generated-asset checks.
- Writer: one isolated native worker, commit-only. Coordinator owns delivery. Other worktrees
  and generated assets are preserved; one local test/build process at a time.
- Files: `packages/hook-runner/src/lifecycle/context.ts` and `context.test.ts`;
  `packages/core/skills/void-security-guidance/SKILL.md` and `.source`;
  `packages/core/skills/void-autopilot/SKILL.md` (consent distinction only);
  `docs/plans/skill-audits/void-security-guidance.md`; `docs/ARCHITECTURE.md`;
  new immutable decision via `void-machine decisions new`; this spec/plan. Normal generated
  assets are regenerated with existing builders, never patched independently.
- Expected commits: documentation/decision; RED context regression; policy implementation.
- Keep the session-start rule concise: bounded explicit authorization, opaque direct external
  transfer, no visible value, existing local/runtime protections; point to security-guidance.
- Security standard owns detailed scope, privileges/lifetime, metadata-only verification,
  success/error confidentiality, uncertainty reconciliation and refusal conditions. Autopilot
  consent alone never grants credential operations. Retain reviewer read-only restrictions.
- No new skill, broker, permission registry, environment override, provider allowlist or dependency.

## Verification gate

Observed context RED before implementation and GREEN after. Run context, protected-file,
secret-content and enforcement regression tests with maxWorkers=1; run targeted typecheck/lint,
anti-bloat and normal derivation/package checks sequentially. Existing guards must retain refusal
behavior. Full suite is covered by required remote CI, not another local parallel run.

Coordinator runs independent read-only native scenario evaluations from the spec, using only
synthetic non-secret inputs and declared mock transport facts, and preserves genuine output.
These establish instruction behavior, not live provider transport confidentiality. Fresh independent
review of exact final commit includes the security boundaries and packaged instructions. Any
blocking defect is corrected before the new release candidate is accepted.

## Delivery and continuity

Existing user mandate covers publication and this contract's implementation; routine execution
choices do not add another approval gate. Push PR to develop after final independent review.
Require CI and merge evidence, then requalify the resulting release artifact with DEV-930.
Existing protected paths and main promotion authority remain unchanged.

## Resume point

Writer implementation and normal asset derivation are complete. RED is recorded in `7ea702f5`;
the context and unchanged protection suites pass (110 tests), as do targeted skill regressions
(112 tests), hook-runner typecheck and targeted lint. The accepted decision is
`adr:a8bc006f-7264-4788-b804-62ae23e2214a`. Coordinator retains synthetic scenario evaluations,
independent review of the committed candidate, remote CI and publication. The worker's central
report carries the exact candidate and command evidence; no live provider has been qualified.
