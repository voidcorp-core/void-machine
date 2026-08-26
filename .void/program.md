---
schemaVersion: 1
status: executing
program: knowledge-and-resume
plan: docs/plans/2026-08-17-knowledge-and-resume-plan.md
spec: docs/specs/2026-08-17-project-knowledge-system.md
progress:
  provider: linear
  scope: voidcorp/DEV/void harness
  order:
    [
      DEV-614, DEV-616, DEV-620, DEV-615, DEV-609, DEV-611, DEV-610, DEV-443,
      DEV-621, DEV-622, DEV-623,
    ]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates:
  - DEV-620
  - DEV-623
autopilot:
  schemaVersion: 1
  enabled: false
  clusterSize: 4
  base: develop
  mergeGate: human
  verifyCommands:
    - [pnpm, build]
    - [pnpm, test]
  ownership:
    sequential:
      - pnpm-lock.yaml
      - packages/cli/core-assets/**
      - packages/harness-graph/model.json
      - packages/harness-graph/catalog.v3.json
    reconcileOnly: []
---

# Program: knowledge and resume

This file is the stable global context for the executing program. It deliberately names neither a
current nor a next work unit. The provider declared under `progress` owns claims, dependencies,
review state and the remote resume trail; this file only locates that state.

The v3 program is not closed and none of its tickets were deleted: the pointer moved because
none of them had been started, its remaining work is end-of-cycle (certification, consumer
dogfood), and two of its tickets answer the same question as a more recent decision. See the
plan's "Pourquoi ce programme remplace le pointeur v3". Moving back is one frontmatter line.

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

`DEV-620` and `DEV-623` are human gates. The agent may collect evidence and request review, but
only Folpe's explicit approval can complete them.

They are gates for different reasons. `DEV-620` changes what every consumer receives and implies
a publication. `DEV-623` may not open at all: the spec conditions the whole interface on `resume`
having proved, in a terminal, that it saves time.

PR merge remains human. `autopilot` may select independent ready units only through its documented
attended confirmation flow. The program descriptor does not create a headless backend and
does not weaken single-writer rules for lockfiles, migrations, generated assets, or shared
contracts.

## Program completion

When all scoped implementation units are done and both human gates were explicitly approved, the
final program change sets this file's `status` to `completed`. It does not repoint itself to a
different plan or progress scope.
