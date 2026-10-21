---
schemaVersion: 1
id: "adr:5042ae80-4b51-4fcf-a38d-5df4e44ece4e"
createdAt: "2026-10-21T10:15:52.479Z"
title: "Defer draft integration without manufacturing successful checks"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Defer draft integration without manufacturing successful checks

## Context

Every development update currently launches the complete CI matrix. Recent observed runs
cost 4m55 on a PR, 6m21 on its merge group and 6m01 again on develop push. These are
individual observations, not latency promises. GitHub requires the same checks on PRs
and merge groups. Skipping a required job reports success and can leave false evidence
on an unchanged head when a draft becomes ready.

## Decision

Use focused local verification during draft development, then real complete validation
on ready PRs and merge groups, with explicit non-admission of drafts inside required jobs.

The admission guard and adoption template live beside the installed `void-verify` skill.
This repository executes that same guard. Required checks and independent review remain
unchanged. Only runs for the same PR cancel one another; queue/manual/release runs use
unique run identities. Remove the redundant develop push CI; promotion consumes push
independently, review publication follows merge-group CI requests, and main keeps release
verification. Consumer adoption remains explicit and adapts actual project commands.

## Consequences

Positive:

- Draft iterations avoid package installation and heavy runner matrices.
- Readiness without another commit runs genuine integration checks.
- Consumers receive executable assets through the existing runtime skill installer.

Negative:

- Drafts show an expected red admission check, explicitly stating no tests ran.
- Ready PR and queue validation both remain necessary under GitHub's coupled checks.
- Remote Actions scheduling remains an integration proof; local event tests cannot prove it.

## Alternatives considered

- CI only after merge: admits broken integration and fails the protection contract.
- Skip all required jobs for drafts: GitHub reports success without tests.
- A new custom check publisher or CI engine: larger authority surface than the existing
  workflow, plus credentials and a migration with no demonstrated need.
- Automatic consumer workflow rewrites: cannot know each project's release and validation
  contracts; an explicitly adopted template preserves their owners.

## Reversal cost

Low. Restore previous triggers and remove admission steps together. This reinstates draft
CI expense without changing remote protection, existing missions or review budgets.
