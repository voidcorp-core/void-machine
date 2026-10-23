---
schemaVersion: 1
id: "adr:1411e10b-ff9f-4b92-8cbd-7ede876048e8"
createdAt: "2026-10-23T12:22:05.736Z"
title: "Preserve bounded native review continuity"
status: proposed
deciders: []
supersedes: []
---

# Preserve bounded native review continuity

## Context

The bounded workflow retains the independent native reviewer for targeted verification,
but the reducer rejected every repeated context before examining its scope. Recovery and
CLI ingestion repeated that unconditional rule. A valid correction could close a mission
without a product finding, then require an unrelated writer change to reopen it.

## Decision

Derive native review continuity from the existing mission invocation and correction history,
using one validator for reduction, lifecycle ingestion and explicit controller-defect recovery.

The first general review stays independent and fresh. A retained native context is admitted
only for an exact targeted invocation tied to authorized writer corrections, the same mission,
reviewer, base and acceptance criteria, and current resolution evidence. Two correction
batches remain the limit. Fresh-context targeted receipts keep their existing behavior.
Recovery adds no receipt replacement, observation override or new review round; it preserves
both original results and appends the existing recovery event after validating the current subject.

## Consequences

Positive:

- The reviewer can verify its original finding without repeating a general review.
- Existing false-positive closures can resume with authentic evidence and unchanged budgets.
- Dispatch and recovery use the same evidence-freshness calculation.

Negative:

- Native continuation requires the original requested/started/completed chains and authorized
  correction events. An incomplete old journal remains refused rather than being guessed.
- A version that predates this recovery disposition must not resume a journal that contains it.

## Alternatives considered

- Remove context-reuse detection: rejected because general or unrelated reviews could recycle context.
- Always demand a fresh reviewer: rejected because it contradicts bounded targeted verification
  and loses the original reviewer's continuity without adding a concrete protection.
- Introduce a replacement receipt protocol: rejected because the existing history already proves
  the invocation and correction links; another caller-authored link would add no authenticity.

## Reversal cost

Medium. The validator can be tightened without changing existing event formats, but a future
reader must continue to validate recovery receipts produced by this disposition. Never rewrite
or remove those historical receipts to downgrade an installation.
