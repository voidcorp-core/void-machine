---
schemaVersion: 1
id: "adr:ded6f423-1c89-4676-a6bb-60eb181e4db9"
createdAt: "2026-10-05T10:00:05.405Z"
title: "Bind command evidence corrections to authenticated recovery"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Bind command evidence corrections to authenticated recovery

## Context

DEV-962 exposed a stopped mission whose failed executable was the entire command
string. DEV-925 recorded `['pnpm typecheck']`, exit 127 with spawn ENOENT, then
`['pnpm', 'typecheck']`, exit 0 on the same diff and environment. Their input hashes
correctly differ. The verdict supersedes only proofs of the same input, so both
remain effective. Six observed command pairs have this shape.

DEV-927 also changed a relative executable to an absolute path. Its journal does
not attest the resolved executable identity, and is still open. Sharing a basename
does not prove equivalence; this case cannot authorize replacement by itself.

## Decision

Use an explicit `command-correction` disposition on the existing `mission recover`
command, with named failed/replacement event pairs and a re-observed resolution
artifact. The existing admission receipt, prefix validation and atomic append own
authority; the common projection consumes only authenticated corrections.

Admission requires an original shell-free mono-string spawn ENOENT/127, a later
successful shell-free proof, exact full executable and argument correspondence,
matching mission, producer, environment and diff, intact hashes and observed fresh
dependencies. Joining the corrected argv must reproduce the original string;
arguments containing whitespace or shell syntax are outside this bounded repair.
A later failing rerun invalidates a named successful replacement.

Keep every original event and hash. Exclude only the specifically replaced failed
event from the effective verdict, never all evidence with its input hash. Recovery
authorizes continuation; it does not approve reviews, waive blockers, execute a
command, reset budgets or replace human decisions. Invalid receipts cannot grant
replacement. Concurrent identical requests append one receipt.

## Consequences

- The observed DEV-925 correction becomes recoverable on the same mission without
  repeating command effects or discarding failed evidence.
- A valid new failure remains effective; old exit 127 alone grants no success.
- Recovery still needs a fresh, already recorded corrected proof. A closed journal
  without it must be reconciled; this change grants no unrecorded execution.
- Relative/absolute executable changes and complex shell/quoted argument cases
  remain refused without executable provenance, rather than guessed from basename.
- The generic verdict consumes the same authenticated recovery projection used by
  the controller. There is no second receipt parser deciding authority.

## Alternatives considered

- **Automatically equate joined argv or ignore exit 127:** rejected because it
  silently waives failures and confuses executable identities and shell semantics.
- **Use finding exceptions:** rejected because they govern finding disposition,
  not command evidence, and must not become a proof-integrity bypass.
- **Add a separate evidence-replacement command and ledger:** rejected because
  stopped missions already have an authenticated, idempotent recovery boundary;
  duplicating admission would create competing sources of authority.

## Reversal cost

Medium. Recovery receipts are immutable history. A future general correction
protocol must continue validating these bounded receipts or supersede this ADR
with an explicit compatibility path; it cannot rewrite old proof hashes.
