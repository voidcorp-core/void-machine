---
schemaVersion: 1
id: "adr:5a59e1f3-a837-44d4-9d53-0819e46ad19e"
createdAt: "2026-07-26T16:32:18.809Z"
title: "Drive team review from an event-sourced pure controller"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Drive team review from an event-sourced pure controller

## Context

`ticket-runner` described expert passes in prose, but the existing mission verdict could become
verified from command evidence even when Architecture, Security, or QA never ran. Runtime agents
also have different output envelopes and incomplete read-only guarantees. The core must remain
provider-neutral, replayable, and free of filesystem or process I/O.

## Decision

Drive the team review with a pure event-sourced controller: a canonical plan selects required native
specialists, one lead writer owns all mutations, runtime adapters normalize structured completions,
and a two-round review reducer decides targeted invalidation and the final verdict.

## Consequences

Positive:

- Missing, stale, malformed, duplicated, timed-out, or wrong-role specialist work cannot turn green.
- Claude and Codex envelopes replay through one controller schema.
- Hash-scoped invalidation reruns only affected reviewers while preserving fresh proof.
- The writer/reviewer ownership boundary is explicit and mechanically testable.

Negative:

- Runtime shells must map their native process output to canonical completion/failure events.
- Team mode stays degraded while a runtime cannot prove complete read-only isolation.
- The fixed two-round MVP may block work that a human could resolve with another iteration.

## Alternatives considered

- **Keep orchestration only in skill prose**: rejected because prose composition is neither
  replayable nor evidence that independent specialists ran.
- **Let each runtime own its controller**: rejected because state, failure, and verdict semantics
  would drift between Claude and Codex.
- **Give reviewers write access**: rejected because concurrent ownership makes corrections and
  causal proof ambiguous.
- **Invalidate every proof after any edit**: rejected because it wastes fresh independent evidence
  and slows the bounded loop without increasing safety.

## Reversal cost

Medium. A replacement must migrate event kinds, workflow contracts, replay fixtures, and both
runtime adapters, but all persisted state remains append-only and can be projected into a new model.
