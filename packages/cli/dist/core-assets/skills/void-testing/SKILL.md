---
name: void-testing
description: Write meaningful behavioral tests with faithful boundaries, isolated setup, readable assertions and honest evidence. Use when writing or modifying tests.
---

# Testing

`void-tdd` owns when to test; this skill owns meaningful assertions and faithful boundaries.
**Attribution**: see `.source`.

## Observable behavior

Assert what a user or consumer can observe, using actual decision and authorization code.
Calls, counts, arguments and ordering are valid when they express an observable boundary contract:
zero unauthorized commands, no duplicate charge, bounded retries. Avoid assertions on private
implementation sequences that can change without changing behavior. Describe behavior in names;
lexical prefixes such as `should` never decide quality.

Use real collaborators where practical. Double external infrastructure at the lowest faithful
boundary and verify important integration contracts against the real system. Use the project's
existing tools; MSW, pglite, temporary directories, fake timers and seeded randomness are examples,
not required vendors. A lightweight fake must preserve the contract being proved. Do not mock away
business decisions or use an incompatible database substitute as proof of production SQL behavior.

For UI, prefer accessible roles and labels and exercise the actual input contract (keyboard,
pointer, touch). `data-testid` is useful when semantic queries do not express the target. Cover
applicable loading, empty, error, success and partial states. Focused regressions identify the
broken contract; broad E2E does not replace them.

## Isolation and readable data

Keep scenario-relevant data near the assertion. Local setup or simple factories often read best;
shared `beforeEach` preparation is fine when each test gets fresh or reset state. Avoid mutable
suite variables in concurrent tests. Extract bulky or reused fixtures when it helps clarity,
without a line threshold, compulsory directory or configurable factory for every fixture.

Short deterministic readable snapshots can clarify stable observable outputs. Review every
snapshot update; never regenerate blindly. Prefer targeted assertions for logic and interactions.
Honor explicit consumer policies without a universal directory whitelist or special approval.

## Useful test output

Unhandled errors/rejections, leaked resources, failed required assertions and sensitive-data
exposure invalidate evidence. The project logger remains mandatory in application code. Inspect
warnings for consequences; expected diagnostics and unrelated deprecations do not universally fail
a suite. Do not install a blanket console-failure handler or silence output to manufacture green.

Temporary focusing or exclusion is allowed during work. Before accepting evidence, run the
project's configured focused/skipped-test validation; here Biome `noFocusedTests` and
`noSkippedTests` are errors. Report conditional exclusions and todos honestly; a focused run is
not evidence for the entire applicable suite.

## Release E2E proves the shipped artifact

Release proof exercises the immutable deployable artifact, not a development compiler. Keep build
readiness (the process started and became healthy) separate from application assertions, so a slow
compile cannot consume the assertion budget or hide a failed startup.

Fixtures use the lowest faithful boundary that preserves the behavior under test. Establishing an
authenticated precondition may use a server/API boundary; the authentication UI remains an E2E
subject when authentication itself is the behavior being proved.

External state is namespaced per run/worker and cleanup is idempotent and bounded, including after
interruption. Browser storage state is sensitive ephemeral output and belongs under the test output
directory, never in source control.

Test-only security overrides are typed, bounded, and paired with independent proof of production
defaults and denial behavior. A malformed or out-of-range override falls back to safe production
defaults. No retry-on-failure, quarantine, skip, or assertion-timeout inflation is a flake fix.

## Coverage and composition

Use focused units for decisions, integration tests for seams and E2E for critical journeys. Select
by risk and cost, not a universal ratio. `void-tdd` applies project coverage requirements and actual
RED/GREEN evidence. Mutation testing is useful for concrete uncertainty or explicit requirements;
tool presence alone is not an obligation. `void-typescript-strict`, `void-migrations` and
`void-hexagonal-architecture` own their respective type, migration and boundary contracts.
