---
schemaVersion: 1
id: "adr:21424ca9-48ce-4b9e-a559-3d23d44481b4"
createdAt: "2026-10-29T21:29:37.795Z"
title: "Make Machine the execution system of Cortex with development as its first specialty"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Machine is Cortex's execution system; development is its first specialty

## Context

On 2026-10-29, Folpe explicitly requested permanent formalization of Machine's
vocation and the Cortex/Machine boundary. The public product is currently a
software-development harness. Private mission, runtime and sourced-note code
already separates some generic mechanisms from development policy; that is not
proof of a complete Cortex integration.

## Decision

Make Machine the general-purpose action and execution system of Cortex, with
software development as its first specialty, not its final scope.

The normative responsibility and mission-return contract lives in
[Machine vocation](../MACHINE-VOCATION.md). Cortex owns intent, durable context,
personal memory, priorities, authorization and final acceptance. Machine reasons,
plans, selects capabilities, acts and verifies inside the received mandate.
It returns results, evidence, uncertainties and knowledge proposals; it never
independently decides durable personal-memory writes or global priorities.

A specialty is policy and capability, not necessarily another agent. Prefer direct
execution and existing primitives. Do not require a new engine, plugin framework,
service split or code migration to adopt this boundary.

This extends the existing TypeScript layer-ownership decision and preserves the
bounded generic mission core's implementation limits. It supersedes no accepted
record: development-specific contracts remain in force within their scope.
The direction and integration into develop are explicitly authorized by Folpe.
No implementation of the proposed evolution or publication is claimed.

## Consequences

Positive:

- Development investments and the direct CLI use case remain useful.
- Other specialties can be introduced without a competing user brain or global planner.
- One owner for knowledge acceptance and permissions prevents silent authority drift.

Negative:

- Existing schemas and development policies cannot be advertised as a general API.
- Each first real specialty needs bounded adaptation and outcome evidence.
- Runtime evidence retention and personal memory must remain explicitly distinct.

## Alternatives considered

- Keep Machine permanently development-only and let Cortex build each other executor:
  rejected because execution, recovery and proof responsibilities would be duplicated.
- Turn Machine into a second autonomous user assistant with its own memory and goals:
  rejected because it competes with Cortex for intent, authority and acceptance.
- Rewrite a generic orchestration framework now: rejected because the existing
  mission seams and sourced-note vertical permit a smaller, measured next step.

## Reversal cost

Low for this documentation-only change; medium once a Cortex consumer depends on
these boundaries. A reversal would need a superseding ADR, explicit reassignment
of permissions and retained mission evidence, and compatibility for callers.
