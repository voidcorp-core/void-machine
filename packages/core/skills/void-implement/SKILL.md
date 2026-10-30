---
name: void-implement
description: Use when taking a single ticket from ready through shipped at expert-team quality. Triggers on starting a ticket, taking an issue, or picking up a backlog item to execute.
---

# implement

One ticket, taken from ready to shipped, with the coverage a senior expert team would give it: architecture, tests, end-to-end, UX, security, review. This is the single canonical definition of "execute one ticket well." Both interactive work and `void-autopilot` delegate here, so the cycle is defined once and improving it improves both.

**Core principle:** keep the senior engineering floor, scale the work to the actual change.
This skill owns applicability across the cycle: inspect the affected behavior, boundary and risk
once; load the relevant standards and consult the primary domain specialist before coding.
An explicit user request with clear scope and acceptance criteria is an executable unit; a
tracker ticket, separate spec or plan is not required merely to begin authorized work.
Stop when acceptance criteria, applicable proofs and independent review are satisfied.
Preferences and optional improvements never start another correction cycle. TDD before new
behavior, security, KISS and SOLID remain requirements; ceremony is not a substitute for them.

**Attribution**: see `.source`.

---

## Assign the writer once

The interactive coordinator invokes `void-orchestrate` to delegate substantial
implementation to one writer before starting this cycle. An agent already assigned the unit
executes it: never delegate this complete workflow again. Tiny direct work and
capability fallbacks follow that policy without skipping triggered quality gates.
Preserve one `leadWriterId` through corrections; the coordinator retains user intent
and decisions. Pass any orchestrator-owned panel contract unchanged.

## Optional usage linkage

At work start, when both the existing mission ID and exact native session journal ID are known,
the coordinator runs `void-machine mission usage-bind --id <mission> --source <session-journal>`.
This begins prospective counting without changing installed hooks. Never guess a journal from
recent activity, timestamps or an inherited thread/session variable; a shared session is not
worker isolation. If identification is unavailable, report unknown and continue the authorized
work. The coordinator owns this action, not an ID reconstruction task for the user. `void-verify`
closes the interval and reports once at the end; no per-edit command or extra delivery gate.

## Canonical team orchestration

When the caller supplies `panel.provider: orchestrator`, the orchestrator owns specialist
dispatch. The worker consumes the supplied verdicts, corrects in its own context, and returns the
panel record; it does not start `mode team`, spawn specialists, or report a missing primitive as
`DEGRADED`. Interactive work may use the native provider when the runtime exposes fresh contexts.

For `team` missions, the prose below is not the routing authority. Load the canonical mission plan
before invoking an agent. The pure Mission Engine controller owns state and verdict; the CLI
materializes its runtime-neutral specialist envelopes from the current plan.

1. Keep one `leadWriterId` for implementation and every correction. The implementer owns
   the worktree and code; specialists and the independent reviewer never edit.
2. Start with `mission start --ticket <ticket>` and follow `mission dispatch --id <mission>
   --json`. The frozen task and controller own routing, state and correction budget. Normal
   dispatch starts the writer without a compulsory preparation panel. The writer still obtains
   the primary domain specialist advice required by pass 5 before production edits.
   For canonical `invoke-specialists` actions, pass each envelope unchanged through
   `void-orchestrate` and record actual starts/results with `mission specialist-event --id <mission>`.
   Reconcile any existing invocation; a missing response resumes its run, never another cycle.
3. The implementer implements and verifies, then commits the candidate. Record the pending
   writer receipt with `mission writer-event --id <mission>`. Review must bind an exact
   `reviewedCommit`, `baseCommit` and `acceptanceCriteriaHash`; a mutable worktree is insufficient.
   Prefer a dedicated worktree pinned to that commit, with native read-only permissions.
4. Dispatch one independent general review through `void-orchestrate` in a fresh native
   read-only context, preserving its actual invocation. Preserve its actual result. Submit the canonical completion and minimal review receipt:
   task, reviewer and writer identities, exact subject, conclusions, proofs and resolutions.
   Native context identity supplements provenance; missing or refused identity alone does not
   invalidate an executed, traceable independent review. Use the supported artifact provenance
   path and state its precise limitation. Never invent an identity, independence or review.
   Malformed, mismatched, stale or forged evidence still refuses; self-review is not independent.
5. Only a concrete blocking defect requests correction: name the violated criterion, consequence,
   evidence and resolution condition. Advisory findings never block, consume a correction cycle
   or trigger another review. The implementer corrects or records a reasoned disagreement.
6. Submit corrections as a coherent batch, commit and record the writer event. Verification is
   targeted to the original findings and affected behavior, never a new general panel. Retain
   unaffected conclusions and proofs; invalidate only affected evidence. A new targeted blocker
   must demonstrate a regression from the correction or a defect within the original scope.
   Carry unresolved blockers until an explicit, evidenced resolution; silence is not resolution.
7. Maximum two correction batches after the initial general review. A batch is submitted
   corrections awaiting targeted verification. Agent restart, incomplete review, transport repair
   and mission resumption neither consume a batch nor reset the budget. At the limit, stop
   automatic corrective dispatch, retain history and expose a cause, owner and next action.
   Never declare completion with an unresolved blocking defect. The orchestrator may obtain
   one independent opinion on a disputed point and retain it as proof for targeted verification;
   this is not an automatic arbitration command or a permission override. It never reopens
   general review or resets the budget.
8. Use `mission verify` for required verification evidence. Future implementation proofs do not
   block preparation prematurely. Escalate to the human only a decision beyond the mandate.
   A turn ending does not end the task. Resume through supported mission commands, preserving
   prior reviews, resolutions, budgets and effects. Existing attestation-only stops need explicit
   validation of the original review's subject, available provenance and result before recovery;
   never promote a degraded historical result automatically or recreate the mission to bypass it.
9. Collect the final result before closing an orchestrator-owned agent panel. Keep worktrees,
   branches and useful proofs on their distinct lifecycle. Panel closure never deletes them.

The CLI and existing Mission Engine implement this bounded cycle. A runtime certification is
not an additional delivery gate. Concrete independence, permission, isolation, evidence and
acceptance failures remain enforceable; an unavailable reviewer is reported, never fabricated.

---

## When to invoke

- Starting any single ticket or issue you intend to implement and ship.
- Once per ticket by `void-autopilot` (the per-ticket cycle IS this skill, run inside a worktree subagent).
- After `void-ticket` produced the ticket: its declared passes are an accelerator HINT. You ALWAYS evaluate the predicates yourself; a declaration may only ADD a pass, never cancel one whose predicate fired.

Do NOT use this to plan several tickets (that is `void-plan`) or to author the ticket itself (`void-ticket`).

---

## The cycle

Run in order. Each pass names the skill it composes and the predicate that fires it. `ALWAYS` passes never skip; conditional passes skip only when their predicate is false. You ALWAYS evaluate every predicate yourself against the actual change: a ticket declaration may ADD a pass, never cancel one whose predicate fired.

1. **Ingest + completeness gate** (ALWAYS). Read the complete explicit request or ticket, available acceptance criteria, affected contracts and real blockers. Reuse decisions already authorized in the conversation. Resolve only ambiguities that change the result, safety or scope; missing labels or a prose template do not block implementation. Use `void-brainstorm` for an unresolved structural choice and `void-plan` for dependent steps that need durable coordination, not for routine edits. For provider-backed work, read native relations and claim it before edits. A scoped programme still supplies its linked plan/spec; canonical specialist requests still require the authenticated mission plan.
2. **Architecture pass** (IF structure, a module boundary, data model or public contract changes). Apply `void-hexagonal-architecture` and `void-domain-driven-design` to the affected boundary. Keep KISS and SOLID: a layer or branded type earns its place through an invariant, responsibility or substitution contract, not its name. Consult `type-design-analyzer` or `doctrine-critic` when a concrete design question needs that expertise. Honor applicable ADRs; use `void-decide` only for a lasting structural choice.
3. **Source grounding** (ALWAYS; the source depends on what the change touches). Read the relevant sources before the first line, per the Anti-rustine section of `PHILOSOPHY.md`. For a third-party configuration, schema or call signature, compose `void-source-driven-development`: official documentation **of the installed version**, never an upgrade by default. For internal code, read the owning contract, types, source and project docs of what you are about to change. Assumed semantics produce bugs that cost hours to find, and the assumption is invisible in the diff — which is why this runs before the writing rather than at review. Cite a source briefly when it helps understand or record a choice; a missing citation never blocks on its own.
4. **Migration safety** (IF it changes a DB schema or ships a migration). Compose `void-migrations` (and `void-drizzle-migration-safe` on a Drizzle/Postgres stack): zero-downtime, two-phase, batched backfill, locking analysis. **Once the migration is generated and safety-reviewed, apply it to the dev/local database before the TDD and E2E passes run** — otherwise those tests execute against a stale schema and prove nothing about the new shape. **This cycle only ever applies to dev/local; production migrations run through CI / GitHub Actions on merge, never from a worker or this session** (see the `void-migrations` anti-rule). A schema change must never reach the rest of the cycle without this pass.
5. **Targeted preparation advice** (IF production behavior, a coding contract or implementation structure changes). Detect the affected domains and invoke the primary domain specialist before implementation through `void-orchestrate`; reuse its advice through corrections unless its actual inputs change. Add an expert only for a distinct risk the primary cannot cover. Give the accepted brief, affected contract and bounded question; collect its actual response before code. Documentation-only, generated-only or mechanical changes with no behavioral/contract effect need no coding specialist. This advice is not an automatic canonical gate or a quorum of every applicable profile. With `panel.provider: orchestrator`, consume its supplied advice without duplication. For canonical `invoke-specialists`, preserve runtime, agentName, missionId, contextPack, reviewSubject and reviewScope; record actual starts/results. Reconcile uncertain invocations, keep at most four simultaneous agents, and never treat a wait timeout as failure. Preserve real unresolved findings and author-owned evidence obligations; advice never substitutes for final independent review.
6. **TDD implementation** (ALWAYS). During development, the coordinator may create or reuse a draft pull request for the branch. Keep work-in-progress PRs in draft and run focused local checks; do not wait for full remote CI per iteration. `void-verify` owns the transition to complete integration checks and its portable CI template. The single lead writer composes `void-tdd` + `void-testing`. Red, green, refactor. Unit tests for the behavior, green before moving on. Review specialists remain read-only.
7. **Async + idempotency** (IF it sends email, calls an external side-effecting API, enqueues a job, or mints a single-use token). Compose `void-async-safety`: idempotency keys, replay/dedup window, bounded retries, single-use enforcement.
8. **End-to-end tests** (IF changed user behavior crosses integration boundaries that focused tests cannot prove). Extend the relevant journey in the configured E2E suite. Reuse an existing current proof that already covers the changed contract; do not add a duplicate journey for a local presentation edit.
9. **UX/UI pass** (IF a UI contract changes). Apply `void-frontend-design` and `void-accessibility` to affected controls, states and viewports. Verify keyboard/touch parity and mobile/desktop behavior for the changed surface through focused tests and `void-qa`. Use `void-ui-review` for a new or materially redesigned journey, or a specific unresolved usability defect; a local edit does not trigger a full application audit. Existing design standards remain binding.
10. **Security pass** (ALWAYS inspect the change; focused analysis IF a trust boundary changes). Apply `void-security-guidance` to external input, auth, tenancy, untrusted content, secrets and side effects as they are designed and implemented. A final security review does not replace safe boundaries during development. `void-security-audit` is a deliberately requested deep audit, not an automatic second full review of every ticket.
11. **Review** (ALWAYS). Run the single independent general review in the bounded cycle above. Compose `void-code-review` for that pass. Relevant preparation specialists advise before implementation; they are not a mandatory repeated post-implementation panel. After corrections, inspect only the affected findings and behavior. Findings are judged by demonstrated consequence, not reviewer majority.
   **Judge the change against the economy-of-means section of `PHILOSOPHY.md`**: a judgment, not a score, explained briefly only when that helps record a choice. It blocks only on a demonstrated defect (security, broken behavior, or a boundary or contract violated with a real consequence); anything else is advisory.
   **Review the draft against the anti-patch rule.** The review is real; no verbal ritual is required. The first implementation that comes to mind is often a patch at the wrong level of abstraction: tokenising a string where the API takes a typed schema, mocking a field the real adapter never returns, disabling a flag instead of understanding what it blocks. A V0 mock mirrors the real adapter's signature, never a convenience one. It is judged **here**, on the first draft, because before the writing there is nothing to judge — and it does not belong to the Architecture pass, since a patch slips in precisely through the changes that touch no structure at all.
12. **Verification before completion** (ALWAYS). Compose `void-verify`, which owns the single informational ticket-end usage recap: applicable typecheck, tests, hooks and affected viewports, all observed not assumed. Reuse proofs whose declared inputs are unchanged; re-run affected proofs, plus required integration checks on the candidate. **A red suite is adjudicated before proceeding** (from gstack `/ship`): each failure is *in-branch* (you touched the test/code, or it traces to the diff → it is yours, fix it) or *pre-existing* (neither touched → offer fix / TODO / skip); ambiguous defaults to in-branch. Test on the **merged base**, not the stale branch. Completion requires the independent review, resolution of blocking defects, and fresh applicable verification proofs; native runtime attestation alone is not a delivery prerequisite.
13. **Dogfood the shipped surface** (IF the ticket adds or changes a CLI command, a hook, an executable skill, or any output a person will read). Run the thing, on the **real repository**, and quote what came back in the evidence.
    This exists because the passes above have a measured hit rate of zero on a whole class of defect. Six shipped on 2026-08-06 with typecheck, lint, 2,700 tests and five CI checks green: five were caught by using the thing on the real tree, one by the harness itself, none by CI and none by the human merge gate. One of them reported "5 path(s) not extracted" about files it had read, parsed and indexed — the exact lie the feature existed to prevent — and it surfaced by running the command on the repo, after merge. Under autopilot nobody comes back to the previous ticket, so a defect found that way is a defect not found at all.
    **A fixture is not a dogfood.** The fixture is the shortcut that would have missed every one of the six: the two oversized generated artifacts that exposed the false count existed only in the real tree. **And "the command did not crash" is not an observation** — the output has to be read, and quoted rather than summarised as "works". A surface that genuinely cannot run here (a deploy, a remote service) has its limitation named, never worked around in silence. Keep the run read-only or reversible.
14. **Dispose of what you found** (ALWAYS). A cycle surfaces defects that are not this ticket: an incoherent skill, a stale doc, a contract that lies. Do not file them on their merits. Compare each against the unit you are building, judged against the program objective: it either blocks this unit and is fixed here, or it beats this unit and becomes the next one, or it is **dropped**. Report only findings that affect delivery, a human decision or unreconstructable evidence; do not produce a dropped-findings ledger. Record only evidence that cannot be reconstructed — a failure seen once, a measurement — with the command that replays it. The admission rules are `void-ticket`'s; this pass is where they fire.
15. **Ship** (ALWAYS). Compose `void-commit-discipline`, reuse the existing PR for the branch (create one only if absent), attach verification evidence, and mark the same pull request ready when the candidate meets the review handoff requirements. Then move a tracker-backed ticket to **In Review**. Move it to **Done** only after merge and final verification of the merged state. Commits are **bisectable** — one logical change each, dependency-ordered (infra → domain + tests → edge/UI + tests), each independently valid. Under `void-autopilot` the worker is commit-only: it returns the commit and proof references to the coordinator, who owns pushes, PR creation/readiness and tracker updates. The worker never enables auto-merge, merges, posts the review status or moves the ticket to Done; the loop's reviewer performs the independent review of step 11 on the PR head SHA.

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

## Primary domain advice

Select the smallest useful expertise from the actual changed contract, not every touched filename.

| Main change | Primary specialist |
| --- | --- |
| UI interaction / rendering | `frontend-engineer`; `experience-designer` for unresolved journey design |
| Business invariants / domain model | `domain-architect` |
| Public API / integration contract | `api-integration-engineer` |
| Persistent schema / backfill | `data-migration-engineer` |
| Security / auth / tenancy | `security-engineer` |
| Runtime reliability / async operations | `observability-sre-engineer` |
| Measured performance bottleneck | `performance-engineer` |
| CLI / SDK / developer workflow | `devex-docs-engineer` |
| Cross-module structure | `solution-architect` |

If several domains change, the primary covers the dominant contract and requests only missing
expertise for a distinct risk. Record the selection and actual result in existing task evidence.
If the required capability is unavailable, state that limit and its delivery consequence; never
invent consultation or start another preparation loop. Runtime-native advice is sufficient;
creating an extra mission ledger solely to count the consultation is not required.

## Triage: what "fast" means

Evaluate every predicate against the actual change. Never let an upstream declaration suppress a pass whose predicate is true.

| Pass | Fires when | Skippable |
|------|-----------|-----------|
| Ingest + completeness | always | no |
| Architecture | structure / boundary / data model / public type | yes |
| Source grounding | always (official docs if third-party, project contracts if internal) | no (source varies) |
| Migration safety | DB schema change or migration | yes |
| Domain advice | behavior, coding contract or implementation structure changes | yes |
| TDD implementation | new or changed behavior; preserve existing proof for mechanical work | no when applicable |
| Async + idempotency | email / external side effect / job / single-use token | yes |
| End-to-end tests | changed journey needs integration proof | yes |
| UX/UI | affected UI contract; full audit only for a material journey change | yes |
| Security | inspect every change; focused analysis of changed trust boundaries | no (scope varies) |
| Review | always | no |
| Verification | always | no |
| Dogfood | CLI command / hook / executable skill / output a person reads | yes |
| Ship | always | no |

"Fast" = skip the passes whose predicate is false. It never means skipping an `ALWAYS` pass, or one whose predicate fired, to save time.

---

## Red flags: STOP, you are skipping a triggered pass

| Rationalization | Reality |
|-----------------|---------|
| "One-line change, skip the review" | Review is ALWAYS. One-liners ship the worst regressions. |
| "No UI here, skip security" | Security quick-scan is ALWAYS; a backend input is a bigger injection surface than a button. |
| "Tests after, ship now, it works" | TDD is ALWAYS. Tests written after green prove nothing about intent. |
| "It hits a trust boundary but it is internal" | Internal trust boundaries still need focused security analysis. Tenancy leaks are internal. |
| "Going fast means skipping E2E" | Fast skips passes whose PREDICATE is false, not the ones that fired. |
| "The ticket looked complete, skip the gate" | The gate is one read. A missing edge case found now is hours saved later. |
| "It works, I'll clean it up after" / "I'll mock that field to unblock the test" | That IS the patch, and it sits at the wrong level. The test going green is not the evidence — refactor the approach, do not paper over it. |
| "I know how this library works, no need to open the docs" | Assumed semantics are the expensive bug: invisible in the diff, found hours later. Source grounding reads the docs of the INSTALLED version, which is not the one memory holds. |
| "The tests are green, no need to run it" | Green tests and a working surface are different claims. Six defects shipped past 2,700 of them; what caught five was running the thing. The Dogfood pass fires on a surface, not on a doubt. |
| "I dogfooded it on the fixture" | The fixture is the shortcut. It holds what you thought to put there, which is never the artifact that breaks the count. Real repository or it did not happen. |
| "It renders, ship the UI" | Rendering is not craft. The UX/UI pass runs `void-frontend-design` + `void-ui-review` (audit) — hierarchy, motion, states, mobile, anti-slop, not just "it appears". |

Violating the letter of the triage is violating its spirit: the predicate decides, not the vibe.

---

## Native model choice

`void-orchestrate` owns model selection from the task's risk, explicit user choice and actual
native controls. Use that policy for specialists and writers; keep the assigned writer's full
quality cycle. This workflow adds no model names, worker-tier field or second selection rule.

## Composition

Upstream: `void-ticket` produces the ticket and declares its conditional passes. Caller: `void-autopilot` runs this once per ticket in parallel worktrees, whole and once. Neither restates a pass of this cycle: it has one owner so a ticket gets the same standard however it was started. The skill conducts; the Mission Engine controller decides state, invalidation, and verdict; native specialists own their bounded reviews.
