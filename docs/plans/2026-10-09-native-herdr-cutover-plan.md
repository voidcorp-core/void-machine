---
title: Native Herdr guard and reviewable cutover preparation
date: 2026-10-09
status: in-progress
spec: docs/specs/2026-10-09-native-herdr-cutover.md
ticket: DEV-1017
author: Folpe + Codex WORK-1
high_risk: true
---

# Goal

Replace the cockpit session ancestry guard through the existing hook distribution,
prove its behavior without active server effects, and prepare the personal migration
for final human approval. The full decommission acceptance criteria remain open.

## Steps

### Step 1: Freeze preparation and obtain ORCH's actual panel returns

- **Depends on**: none.
- **TDD mode**: exploratory (documents and mission preparation only).
- **Work**: read the full ticket and sources; create this plan and its linked spec;
  cite both in the local ticket before freezing. Use the ORCH-specified accepted
  DEV-930 CLI bundle for `mission start --ticket ... --mode team --json`, then
  `mission dispatch --id <actual-id> --json`. Save full outputs in local evidence.
- **Verification gate**: dispatch returns the canonical preparation envelopes;
  ORCH supplies actual invocation identities and completions; WORK-1 records only
  those real events. Controller action `run-lead-writer` permits tests/production.
  Diagnose an admission failure without replacing the mission or installing hooks.
- **Expected commit**: `docs(herdr): bound the cutover to preserve session ownership`.
- **Notes**: one writer, no worker specialist launches. Request one ADR footprint
  extension for the narrow global entrypoint/telemetry decision before that edit.

### Step 2: Deliver the smallest end-to-end guarded relay

- **Depends on**: step 1.
- **TDD mode**: strict.
- **Work**: first failing behavior in
  `packages/hook-runner/src/lifecycle/herdr-session-executor.test.ts` and
  `packages/hook-runner/src/cli.test.ts`; commit RED before production. Then add
  `packages/hook-runner/src/lifecycle/herdr-session-executor.ts` and the bounded
  early branch in `packages/hook-runner/src/cli.ts`. Extend the existing
  `packages/core/hooks/lifecycle-hooks.test.ts` bundled-entrypoint proof.
- **Verification gate**: safe real process/fixture-command tests prove ownership,
  exact bytes, all refusal cases and finite failure handling from the spec. The
  actual bundle is exercised outside an installed project and writes no journals.
  Native script fixtures are invoked once only after proof. No active Herdr I/O.
- **Expected commits**:
  - `test(herdr): expose unsafe session relay before replacing the cockpit guard`
  - `fix(herdr): prove foreground ancestry before publishing native sessions`
- **Notes**: retain red command/exit/output and full SHA; do not use an import
  failure as the only behavioral RED. Regenerate bundles with `pnpm hooks:build`;
  run build prerequisites from the installed frozen dependencies. Do not hand-edit
  generated outputs, lockfiles, installed `.void/hooks` or personal configuration.

### Step 3: Prepare migration, verify and return an exact review candidate

- **Depends on**: step 2.
- **TDD mode**: strict for behavioral corrections; exploratory for migration evidence.
- **Work**: update `docs/ORCHESTRA.md` and `docs/CODEX.md`; create the unapplied
  hooks-only migration diff and drift/backup/rollback packet under local evidence.
  `packages/core/codex/hooks.json` stays unchanged unless a concrete necessity is
  reviewed; a project hook does not secure a parallel global native route.
- **Verification gate**: focused tests green, then `pnpm build`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm derive:check`, `pnpm sync:docs`,
  `pnpm skills:check-references` and `pnpm version:check`; `pnpm decisions:check`
  if the ADR extension is authorized. Regenerate relevant mirrors only through
  official builders. Classify every failure before proceeding; no retry-to-green.
- **Expected commit**: `docs(herdr): keep personal activation reversible and explicit`.
- **Notes**: commit-only. Return full candidate SHA/base/acceptance hash to ORCH for
  one independent read-only native review. Keep applicable verification running
  during review. Correct at most two coherent batches with targeted rechecks.
  Record writer/reviewer events from real evidence; never fabricate completion.

## Review checkpoints and approval boundary

ORCH owns preparation and independent review dispatch. Existing implementation
authorization supersedes a routine plan-approval pause; the preparation evidence
gate still applies. New consequential scope or the proposed ADR footprint extension
goes to ORCH before writing. The final concrete migration packet goes to Folpe
before any personal configuration, plugin retirement or live restart operation.
No broad repeat panel or additional release/merge authority is implied.

## Execution handoff

| Order | Unit | Dependency | Evidence owner | Human gate |
| --- | --- | --- | --- | --- |
| 1 | Canonical preparation | Full DEV-1017 record | WORK-1 journal; ORCH invocations | New scope only |
| 2 | Guard behavior and bundle | Actual preparation returns | WORK-1 | None routinely |
| 3 | Verified commit and migration packet | Guard proofs | WORK-1; ORCH independent review | Personal activation remains pending |

Linear owns mutable ticket progress; ORCH owns provider updates and integration.
The central schema-1 WORK-1 report carries proof paths and the next physical action.
This plan does not mark DEV-1017 or outstanding DEV-1016 live proofs complete.
