# Evaluation runner runbook

Status: historical reference, retired by DEV-1400. The engine, campaign commands
and protocol inputs described below no longer ship. Preserve these observations
for history; they are not executable instructions. For optional native scenarios,
see [the retained scenario guide](../apps/eval-harness/README.md). No paid run is authorized.

This document is the durable operating model for the autonomous-value
evaluation path. It exists to keep the implementation reproducible, bounded and
fast after a context clear. It is not a second test runner and it does not
authorize paid model calls.

## Reference implementations

The design follows the load-bearing patterns in these public codebases:

- [Inspect AI task execution](https://inspect.aisi.org.uk/tasks.html) models an
  evaluation as dataset, solver and scorer, with explicit sample, token, turn,
  time, working-time, cost and concurrency limits. Its
  [control channel](https://inspect.aisi.org.uk/control-channel.html) makes
  progress, stalls, errors and cancellation observable while a run is alive.
- [OpenAI Evals](https://github.com/openai/evals/blob/main/docs/build-eval.md)
  stores one input per JSONL row, keeps evaluation logic separate from scoring,
  and versions data so a result can be reproduced.
- [SWE-bench evaluation](https://github.com/swe-bench/SWE-bench/blob/main/docs/guides/evaluation.md)
  evaluates a patch from an exact repository state inside an isolated
  environment, runs held-out tests, records per-instance results and exposes
  bounded worker and cache controls.
- [GitHub Actions matrices](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
  make parallelism, fail-fast behaviour and per-cell continuation explicit.
- [Vitest parallel and sequential projects](https://vitest.dev/guide/recipes/parallel-sequential)
  keeps ordinary tests parallel while isolating tests that share a scarce
  resource.

The adaptation here is deliberately smaller: one deterministic TypeScript
control plane, one runtime adapter per model, and no retry-based recovery.

## Context policy for long-running agents

The context itself is a finite runtime resource. The official guidance from
OpenAI and Anthropic converges on the same operational rule: do not keep feeding
the model the entire history. Keep a small high-signal state, retrieve details
just in time, and compact before the context limit becomes an emergency.

- OpenAI describes context-window management as part of the agent loop: when a
  threshold is reached, replace the old input with a compact representation that
  preserves the useful state. Configuration changes are appended as new state,
  rather than silently rewriting earlier history. See
  [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
  and [Responses API context compaction](https://openai.com/index/equip-responses-api-computer-environment/).
- Anthropic recommends minimal high-signal context, just-in-time retrieval,
  compaction, structured note-taking and clear artifacts between sessions. Its
  long-running harness uses an initializer followed by incremental coding
  sessions; compaction alone is not considered sufficient. See
  [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
  [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  and [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

For this repository that becomes five explicit context layers:

1. Stable doctrine: `AGENTS.md`, `CLAUDE.md` and the installed philosophy.
2. Execution scope: explicit config authority, native milestone membership and its approved
   plan/spec links, only when selecting or executing scoped work.
3. Current task: the exact ticket, relevant files and the smallest necessary
   reference material.
4. Runtime state: bounded tool output, test failures and durable artifacts,
   referenced by path and commit rather than pasted in full.
5. Handoff state: `.void/machine/checkpoint.md`, containing only dead ends,
   assumptions, freshness and one exact next action.

The transcript is not a durable state store. Do not paste old campaign logs,
full prompts or repeated test output into a new context. Store a redacted
artifact, record its commit and digest, and retrieve only the lines needed for
the next decision. When the context approaches its measured budget, compact at
the next safe boundary: after a cell, after a test lane or before a new
implementation slice. Never compact in the middle of an unrecorded mutation.

## Clear and resume protocol

Use this protocol whenever the context is long, continuity is degraded, or a
session changes direction:

1. Stop admitting new paid or external work.
2. Commit or explicitly explain every working-tree change.
3. Run the relevant local lanes and record the exact commit they tested. For
   uncommitted changes, also record the diff digest and untracked paths; a HEAD
   alone does not identify a dirty tree. Never label that evidence a release
   proof for the unchanged HEAD.
4. Write the checkpoint, preserving the mechanical continuity block and keeping
   one exact next action.
5. Clear the conversation.
6. Resume by reading the doctrine, config authority, native milestone plan, runbook and checkpoint;
   do not reconstruct the history from the transcript.
7. Reconcile its next action with Git, the provider and the latest explicit user
   instruction. Execute that bounded action until fresh evidence changes it.
   A checkpoint cannot override a new instruction or authorize a paid run.

A clear is therefore a controlled handoff, not a loss of work. It reduces the
amount of context while preserving the decisions, evidence freshness and one
safe continuation point.

### Working context during implementation

Keep the active brief to the objective, acceptance criteria, authorized actions,
relevant source paths and unresolved evidence. Read by question: identify the
owning file, then retrieve the bounded section that answers it. Independent
exploration returns findings and source pointers from a fresh context. It must
not return complete file dumps. Do not reload an already-read skill or repeat a
passed lane unless changed inputs or a concrete uncertainty invalidate it.

Send long command output to a local diagnostic artifact and inspect its summary
and first causal failure. Record the command, source identity, environment,
outcome and artifact path. A summary must preserve failures, skipped cases and
unknowns. It must never turn truncated output into a complete proof.

At each verified boundary, remove resolved questions from the active brief and
record only the remaining residue in the checkpoint when a handoff is needed.
An unavailable context-window denominator is `unknown`: no invented percentage,
and no claim that a hook performs semantic compaction. Never reconstruct paid
admission or completion from conversation memory; read the durable archive.

## Invariants

These are release-blocking properties, not suggestions.

1. A manifest is immutable for a run. It identifies the campaign, source commit,
   fixture digest, runtime, model, model version, effort, resource profile and
   order seed.
2. The schedule is deterministic. The pilot is exactly nine cells times three
   repetitions: 27 execution identities, each with a stable sequence.
3. A cell starts from the manifest source. The workspace factory must expose its
   actual base commit, and the runner refuses to execute when it differs from
   `startCommit`.
4. Fixtures are validated before execution. A digest mismatch is
   `unproducible`, never a scored failure.
5. The agent process is bounded by timeout, output, event, fixture and workspace
   limits. Stderr is diagnostic-only and must not consume the bounded evidence
   output budget.
6. Evidence is written by the executor. Worker claims, logs and prose are not
   proof. Missing, contradictory, thrown or contaminated evidence becomes
   `unknown`.
7. There are no retries in a quality gate. A retry changes a deterministic proof
   into a probabilistic one. Recovery is an explicit new run after the cause is
   fixed.
8. Admission is bounded. The scheduler uses bounded concurrency, preserves
   schedule order in the report, persists progress after each observation, and
   stops admitting new work after an infrastructure `unknown` when configured
   fail-closed.
9. Unknown is not zero. An absent result, failed cleanup or unavailable reviewer
   remains visible and makes the quality evidence inadmissible. An unknown
   secondary metric stays unknown and cannot support a comparison of that
   metric. `PilotReport.valid` checks the pilot's result identities and critical
   defects; it does not certify known cost, authorize spending or replace review.
10. Scoring is downstream from execution. The runner produces observations; the
    pure scorer validates identity and computes aggregates only from admissible
    observations.
11. Release verification is separate from cell verification. A cell runs only
    targeted checks. The full release suite runs once on the final integrated
    tree.
12. A report is bound to the exact source, fixture, artifact and configuration
    identities it describes. A stale result is rejected, not relabelled.

## Execution topology

```text
immutable manifest
        |
        v
deterministic schedule (27 identities)
        |
        v
bounded admission (<= 3 campaign cells; <= 4 adapter workers)
        |
        +--> exact workspace -> fixture check -> base SHA check
        |                         |
        |                         v
        |                   bounded runtime
        |                         |
        |                         v
        |                   sealed evidence
        |
        +--> persist observation after every cell
                                      |
                                      v
                         pure report and admissibility gate
                                      |
                                      v
                         one full release gate after integration
```

The current versioned composition is
`runAutonomousValuePilot()` in
`apps/eval-harness/src/autonomous-value/campaign.ts`. It connects schedule,
adapter, observation stream and report. `runAutonomousValueCell()` in
`runner.ts` owns workspace identity, bounded execution and evidence sealing.
The `onObservation` callback is the persistence seam; a production launcher must
write one durable, redacted record per callback before admitting more work.

`runDurableAutonomousValuePilot()` in `durable.ts` now owns that local archive
boundary. It calls the versioned composition directly with concurrency one and
fail-closed admission. Its input names an archive directory, validated manifest
and configuration key; its caller supplies the existing cell adapter. It does
not invoke a model by itself. The optional budget authority extends this same
journal; the unbudgeted archive remains a local adapter/testing facility, not
an alternative paid runtime admission path.

Each archive contains a manifest/configuration identity digest, one record per
admitted execution and the report. Before invoking the adapter, the launcher
syncs an `admitted` record. Afterward it syncs the validated observation, renames
the pending file atomically and syncs the directory. The next cell starts only
after this succeeds. Records contain whitelisted metrics and fixed diagnostic
reasons, never arbitrary adapter prose, a prompt or transcript. The local
archive uses POSIX no-follow/nonblocking opens and directory sync; it is not a
portable remote-storage adapter. Reads reject special files and records larger
than 8 KiB before parsing.

On resume, a completed observation is reused without invoking the adapter. An
admission without its observation becomes `unknown`: the effect may already
have happened and is never replayed. A changed identity or malformed archive
refuses execution. An exclusive `launch.claim` prevents overlapping launches;
a claim left by a hard crash is never broken automatically. Inspect the owning
process and archive before any manual recovery. A pending write or ambiguous
state is a stop, not permission to delete evidence and try again. These local
files are not authenticated against a malicious archive owner.

### Runtime composition boundary

`runDurableRuntimePilot()` in `runtime-pilot.ts` connects the durable launcher
to condition prompts, the bounded conformance executor, workspace cleanup,
sealed-evidence verification and the existing absolute quality gates. Production
defaults refuse both Codex and Claude; tests supply a controlled, zero-cost
bounded adapter around the real executor and use disposable Git checkouts.
No CLI entry point or paid launch is enabled
by this library composition.

The trusted caller supplies a workspace factory, deterministic task loader,
independent assessor, budget authority and bounded runtime adapter. Missing or
incompatible authority refuses before reservation or workspace creation. The
former permissive `admit` callback no longer exists. Approval provenance is an
explicit trusted attestation of the canonical approval digest; parsing an
approval does not establish human consent.

The bounded adapter owns actual enforcement of the supplied microdollar cap,
including simultaneous calls, in-flight calls and descendants. Its runtime,
model, version, effort, coverage and proof digest are bound into the archive
identity. A digest is a reference to reviewed enforcement evidence, not proof
by itself. This code-only trusted port is not accepted from evaluated-worker
JSON or a CLI switch. No provider enforcement implementation ships here.

### Durable budget authority

The operator supplies one preexisting canonical POSIX authority root shared by
all launchers. The child directory is derived from the canonical approval digest
alone. An export path, changed configuration or policy cannot open a new budget.
`archiveDirectory` does not select authority for budgeted runs; reports currently
remain in the authority directory and no export writer is provided. Neither the
root nor claims are recreated or reclaimed automatically. The parent directory
is synchronized after child creation and on reopening an existing child.

`budget.ts` converts canonical decimal USD spellings exactly: the approved
budget rounds down and each execution cap rounds up to safe integer microdollars.
The 27 distinct schedule reservations are frozen before execution. Each funded
admission checks remaining credit, then synchronizes its reservation before the
callback. Reopening validates all bounded records and their total before effects.
Reservations survive completed, failed and unknown results; measured cost never
refunds them. A zero reservation is allowed only for an observed blocked result.
Interrupted admissions are never replayed. Missing legacy monetary fields,
invalid amounts, identity conflicts and ambiguous pending writes refuse.

The approved design is
[durable budget admission](specs/2026-09-07-eval-durable-budget-admission.md).
Its 27-execution approval is not a canary approval. The trusted-root assumption
excludes a malicious operator deleting or forging their own authority archive.

### Runtime task and quality identity

Tasks are loaded before archive binding. Their task, fixture and skill contents,
the artifact digest, and versioned admission/assessor policy identities join the
archive identity. Changed instructions cannot reuse a previous score. Loaders
must be read-only and deterministic; policy keys must change when their trusted
implementation or approval scope changes. No task content is written to the
archive: only its digest contributes to the binding.

The assessor receives verified sealed evidence after cleanup, not a live
workspace. A held-out check requiring the live checkout belongs before cleanup
in the executor boundary. Exit zero alone is never a quality score. Missing or
thrown assessment stays unknown; an absolute quality failure blocks. The
reported score comes from the independent assessor, not the scorer's secondary
correction-efficiency metric. Cost remains unknown without a trusted meter.
Only the normalized result is durably archived; this is not a retained full
sealed-evidence bundle or a blind-human review system.

The caller still owns actual artifact installation/attestation, runtime-version
attestation, resource isolation and a validated grading implementation. These
trusted capabilities are not certified by dependency injection or local tests.
The current consumer artifact installer is Codex-specific; merely selecting a
Claude invocation does not make that installation path Claude-ready.

Runtime arguments now carry the declared effort and Codex JSONL output. They
were checked against local Codex 0.145.0 and Claude 2.1.263 help, the
[versioned Codex configuration schema](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/core/config.schema.json)
and the [official Claude CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags).
Codex accepts a bounded model-advertised effort identifier; Claude validation
uses the five values advertised by the installed version. No Codex dollar cap
was established. Claude's print-mode `--max-budget-usd` exists, but is not wired
or claimed here as a campaign reservation ledger or an invoice-level guarantee.
An assembled condition prompt exceeding 65,536 UTF-16 code units is refused, never truncated:
silently dropping the active skill would change the experimental condition.

## Test lanes

The default feedback loop is intentionally layered:

| Lane | Command | Allowed dependencies | Gate |
| --- | --- | --- | --- |
| Fast | `pnpm test:fast` | pure CPU and contracts | changed behavior; target its regression first |
| Filesystem | `pnpm test:filesystem` | temp dirs, git, local fixtures | runner/workspace changes |
| Subprocess | `pnpm test:subprocess` | child processes, bounded I/O | process/adapter changes |
| Network/browser | `pnpm test:network` | local loopback server/client | release or changed network boundary |
| Release | `pnpm verify` on the final tree | all required gates | before promotion |

The network/browser lane must have one top-level timeout, an explicit service
health check, and an observable `unknown` outcome when the service is absent. It
must not hold the fast lane hostage. A test that spends its whole timeout
without accepting a connection is an environment failure to diagnose, not a
reason to add retries or increase every timeout.

`pnpm test:network` now runs `scripts/test-network.mjs`: one loopback
server/client exchange with a two-second ceiling, followed by one Vitest lane
with a 120-second ceiling. A failed capability probe or killed test process
prints `status: unknown` and exits 2; failed assertions exit 1; only the complete
passing lane exits 0. The release gate continues to refuse either nonzero
outcome. The current lane contains HTTP/SSE server tests, not a browser journey.
Adding a browser service requires its own observed health and cleanup contract.

The lane uses the [Vitest 5 threads pool](https://vitest.dev/config/pool.html)
so its test workers terminate with the bounded parent. It runs once, without
retry, and never widens sandbox permissions itself. If the probe reports
`EPERM`, execute the same command in an explicitly available environment that
permits local sockets. Do not change assertions or report the unavailable lane
as passed. On 2026-09-07 the same checkout passed all 25 network tests outside
the restricted sandbox in 1.17 seconds, while the sandbox probe refused
immediately.

The CLI's two TypeScript builders and the studio data preparation use
`node --import tsx` with installed tsx 4.22.4, following its
[Node registration API](https://tsx.is/dev-api/).
This avoids the CLI's IPC server; it grants no network capability to tests.
The certification builder's `--check` path and the complete graph builder are
verified inside the sandbox.

## Test management policy

Anthropic's evaluation guidance separates five objects: a task with unambiguous
success criteria, a trial of that task, graders, the complete transcript, and
the final environment outcome. OpenAI's evaluation API similarly separates the
versioned eval definition, its testing criteria, each run, and each output item.
That separation is the key to avoiding the current failure mode where one large
command hides which layer is broken.

Apply the following rules:

1. A task is small, concrete and independently passable by a domain expert. If
   two experts can interpret its acceptance criteria differently, fix the task
   before measuring a model.
2. A trial is one clean attempt. Repetitions are declared in the manifest to
   measure variance; they are not retries of a failed attempt.
3. A grader has one responsibility. Use deterministic code graders first:
   tests, static analysis, typechecking, security checks and final-state
   assertions. Use a model grader only for qualities code cannot observe, and
   calibrate it against human judgments. The human judge is specifically for
   subjective quality that code cannot decide reliably, and for the final
   promotion decision; it is not a replacement for automated correctness
   proofs.
4. The transcript is diagnostic evidence, not the score. Store it separately,
   redacted and bounded. Score the resulting environment state whenever the
   task changes files or data.
5. Every run records per-item status and counters: scheduled, admitted, running,
   completed, failed, blocked, unknown and canceled. A partial run is readable
   without opening a terminal and is never silently treated as complete.
6. The evaluated harness must be the production harness or an explicitly
   justified equivalent. A test-only shortcut can validate a pure component but
   cannot establish agent quality.
7. Resource configuration is part of the experimental identity: CPU, memory,
   disk, process count, timeout, model parameters, network policy and cache
   policy are pinned and reported. If a shared resource can affect multiple
   trials, isolate it or mark the observations non-independent.
8. Clean state is mandatory. Each trial gets a fresh workspace, exact source
   commit, fresh fixture state and bounded cleanup. No trial may inspect another
   trial's git history, files, caches or processes.
9. CI runs the smallest deterministic regression set on every code or model
   change. Targeted integration runs only when its boundary changes. The full
   campaign is a deliberate measurement, not a default development loop.
10. Infrastructure failures are diagnosed separately from agent failures. A
    socket refusal, dependency/bootstrap failure, resource exhaustion or
    harness exception produces `unknown`/`unproducible`; it never lowers the
    agent score and never gets fixed with a retry.

This gives the project a three-speed operating rhythm:

```text
edit -> fast deterministic contracts -> targeted boundary lane
                                      |
                                      v
                             local fake end-to-end
                                      |
                                      v
                         one real canary -> bounded campaign
                                      |
                                      v
                         final release verification once
```

The expensive path is therefore gated by cheap evidence. It is not removed; it
is prevented from consuming hours when the environment or contract is already
known to be broken.

## Proportionality audit

Audit date: 2026-09-07. Decision: **freeze the current core; do not add another
framework layer**.

The current seams are proportionate to the risks they control:

| Seam | Responsibility | Decision |
| --- | --- | --- |
| `pilot.ts` | deterministic schedule and pure report | keep |
| `consumer.ts` | bounded admission and runtime prompt/adapter contract | keep |
| `runner.ts` | one isolated cell and its process boundary | keep |
| `evidence.ts` | validate and seal untrusted execution facts | keep |
| `campaign.ts` | one end-to-end composition from schedule to report | keep |

The graph audit found 138 nodes, 196 edges and zero broken routes. Its cost
report does flag many unused skills and specialists, but that is a context-
specific observation window, not evidence that they belong in this evaluation
path. They should not be loaded or invoked per cell. The evaluation code itself
has no case for a second scheduler, queue, agent team, persistence service,
retry layer or multi-agent coordinator.

The two genuine complexity problems are operational, not conceptual:

- The global verification command includes a network/browser lane that cannot
  bind in a restricted environment. The separately runnable integration gate
  now checks this capability before testing and fails promptly when absent.
- Durable persistence is now owned by the small launcher above. Real campaign
  wiring and new spending authorization still belong to the caller; the
  historical launcher and archives must not be reused as evidence.

The simplicity rule from this audit is therefore strict: keep the five seams,
finish those two boundaries, and stop. Do not introduce a queue, database,
workflow engine, automatic retry, extra judge layer or another abstraction
unless a measured failure proves one of them necessary.

## Failure and recovery policy

- `unproducible`: the cell could not produce trustworthy evidence (wrong base,
  fixture mismatch, process failure, cleanup failure or contradictory proof).
- `unknown`: the result exists in the schedule but cannot be scored. It is
  always rendered in the report with its redacted reason.
- `blocked`: an explicit policy or authorization prevented execution. It is not
  converted into success.
- `completed`: only after evidence, identity, cleanup and metrics pass their
  validators.

On the first infrastructure unknown, stop admitting new cells for a fail-closed
campaign, materialize the remaining schedule entries as unknown, persist the
partial report, and fix the cause in a new code change. Do not rerun the same
campaign archive and do not infer a score from partial data.

## Operating procedure

1. Change code with a failing contract test first.
2. Run the fast lane, then the lane matching the changed boundary.
3. Run one local fake end-to-end campaign and inspect its report for all 27
   identities, ordering, persistence callbacks and explicit unknowns.
4. For a real canary, verify the manifest and approval digest, use a fresh run
   identifier, cap concurrency at three, stop on infrastructure unknown and
   persist per-cell results before continuing.
5. If the canary is not fully reproducible, stop. Do not spend the remaining
   budget.
6. Only after all observations are sealed, score and review the report.
7. Run the full release gate once on the integrated tree. Promotion remains a
   human decision.

## Current implementation status

Historical baseline at `6e02103f`, locally proven on 2026-09-07:

- deterministic 27-entry schedule and explicit unknown materialization;
- bounded scheduler with ordered observations, progress callbacks and
  fail-closed admission;
- stderr separation, bounded process output and targeted-check prompt guard;
- exact fixture and workspace-base identity enforcement;
- versioned end-to-end campaign composition;
- eval-harness: 163 tests passed; fast: 2,242 passed; filesystem: 1,544
  passed; subprocess: 955 passed and 2 skipped.

Operational hardening on the same date:

- `ccf2c1b2` records the failing network-admission contracts; `5b0bf6fe`
  implements the bounded lane, direct Node builders and context handoff policy.
- The real network lane passes 25/25; the restricted probe refuses immediately
  with `unknown`/`EPERM`. A separate bounded Node diagnostic confirms that
  killing the parent terminates its worker-thread loopback listener. This is
  evidence for the cleanup mechanism, not a full Vitest timeout experiment.
- The durable launcher has 11 focused regressions covering completed-result
  reuse, identity drift, overlapping claims, pre-effect admission, interrupted
  admission, failed persistence, malformed/oversized/symlinked/FIFO records and
  omission of private adapter diagnostics. Two independent-review blockers
  (quoted credentials and blocking FIFO reads) were reproduced and corrected;
  the correction review reports no remaining blocker.

Full verification on `c681086bf337833cb40425e8cf7b5edb08ca8236` passed all
23 required gates on 2026-09-07 in the local environment permitting loopback:
CPU 2,273; filesystem 1,544; subprocess 968; network 25. All 4,810 tests passed,
with no skipped tests. The first integrated run caught a package-relative cwd
in the FIFO regression; `c681086b` corrected that cause before this green run.
There was no retry of unchanged failing code. Builds, typechecks, generated
artifact checks and commit hooks passed. Lint passed with 34 warnings and 884
informational notices; a zero-warning or measured coverage claim is not made.
There is no UI change requiring viewport QA. The scoped independent reviews
covered the network boundary and durable archive; they do not certify paid
runtime behavior or external promotion. Later documentation-only changes use
the affected documentation gates, not a relabelled full-suite proof.

The runtime composition is committed in `6d73a4e5`; `9292bcb3` adds the
regression and refusal for oversized assembled prompts. Fresh full verification
on `9292bcb3a7189523221c51fe86f12f859149e090` passed all 23 gates:
CPU 2,294; filesystem 1,549; subprocess 968; network 25. All 4,836 tests passed,
with no skips. Lint retains 34 warnings and 884 informational notices.
The independent review found the task-content replay gap; its RED regression
preceded the content-binding fix, and the final review found no blocker.
The five runtime-composition tests use real workspace/cleanup/sealing code with
a substituted process transport. They prove local composition, fail-closed
admission and review, and no replay, not paid-runtime or grading quality.

Budget implementation evidence on 2026-09-08 (local, not a runtime certificate):

- monetary and journal RED commits `d5cbe134` and `5977d5d8`, GREEN `fb8994fd`;
- runtime RED `4e285ce8`, GREEN `008c96e3`: seven runtime tests pass using the
  real workspace and seal path, with no provider transport;
- corruption regression `c13e1fae` exposed acceptance of a zero reservation for
  an unknown observation; the correction requires an observed blocked result;
- the targeted autonomous-value suite passes 132 tests after review corrections;
  file and directory admission-sync failures prove zero new effects;
- instrumented coverage is not measured: `@vitest/coverage-v8` is unavailable.
  No mutation command is declared. No coverage percentage or mutation score is
  inferred from passing tests. The strict 100% coverage target remains unverified.

Final integrated verification on `d6aeef4705fed628c77117a061aceb2b1870401a`
passes all 23 gates: CPU 2,311; filesystem 1,553; subprocess 978; network 25.
All 4,867 tests pass, with no skips. Typechecks, builds and commit hooks pass.
Lint passes with 34 warnings and 903 informational notices, not zero warnings.
Local evidence is `evd_b396f07c-1a4f-4350-bd10-09967a7143de`, with diagnostic
log `/private/tmp/eval-budget-verify-clean-env.log`.

The first integrated attempt remains a failed evidence record. Its global pnpm
CLI shim injected `NODE_PATH`, causing two TypeScript-absence fixtures to resolve
the CLI's global compiler. A bounded resolution probe reproduced that difference.
Running the same CLI through its direct Node entry restored the repository's
normal environment; no assertion, timeout or source changed between attempts.
For mission-wrapped verification, inspect the executable shim and avoid injected
global module lookup paths. Retain the failing log and diagnosis rather than
relabelling that first attempt green.

Seven fresh-context final reviews report pass with no remaining findings. The
API getter-identity and oversized-reservation findings were reproduced in
`95fe8c25`, then corrected in `d6aeef47`; recovery and compatible-Claude refusal
coverage were strengthened in the same test change. Reviewers inspected the
explicit Git range because clean-tree envelopes supplied an empty diff.

Mission `mis_8356c419-7b79-416a-bda1-f422d8bcb711` closed **degraded**, not
certified: the controller cannot establish specialist sandbox/process allowlists
under Codex parent overrides, nor its conditional PDF/browser runtime probes.
These platform limitations are not fixed or waived by the passing tests and
reviews. No UI was changed, no paid call ran, and no publication or merge occurred.
Later evidence-only documentation edits use the affected documentation gates;
the full-suite proof remains attached to the exact code candidate above.

### Historical coverage measurement and subsequent local proofs

Coverage follow-up: the missing instrument was supplied in an isolated temporary
environment without repository dependency or lockfile changes. The
[coverage and runtime-attestation report](reports/2026-09-08-eval-budget-coverage.md)
records 47 passing tests, 96.65% lines, 90.98% branches and 100% functions for
`budget.ts`, `durable.ts` and `runtime-pilot.ts`. Measurement is now available;
the installed strict skill's 100% default remains unmet. It is not a configured
Vitest release gate and cannot establish runtime safety. No exclusion or
doctrine waiver was added.
The report also confirms the Codex parent-permission limitation against official
documentation; this session cannot attest a per-agent enforced read-only surface.

Behavioral follow-up on 2026-09-09 adds 17 refusal/recovery cases without changing
production code or doctrine. The existing suites now prove malformed recovered
metrics retain their reservation without scoring or replay, invalid identities
refuse before effects, and missing condition skills stop execution while keeping
the report's unexecuted slots explicit. 210 targeted tests pass (149 evaluation,
61 runtime/compiler/controller), with typecheck and targeted lint green. See the
same report for commands, failed-test diagnoses and remaining gaps. These tests
also verify the existing restricted Claude invocation contract, not live tool
enforcement. The earlier coverage percentages are not a fresh measurement of
these tests, and 100% alone would not establish the separate runtime guarantees.

The subsequent authority-path increment closes six further cases in the same
journal suite: missing/noncanonical roots, occupied or symlinked authority
archives, and invalid manifest identity. All refuse before effects and preserve
existing files. The autonomous-value suite passes 155 tests in 14 files, with
typecheck and targeted lint green; the report above records the exact command
and log. These are characterization proofs with no production or runtime change.

### Paid campaign activation gates

These gates authorize a real evaluation campaign, not installation of the
published harness. The evaluation app is private maintainer tooling and is not
the npm CLI. Shipping the CLI must not enable a paid adapter or claim that an
unmeasured capability is effective. The closed mission's degraded verdict stays
part of the evidence; it is not converted into verified by packaging or CI.

- supply verified provider cap enforcement and a validated assessor to the
  runtime composition, attest the installed artifact/runtime, and validate the
  canary's actual environment and cleanup; local fake runs do not prove this;
- run a fresh canary only after the corrected lane is green and a new approval is
  obtained;
- preserve verification freshness for the actual promotion candidate and obtain
  the human promotion decision; the recorded local proof grants no promotion.

No historical `rerun-*` archive is admissible evidence, and no paid campaign is
authorized by this document.

### Consumer release gates

Follow [RELEASING.md](RELEASING.md) for the protected publication chain. A
consumer-ready candidate must include the current integration base and carry
fresh full verification, generated-artifact checks and packed consumer
conformance. The same source-identified tarball is exercised on Ubuntu, macOS
and Windows for installation, hooks and Autopilot contracts. Local macOS success
alone is not three-platform evidence or a live-agent attestation.

Keep the distinction visible to consumers: installed and wired is not effective;
degraded runtime restrictions stay reported as degraded; no tested local budget
journal substitutes for provider cap enforcement. The existing skill coverage
policy is a separate doctrine matter, not a reason to fake unreachable branches
or to claim campaign readiness from a percentage.

Promotion and the release-please merge remain human decisions. Validate the
exact release tarball and its public signatures/provenance before calling the
publication complete. A historical PR's green checks do not certify later
commits that reused its branch name.
