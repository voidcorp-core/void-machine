---
title: Supervised general missions, local first
date: 2026-09-19
status: in-progress
review_status: prior-revision-reviewed-human-direction-amended
design_revision: amended-2026-09-19-new-core
spec: docs/specs/2026-09-19-supervised-design-orchestration.md
ticket: ''
author: Folpe + Codex
high_risk: true
---

# Supervised general missions, local first

The proposed [TypeScript foundation plan](2026-09-20-void-machine-typescript-foundation-plan.md)
consolidates the port, the S0-S4 journey below and explicit core-stability evidence.
Its source-precedence table identifies historical Rust footprints; use actual
ported TypeScript successors after parity, without reopening the port scope.

## Binding TypeScript port decision

The later explicit Folpe decision replaces Rust continuation with a bounded port
of existing capabilities to strict TypeScript on Node.js. See the
[port contract](../specs/2026-09-19-void-machine-typescript-port.md) and
[superseding ADR](../decisions-log/2026-09-19-void-machine-typescript-layer-ownership--e492e50e-86b0-4427-9fdf-2435750ce60d.md).
Order: close WORK-1/2/3; complete the isolated parity port; then execute the future
engine journey described below. Port parity does not certify that journey.
Historical inventory below is not functional certification. No release or active
installation change is authorized. The port contract owns its closed scope,
layer boundaries, compatibility, resource limits, review and completion criteria.

## Bounded port sequence before S0

1. Close WORK-1/2/3 and preserve their independent integration evidence.
2. Recheck changes since 1efeedf1 and actual binary/npm/schema/CI consumers. Write
   the short behavior -> owner -> destination -> preservation-proof mapping before
   implementation; assign specialized policy to the development vertical.
3. Port retained capabilities with shared contract tests, standard primitives and
   explicit byte/numeric semantics. Evaluate durable-run.ts only for targeted reuse.
4. Verify CLI/package and representative real file/process/Git integrations with
   one heavy task and one test worker; retain necessary multiplatform CI checks.
   Record duration, peak memory and launched processes with limits.
5. Obtain one consolidated independent review, resolve demonstrated blocking
   consequences and verify affected points only. Once parity/consumers are proven,
   remove replaced Rust and unused build paths from the candidate, document rollback,
   collect results, close finished owned panels and update checkpoint.
6. Start S0 and the full engine journey only after this parity milestone. Release
   or active-install replacement still requires separate authorization.

## Goal and execution boundary

Deliver one supervised design mission outside Git through the existing npm/native
boundary, with exact-revision independent review, durable acceptance and recovery;
then add the coding specialty without weakening existing effects or delivery gates.
The Void Machine runtime authorizes deterministic transitions; native runtimes
perform agent work. Build on the TypeScript candidate after the bounded parity port.
No harness control or language bridge is inherited merely because it exists.

The prior plan integrated the three corrections from the independent review
relayed in the follow-up instruction. The explicit mandate replaces systematic human
spec/plan approval in this mission; only decisions outside that mandate return to
the human. ORCH coordinates execution; this author remains restricted to documents. This pass executes nothing, creates no tickets, changes no programme,
and makes no production, installation or publication claim.

The spec contains the acceptance cases and default finite limits. New filenames below
are proposed implementation targets, not claims that modules already exist. Preserve
unrelated work. Future coding units use their own persistent worktrees, not ORCH's.

## Binding new-core direction

Apply the [19 September decision](../decisions-log/2026-09-19-void-machine-new-core-demonstrated-needs--873d1c5a-ef12-44c7-84dd-2fcd853b7ab8.md),
the [vision](../VOID-MACHINE-VISION.md#décision-du-19-septembre--un-noyau-neuf) and
[amended spec](../specs/2026-09-19-supervised-design-orchestration.md#new-core-decision-2026-09-19).
Finish WORK-1/2/3 first; no additional current-harness mechanism is authorized here.

After the bounded port, S0 starts with the first acceptance journey and the
TypeScript candidate. Do not import the harness controller by default.
For each proposed reused control, record the concrete need, expected benefit,
operating/maintenance/verification cost and simpler alternative in this plan or its
implementation decision. Omit or defer unjustified mechanisms. This is ordinary
design reasoning, not a new approval workflow or runtime gate.

S1/S2 must jointly deliver intention -> clarification -> durable progress ->
interruption/resume -> focused correction -> delivered result, under one mission.
Retain valid results and the same round for context completion. Demonstrate no lost
work, replayed effect, redundant approval or endless review. Every wait carries its
cause, owner and resolution action; persist decisions/state independently of ORCH
memory. Collect results and close owned finished-agent panels independently of proof
and worktree retirement. Measure time, cost coverage and human interventions.
The new core contract stays language/framework/model/editor/display agnostic;
coding requirements remain in S3's vertical.

The ported TypeScript modules are the starting point. Node bridges, control
mechanisms, timers and earlier estimates below are provisional options,
not an execution mandate. Reassess them against this decision before choosing the
smallest implementation; do not rerun a general audit to justify a corrected point.
The previous independent review covers its prior revision, not this amendment.

## Entry evidence and delivery order

The native CLI currently handles doctor/skill-check only. `packages/cli/bin/void-machine.mjs`
is the existing native launcher; `packages/cli/src/lib/native-doctor-contract.test.ts`
protects its missing-binary behavior. `packages/cli/src/lib/runtime-adapters.ts` wires
and inspects installations; it is not an execution/session adapter. Runtime process
examples under `apps/eval-harness` are private evaluation code, not production APIs.
The SQLite durable run under `packages/cli/src/lib/autopilot/durable-run.ts` is v1
no-effect execution, not a general design supervisor. These distinctions are the
main effort drivers; another general scheduler would not remove them.

Order: S0 evidence and decisions -> S1 non-Git completed mission -> S2 recover the same
mission -> S3 coding vertical -> S4 consumer readiness. S1 includes a real native
adapter and a minimal driver; it is not a collection of disconnected interfaces.
S2 hardens crash and ambiguity behavior before any claim of reliable recovery.
Docker is a later design/implementation boundary, not part of this cut's critical path.

### S0 — Establish an admissible native route and reconcile ownership

- **Goal:** choose the smallest new-core design and one real route supporting the
  first delivered journey; justify every proposed inherited mechanism and its cost.
- **Depends on:** independent spec/plan review with no unresolved blocking findings.
- **TDD mode:** exploratory for the bounded capability experiment; no production scaffold.
- **Footprint:** eventual evidence under `docs/plans/skill-audits/` and collision-free
  `docs/decisions-log/` records; this design pass does not create them.
- **Actions:** inspect installed runtime/version and official documentation; read the
  actual native process implementations under `apps/eval-harness/src/runtime/` and
  existing admission/controller contracts. Exercise a read-only native request in an
  isolated non-Git directory. Observe launch ID, structured output, context identity,
  wait/observation, cancellation, model selection and session resume separately.
- **Decision rule:** use the operator's available authorized runtime when all S1
  required capabilities are proven. A different model is preferred for review but
  not required; fresh context is required. Do not invent a subscription interface,
  silently use an API or treat installation inspection as execution conformance.
- **Verification gate:** evidence table has observed/documented/unknown and source
  per capability, separately from observed effective-permission evidence bound to
  runtime/version/configuration. A capability being available proves no confinement.
  Before any context reaches coordinator, ranker or worker, unknown mandatory
  read/write/network/descendant scope enforcement, independent context,
  result observation or termination blocks live S1. Missing resume can permit S1,
  but cannot satisfy S2's native-resume case. Missing reliable launch reconciliation
  requires an explicit ambiguous stop, never duplicate work. Identify the observed
  native mechanism enforcing deadlines after host loss, or declare that limit
  unguaranteed and exclude routes whose mandate requires a crash-surviving hard bound.
- **Expected commit:** `docs(machine): record route capability and ownership evidence`.
  Body explains why the selected route can support this limited mission.
- **Notes:** reconcile missing DEV-807 foundation provenance and conflicting ADRs before
  changing their authority. Record only actual ownership choices (transition/storage
  owner and durable-state retention) through `void-harness decisions new` when their
  implementation commits the choice, reusing applicable accepted ADRs. No ADR per
  gate, repeated delegation consent or speculative Docker decision is required. This step assesses and extends the ported TypeScript core; it does not rewrite the harness or add
  a human consent gate. If a required route is unavailable, deliver
  the precise capability blocker and stop dependent work, not a mock-only product.

### S1 — Complete one non-Git design mission locally

- **Goal:** input two authorized text files and an objective; receive independently
  reviewed spec plus plan, with one durable accepted revision and source references.
  A separate collection invocation on those texts returns references/digests without
  spec, plan or reviewer, proving design is a specialty workflow.
- **Depends on:** S0.
- **TDD mode:** strict for transitions, contract validation, budgets and acceptance;
  souple for command wiring covered by end-to-end conformance.
- **Footprint:** ported Void Machine TypeScript core and its focused extensions, execution and persistence adapters,
  distribution entrypoint and focused contract tests, selected in S0. Node store/routing and npm launcher are candidate assets only. No package
  path or cross-language bridge is required merely because it already exists.
- **Behavior contract:** npm launcher adds `mission start <request.json> --json` and
  `mission inspect <mission-id> --state-dir <path> --json`. Request includes explicit
  workspace/state roots and mandate. Start runs in foreground and returns artifact
  references plus observed status. Exit 0 means delivered, 1 means failed/refused,
  2 means invalid invocation, 3 means resumable wait/pause. Existing doctor and skill
  output/exit behavior remains unchanged. Structured responses include schema version,
  mission ID, revision, status, reason and artifact/provenance references.
- **Implementation:** a new deterministic core owns mission transitions; adapters
  own execution and persistence effects. Commit the state and pending action before
  dispatch where the chosen transport requires it; reconcile ambiguous results
  without replay. Build on the ported TypeScript implementation; choose storage and any bridge based on
  the delivered journey and operating cost. General states and waits are separate from design or
  coding substates. Reuse legacy mechanics only with the S0 justification and one
  authoritative owner. Preserve applicable permission/data constraints.
  Implement runtime supervision from events with bounded periodic reconciliation,
  without a permanent LLM monitor. Exercise idle-with-question, final-result
  collection/owned-panel closure and interrupted-agent continuity in the existing
  journey checks. Verify that an unhandled coordinator wait becomes visible and
  that repeated observations neither replay effects nor duplicate notifications.
  Keep specialist reasoning instructions in versioned Markdown; procedural state
  handling has one code owner. This belongs after parity, not to the bounded port.
- **Protocol bounds:** one request/response per process invocation; 1 MiB maximum,
  explicit 5-second local transition timeout, no shell interpolation. Protocol
  mismatch, absent binary and invalid response stop admission. No build/download
  fallback. The actual agent dispatch uses the spec's separate 15-minute limit.
- **Tests first:** no Git executable on fixture PATH; accepted exact revision;
  reviewer same author context refused; stale evidence refused; one correction;
  dispute invokes one adjudicator; no disagreement invokes none; malformed and
  oversized output; available capability with unknown effective permission refuses
  before any coordinator/ranker/worker input; simple collection creates no spec or
  review dispatch; destination denied before any runtime input; unknown telemetry
  preserved; API ceiling zero; repeated result deduplicated; ninth-dispatch ceiling.
- **Verification gate:** targeted suites for the chosen implementation pass, then one authorized live
  native subscription mission with observed fresh reviewer context completes. Report
  model diversity honestly. Demonstrate a useful refusal when no route is admissible.
  A fake adapter is acceptable for negative tests, never for the live delivery claim.
- **Expected commits:** `test(machine): specify a reviewed non-Git mission` then
  `feat(machine): deliver bounded native design missions`; bodies explain independence
  and why general missions do not require Git.
- **Notes:** do not make install/wiring adapters run missions; do not import private
  eval code into published packages. Read official dependency docs before new parser
  configuration; use maintained serialization rather than inventing a JSON parser.
  Any dependencies/lockfiles are changed by the package manager during implementation.

### S2 — Resume interrupted work without repeating ambiguous actions

- **Goal:** restart the foreground driver and reach the same accepted decision and
  pending action, including an explicit stop when an external launch is unobservable.
- **Depends on:** S1.
- **TDD mode:** strict.
- **Footprint:** S1 mission reducer/store/driver tests and modules;
  proposed `packages/cli/src/lib/machine/recovery.ts` with colocated tests;
  launcher adds `mission resume <mission-id> --state-dir <path> --json` and
  `mission cancel <mission-id> --state-dir <path> --json`.
- **Implementation:** persist action ID and fence before launch; handle native event
  delivery and bounded polling; enforce 30-second lease/10-second heartbeat policy;
  cap waits by mission deadline; transact received decision before any following
  action. Preserve acceptance after author session loss. Resume references remain
  native; handoff declares loss when a new native context is necessary. Host deadline
  and lease timers do not stop native work after host crash. Record observed native
  deadline enforcement or the explicit unguaranteed limit; retain reservations and
  refuse all new delegation for that mission until termination/usage reconciliation
  permits release; other missions cannot consume the reserved capacity.
  Unknown monetary usage remains reserved even when termination releases concurrency.
- **Tests first:** crash before/after transaction and after launch-before-ack; two
  supervisors race; stale fence, repeated event, missing artifact, changed digest,
  unsupported schema, corrupt record, expired lease, timeout and failed cancellation.
  Unknown launch stays reconciling after restart and sends no second dispatch.
  Persisted adjudication is reused without another model call. Kill the host after
  durable spec acceptance but before planning: resume the same digest and acceptance,
  with zero new reviewer/adjudicator calls. Kill it during native work separately:
  demonstrate native deadline enforcement or retained reservation/refused delegation;
  elapsed time and lease expiry alone must not release either.
- **Display case:** use the existing presentation boundary for optional observation;
  test no-display parity, collected-result-before-retirement, owned completed display
  close only after native termination, permanent pane preserved, zero worktree removal.
  Runtime cancellation belongs to execution, not presentation. Do not require Herdr/cmux.
- **Verification gate:** deterministic fault-injection suite; one observed native
  two-text journey interrupted after acceptance, then planning without new judgment;
  an in-flight crash proves native deadline enforcement or the declared limitation
  and retained reservation. Cancellation has confirmed termination or explicit
  reconciling state. Driver restart reads no conversation checkpoint to decide state.
- **Expected commits:** `test(machine): specify crash and ambiguous launch recovery`,
  `feat(machine): reconcile interrupted native design missions`.
- **Notes:** a live resume unsupported by the chosen route remains a named capability
  limitation. Preserve artifacts and use the minimal handoff only where repetition is
  safe; do not call that native resume. Leases coordinate ownership, not runtime safety.

### S3 — Run the first coding specialty without weakening Git guarantees

- **Goal:** the same general mission completes one bounded coding unit with verified
  local artifact/effect proof in a ticket-owned worktree.
- **Depends on:** S2.
- **TDD mode:** strict for effects, evidence and lifecycle; souple for existing wiring.
- **Footprint:** proposed `packages/cli/src/lib/machine/coding.ts` and colocated tests;
  existing `native/void-machine/crates/core/tests/effects.rs`, core cluster/merge tests
  and `crates/host/src/git_effect.rs` only where a demonstrated contract gap requires it;
  existing mission-engine/controller adapters retain ownership of their current
  runs. Their reuse for new Machine missions requires the concrete S0 justification.
- **Implementation:** attach specialty fields without adding Git to general required
  input. Keep coding methodology in its vertical, using existing implement/runtime
  paths where they meet the accepted journey. Use
  Git worktree inventory and persistent configured root; no temporary/nested checkout.
  Bind source SHA/tree and observed files to proof. Preserve commit-range, shared
  mutation and merge safety; reuse the existing guards where justified without
  inheriting every controller mechanism or creating competing merge policies.
- **Tests first:** changed source invalidates proof; missing reviewer refuses; shared
  mutation refuses; interrupted worktree is retained/reused; display closure cannot
  delete it; dirty user files survive; merge grant remains separate from design acceptance.
- **Verification gate:** controlled repository fixture completes a local coding result;
  all existing Git effect/cluster/merge conformance cases remain green; no publication,
  production merge or worktree deletion occurs in the demonstration.
- **Expected commits:** `test(machine): preserve coding evidence and worktree lifecycle`,
  `feat(machine): adapt coding units to general missions`.
- **Notes:** do not redirect the active seven-ticket programme or infer Linear state
  from these documents. Local verified result is the deliverable; shipping authority
  remains governed by its existing separate policy.

### S4 — Prove the consumer boundary and document operational limits

- **Goal:** a consumer can use the new path with a compatible native binary, diagnose
  unavailable capabilities and preserve existing npm behavior through update/rollback.
- **Depends on:** S3 (S1 protocol packaging checks may run earlier).
- **TDD mode:** strict for compatibility/refusals, souple for packaging documentation.
- **Footprint:** existing native launcher and `native-doctor-contract.test.ts`,
  `test/cli/` and relevant existing install/update conformance tests;
  `docs/ARCHITECTURE.md`, `docs/NATIVE-SUPERVISION.md`, `README.md`.
- **Tests first:** native missing/version mismatch; install/update preserves user-edited
  doctrine and configuration; no home/project write on inspection; unsupported new
  mission schema preserved/refused on rollback; no v1 migration by reinterpretation.
- **Verification gate:** packed consumer fixture and repository-required checks on
  exact candidate revision; isolated inputs only. Compare direct native versus Machine
  on the same task and report observations/unknowns. No repeated red run to obtain green.
- **Expected commits:** `test(machine): protect native consumer compatibility`,
  `docs(machine): state verified supervision and deployment limits`.
- **Notes:** publication and consumer installation require their own task authority;
  this plan does not itself deploy. Update convention docs and source skill prose
  only if a real shipped-policy change is in scope and its decision/migration reviewed; generated
  installed assets are not edited directly.

## Review checkpoints and verification protocol

Checkpoint A: independent review received through the follow-up instruction; the
three bounded corrections are integrated in the spec and this plan. ORCH retains
reviewer provenance and the frozen artifact digests. No reviewer identity/model or
second pass over the corrected bytes is invented. There is no unresolved disagreement
requiring an adjudicator and no new systematic human approval gate.

Checkpoint B follows S2: a bounded independent review of the completed journey,
recovery, authority and data boundaries. Corrections receive focused rechecks, not
a renewed general audit. The first acceptance fails if it reproduces the observed
WORK-1/2/3 operational blockage, even with individually well-designed components.
No unresolved blocker proceeds to the coding slice. An advisory is recorded; a
missing required capability is a stop, not an advisory. Neither checkpoint requires
systematic human confirmation inside the approved mandate. Human decisions concern
objective/permission/budget widening and production promotion only.

Commands below are future verification, NOT run by this design task. In the cockpit,
route checks through `cockpit task lint|typecheck|test|check|verify`; when RUN is occupied,
queue the check without duplicate execution. ORCH must target the candidate worktree.
The completed port uses the repository
`pnpm test` catalogue with focused suites during red/green. Full checks run once after
integration, then only after relevant changes/failures. Evidence records checkout SHA,
command, exit, fixture, runtime/version and coverage limits. No build or test was run
in preparing this plan.

## Earlier estimates, subject to the new-core decision

ORCH's provisional **2–5 days for a first integrated verified journey** and
**1–3 weeks for a fuller engine/Docker** are hypotheses, not commitments or acceptance
criteria; these figures were not supplied by the user. The local inventory supports reusing useful pieces, but it does not prove a
production execution adapter or a general native driver exists.

Effort below means focused engineering/agent-assisted work in eight-hour equivalents,
including author correction and review. It is not unattended agent uptime, elapsed
runtime inference or a prediction of how many agents make it faster.

| Slice | Provisional effort | Main uncertainty |
| --- | --- | --- |
| S0 | 0.5–1.5 focused days | Actual native capabilities, missing foundation decisions |
| S1 | 2–4 focused days | Production bridge/adapter, independent context and permission evidence |
| S2 | 1.5–3 focused days | Native launch reconciliation and resumption semantics |
| S3 | 1–2.5 focused days | Reuse of coding controller/effect ownership without dual writers |
| S4 | 1–2 focused days | Packaging and compatibility matrix |

Arithmetic envelope: S0+S1 is **2.5–5.5 focused days**, not 2.5–5.5 calendar days.
With robust recovery S0–S2 is **4–8.5 focused days**; full local S0–S4 is **6–13.5**.
These earlier architecture-dependent estimates are not an estimate of the new-core
design and are not measured LLM throughput. Re-estimate from S0 choices and observed
end-to-end delivery, not human-day arithmetic alone. S0 may replace them with a
capability blocker; inability to cancel or scope a runtime is not solved by more time.

Wall-clock verification is separate: S1 budgets a live trial at 120 minutes while
its host is supervising; this is not a post-crash native termination guarantee.
S2 needs an additional interruption/recovery window; CI, build and packaging
wall time must be measured on the actual runner and is currently unknown. RUN queue,
provider quota, independent reviewer availability and fixes add waiting time. There
is no justified calendar promise. Serial gates and shared bridge files limit useful
parallelism. Critical path: route evidence -> general local round trip -> actual
fresh review -> durable recovery -> coding proof -> consumer compatibility.

Docker service plus local executor adds an estimated **5–10 focused days** after
stable local contracts for a single-client controlled pilot, assuming a chosen host
and supported authenticated transport. This makes 1–3 calendar weeks for the fuller
engine an optimistic scenario with substantial scope assumptions, not validated by
the inventory. Multi-tenant isolation, Cortex pairing, billing, backups, operational
SLOs and security hardening are outside that pilot and not estimated here.

“Production-grade” for the local slice would prove bounded admission/resources,
effective data confinement, crash/ambiguity recovery and the exact limits of native
deadline enforcement, compatible updates, fresh evidence, useful failures
and protected user work under observed supported versions. It does not prove a hosted
service: that additionally needs tenant isolation/revocation tests, backup restoration,
upgrade rollback, health monitoring, availability/load evidence and incident ownership.
A Docker image alone proves none of these and provides no subscription entitlement.

## Execution handoff and current status

| Order key | Unit | Dependencies | Effort | Systematic human gate |
| --- | --- | --- | --- | --- |
| SD-00 | Capability evidence and ADR reconciliation | Independent review | 0.5–1.5 days | No |
| SD-01 | Non-Git reviewed design journey | SD-00 | 2–4 days | No |
| SD-02 | Recovery and lifecycle | SD-01 | 1.5–3 days | No |
| SD-03 | Coding specialty | SD-02 and independent recovery review | 1–2.5 days | No |
| SD-04 | Consumer compatibility evidence | SD-03 | 1–2 days | No |

These are stable proposed unit keys, not new tracker issues or progress state.
ORCH may hand this human-amended design to the existing ticket workflow within
the mandate; Linear then owns mutable execution status. The current programme remains untouched.
No implementation step has been executed here. The design author stops at this
handoff; ORCH owns the execution sequence, beginning with S0 evidence. No additional
systematic human consent is requested.

Design verification: source inventory and cross-document constraints inspected;
self-review completed. Tests/builds/lint/typecheck/hook runs/commits omitted by the
explicit docs-only brief. Coverage, UI and runtime observability checks are not
execution evidence for this task. Independent review was received as relayed findings;
all three requested dispositions are accepted and integrated. This is not evidence
of a second independent review over the corrected bytes. That statement described the earlier two-document pass. The human amendment also
updates the vision, the standalone direction ADR and the checkpoint references.
