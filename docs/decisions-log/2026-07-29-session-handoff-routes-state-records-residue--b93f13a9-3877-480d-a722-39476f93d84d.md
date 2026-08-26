---
schemaVersion: 1
id: "adr:b93f13a9-3877-480d-a722-39476f93d84d"
createdAt: "2026-07-29T17:57:31.881Z"
title: "Compose durable program context with local session residue"
status: accepted
deciders: ["folpe"]
supersedes:
  - "adr:4f0cad51-1167-4b04-9d5d-a9c1c1605d26"
  - "adr:4152e915-f0f8-4763-888e-2bddd66da5a3"
---

# Compose durable program context with local session residue

## Context

Work in this harness spans sessions. A later session needs two different views: the durable global
state of the programme, and the short-lived residue of what happened just before one local stop.
Treating them as one document creates a reconciliation problem because global context belongs in
Git while a checkpoint changes at every close and belongs to one machine.

The earlier programme decisions put immutable routing in `.void/program.md` and mutable progress in
Linear or another capable tracker. That separated routing from progress, but coupled automatic
continuity to a remote provider and left no offline place for dead ends, assumptions, or evidence
freshness. A tracker comment cannot be the only session handoff, and a local checkpoint cannot
become a second progress ledger.

The boundary is therefore not "active versus handoff". It is global programme context, provider-
owned mutable progress, and local session residue, composed only when a runtime needs to resume.

## Decision

Use `.void/program.md` as the project-owned, versioned programme descriptor. It carries programme
identity, plan and spec links, optional provider-neutral progress routing, stable unit order, human
gates, and explicit autopilot consent. It never stores a current or next unit. When a progress
provider is declared, that provider owns mutable state; when it is absent or a capability is
unavailable, only the remote action requiring it stops.

Replace `.void/machine/checkpoint.md` at every deliberate session close. It is local, ignored,
offline-readable, bound to branch and HEAD, and contains only residue no other artefact owns:
dead ends, open assumptions, proof freshness, and one exact physical resume action. It never stores
programme priority or a current or next unit.

Compose programme, checkpoint, and Git into one `ResumeBundle` for CLI and runtime consumption.
Both runtimes inject that same bundle at documented session starts. `UserPromptSubmit` may remind
the model when the user explicitly intends to close a session; `SessionEnd` may audit presence,
freshness, branch, and HEAD. Hooks remain advisory and never write semantic checkpoint content.

## Consequences

Positive:

- The programme gives a versioned project overview without becoming a mutable execution cursor.
- The checkpoint survives an offline close and records the expensive knowledge that Git and the
  provider do not hold.
- `ResumeBundle` removes reconciliation from callers: each source keeps one responsibility and the
  read model composes them.
- Linear, GitHub, Jira, another adapter, or no provider can use the same programme contract.
- A stale checkpoint is visible through its branch and HEAD instead of being trusted silently.

Negative:

- Two files exist because they have different ownership and lifetimes; readers must use the bundle
  rather than picking one as a complete handoff.
- A deliberate close still requires model judgment. A direct clear or crashed process may leave no
  fresh checkpoint, and the final audit can only report that fact.
- Provider-backed automatic selection remains unavailable when the declared adapter lacks the
  required capability.

## Alternatives considered

- **Keep programme and checkpoint in one versioned file.** Rejected because a per-session rewrite
  would churn shared Git state, conflict across machines, and mix global context with local residue.
- **Keep all continuity in the tracker.** Rejected because it couples local recovery to network and
  provider availability, while dead ends and local proof freshness are not mutable work status.
- **Keep only `.void/program.md`.** Rejected because global intent cannot reconstruct the last local
  reasoning boundary or identify stale evidence after an interruption.
- **Write the checkpoint automatically at SessionEnd.** Rejected because the hook runs after the
  model and lacks the semantic context to invent assumptions, dead ends, or the next physical move.
- **Maintain a local current or next unit.** Rejected because it duplicates provider state and
  recreates the drift the earlier active-program pointer was designed to avoid.

## Reversal cost

Low to medium. The programme and checkpoint are Markdown, and `ResumeBundle` is a read model over
those files plus Git. Reversal can remove the hooks and bundle without migrating provider state.
Collapsing the two files would require choosing one ownership and conflict model, which is exactly
the ambiguity this decision removes.
