---
title: Reduce CI cost while preserving the proof chain
date: 2026-11-05
status: approved
ticket: DEV-1138
---

# CI economy

Folpe approved applying the 5 November CI audit in its recommended order through
`void-autopilot`, with a visual explanation of the complete chain. This scope
improves this repository and the CI guidance it ships. It does not authorize
promotion to `main`, npm publication or edits in external consumer repositories.

## Baseline and interpretation

The audit examined 978 workflow runs from 6 October through 5 November 2026:
3,187 jobs consumed 5,903.33 job-minutes. The 285 `ci` runs accounted for
5,376.78 minutes; their median duration was 338 seconds and p95 was 426 seconds.
These are observed elapsed job-minutes, not a GitHub invoice or a savings promise.

Since the 24 October changes, 33 CI runs consumed 449.08 minutes. Seven CI runs
on the standing `develop` promotion PR consumed 90.92 minutes, including two
cancellations. That is an upper bound on avoidable work: readiness must still run
CI, admission still costs time, and cancellations already curtailed some work.

Across 27 recent successful validation jobs, the median was 336 seconds. The
subprocess lane had a median of 184 seconds and p95 of 224 seconds; installation
was about one second. Browser work was about 76 seconds; Windows install
conformance was about 199 seconds after the artifact producer. Measure the
critical path and total job time separately; shaving a noncritical lane does not
necessarily shorten feedback.

Four weekly certification runs failed. The latest inspected artifact,
`13080440717`, reported zero successful attempts out of twenty and 57 failed test
files, including unresolved compiled `@voidcorp/mission-engine`. This is broken
preparation evidence, not evidence that twenty independent reliable runs occurred.

The figures above were observed in the 5 November audit conversation. Reconstruct
the window with `gh api --paginate 'repos/voidcorp-core/void-machine/actions/runs?created=2026-10-06..2026-11-05&per_page=100'`,
then fetch each selected run's `/jobs?filter=all&per_page=100` endpoint with
pagination. Retain run/attempt identity, event, branch, conclusion and job timestamps;
keep canceled runs and distinguish run duration from summed job duration. Historical
logs/artifacts can expire; report any reconstruction gap. Do not silently substitute
a newer sampling window or treat retained job metadata as retained test evidence.

## Required outcomes

1. Open new promotion PRs as drafts. Preserve an existing PR's human-selected
   readiness; never silently return a ready PR to draft. Readiness at the same
   commit must start complete required CI. Draft admission must remain a visible
   non-success, so skipped jobs cannot authorize a merge.
2. Ship usable consumer CI examples and adoption guidance, including dependency
   audit ownership, failure semantics and frequency. Retain the project's actual
   package manager, lockfile, Node version owner and required checks. Do not
   create another CI engine or install a second quality workflow.
3. Repair certification preparation from a clean checkout. Report real attempted
   and completed runs, seeds, command failures and exact source SHA. Demonstrate
   the intended twenty fast and ten complete runs with no success manufactured
   by retries, raised assertion timeouts or quarantine.
4. Profile subprocess work before optimizing it. Keep changes only when measured
   cost and unchanged behavioral coverage justify them. Preserve bounded process
   concurrency and failure propagation.
5. Remove measured redundant build/pack preparation within existing owners.
   Preserve standalone commands, generated freshness checks, dependency order,
   immutable artifact identity and consumer byte verification.
6. Repair ProjectGraph applicability before moving its classification ahead of
   runner allocation. Account for transitive build/test/config inputs and both
   sides of renames. Unknown, unavailable, incomplete or unsupported input must
   run the full relevant proof. Preserve non-PR and merge-group coverage.
7. Investigate bounded local focused-proof applicability using existing proof
   owners. A conservative documented command selection may be sufficient.
   General proof reuse is conditional on demonstrated value; no new registry,
   cache protocol or framework is required. Required integration CI remains whole.

## Invariants and exclusions

Local independent review remains the authority for an unchanged candidate; CI and
merge-queue checks remain required. The protected-path floor is unchanged. A
protected implementation PR goes to a person after its concrete review and proof
are ready. Existing drafts, cancellation isolation, exact source identity,
consumer tarball verification and release provenance cannot be weakened to save
runner time. An unknown proof is never a green proof.

The work extends, rather than repeats, completed DEV-821, DEV-824, DEV-844 and
DEV-606. Read their complete records and related code before implementation. The
[23 October decision](../decisions-log/2026-10-23-local-review-reusable-ci--b75aa91f-01a4-403d-924a-78192b2d09e4.md)
already owns the single local review authority and standard tooling reuse. A new
structural decision with credible alternatives requires its own immutable ADR;
this plan does not pre-approve an abstraction or a protection change.

## Acceptance and delivery

The [plan](../plans/2026-11-05-ci-economy-plan.md) supplies ordered, individually
verifiable units. Linear DEV-1138 and its native children own execution state and
blockers. The [visual chain](../CI-CHAIN.md) separates the current workflow from
the approved changes and links to actual GitHub run graphs.

For each implemented optimization, retain before/after commands, source SHAs,
environment and comparable timing samples. State cold/warm differences and the
sample size. A live protected workflow result may require a human merge; report
that limit instead of claiming a local contract test proves hosted execution.
No numeric savings target is invented from the audit. A measurement-only outcome
is acceptable for units 4 and 7 when a proposed optimization fails the value bar.


## Consumer reliability extension (8 November)

Folpe explicitly requested correcting the audited consumer issues through autopilot.
DEV-1204 precedes the existing CI pool and repairs the confirmed `info/refs` false
positive, couples publication to its guard, and retains explicit human renewal
proof. Its complete Linear acceptance criteria govern this bounded extension;
GitHub #535 and #536 remain subsequent work. The existing CI units and invariants
remain in scope. Strict publication TDD, independent exact-head review and human
merge of the protected programme change apply. No external consumer mutation,
release, deployment or silent baseline renewal is authorized.
