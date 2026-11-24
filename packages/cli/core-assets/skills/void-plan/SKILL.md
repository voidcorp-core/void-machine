---
name: void-plan
description: Turn an approved spec into vertical slices with dependencies, TDD mode, verification gates, checkpoints, and a tracker handoff. Use after brainstorm approves a spec.
---

# plan — voidcorp craftsman edition

The spec answers "what should we build." This skill answers "in what order, with what gates, and how later sessions recover the work." Plans live on disk. Every implementation step declares its TDD mode. Verification gates between steps prevent regressions.

**Attribution**: see `.source`. Primary source: superpowers/plan, adapted for void-machine.

---

## Delegated investigation

Invoke `void-orchestrate` for independent dependency, codebase or verification
investigations that inform the plan. The coordinator integrates the results into
one dependency graph and retains scope, sequencing and approval decisions; agents
do not independently approve plans or start implementation.

## When to invoke

Use when approved work has dependencies, several units or continuity needs worth recording. A bounded request with clear acceptance criteria can go directly to `void-implement`; a plan is not required merely because code will change.

**A `source: forge` spec is a ready spec.** When `docs/specs/YYYY-MM-DD-<slug>.md` carries `source: forge` in its frontmatter (the forge→harness artifact contract), consume it **directly** — it already holds the 18 recon variables, the winning design, and the critique verdict, so `void-brainstorm` need not have run. Plan from it as-is; if it is partial (missing critique, or a field absent in an older `forge_version`), plan around the holes and flag them as the first open decisions rather than re-deriving the whole thing.

Use the approved spec or explicit user request as the source. If a material design choice is missing, resolve that choice with `void-brainstorm`; do not restart settled discovery.

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
- **Verification gate**: <what must pass before moving to step N+1>
- **Expected change**: one logical, bisectable commit or dependency-ordered commits; RED/GREEN evidence is retained independently of commit boundaries
- **Notes**: <constraints, gotchas, hook implications>
```

### Testing strategy

Apply `void-tdd` from the actual change and explicit project requirements. Record material
strategy or exceptions only; a missing per-step mode label does not make a plan incomplete.

### Verification gate

Each step's gate states which checks must pass before moving on. Examples:

- `tsc --noEmit && vitest run --filter checkoutCart`
- the project's configured lint command for the affected code and tests
- mutation checks when explicitly required or needed to resolve concrete test-strength uncertainty

The gate is observable. The user sees the output before the next step begins.

---

## Prefer small verifiable slices

Prefer end-to-end feature slices that expose integration errors early. Bounded preparatory
refactors, infrastructure work and compatible migration stages are useful steps when the accepted
scope needs them. Verify contracts early and finish migration cleanup; do not invent UI work or
speculative foundations just to make every step cross every layer.

## Review checkpoints

Continue authorized execution with progress updates and incremental verification. Pause for an
explicit human hold, a decision beyond the mandate, `void-learn` approval or protected deployment
promotion. Step count alone never creates a human pause; preserve existing explicit holds.

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
units and dependency relations, it places them in the native project and milestone, reads back
membership and links this approved plan from the milestone. The provider owns current state and
readiness; config owns explicit authority and checkpoint Planned work carries mutable intentions.

---

## Plan self-review

After writing the plan, scan for:

1. **Placeholders** — any TBD / TODO / vague steps? Fix.
2. **Missing verification gates** — every step has one? Fix.
4. **Unrealistic dependencies** — does step N actually need step N-1, or could they parallelize?
5. **Missing execution handoff** — a standalone plan has a correct resume point; a tracker-backed program has the complete stable order/dependency table?
6. **Source of authority** — links to the approved spec when present, otherwise records the explicit request?
7. **Executability gate** (vendored from gstack `/spec`) — can an unfamiliar implementer understand the goal, constraints, dependencies and observable acceptance? Resolve consequential ambiguity; routine implementation choices and investigation stay with the writer.

Fix inline. Then user-review gate.

---

## User-review gate

For already authorized scope, do not request approval again for the plan's formatting or routine
sequencing. Link the plan and proceed. Ask only for a new consequential choice, expanded scope
or declared human gate; continue independent authorized work while it is unresolved.
---

## Transition to execution

After plan approval, transition to:

- **`void-ticket`** when the plan becomes multiple provider-native units. It writes native dependencies and milestone membership after the pool is approved.
- **`void-implement`** for a named single ticket or standalone implementation unit.
- **`void-autopilot`** only when the user requests its attended independent-ticket flow.

Later sessions read the complete checkpoint, explicit config authority and the native milestone
plan link, then reconcile provider and worker observations. A changed planned list grants no
permission and does not rewrite remote progress.

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

- **Upstream**: the approved `void-brainstorm` spec or explicit complete user request supplies scope.
- **Downstream — `void-ticket`**: converts a multi-ticket plan into native tracker items and installs its active handoff.
- **Downstream — `void-implement`**: executes one complete ticket and maintains its tracker lifecycle.
- **With `void-autopilot`**: drains independent ready tickets only through its attended flow.
- **With `void-tdd`**: execution applies the discipline; the plan records material testing choices.
- **With `void-code-review`**: review checkpoints declared in the plan are honored.
- **With `void-verify`**: the plan's "Done" criteria feed the completion checklist.
- **With `void-plan-review`**: optional multi-lens review for high-risk plans (downstream of this skill, upstream of implementation).
- **With `void-commit-discipline`**: each step states the expected conventional-commit message.

---

## Anti-rules

- MUST NOT invent scope beyond the approved spec or explicit request.
- MUST NOT skip verification gates per step.
- MUST NOT omit the applicable execution handoff: resume point for standalone work, tracker table for a multi-ticket program.
- MUST NOT omit the source of authority: link the spec when present, otherwise record the explicit request.
- MUST NOT execute the plan (downstream skills do that).

---

## Final rule

```
Approved scope → useful sequence → self-review → resolve only new decisions → ticket or implement.
Otherwise → it is not voidcorp plan.
```

The plan is the contract between sessions and between agent and user. Make it explicit.
