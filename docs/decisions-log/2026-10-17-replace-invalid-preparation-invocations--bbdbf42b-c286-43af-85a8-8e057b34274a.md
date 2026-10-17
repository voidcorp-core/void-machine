---
schemaVersion: 1
id: "adr:bbdbf42b-c286-43af-85a8-8e057b34274a"
createdAt: "2026-10-17T10:56:24.631Z"
title: "Replace invalid preparation invocations within their consumed round"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Replace invalid preparation invocations within their consumed round

## Context

A complete round-two preparation panel can be correctly refused because its native
contexts were reused from round one. Existing recovery either rebinds a valid original
post-implementation review or corrects a proven historical controller defect. Neither
can replace these invalid invocations once the preparation budget is consumed.

## Decision

Admit one explicit `preparation-invocation` recovery for the exact reused-context
completions, then dispatch genuinely fresh replacements in the same consumed round.

Admission proves the original controller closure, complete authentic preparation
triplets, one bound preparation correction, unchanged current inputs and contracts,
and no unrelated review/evidence issue, prior recovery or unidentified work.
The receipt reproduces admission against its exact journal prefix. Projection removes
only the named invalid completions; historical starts, valid panel members and original
future evidence obligations remain. The controller blocks input drift and implementation
until replacements pass. The existing lifecycle salts requests by episode, binds their
causation and refuses every previously started native identity.

## Consequences

Positive:

- The same mission and writer continue without editing history or resetting either budget.
- A partial valid panel is preserved, with only invalid invocations dispatched again.

Negative:

- Eligibility is deliberately narrow: one initial preparation correction and round two.
- A replacement failure or repeated provenance error cannot authorize endless recovery.

## Alternatives considered

- Extend post-implementation provenance recovery: rejected because these invocations
  lack independence; their old results must not be rehabilitated.
- Advance or reset the round: rejected because it changes the consumed budget.
- Start another mission: rejected because it discards the binding to the stopped history.

## Reversal cost

Low for admission policy, medium for receipt compatibility: emitted append-only receipts
must remain reproducible. No installation, provider or runtime permission changes.

See [bounded reviews](../BOUNDED-REVIEWS.md#replacing-reused-preparation-invocations).
