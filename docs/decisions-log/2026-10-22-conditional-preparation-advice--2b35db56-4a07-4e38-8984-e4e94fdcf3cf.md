---
schemaVersion: 1
id: "adr:2b35db56-4a07-4e38-8984-e4e94fdcf3cf"
createdAt: "2026-10-22T10:27:58.208Z"
title: "Make preparation advice conditional without a compulsory panel"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Make preparation advice conditional without a compulsory panel

## Context

Preparation dispatch hashes global mission inputs but supplies a narrower brief and cited
artifacts. Unrelated implementation tests therefore invalidated ten genuine PASS results,
requested an empty writer correction, and queued the same ten specialists again. The
mandatory panel added cost without providing the exact code review that protects delivery.

## Decision

Remove the compulsory preparation quorum and empty preparation correction from normal
controller dispatch; retain targeted advice through existing risk-conditional professional
passes and native specialist consultation.

Bind advice to its concrete question, scope and artifacts. A material change warrants only
the affected advice. This is an explicit workflow responsibility, not a new CLI risk engine,
optional-advice API, automatic semantic fingerprint or legacy approval migration.

## Consequences

Positive:

- Normal admission needs zero compulsory preparation invocations and zero empty corrections.
- Existing genuine findings and author-owned evidence obligations remain actionable.
- Historical requests, completions, exact recovery receipts and budgets remain intact.
- Already-started authentic preparation can finish as advice after writer admission, without
  satisfying code review. The controller still rejects preparation newly started or replayed after implementation admission.
- Meaningful tests, one bounded independent exact-head final review, CI, hooks, authorization
  and evidence integrity remain the delivery protections. Commit, base, criteria and contract
  changes still invalidate final review.

Negative:

- Native advice depends on the workflow identifying a concrete risk or uncertainty; the CLI
  does not mechanically prove that every relevant preparatory consultation occurred.
- Real stale preparation findings still need explicit reconciliation. They are not silently
  discarded or relabelled as approvals for changed inputs.
- Explicit legacy recovery keeps its original admission and completion requirements.

## Alternatives considered

- Reducing the compulsory quorum would lower cost but retain its wait and global input
  invalidation without a distinct protection beyond meaningful tests and final review.
- Evidence-specific preparation hashes would remove the immediate false invalidation but
  introduce another semantic identity and compatibility contract. Old canonical requests do
  not anchor the actual context pack, so they cannot prove equivalence under a new hash.
- Repairing or freezing global hashes retains the repeated panel cost and does not establish
  that old advice covers the actual brief, artifact or contract being changed.

## Reversal cost

Low. The existing event readers and explicit recovery paths remain. Reintroducing compulsory
preparation would require a demonstrated protection and a separately reviewed admission policy,
not rewriting old journals or resetting budgets.
