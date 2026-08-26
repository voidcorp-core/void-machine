---
schemaVersion: 1
id: "adr:4f0cad51-1167-4b04-9d5d-a9c1c1605d26"
createdAt: "2026-07-24T21:03:52.995Z"
title: "Use one active-program pointer with Linear-owned progress"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Use one active-program pointer with Linear-owned progress

## Context

The v3 program spans many Linear tickets and more than one interactive agent session. Each clean
session must recover the approved global design and the actual unit of work without asking the
maintainer to repeat either one. A next-ticket marker duplicated in the repository would drift from
Linear as tickets are claimed, blocked, reviewed, or completed. Linear also needs to remain useful
to humans as the authoritative view of ownership, evidence, and progress.

## Decision

Use one repository-level `.void/program.md` pointer for immutable program routing and use Linear as
the sole owner of mutable execution progress.

When the pointer has `status: executing`, both supported runtimes load its plan and spec, recover an
already-started scoped issue or select the first ready one from native status and `blockedBy`
relations, fetch the complete issue, and run the ticket workflow. The workflow claims the issue
before edits, records a bounded resume trail when unfinished, attaches review evidence, and moves
the issue to `Done` only after merge and final verification. Tracker failure stops execution rather
than activating a local fallback. Human checkpoints and merges remain human actions.

## Consequences

Positive:

- A new session needs only a plain continue request, not a repeated plan or ticket pointer.
- Global architecture stays visible while each implementation unit remains grounded in its full
  Linear issue.
- Ownership, dependencies, blockers, review evidence, and completion have one authoritative ledger.
- Interrupted sessions can be resumed without silent duplicate work or a stale local queue.

Negative:

- Program execution depends on the configured tracker being readable and writable.
- Every working session must maintain issue state and a concise resume trail as part of completion.
- Multiple scoped issues already marked `In Progress` require explicit ownership resolution.
- This is interactive session continuity, not unattended or scheduled headless execution.

## Alternatives considered

- Store and update a mutable next-ticket field in `.void/program.md`. Rejected because it creates a
  second execution ledger and can diverge from Linear.
- Hard-code the current issue in `AGENTS.md` and `CLAUDE.md`. Rejected because every transition
  churns permanent doctrine files and makes cross-runtime parity fragile.
- Use Linear alone without an active program pointer. Rejected because a ticket provides local
  acceptance criteria but not a reliable route to the approved global plan and specification.
- Run a headless daemon. Deferred because the current harness deliberately relies on inherited
  in-session authentication, connectors, subscription, and human merge gates.

## Reversal cost

Low. Mark the active pointer completed or remove it, and the generic bootstrap becomes inert. Linear
records remain valid project history, and no runtime-specific state must be migrated.
