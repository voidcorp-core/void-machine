---
schemaVersion: 1
id: "adr:e1c6d206-22e6-48e6-9836-aa9cc18db5ca"
createdAt: "2026-10-23T21:47:58.497Z"
title: "Use the current Node runtime as the supported package floor"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:20d7a18e-67e2-406e-8440-0f7ad8f73931","adr:89f1ec74-3cf3-492a-be98-2ec03c924508","adr:b75aa91f-01a4-403d-924a-78192b2d09e4"]
---

# Use the current Node runtime as the supported package floor

## Context

Folpe explicitly requested one current Node runtime throughout local work, CI
and publication. Keeping a Node 24 compatibility lane after selecting Node
26.12.1 in `.node-version` contradicted that request and duplicated verification.
The previous package floors still advertised Node 24 support.

## Decision

Use `.node-version` as the exact runtime owner, currently 26.12.1. Every
first-party package declaring a Node engine requires `>=26.12.1`. Remove the
older-runtime compatibility job; primary CI, enforcement and publication retain
the existing version-file and resolved-output wiring.

This supersedes both Node 24 floor decisions. For the reusable-CI decision
adr:b75aa91f-01a4-403d-924a-78192b2d09e4, only its Node 24 compatibility clause
is superseded: local review authority, browser reuse, merge queue and human
promotion requirements remain unchanged.

Keep Node 24 type declarations and bundle emit targets as conservative
compile-time baselines. They run on Node 26 and do not promise Node 24 runtime
support. No new Node API is needed for this policy change. An upgrade of those
baselines can accompany a concrete API need rather than broadening this change.

Historical results and version-specific source citations remain historical;
accepted decisions are not rewritten. The higher consumer floor is breaking and
must be declared through Conventional Commit metadata, allowing release-please
to choose the major version instead of editing versions manually.

## Consequences

- One CI runtime and one exact version owner, with manifest drift caught by tests.
- Consumers below Node 26.12.1 must upgrade; npm engines are advisory unless
  engine-strict is enabled, so this is a support contract, not a new launcher gate.
- Future `.node-version` changes must align package floors and pass the same checks.
- This removes a duplicate lane; it does not claim measured end-to-end savings.

## Alternatives considered

- Keep Node 24 as a supported floor and run two majors: rejected by the explicit
  current-only requirement.
- Upgrade types and emit targets simultaneously: unnecessary dependency and
  artifact changes without a runtime behavior requirement.
- Accept a floating `current` CI label: loses reproducibility across jobs and
  releases; use an explicit reviewed update of `.node-version` instead.

## Reversal cost

Restore a lower supported floor only with verification on that runtime. The
conservative types and emit targets reduce that cost but do not prove support.

## Sources

- [Node 26.12.1 release](https://nodejs.org/en/blog/release/v26.12.1)
- [npm engines contract](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#engines)
