---
name: void-decide
description: Record structural choices in short Markdown with light frontmatter, alternatives, reversal cost and replacement links. Use when future code depends on why.
---

# decide

Use when a structural choice changes how future code is written and a future
contributor would otherwise ask "why?". ADRs are codebase-scoped. Product or
cross-organization strategy belongs in the product's decision system.

Plans describe work; decisions preserve the reasons behind it.

## Write a decision when

- A library or platform choice creates material lock-in.
- A naming, layout or dependency convention affects the codebase broadly.
- Ownership, trust or deployment boundaries change.
- A performance, availability, privacy or security trade-off is accepted.
- A previous accepted decision must be reversed or materially changed.

Bug fixes, preferences, pure refactors and choices reversible in one small PR
usually need no ADR. If no credible alternative was rejected, the record is
usually ceremony rather than a decision.

## Write Markdown directly

Use the project's established directory, such as `docs/decisions-log/` or
`decisions/`; `docs/decisions/` is a useful default for a new project. One decision
owns one file. Choose a stable unique filename and identity, for example a date,
readable slug and locally generated UUID:

```text
docs/decisions/2026-07-24-use-drizzle--018f43f4-3ac4-7c40-8000-000000000001.md
```

Never allocate a shared sequential counter or overwrite another record. Preserve
existing files, IDs, metadata and links; no bulk rewrite is needed. Do not maintain
a generated index. Read the source records directly with ordinary repository tools.

Light YAML frontmatter is enough. This is an example, not a blocking schema:

```md
---
id: "adr:018f43f4-3ac4-7c40-8000-000000000001"
title: "Adopt Server Actions for UI mutations"
createdAt: "2026-07-24"
status: accepted
supersedes: []
---

# Adopt Server Actions for UI mutations

## Context

The forces and constraints that make this choice necessary.

## Decision

We will use Server Actions for UI mutations.

## Consequences

Benefits, costs and negative consequences.

## Alternatives considered

Credible alternatives and why they were rejected, with useful evidence.

## Reversal cost

The concrete migration required to change course.
```

Use `createdAt` or `date` for the date. Add deciders or other useful metadata when
needed; retain metadata already present in historical records. Common statuses are
`proposed`, `accepted`, `deprecated` and `superseded`. A `supersedes` list carries
stable predecessor IDs when a record replaces earlier choices. Existing readers
may recognize a bounded subset of metadata; that does not make their parser an
authoring gate. No dedicated CLI, validator or history engine is required.

## Preserve the reasoning and its history

Ordinary typo, link and wording corrections can be committed in place. A reversal
or material change creates a new short decision linking the previous record via
`supersedes`; keep the previous record readable and its identity stable. Explain
the changed choice rather than silently rewriting its rationale.

Git preserves committed revisions, not unsaved or uncommitted intermediate edits.
It is not an absolute retention guarantee against history rewriting. No duplicate
ledger, snapshot generator or CI gate is needed.

## Workflow

1. State the decision in one sentence before expanding it.
2. Record the relevant forces and constraints, not a chronology of discussion.
3. Name credible alternatives and why they were rejected.
4. State negative consequences and the concrete reversal cost.
5. Have the accountable decider accept the choice through normal review; reuse
   approval already given for the same choice.
6. Link foundational decisions from project doctrine by source file or stable ID.
   Doctrine changes still require the human agreement owned by `void-learn`.

## Composition

- `void-plan`: plans cover work; ADRs cover durable decisions.
- `void-source-driven-development`: alternatives cite primary documentation.
- `void-commit-discipline`: a long commit rationale can expose ADR-worthy work.
- `void-learn`: recurring lessons become doctrine with human agreement; structural
  choices become decision records.
