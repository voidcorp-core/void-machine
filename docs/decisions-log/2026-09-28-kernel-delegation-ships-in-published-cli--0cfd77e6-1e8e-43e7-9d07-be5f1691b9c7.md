---
schemaVersion: 1
id: "adr:0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7"
createdAt: "2026-09-28T09:41:18.013Z"
title: "The kernel's delegation capability ships in the published voidmachine CLI"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:e492e50e-86b0-4427-9fdf-2435750ce60d","adr:ec77d2de-4719-4fe6-8d21-c0dbe403d6ac"]
---

# The kernel's delegation capability ships in the published voidmachine CLI

## Context

Two decisions keep the new Void Machine kernel (`@voidcorp/void-machine`) away from users.
`adr:e492e50e-86b0-4427-9fdf-2435750ce60d` (2026-09-19), which ports the kernel to strict
TypeScript with explicit layer ownership, authorizes implementation and isolated
verification, and states that "release and active-install replacement are not" authorized.
`adr:ec77d2de-4719-4fe6-8d21-c0dbe403d6ac` (2026-09-21), which removes the native Rust
machine without porting it, keeps `packages/void-machine` as a private package whose
capabilities stay unexposed until a consumer asks. The kernel therefore exists, is tested,
and reaches no one.

A consumer now asks. The supervised delegation spec
(`docs/specs/2026-09-28-supervised-agent-delegation.md`) gives the kernel its first shipped
job: one path by which the coordinator, `void-autopilot` and `void-implement` launch Claude
or Codex agents, follow them, relay their questions and collect their results, with a
multiplexer (herdr, tmux, cmux) as a view only. Today each of those three callers launches
agents its own way, and four delegated reviews on 2026-09-24 stayed invisible because
display depended on the agent's choice (DEV-902). The autonomous merge spec
(`docs/specs/2026-09-28-autopilot-merge-without-consumer-setup.md`) depends on the same
capability: its independent reviewer is a `review` run the kernel launches. Both specs
target 4.1.0, and the delegation spec's fifth slice embeds the kernel in the published CLI.
Folpe decided on 2026-09-28 that this ships.

## Decision

The kernel's delegation capability (runs, states, registry, runtime and presentation
adapters, and the `void-machine agents` commands) ships to users inside the published
`voidmachine` CLI, starting with 4.1.0; this supersedes, on that single point, the "release
not authorized" clause of `adr:e492e50e-86b0-4427-9fdf-2435750ce60d` and the "private,
unexposed package" clause of `adr:ec77d2de-4719-4fe6-8d21-c0dbe403d6ac`.

What stays in force from `adr:e492e50e-86b0-4427-9fdf-2435750ce60d`: the kernel stays in
strict TypeScript with explicit core, runtime, development-vertical and adapter ownership;
the core stays pure and free of Git, merge, worktree and skill policy; each responsibility
has one authoritative owner; no two engines are maintained permanently; replacing an
installed mission engine is still not authorized.

What stays in force from `adr:ec77d2de-4719-4fe6-8d21-c0dbe403d6ac`: `native/` stays deleted
and nothing of it is ported; no native `void-machine` binary or `VOID_MACHINE_BIN` path comes
back; the kernel's other capabilities, the TypeScript doctor included, stay unexposed until a
consumer asks. The kernel reaches users as code the `voidmachine` package embeds, not as a
separately published npm package; publishing `@voidcorp/void-machine` on its own still needs
its own decision, as does any other kernel capability reaching users.

## Consequences

Positive:

- Delegation has one owner. The coordinator, `void-autopilot`, `void-implement` and the
  capture hook all call `void-machine agents dispatch`; a multiplexer adds a view, never
  an execution mode.
- The autonomous merge in consumer projects gets its independent reviewer from the same
  shipped path instead of a GitHub App.
- The kernel meets real users, so its contracts are proved on real sessions rather than
  on fixtures alone.

Negative:

- Kernel contracts that reach users become compatibility obligations: the `agents`
  command surface, the run states and the run directory layout under
  `.void/machine/runs/<mission-id>/` can no longer change silently.
- The published CLI grows by the kernel's delegation code and its runtime adapters, and
  a defect in them now reaches every consumer on update.
- This repository runs the published 4.0.0 hooks until 4.1.0 ships, so the real proofs
  run on a disposable consumer installed from `pnpm pack`, not here.

## Alternatives considered

- **Implement delegation in the current CLI, outside the kernel:** rejected. It would
  recreate a controller that the Void Machine vision removes, and a second owner of run
  identity, admission and reconciliation, against the one-owner rule of
  `adr:e492e50e-86b0-4427-9fdf-2435750ce60d`.
- **Keep delegation as prose in each skill:** rejected. That is the present state, and it
  produced three ways to launch an agent and the invisible reviews of DEV-902.
- **Publish `@voidcorp/void-machine` as its own npm package:** rejected for now. A second
  published package adds a version to keep in lockstep and an install step for consumers,
  for no caller outside `voidmachine`.

## Reversal cost

Medium. Removing the capability from a later release is a code change, but consumers
that call `void-machine agents`, and the run records they have written, would need a
deprecation path; recorded runs are never discarded.
