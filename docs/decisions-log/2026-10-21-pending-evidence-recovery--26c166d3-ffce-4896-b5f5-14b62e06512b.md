---
schemaVersion: 1
id: "adr:26c166d3-ffce-4896-b5f5-14b62e06512b"
createdAt: "2026-10-21T13:03:14.794Z"
title: "Keep pending evidence actionable across stopped episodes"
status: proposed
deciders: []
supersedes: []
---

# Keep pending evidence actionable across stopped episodes

## Context

An outstanding author proof was actionable during preparation but closed the mission
at later phases. A closed episode then refused the same author's pending response,
while recovery required progress that could no longer be recorded. Requiring another
product commit or general review would fabricate progress and spend unrelated budgets.

## Decision

Keep valid outstanding evidence in an explicit waiting action at every phase, and
admit recovery of existing stopped episodes only from completed, pre-stop author
invocations whose fresh canonical proof discharges an original obligation.

A stopped mission can ingest only the completed discharge of a request already
requested and started before its active controller-stop closure. It remains closed.
An additive `evidence-disposition` recovery disposition names those response event
IDs and the exact closure/journal hash. The engine independently validates the
complete invocation, author, contract, original obligation, current Git proof and
new progress. It retains all ordinary recovery refusals and budgets.

The controller owns waiting and review decisions; the evidence reducer owns proof
validity; the CLI observes the current worktree and appends under the existing lock.
A proof wait does not mask an invalid, failed or exhausted independent review.

## Consequences

Positive:

- Authentic protocol correction can finish without changing product code or replaying a panel.
- Existing request, response and recovery formats retain their semantics.
- Missing evidence remains unverified and actionable instead of becoming a terminal deadlock.

Negative:

- A journal containing the new recovery disposition requires a compatible reader.
- A stopped invocation that never started cannot use this bounded admission path.
- Evidence still stale on the unchanged candidate cannot be discharged by assertion.

## Alternatives considered

- Reopen any stopped mission to collect proof: rejected because it permits repeated
  recovery without observed progress and could replay unfinished effects.
- Broaden `review-blocker` to accept resolved evidence: rejected because that existing
  disposition names unresolved review completions, not authenticated proof responses.
- Demand a writer commit or new general review: rejected because protocol correction
  is neither an implementation change nor a new review of the product.

## Reversal cost

Medium. Before the additive recovery receipt is appended, retain the old CLI and
original history. After it is appended, use a compatible reader and fix forward;
never remove events or mutate the original receipt to make an older reader accept it.
The 5.0.4 reader explicitly degrades a journal with the new disposition.
