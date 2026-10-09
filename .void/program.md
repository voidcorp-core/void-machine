---
schemaVersion: 1
status: executing
program: release-4-stabilization
plan: docs/plans/2026-09-28-release-4-1-delegation-and-autonomous-merge-plan.md
spec: docs/specs/2026-09-28-supervised-agent-delegation.md
progress:
  provider: linear
  scope: voidcorp/DEV/void machine
  # Selection belongs to the curator, which reads the project and the tracker;
  # the continuous loop never reads this list. It bounds a resume that names no
  # unit: the plan's order, the release gate held by a person.
  order: [DEV-921, DEV-922, DEV-923, DEV-924, DEV-925, DEV-926, DEV-927, DEV-928, DEV-929, DEV-930]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: [DEV-923, DEV-928, DEV-930]
autopilot:
  schemaVersion: 2
  clusterSize: 4
  base: develop
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
    reconcileOnly: []
  # Additions only. The floor lives in PROTECTED_PATHS_FLOOR and already covers
  # `.github/**`, the installed hooks, the loop's own sources, the refusal to
  # merge into the branch that deploys, and the scripts that judge a merge or a
  # publication; this list can widen that ground, never narrow it.
  protectedPaths: []
---

# Program: release 4 stabilization, now 4.1.0

## Scope, since 28 September 2026

4.0.0 is published (DEV-905, DEV-908 and DEV-909 delivered). The programme now
carries 4.1.0, in the order of the plan named in frontmatter: DEV-921 to DEV-930,
the sub-tickets of DEV-902 (supervised agent delegation, agnostic of runtime and
display) and DEV-920 (autonomous merge with no setup in a consumer project).
DEV-923 and DEV-928 end on a checkpoint Folpe reviews; DEV-930 holds the
promotion and the release, a human gate.

Since DEV-927 there is one merge mode: the loop merges into `develop` on a
local verdict bound to the head, unless a person holds the merges with
`void-machine autopilot merges --by-human`; never into `main`, and never a pull
request touching the machinery that judges merges, which goes to a person. This
repository keeps its review App as a required check, which GitHub enforces at
merge time. Promotion and release stay a person's.

Corrections stay in the artefact being worked on. A change contradicting an
accepted decision requires supersession, never an in-place rewrite.

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

Checkpoint B was read on 2026-09-24 and is closed: the continuous loop merged DEV-682 (#401) and
DEV-860 (#402) into `develop` with nobody acting, then #404 and #405 went through the merge queue
on signed verdicts. The cluster engine was removed after it, as the plan's step 7 required.

The loop arms a merge into `develop` only on a head carrying the review App's check, through the
merge queue, and never on a pull request that touches the machinery that judges merges: those go
to a person. Promotion to `main` remains human, and what a person judges there is the feature. The
program descriptor does not create a headless backend and does not weaken single-writer rules for
lockfiles, migrations, generated assets, or shared contracts.

## Program completion

When DEV-905, DEV-908 and DEV-909 are delivered and 4.0.0 is published with
verified provenance, and DEV-902 is delivered into `develop`, the final
programme change sets `status` to `completed`. This programme never repoints
itself to a different plan or progress scope.
