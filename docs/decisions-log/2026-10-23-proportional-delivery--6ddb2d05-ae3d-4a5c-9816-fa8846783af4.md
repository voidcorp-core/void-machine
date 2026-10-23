---
schemaVersion: 1
id: "adr:6ddb2d05-ae3d-4a5c-9816-fa8846783af4"
createdAt: "2026-10-23T14:09:57.668Z"
title: "Use proportional delivery with primary domain advice and observable proofs"
status: proposed
deciders: ["folpe"]
supersedes: ["adr:2b35db56-4a07-4e38-8984-e4e94fdcf3cf"]
---

# Use proportional delivery with primary domain advice and observable proofs

## Context

The maintainer reports losing development time to repeated design approval, optional improvement
loops and evidence ceremony in consumer projects. The 23 October audit identified conflicting
skill instructions despite a controller that already bounds review corrections. The maintainer
approved simplifying every audited domain, retaining TDD, senior standards, domain specialists,
security and one useful independent review.

## Decision

`void-implement` owns applicability. A clear explicit request is executable without manufacturing
tracker work or repeating accepted approvals. Before coding behavior, contracts or structure,
consult the primary domain specialist; add expertise only for a distinct uncovered risk. Reuse
advice while its inputs hold. This partially supersedes the prior advice policy: domain detection
now triggers actual primary consultation, while the absence of a compulsory canonical quorum
and all historical journal protections remain unchanged.

Preserve failing-test-before-behavior and observed GREEN, project coverage thresholds, KISS/SOLID,
trust-boundary safety and independent exact-subject review. Replace universal coverage targets
and phase-commit rituals with behavior/risk coverage and actual runner evidence. Scale UI and
E2E checks to affected contracts; full security audits remain deliberate work.

Stop when accepted behavior, applicable proofs and review hold. Optional nits and unneeded
refactors never trigger another correction. Reuse unaffected proofs; preserve bounded targeted
corrections for concrete defects. Prefer a different supported reviewer runtime where possible,
but canonical dispatch still binds runtime to the coordinator; do not relabel foreign receipts.

## Consequences

Positive:

- Consumer work spends effort on domain advice, code, tests and demonstrated defects.
- No additional gate, engine, profile or telemetry service is introduced.
- Runtime and hooks, required CI, independent review and existing budgets remain intact.

Negative:

- Applicability and specialist selection still require engineering judgment.
- Native advice is not mechanically proved by the canonical controller.
- Cross-runtime canonical routing and complete activation observability are not delivered here.

## Alternatives considered

- Keep every universal ritual: retains measurable reading and approval overhead without proving
  that optional work changes the delivered result.
- Remove tests, review or specialists for speed: rejected because those produce useful evidence
  and are explicitly required by the user.
- Introduce another risk engine and dashboard: duplicates existing responsibilities and enlarges
  this change before the workflow correction has been tested in consumer work.

## Reversal cost

Low for guidance: change the owning skills and their regression contracts. No journal migration,
new runtime schema, provider setup or consumer configuration is required.
