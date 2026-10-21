---
schemaVersion: 1
id: "adr:129ef8ef-77b5-4c51-a1de-7c5a711e3510"
createdAt: "2026-10-21T10:13:45.291Z"
title: "Keep review observation recipes stable across recovery"
status: proposed
deciders: ["folpe"]
supersedes: []
---

# Keep review observation recipes stable across recovery

## Context

Review dispatch, recovery and contract migration built different hashes for the
same committed subject. Dispatch could then overwrite a current observation with
an old receipt hash. Recovery also counted two review rounds where bounded review
allows an initial review plus two correction batches. Finally, profile routing
included the Node process running the observer, making an unchanged project hash
differently between CLI invocations.

## Decision

Bind the observation recipe durably, share subject capture and bounded budgets,
and recompute current evidence instead of substituting historical fingerprints.

The original mission review policy determines whether the subject hash includes
reviewedCommit. A provenance correction requires a committed identity but does not
silently change a legacy hash format. Dispatch, recovery and contract migration use
one capture path. The engine owns admission, invocation independence and budgets;
the CLI observes Git, project inputs and artifacts and persists the result.

New controller plans use schema 3 and bind inputRecipe project-v1 into routingHash.
Their Node technology comes from project declarations, never the observer process.
A non-exact engine constraint remains unknown rather than inventing an installed
version. Schema 1/2 plans retain their historical runtime-dependent recipe. A
legacy incident can therefore be reconstructed with its verified compatible Node
binary; there is no automatic search for a version that makes a receipt pass.

New recovery observations explicitly select the bounded correction policy. Old
observations retain their original interpretation when authenticated receipts are
replayed. No historical journal entry or consumed correction batch is rewritten.

## Consequences

Positive:

- Equivalent observations agree across commands and survive a stop without a code edit.
- New project subjects are independent of the CLI's runtime version.
- Old plans and receipts remain readable with their original semantics.
- Modified code, routing, contracts and incomplete invocations still refuse reuse.

Negative:

- Existing runtime-dependent missions still need their compatible observation environment.
- Old binaries cannot mutate plans or new recovery observations they do not understand.
- A project without an exact Node declaration retains an unknown-version limitation.

## Alternatives considered

- Add committed=true only to recovery: rejected because migration, legacy subjects,
  runtime-dependent routing and the mismatched budget remain contradictory.
- Copy the old inputHash or omit its comparison: rejected because changed inputs
  could be admitted using stale evidence.
- Rehash every old mission with the new recipe: rejected because the preimage is
  not retained and such a migration would silently invalidate existing receipts.
- Start another review or write an empty implementation commit: rejected because
  neither repairs the identity contract and both waste the bounded review budget.

## Reversal cost

Medium. New plans and recovery observations are durable public formats. Any later
recipe must be explicitly versioned; readers must preserve these historical
interpretations or supply an independently verifiable append-only migration.
