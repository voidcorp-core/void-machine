---
name: void-plan-review
description: "Critique a written plan (not a diff) via four lenses: CEO premise/ambition, Eng test-coverage, Design states/slop, DevEx time-to-first-value. Proposes findings; the author disposes."
---

# Plan review

Critique a written plan within its accepted scope before execution. `void-brainstorm` resolves
intent and credible alternatives; `void-plan` authors the sequence. This skill proposes findings,
not code or a rewritten plan. **Attribution**: see `.source`.

## Review contract

Read the accepted goal, constraints, dependencies and applicable proof. Choose the relevant lenses
below or `all`; skip lenses with no affected surface. Findings name the criterion, concrete
consequence, evidence and proposed resolution. Distinguish blockers from optional improvements.
Missing headings, a subjective score or a reviewer preference do not establish a defect.

Respect approved scope. Reopen a consequential choice only for material new evidence or an explicit
strategic mandate. Routine corrections within scope need no repeated approval. Present unresolved
human decisions with useful options and a recommendation; no fixed alternative/opportunity quota,
automatic expansion, confidence rating or universal file-count threshold applies.

## Lenses

- **Product / CEO**: does the plan deliver the accepted outcome? Identify a premise invalidated by
  new evidence, conflicting requirements or a simpler way to meet the goal. Ambition and opportunity
  exploration belong in `void-brainstorm` before scope acceptance.
- **Engineering**: inspect boundaries, dependencies, data and failure paths, security and measured
  performance constraints. Trace risk-relevant behaviors to focused tests and integration proof.
  A regression fix needs a meaningful regression test; name unproved risks rather than demanding
  an assertion for every line.
- **Design** (UI only): assess hierarchy, applicable interaction states, mobile/desktop behavior,
  keyboard access and accessibility. Explain concrete defects and their affected journey.
  `void-frontend-design`, `void-accessibility` and `void-ui-review` supply the design standards.
- **DevEx** (API/CLI/SDK/docs only): examine setup to first useful result, naming/defaults, errors,
  examples, upgrade path and supported environments. Use contextual agreed objectives and actual
  journey evidence when available. No universal TTHW deadline or numeric approval score.

## Result

Combine overlapping findings and report the useful conclusions, blockers, limitations and proof
references. `CLEARED` means no unresolved demonstrated blocking defect; `NOT CLEARED` names those
remaining. The plan author incorporates corrections. Ask the user only for a decision beyond the
mandate, preserve explicit holds, and do not add a general review or approval ceremony because
multiple lenses were used. `void-implement` owns independent review of the eventual code change.
