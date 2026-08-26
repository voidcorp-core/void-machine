---
schemaVersion: 1
id: "adr:4152e915-f0f8-4763-888e-2bddd66da5a3"
createdAt: "2026-07-24T21:14:36.665Z"
title: "Ship tracker-owned active-program continuity to consumers"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Ship tracker-owned active-program continuity to consumers

## Context

Consumer projects have the same cross-session failure mode as the harness repository: a later
session can recover a plan but still execute a stale or remembered ticket, while the human tracker
shows outdated ownership and completion. The solution must work across supported runtimes and
trackers without placing Linear-specific identifiers or a mutable queue in universal doctrine.

## Decision

Ship a conditional, tracker-agnostic active-program bootstrap in every generated runtime document.

The bootstrap is dormant unless a project-owned `.void/program.md` has `status: executing`.
`ticket-writer` creates that pointer only after a human-approved multi-ticket plan is fully
materialized with native dependencies. The pointer stores immutable routing and lifecycle-state
names; the configured tracker owns status, assignee, blockers, resume comments, and review
evidence. `ticket-runner` claims before edits, hands off unfinished work, uses review state after a
green PR, and completes only after merge plus final verification.

Automatic continuity requires a tracker surface capable of reading and updating those fields. A
missing or failing surface stops execution. Specific user requests override automatic selection;
human gates and merges remain human.

## Consequences

Positive:

- Consumer sessions can resume with a plain continue request without restating a plan or ticket.
- Claude Code and Codex receive the same lifecycle contract from the shared renderer.
- Linear, GitHub, Jira, or another provider can participate through capabilities rather than
  hard-coded product names.
- The tracker remains a truthful human execution ledger instead of an after-the-fact mirror.

Negative:

- Tracker-backed continuity is unavailable when the provider cannot expose status, dependencies,
  assignment, comments, and review evidence.
- Ticket execution now includes mandatory tracker writes and bounded handoff comments.
- Existing consumers receive the new bootstrap only when their managed runtime block is refreshed.

## Alternatives considered

- Create `.void/program.md` during every `void-harness init`. Rejected because most projects do not
  have an active multi-ticket program and a placeholder would create noise or false activation.
- Encode Linear workspace/team/project fields in the generated doctrine. Rejected because core
  doctrine must remain provider-agnostic and usable outside VoidCorp.
- Keep a mutable plan resume point beside tracker status. Rejected because two execution ledgers
  inevitably drift.
- Let each consumer write its own bootstrap rule in project doctrine. Rejected because the
  lifecycle invariant is universal and duplicated local prose would diverge across runtimes.

## Reversal cost

Low. Remove the conditional paragraph and the three skill integrations; project-owned ACTIVE files
remain ordinary Markdown and tracker history remains valid. No consumer source or database
migration is involved.
