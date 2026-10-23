---
schemaVersion: 1
id: "adr:b75aa91f-01a4-403d-924a-78192b2d09e4"
createdAt: "2026-10-23T20:04:43.436Z"
title: "One local review authority and reusable CI tooling"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:6660e476-77c4-420b-801d-00f941c9395e"]
---

# One local review authority and reusable CI tooling

## Context

The local exact-head independent review duplicated a required GitHub model review
and an App-check queue relay. Promotion recertified the entire integration
history. Folpe approved their joint removal on 2026-10-23, with reusable browser
CI and the current stable Node version. The approved spec records one observed
10m20 browser preparation against 32s of tests, not a performance guarantee.

## Decision

Use the existing local independent review authority in this repository as in
consumer projects, keep deterministic CI and the merge queue, and maintain the
human promotion PR without recertifying historical merge authority.

This supersedes only the repository-specific review App exception in
adr:6660e476-77c4-420b-801d-00f941c9395e. Local review receipts, exact-head checks,
protected paths, human deploy-branch promotion and the Release App remain.
Delete the duplicate model workflow, check publisher, queue relay and historical
promotion audit together; introduce no replacement certification bridge.

Use the standard `.node-version` for primary local/CI/release Node (26.12.1 at
approval). Keep Node 24.15.0 only for supported-floor compatibility. Derive the
official Playwright noble image from the exact existing QA manifest; npm ci,
a generated lockfile and setup-node's native npm cache own dependency reuse.
Dependabot proposes scoped updates; browser evidence still requires review.

## Consequences

Positive:

- One independent review per unchanged candidate, fewer runtime integrations.
- Promotion remains understandable across external contributions, back-merges
  and history from before the migration; CI and human judgment remain gates.
- One browser version owner and one primary Node file; no custom image or cache.

Negative:

- The coordinator's local rights become the review trust boundary. This does
  not retain the separate App credentials' resistance to forged approvals.
- Live protection and default-branch workflow changes need supervised sequencing;
  a source-only change cannot retire a GitHub requirement safely by itself.
- Image pull costs, actual browser execution and cold/warm gains need real CI
  evidence; local contract tests do not establish performance.

## Alternatives considered

- Keep both reviews: retains server authority but also duplicate model cost and
  the integration surface the approved simplification removes.
- GitHub-only review: changes the consumer/local workflow and keeps the App setup.
- Sign or publish local verdicts into GitHub: recreates a certification bridge.
- Custom browser image/cache: adds ownership when the official image and native
  package-manager cache already provide the requested reuse.

## Reversal cost

Medium: restore the server reviewer, App-bound protection and queue relay as one
coordinated change; do not assume unused credentials still have suitable scope.
See docs/RELEASING.md for the live migration and docs/specs/2026-10-23-pareto-review-and-ci.md
for acceptance and official documentation sources.
