---
title: Autopilot consumer readiness grounded in the current repository and runtime
date: 2026-09-12
status: in-design
author: Folpe + Codex
ticket:
related:
  - docs/specs/2026-07-25-autopilot.md
  - docs/specs/2026-08-26-program-resume-contract.md
  - docs/plans/2026-08-30-autopilot-that-runs-plan.md
---

# Problem and outcome

Void Cortex cannot run a conforming Codex cluster. An inherited program targets
Void Starter, the adapter requires an environment argument unavailable in the
live spawn tool, and develop has no server-side protection. Installation
presence must never be presented as verified execution capability.

The outcome is one small, real Codex cluster reaching its integration PR with
isolated worktrees, central durable journals, coherent reservations and reviewed
reconciliation. Missing prerequisites stop before ticket claims or worker
writes. A corrective release follows passing CI and the observed cluster proof.

## Evidence observed on 2026-09-12

- Void Cortex contains `.void/active.md`, but no `.void/program.md`. Its Linear
  project ID resolves to Void Starter. Its referenced plan and spec exist, so
  checking file existence alone cannot detect a copied foreign declaration.
- `programPath` in `packages/cli/src/lib/autopilot/program.ts` accepts legacy
  paths; `readProgramDescriptor` adapts their schema without establishing the
  repository-to-provider association.
- `packages/core/skills/void-autopilot/references/codex-subagents.md` requires
  VOID_PROJECT_ROOT in the child environment. The live spawn_agent schema has
  neither an environment field nor a working-directory field. A prompt or a
  shell export does not establish the environment of runtime-launched hooks.
- Doctor observes installed adapters and an existing .git entry, with tracker
  and branch protection explicitly unprobed. Those observations do not prove
  the worker can execute, journal centrally or reserve the correct tickets.
- GitHub classic protection returned 404 Branch not protected for Cortex
  develop; the effective branch-rules endpoint returned an empty list.
- `packages/cli/src/lib/project-roots.ts` already distinguishes workRoot from
  installRoot. Hook CLI and event recording currently use other root resolution.

## Alternatives

1. Recommended: repair the existing contracts and share their observations.
   Reuse root resolution and the deterministic autopilot core, replace implicit
   migration with explicit admission, and validate real runtime capabilities.
   This addresses the demonstrated failures with a bounded compatibility change.
2. Patch each symptom locally: doctor wording, adapter prose and one GitHub API.
   Smaller initial diff, but independent readers can still disagree and worker
   journals still require an end-to-end ownership contract.
3. Replace orchestration with a new native execution backend. Potentially a
   stronger long-term boundary, but it expands the corrective release into a
   runtime migration and cannot itself supply missing GitHub protection.

## Proposed design

### Explicit program admission

Only a validated canonical `.void/program.md` may authorize execution. Legacy
files remain inspectable migration inputs, never execution consent. Diagnostics
name every discovered file, the selected source, and the exact rejection.

A deliberate declaration operation previews the repository identity, resolved
provider project, plan/spec, base/deployment branches and consent. It creates
the canonical descriptor exclusively. Existing canonical content is never
silently replaced; legacy content is preserved and any archival or migration
requires an explicit, reviewable operation with recoverable original bytes.

Persist an explicit association between repository identity and the resolved
provider scope at declaration. Validate physical containment and readability of
plan/spec, repository association, provider project existence and ticket
membership before admission. A missing provider means unverified, never local
inference. Do not impose one Linear project per repository: the declaration
selects the intended association explicitly. Copied declarations that claim a
different repository cannot authorize a new run.

Offline inspection stays offline and distinguishes local validity from remote
verification. The exact command names and schema migration belong in the plan.

### Worktree execution and central evidence

Keep workRoot for code, relative paths and enforcement. Keep the run's main
installation root for central journals. Reuse existing root resolution without
introducing a CLI-to-hook-runner dependency cycle; preserve its special Git
layout handling rather than assuming the parent of .git is a checkout.

The controller persists the run-to-worktree-to-repository association before
dispatch. Hook/event resolution validates that association against Git identity
and the controller's reservation. Workers cannot redirect evidence with an
arbitrary copied path. Unregistered ordinary worktrees retain their normal
installation behavior. Ambiguous or missing run ownership blocks the cluster.

Do not rely on spawn arguments absent from the live tool. Use its actual
capabilities, explicit per-operation worktree paths and observed worker startup
proof. A worker must prove its assigned Git branch/worktree and centrally
recorded event before production edits. If hook payloads or runtime behavior
cannot establish the association, report unavailable and stop. A simulated
shell hook is not proof that the native runtime fired it.

Journals include run and worker identity, survive worker cleanup, and use the
existing concurrency-safe writer. Preserve code enforcement inside the worker
tree; centralizing logs must not exempt worker edits from checks.

### One readiness judgment

Doctor and autopilot consume the same check results: installed, unverified,
verified, unavailable or invalid, with observation source, scope and remedy.
Doctor may inspect without network or writes; it cannot certify unprobed checks.
Autopilot requires fresh applicable proofs before reserving tickets, then checks
each worker's startup proof before authorizing edits. Refusal or partial startup
releases only this run's reservations and preserves its diagnostic evidence.

Collect independent cheap failures together so the operator sees all remedies
in one report. Stop dependent expensive work immediately on failure. No retries,
timeout increases or silent degraded execution turn a failed gate green.

### Effective GitHub protection

Read classic protection plus active rules effective for the exact branch,
including organization rules and pagination. Do not mistake unrelated, disabled
or evaluate-only rulesets for enforcement. Distinguish absence from unreadable
or malformed responses; uncertainty cannot grant execution or merge.

Evaluate the effective requirements, not the mere existence of a rule: pull
requests, applicable required CI checks on the up-to-date integration, no force
pushes/deletion, and no applicable worker bypass. Read necessary ruleset details
to assess bypasses rather than claiming the branch endpoint proves them.

When absent, produce a reviewable minimal configuration with actual branch and
check names and a precise Settings/API action. Never apply it automatically.
After human application, re-read GitHub before proceeding. Lack of protection
is not solvable by a local human-merge convention.

## Verification and release

Use strict TDD for admission, root resolution, readiness and protection logic.
Regressions cover legacy-only, foreign-but-existing references, multiple files,
missing/escaping references, repeated declaration and no silent overwrite;
missing spawn fields; distinct worktrees with central concurrent events and
post-cleanup retention; incorrect run ownership; doctor/preflight parity;
classic/ruleset/both/absent protection, org inheritance, nonapplicable rules,
bypasses, pagination and API errors; reservation rollback and idempotent resume.

Run one two-ticket cluster with disjoint footprints in the real Codex runtime:
admission, reservation, separate worktrees, native hooks observed centrally,
worker commits, review, reconciliation and one integration PR. Verify tracker
state against the actual reservation and keep completed tickets pending merge.
Record version, runtime/tool capabilities, Git SHAs and concrete evidence.

Void Cortex is the target consumer. Its cluster cannot start until a correct
program is explicitly admitted and a human applies the required protections.
Mocks, fixture-only success or a cluster on another repository cannot certify
this consumer. Keep these external prerequisites visible while implementing
and testing the harness correction independently.

Build and test the release candidate through the normal package path, then
exercise that candidate in the consumer. Use release-please for the corrective
version, CI and the normal publication workflow; never hand-edit versions or
weaken protection. Verify the published package and consumer update. Record any
remaining runtime or external limitation as such, never as conforming autopilot.

## Design status

Draft self-reviewed for scope, ambiguous ownership, missing runtime capabilities
and external gates. No implementation authorized by this draft alone. Approval
is followed by an implementation plan, including any required supersession of
accepted legacy-compatibility decisions without rewriting their history.

References: GitHub effective rules API
<https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch>;
official subagent documentation <https://learn.chatgpt.com/docs/agent-configuration/subagents>.
The live tool schema is the authority for this session's available spawn inputs.
