---
date: 2026-06-18
title: "backlog-loop orchestrator moves from bash to the TS CLI"
---

## 2026-06-18: backlog-loop orchestrator moves from bash to the TS CLI

Context: the `autonomous-backlog-loop` was launched via a hardcoded plugin-cache
path (`bash .../scripts/autonomous-backlog.sh`) with env-var config, and was a
black box — each `claude -p` worker's output went only to a log file, the terminal
showed `[HH:MM:SS] iteration N/M`, and the decisions workers took were never
surfaced at the HITL boundary (PR merge). Spec/plan:
`docs/specs/2026-06-18-backlog-loop-observability.md`,
`docs/plans/2026-06-18-backlog-loop-observability-plan.md`.

Decision: rewrite the orchestrator in TypeScript under
`packages/cli/src/lib/backlog/`, exposed as `void-harness backlog-loop` (flags,
`--dry-run`, `--help`, first-run wizard) and the `/void-backlog-loop` command.
Each worker is spawned with `--output-format stream-json`, parsed into domain
events that drive a live **append-only** flux and a dense final summary
(tickets, decisions/ADRs, PRs to merge, blockers). Token usage is forced onto the
Claude **subscription**: the worker env is stripped of `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN`, and a cloud-provider routing var aborts the run unless
`--allow-api` is an explicit opt-in. The worker prompt and the security allowlist
(`AUTONOMOUS_SETTINGS`) are embedded in the CLI so the orchestrator is
self-contained. The bash script, `iteration-prompt.md`, and
`settings.autonomous.json` are deleted (no other user — no compat shim);
`stop-verification-gate.sh` stays as the opt-in Stop hook.

Alternatives rejected:
- **Keep the bash orchestrator, add jq-based stream-json parsing.** Parsing a JSON
  event stream and rendering a live tree + accumulating a summary is beyond
  comfortable bash; the repo is already TS with a render layer. Bash would be
  fragile and untestable.
- **Drive workers via the Agent tool instead of fresh `claude -p` processes.** That
  shares one process and defeats the per-ticket context reset (the core anti-rot
  property). Fresh OS process per ticket is kept.
- **Ship a bash shim that execs the CLI.** No other user exists; a shim is dead
  weight. Removed outright.
