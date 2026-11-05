---
schemaVersion: 1
status: executing
program: ci-economy-2026-11
plan: docs/plans/2026-11-05-ci-economy-plan.md
spec: docs/specs/2026-11-05-ci-economy.md
progress:
  provider: linear
  scope: voidcorp/DEV/void machine
  order: [DEV-1139, DEV-1140, DEV-1141, DEV-1142, DEV-1143, DEV-1144, DEV-1145]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: [DEV-1139, DEV-1141, DEV-1144]
autopilot:
  schemaVersion: 2
  enabled: true
  clusterSize: 1
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
  protectedPaths: []
---

# Proposed programme: CI economy

This is a proposed replacement descriptor, not the active `.void/program.md`.
Its frontmatter is prepared for activation. Only the coordinator may replace the
old descriptor after reconciling its completed units and the native CI ticket
pool. Until then, this file grants no runtime selection by its location.

Folpe explicitly requested applying the 5 November CI audit in its recommended
order with `void-autopilot`. That request supplies the `enabled: true` consent.
The scope is parent DEV-1138 and the ordered child pool above. One worker preserves
the requested order and prevents collisions on CI configuration and generated
assets. Work outside this bounded pool is not admitted by this programme.

The plan supplies global intent and proof boundaries. The complete provider-native
record is the executable unit; native blockers determine readiness and the order
breaks ties. Fetch full records and relations before claim, use `void-implement`
for each unit, and retain real review and verification evidence. Linear owns
mutable state, assignment, blockers and completion. Do not put a current/next unit
or copied progress checklist in this descriptor or the checkpoint.

On resume, recover exactly one started scoped unit; surface competing started
claims. Otherwise select the first ready scoped unit with satisfied native
blockers. If the adapter cannot read or update the required state and evidence,
stop that action instead of inferring remote progress. DEV-1142 requires DEV-1141;
other requested sequencing is not represented as fabricated technical blockers.

`protectedPaths: []` adds nothing and removes nothing from the kernel's protected
floor. Every actual protected diff, including the active programme, workflow
files and verification authority, requires human merge. `humanGates` marks known
protected units, not an exhaustive exemption list. Prepare the reviewed PR and
proof before the handoff. Observe any local merge hold and the kernel's bounded
waiting behavior; do not keep claiming units past a protection wait it imposes.

Autopilot may merge an admissible exact reviewed head only into `develop`, with
required checks and native merge-queue policy. Workers remain commit-only and
cannot write shared Git state. Promotion to `main`, publication to npm, changing
live protection and external consumer adoption are outside this mandate. Local
focused-proof reuse is conditional on measured value; a bounded investigation
may conclude that no new mechanism is justified.

Activate and later complete this programme through an explicit descriptor change;
never repoint it silently to another work pool. Completion follows verified native
closure of the agreed units, with a measurement-only conclusion allowed where the
spec makes optimization conditional.
