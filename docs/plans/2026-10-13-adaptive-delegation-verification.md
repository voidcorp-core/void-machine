# DEV-1019 verification

This record distinguishes instruction contracts, distribution and observed native actions.
The approved scope is in `docs/specs/2026-10-13-adaptive-delegation.md`.

## Initial candidate

Base: `446691befd3cb2a376b7884c4c32ac772aa06c94`.
Policy/workflow candidate: `757131cb4fcd24c231d1580ea658272a0c383448`.
Policy SHA-256: `6b320bb97c7626e778275126e6dae9d2f2483901f5b8910ca097d2782522f29a`.
Later test-only corrections do not change that policy.

## Observed proofs

- Instruction contracts: initial 6 failures/28 passes before implementation;
  114 tests in seven focused files passed afterwards. A missed old Autopilot
  assertion surfaced in the full suite and was updated to the approved portable
  contract; all 31 tests in that file then passed. These are text-contract tests,
  not evidence that a runtime followed every instruction.
- Build, typecheck, lint, official derive/check, skill references, doc parity,
  anti-bloat, version and ADR immutability checks passed. Lint advisories remain.
- Disposable consumer installed with the actual CLI using both runtimes and
  `--no-interactive`: both generated instruction blocks request delegation and
  both installed policies match the candidate bytes. The first invocation omitted
  noninteractive mode, returned at a prompt and installed nothing; that attempt
  is retained separately, never counted as success.
- Native Codex context `/root/native_policy_probe` actually launched two fresh
  read-only research children, received both native completion events, collected
  and checked their results. This proves bounded research delegation/collection.
- Codex CLI 0.162.1 completed tiny and assigned-worker read-only probes without
  observed child calls. Its research JSON lacked child identities despite the
  final response claiming delegation; that CLI trace alone is not accepted as
  launch/collection proof.
- Claude Code 2.1.296 completed the tiny probe directly while Agent remained
  available. Research issued two real Agent calls, then reached the configured
  cost cap before collection. Assigned-worker probe read directly but also hit
  the cap before completion. Both are partial, not passing end-to-end cases.

Missing capability/isolation and review preservation are contract-only evidence.
No actual feature delivery, durable recovery, machine-wide scheduler, global
installation or speedup benchmark is claimed by these native read-only probes.
No permissions were widened, hooks bypassed, or other projects installed.

## Preserved red gates and diagnosis

The initial `pnpm test` passed CPU (244 files/2361 tests), then failed filesystem
(161 files passed/3 failed; 2150 tests passed/5 failed). One failure was the
obsolete Autopilot assertion above. Four were 10-second timeouts in unchanged
cache-retention and presentation-adapter tests.

Read-only investigation found two test-construction defects: indirect real
subprocesses were classified as filesystem, and a cache-only test performed 460
separate durable ingestion calls. A separate test correction preserves 23 missions,
460 canonical events and all assertions while using one fixture write per journal;
it marks the presentation test as subprocess. The classification regression was
observed red before the marker fix. There is no timeout increase, retry, quarantine,
reduced event count or production-runtime fix. This does not establish that host
load caused the original failures, nor make those failures disappear.

The first subprocess lane failed four cases (115 files/1669 tests passed;
2 files/4 tests failed) in unchanged mission and Autopilot review tests.
Retained journals show continuous progress and overlapping unfinished async work
after a timeout. They do not establish which host condition caused the first overrun.

The structural correction keeps all assertions: native review's three identical
pre-history checks run once instead of four times (nine duplicate command calls
removed); the 327-line mission omnibus becomes seven focused cases, each preparing
its own real Git/journal/dispatch state inside the timed body. A fresh doctrine
critic accepted this bounded approach. An explicit old-to-new assertion map is
retained for the independent final reviewer. No accepted review state is injected.

First verification after each substantive correction:

| Changed proof | Result |
| --- | --- |
| Invocation cache and resource catalogue | 52/52 passed |
| Presentation contract after classification | 40/40 passed |
| Native review after duplicate-proof removal | 25/25 passed |
| Mission after decomposition | 40/40 passed |
| Previously unexecuted network lane | 103/103 passed |

CLI typecheck and focused lint passed after the final test-helper change.
The presentation file's sole marker comment is outside the configured Biome scope.
Normal commit hooks pass. No UI, business logic, database or delivery boundary is
added, so viewport, migration and new business telemetry checks do not apply.

Validation composes the initial passing cases with these changed-case results;
there is no claim that the original full-suite invocation passed. No unchanged red
case was retried to manufacture a green gate. The independent final review still
owns inspection of the committed candidate and assertion mapping; its verdict is
recorded in the PR, not predeclared here. Detailed original logs and native action
summaries are local ignored evidence under `.void/machine/dev1019/` in the task
worktree. There is no global consumer activation in this change.

## Validated session-host refinement

Folpe clarified that Herdr is optional for consumers but must be used for supported
durable workers and mission visibility when it hosts the validated coordinator.
The refinement updates the policy, both managed runtime instructions, their mirrors
and documentation; native short agents and mandatory review/isolation remain intact.
Other hosts require verified capabilities. No new tmux transport is supplied.

The first focused run after this refinement passed all 65 tests in the three
orchestration, Autopilot and managed-instruction contract files. Generation checks,
references, doc parity, anti-bloat, ADR immutability, CLI typecheck and focused lint
passed. Raw logs and exit codes are under `.void/machine/dev1019/host-*`. The policy
remains 311 lines. These are instruction/distribution checks, not a live worker
launch or a fresh execution of the earlier native probes. Earlier probe evidence
remains scoped to its initial policy candidate.

Read-only installed CLI observation found Herdr client/server 0.9.3 compatible,
with no restart needed. The inherited current-pane hint pointed to another project;
no pane was controlled. This observation illustrates why environment/pane hints
cannot replace canonical project and worktree identity checks.

This instruction-only refinement adds no UI, database, business telemetry or new
authentication boundary; those checks are inapplicable. Exact-commit independent
review and GitHub checks are reported on the PR, never predeclared here.
