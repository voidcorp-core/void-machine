---
skill: verify
status: reviewed
strategy: distill
target_loc: 200
phase: D
depends_on: []
composes_with: [every other skill]
matrix_row: plans/skill-decision-matrix.md#verify
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `verify`

## Need

Without `verify`, "task complete" claims are LLM hallucinations: the code typechecks but tests were not run; the tests pass but a new test was forgotten; the feature works in one viewport but not the other; the lint warning was silenced not fixed; the hook output was not observed. The completion claim and the actual state diverge silently, and the user discovers it during review or — worse — in prod. This skill is the final pre-flight checklist that converts "I believe it works" into "I have observed every relevant signal."

## Decision matrix anchor

- **Wins**: every "task complete" claim. Pre-flight checklist before reporting done
- **Loses to**: nothing — it is the final gate
- **Cannot decide**: what "complete" means functionally (the task defines that)
- **Composes with**: every other skill (runs after, validates their outputs)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| superpowers/verify | superpowers/skills | reviewed | kept as primary (checklist + observation discipline) |
| citypaul completion checklists | citypaul/.dotfiles | reviewed | partially kept (TS-strict checklist items) |
| Atul Gawande "The Checklist Manifesto" | book | reference | foundation (the principle: checklists prevent omissions even for experts) |
| NASA Power of Ten (informal: "if it cannot fail, document why") | https://web.eecs.umich.edu/~imarkov/10rules.pdf | reference | aligns with "skipping a check requires reason" |

## Adaptation strategy

`distill`. Slim skill, mostly a checklist with the discipline of "observed every signal, not assumed." Author for void-harness's specific signal set.

## What we keep (verbatim or near-verbatim)

- **The checklist is observed, not assumed** (superpowers): "tests pass" means *observed* passing after the last change — not "they passed earlier." If you changed code after the last test run, you run it again.
- **Skipping an item requires an explicit reason in the completion report** (superpowers): silent skipping is the bug class this skill exists to prevent. "Skipped Y because Z" is the only acceptable form.
- **The checklist is read at the end, item by item** (Gawande): not from memory. Even when you know it by heart, you read it. Cognitive load at "done" time is high; checklists offload to paper.

## What we adapt (the void-harness checklist)

Adapted for the void-harness skill set. Each item maps to a specific skill or hook:

| # | Item | Source / hook |
|---|---|---|
| 1 | Typecheck passes (`tsc --noEmit`) | `typescript-strict` + `tsc-noemit-precommit` hook |
| 2 | Tests pass (run AFTER last code change) | `tdd` + `testing` skills |
| 3 | Lint passes (Biome) | `pack-monorepo` config |
| 4 | Coverage acceptable (per `tdd` mode strict / souple / exploratory) | `tdd` skill |
| 5 | Hooks pass (pre-commit dry-run on staged set) | All hooks (`tdd-guard`, `tigerstyle-check`, `no-any-grep`, etc.) |
| 6 | UI changes verified in BOTH mobile and desktop viewports | `frontend-design` + `accessibility` |
| 7 | Observability hooks present for new business logic | `observability` skill |
| 8 | Security review check for any boundary / auth / secret change | `security-guidance` + gstack `/cso` |
| 9 | Documentation updated if any convention changed | `commit-discipline` "always say why" |
| 10 | Commit message includes the why (not just what) | `commit-discipline` |
| 11 | Review evidence block present in PR body (strict mode) | `code-review` |
| 12 | Spec / plan linked if work derives from one | `brainstorm` + `plan` |

Items #6, #7, #8 only fire when the change touches their domain.

## What we reject

- **"I'm sure it works" without observation**: rejected. Belief is not signal.
- **Skipping items because "they always pass"**: rejected. They always pass UNTIL they don't.
- **Completion claims in the middle of work**: rejected. Completion is the END state, not a milestone.
- **Auto-checked items via a single CLI command without the user seeing the output**: rejected. The user is the loop closer. The CLI produces signals; the user reads them.
- **"Done" without "what's next" when in a multi-step plan**: rejected. The plan's resume point is updated as part of completion.

## Hard rules surfaced by this skill

- **Checklist read at end of every task**. Enforced by: SKILL.md discipline + `code-review` flags PRs without evidence of the checklist run.
- **Skipped items have a stated reason**. Enforced by: SKILL.md discipline + `code-review`.
- **Tests observed passing AFTER the last code change**. Enforced by: SKILL.md + hook composition.
- **No completion claim in the middle of work**. Enforced by: SKILL.md discipline.
- **Plan resume point updated as part of completion**. Enforced by: SKILL.md + composition with `plan`.
- **In strict mode UI changes**: mobile AND desktop verified (per `frontend-design` mobile-first dual-quality invariant). Enforced by: SKILL.md + `viewport-screenshot-gate` hook (`frontend-design` skill).

## Modes — none

The checklist applies uniformly. In `tdd` souple / exploratory modes, items 4 (coverage) may relax per the tdd skill — but the verification still occurs and the relaxation is documented.

## Companion hooks

None directly. This skill composes with the existing hooks and skills.

## Composition with other skills

- **Runs LAST**, after all other skills have done their work.
- **With `tdd`**: items 2, 4 (tests + coverage) are tdd-mode-aware.
- **With `testing`**: item 2 includes "pristine output" criterion.
- **With `typescript-strict`**: item 1 (typecheck).
- **With `code-review`**: item 11 (review evidence block in PR body) — verification triggers code-review if not yet done.
- **With `commit-discipline`**: items 9, 10 — the completion handoff produces the "what done"; commit-discipline frames it for git.
- **With `plan`**: the plan's "Done" criteria feed this checklist; completion updates the plan's resume point.
- **With `frontend-design` + `accessibility`**: item 6 (mobile + desktop both verified).
- **With `observability`**: item 7 (logging / tracing present).
- **With `security-guidance`**: item 8 (boundary / auth / secret review).

## Anti-rules (what this skill MUST NOT do)

- MUST NOT define what "complete" means functionally — the task defines that.
- MUST NOT skip items silently. Skip = stated reason or fail.
- MUST NOT report completion in the middle of work.
- MUST NOT replace the actual signals with "looks fine" assertions.
- MUST NOT take the user out of the loop — the user sees the signals.

## Verification checklist for shipping THIS skill

- [ ] SKILL.md drafted at target ≤ 200 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions checklist + observed-not-assumed + final-gate as headline
- [ ] `.source` file lists superpowers + citypaul + Gawande
- [ ] No new hooks needed (composes with existing)
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/verify/` cover: middle-of-work completion-claim detection, missing-reason-for-skip detection, "tests pass" claim without recent test run (transcript analysis)
- [ ] No overlap > 30% with `code-review` (this skill = author-side final gate; code-review = reviewer-side pass)
- [ ] No overlap > 30% with `commit-discipline` (this skill = signals observed; commit-discipline = how to frame in git)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **CLI subcommand to run items 1–5 mechanically**: `npx @voidcorp/harness verify` could run typecheck + tests + hooks dry-run and report. Lean yes for Phase E. Saves the user one cognitive step. Still requires reading the output, not auto-claiming done.
- **Item #6 (mobile + desktop) mechanism**: lean to compose with `gstack` browse for the screenshots in a future iteration. Defer.
- **Documentation update detection (item #9)**: heuristic — if the diff touched files in `docs/` OR if any "convention" was introduced (regex on PR body). Lean: rely on `code-review` for now.

## gstack /ship vendoring (DEV-388, de-gstackification Vague 2)

**Integrated** the completion-verification half of /ship: the Plan-Completion Audit (classify every actionable item DONE/PARTIAL/NOT-DONE/CHANGED/UNVERIFIABLE against the diff), the honesty rule ("code that *handles* a deliverable is not the deliverable"), per-item confirmation for UNVERIFIABLE items (never a blanket "all done?"), and scope-drift flagging. Also sharpened "observed not assumed" with /ship's named rationalizations ("should work now"→run it, "trivial change"→trivial breaks prod). **Covered already** (not re-vendored): typecheck/tests/lint/hooks pass (the 12-item checklist). **Distinction preserved**: the checklist verifies the *build works*; the completion audit verifies *you built what was specified* — different subject, one skill.

## Development feedback (2026-10-21)

GitHub's documented event and concurrency semantics are distilled into a small
executable admission guard beside this skill. Drafts explicitly refuse admission;
readiness runs real validation on the same SHA. The portable workflow is an adoption
example, not an automatic project rewrite. Full checks remain before integration.
Rejected: skipped required jobs (success without tests), after-merge-only validation,
and a new check-publishing service. Existing local hooks and configured commands own
the fast iteration loop. Source URLs live in `.source` and `references/ci-feedback.md`.

## 2026-10-23: proportional delivery

Preserve the source principles while removing repeated approvals, proof duplication and optional
improvement loops; the owning boundaries and retained safeguards are recorded in
[Proportional delivery](../../PROPORTIONAL-DELIVERY.md). Actual TDD and required checks remain.


## Ticket usage recap (2026-10-23)

Reuse one informational mission usage recap at ticket end, owned by verify. Unknown telemetry
is explicit and never adds a delivery gate or per-edit loop. See `docs/TICKET-USAGE.md`.


## Explicit prospective usage (2026-10-23)

Coordinator-owned start/end linkage uses known source journals only. Lightweight native advice
may retain a distinct observed-start receipt after actual success; formal review stays separate.
No per-edit call, guessed identity, retrospective receipt or delivery gate. See `docs/TICKET-USAGE.md`.
