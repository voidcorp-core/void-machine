---
name: void-plan
description: Turn an approved spec into vertical slices with dependencies, TDD mode, verification gates, checkpoints, and a tracker handoff. Use after brainstorm approves a spec.
---

# plan — voidcorp craftsman edition

The spec answers "what should we build." This skill answers "in what order, with what gates, and how later sessions recover the work." Plans live on disk. Every implementation step declares its TDD mode. Verification gates between steps prevent regressions.

**Attribution**: see `.source`. Primary source: superpowers/plan, adapted for void-harness.

---

## When to invoke

Invoke immediately after `void-brainstorm` approves a spec. The plan is the next deliverable before any code.

**A `source: forge` spec is a ready spec.** When `docs/specs/YYYY-MM-DD-<slug>.md` carries `source: forge` in its frontmatter (the forge→harness artifact contract), consume it **directly** — it already holds the 18 recon variables, the winning design, and the critique verdict, so `void-brainstorm` need not have run. Plan from it as-is; if it is partial (missing critique, or a field absent in an older `forge_version`), plan around the holes and flag them as the first open decisions rather than re-deriving the whole thing.

Do NOT invoke without an approved spec. If you find yourself wanting to plan without a spec, that means brainstorm was skipped — go back.

---

## Plan structure

A plan is a markdown file at `docs/plans/YYYY-MM-DD-<topic>-plan.md`. Frontmatter:

```yaml
---
title: <topic>
date: YYYY-MM-DD
status: in-progress  # in-progress → executing → done
spec: docs/specs/YYYY-MM-DD-<topic>.md
ticket: <tracker id, once `void-ticket` has created it; leave empty until then>
author: <user> + Claude/Codex
high_risk: false  # set true if the plan touches payment, auth, prod data migration, security-sensitive code → triggers plan-review recommendation
---
```

Then sections:

1. **Goal** — one paragraph from the spec
2. **Steps** — numbered, each with the structure below
3. **Review checkpoints** — explicit points where the user reviews work-to-date
4. **Execution handoff** — dependency/order table for tracker-backed programs, or a resume point for a standalone sequential plan

---

## Step structure

Each implementation step has this shape:

```markdown
### Step N — <imperative subject>

- **Goal**: <one sentence>
- **Depends on**: [step-3, step-5] (or "none")
- **TDD mode**: strict | souple | exploratory
- **Verification gate**: <what must pass before moving to step N+1>
- **Expected commits**:
  - `test: <reproducing or new behavior>`
  - `feat: <implementation>` (or `fix:` / `refactor:` per `void-commit-discipline`)
- **Notes**: <constraints, gotchas, hook implications>
```

### TDD mode declaration

Every implementation step states its mode. Examples:

- **strict** — new business behavior, hotfix on payment surface, refactor that changes payment behavior
- **souple** — glue at integration boundary covered by higher-level test, framework wiring
- **exploratory** — spike, POC, throwaway script

The declared mode flows into `tdd-guard` enforcement at execution time. If mode is missing, the plan is incomplete.

### Verification gate

Each step's gate states which checks must pass before moving on. Examples:

- `tsc --noEmit && vitest run --filter checkoutCart`
- `pre-commit hooks dry-run on staged set` (composes with `tdd-guard`, `tigerstyle-check`, `no-any-grep`, etc.)
- `mutation testing score ≥ 90%` (strict mode steps with critical surface)

The gate is observable. The user sees the output before the next step begins.

---

## Vertical slices over horizontal phases

Slice the plan into **vertical tranches** that cut through every layer (UI → domain → persistence) and deliver one end-to-end testable behavior. Do NOT phase horizontally — "first the whole schema, then the whole API, then the whole UI."

Why vertical wins:

- A vertical slice is verifiable and mergeable on its own: it produces working, demonstrable value at each step.
- Horizontal phasing accumulates undeliverable work and hides integration errors until the final wiring step, exactly when they are most expensive to fix.
- Each slice exercises the seams between layers early, so contract mismatches surface in step 1, not step 8.

Prefer "checkout one item, end to end" then "checkout many items" over "all models, then all ports, then all UI." Each step in the plan should name the thin slice it ships.

**MVP-cut first** (vendored from gstack `/spec`): the first slice is the smallest version that delivers real value — name it explicitly, and defer everything not required to prove that value. The plan grows from a shipping core, not toward one.

---

## Review checkpoints

For non-trivial plans (≥ 5 steps), declare 1–2 explicit checkpoints where the user reviews work-to-date.

```markdown
### Checkpoint A — after Step 4

User reviews the domain layer (Steps 1–4) before proceeding to the adapters layer.

Stop here. Run `void-verify`. Wait for user signal to proceed.
```

Checkpoints prevent "I shipped 10 steps before you noticed step 3 was wrong."

---

## Resume point

Use this only for a standalone sequential plan that is not decomposed into tracker tickets. The execution skill updates it as steps complete. Format:

```markdown
## Resume point

**Next step**: Step 5 (Implement Stripe adapter)

**Completed**:
- ✅ Step 1: Domain models (commit `feat: domain Order + LineItem + Money`)
- ✅ Step 2: OrdersPort interface (commit `feat: OrdersPort port interface`)
- ✅ Step 3: In-memory adapter (commit `feat: in-memory OrdersAdapter for tests`)
- ✅ Step 4: checkoutCart use-case (commits `test:` + `feat:`)

**Pending**:
- ⏳ Step 5: Stripe adapter
- ⏳ Step 6: Server Action boundary
- ⏳ Step 7: UI Server Component
- ⏳ Step 8: E2E happy-path test
```

The next session reads the resume point and continues.

For a provider-backed multi-unit programme, do not maintain a second mutable next-step pointer in
the plan. Instead, add a final `Execution handoff` table that gives each plan unit a stable order
key, title, dependency keys, estimate, and human-gate flag. After `void-ticket` creates the native
units and dependency relations, it installs `.void/program.md`; the declared progress provider
then owns current state and readiness.

---

## Plan self-review

After writing the plan, scan for:

1. **Placeholders** — any TBD / TODO / vague steps? Fix.
2. **Missing verification gates** — every step has one? Fix.
3. **Missing TDD mode** — every implementation step declares one? Fix.
4. **Unrealistic dependencies** — does step N actually need step N-1, or could they parallelize?
5. **Missing execution handoff** — a standalone plan has a correct resume point; a tracker-backed program has the complete stable order/dependency table?
6. **Frontmatter `spec:`** — links back to the approved spec?
7. **Executability gate** (vendored from gstack `/spec`) — could an *unfamiliar* implementer or agent execute this plan with **zero follow-up questions**? Walk one step as if you'd never seen the codebase: is every file named, every metric quantified, every acceptance criterion observable? Any "figure it out at implementation time" is an ambiguity to resolve now.

Fix inline. Then user-review gate.

---

## User-review gate

Ask the user to review the plan before execution begins:

> "Plan written and committed to `docs/plans/<file>.md`. Please review and let me know if you want changes before we start executing."

Wait for response. If changes requested, make them and re-run self-review.

---

## Transition to execution

After plan approval, transition to:

- **`void-ticket`** when the plan becomes multiple provider-native units. It writes native dependencies and the programme descriptor after the pool is approved.
- **`void-implement`** for a named single ticket or standalone implementation unit.
- **`void-autopilot`** only when the user requests its attended independent-ticket flow.

For a provider-backed programme, later sessions recover work through `.void/program.md` and the
declared progress adapter; they do not mutate the plan or checkpoint to repoint the next unit.

---

## High-risk plans — plan-review recommendation

If `high_risk: true` in the frontmatter, recommend running `void-plan-review` (the `all` mode) after the plan is written but before execution begins.

`void-plan-review` critiques the plan through CEO / Eng / Design / DevEx lenses, auto-decides the mechanical calls and surfaces the taste calls for the user. It catches issues brainstorm may have missed. It proposes findings; this skill's author folds them in.

Set `high_risk: true` when the plan touches:

- Payment / billing surface
- Authentication / authorization changes
- Production data migration (composes with `void-migrations`)
- Security-sensitive code (secrets, auth tokens, PII)
- LLM call sites with user-controlled input (composes with `void-security-guidance` LLM section)

---

## Composition with other skills

- **Upstream — `void-brainstorm`**: the approved spec is the input.
- **Downstream — `void-ticket`**: converts a multi-ticket plan into native tracker items and installs its active handoff.
- **Downstream — `void-implement`**: executes one complete ticket and maintains its tracker lifecycle.
- **With `void-autopilot`**: drains independent ready tickets only through its attended flow.
- **With `void-tdd`**: per-step mode selection lives in the plan.
- **With `void-code-review`**: review checkpoints declared in the plan are honored.
- **With `void-verify`**: the plan's "Done" criteria feed the completion checklist.
- **With `void-plan-review`**: optional multi-lens review for high-risk plans (downstream of this skill, upstream of implementation).
- **With `void-commit-discipline`**: each step states the expected conventional-commit message.

---

## Anti-rules

- MUST NOT plan without an approved spec.
- MUST NOT skip TDD mode declaration per implementation step.
- MUST NOT skip verification gates per step.
- MUST NOT omit the applicable execution handoff: resume point for standalone work, tracker table for a multi-ticket program.
- MUST NOT skip the spec link in frontmatter.
- MUST NOT execute the plan (downstream skills do that).

---

## Final rule

```
Approved spec → plan written → self-review → user approves → ticket or implement.
Otherwise → it is not voidcorp plan.
```

The plan is the contract between sessions and between agent and user. Make it explicit.
