---
schemaVersion: 1
status: executing
program: ci-economy-2026-11
plan: docs/plans/2026-11-05-ci-economy-plan.md
spec: docs/specs/2026-11-05-ci-economy.md
progress:
  provider: linear
  scope: voidcorp/DEV/void machine
  order: [DEV-1204, DEV-1139, DEV-1140, DEV-1141, DEV-1142, DEV-1143, DEV-1144, DEV-1145]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: [DEV-1204, DEV-1139, DEV-1141, DEV-1144]
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

# Programme: CI economy

This descriptor activates the approved CI programme in this worktree. It replaces
the release-4 descriptor after the coordinator reconciled its completed pool and
the native CI ticket relations. The protected descriptor change remains subject
to independent review and human merge; it does not alter another checkout.

Folpe explicitly requested applying the 5 November CI audit in its recommended
order with `void-autopilot`. That request supplies the `enabled: true` consent.
The scope includes parent DEV-1138 and its ordered child pool, plus DEV-1204.
On 8 November Folpe explicitly requested correcting the audited consumer issues
through autopilot. DEV-1204 is admitted first under that extension; the existing
CI programme and remaining pool are preserved. GitHub #535 and #536 remain
subsequent requested work, not automatically admitted by this descriptor. One worker preserves
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

Complete this programme through an explicit descriptor change; never repoint it
silently to another work pool. Completion follows verified native
closure of the agreed units, with a measurement-only conclusion allowed where the
spec makes optimization conditional.

## Consumer reliability extension (8 November)

DEV-1204 repairs the confirmed generated Git cache false positive and makes the
supported publication path stop on guard refusal. Its full Linear acceptance
criteria govern scope, including auditable human renewal with preserved proof.
Use strict TDD for the publication boundary and independent exact-head review.
Keep sensitive Git state guarded; no baseline reset, direct-Git security claim,
consumer edits, release or deployment is authorized. The protected diff needs
human merge after the candidate and CI are ready. This is a scoped extension
explicitly requested by the maintainer, not completion of the existing CI pool.
