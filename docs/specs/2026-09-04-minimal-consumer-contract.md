---
title: Minimal consumer contract
date: 2026-09-04
status: approved
author: Folpe + Codex
ticket: DEV-808
related:
  - docs/specs/2026-08-31-autonomous-until-develop.md
  - docs/ARCHITECTURE.md
---

# Minimal consumer contract

## Outcome

Freeze only the behavior a consumer or the future native implementation must rely on. The same
black-box cases run against the packed TypeScript CLI today and the native executable during each
cutover. The contract is the executable test, versioned by Git; it has no second descriptive copy.

This replaces the unmerged PR #329 design. That design added 2,116 lines for an oracle whose 24
declared scenarios were backed by eight broad test operations. Eight consecutive CI runs then
revealed platform assumptions one at a time. The branch remains diagnostic evidence, not a base.

## Reliability rule

Reliability comes from fewer states and fewer authorities. Before adding a gate, abstraction or
security mechanism, remove or reuse anything that already owns the same invariant. A mechanism is
admitted only when it proves one distinct property at the narrowest useful boundary.

The test suite follows two established findings:

- hermetic tests access only declared inputs and write only to isolated locations;
- larger broad-stack tests are more likely to be flaky and give less directed failures.

References: [Bazel test encyclopedia](https://bazel.build/versions/9.2.0/reference/test-encyclopedia)
and [Google Testing Blog: Where do our flaky tests come from?](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html).

## Scope

DEV-808 owns two things only:

1. fix the demonstrated production bug where an invalid install receipt can be treated as absent;
2. add a thin black-box compatibility suite for the packed consumer CLI.

The black-box suite covers these public journeys:

- install for Claude-only, Codex-only and both-runtime projects;
- update of a locally packed install while preserving a user-owned sentinel;
- refusal of malformed and unsupported receipts before any write;
- doctor from a linked worktree and with no detected runtime;
- offline autopilot planning from the installed package.

Runtime permutations are table rows inside one test implementation, not separate framework
objects. Existing focused unit or component tests remain the authority for transaction internals,
collision classes, path normalization, process outcomes, interrupted-run recovery and exact-SHA
verification. Unreadable or non-regular receipt handling is also proven at that focused level,
where it does not depend on cross-platform permission emulation. The black-box suite does not
repeat them.

## Explicit non-goals

DEV-808 does not add:

- a native kernel, runtime adapter, memory store or router;
- a generic conformance framework;
- a JSON manifest mirroring test expectations;
- a custom JSON Schema validator or a filesystem crawler;
- normalized stdout snapshots or recursive tree hashes;
- defenses against modifying versioned test data while the same commit can modify its runner;
- real provider credentials, network calls or subscription-runtime execution in public CI;
- retries, quarantine or a larger timeout to convert a failure into success.

Proof-carrying execution remains a Void Machine runtime requirement. This test suite verifies the
runtime; it does not reimplement the runtime's proof system.

## Test boundary

Each case:

1. receives the exact packed artifact path explicitly;
2. creates one private temporary project and private home/config/cache roots;
3. starts from an allowlisted environment with no inherited project `.env` files;
4. replaces remote effects at their existing boundary with a local deterministic fixture;
5. invokes only the public CLI with `shell: false`;
6. asserts exit code, any applicable public diagnostic code and the exact relevant files or Git SHA;
7. asserts an untouched sentinel for user-owned state;
8. removes its fixture through the test framework's normal cleanup.

Assertions compare semantics, not incidental spelling. Paths are compared using platform-aware
filesystem semantics. POSIX mode bits are asserted only on POSIX; Windows asserts the behavior it
can represent. A timeout is a terminal infrastructure failure with diagnostics, never an expected
product result.

The black-box harness must not import production TypeScript. Its only product input is the packed
artifact or native executable selected by the test command. This is the seam the native migration
will reuse.

## Proof and CI

GitHub Actions already binds a job to a repository SHA and retains its logs. The suite therefore
emits ordinary named test results plus the packed artifact SHA-256; it does not persist another
attestation graph.

On every relevant pull request:

- the normal unit/component suite runs once;
- the same bounded consumer suite runs on Linux, macOS and Windows, with no platform-specific
  scenario graph;
- every matrix cell is required and `continue-on-error` remains false;
- the consumer suite packs once per matrix cell and reuses that artifact for every case.

Repeated stress, exhaustive fault injection, real subscription runtimes and native-versus-legacy
differential certification belong to nightly or release certification. They do not lengthen every
implementation loop.

VM-01 must require no external network to pass. It uses local artifacts and local provider
fixtures. It does not add a cross-platform firewall or network interception layer; stronger
sandbox evidence belongs to release certification.

## Failure policy

A failure must identify one case and one boundary. The correction order is:

1. reproduce the same cause in the smallest deterministic test;
2. correct production code when behavior is wrong, or the assertion when it encodes an unsupported
   platform detail;
3. run the focused test, then the impacted black-box case, then the relevant CI tier.

No fourth layer is added around a failing layer. Three failed correction strategies stop the unit
and require a new hypothesis or a smaller boundary.

## Implementation budget

The replacement is rejected during review if it introduces more authorities than it removes. Its
shape is intentionally bounded:

- the existing install and autopilot conformance scripts become one smaller consumer entrypoint;
- one small process helper only if existing helpers cannot be reused safely;
- ordinary test fixtures colocated with the cases;
- no normative file that restates expectations already present in executable assertions.

Line count is a diagnostic, not the goal, but exceeding roughly 400 new test/support lines requires
splitting scope or demonstrating which distinct reliability property each extra part buys.

## Rollout

1. Land the invalid-receipt regression test and production correction as one strict TDD pair.
2. Land the minimal packed black-box suite without changing public behavior.
3. Prove the exact branch SHA in the required CI cells.
4. Merge into `develop`, rerun the relevant evidence on the merged SHA, then mark DEV-808 Done.

The future native implementation passes these same black-box cases one capability at a time. The
legacy implementation remains authoritative until a case is green against the native path and the
corresponding cutover removes the legacy authority.

## Acceptance criteria

- [ ] The invalid-receipt regression is red before the production fix and then green.
- [ ] Every black-box case invokes a packed artifact and imports no production TypeScript.
- [ ] Every case has isolated filesystem roots and a minimal declared environment.
- [ ] The same bounded suite covers the named journeys on Linux, macOS and Windows.
- [ ] A missing matrix cell, real credential requirement or unexpected write fails.
- [ ] Failures name the case and boundary without persisting secrets or machine-specific paths.
- [ ] No retry, quarantine, raised assertion timeout, duplicated expectation manifest or recursive
      filesystem digest is introduced.
- [ ] CI is green on the exact branch SHA and again on the merged `develop` SHA.
