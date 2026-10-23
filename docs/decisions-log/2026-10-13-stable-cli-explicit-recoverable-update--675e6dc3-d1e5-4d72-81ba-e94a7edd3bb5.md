---
schemaVersion: 1
id: "adr:675e6dc3-d1e5-4d72-81ba-e94a7edd3bb5"
createdAt: "2026-10-13T18:47:35.856Z"
title: "Acquire stable releases only through explicit recoverable update"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Acquire stable releases only through explicit recoverable update

## Context

An executable resolved from a working checkout can disagree with installed consumer assets.
The former update command recompiles from whichever CLI runs it, and its layout repairs can
survive a later install failure. DEV-1022's approved spec requires one exact released CLI and
selected project version, preserved settings and recoverable publication. Exact offline
rehydration remains governed by the existing manifest decision.

## Decision

Only explicit `update` acquires a stable release; prepare the selected project set with that
release, publish through the existing durable file transaction, and activate the CLI last.

Store complete immutable packages under `voidGlobalDir()/cli/releases/<version>` and use a
dependency-free launcher with a validated active selection. Pin npm metadata and SHA-512 bytes
once, disable npm lifecycle scripts, isolate configuration, validate package identity, engine,
schema and runtime contracts before candidate execution. A candidate lacking protocol 1 refuses.
Default selection is the current canonical installation; `--all` requires complete discovery.
Ordinary commands and hooks never fetch or update. `hydrate` remains exact and offline.

Journal hashes and modes govern both forward publication and recovery. A later user edit keeps
its bytes and the recovery evidence. A live owner lock is never stolen because it is old.
Known npm links, npm11 Windows shims and literal source wrappers require verified package/bin
ownership; unknown launchers are preserved. Keep the first qualified launcher snapshot after
success and retain prior complete releases. Native trust and shell configuration stay human-owned.

Programme migrations preserve equivalent behavior only: schema1 human gating becomes a schema2
programme plus its human hold, with consent and unrelated text unchanged. Union-reviewed policy
is not equivalent to local review and requires an explicit policy decision outside the updater.
Legacy layout repair, index rewriting and marketplace conversion are refused by this operation.

## Consequences

Positive:

- The executable, bundled compiler and selected projects share one immutable target.
- Current-project default avoids updating unrelated installations; recovery covers all participants.
- Clone rehydration, co-owned settings and installed enforcement use the existing compiler.

Negative:

- Downloads, complete retained packages, the bootstrap snapshot and failed-operation evidence
  occupy local storage; dry run reports its staging/cache effects.
- Schema or ownership uncertainty requires repair or a policy decision rather than guessed migration.
- The package protocol is an explicit compatibility boundary and needs platform qualification.

## Alternatives considered

- Running `npx latest` for ordinary commands would require mutable resolution and network/cache
  behavior during ordinary use, without coordinating project recovery.
- A background reconciler would introduce unrequested multi-project writes and new consent.
- A second rollback engine would duplicate ownership and byte/mode rules; extend `transaction.ts`
  and keep the coordinator limited to ordering and participant validation instead.

## Reversal cost

Medium. Existing project materialization remains compatible, but replacing the stable store
requires a deliberate launcher migration and preserving active operation evidence. Published
versions and manifests continue to be owned by release-please.
