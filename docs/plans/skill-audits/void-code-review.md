---
skill: code-review
status: reviewed
strategy: distill + compose-gstack
target_loc: 350
phase: B
depends_on: []
composes_with: [tdd, typescript-strict, testing, refactor, security-guidance, observability, every other skill]
matrix_row: plans/skill-decision-matrix.md#code-review
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `code-review`

## Need

Without a structured review skill, "review my diff" produces style nits and maybe a bug — useful but shallow. An LLM agent asked to review code without a framework reads file-by-file, surfaces the first ten things it notices, and stops. `code-review` provides dimensions (correctness, tests, security, structure, readability, performance), an ordered checklist, two modes (strict gate vs souple feedback), and explicit composition with gstack (`/code-review`, `/codex review`) and the void-harness `doctrine-critic` agent.

## Decision matrix anchor

- **Wins**: pre-commit / pre-PR critical pass over a diff. Defects, missing tests, structure issues, security flags, perf regressions, accessibility regressions
- **Loses to**: `doctrine-critic` agent for the doctrine-conformance deep pass (composed). gstack `/cso` on security-specific concerns (composed). gstack `/codex review` for independent second opinion (composed)
- **Cannot decide**: whether to ship (user). Architecture changes outside the diff scope (escalate via comment, do not block)
- **Composes with**: `tdd` (verifies the cycle was respected), `typescript-strict` (verifies types), every hedge skill (flags missing observability / cost discipline / a11y / etc.)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| citypaul `pr-reviewer` skill | citypaul/.dotfiles | reviewed | kept (dimensions list, blocker vs nit distinction) |
| superpowers/requesting-code-review | superpowers/skills | reviewed | partially kept (how to REQUEST a useful review — flips the perspective) |
| superpowers/receiving-code-review | superpowers/skills | reviewed | partially kept (how to ABSORB review feedback) |
| gstack `/code-review` | gstack/skills | composed | wrapped — gstack does the diff analysis at effort levels low/medium/high/max/ultra; this skill orchestrates and adds the dimension checklist |
| gstack `/codex review` mode | gstack/skills | composed | wrapped — independent second-opinion pass |
| gstack `/review` (PR review) | gstack/skills | composed | wrapped at PR level (SQL safety, LLM trust boundary, structural issues) |
| Google "engineering practices" code review docs | https://google.github.io/eng-practices/review/reviewer/ | reviewed | kept (CL Size, Comments to leave, How to handle pushback) |

## Adaptation strategy

`distill` + `compose-gstack`. Distill citypaul's dimensions + Google's practices; compose gstack `/code-review` (high effort levels) and `/codex review` (second opinion) for actual diff analysis. The skill is a thin orchestration layer adding the dimension checklist and the blocker/nit policy.

## What we keep (verbatim or near-verbatim)

- **Six dimensions in order** (citypaul + Google): correctness → tests → security → structure → readability → performance. Order matters: a correctness issue blocks regardless of beautiful structure; a perf issue does not block if correctness + tests + security + structure are clean.
- **Blocker vs nit distinction** (Google): blockers MUST be fixed before merge. Nits are suggestions; the author decides. Marking is explicit (`BLOCKER:`, `NIT:`, `QUESTION:` prefixes in comments).
- **Review evidence in PR body** (citypaul): PR description includes a "Review evidence" block listing which dimensions were checked, which were passed, which were skipped (with reason), which were composed with agents.
- **CL Size discipline** (Google): a CL/PR larger than ~400 LOC is split or gets explicit justification. Why: review quality decays after that size threshold.
- **How to handle pushback** (Google): reviewer can have changed their mind based on author's response; reviewer can hold ground with a clear "why." But the author owns the code — reviewer suggests, author decides nits.
- **Pristine output gate** (superpowers): the code under review must produce no warnings, no `console.log`, no leaked rejections in test output. Pre-condition for any review pass.

## What we adapt

- **Two modes — `strict` (pre-PR) and `souple` (in-progress)**: strict mode runs all six dimensions, fails on any blocker, PR body MUST include the evidence block. Souple is in-progress feedback during work, dimensions checked at user discretion. Why: the same dimensions matter, but the gate intensity differs by phase.
- **Composition with gstack effort levels**: at strict mode, default to gstack `/code-review high`. If user asks for deep review, escalate to `/code-review ultra` (multi-agent cloud review). At souple mode, default to `/code-review low`. Why: matches the effort to the phase.
- **Composition with `/codex review` as second opinion**: at strict mode, optionally invoke `/codex review` for an independent pass. Disagreements between Claude and Codex are surfaced to user — not silently arbitrated. Why: leveraging two model families catches different bug classes; honesty about disagreement prevents false confidence.
- **Dimension-specific delegation** to specialized skills/agents:
  - `correctness` + `tests` → `tdd` (verify cycle evidence) + `testing` (verify test quality)
  - `security` → `security-guidance` skill + gstack `/cso` (`doctrine-critic` only flags trust-boundary code)
  - `structure` → `doctrine-critic` agent + `hexagonal-architecture` / `domain-driven-design`
  - `readability` → `typescript-strict` + Biome
  - `performance` → `benchmark` (gstack) for measured perf claims; this skill flags only obvious O(n²) inside loops, leaky reactive subscriptions, etc.
  Why: avoid this skill becoming a kitchen sink. It orchestrates dimension specialists.

## What we reject

- **"LGTM" reviews**: rejected. A review that does not list which dimensions were checked is not a review. Even "everything looks fine" requires the dimension list in the evidence block.
- **Review by file** (going file-by-file linearly): rejected as default. Review by dimension across the whole diff is more effective at catching cross-file issues (e.g., a service change without its repository update).
- **Bikeshedding gate**: rejected. The skill explicitly tells the reviewer (LLM or human) to flag style/naming as `NIT:` not `BLOCKER:`. Style is solved by Biome + `typescript-strict`, not by the reviewer's preference.
- **Architectural-rewrite suggestions in PR review**: rejected (with escalation path). If the diff reveals a structural problem larger than the diff, the reviewer adds a `QUESTION:` comment and suggests a follow-up issue, not a "rewrite this PR." Why: scope creep at review time tanks velocity.
- **Silent disagreement between Claude and Codex** when both are invoked: rejected. Disagreements are surfaced, not averaged.

## Hard rules surfaced by this skill

- **Every review in strict mode covers six dimensions in order**. Evidence in PR body. Enforced by: SKILL.md + `pre-PR-review-evidence` hook (warn if PR body lacks the evidence block).
- **Blockers MUST be fixed before merge; nits are suggestions**. Enforced by: SKILL.md + comment prefix convention + `code-review` orchestration.
- **CL Size > 400 LOC requires explicit split or justification**. Enforced by: SKILL.md + `large-cl-grep` hook (warn on PR opened with >400 LOC unless `large-cl-justification:` body marker present).
- **Pristine output before review begins**. No warnings, no leaked logs. Enforced by: pre-review checklist in the skill.
- **Reviewer suggests; author owns**. Nits respected. Pushback handled per Google practices.
- **Review composes with specialized agents, does not duplicate them**. Enforced by: dimension delegation table in SKILL.md.

## Modes

- **`strict`** — pre-PR before landing. All six dimensions checked. Blockers fail the review. PR description MUST include the evidence block. Composition with gstack `/code-review high` by default, escalation to `ultra` for high-stakes diffs. Auto-selected for: any PR targeting `main` / `develop` / release branches.
- **`souple`** — in-progress feedback during work. Dimensions checked at user discretion. No evidence block required. Composition with gstack `/code-review low` or `medium`. Auto-selected for: WIP commits on feature branches, intra-session reviews.

## Companion hooks

- **`pre-PR-review-evidence`** (pre-push or PR template) — warn if PR body lacks the "Review evidence" block (dimensions covered, blockers, nits, composed agents). ≤ 40 LOC. Could also be implemented as a PR template that prompts for the block.
- **`large-cl-grep`** (pre-push) — warn if PR contains > 400 LOC of diff without a `large-cl-justification:` marker in the PR body. ≤ 30 LOC.
- **`blocker-prefix-grep`** (post-review) — informational: count BLOCKER vs NIT comments in the review for the PR evidence section. ≤ 30 LOC.

## Composition with other skills and agents

- **With `doctrine-critic` agent**: at strict mode, delegate the doctrine-conformance deep pass to the agent (it uses this skill's checklist + dimensions, and judges the `structure` dimension when the diff crosses boundaries). It flags trust-boundary code and routes security to gstack `/cso`; line-level bugs route to gstack `/code-review`.
- **With gstack `/code-review`**: this skill orchestrates; `/code-review` does the actual diff analysis at the chosen effort level. The skill picks the effort level based on mode + risk.
- **With gstack `/codex review`**: optional second opinion in strict mode. The skill surfaces Claude vs Codex disagreements explicitly.
- **With `tdd`**: verifies the strict-mode evidence (RED-GREEN cycle in commit history, or documented exception in PR body).
- **With `testing`**: flags weak test names, business mocks, snapshot creep.
- **With `typescript-strict`**: flags `any`, `as` casts, untyped IDs.
- **With every hedge skill**: dimension-specific flags (missing observability hooks, missing migration safety check, missing a11y verification, missing LLM cost rule).

## Anti-rules (what this skill MUST NOT do)

- MUST NOT decide whether to ship — user owns the merge decision.
- MUST NOT block on style / naming (those are `typescript-strict` + Biome jobs).
- MUST NOT suggest scope expansion ("rewrite this differently") inside a PR — escalate to follow-up issue.
- MUST NOT duplicate `doctrine-critic` or gstack `/cso` work — delegate.
- MUST NOT silently arbitrate disagreements between Claude and Codex — surface them.
- MUST NOT mark style nit as BLOCKER.
- MUST NOT pass a review when test suite has not been observed passing on the PR's HEAD.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 350 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions six dimensions + two modes + gstack composition
- [ ] `.source` file lists citypaul/pr-reviewer + superpowers requesting/receiving + Google eng-practices + gstack composed commands
- [ ] Hooks drafted: `pre-PR-review-evidence`, `large-cl-grep`, `blocker-prefix-grep` — each ≤ 100 LOC, smoke-tested
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/code-review/` cover: missing evidence block warning, large-CL warning, blocker vs nit detection, dimension delegation routing
- [ ] No overlap > 30% with `doctrine-critic` agent (skill orchestrates, agent executes deep)
- [ ] No overlap > 30% with gstack `/code-review` (skill is the discipline + composition; gstack is the diff analyzer)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor (Codex uses `/codex review` natively, terminology adjusted)
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## 2026-07-10 — tool repoint off gstack (DEV-399, unblocks DEV-395 teardown)

The skill framework was always harness-native, but its enumeration engine composed gstack `/code-review` and its second opinion composed gstack `/codex review`. The gstack teardown inventory (DEV-395) flagged these as live dependencies. Repointed both:

- **Enumeration → Claude Code's native `/code-review`** (low/medium/high/max/ultra, `--comment`/`--fix`). A 1:1 replacement — the native command post-dates the skill's authoring; no capability lost, one less external dependency.
- **Second opinion → the standalone `codex` CLI** (`~/.local/bin/codex`, v0.142.5). Decision: KEEP the cross-model second opinion (its whole value is a *different model family* catching different bug classes) but source it from the CLI directly, not the gstack wrapper. Credible alternatives rejected: (a) drop the second opinion entirely — loses cross-model coverage; (b) use native `/code-review ultra` as the "independent" pass — still Claude family, not cross-model. The codex CLI is installed standalone and survives the teardown, so the capability is preserved gstack-free.

Left for sibling tickets (ticket-boundary discipline): `/benchmark` (perf, lines 24/107) → DEV-401; `/ship` (line 172) → DEV-400. Those gstack refs are intentionally still present here.

## Open questions

- **PR template enforcement**: pre-push hook warning vs `.github/pull_request_template.md` with the evidence block scaffolded vs both. Lean both.
- **Default effort level mapping**: `strict` mode → `/code-review high` or `medium`? Lean `medium` by default (catches the common bugs without ultra cost), with `ultra` reserved for explicit user request on high-stakes PRs.
- **Codex disagreement surface format**: a dedicated section in the evidence block listing Claude-vs-Codex deltas. Format TBD; defer to first 5 real Codex composed reviews.
- **`doctrine-critic` agent trigger**: heuristic for "diff crosses architectural boundary" — file count > 5 in different packages? new export in a port file? Defer mechanics to Phase D.
- **Solo-author reviewer**: how does this skill behave when the author IS the reviewer (solopreneur)? It still runs the dimensions + checks; the human-in-the-loop is the same human. Lean: no special-case, but the SKILL.md mentions that strict mode on your own PR is valuable precisely because the LLM reviewer is the "second pair of eyes."
- **Review caching**: rerunning the review on the same SHA after no new commits — should it skip the analysis or re-confirm? Lean re-confirm with a fast path that checks if `gstack /code-review` cache is valid for the SHA. Defer mechanics.

## 2026-10-23: proportional delivery

Align the existing standard with the owning workflow, preserving its technical protection while
removing repeated or pattern-only obligations. See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
