---
schemaVersion: 1
id: "adr:1d1c975b-2249-42d1-b844-37f2f3f5580d"
createdAt: "2026-11-09T08:43:01.779Z"
title: "Preserve original reviews through author-confirmed writer amendments"
status: proposed
deciders: []
supersedes: []
---

# Preserve original reviews through author-confirmed writer amendments

## Context

A native writer alias was accepted in a bounded review receipt, although the
controller requires the canonical mission writer. The general review was degraded
and had a concrete blocker. Existing provenance recovery admits passing results;
ordinary blocker recovery cannot correct this historical identity or authorize
the retained reviewer's continuation after an ineffective recovery.

## Decision

Reject mismatched canonical writers at ingestion and admit one append-only,
retained-author writer amendment through the existing specialist lifecycle and
recovery commands. A request names the active closure and immutable completion;
start and returned response use distinct amendment events, never another review.
Recovery replay derives a writer-only effective receipt. The original degraded
result, subject, findings, evidence, limitations and review budget remain intact.

Actual native invocation and returned response remain the coordinator's operational
responsibility. The CLI validates the retained invocation chain and exact response
artifact bytes. This is coordinator-observed provenance, not cryptographic author
authentication, and cannot detect a coordinator fabricating the entire chain.

## Consequences

Positive:

- Preserves historical evidence and permits one corrective action followed by one
  targeted continuation from the original reviewer, with normal fresh proof checks.

Negative:

- An unavailable original author leaves recovery pending. The original session
  must collect the real response; a replacement reviewer cannot amend it.

## Alternatives considered

- Rewrite or promote the original receipt: loses the observed verdict and provenance.
- Recreate the mission or run another general review: loses the consumed budget.
- Add a runtime authentication service: no supported signed response transport exists;
  this bounded fix reuses the existing native observation boundary.

## Reversal cost

Medium. New event producers can be withdrawn, but readers must retain replay support
for admitted amendments and their unchanged original histories.
