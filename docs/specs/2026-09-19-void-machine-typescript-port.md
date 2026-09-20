# Void Machine: bounded port to strict TypeScript

Decision owner: Folpe, 2026-09-19. Implementation and isolated verification authorized
**after WORK-1/2/3 closure**. No release or active-install replacement authorized.

Proposed execution sequence: [TypeScript foundation plan](../plans/2026-09-20-void-machine-typescript-foundation-plan.md).
Its milestone A implements this bounded contract; general mission proofs and core
stabilization remain separate later milestones, not additions to the port scope.

## Scope and baseline

Port only implemented Rust capabilities idiomatically to strict TypeScript on Node.js.
Reported inventory at `1efeedf1`: eight Rust files, approximately 1,542 non-test lines,
451 test lines and 28 declared tests. Inventory is not functional certification.
Check intervening source/consumer changes before implementation; no general re-audit.

Retained capabilities: doctor and skill check commands; reports and schemas; skill
package identity and validation; Git effect states and evidence; commit/shared-repository
mutation observation; ticket/agent-result reconciliation; merge authorization/refusal.
Inspect actual binary, npm launcher, schema and CI consumers. Produce a short mapping
of existing behavior, authoritative owner, destination and preservation evidence.

## Ownership

| Layer | Responsibility |
| --- | --- |
| Core | Generic identities, states, transitions and decisions for missions, work units, authorizations, waits, results and effects to reconcile |
| Runtime | Execution, persistence, interruption, resume, cancellation, resource management, agent tracking and result collection; applies core decisions |
| Development vertical | Software brainstorm/spec/implementation, review requirements, Git/worktree policies and delivery/merge conditions |
| Adapters | Concrete Git/GitHub, agent runtime/model, storage, terminal and presentation operations |

Core knows no PR, Git commit, SKILL.md, code-review rule or Herdr panel. The vertical
owns merge policy; the GitHub adapter executes it; core handles an authorized operation
and result. Presentation closes owned panels independently of worktree/branch/proof
lifecycle. Dependencies point from specialized layers to generic contracts. A new
vertical imports no development policy. Use coherent modules and explicit dependencies,
not multiple services, package proliferation or an internal framework. Do not invent
one generic abstraction per Rust function; extract only mechanisms actually needed.

## Compatibility and implementation

Preserve useful commands, reports, exit codes, UTF-8 byte identities/canonical formats,
security refusals and effect semantics. Explicitly handle Rust numeric limits in
TypeScript. Use standard crypto/JSON and maintained parsers; do not port handcrafted
SHA-256, JSON serialization or approximate parsers. Validate boundary data, model states
explicitly and separate pure decisions from external effects. An existing approximation
or defect is not required compatibility: document and test necessary corrections.

Inspect existing TypeScript capabilities, including durable-run.ts, for targeted reuse.
No automatic import of the harness mission controller. Reuse requires need and correct
ownership; every responsibility has one authoritative owner.

## Closed scope and later engine

Do not build the future full engine, a plugin platform, general scheduler, additional
control system, Docker deployment or new connectors in this port absent a demonstrated
concrete dependency. Product capability parity is not proof of the future journey.

Subsequent engine design retains: coordinator dispatch/relay/collection; deterministic
runtime transitions/waits/recovery/closure; waits with cause/owner/remedy; same mission,
history, valid results and round for context completion; evidence due at its actual
stage; durable useful state; reconciliation of ambiguous external outcomes before retry;
finished-agent result collection before owned-panel closure. These guide boundaries,
not immediate additions beyond existing capabilities. Every inherited harness control
must justify its need and execution, maintenance and verification cost.

The later acceptance journey remains intention -> clarification -> interruption ->
resume -> correction -> delivery, with no lost work, replayed effect, redundant human
approval or endless review. Measure time, cost, local resources and human interventions.

## Verification and review

One heavy local task at a time across all agents; one test worker by default. Parallel
reading/editing is allowed. No watch or unchanged-suite reruns. Group checks; use CI
for necessary multiplatform coverage. Prefer shared contract tests and a few real
file/process/Git integrations. Each test protects distinct useful behavior; do not
copy weak tests for count parity or freeze internals. Check dependency direction with
a simple existing mechanism, not a new disproportionate control framework.

Measure representative duration, peak memory and launched processes; state measurement
limits. No unproven speed claim. Clean only owned obsolete artifacts, preserving user
work, uncommitted changes and resume evidence.

One consolidated independent review. Findings block only on demonstrated security,
permission, data-integrity, required-compatibility or acceptance consequences. Defer
other improvements. After correction check affected points/dependencies, not a new
general audit. Persistent blockage gets an explicit explanation/decision, not automatic
review/retry loops or a bypass of real refusals.

## Completion and rollback

Complete only when retained behaviors, correct ownership, targeted proofs, CLI/package,
required multiplatform checks, blocking-review resolution, documentation consistency
and measured verification cost with limits are demonstrated. Then remove replaced Rust
and unused build paths from the candidate after checking consumers; do not keep two
engines permanently. Preserve Git history and document explicit rollback. Collect agent
results, close finished owned panels and update checkpoint. Publication/installation
changes remain a separate authorization. Finish this bounded port before building the
future TypeScript mission engine; operating complexity and Mac saturation are acceptance
concerns, not acceptable consequences of individually well-designed components.
