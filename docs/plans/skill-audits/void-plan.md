---
skill: plan
status: reviewed
strategy: distill
target_loc: 300
phase: D
depends_on: [brainstorm]
composes_with: [tdd, code-review]
matrix_row: plans/skill-decision-matrix.md#plan
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `plan`

## Need

Without `plan`, an approved design jumps directly to code. The plan is implicit, dependencies are missed, verification gates between steps are absent, review checkpoints get forgotten, and the order of steps drifts as work proceeds. Worse, sessions end mid-implementation with no durable handoff, and the next session re-litigates the order. `plan` turns an approved spec into an executable plan with explicit sequencing, dependencies, verification gates, and either a standalone resume point or a tracker execution handoff.

## Decision matrix anchor

- **Wins**: turning an approved design into an executable plan. Sequencing, dependencies, verification gates between phases, review checkpoints, and an explicit execution handoff
- **Loses to**: `brainstorm` on intent and design choices (the plan does not re-litigate design)
- **Cannot decide**: feature scope (planning is sequencing, not scoping). Architecture (defers to architecture skills consumed at planning time via the spec)
- **Composes with**: `brainstorm` (upstream), `ticket` (multi-ticket decomposition), `implement` (single-unit execution), `backlog-autopilot` (attended independent-ticket drain), `tdd` (per-step mode selection)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| superpowers/plan | superpowers/skills | reviewed | kept as primary source (proven structure, used to ship Phase A–C of this very harness) |
| superpowers/executing-plans | superpowers/skills | reviewed | historical source; no longer the default downstream because `implement` owns execution |
| superpowers/subagent-driven-development | superpowers/skills | reviewed | historical source; attended parallel work routes through `backlog-autopilot` |
| citypaul plan templates (in `plans/`) | citypaul/.dotfiles | reviewed | partially kept (sectioning style, numbered steps with verification gates) |
| gstack `/autoplan` | gstack/skills | vendored (DEV-385) | its methodology is now `harness:plan-review` (the `all` mode) — a different niche (REVIEWS an existing plan via CEO/Eng/Design/DevEx lenses). Composes with this skill: plan-review is invoked after plan to validate a high-risk plan |

## Adaptation strategy

`distill`. Rewrite superpowers/plan for void-harness. Three deliberate changes:

1. **TDD mode per step**: every implementation step declares its TDD mode (`strict` / `souple` / `exploratory`) inline. Why: prevents re-litigation at implementation time and surfaces the cost up front.
2. **Execution handoff is first-class**: standalone plans use a resume point; tracker-backed programs use a stable ordering/dependency table and let tracker state choose the next ticket. Why: one mutable execution ledger prevents cross-session drift.
3. **Verification gates between steps**: each step ends with explicit `tsc --noEmit && test:affected` (and optionally `mutation` in strict mode). Why: catches regressions at the step boundary, not at the end.

## What we keep (verbatim or near-verbatim)

- **Plans are written, not narrated** (superpowers): output is a markdown file in `plans/YYYY-MM-DD-<topic>.md` and committed. Verbal-only plans are rejected.
- **Each step has**: subject (imperative), goal, dependencies on other steps, verification gate, expected commit messages (composes with `commit-discipline`).
- **Verification gates between steps must pass** before moving to the next step. Composes with `pre-commit typecheck+test` hook.
- **Review checkpoints are declared explicitly** (superpowers): no implicit "review at the end." A 5-step plan typically has 1–2 review checkpoints; the user is asked to review work-to-date before proceeding.
- **Plans link back to their spec** (superpowers): the YAML frontmatter `spec:` points to `docs/specs/<spec-file>`. The spec links to its plan. Bidirectional.
- **No code before plan is approved** (superpowers): like brainstorm's hard gate, planning has its own gate — the plan is written, self-reviewed, user-reviewed, then handed to `ticket` or `implement`.
- **Plan self-review pass** (superpowers, mirrors brainstorm): after writing the plan, scan for placeholders, missing verification gates, unrealistic dependencies, and a missing execution handoff. Fix inline.

## What we adapt

- **TDD mode per step (new in voidcorp)**: each implementation step explicitly declares mode. Examples:
  ```markdown
  ### Step 3: Implement checkoutCart use-case
  - TDD mode: strict (new business behavior, payment surface)
  - Goal: ...
  - Verification: tsc --noEmit && vitest run --coverage --filter checkoutCart
  ```
  Why: makes the discipline cost visible at planning; the user can see "this plan is 3 strict + 2 souple + 1 exploratory" and adjust.
- **Handoff varies by execution model**: a standalone plan ends with a mutable resume point. A provider-backed multi-unit programme ends with a stable order/dependency table; `ticket` creates `.void/program.md` only after the native pool exists. Why: cross-session shipping without duplicating provider state.
- **Verification gates compose with hooks** (new): each step's gate maps to specific harness hooks (`pre-commit typecheck+test`, `tdd-guard`, `tigerstyle-check`). Plans state which hooks must succeed at that step. Why: explicit composition surfaces what protects each step.
- **Composition with `plan-review`** (was gstack `autoplan`, vendored DEV-385): plans that target high-risk surface (payment, auth, prod migrations) can be reviewed by `harness:plan-review` (`all` mode) after writing. Plans include a flag in frontmatter (`high_risk: true`) that triggers a plan-review recommendation. Why: catch design issues without re-litigating brainstorm.

## What we reject

- **Using external executing-plans as the default downstream**: rejected after `implement` became the harness's canonical ready-to-shipped unit and `backlog-autopilot` became its attended parallel coordinator. Keeping a second default execution path would split lifecycle doctrine.
- **Plans-as-conversations**: rejected. Always written to disk.
- **Implicit dependencies**: rejected. Step N's dependencies on prior steps are explicit in the frontmatter or step header.
- **Plans that combine design and sequencing**: rejected. The spec (from brainstorm) has the design. The plan has the sequence. They are linked but distinct.
- **Pre-defined plan templates that prescribe step count**: rejected. Plan length follows project complexity.

## Hard rules surfaced by this skill

- **Plans live in `plans/YYYY-MM-DD-<topic>.md` and are committed**. Enforced by: SKILL.md + `code-review` flags PRs implementing a spec without a linked plan (for non-trivial work).
- **Every step has a verification gate**. Enforced by: SKILL.md template + `code-review`.
- **Every implementation step declares its TDD mode**. Enforced by: SKILL.md template + plan self-review pass.
- **Plans have exactly one applicable handoff**: resume point for standalone execution, stable tracker table for a multi-ticket program. Enforced by: SKILL.md self-review.
- **No code before plan approval**. Enforced by: SKILL.md gate (mirrors brainstorm).
- **Plans link back to their spec via frontmatter `spec:`**. Enforced by: SKILL.md template.

## Execution handoff variants

The planning discipline is uniform through steps and verification. Only the final handoff varies:

- standalone sequential work uses the plan's resume point;
- provider-backed multi-unit work uses an immutable execution table, then `ticket` materializes native dependencies and `.void/program.md`.

## Companion hooks

None. Planning is a process discipline; the verification gates leverage existing hooks (`pre-commit typecheck+test`, `tdd-guard`, etc.) rather than introducing new ones.

## Composition with other skills

- **Upstream — `brainstorm`**: the approved spec is the input. Plans does not re-litigate design.
- **Downstream — `ticket`**: creates the native pool and active handoff for multi-ticket programs.
- **Downstream — `implement`**: takes one named unit from ready through shipped.
- **With `backlog-autopilot`**: runs explicitly requested parallel work through the attended coordinator.
- **With `tdd`**: per-step mode selection lives in the plan.
- **With `code-review`**: review checkpoints declared in the plan are honored.
- **With `verify`**: the plan's "Done" criteria feed the completion checklist.
- **With `harness:plan-review`**: optional review of the plan via CEO/Eng/Design/DevEx lenses for high-risk surface (vendored from gstack `autoplan`, DEV-385).
- **With `commit-discipline`**: each step states the expected conventional-commit message (`feat:`, `fix:`, `refactor:` etc.) so commits align with the plan.

## Anti-rules (what this skill MUST NOT do)

- MUST NOT decide feature scope (that is `brainstorm`, which now includes the vendored idea pressure-test).
- MUST NOT decide architecture (architecture skills inform via the spec).
- MUST NOT execute the plan (downstream skills do that).
- MUST NOT skip the spec-link requirement.
- MUST NOT silently allow a step without a verification gate.
- MUST NOT pretend mode selection is "implicit" — every step states its mode.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 300 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions vertical slices, verification gates, TDD mode, checkpoints, and tracker handoff
- [ ] `.source` file lists superpowers/plan + historical execution sources + citypaul plan templates + harness:plan-review (was gstack/autoplan, vendored DEV-385)
- [ ] No companion hooks needed (process discipline)
- [ ] Plan template published in `packages/core/claude/skills/plan/TEMPLATE.md`
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/plan/` cover: plan-link-check, missing-verification-gate detection, missing-handoff detection, missing-spec-frontmatter detection
- [ ] No overlap > 30% with `brainstorm` (this skill = sequence; brainstorm = design)
- [ ] No overlap > 30% with `plan-review` (this skill = author; plan-review = review)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **Plan template location**: in `packages/core/claude/skills/plan/TEMPLATE.md` (skill-local) vs `templates/plan-template.md` (top-level). Lean skill-local for self-containment.
- **Plan size cap**: should there be a soft cap (e.g., > 20 steps = decompose)? Lean yes, document as advisory rule. Refine after first 10 real plans.
- **Parallel hints**: should the execution table declare `parallelizable_with`, or are dependencies plus `backlog-autopilot` footprint analysis sufficient? Defer until measured ambiguity appears.
- **High-risk flag mechanics**: who sets `high_risk: true`? Lean: the author (during plan self-review). Document heuristics (payment, auth, prod data migration, security-sensitive code).

## gstack /spec vendoring (DEV-388, de-gstackification Vague 2)

**Integrated** the planning half of /spec: the **executability gate** (a plan is done only when an *unfamiliar* implementer or agent could execute it with **zero follow-up questions** — added as self-review item #7; this skill stated it qualitatively, now it is a walk-one-step-as-a-stranger check) and **MVP-cut-first** (the first vertical slice is the smallest version that delivers real value; grow from a shipping core). **Covered already** (not re-vendored): step structure, verification gates, TDD mode per step. The precision/grounding half of /spec (read-code-before-asking, the five why-questions) went to brainstorm, not here — authoring the plan is downstream of understanding the intent.
