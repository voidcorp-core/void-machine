---
name: void-decide
description: Capture structural choices as one immutable ADR file with collision-free identity, explicit alternatives, reversal cost, and supersession. Use when future code depends on why.
---

# decide

Use when a structural choice changes how future code is written and a future
contributor would otherwise ask "why?". ADRs are codebase-scoped. Product or
cross-organization strategy belongs in the product's decision system.

This composes with `void-plan`: plans describe work; ADRs preserve
the decisions behind it.

## Write an ADR when

- A library or platform choice creates material lock-in.
- A naming, layout or dependency convention affects the codebase broadly.
- Ownership, trust or deployment boundaries change.
- A performance, availability, privacy or security trade-off is accepted.
- A previous accepted ADR must be reversed or narrowed.

Do not write one for bug fixes, preference, pure refactors or choices reversible
in one small PR. If no credible alternative was rejected, the record is usually
ceremony rather than a decision.

## Storage contract

One decision owns one Markdown file. Never append to, number from, or regenerate
a shared index.

Default location:

```text
docs/decisions/
  2026-07-24-use-drizzle--018f43f4-3ac4-7c40-8000-000000000001.md
```

An existing project may keep an established equivalent such as
`docs/decisions-log/` or `decisions/`.

The filename contains:

- an ISO date for scanning;
- a readable slug describing the chosen direction;
- a collision-resistant UUID used by the ADR identity.

Prefer the project command when present:

```sh
void-harness decisions new \
  --title "Adopt Server Actions for UI mutations" \
  --slug adopt-server-actions \
  --decider folpe
```

Without the CLI, generate a UUID locally and create the same standalone contract.
Never inspect sibling files to allocate `NNNN`; parallel workers must not share a
counter.

## Format

Keep the record terse, normally under 100 lines:

```md
---
schemaVersion: 1
id: "adr:018f43f4-3ac4-7c40-8000-000000000001"
createdAt: "2026-07-24T10:15:00.000Z"
title: "Adopt Server Actions for UI mutations"
status: proposed
deciders: [folpe]
supersedes: []
---

# Adopt Server Actions for UI mutations

## Context

What forces, constraints and pain make the choice necessary?

## Decision

We will <one sentence>.

## Consequences

Positive:

- ...

Negative:

- ...

## Alternatives considered

- **tRPC mutations**: rejected because ...
- **REST endpoints**: rejected because ...

## Reversal cost

Low, Medium or High, with the concrete migration cost.
```

## Lifecycle

- `proposed`: open for review and editable.
- `accepted`: merged and binding for new work.
- `deprecated`: retained for history but discouraged for new work.
- `superseded`: replaced by a newer record.

Accepted decision content is immutable. To reverse, clarify or partially replace
one, create a new ADR whose `supersedes` contains the old `id`. Never delete or
rename the accepted file. This preserves evidence and prevents parallel branches
from rewriting the same history.

One mechanical exception keeps references usable without diluting the journal:
an accepted file may replace a bounded repository-local path when frontmatter,
headings, Markdown structure and surrounding prose stay byte-for-byte stable and
the new target exists inside the repository. `void-harness decisions check`
proves that narrow shape and fails closed on a missing target, path escape or
symlink escape. A change to wording, reasoning, scope, consequences or identity
is not a reference migration; it requires supersession. Do not create a new ADR
merely to record a proven file move or rename.

## Workflow

1. State the decision in one sentence before expanding it.
2. Record forces and constraints, not a chronology of discussion.
3. Name at least two credible alternatives and reject them with evidence.
4. State negative consequences and concrete reversal cost.
5. Let the accountable decider accept it through normal review.
6. Run `void-harness decisions check` when available.
7. Link foundational ADRs from project doctrine by their source file or stable
   `adr:<uuid>` identity.

Do not commit a rendered Markdown or JSON projection. Generate it on demand with
`void-harness decisions render`; source files alone participate in merges.

## Composition

- `void-plan`: plans cover work; ADRs cover durable decisions.
- `void-source-driven-development`: alternatives cite primary documentation.
- `void-commit-discipline`: a long commit rationale can expose ADR-worthy work.
- `void-learn`: recurring lessons become doctrine; structural
  choices become ADRs.
