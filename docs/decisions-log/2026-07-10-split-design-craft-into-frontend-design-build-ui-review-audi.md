---
date: 2026-07-10
title: "split design craft into frontend-design (build) + ui-review (audit); internalise impeccable (DEV-389)"
---

## 2026-07-10: split design craft into frontend-design (build) + ui-review (audit); internalise impeccable (DEV-389)

De-gstackification Vague 3 (epic DEV-383), plus a Folpe directive: put UI craft fully in the harness — the
external standalone `impeccable` skill is to be internalised ("si impeccable est intégrable dans un ou plusieurs
skills custom, on le fait"), so the harness does not depend on an outside skill. This vendors the durable design
methodology from four sources — gstack `/design-review`, `/design-consultation`, `/design-shotgun`, and the
standalone `impeccable` — and splits it by lifecycle.

Decision: **`frontend-design` (build-time floor) + a new `harness:ui-review` (audit-time ceiling)**, mirroring
`security-guidance`/`security-audit` and `writing-plans`/`plan-review`. NOT one mega-skill, NOT a dependency on
external impeccable.

- **frontend-design** gains impeccable's build-time craft: the current-AI-tell absolute bans (side-stripe,
  gradient-text, glassmorphism, hero-metric, eyebrow/numbered-markers, cream/sand body, text-overflow), the
  color-strategy commitment axis, the type/layout/motion/interaction specifics, the `system-ui`-font ban, and
  the Krug reading model (219 → 266 LOC).
- **ui-review** (new, `on-demand`) vendors the audit/critique/refine methodology: the AI-slop two-altitude
  category-reflex test, the register split (brand vs product), the designer's-eye QA (first-impression, squint
  test, interaction-state coverage), the technical audit (contrast/a11y/responsive/perf), and the refine-mode
  menu. One subject (audit an existing UI); < 30% overlap with frontend-design (it assumes and checks against
  the build rules, does not restate them).
- **forge** (voidcorp plugin) owns market recon, the scored 12-dimension critique, the slop registry, and the
  multi-variant design prompts — bridged by the `docs/specs/` `source: forge` artifact contract. Four forge
  issues are drafted (specs in `docs/plans/skill-audits/void-ui-review.md`) but NOT yet filed — creation on the external
  `voidcorp-core/forge` repo was blocked by the permission classifier; a tracked follow-up for Folpe.
  **DESIGN.md** stays the design-system contract (produced by `impeccable document`/`init` or by hand).
- **Deferred to Vague 4** (claude-in-chrome MCP): every live-browser piece — screenshots, `live`/variant
  iteration, the comparison board, the atomic-fix loop. Rejected: all gstack + impeccable runtime.

The full section-by-section distribution matrix is in `docs/plans/skill-audits/void-ui-review.md`. Routing repointed
across skills, agents, CLAUDE.md/AGENTS.md, PHILOSOPHY, and the decision matrix.

Why: UI craft is core value; depending on an external `impeccable` skill (which itself dies with a future
gstack-style teardown, and isn't harness-governed) contradicts "tout dans le harnais". The floor/ceiling split
keeps each skill lean and one-subject, and makes the harness self-contained on both building and auditing UI.
