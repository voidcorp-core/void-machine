---
name: void-implement
description: Use when taking a single ticket from ready through shipped at expert-team quality. Triggers on starting a ticket, taking an issue, or picking up a backlog item to execute.
---

# implement

One ticket, taken from ready to shipped, with the coverage a senior expert team would give it: architecture, tests, end-to-end, UX, security, review. This is the single canonical definition of "execute one ticket well." Both interactive work and `void-autopilot` delegate here, so the cycle is defined once and improving it improves both.

**Core principle:** Speed comes from skipping ceremony on trivial work, never from skipping a pass whose trigger fired. The triage is keyed to observable predicates (does it touch a boundary, a UI, a trust edge), not to a feeling that the change "looks simple."

**Attribution**: see `.source`.

---

## Canonical team orchestration

For `team` missions, the prose below is not the routing authority. Load the canonical mission plan
before invoking an agent. The pure Mission Engine controller owns state and verdict; the CLI
materializes its runtime-neutral specialist envelopes from the current plan.

1. Keep one `leadWriterId` for implementation and every correction. Reviewers never edit.
2. Start the controller-owned run with `mission start --ticket <ticket>`,
   then call `mission dispatch --id <mission> --json` for every next action. The start binds the
   canonical ticket path, ticket content, and frozen routing snapshot; dispatch accepts none of
   them again and refuses a changed ticket. Runtime identity comes from the native session marker,
   never a caller option; an unattested shell is permanently degraded.
   Never pass a locally chosen stage, round, runtime, or role list: the frozen mission start and
   pure controller own those decisions. Iterate every returned envelope only when the action is
   `invoke-specialists`; an empty list with another action is a state transition, not a routing hint.
3. Invoke each envelope's exact `agentName` in a separate fresh context. Codex uses native
   `spawn_agent` with `agent_type`; Claude Code uses native `Agent` with `subagent_type`. Run
   independent envelopes in parallel when the runtime supports it. Give each only its plan slice
   and bounded context pack; reviewers never edit. The dispatch command records
   `specialist.requested`. Once the fresh context identity is known, submit a bounded JSON file
   containing only `{ envelope, contextId }` through `void-harness mission specialist-event
   --status started`.
4. Parse each raw JSON result through the specialist completion contract, then submit only
   `{ envelope, contextId, completion }` with `--status completed`. On timeout or adapter failure,
   submit `{ envelope, contextId, reason }` with `--status failed`; never retain the prompt or raw model output.
   A malformed output, wrong role, stale hash, duplicate completion, or unavailable isolation is a
   failed completion and makes certification blocked/degraded.
5. Treat specialist output as structured findings, evidence requests, and limitations. It is never
   authoritative free-form prose and never grants write ownership.
6. Send one coherent correction batch to the same lead writer. Recompute review input hashes and
   rerun only specialists whose inputs changed. After `run-lead-writer`, `run-correction`, or
   `run-preparation-correction`, call `mission writer-event --id <mission>`; it consumes the
   controller's pending writer receipt rather than trusting caller-supplied identity or round.
   Then request the next controller action. For `run-verification`, use `mission verify`.
   `complete` and `stop` close the mission automatically. On interruption or abandonment, call
   `mission close --id <mission> --reason interrupted|abandoned` so lifecycle learning can
   distinguish unfinished work from a still-active dispatch.
7. Stop after two review rounds. A missing completion, stale proof, timeout, degraded specialist,
   or persistent blocker ends `blocked`/`degraded`, never green.

Claude and Codex use their installed native agent definitions. A sequential self-review in the
parent context is not a substitute for a missing subagent primitive. If the runtime cannot provide
fresh context or the declared read-only boundary, report the limitation and refuse certification.

---

## When to invoke

- Starting any single ticket or issue you intend to implement and ship.
- Once per ticket by `void-autopilot` (the per-ticket cycle IS this skill, run inside a worktree subagent).
- After `void-ticket` produced the ticket: its declared passes are an accelerator HINT. You ALWAYS evaluate the predicates yourself; a declaration may only ADD a pass, never cancel one whose predicate fired.

Do NOT use this to plan several tickets (that is `void-plan`) or to author the ticket itself (`void-ticket`).

---

## The cycle

Run in order. Each pass names the skill it composes and the predicate that fires it. `ALWAYS` passes never skip; conditional passes skip only when their predicate is false. You ALWAYS evaluate every predicate yourself against the actual change: a ticket declaration may ADD a pass, never cancel one whose predicate fired.

1. **Ingest + completeness gate** (ALWAYS). Fetch the complete ticket, including native relations: scope, AC, DoD, edge cases, declared passes, blockers. If `.void/program.md` scopes the unit, also read its global plan and spec. Confirm the unit is ready and nothing is missing or ambiguous. If a gap or uncovered angle exists, loop back to `void-ticket` to complete it before coding, do not paper over it. For a provider-backed unit, move it to the declared started state and assign it to the current maintainer before the first implementation edit. Load or compile the canonical mission plan and verify its hash before any specialist invocation; missing or conflicting plan data is degraded, not guessed.
2. **Architecture pass** (IF it touches structure, a module boundary, the data model, or public types). Compose `void-hexagonal-architecture`, `void-domain-driven-design`, agents `type-design-analyzer` + `doctrine-critic`. Confirm the applicable ADR is honored.
3. **Source grounding** (IF it writes or changes the configuration, schema, or call signature of a third-party dependency). Compose `void-source-driven-development`: read the official documentation **of the installed version** before the first line, and cite the reference where the config lives. Assumed semantics produce bugs that cost hours to find, and the assumption is invisible in the diff — which is why this runs before the writing rather than at review. A purely internal change has no official documentation to read: the predicate is false, and the pass does not run. A pass that fires on everything becomes a box to tick.
4. **Migration safety** (IF it changes a DB schema or ships a migration). Compose `void-migrations` (and `void-drizzle-migration-safe` on a Drizzle/Postgres stack): zero-downtime, two-phase, batched backfill, locking analysis. **Once the migration is generated and safety-reviewed, apply it to the dev/local database before the TDD and E2E passes run** — otherwise those tests execute against a stale schema and prove nothing about the new shape. **This cycle only ever applies to dev/local; production migrations run through CI / GitHub Actions on merge, never from a worker or this session** (see the `void-migrations` anti-rule). A schema change must never reach the rest of the cycle without this pass.
5. **TDD implementation** (ALWAYS). The single lead writer composes `void-tdd` + `void-testing`. Red, green, refactor. Unit tests for the behavior, green before moving on. Review specialists remain read-only.
6. **Async + idempotency** (IF it sends email, calls an external side-effecting API, enqueues a job, or mints a single-use token). Compose `void-async-safety`: idempotency keys, replay/dedup window, bounded retries, single-use enforcement.
7. **End-to-end tests** (IF it touches a user-facing flow). Write/extend the E2E suite (Playwright). The path a user actually walks, not just the unit.
8. **UX/UI pass** (IF it touches a UI surface). The interface is held to production craft, not just "it renders". Compose `void-frontend-design` (build-time craft) + `void-ui-review` (the audit/critique ceiling: AI-slop test, squint test, interaction-state coverage, technical audit) + `void-accessibility`, across the baseline (BACK+FRONT parity, mobile and desktop, and the states a user actually hits — loading / error / empty). Browser-verified QA (live screenshots) runs via `void-qa` (the claude-in-chrome MCP). A UI ticket is not shippable until this pass is **verified, not assumed**.
9. **Security pass** (ALWAYS a quick scan; DEEP if it touches a trust boundary: external input, auth, RLS/tenancy, untrusted content, secrets, or a side-effecting action). Compose `void-security-guidance` + `void-security-audit`.
10. **Review** (ALWAYS). Run the canonical team orchestration above. Compose `void-code-review` for the integration lens; `doctrine-critic`, `silent-failure-hunter`, and project reviewers may add scoped findings but never replace the required Architecture, Security, and QA completion events. Findings are deduplicated by concrete evidence, not reviewer majority. On a high-stakes diff, add one independent fresh-context adversarial pass; classify each finding FIXABLE vs INVESTIGATE and name the single most exploitable finding. *Vendored from gstack `/ship`.*
   **Name the anti-patch rule in this pass, out loud.** The first implementation that comes to mind is often a patch at the wrong level of abstraction: tokenising a string where the API takes a typed schema, mocking a field the real adapter never returns, disabling a flag instead of understanding what it blocks. A V0 mock mirrors the real adapter's signature, never a convenience one. It is judged **here**, on the first draft, because before the writing there is nothing to judge — and it does not belong to the Architecture pass, since a patch slips in precisely through the changes that touch no structure at all.
11. **Verification before completion** (ALWAYS). Compose `void-verify`: typecheck, tests, hooks, both viewports, all observed not assumed. **A red suite is adjudicated before proceeding** (from gstack `/ship`): each failure is *in-branch* (you touched the test/code, or it traces to the diff → it is yours, fix it) or *pre-existing* (neither touched → offer fix / TODO / skip); ambiguous defaults to in-branch. Test on the **merged base**, not the stale branch. The controller may return `verified` only when every applicable specialist completion and required proof is fresh.
12. **Ship** (ALWAYS). Compose `void-commit-discipline`, open the PR, attach the PR and verification evidence, then move a tracker-backed ticket to **In Review**. Move it to **Done** only after merge and final verification of the merged state. Commits are **bisectable** — one logical change each, dependency-ordered (infra → domain + tests → edge/UI + tests), each independently valid. Under autopilot the worker never opens the PR or changes review state (the reconciler does); it stops at a green committed branch.

---

## Tracker lifecycle

For every tracker-backed ticket, the tracker is part of execution, not an after-the-fact mirror:

- **Claim before edits**: re-fetch status and relations, verify blockers are complete, then set `In Progress` and assign the current maintainer.
- **Keep it truthful**: maintain native blockers and add a concise comment when a material blocker, scope decision, or external dependency changes the contract.
- **Leave a bounded handoff**: when a session ends unfinished, keep `In Progress` and comment with branch/worktree, last verified result, remaining work, blocker, and exact next action.
- **Review before done**: after ticket gates pass, attach PR/evidence and use `In Review`; use `Done` only after merge and final verification.
- **Respect human gates**: collect evidence and request approval, but never complete a gate or merge without the declared human action.
- **Fail closed**: when `.void/program.md` requires provider-backed execution and the declared adapter cannot perform a required read or write, stop that action. Do not select another unit or maintain a competing local current/next-unit pointer.

Never place secrets, full prompts, full model responses, or private source in tracker comments.

---

## Triage: what "fast" means

Evaluate every predicate against the actual change. Never let an upstream declaration suppress a pass whose predicate is true.

| Pass | Fires when | Skippable |
|------|-----------|-----------|
| Ingest + completeness | always | no |
| Architecture | structure / boundary / data model / public type | yes |
| Source grounding | third-party config, schema, or call signature written or changed | yes |
| Migration safety | DB schema change or migration | yes |
| TDD implementation | always | no |
| Async + idempotency | email / external side effect / job / single-use token | yes |
| End-to-end tests | user-facing flow touched | yes |
| UX/UI | UI surface touched | yes |
| Security | always (deep if trust boundary) | no (depth varies) |
| Review | always | no |
| Verification | always | no |
| Ship | always | no |

"Fast" = skip the passes whose predicate is false. It never means skipping an `ALWAYS` pass, or one whose predicate fired, to save time.

---

## Red flags: STOP, you are skipping a triggered pass

| Rationalization | Reality |
|-----------------|---------|
| "One-line change, skip the review" | Review is ALWAYS. One-liners ship the worst regressions. |
| "No UI here, skip security" | Security quick-scan is ALWAYS; a backend input is a bigger injection surface than a button. |
| "Tests after, ship now, it works" | TDD is ALWAYS. Tests written after green prove nothing about intent. |
| "It hits a trust boundary but it is internal" | Internal still gets the DEEP security pass. Tenancy leaks are internal. |
| "Going fast means skipping E2E" | Fast skips passes whose PREDICATE is false, not the ones that fired. |
| "The ticket looked complete, skip the gate" | The gate is one read. A missing edge case found now is hours saved later. |
| "It works, I'll clean it up after" / "I'll mock that field to unblock the test" | That IS the patch, and it sits at the wrong level. The test going green is not the evidence — refactor the approach, do not paper over it. |
| "I know how this library works, no need to open the docs" | Assumed semantics are the expensive bug: invisible in the diff, found hours later. Source grounding reads the docs of the INSTALLED version, which is not the one memory holds. |
| "It renders, ship the UI" | Rendering is not craft. The UX/UI pass runs `void-frontend-design` + `void-ui-review` (audit) — hierarchy, motion, states, mobile, anti-slop, not just "it appears". |

Violating the letter of the triage is violating its spirit: the predicate decides, not the vibe.

---

## Model tier by pass (frugality, no quality loss)

Tokens follow stakes: mechanical work runs cheap, judgment runs at full strength. This never cheapens a judgment pass — the predicate that fires a pass also sets its tier.

- **Mechanical (may run a cheaper model)**: the ingest read, artifact/mirror regeneration, a trivial edit whose predicate fired nothing else.
- **Judgment (stay top-tier)**: architecture, DEEP security, the review adversarial pass, verification adjudication of a red suite, and any brainstorm/design step.
- **Subagents carry their own tier**: `doctrine-critic` / `silent-failure-hunter` / `code-explorer` run sonnet; `type-design-analyzer` runs sonnet, `migration-planner` opus (see the agent frontmatter). This skill composes them; it does not override their tier.
- **Interactive vs worker**: run interactively, the cycle uses the session model (the human's choice); the tiering above is realized when the cycle runs as a `void-autopilot` **worker**, where the worker's model is set from the ticket's stakes (`workerTier`, top-tier by default). A light ticket's whole cycle runs cheaper; a high-stakes one stays full-strength.

## Composition

Upstream: `void-ticket` produces the ticket and declares its conditional passes. Caller: `void-autopilot` runs this once per ticket in parallel worktrees, whole and once. Neither restates a pass of this cycle: it has one owner so a ticket gets the same standard however it was started. The skill conducts; the Mission Engine controller decides state, invalidation, and verdict; native specialists own their bounded reviews.
