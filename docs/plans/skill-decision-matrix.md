---
title: Skill Decision Matrix
date: 2026-05-29
status: current
owner: void-harness/core
purpose: For every skill in core, specify when it wins, when it loses, and what it is NOT allowed to decide. Prevents overlap and silent contradictions between skills.
---

# Skill Decision Matrix

This matrix is the precondition to writing per-skill content (Section 11 of the master design spec). Without it, skills like `functional`, `hexagonal-architecture`, `domain-driven-design`, `testing`, `refactor`, and `code-review` will overlap, contradict each other, or silently fight for the same decisions.

**How to read each row**

- **Wins**: this skill is the primary authority when the task matches this trigger
- **Loses to**: when these other skills are in play, defer to them on their domain
- **Cannot decide**: explicit list of decisions the skill must escalate or defer; protects the boundary
- **Composes with**: skills that run together without conflict (sequenced or parallel)

---

## Code-discipline skills (9)

### `tdd`

- **Wins**: any implementation of new behavior, bugfix, refactor that changes observable behavior
- **Loses to**: `refactor` for pure refactor mode (no behavior change). `migrations` for DB migration mechanics.
- **Cannot decide**: what the production code architecture should be (defers to `hexagonal-architecture`, `domain-driven-design`); naming (defers to `typescript-strict`); test ergonomics within a framework (defers to `testing`).
- **Composes with**: `testing` (TDD provides the cycle, testing provides the technique), `refactor` (R of RED-GREEN-REFACTOR delegates here).

### `typescript-strict`

- **Wins**: every TypeScript file. Types, signatures, exhaustive switches, `unknown` vs `any`, narrowing patterns.
- **Loses to**: `functional` on data-shape choices (immutability, ADTs). `domain-driven-design` on domain modeling.
- **Cannot decide**: business logic, test strategy, architecture boundaries.
- **Composes with**: every other skill (it's the language baseline).

### `functional`

- **Wins**: data flow design, error modeling (`Result<T, E>` over throwing), pure-by-default decisions, ADT design (sum types).
- **Loses to**: `hexagonal-architecture` on whether to use FP at the boundary or the inside. `typescript-strict` on type expression details.
- **Cannot decide**: I/O strategy (defers to hexagonal), persistence shape (defers to DDD), test discipline.
- **Composes with**: `typescript-strict` (provides ADT machinery), `domain-driven-design` (Wlaschin makes them friends).

### `refactor`

- **Wins**: any change that improves structure without changing observable behavior. Tidy-First moves.
- **Loses to**: `tdd` if any behavior changes. Refactoring stops at the boundary of behavior change.
- **Cannot decide**: whether a refactor is worth the cost (escalates to user — taste call). New design (defers to `hexagonal-architecture`, `domain-driven-design`).
- **Composes with**: `tdd` (R step), `code-review` (suggests refactors).

### `testing`

- **Wins**: how to express a test once you know what to test. Mocking strategy, fixture design, test pyramid placement, integration vs unit choice.
- **Loses to**: `tdd` on **when** to write the test (always: before). `migrations` on testing DB changes.
- **Cannot decide**: whether a feature deserves a test (TDD's call: yes, always, in strict mode). Production architecture.
- **Composes with**: `tdd` (provides the cycle); mutation testing validates the suite's quality, and is not a core skill.

### `hexagonal-architecture`

- **Wins**: boundary between domain logic and I/O. Port/adapter design. Where to inject vs hardcode.
- **Loses to**: `domain-driven-design` on what the domain *is*. `functional` on data shapes inside the domain.
- **Cannot decide**: which framework to use (Next, Express, etc. is a `pack-*` concern). DB schema design.
- **Composes with**: `domain-driven-design`, `functional`, `tdd`.

### `domain-driven-design`

- **Wins**: identifying bounded contexts, aggregates, ubiquitous language. Anti-corruption layers between domains.
- **Loses to**: `hexagonal-architecture` on the technical boundary mechanism. `functional` on data shapes within an aggregate.
- **Cannot decide**: tactical patterns (delegated to `functional` + `hexagonal-architecture`). Sub-domain analysis: deferred to `brainstorm` / `plan-review` (CEO lens) upstream.
- **Composes with**: `hexagonal-architecture`, `functional`.

### `code-review`

- **Wins**: pre-commit / pre-PR critical pass over a diff. Defects, missing tests, structure issues, security flags.
- **Loses to**: `doctrine-critic` (agent) for doctrine-conformance review. `security-audit` on security-specific concerns.
- **Cannot decide**: whether to ship (user). Architecture changes outside the diff scope.
- **Composes with**: `tdd` (verifies the cycle was respected), `typescript-strict` (verifies types), all hedges.

### `api-and-interface-design`

- **Wins**: designing the contract of any public interface — package exports, HTTP/REST, RPC/tRPC, SDK, module boundary consumed by others. Surface shape, stability, versioning, error contract.
- **Loses to**: `hexagonal-architecture` on boundary placement and dependency direction. `domain-driven-design` on the vocabulary and aggregate model. `typescript-strict` on type-expression details.
- **Cannot decide**: internal implementation behind the contract; which transport/framework to use (pack concern); whether a breaking change is worth its cost (user / ADR).
- **Composes with**: `hexagonal-architecture` (draws the domain's ports well, seen from outside), `typescript-strict` (boundary types), `functional` (`Result` at the boundary), `security-guidance` (input validation), `async-safety` (idempotency, pagination), `domain-driven-design` (ubiquitous names in the contract).

---

## Process skills (17)

### `brainstorm`

- **Wins**: any creative task before code. Feature scoping, design discussion, "should we build X this way?" — and, via the vendored upstream mode (DEV-386), "should we build X at all?" (demand pressure-test + 10x ambition).
- **Loses to**: `plan-review` (CEO lens) for reviewing a written plan's premise / ambition / trajectory.
- **Cannot decide**: implementation specifics (defers to `plan`).
- **Composes with**: `plan` (downstream).

### `plan`

- **Wins**: turning an approved design into an executable plan. Sequencing, dependencies, verification gates.
- **Loses to**: `brainstorm` on intent and design choices.
- **Cannot decide**: feature scope (it's a planning skill, not a scoping skill). Architecture (defers to architecture skills).
- **Composes with**: `brainstorm` (upstream), `implement` (downstream — one unit taken from ready to shipped).

### `plan-review`

- **Wins**: critiquing a written plan before execution through four lenses (CEO premise/ambition, Eng test-coverage/failure-modes, Design states/slop, DevEx TTHW); the `all` mode orchestrates them with auto-decisions.
- **Loses to**: `plan` on authoring/structuring the plan (plan-review proposes findings, the author disposes); `code-review` once code exists.
- **Cannot decide**: the idea's demand (that is `brainstorm`); it never rewrites the plan or auto-decides taste/user-challenge calls.
- **Composes with**: `plan` (upstream, produces the artifact), `implement` (downstream), `frontend-design`/`impeccable` (Design lens), `security-audit` (Eng lens routes deep security). Vendored from gstack plan-reviews + autoplan (DEV-385).

### `debug`

- **Wins**: any bug, test failure, unexpected behavior. Root-cause investigation before fix.
- **Loses to**: `migrations` on migration-specific failures. `observability` on missing-logs cases (fix the visibility first).
- **Cannot decide**: whether to ship a fix without root cause (Iron Law: no). The fix itself (delegates to `tdd`).
- **Composes with**: `tdd` (write the failing test that reproduces, then fix).

### `verify`

- **Wins**: every "task complete" claim. Pre-flight checklist before reporting done.
- **Loses to**: nothing — it's the final gate.
- **Cannot decide**: what "complete" means functionally (the task itself defines that).
- **Composes with**: all other skills (runs after).

### `security-guidance`

- **Wins**: any trust-boundary code (input validation, auth, secrets, SQL, LLM input/output). Default-secure patterns.
- **Loses to**: `security-audit` for full audit mode. `doctrine-critic` (agent) flags trust-boundary code in a diff.
- **Cannot decide**: full threat model (escalates to `security-audit`).
- **Composes with**: `hexagonal-architecture` (boundary discipline), `typescript-strict` (no untyped trust).

### `commit-discipline`

- **Wins**: every commit. Conventional commit format, "why" in the body, scope, breaking-change marking.
- **Loses to**: nothing — it's a final gate before the commit.
- **Cannot decide**: whether the change itself is correct.
- **Composes with**: `verify`.

### `learn`

The 2026-07-09 fusion of `compounding` + `capture-rule` + `harness-evolution` (issue #75) — one skill, three routed destinations, HITL on every write.

- **Wins**: any moment a lesson appears — a stated durable project rule, a recurring/deja-vu fix, an end-of-cycle pattern, or a perceived harness gap. Names the lesson, decides scope, and runs the matching capture: a project rule into `.void/PROJECT-DOCTRINE.md`, a harness gap as a direct `voidcorp-core/void-harness` issue, or drop. Also interprets the `void-harness audit` obsolescence report.
- **Loses to**: nothing on capture routing — it is the single owner. Defers *which tool to use* to the code skills; a structural decision with a rejected alternative is `decide`, not a doctrine line.
- **Cannot decide**: whether a capture is adopted (HITL only, never auto-writes doctrine); whether a rule is correct (the user owns it); the scope when genuinely ambiguous (it asks, never guesses).
- **Composes with**: `verify` (a cycle is not "closed" until verified), `commit-discipline` (a project rule commits as `docs(doctrine):`), `code-review` (a recurring finding is a deja-vu signal), `claude-md` (governs the doc a rule lands in), `decide`, `retrospective` (feeds it window-scale patterns).

### `retrospective`

- **Wins**: a periodic engineering retro over a window (a week, a cycle) — reads git log / PRs / `.void/`, surfaces signals (commit-type mix, hotspots, recurring-fix files, test-to-prod ratio, PR size, regressions), and turns them into concrete improvement decisions.
- **Loses to**: `learn` on writing a lesson into doctrine (the retro routes patterns to it, never writes doctrine itself); `debug` on fixing one bug (the retro only flags the recurring-file smell at window scale).
- **Cannot decide**: whether a capture is adopted (HITL via learn); it never changes code or writes doctrine.
- **Composes with**: `learn` (durable patterns routed there), `debug` (recurring-fix smell), `plan` (large-PR window = slicing signal). Vendored from gstack `/retro` (DEV-396) with the gamification dropped.

### `source-driven-development`

- **Wins**: before writing any config or usage of a third-party tool, framework, library, or API. Grounds the decision in the official docs for the *installed* version, not training memory; cites the reference.
- **Loses to**: `brainstorm` / `decide` on *which* tool to choose (this skill grounds *how to use* the chosen one).
- **Cannot decide**: tool selection; the design (defers to `plan`); business logic.
- **Composes with**: `plan` (grounds stack decisions), `commit-discipline` (the "why" carries the source citation), `decide` (rejected alternatives cite official docs), `context` (delegate heavy doc-reading to a fresh-context subagent).

### `context`

- **Wins**: managing the context window — `/clear` between unrelated tasks, `/compact <focus>` on long sessions, the two-correction reset, delegating heavy investigation to fresh-context subagents, keeping task state on disk.
- **Loses to**: `debug` on the investigation *method* (this skill owns *where* the investigation runs, not how).
- **Cannot decide**: the task content; the investigation's conclusions.
- **Composes with**: `debug`, `plan` (plan state persisted on disk), `dispatching-parallel-agents` / `subagent-driven-development` (vendored targets).

### `decide`

- **Wins**: documenting a structural decision that changes how future code is written, with a credible rejected alternative. ADR format, numbering, and lifecycle (proposed → accepted → superseded). Promoted from pack-monorepo to core on 2026-06-04.
- **Loses to**: `plan` on the *work* plan (an ADR records the *decision*, not the steps).
- **Cannot decide**: product / org strategy (Notion, Linear); the work sequencing (`plan`).
- **Composes with**: `plan`, `commit-discipline` (a one-paragraph "why" should become an ADR), `source-driven-development` (alternatives cite docs), `learn` (a harness gap becomes an issue on this repo, not a doctrine line).

### `claude-md`

- **Wins**: writing or auditing a project CLAUDE.md / AGENTS.md. Length budget, what belongs vs what goes to hooks/linters, `file:line` over snippets, progressive disclosure, runnable-first-try.
- **Loses to**: `learn` on capturing an individual project rule or a harness gap (this skill governs the *document*, not the single rule).
- **Cannot decide**: the project's actual rules (the user owns content); deterministic enforcement (that belongs in hooks/settings, which is precisely the point).
- **Composes with**: `context` (the doc is part of the context budget), `source-driven-development`, `learn` (where a rule lands, and how a harness gap becomes an issue).

### `autopilot`

The single in-session backlog drainer. Replaced `backlog-autopilot` at the 2026-07-30 cutover, which **deleted** the superseded engine rather than deprecating it: two engines in one release means two answers to "how does a cluster get drained".

- **Wins**: an explicitly launched, attended run draining a pool of **independent** ready tickets — each executed end-to-end by `implement` in its own worktree worker, reconciled into one integration PR. Routing is parallel where footprints are disjoint, sequential where they collide (lockfiles and migrations always sequential); a **review budget** shrinks the cluster from structural doubt, not from ticket estimates. Opt-in, and the fan-out needs human confirmation.
- **Loses to**: any single-ticket interactive session; `implement` on the per-ticket quality cycle (it delegates, it does not redefine); human judgment on the plan and on merge.
- **Cannot decide**: whether two tickets truly overlap (the footprint is *estimated*; the reconciler plus the full suite sealed against the integration SHA are the backstop); whether to merge — **never**, on any path. There is no `--auto-merge`: the CLI refuses it and a source gate enforces the refusal, because merging is where a human reads the diff as a whole.
- **Composes with**: the deterministic CLI `void-harness autopilot` (selection, review budget, lease, reconciliation, publication, recovery, tracker lifecycle — it contacts nothing and spawns no agent), the runtime adapter that fans out workers (Workflow on Claude, native subagents on Codex, same `OrchestrationPlan` and same `WorkerResult`), `implement` inside every worker, `ticket` upstream (which may ingest a `source: forge` spec). Durable boundaries: HITL at backlog curation and PR merge, commit-only workers, server-side branch protection required on the base.

### `implement`

The single canonical definition of "execute one ticket well" — one ticket taken from ready to shipped with a senior team's coverage (architecture, TDD, e2e, UX, security, review, verification), each pass keyed to an observable predicate.

- **Wins**: taking a single ready ticket through to a shipped/green branch. Both interactive single-ticket work and each `autopilot` worker delegate here, so the cycle is defined once.
- **Loses to**: `plan` on sequencing *several* tickets; `ticket` on authoring the ticket; human judgment on merge.
- **Cannot decide**: whether a triggered pass may be skipped (never — the predicate decides, not a vibe); whether to merge (human).
- **Composes with**: every code-discipline and process skill (it is the conductor that invokes them per predicate); `ticket` upstream, `autopilot` as caller.

### `checkpoint`

- **Wins**: closing a session with work still open. Routes each fact to the programme, declared progress provider, diff, doctrine or ADR; writes only the local residue nothing else holds — chiefly what was *ruled out* and why — and ends on one exact physical next action.
- **Loses to**: `learn` on a lesson that outlives this session (that is a doctrine or harness question, not a handoff note); `ticket` on work that deserves its own ticket rather than a paragraph.
- **Cannot decide**: whether the work itself is done (`verify` owns that); what the next priority or unit is (the progress provider and the human own it).
- **Composes with**: `context` and `ResumeBundle` (the checkpoint survives a reset), `verify` (runs first — a checkpoint states what is proven, not what is hoped), `learn` (durable lessons routed out of the note).

### `ticket`

Turns a finished brainstorm, plan, or design decision into a tracker ticket an implementation agent can execute with zero follow-up — every required slot filled, estimated, labelled.

- **Wins**: capturing an already-made decision as a trackable, self-contained work item; declaring which `implement` passes to expect.
- **Loses to**: `brainstorm` / `plan` on producing the thinking (it records, never invents scope); `implement` on execution.
- **Cannot decide**: the scope itself (ingests it from upstream); the estimate's business priority (user).
- **Composes with**: `brainstorm` + `plan` upstream, `implement` downstream (consumes the ticket and its declared passes).

---

## Hedge skills (11)

### `observability`

- **Wins**: any code that runs in production. Logging structure, trace IDs, error boundaries, metrics emission.
- **Loses to**: `security-guidance` on what NOT to log (PII, secrets).
- **Cannot decide**: alerting policy (ops concern).
- **Composes with**: every code-discipline skill.

### `migrations`

- **Wins**: any DB schema change. Backfill strategy, locking analysis, rollback plan, two-phase changes.
- **Loses to**: nothing on its own domain. Stand-alone discipline.
- **Cannot decide**: schema design (defers to `domain-driven-design`).
- **Composes with**: `tdd` (test the migration), `observability` (log the change).

### `async-safety`

- **Wins**: concurrent code, retries, webhooks, jobs, distributed coordination. Idempotency design.
- **Loses to**: `hexagonal-architecture` on where the async boundary sits.
- **Cannot decide**: queue technology (pack concern).
- **Composes with**: `observability` (traces), `security-guidance` (replay attacks).

### `accessibility`

- **Wins**: any interactive UI. Keyboard nav, ARIA via Radix, contrast, semantic HTML, touch targets ≥ 44×44px, focus management.
- **Loses to**: nothing on accessibility. It's the floor, not the ceiling.
- **Cannot decide**: visual design (defers to `frontend-design` / `ui-review` + the `DESIGN.md` contract; recon/variants to `forge`).
- **Composes with**: `frontend-design` (enforces mobile-first dual-quality jointly).
- **Mobile-first dual-quality invariant**: every UI ships with verified keyboard nav AND verified touch interaction. Both pass `ui-review` before merge.

### `llm-cost-discipline`

- **Wins**: any code calling an LLM API. Prompt caching, batch, model selection, token budgets.
- **Loses to**: `security-guidance` on prompt-injection-aware design (data plane vs control plane).
- **Cannot decide**: model choice when quality is uncertain (escalates to a cross-model benchmark, which is not harness-native).
- **Composes with**: `claude-api` (already exists in your skills).

### `frontend-design`

- **Wins**: any new UI component or layout. Anti-AI-slop rules, density, hierarchy, motion discipline, mobile-first layout design.
- **Loses to**: the `DESIGN.md` contract for system creation; `ui-review` for the audit/critique pass (this skill is build-time, ui-review is audit-time).
- **Cannot decide**: brand identity (DESIGN.md owns it).
- **Composes with**: `accessibility`, `typescript-strict`.
- **Mobile-first dual-quality invariant**: layout starts at 360–390px and is progressively enhanced. No desktop-only layout shipped without an equivalent mobile experience (or an explicit documented decision). Both viewports screenshot-reviewed before merge.

### `ui-review`

- **Wins**: auditing/critiquing/polishing an EXISTING UI. The AI-slop two-altitude test, squint test, interaction-state coverage, technical audit (contrast/a11y/responsive/perf), refine modes (polish/bolder/quieter/distill/harden).
- **Loses to**: `frontend-design` on the build-time rules (this skill assumes and checks against them, does not restate them); `forge` on market recon + scored 12-dim critique + design prompts.
- **Cannot decide**: brand identity (DESIGN.md); it does not rewrite a UI wholesale (findings + scoped refine only).
- **Composes with**: `frontend-design` (build floor to this audit ceiling), `accessibility` (a11y dimension), `forge` (recon/critique/prompt via the `source: forge` artifact contract). Vendored from impeccable + gstack design-review (DEV-389); live-browser audit deferred to Vague 4.

### `devex-audit`

- **Wins**: auditing/scoring/improving an EXISTING dev-facing surface (deployed API/CLI/SDK/docs). Measured TTHW, real error-path tracing (problem+cause+fix), evidence-tagged scorecard (TESTED/PARTIAL/INFERRED), gap-method scoring, scoped refine modes (quickstart/errors/docs/upgrade/types).
- **Loses to**: `plan-review`'s DevEx lens on judging a *written plan* before code (this skill audits the shipped reality); `api-and-interface-design` on *designing* the contract (this skill judges it after the fact, does not re-architect it).
- **Cannot decide**: the contract's shape (api-and-interface-design owns it); it does not drive a browser (web-only checks deferred to Vague 4).
- **Composes with**: `plan-review` (its DevEx lens is the plan-time counterpart), `api-and-interface-design` (build floor to this audit ceiling), `ui-review` (sibling audit skill, different subject). Vendored from gstack devex-review (DEV-398); live-browser audit deferred to Vague 4.

### `qa`

- **Wins**: live browser QA of a RUNNING web app (drive a real browser via claude-in-chrome, explore every state, find bugs, atomic fix loop, evidence report). The default post-change "does it actually work" pass; `--report-only` for a no-fix audit.
- **Loses to**: `tdd`/`testing` on authoring a unit/E2E suite (this composes them only for the regression test that locks a fix); `ui-review` on visual-craft judgment (this composes it for the visual pass).
- **Cannot decide**: visual design bar (defers to `ui-review`); it does not QA a dev-facing API/CLI/SDK surface (that is `devex-audit`).
- **Composes with**: `ui-review` (visual pass on live screenshots), `tdd`/`testing` (regression test in the fix loop). Vendored from gstack qa/qa-only + design-review live half, re-pointed onto the claude-in-chrome MCP (DEV-390). Assumed limit: not headless — no cloud/cron QA.

### `security-audit`

- **Wins**: the periodic deep pass — OWASP Top 10, STRIDE, secrets, supply chain, CI/CD, infrastructure, LLM trust boundaries. Phase-driven and **read-only**: it reports, it does not patch.
- **Loses to**: `security-guidance` on the daily floor (this is the ceiling above it, not a replacement); `code-review` on a single diff; `tdd` on writing the regression test that locks a finding.
- **Cannot decide**: whether a finding is worth fixing now (the human owns the risk call); it never edits code, and it never becomes the gate that ships a fix.
- **Composes with**: `security-guidance` (floor to this ceiling), `plan-review` (its Eng lens routes deep security here), `ticket` (a finding worth fixing becomes a ticket).

### `make-pdf`

- **Wins**: turning a finished markdown file into a publication-quality PDF for a signed, external deliverable. On-demand only.
- **Loses to**: every authoring skill on the *content* — it is a rendering step, invoked once the document is agreed.
- **Cannot decide**: anything about what the document says.
- **Composes with**: nothing structurally; it is a terminal step. Uses the system Chrome via puppeteer-core, with no gstack daemon.

---

## Cross-cutting boundary rules

These are global rules that apply across all skills:

1. **No skill modifies architectural decisions logged in DECISIONS.md without escalating.** The architecture skills `propose`; the user `decides` and records.
2. **No skill writes to project CLAUDE.md.** `learn` routes a lesson to `.void/PROJECT-DOCTRINE.md`, to a `voidcorp-core/void-harness` issue, or drops it, and every write is HITL. The `learnings/proposed/` queue and a `learnings-promote` skill were designed and never built (issue #74).
3. **No skill silently overrides another.** If a skill detects it should defer, it announces "deferring to `X` because Y" and invokes X.
4. **No skill claims completion of work owned by a dedicated skill/workflow.** QA (`harness:qa`), design (`frontend-design`/`ui-review`), ship (`implement` pass 11 + gh), and browser interactions (claude-in-chrome) each have an explicit home; a general skill or agent does not silently do their job.

---

## Conflict resolution

When two skills both claim "I win":

1. **Tactical conflict** (e.g., `tdd` vs `refactor` on a mixed diff): the user is asked which intent applies, and the diff is split if necessary.
2. **Strategic conflict** (e.g., `functional` says "pure" but `hexagonal-architecture` says "side-effecting adapter here"): the architecture skill wins on boundary placement, the implementation skill wins inside the boundary.
3. **Unresolvable**: stop, escalate to user with both positions stated explicitly.

---

## Status

Populated for the **37** core skills as of **2026-08-03** — code-discipline (9), process (17, including the canonical `implement` cycle, `ticket`, `autopilot`, `checkpoint` and the fused `learn`), and hedge (11) groups above. The count is a claim this file must keep honest: it is `ls packages/core/skills | wc -l`, and a matrix that lags the catalogue routes work to skills that no longer exist.

Lineage worth remembering: `autopilot` replaced `backlog-autopilot` at the 2026-07-30 cutover (which itself had replaced the deleted `autonomous-backlog-loop`); `learn` fused `compounding` + `capture-rule` + `harness-evolution` (issue #75). Refined as each skill's content evolves; any cell that becomes ambiguous in practice triggers a decision record via `void-harness decisions new`.
