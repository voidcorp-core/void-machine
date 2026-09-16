---
schemaVersion: 1
id: "adr:a199a4c2-798d-4947-8ad7-6a67f7b272f6"
createdAt: "2026-09-16T07:00:59.583Z"
title: "Classify interface motion by interaction outcome"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Classify interface motion by interaction outcome

## Context

Functional controls need prompt feedback, while a product explanation can need
several ordered beats. A universal duration cap and state-change-only language
exclude the latter. Folpe approved contextual motion in DEV-531 on 2026-07-29;
the approved six-ticket spec carries that decision into this implementation.

## Decision

Classify motion per interaction by its observable state-feedback or narrative
outcome, keeping functional feedback below 250ms by default and allowing
expressive duration only for a specified sequence with a usable static version.

## Consequences

Positive:

- A landing can tell a product story without slowing its functional form.
- Reduced motion preserves information, content never depends on playback, and
  hot paths stay compositor-safe in both contexts.
- WCAG pause controls and flash limits remain independent requirements.

Negative:

- Review must judge a named outcome and its alternatives, not only a duration.
- Existing decorative motion does not gain approval merely by being relabeled.

## Alternatives considered

- **Retain the absolute cap:** easy to check, but rejects approved narrative work.
- **Exempt whole landing pages or brands:** permits slow controls within the
  exempt page and offers no observable interaction-level justification.

## Reversal cost

Low for the harness: change the two skills and their contract together.
Medium for consumers that adopted expressive sequences: inspect each use and
preserve its informational equivalent before returning to an absolute cap.
