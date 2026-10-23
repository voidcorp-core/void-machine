---
schemaVersion: 1
id: "adr:861f723b-3cf7-4785-91bc-2b1ae79ad6c0"
createdAt: "2026-10-23T15:35:19.458Z"
title: "Bind usage prospectively without changing native hooks"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Bind usage prospectively without changing native hooks

## Context

Real dogfooding showed an inherited coordinator session journal but no attributable worker
journal. Counts could not be joined to tickets without guessing. The host must retain its
published hooks, and local telemetry must never become a quality/admission gate.

## Decision

Bind exact existing source journals prospectively using source-owned interval receipts and a
retryable target reference; report lightweight native advisory starts with declared provenance.

## Consequences

Positive:

- Existing hooks keep their destination; no source installation, registry or global configuration.
- Explicit start/end event boundaries exclude prior and subsequent work without timestamp guesses.
- Canonical review and advisory-start declarations remain separate; code gates are unchanged.

Negative:

- Source and target writes are not atomic. A failed reference needs the same command retried.
- Open intervals are provisional/shared-session, not isolated worker telemetry or authentication.
- One interval per pair closes permanently; unavailable identification and Codex activation stay unknown.

## Alternatives considered

- Reinstall candidate hooks in the host: violates the published self-consumption boundary.
- Infer work from timestamps/session variables: would misattribute inherited coordinator events.
- New global session registry/controller: larger durable state than the explicit local need warrants.

## Reversal cost

Low: additive CLI events/reporting. Native hooks and mission admission schemas remain unchanged;
unknown usage event kinds are ignored by existing quality reducers.
