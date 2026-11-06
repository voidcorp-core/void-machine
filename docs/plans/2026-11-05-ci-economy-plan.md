---
title: Apply the CI economy audit in evidence order
date: 2026-11-05
status: executing
spec: docs/specs/2026-11-05-ci-economy.md
ticket: DEV-1138
author: folpe + Codex
high_risk: true
---

# Goal

Apply the approved [CI economy scope](../specs/2026-11-05-ci-economy.md), starting
with redundant promotion runs, then repairing reliability before optimizing
measured costs. Each unit produces one reviewable PR and evidence, using
`void-implement` inside `void-autopilot`. One worker at a time preserves the
requested order and avoids concurrent edits to workflows and generated assets.
This plan is authorized; routine sequencing needs no renewed approval.

## 1. Create promotion drafts

- **Goal:** avoid complete integration work while `develop` is still accumulating
  changes. This is the smallest independently useful slice.
- **Depends on:** none. **TDD mode:** strict for promotion behavior, souple for YAML.
- **Ownership:** `.github/workflows/promotion.yml`,
  `test/workflows/promotion-integration.test.ts`, `docs/RELEASING.md`,
  `docs/CI-CHAIN.md`; existing admission contracts only if behavior requires it.
- **Implementation:** new PR creation passes draft intent; reuse preserves the
  existing PR state. Keep repository/head/base validation, duplicate refusal,
  no-content behavior and API failure propagation. Explain ready-for-review in
  the PR body. Do not create another promotion branch or auto-merge path.
- **Verification gate:** observe RED/GREEN for new draft, existing draft, existing
  ready PR, duplicate, invalid identity, API error and no content difference.
  Existing draft admission tests prove readiness without a new commit and return
  to draft. Check generated CI contract and retain hosted evidence when available.
- **Expected change:** `ci(promotion): open new promotion requests as drafts`.

## 2. Ship consumer CI guidance with dependency audit

- **Goal:** make the economical CI path reusable in the package's existing example.
- **Depends on:** none; follows 1 by the requested order. **TDD mode:** souple for guidance/config; strict for new behavior.
- **Ownership:** `packages/core/skills/void-verify/references/{ci-feedback.md,quality.yml}`,
  `packages/cli/src/lib/ci-feedback.test.ts`, relevant verification contracts and
  generated `packages/cli/core-assets/` mirrors, `README.md`,
  `.github/workflows/enforce.yml`,
  `packages/core/templates/github/void-dependency-audit.yml`,
  `docs/DEPENDENCY-AUDIT.md` and `docs/RELEASING.md`.
- **Implementation:** cover draft/ready/merge-group behavior, immutable install,
  existing required names, package-manager and Node ownership, and dependency
  audit as an explicit project-owned check. State severity policy, lockfile scope,
  schedule or PR applicability, and unavailable-audit failure behavior. Never
  treat `npm ci` advisory output alone as a complete audit gate. Preserve existing
  review/enforcement owners; adopt into existing workflows only when requested.
- **Verification gate:** shipped-template/admission contract tests pass; a clean
  synthetic consumer exercises the documented command path and audit failure.
  Regenerate mirrors through their owner and check freshness. No real external
  consumer is changed or implied to have adopted the example.
- **Expected change:** `docs(ci): complete consumer quality workflow guidance`.

## 3. Repair clean-checkout certification

- **Goal:** make seeded stress results judge tests instead of missing build output.
- **Depends on:** none; follows 2 by the requested order. **TDD mode:** strict for the reproduced preparation defect.
- **Ownership:** `.github/workflows/test-certification.yml`,
  `scripts/stress-proof.mjs`, `scripts/test-network.mjs`,
  `test/verify/stress-proof{,-workflow}.test.ts`, `test/verify/network-lane.test.ts`,
  existing build script owner if needed, corresponding test documentation.
- **Implementation:** reproduce the missing compiled mission-engine failure from
  a clean tree. Prepare the actual dependency graph once before the loop. Keep
  build failure distinguishable from test failure and retain reports on failure.
  Forward shuffle and seed options through the network-lane wrapper to the actual
  Vitest invocation so its reported deterministic seeds affect test execution.
- **Verification gate:** RED proves the missing prerequisite; GREEN proves a
  clean-checkout fast and complete invocation. Then run the intended twenty fast
  and ten complete seeded attempts in the appropriate certification environment;
  retain exact SHA, seeds, counts, failing commands and report artifact. A bounded
  preflight is not presented as the full certification. No retries hide failures.
- **Expected change:** `fix(ci): prepare certification dependencies before stress`.

## 4. Measure and reduce subprocess cost

- **Goal:** address the largest observed validation lane with evidence.
- **Depends on:** 3 (DEV-1141 reliability prerequisite). **TDD mode:** exploratory for read-only profiling; strict for
  changed production behavior and regression fixes, souple for test organization.
- **Ownership:** `vitest.config.ts`, `scripts/test-*.mjs` where present, subprocess
  tests identified by the profile, their direct production owners only if proven
  necessary, and a bounded timing report under `docs/audits/`.
- **Implementation:** reproduce the `test:subprocess` lane on one controlled
  environment; collect per-file/process preparation and execution costs. Separate
  compilation, fixture setup and repeated CLI launch work. Optimize only the
  measured dominant repetition, preserving real consumer seams and bounded workers.
- **Verification gate:** retain baseline/candidate SHAs, commands, environment,
  sample counts, median and p95 where the sample supports them. The affected
  behavior suite remains green with meaningful coverage. Report total work and
  wall latency separately. A measurement-only PR may reject an uneconomic change.
- **Expected change:** measured `perf(test): ...`, or a documentation-only report.

## 5. Remove duplicate build and pack preparation

- **Goal:** prepare the same immutable inputs once where ownership permits reuse.
- **Depends on:** none; follows 4 by the requested order. **TDD mode:** strict for orchestration behavior, souple for wiring.
- **Ownership:** root `package.json`, `scripts/verify.mjs`,
  `packages/cli/scripts/conformance-artifact.mjs`, actual build/derive owners found
  in the measured invocation chain, `test/verify/`, relevant builder tests and docs.
- **Implementation:** trace preparation performed by decisions, package-size,
  validation, generation and consumer packing before removing duplication. Retain
  standalone command correctness. Reuse only within a proved source/environment
  boundary; do not cache a success across changed inputs or repack verified bytes.
- **Verification gate:** targeted orchestration tests prove dependency order,
  failing producer propagation, standalone execution and stale-input rejection;
  compare invocation counts and elapsed time. Existing generated/frozen-input
  checks and consumer tarball integrity hold. Run applicable full verification
  once on the candidate rather than repeating unaffected proofs per edit.
- **Expected change:** `perf(build): reuse verified preparation within CI`.

## 6. Repair graph applicability, then avoid unnecessary runners

- **Goal:** make the graph classifier safe before changing job allocation.
- **Depends on:** none; follows 5 by the requested order. **TDD mode:** strict for classifier, souple for workflow wiring.
- **Ownership:** `.github/scripts/changed-areas.sh`, `.github/workflows/ci.yml`,
  classifier regression tests under `test/verify/`, graph workflow contracts,
  `docs/CI-CHAIN.md` and related verification documentation.
- **Implementation:** enumerate actual transitive graph source, root manifests,
  lockfile, workspace/build/test configuration, conformance script and workflow
  inputs. Consider `previous_filename` as well as `filename`, deletions and API
  pagination/completeness. API failure, malformed/empty data or unsupported event
  runs the relevant proof. Only after this holds, classify once before allocating
  the three OS graph jobs, retaining stable required status semantics.
- **Verification gate:** table-driven cases cover each input class, rename into
  and out of graph scope, unrelated docs, failure, truncation/unknown completeness,
  empty response, merge-group, dispatch and push. Inspect real ready PR and merge
  group graphs: no required check disappears or turns unknown into success.
- **Expected change:** correctness commit before `perf(ci): ...` allocation work.

## 7. Bound local focused-proof applicability

- **Goal:** reduce local feedback work only where existing proof inputs justify it.
- **Depends on:** none; follows 6 by the requested order. **TDD mode:** exploratory investigation; strict if selection
  logic changes, souple for a documentation-only command map.
- **Ownership:** existing `void-verify` guidance, `scripts/verify.mjs` and its
  tests only if necessary, relevant proof catalogue and derived mirrors.
- **Implementation:** inspect the existing gate catalogue, dependency owners and
  local advice. Compare a conservative explicit command map with unchanged full
  verification. State what invalidates a proof. Default uncertain cases to full
  checks. Do not generalize into a new proof registry, caching framework or remote
  authorization mechanism. General reuse remains conditional on measured ROI.
- **Verification gate:** document representative change classes and selected
  commands, demonstrate missed-input cases fall back to full proof, preserve
  exact-head independent review and required integration CI. Record a supported
  no-change conclusion if selection costs more than it saves.
- **Expected change:** a bounded guidance change or measured selection improvement.

## Review checkpoints and safeguards

**Checkpoint A, first promotion PR:** the reviewed implementation of step 1 touches
`.github/`, so its merge belongs to a person. Prepare the complete PR and evidence
before requesting that action. The existing ready promotion is not converted by
this programme; any separate lifecycle change must be explicit.

**Checkpoint B, certification and CI machinery:** each protected PR from steps 3,
5 or 6 is handed to a person after exact-head independent review and applicable
proof. Step 7 does the same if it changes `scripts/verify.mjs`. The actual diff and
unchanged `PROTECTED_PATHS_FLOOR` decide, not this illustrative list. Other units
may merge into `develop` only when the existing autopilot contract permits it.
These checkpoints preserve real protected merges; they add no approval for
already authorized implementation. No unit promotes to `main` or publishes npm.

Use the existing native specialist and independent reviewer flow. A new behavior
or changed input invalidates only affected evidence. Generated assets have one
writer; workers remain commit-only, and the coordinator owns tracker transitions,
PR publication and any authorized local synchronization.

## Execution handoff

| Order | Native unit | Scope | Depends on | Native points | Human merge |
|---|---|---|---|---|---|
| 1 | DEV-1139 | Promotion drafts | none | 2 | yes |
| 2 | DEV-1140 | Consumer CI examples and audit | none (ordered) | 3 | if protected diff |
| 3 | DEV-1141 | Certification preparation | none (ordered) | 3 | yes |
| 4 | DEV-1142 | Subprocess profile and measured change | 3 | 3 | if protected diff |
| 5 | DEV-1143 | Build/pack preparation | none (ordered) | 3 | if protected diff |
| 6 | DEV-1144 | Graph applicability and allocation | none (ordered) | 3 | yes |
| 7 | DEV-1145 | Focused local proof investigation | none (ordered) | 3 | if protected diff |

The native tracker records, estimates and blocker relations are authoritative;
this table declares intent, never current/next status. Before claiming a unit,
fetch its complete record and relations, including relevant completed predecessors
DEV-821, DEV-824, DEV-844 and DEV-606. The
[active programme](../../.void/program.md) carries the bounded pool and explicit
autopilot consent after the coordinator reconciled the previous programme. Its
protected change requires independent review and human merge.

Read official GitHub Actions event, job-condition, concurrency, REST pull-request
file and merge-queue documentation before changing those interfaces. The current
[visual chain](../CI-CHAIN.md) links the job graphs and official graph guide.
