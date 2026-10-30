---
skill: debug
status: reviewed
strategy: compose-gstack + distill
target_loc: 250
phase: D
depends_on: [tdd, observability]
composes_with: [code-review, refactor]
matrix_row: plans/skill-decision-matrix.md#debug
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `debug`

## Need

Without `debug`, an LLM agent applies the first plausible fix and ships it. The root cause stays buried; the bug recurs in a different shape three sprints later; the fix becomes the "we don't really understand it" comment in the code. `debug` enforces the Iron Law: no fix without root cause + a failing test that reproduces the bug.

## Decision matrix anchor

- **Wins**: any bug, test failure, unexpected behavior. Root-cause investigation before fix
- **Loses to**: `migrations` on migration-specific failures (different discipline). `observability` on missing-logs cases (fix visibility first, then debug)
- **Cannot decide**: whether to ship a fix without root cause (Iron Law: no). The fix itself (delegates to `tdd`)
- **Composes with**: `tdd` (write the failing test that reproduces, then fix), `code-review` (review the root-cause analysis in the PR), `refactor` (sometimes the bug is structural and surfaces in refactor)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| gstack `/investigate` | gstack/skills | reviewed | kept as primary mechanism (4 phases: investigate → analyze → hypothesize → implement, Iron Law) |
| superpowers/debug | superpowers/skills | reviewed | composed (similar discipline; cross-reference for the psychological anti-drift) |
| "5 Whys" (Toyota, Taiichi Ohno) | various | reference | kept (the questioning loop fits the analyze phase) |
| Brian Kernighan "Practice of Programming" debugging chapter | book | reference | reference (mental model: rubber duck, narrow the search space) |
| Julia Evans "Debugging" zine + blog | https://jvns.ca | reference | reference (specific tactical tips for system debugging) |

## Adaptation strategy

`compose-gstack` + `distill`. Wrap gstack `/investigate` as the primary mechanism (it implements the 4-phase discipline well). Add void-harness-specific composition: enforce TDD-style failing test reproducing the bug before any fix lands, and require the root-cause analysis in the fix PR.

## What we keep (verbatim or near-verbatim)

- **Four phases mandatory** (gstack `/investigate`): investigate (gather evidence) → analyze (find the pattern) → hypothesize (testable theory) → implement (fix + verify). Each phase has explicit deliverables; skipping phases is the #1 source of drift.
- **Iron Law**: no fix without root cause identified AND a failing test reproducing the bug. "It works now" is not a root cause. Suspect cosmic-ray fixes.
- **Bug fix commit pairs**: `test: reproduce <bug description>` THEN `fix: <root cause description>`. Never combined. Composes with `commit-discipline` (always say why).
- **Investigation evidence captured in the bug's tracker / PR body, not just conversation**: conversations evaporate. The evidence persists. Composes with `code-review` (PR body includes root-cause analysis).
- **5 Whys loop** (Toyota): for non-obvious bugs, ask "why" 3–5 times until you stop hitting symptoms and reach a root cause. Document the chain in the PR.
- **Narrow the search space** (Kernighan): binary-search the timeline (last working commit?), the code (which module?), the input (which value class?), and the environment (which user / region / browser?). Each narrowing produces a smaller hypothesis space.

## What we adapt

- **Failing test FIRST, even for "obvious" fixes**: the test exists before the fix. The test fails on `main`. The fix lands; the test passes. This is the regression guarantee. Without it, the same bug recurs under a different name in 3 months. Why: most "obvious" fixes are wrong on the second look.
- **Root-cause analysis required in PR body**: every bug-fix PR includes a `## Root cause` section in the body. Format: symptom → narrowing steps → root cause → fix → prevention. Why: persists the reasoning for `git blame` archaeology.
- **Composition with `observability` upstream**: if the root cause is "we cannot see what happened in prod," the FIRST fix is to add the observability (structured logs, breadcrumbs, traces) — THEN debug. Don't guess in the dark. Why: guessing produces "fixes" that may move the bug rather than solve it.
- **Composition with `tdd` for the fix itself**: the reproducing test gets added in `strict` mode (Iron Law). The fix follows the cycle. Why: the bug fix is itself new behavior; treat it as such.
- **Composition with `doctrine-critic` agent for structural bugs**: if the root cause is "the architecture allows this state to exist," the fix is structural — invoke the `doctrine-critic` agent to judge the structural root before the refactor. Why: papering over structural rot creates more bugs of the same kind.

## What we reject

- **"It works now" as a closing statement**: rejected. If the developer cannot explain why the fix works, the bug is not fixed — its symptoms are temporarily hidden. The investigation continues.
- **Fix-without-test for "trivial" bugs**: rejected. Even a one-character fix gets a regression test. The bug existed because the test did not exist; that gap is the artifact, not the fix.
- **Skipping the analyze phase**: rejected. Going straight from observation to hypothesis is the #1 source of bad fixes.
- **Single-shot debugging via "just retry until green"**: rejected. Test flakes are themselves bugs (timing assumption, shared state, non-determinism). Investigate them via this skill, do not retry-loop.
- **Fixes that change unrelated code "while we are here"**: rejected. The fix PR contains the fix and nothing else (composes with `refactor`'s Two-Hat principle).

## Hard rules surfaced by this skill

- **Four phases mandatory**: investigate → analyze → hypothesize → implement. Skipping any phase is a Red Flag.
- **Iron Law: no fix without a failing test reproducing the bug**. Enforced by: SKILL.md + `tdd-guard` hook + `code-review` checks for the reproducing test in the PR.
- **Bug fix commit pairs** (`test:` then `fix:`). Enforced by: SKILL.md + `code-review` flags single-commit "fix" PRs.
- **Root-cause section in PR body**. Enforced by: SKILL.md + `code-review` flags absence of the section.
- **No "fix" without an explanation that survives scrutiny**. Enforced by: SKILL.md + `code-review`.
- **Observability first if visibility is the gap**. Enforced by: SKILL.md guidance + composition checklist.

## Modes — none

The four-phase discipline applies uniformly. The depth scales to bug severity (a typo bug may have a 30-second investigation; a data-corruption bug warrants hours). The phases are non-negotiable.

## Companion hooks

None directly. The discipline is enforced via:
- `tdd-guard` (already exists) — blocks fix code without the reproducing test in the same staged set
- `code-review` skill — flags missing root-cause section in fix PRs

## Composition with other skills

- **Upstream — `observability`**: if we cannot see what happened, fix the visibility first.
- **Downstream — `tdd`**: the reproducing test is written in strict mode; the fix follows the cycle.
- **With `code-review`**: PR body includes the root-cause analysis. The reviewer verifies the test reproduces the bug before the fix.
- **With `refactor`**: when the root cause is structural, the fix is a refactor — composes with refactor's Two-Hat principle. The Tidying (refactor) and the Behavior Change (fix) commit separately.
- **With `doctrine-critic` agent**: for structural roots that affect multiple bugs of the same kind.
- **With `commit-discipline`**: `fix:` commits include the "why" (root cause description).

## Anti-rules (what this skill MUST NOT do)

- MUST NOT close a bug without a root cause that the developer can explain.
- MUST NOT allow "I will add the test later" — the test exists before or alongside the fix.
- MUST NOT permit retry-until-green for flaky tests; investigate the flake itself.
- MUST NOT silently widen the scope of the fix PR (Two-Hat principle).
- MUST NOT skip observability when the root cause is visibility.
- MUST NOT defer to `migrations` for non-migration bugs (each has its niche).

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 250 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions four phases + Iron Law + bug-fix commit pair as headline
- [ ] `.source` file lists gstack/investigate + superpowers/debug + 5 Whys + Kernighan + Julia Evans
- [ ] No new companion hooks needed (composed with existing tdd-guard + code-review)
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/debug/` cover: missing-reproducing-test detection, missing-root-cause-section detection, retry-loop detection (commit message pattern)
- [ ] No overlap > 30% with `tdd` (this skill = root cause; tdd = the fix discipline)
- [ ] No overlap > 30% with gstack `/investigate` (this skill = composition + harness rules; investigate = the 4-phase mechanism)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **Root-cause section template** in PR body: provide a `pull_request_template.md` snippet via `voidcorp-harness init`. Lean yes.
- **Composition with `/codex` consult mode**: for hard bugs, second-opinion via Codex on the root-cause hypothesis. Document as optional pattern; lean optional.
- **Flake bug discipline**: an entire sub-discipline ("flake debugging") could live as a section here or as a separate skill. Lean section in this skill; reassess after first 10 flakes.
- **Production-only bugs**: when reproduction requires production data, document anonymization patterns + sandbox-replay approach. Lean: brief section in SKILL.md with reference to `observability` for sampling.

## gstack /investigate vendoring (DEV-388, de-gstackification Vague 2)

/investigate shares this skill's superpowers lineage — it was **~85-90% already covered** (the four phases, root-cause-first Iron Law, regression-test-fails-without/passes-with, minimal diff, fresh verification). This is a documented-rejection case: the bulk was **deliberately NOT re-vendored** (cited as such, not duplicated). **Integrated** only the surgical deltas the skill lacked: the Pattern-Analysis lookup table (race/nil/state-corruption/integration/config-drift, each with signature + where-to-look), the 3-strike rule (3 failed hypotheses → treat as architectural), the blast-radius gate (>5 files → stop and ask), instrument-to-confirm-before-editing, recurring-bug-is-an-architectural-smell (`git log` the file for prior fixes), and the red-flags list. **Attribution corrected**: /investigate moves from "composed with" to "fully vendored".

## 2026-10-23: proportional delivery

Preserve the source principles while removing repeated approvals, proof duplication and optional
improvement loops; the owning boundaries and retained safeguards are recorded in
[Proportional delivery](../../PROPORTIONAL-DELIVERY.md). Actual TDD and required checks remain.
