---
name: void-retrospective
description: "Periodic engineering retro over a window: read git log / PRs / .void, surface signals (hotspots, test ratio, commit types, regressions), turn them into improvement decisions feeding learn."
---

# retrospective — voidcorp craftsman edition

`void-learn` catches ONE lesson the moment it appears. This skill is the opposite cadence: a deliberate look back over a **window** (a week, a cycle, a sprint) to find the patterns no single moment surfaces — what the codebase's own history is telling you. It reads signals, turns them into concrete improvement decisions, and routes each durable pattern into `void-learn`.

Invoke it on a cadence ("weekly retro", "retro since the last release"). It reads and reports; it does not change code.

**Attribution**: see `.source`. Distilled from gstack `/retro` — the git-history signal methodology, with the quantified-self gamification (focus score, ship-of-the-week, streaks) deliberately dropped as out of craftsman scope.

---

## Data sources — agnostic and durable

Read only sources that survive any tool teardown. **Never** `~/.gstack/` or gstack telemetry.

- **git log** over the window: commits with author, timestamp, subject, files changed, insertions/deletions. The spine of the retro.
- **Conventional-commit types** parsed from subjects: `feat` / `fix` / `void-refactor` / `test` / `chore` / `docs`.
- **PRs** via `gh pr list --state merged --search "merged:>=<date>"` when a GitHub remote exists.
- **`.void/runs/*/events.jsonl`** (plus legacy logs when present): which skills actually fired.
- **Test vs production files**: classify changed paths (`test/`, `spec/`, `__tests__/`, `*.test.*`) to compute the test-to-prod ratio.

If a source is absent (no remote, no `.void/`), note it and proceed with what exists.

## Signals to compute (not scores)

Report each as an observation with the evidence, not a leaderboard number:

- **Commit-type mix** — the `feat`/`fix`/`void-refactor`/`test` ratio. A fix-heavy window points at a quality or root-cause gap; a zero-refactor window at accreting debt; a zero-test window at a discipline slip.
- **Hotspots** — the files changed most often. A file touched in many commits/PRs is either the active surface or a design pressure point.
- **Recurring-fix files** — files that received multiple `fix:` commits. Composes with `void-debug`: a file fixed three times is an architectural smell, not three coincidences.
- **Test-to-prod ratio** — production LOC changed vs test LOC changed. A ratio trending toward zero is the signal that matters most.
- **PR size distribution** — small vs large PRs. A window of large PRs points at insufficient vertical slicing (composes with `void-plan`).
- **Regressions** — `fix:` commits that reference a prior feature, or reverts. Each is a candidate for a "prevention" decision.

## Output — a report that ends in decisions

1. **Window summary** — dates, commit count, PR count, the signals above with their evidence (file:count, ratio, examples). Plain observations, no gamified ranking.
2. **Improvement decisions** — the point of the retro. For each signal that warrants action, state a concrete change: a test to add, a file to refactor, a hook to propose, a convention to adopt. Not a vague "do better."
3. **Route each durable pattern to `void-learn`** — a decision that generalizes ("this class of bug keeps recurring in the adapter layer") is captured as a lesson, HITL. The retro surfaces the pattern; `void-learn` decides where it belongs and writes it (with confirmation). The retro itself writes nothing into doctrine.

## Rejected — gstack gamification (documented)

Deliberately NOT vendored: the **focus score**, **ship-of-the-week**, **personal/team streaks**, and the week-over-week trend leaderboard. These are quantified-self productivity gamification, not craftsman doctrine — they optimize a number, not the code. The signal methodology (what the git history reveals) is kept; the scoring/ranking apparatus is dropped.

## Composition & boundaries

- **Feeds `void-learn`** — the retro is a *discovery* pass over a window; `void-learn` is the *capture* of one lesson. Different subject, different cadence (window vs point). The retro routes patterns to it, never duplicates its HITL write.
- **With `void-debug`** — the recurring-fix-file signal is that skill's "recurring bug = architectural smell" seen at the window scale.
- **With `void-plan`** — a large-PR window is a slicing signal; the fix is smaller vertical slices.
- **Live/visual dashboards** — deferred; this skill produces a text report. Any richer visualization is out of scope.

## Anti-rules

- MUST NOT depend on `~/.gstack/` or any gstack telemetry (it disappears at teardown).
- MUST NOT reintroduce the gamification (focus score, ship-of-the-week, streaks).
- MUST NOT write into doctrine — it proposes decisions and routes durable patterns to `void-learn` (HITL).
- MUST NOT change code — it reads history and reports.
- MUST NOT duplicate `void-learn`'s point-capture — this is the window-review cadence.

## Final rule

```
Window → git log / PRs / .void → signals (types, hotspots, test ratio, regressions) → improvement decisions → route durable patterns to learn.
Otherwise → it is not voidcorp retrospective.
```

The history is already telling you where the debt and the recurring pain are. The retro is the discipline of listening to it on a cadence.
