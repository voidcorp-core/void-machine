---
date: 2026-06-21
title: "consolidate backlog skills into `backlog-autopilot` (in session)"
---

## 2026-06-21: consolidate backlog skills into `backlog-autopilot` (in session)

Context: `backlog-batch` (attended, parallel, independent tickets) and
`autonomous-backlog-loop` (sequential, walk-away, one `claude -p` process per
ticket) overlapped, and neither served the real goal — drain a Linear pool over
hours, in session, grouping tickets into logical clusters, one clean PR per
cluster, optionally auto-merged. The loop's out-of-session `claude -p` lost the
in-session MCP / connector / subscription inheritance.

Decision: consolidate both into one in-session skill, `backlog-autopilot`, and
**delete** `autonomous-backlog-loop` (skill + `/void-backlog-loop` command + the
`claude -p` orchestrator, stream-json parser and embedded worker prompt) with no
deprecated alias. The machine-readable worker-event protocol (`VOID_EVENT`) is
preserved (extracted to `events.ts`) as the future worker-output contract. A
future **headless backend** (walk-away / cron) is reserved and deferred, not the
deleted loop.

- **Orchestrator** — hybrid: a thin in-session LLM launcher pilots the cluster
  queue (durable `.void/autopilot` state + compaction between clusters), and a
  deterministic Workflow fans out disposable worktree subagents per cluster. This
  is "the LLM orchestrator done right": the pilot never reads implementation
  files, so it does not rot over a multi-hour run, while keeping MCP and
  subscription inheritance the out-of-session loop lacked.
- **Mode auto-detection** — given a pool (Linear project / milestone / parent
  graph / label / manual IDs), detect logical clusters (>= 2 linked tickets, with
  a **file-footprint overlap** corroborating the graph edge); otherwise drain a
  **batch of 4** independent tickets. Default batch size aligned to 4.
- **Opus everywhere** — deliberate derogation from `llm-cost-discipline` (Sonnet
  default): the run is subscription-billed, not API-metered, and the top-5 %
  quality bar wants constant judgment. Overridable by flag.

Why: keeps the user-facing capability one skill (anti-bloat rule 3, no residual
overlap), in session (MCP/subscription alive), without the context rot a single
long LLM orchestrator would suffer. See `docs/specs/2026-06-21-backlog-autopilot.md`
and `docs/plans/2026-06-21-backlog-autopilot-plan.md`.
