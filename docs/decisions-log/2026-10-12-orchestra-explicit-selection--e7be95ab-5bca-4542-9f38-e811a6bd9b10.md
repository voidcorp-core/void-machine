---
schemaVersion: 1
id: "adr:e7be95ab-5bca-4542-9f38-e811a6bd9b10"
createdAt: "2026-10-12T09:18:11.656Z"
title: "Explicit coordinator mission selection preserves execution state"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Explicit coordinator mission selection preserves execution state

## Context

Several unfinished missions share ORCH's canonical worktree. Unique discovery
correctly refuses ambiguity, but choosing DEV-1017 must not close blocked missions
or rewrite their execution history. The maintainer approved the
[explicit selection spec](../specs/2026-10-12-orchestra-explicit-selection.md).

## Decision

ORCH atomically writes an optional local `.void/machine/orchestra-selection.json`
to select one existing central mission, independently of execution state.

Schema 1 contains only project identity, mission identifier and coordinator label
and canonical worktree. Strict JSON, duplicate and unknown key rejection, a 4096
UTF-8 byte bound and the existing safe reader protect this boundary. Full bounded
central discovery still runs; invalid selection never falls back. The selected
coordinator must match the current canonical worktree and fresh Herdr inventory.
Workers retain their own discovery. Terminal cleanup retains token ownership checks.

## Consequences

Positive:

- Selection survives clear, compact and resume without mutating mission history.
- Existing discovery, live identity and guarded cleanup remain authoritative.

Negative:

- ORCH owns one additional local, unversioned file and must replace stale bindings.
- A malformed unrelated mission still refuses selection by design.

## Alternatives considered

- A coordinator worktree per open mission avoids a binding but moves the existing
  coordinator's working context during the cutover.
- A native multi-mission switcher introduces a maintained control surface while
  Cockpit is being retired; it exceeds the required selection boundary.
- Timestamp or running-status preference silently chooses intent and cannot select
  a blocked mission explicitly, so it is rejected.

## Reversal cost

Low: remove the optional binding and retain unique discovery. No mission/report
schema, permissions, execution state, daemon or CLI command changes.
