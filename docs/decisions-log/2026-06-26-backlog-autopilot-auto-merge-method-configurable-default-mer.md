---
date: 2026-06-26
title: "backlog-autopilot auto-merge method configurable, default merge commit"
---

## 2026-06-26: backlog-autopilot auto-merge method configurable, default merge commit

Context: the risk-gated `--auto-merge` path hardcoded `gh pr merge --auto
--squash` (issue #31). A squash collapses an integration PR that bundles N
tickets — each with its own `test:`/`fix:` commits and "why" bodies — into a
single commit, against `commit-discipline`'s "the git log is documentation", and
it silently overrides a downstream repo whose convention is merge commits.

Decision: make the strategy a validated enum, `--auto-merge-method=merge|squash|
rebase` (env `AUTO_MERGE_METHOD`, file `autoMergeMethod`, same flags > env > file
> default precedence as the rest of `BacklogConfig`), **default `merge`**.
`mergeArgs(branch, method)` builds `--<method>`; an unrecognized value narrows to
undefined and falls through to the next source, so a typo never silently arms an
unexpected strategy.

Alternatives rejected:
- **Minimal: hardcode `--merge`.** Fixes the per-ticket-history loss but still
  imposes one strategy on every consumer; a repo standardized on squash would be
  forced off-convention, the symmetric version of the bug being fixed.
- **Auto-detect the repo's allowed/conventional method.** Requires a `gh`/API
  probe of branch settings at plan time (I/O in the pure config layer) for a
  guess that can still be wrong; an explicit flag with a safe default is simpler
  and deterministic. Deferred as YAGNI until a consumer asks.

Context: `autonomous-backlog-loop` covers the sequential walk-away case; it does
not cover "drain a few independent tickets in parallel, attended, without
breaking anything". Spec/plan:
`docs/specs/2026-06-18-backlog-batch-parallel.md`,
`docs/plans/2026-06-18-backlog-batch-parallel-plan.md`.

Decision: ship a **sister** skill `backlog-batch` (not a mode of the loop). A
two-layer design: an **in-session launcher** selects an independent eligible
batch (Linear MCP), estimates each ticket's file footprint (a lightweight
estimator subagent), partitions **parallel (low overlap) vs sequential (overlap
/ lockfile / migrations)**, and — after **human confirmation** — invokes a
deterministic **Workflow** that fans out one **worktree-isolated subagent** per
ticket, then a **reconciliation subagent** merges the green branches into **one
integration PR gated by the full suite**. The deterministic core (selection,
partition, plan) lives in the CLI (`void-harness backlog-batch plan`,
vitest-tested); the MCP gathering, estimation, and fan-out are in-session /
Workflow. Subagents inherit the parent auth → subscription billing.

Alternatives rejected:
- **A mode of `autonomous-backlog-loop`.** Different orchestration (Workflow
  subagent vs CLI process), risk model (parallel vs sequential), and output
  (integration PR vs PR/ticket). Sister skill keeps each single-subject
  (anti-bloat rule 2); shared selection/worker vocabulary, < 30 % overlap.
- **An LLM session as orchestrator.** A long parent that fans out + reconciles
  accumulates context (rot) and drives the loop non-deterministically. The
  Workflow tool gives deterministic JS orchestration of subagents.
- **Process-parallelism (`claude -p` in worktrees) instead of subagents.** Loses
  tool/MCP inheritance, native observability, and inherited subscription billing
  — the reasons to prefer subagents for an *attended* burst.
- **Blind parallelism / clever overlap graph-coloring.** Naive parallel corrupts
  one shared tree; graph-coloring is YAGNI. Conservative "parallel only if
  isolated", with the reconciliation subagent + full suite as backstop.
- **Live multi-agent smoke on void-harness.** Worktree isolation targets the
  current repo, so a real run here would create worktrees/an integration branch/a
  PR on the harness itself. The live smoke is a consumer-project dogfood; the
  deterministic CLI layers carry the unit-tested confidence.
