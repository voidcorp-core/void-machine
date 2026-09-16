---
schemaVersion: 1
id: "adr:3147c4f8-b767-4b0c-b68b-ce110d441df5"
createdAt: "2026-09-16T07:00:59.668Z"
title: "Give interface motion a dedicated core skill"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Give interface motion a dedicated core skill

## Context

DEV-531 requires orchestration, easing, spatial continuity and compositing
budgets beyond frontend-design's short motion default. Folpe approved a dedicated
core skill on 2026-07-29. The principles apply to app and site interfaces without
selecting a consumer animation dependency.

## Decision

Give interface motion one dedicated library-agnostic core skill; frontend-design
keeps the default and delegates the detailed procedure explicitly.

## Consequences

Positive:

- One owner holds the motion contract, including expressive work and invariants.
- A consumer can find motion guidance directly without loading unrelated layout
  advice; library recipes remain optional references or pack material.

Negative:

- A new discoverable skill and its generated catalog entries must be maintained.
- Cross-skill tests and semantic review must prevent contradictory summaries and
  duplicated procedure; overlap stays below the repository's 30% ceiling.

## Alternatives considered

- **Expand frontend-design:** easy discovery during UI work, but mixes the motion
  procedure with broader layout and brand responsibilities.
- **Create a library-specific pack only:** useful for recipes, but makes the
  universal accessibility and interaction contract depend on a tool choice.

## Reversal cost

Medium: move the single procedure, migrate references and discovery entries,
regenerate assets and update contracts without leaving two competing owners.
