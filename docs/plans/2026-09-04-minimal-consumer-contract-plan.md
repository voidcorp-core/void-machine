---
title: Minimal consumer contract
date: 2026-09-04
status: in-progress
spec: docs/specs/2026-09-04-minimal-consumer-contract.md
ticket: DEV-808
author: Folpe + Codex
high_risk: true
---

# Plan: Minimal consumer contract

## Goal

Make the current npm consumer surface a small, reliable oracle for later Void Machine cutovers.
The work fixes one demonstrated fail-open receipt bug, consolidates two existing packed conformance
scripts into one smaller black-box suite, and makes that suite mandatory on Linux, macOS and
Windows without adding manifests, schemas, retries or a second proof system.

## Fixed constraints

- The base is `origin/develop`; PR #329 is evidence only and no commit is cherry-picked wholesale.
- The packed artifact is the system under test. Conformance imports no production TypeScript.
- Expectations live in executable assertions once.
- All fixtures and home/config/cache state are private to one test run.
- Correctness never depends on wall-clock speed on a shared runner.
- Failed tests are never retried, quarantined or made green by raising an assertion timeout.
- The current conformance support baseline is 335 lines: 108 install, 164 autopilot and 63 process
  lines. Their replacement may not exceed that total without removing equivalent scope.
- No lockfile, secret, production credential or external provider is touched.

## Steps

### Step 1 - Make invalid receipts fail closed

- **Goal**: distinguish a missing receipt from every invalid receipt before any mutating command
  stages work.
- **Depends on**: none.
- **TDD mode**: strict.
- **Files**:
  - `packages/cli/src/lib/receipts.test.ts`
  - `packages/cli/src/lib/receipts.ts`
  - `packages/cli/src/commands/update.test.ts`
  - `packages/cli/src/commands/update.ts` only if the typed error is currently swallowed.
- **Design**:
  - `ENOENT` is the only absent state;
  - malformed JSON, unsupported schema and other read failures throw one typed error with public
    code `INSTALL_RECEIPT_INVALID`;
  - keep the current `InstallReceipt | undefined` return shape for present/absent and use the typed
    error for invalid state, so there is one authoritative reader rather than strict and permissive
    variants;
  - do not add triple-stat TOCTOU machinery or a receipt state framework;
  - callers already propagate the typed error; change a caller only if a focused test proves it
    converts that error into success;
  - the error names its stable code, receipt path and invalid reason without suggesting automatic
    deletion of ownership evidence.
- **Verification gate**:
  - focused receipt tests prove absent, valid, malformed, unsupported and a deterministic
    non-regular/unreadable outcome without permission tricks;
  - focused update test proves the invalid case leaves a sentinel and the install tree byte-identical;
  - CLI package typecheck passes.
- **Expected commits**:
  - `test(receipts): reproduce invalid receipt fail-open`
  - `fix(receipts): refuse invalid state before mutation`

### Step 2 - Replace two packed scripts with one consumer probe

- **Goal**: prove the shipped CLI through one direct black-box suite while deleting duplicated
  packaging, process and fixture code.
- **Depends on**: Step 1.
- **TDD mode**: souple for test wiring; strict for any production defect the probe discovers.
- **Files**:
  - replace `packages/cli/scripts/conformance-install.mjs` and
    `packages/cli/scripts/conformance-autopilot.mjs` with
    `packages/cli/scripts/conformance-consumer.mjs`;
  - reuse and, only where needed, shrink or extend
    `packages/cli/scripts/conformance-process.mjs`;
  - update the root `package.json` scripts without changing dependencies.
- **Cases**:
  - pack the CLI exactly once;
  - install Claude-only, Codex-only and both-runtime fixtures from that artifact;
  - assert installed skills, agents, hooks and receipt at their public paths;
  - preserve an adjacent user-owned sentinel across the real `update` command;
  - refuse malformed and unsupported receipt updates before changing the fixture;
  - run installed `doctor` for absent runtime and linked-worktree observations;
  - run installed offline `autopilot plan` and assert the stable semantic result;
  - keep exact-SHA and interrupted-run internals in their existing focused tests.
- **Process boundary**:
  - explicit minimal environment plus fixture-local cache/config/home;
  - `shell: false`, bounded stdout/stderr and a terminal process timeout;
  - no process-tree framework, output hashing, filesystem crawl or custom attestation;
  - always remove the temporary root in `finally`;
  - remove the current `p50 < 60s` correctness assertion; timing may be printed as an observation.
- **Verification gate**:
  - `pnpm conformance:consumer` passes twice locally from two fresh temporary roots;
  - the second run does not reuse the first run's npm cache or project state;
  - the old conformance scripts and package commands no longer exist;
  - combined consumer plus process support is at most 335 lines.
- **Expected commit**:
  - `test(conformance): consolidate packed consumer proof`

### Step 3 - Gate the same bounded suite on every supported OS

- **Goal**: make one failed platform cell visible and authoritative without duplicating the unit
  suite or masking one command with the next.
- **Depends on**: Step 2.
- **TDD mode**: souple.
- **Files**:
  - `.github/workflows/ci.yml`
  - `.github` workflow parser tests if the repository's current workflow contract needs one;
  - `docs/CONTRIBUTING.md`
  - generated skill references only if deletion of the old script makes them stale.
- **Design**:
  - retain the existing Ubuntu, macOS and Windows matrix;
  - run `pnpm conformance:consumer` and `pnpm conformance:hooks` as separate steps;
  - keep every cell required and `fail-fast: false` so all platform evidence returns in one run;
  - set a job-level infrastructure ceiling, not a product performance assertion;
  - upload no custom attestation: the named test output, artifact digest, job result and GitHub SHA
    are the evidence.
- **Verification gate**:
  - workflow contract tests prove both commands are separate required steps;
  - `pnpm verify` passes locally on the exact branch SHA;
  - the remote PR matrix is green on Ubuntu, macOS and Windows for that same SHA.
- **Expected commits**:
  - `test(ci): require isolated consumer conformance steps`
  - `ci(conformance): gate the packed consumer on every OS`

## Review checkpoint

After Step 3, stop before merge. Compare the final diff with `origin/develop` and reject it if:

- conformance support grew beyond 335 lines;
- one expectation exists in both data and code;
- a new general framework, schema, retry or platform-specific scenario graph appeared;
- a focused existing test was copied into the black-box suite;
- CI evidence is not bound to the exact reviewed SHA.

Then run `void-code-review` and `void-verify`. The pull request targets `develop`; promotion to
`main` remains human-only.

## Execution handoff

Linear issue DEV-808 owns mutable state, branch and review evidence. These are internal sequential
steps of that single issue, not new tickets and not an autopilot cluster.

| Order | Step | Depends on | Human gate |
|---:|---|---|---|
| 10 | Invalid receipt fails closed | none | no |
| 20 | Packed consumer scripts collapse into one | 10 | no |
| 30 | Three-OS CI gate and documentation | 20 | review before merge |

DEV-808 moves to In Review only after all local gates pass and the exact branch SHA is pushed. It
moves to Done only after merge into `develop` and fresh green evidence on the merged SHA.

## Plan-review disposition

**Scope gate**: the complete plan names more than eight files, but only the receipt reader and its
update path change production behavior. Two conformance scripts are deleted and consolidated;
the remaining files are tests, CI, documentation or generated references. Splitting this into more
tracker units would add coordination without reducing a production boundary, so DEV-808 stays one
unit with three separately gated steps.

**Engineering lens**: CLEARED after moving unreadable-receipt proof out of the three-OS black-box
matrix. Permission simulation would make the test platform-dependent; a focused deterministic
non-regular/read-error case proves the branch directly. The black-box cases retain malformed and
unsupported receipts because those are stable public inputs.

**DevEx lens**: CLEARED for this slice. The failure must state code, path and reason. Automated
receipt repair is explicitly deferred because the tool cannot infer ownership safely; inventing a
repair command here would weaken the fail-closed behavior.

### Implementation tasks from review

- [ ] P1: keep unreadable/non-regular receipt proof focused and deterministic, never chmod-based.
- [ ] P1: prove update preserves the complete fixture when receipt parsing fails.
- [ ] P2: keep the receipt reader's public return type and introduce only one typed invalid error.
- [ ] P2: keep consolidated conformance support at or below its measured 335-line baseline.
