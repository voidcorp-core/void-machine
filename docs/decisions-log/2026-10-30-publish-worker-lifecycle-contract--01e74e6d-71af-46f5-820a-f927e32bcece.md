---
schemaVersion: 1
id: "adr:01e74e6d-71af-46f5-820a-f927e32bcece"
createdAt: "2026-10-30T10:28:31.506Z"
title: "Publish worker lifecycle independently of presentation"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:0d9fd85a-f158-42c5-89a2-c70b6e452c07"]
---

# Publish worker lifecycle independently of presentation

## Context

Folpe approved the [worker lifecycle amendment](../specs/2026-10-30-worker-lifecycle-publication.md)
on 2026-10-30. Native delegation already supplies execution and continuity, while
built-in multiplexers couple the harness to a display owned by another project.
Autopilot uses native orchestration, so instrumenting only legacy agents dispatch
would miss the intended workers.

## Decision

Publish versioned worker observations in the existing canonical mission journal
and expose a read-only project snapshot; external plugins own presentation.

Supersession is limited to the predecessor's harness-owned presentation policy.
Adaptive delegation, one retained writer, real native identities, permissions,
exact-subject review receipts and legacy session collection remain binding.
No existing session is restarted or migrated. The old metadata hook remains an
explicit transitional exception under DEV-1134; its plugin is outside this repo.

## Consequences

Positive:

- Any display can consume one contract without changing the execution engine.
- No presentation failure controls worker execution or merge permission.
- Existing journal sequencing and deduplication avoid another state store.

Negative:

- A snapshot is last-observed state, not a liveness guarantee or exhaustive native
  capture. Coordinators must publish after actual native observations.
- External consumers must handle partial coverage and unsupported versions.
- Historical presentation modules remain inert until a separate cleanup is justified.

## Alternatives considered

- Keep Surface and built-in multiplexers: rejected because their maintenance and
  host selection violate the requested ownership boundary.
- Add a telemetry server or separate journal: rejected because the canonical journal
  already owns mission identities, ordering and replay.
- Instrument only the historical launcher: rejected because native Autopilot bypasses it.

## Reversal cost

Medium. Existing native execution is unchanged, but once external consumers adopt
v1 its semantics are durable. Additive fields remain compatible; a semantic change
requires a new schema version and an explicit consumer migration.
