---
schemaVersion: 1
status: executing
program: autonomous-until-develop
plan: docs/plans/2026-09-10-native-void-machine-pivot-plan.md
spec: docs/specs/2026-09-10-native-void-machine-pivot.md
progress:
  provider: linear
  scope: voidcorp/DEV/void harness
  order: [DEV-820]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: []
autopilot:
  schemaVersion: 1
  clusterSize: 4
  base: develop
  mergeGate: union-reviewed
  deployBranch: main
  verifyCommands:
    - [pnpm, build]
    - [pnpm, test]
  ownership:
    sequential:
      - pnpm-lock.yaml
      - packages/cli/core-assets/**
      - packages/harness-graph/model.json
      - packages/harness-graph/catalog.v3.json
      # DEV-677 and DEV-673 both rewrite the merge grant, so the router must
      # sequence them rather than fan them out. Declared here rather than left to
      # footprint inference, because a semantic conflict in the guard that
      # authorizes a merge is the one no tooling resolves after the fact.
      - packages/cli/src/lib/autopilot/union-review.ts
    reconcileOnly: []
---

# Program: autonomous until develop

## Reliability sequence approved on 2026-09-05

The target direction is [Void Machine](../docs/VOID-MACHINE-VISION.md), supplied
by Folpe on 2026-09-05. DEV-833 must start by confronting it with the repository
and applicable decisions, then propose a spec and a migration for approval.
Recording this vision does not authorize an immediate rewrite or replace the
executing plan. Historical accepted decisions remain intact.

Folpe places the reliability sequence before expanding the native kernel:
DEV-831 repairs preparation review progress; DEV-832 proves the real implement,
autopilot and brainstorm paths, including interruption and cleanup; DEV-822
carries reliable test guidance into consumers; DEV-395 finishes the GStack
teardown; DEV-833 is a brainstorm with Folpe about measured product value.
Notify Folpe when DEV-833 becomes ready and conduct it together. Do not infer
approval from green CI or complete this discussion autonomously.

The complete ordered chain is visible on the open epic
[DEV-807](https://linear.app/voidcorp/issue/DEV-807), not only in the completed
DEV-666 audit. Native Linear dependencies own readiness and mutable progress.
The measurement discussion is now closed as a direction decision. The active
programme uses the native Void Machine pivot spec and plan. VM-01 through VM-06
are merged; VM-07 (DEV-820) is the current descriptor and does not authorize a
native cutover beyond the bounded unit currently in progress.

Implement owns one ticket's risk-appropriate quality cycle. Autopilot owns
dependency selection, isolation, recovery, resource limits, cleanup and exact
integration. The DEV-833 discussion compares their added value under controlled
conditions before choosing further mechanisms; it is not a claim that the
existing layers have already earned their cost.

This file is the stable global context for the executing program. It deliberately names neither a
current nor a next work unit. The provider declared under `progress` owns claims, dependencies,
review state and the remote resume trail; this file only locates that state.

On 2026-09-10, the approved native pivot replaced the unadmitted measurement
chain as the active delivery path. The campaign artefacts remain versioned
research history; the execution handoff in the pivot plan owns DEV-820.

The pointer now follows the native Void Machine foundation. VM-03 established
the portable skill package boundary, VM-04 established durable no-effect proof,
and VM-05 certified the Codex subscription adapter, while VM-06 certified the
Claude subscription adapter. The only human
promotion gate remains the branch that deploys.

`progress.order` is a deterministic tie-break among ready units, not mutable
execution state. The current order starts with VM-07 after VM-06's merged
handoff.

The measurement discussion was explicitly concluded on 2026-09-10. No
per-ticket human gate is declared for the native pivot; promotion to the
deploying branch remains human.

**Corrections land in the artefact being worked on, never in a successor.** Spec drift is the
documented failure of this whole family of workflows -- the files stop matching what
implementation revealed -- and it is caused by deferring. Three corrections went into the spec and
the plan the day they were found rather than into a "v2": the unconstrained argv, the three causes
absence conflated, and the six unattended hours nobody could read.

**And a correction names what it touches before it lands.** A correction is local and urgent while
doctrine is global and quiet, so the cheapest move is to solve the immediate problem and not notice
that a decision forbade it. Honouring a decision, or touching none, is applied in place and said
out loud. Contradicting one is not a correction at all: it is a supersession, and it goes through
the decision file that already exists for that. See the decision on correcting in flight unless it
supersedes.

## Sources of truth

Read these before selecting or executing work:

1. the global plan named in frontmatter, including its architecture, checkpoints, verification
   gates, execution handoff, and resume point;
2. the approved spec named in frontmatter;
3. the complete selected work unit from the declared progress provider, including native
   relations and current state;
4. `AGENTS.md` or `CLAUDE.md` and the current repository state.

The global plan supplies intent and sequencing. The provider-native record is the executable unit.
Do not implement from a remembered or summarized record.

## Automatic session bootstrap

When the user asks to continue, start, resume, or otherwise execute the program without naming a
work unit:

1. Resolve the adapter named by `progress.provider` and query the opaque `progress.scope`.
2. Fetch full details and relations for every candidate needed to decide readiness.
3. If exactly one unit is in a `progress.states.started` state, resume it.
4. If several units are started, report the competing claims instead of guessing ownership.
5. Otherwise select the first ready unit from `progress.order` whose native blockers are done.
6. Fetch the selected unit and relations again immediately before claiming it.
7. Claim it through the provider adapter, then execute it with `void-implement`.

If the provider cannot be resolved, stop only the action that needs it; the program and local
checkpoint remain readable. A specific user request or explicit work unit always overrides
automatic selection.

## Progress lifecycle

The declared provider is part of execution, not an after-the-fact mirror.

- **Claim**: set the issue to `In Progress` and assign it before the first implementation edit.
- **Progress**: keep native `blockedBy` relations accurate. Add a concise comment when a material
  blocker, scope decision, or external dependency changes the execution contract.
- **Session handoff**: if work remains when a session ends, keep the issue `In Progress` and add one
  bounded resume comment containing branch/worktree, last verified result, remaining work, blocker,
  and the exact next action.
- **Review**: after all ticket gates pass, attach the PR and evidence, summarize verification in a
  comment, and move the issue to `In Review`.
- **Completion**: move the issue to `Done` only after the PR is merged and final verification
  confirms the merged state.
- **Failure**: if the provider cannot be read or updated, stop. Do not claim another unit or
  maintain a local substitute for progress state.

Never place secrets, full prompts, full model responses, or private consumer source in the
provider.

## Human gates and autonomy boundary

Checkpoint A was read on 2026-08-30 and is closed: the panel convened before the writing, refuted
a stale ticket premise from four independent lenses, and the run closed six production merge
grants. What it also revealed -- a context pack that was empty at the stage where the panel
convenes first -- was fixed inside the same unit.

The gate now is the merge of the integration PR into `develop`, and promotion to `main` stays
human as always. Findings are arbitrated inside the cycle by the forced comparison against the
unit in progress, so no queue accumulates and no human is a bottleneck on them.

Promotion to `main` remains human, and what a person judges there is the feature. The integration
PR into `develop` merges itself only once an adversarial reading of the whole integrated diff came
back clean; unread, inconclusive or stale all refuse. `autopilot` may select independent ready units
only through its documented attended confirmation flow. The program descriptor does not create a headless backend and
does not weaken single-writer rules for lockfiles, migrations, generated assets, or shared
contracts.

## Program completion

When all scoped implementation units are done and both human gates were explicitly approved, the
final program change sets this file's `status` to `completed`. It does not repoint itself to a
different plan or progress scope.
