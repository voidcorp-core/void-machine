---
name: void-verify
description: Final pre-flight checklist. Twelve items observed (not assumed) — typecheck, tests, hooks, mobile+desktop, commit why, review evidence. Skipping requires reason. Use at end of every task.
---

# verify — voidcorp craftsman edition

"Task complete" claims diverge from reality when they are based on belief, not observation. Tests "passed earlier." Lint "should be clean." The mobile view "is probably fine." This skill is the final pre-flight: a twelve-item checklist, read at the end, each item OBSERVED, skipping documented.

**Attribution**: see `.source`. Primary source: superpowers/verify + citypaul completion checklists.

---

## When to run

At the end of EVERY task before reporting "done." Even tasks that feel trivial. The checklist for a one-line fix is short; the discipline is the same.

If you find yourself wanting to skip the checklist "because it's a small change," that is the signal: run it anyway, the small ones are where it pays the most.

---

## Local development and integration

During development, run the smallest meaningful configured test command against the
changed behavior, plus affected types and local hooks. Keep the PR in draft; do not
wait for full remote CI after each edit or commit. Fresh local evidence still gates
claims about the behavior tested. `commands.testUnit` and `commands.typecheck` in
`.void/config.json` describe project commands; preserve their argv.

When the candidate is committed and independently reviewed, run the applicable final
checks below and mark the PR ready. Wait for real required CI on that head and, if
configured, the merge group before integration. Local success cannot replace a required
server check. Returning to draft cancels obsolete PR work without resetting reviews.

For an explicitly requested CI setup or optimization, use the installed
[executable admission guard and workflow template](references/ci-feedback.md).
They defer draft validation with an explicit non-success outcome, rerun on readiness,
and preserve merge queue checks. Never install them or change remote protection merely
because this skill was invoked.

## The checklist

Read item by item. Do not run from memory. Each item is OBSERVED, not assumed.

| # | Item | Composed with |
|---|---|---|
| 1 | Typecheck passes (`tsc --noEmit`) | `void-typescript-strict` + `tsc-noemit-precommit` hook |
| 2 | Tests pass — **observed after last code change** | `void-tdd` + `void-testing` |
| 3 | Lint passes (Biome) | `pack-monorepo` config |
| 4 | Coverage acceptable (per `void-tdd` mode strict / souple / exploratory) | `void-tdd` |
| 5 | Hooks pass (pre-commit dry-run on staged set) | All hooks (`tdd-guard`, `tigerstyle-check`, `no-any-grep`, ...) |
| 6 | UI changes verified in BOTH mobile and desktop viewports | `void-frontend-design` + `void-accessibility` (mobile-first dual-quality) |
| 7 | Observability hooks present for new business logic | `void-observability` |
| 8 | Security review check for any boundary / auth / secret change | `void-security-guidance` + `void-security-audit` |
| 9 | Documentation updated if any convention changed | `void-commit-discipline` "always say why" |
| 10 | Commit message includes the why (not just what) | `void-commit-discipline` |
| 11 | Independent review ran on the final change with no demonstrated blocking defect left open; review evidence block present in PR body (strict mode). A missing citation or explanation alone never fails this item | `void-code-review` |
| 12 | Spec / plan linked if work derives from one; plan resume point updated | `void-brainstorm` + `void-plan` |

Items 6, 7, 8 only fire when the change touches their domain.

---

## Observed, not assumed

| Sign | What it means |
|---|---|
| "Tests should pass" | NOT observed. Run them again, then check. |
| "Linting was fine earlier" | Not observed since last change. Re-run. |
| "Mobile is probably the same" | NOT observed. Screenshot via `void-qa` (claude-in-chrome) on a phone viewport. |
| "Sentry is set up, so observability is handled" | NOT for this code path. Did you add the breadcrumb? The log? |
| "The hook ran before, why check" | Did you edit since? If yes, run again. |

"Should" and "probably" are the words this skill exists to eliminate. The named excuses (vendored from gstack `/ship`): "should work now" → run it; "I'm confident" → confidence is not evidence; "trivial change" → trivial changes break prod. If code changed since the last run, the last run is stale.

---

## Plan completion audit (vendored from gstack `/ship`)

The 12-item checklist verifies *the build works*. This verifies *you built what was specified*. When the work derives from a plan or ticket, classify **every actionable item** against the diff:

- `DONE` / `PARTIAL` / `NOT DONE` / `CHANGED` (deliberately deviated) / `UNVERIFIABLE` (cannot be proven from the diff — cross-repo, external state, runtime-only).
- **Honesty rule**: code that *handles* a deliverable is not the deliverable. "Added the webhook handler" ≠ "the webhook fires end-to-end."
- **Per-item confirmation for `UNVERIFIABLE`**: surface each one individually and ask — never a single blanket "all done?" over a list you cannot actually verify.
- **Scope drift**: did you build exactly what was asked? Name every piece of creep ("while I was in there…") and every missing requirement. **Creep is removed, or it carries one line in the commit saying why the change would be wrong without it.** This check was informational for its whole life and caught nothing: naming a creep and shipping it anyway satisfied it. Measured on 2026-08-31, in the session that hardened this very skill — a marker scaffold no gate had asked for, defensible, and nothing would have made anyone say so. Stop when the requirement is satisfied; the smallest sufficient change is the deliverable, not the floor.

---

## Skipping items

Items can be skipped, but ONLY with an explicit stated reason in the completion report.

```markdown
- [x] Item 1: Typecheck passes (observed)
- [x] Item 2: Tests pass (observed, vitest run, 4/4 passing)
- [-] Item 6: UI viewports SKIPPED — no UI change in this diff
- [-] Item 7: Observability SKIPPED — pure refactor (no new business logic)
- [x] Item 9: Documentation N/A — no convention changed
- [x] Item 10: Commit message includes why (linked to spec)
- [x] Item 11: Review evidence block written
- [x] Item 12: Plan resume point updated (next step: 5)
```

Silent skipping is the bug class this skill exists to prevent. Explicit skip with reason is fine; explicit skip without reason is not.

---

## Output format

When reporting "done," include the checklist with check / skip status and the reason for any skip. The user sees the signals.

For multi-step plans (composes with `void-plan`): update the plan's "Resume point" section with the completed step.

For PRs (composes with `void-code-review`): the checklist feeds the Review Evidence block — they are not separate work.

---

## Examples

### Small fix

```markdown
Done. Verification:

1. ✅ Typecheck (observed)
2. ✅ Tests pass (vitest run, 1 new test for the bug, all green)
3. ✅ Lint passes
4. ✅ Coverage holds (line + branch unchanged)
5. ✅ Pre-commit hooks (tdd-guard allowed test+fix pair, others green)
6. — N/A (no UI)
7. — N/A (no new business logic)
8. — N/A (no boundary change)
9. — N/A (no convention change)
10. ✅ Commit messages: `test: reproduce X` + `fix: <root cause>`
11. ✅ Review evidence block written (single-blocker resolved, 0 nits)
12. ✅ Spec linked (plan N/A — bug fix, no plan)
```

### Plan step

```markdown
Step 4 of plan `2026-06-01-checkout-flow-plan.md` complete. Verification:

1. ✅ Typecheck (observed)
2. ✅ Tests pass (vitest run --filter checkoutCart, 6/6 passing, mutation 96%)
3. ✅ Lint passes
4. ✅ Coverage 100% on services/checkout (strict mode)
5. ✅ Pre-commit hooks all pass
6. — N/A (use-case layer, not UI)
7. ✅ Observability: structured logs added at use-case entry/exit
8. ✅ Security: zod validation at boundary, no secret in commit
9. ✅ docs/DOMAIN.md updated with "checkout intent" term
10. ✅ Commits: test:reproduce / feat:implement / refactor:extract per Two-Hat
11. ✅ Review evidence block prepared (waiting for code-review run)
12. ✅ Plan resume point updated to Step 5

Next: invoke `void-code-review` for the Step 4 commits.
```

---

## Composition with other skills

- **Runs LAST**, after every other skill.
- **With `void-tdd`**: items 2, 4 are tdd-mode-aware.
- **With `void-testing`**: item 2 includes "pristine output."
- **With `void-typescript-strict`**: item 1.
- **With `void-code-review`**: item 11 feeds the Review Evidence block.
- **With `void-commit-discipline`**: items 9, 10.
- **With `void-plan`**: item 12 — completion updates the plan resume point.
- **With `void-frontend-design` + `void-accessibility`**: item 6.
- **With `void-observability`**: item 7.
- **With `void-security-guidance`**: item 8.

---

## Anti-rules

- MUST NOT define what "complete" means functionally — the task defines that.
- MUST NOT skip items silently.
- MUST NOT report completion in the middle of work (e.g., "Step 1 done, moving to Step 2" without verifying Step 1).
- MUST NOT substitute "looks fine" for observed signals.
- MUST NOT take the user out of the loop — the user sees the signals.

---

## Final rule

```
Task → all 12 items observed (or skip with stated reason) → user sees the signals → THEN report "done."
Otherwise → it is not voidcorp completion.
```

Checklists prevent omissions even for experts. The discipline pays for itself the first time it catches the test that "should have" been run.

## Bounded review evidence

Use the review receipt from `void-implement`: exact commit and base, acceptance criteria,
independent reviewer, conclusions, proofs and blocking-defect resolutions. A mutable worktree
alone is insufficient. Reuse unaffected evidence after correction and verify the affected
behavior only; do not trigger another general panel. Native runtime identity absence or refusal
is an explicit provenance limitation, not an extra certification gate. Actual independence and
valid evidence remain required. An unresolved blocking defect prevents completion.
