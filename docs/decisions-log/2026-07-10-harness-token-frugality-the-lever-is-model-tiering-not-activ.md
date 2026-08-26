---
date: 2026-07-10
title: "harness token frugality — the lever is model tiering, not `activation` flags (DEV-403)"
---

## 2026-07-10: harness token frugality — the lever is model tiering, not `activation` flags (DEV-403)

Directive: minimize the harness's token footprint with zero quality loss. The audit
(`docs/plans/2026-07-10-harness-token-frugality-audit.md`) corrected the ticket's lead assumption:
- **`activation: always` is not a content loader** — it is read only by the graph cost/behavior model
  (DECISIONS 2026-07-04). Flipping `always` → `on-demand` saves zero session tokens and would corrupt the graph
  liveness model. Rejected.
- **The static footprint is already lean**: SessionStart injects ~4 lines; the per-call meter hooks `printf` to
  log files with zero model output; the read-only agents are already partly tiered (3 sonnet, 2 opus).
- **The real cost is work** — subagent / pass model selection. Model tiering is the quality-safe lever (tier the
  mechanical, keep top-tier for every judgment pass).

Decision (Folpe picked A, C, F): **A** `type-design-analyzer` opus → sonnet (type-shape analysis is
pattern-matching; doctrine-critic already runs sonnet); **C** pin the backlog-autopilot footprint estimator to
haiku (a cheap classification; low confidence already routes safe). **B** keep `migration-planner` on opus
(high-stakes sequencing). **D+E** (per-pass model-tier mechanism in ticket-runner + autopilot workers) → its own
follow-up ticket. **F** (prose distillation) runs as a **dedicated eval-gated pass**, longest skills first, each
change verified by the behavioral eval-harness — never a blind sweep, because "distill, never amputate" is the
guard and only a per-skill eval proves zero loss.

Why: the frugality win is not in flipping flags on an already-lean static footprint — it is in not spending Opus
on pattern-matching. Tier the mechanical work down; keep every judgment at full strength; prove each downgrade
with the evals. A + C are one reversible frontmatter line each.
