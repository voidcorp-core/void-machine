---
date: 2026-07-04
title: "graph cost/behavior liveness -- `activation` frontmatter over enforces-edge inference; two telemetry blind spots closed"
---

## 2026-07-04: graph cost/behavior liveness -- `activation` frontmatter over enforces-edge inference; two telemetry blind spots closed

Context: the consumer cost report flagged doctrine skills (`tdd`, `security-guidance`,
`commit-discipline`, ...) as `dead` / `low-yield`. Root cause: the activation-meter is a
PreToolUse hook, so it only records a `skill` event when a skill is invoked through the
Skill tool. Doctrine skills are never invoked that way -- their rule is carried passively
via `@.void/installed/PHILOSOPHY.md` + enforcing hooks -- so `invocations` is permanently 0 and
`staticTokens` (the full SKILL.md size) is charged as if paid every session, which it is
not (only PHILOSOPHY's summary is resident; the SKILL.md loads only on invocation). A
second blind spot: a workflow launched by `scriptPath` recorded `name: "inline"`, never
matching the filename-derived `workflow-def` node, so it read as `dead` regardless of runs.

Decision 1 -- a node declares its activation mode in frontmatter: `activation: always`
(doctrine followed passively) vs the default `on-demand` (a workflow triggered actively).
A node marked `always` is exempt from `dead` / `underused` / `low-yield` and carries a
positive `always` flag instead; it stays eligible for `expensive` (a real-cost fact). Same
reasoning the cost kernel already applied to hooks, whose liveness is structural, not
invocational.

The tag is granted only on **auditable structural backing**, not on a subjective "feels like
doctrine". A skill is `always` iff its rule genuinely operates without a Skill-tool invocation,
which requires one of two verifiable proofs: (a) it is the target of an `enforces` edge (a hook
runs it mechanically every commit), or (b) its principle is stated explicitly in
`PHILOSOPHY.md` (resident in the system prompt). This yields **16 always / 15 on-demand**:
- 14 backed by an `enforces` edge: accessibility-first, code-review, commit-discipline,
  domain-driven-design, frontend-design, functional, hexagonal-architecture, llm-cost-discipline,
  migrations-safety, observability, refactoring, security-guidance, testing, typescript-strict.
- `tdd` -- backed by the `tdd-guard` hook; this change adds the missing
  `enforces: tdd-guard -> tdd` edge so the backing is declared, not implicit.
- `source-driven-development` -- backed by the PHILOSOPHY hard rule "Read the official
  documentation of any third-party tool BEFORE writing its config".

An earlier, broader cut (21) also tagged async-safety, api-and-interface-design,
context-management, systematic-debugging, verification-before-completion. Rejected on review:
those five have neither an `enforces` edge nor a PHILOSOPHY line, and their own descriptions are
conditional ("Use for async/webhook/job/cron code"). Tagging them `always` would stamp a
genuinely unused, unenforced skill as healthy forever -- the exact blind spot this change fixes,
inverted. They stay `on-demand`; any of them earns `always` only once given a real backing (a
hook or a PHILOSOPHY line), never before.

Alternative rejected -- infer "always-loaded" from the existing `enforces` edges (a skill
that a hook enforces). Rejected: it is a proxy for a different property ("enforced by a
hook"), not "followed passively as doctrine". They correlate today but decouple tomorrow
(a hook enforcing a non-PHILOSOPHY skill, or the reverse), and it structurally misses `tdd`
(no declared `enforces` edge) and any doctrine skill without a hook. Encoding the mode
explicitly on the node is the honest fix; deducing it from a proxy re-introduces the same
class of lie. `backlog-autopilot` is enforced yet stays `on-demand`, confirming the proxy
would misclassify.

Decision 2 -- the activation-meter derives a scriptPath-launched workflow's name from the
script basename (strip `.workflow.js`), matching the `workflow-def` node id, before falling
back to `inline`. The fix is prospective (past log lines keep their recorded name).

Why: a telemetry signal that mislabels doctrine as dead would, via `void-audit`, propose
deprecating load-bearing skills -- the blind spot was not cosmetic, it was a trap that could
drive a wrong cut. The whole A->B->C self-optimization loop depends on the measurement
telling the truth about what the harness actually runs.
