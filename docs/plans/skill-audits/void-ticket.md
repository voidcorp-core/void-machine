# Skill audit: ticket

## Why this skill exists

The harness had no doctrine-aware way to turn a finished brainstorm/plan into a
tracker ticket. The generic loomcrafthq `ticket-craft` exists but is platform-only:
it does not ingest harness decisions, does not enforce estimate/labels, and does not
tie a ticket to the per-ticket execution cycle (implement).

## Baseline failure observed

In real use (DECLIK, 2026-06-26) a batch of cortex tickets was created without an
`estimate` and without any `label`, and edge cases were thin. The author (an agent)
knew the fields existed and skipped them under "just get the tickets in" pressure.
The failure is omission of required elements from something already produced.

## Form chosen (per writing-skills "Match the Form to the Failure")

- **Structural** for the omission: the template lists REQUIRED slots and REQUIRED
  native fields (estimate, labels, parent, deps, priority). A missing required slot
  = not ready. Structural slots beat prose reminders for omission failures.
- **Recipe** for the ingest order and the all-angles sweep (positive "what the
  output IS").
- **Discipline guard** (red-flags table) only for the specific omissions seen
  (estimate-later, labels-don't-matter, agent-figures-out-edges).

## Deliberate decisions

1. Ingest-first: records decided scope, never invents it.
2. Required native fields, not optional metadata (the load-bearing fix).
3. Two harness-tying slots: TDD-mode-per-ticket + "runner passes that apply", so
   implement consumes a ticket that already declares its conditional passes.
4. All-angles sweep (architecture/security/QA/UX/perf-obs-docs) folds into the
   edge-cases slot, so the ticket covers angles the author would miss alone.
5. ticket-craft kept external as the generic, non-harness fallback (anti-overlap:
   this version is harness-composing and doctrine-aware).

## Open follow-ups

- Full writing-skills pressure-test suite not yet run (grounded in observed baseline
  + subagent application check). Schedule a dedicated RED-GREEN pass.
- A companion PreToolUse hook could warn when a ticket is saved via MCP with an
  empty estimate or zero labels (mechanical enforcement of the two fields).

## 2026-07-24 — active handoff after multi-ticket decomposition

Added one post-save responsibility: after a human-approved plan becomes a complete
multi-unit pool with native dependencies, `ticket` creates
`.void/program.md`. The file contains stable provider/scope/unit ordering,
plan/spec links, lifecycle-state roles, and human gates. It never copies the
current unit or progress. This is still ticket authoring: the handoff is emitted
only when the native tickets that it routes have been created successfully.

The contract is tracker-agnostic but capability-gated. A provider must support
status, relations, assignee, comments, and review evidence; otherwise automatic
continuity is not claimed. Rejected: creating ACTIVE for a standalone ticket,
silently replacing another executing program, or treating a Markdown checkbox list
as a fallback tracker.
