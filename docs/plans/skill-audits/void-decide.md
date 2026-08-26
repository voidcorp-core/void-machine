---
skill: decide
pack: core
status: shipped
strategy: native
target_loc: 160
matrix_row: plans/skill-decision-matrix.md#decide
audit_date: 2026-07-24
auditor: Folpe + Codex
---

# Audit: core:decide

**Need.** Structural decisions decay into folklore when only commit messages
preserve the rationale. Parallel agent branches add a second failure mode:
sequential ADR numbers and generated indexes turn independent work into merge
coordination.

**Load-bearing principles retained.**

- Nygard's Context / Decision / Consequences and immutable record lifecycle.
- MADR status and explicit supersession.
- Terse records with accountable deciders.
- Credible rejected alternatives and explicit reversal cost.

**Adaptations.**

- Promoted from monorepo-specific to universal core in 2026-06-04.
- Replaced `NNNN` allocation with `adr:<uuid>` identity and a readable
  date/slug/UUID filename.
- One decision owns one file; projections are stdout-only and never merge
  artifacts.
- Accepted decision content cannot be edited, renamed or deleted. Reversal
  creates a new record with `supersedes`.
- Since 2026-08-26, the CLI permits only a bounded repository-local reference
  substitution whose target exists and whose frontmatter, headings, structure
  and surrounding prose stay unchanged. This keeps moved paths usable without
  manufacturing an ADR about each rename or weakening semantic immutability.
- The Markdown + YAML contract remains usable without void-harness or a specific
  model runtime; the CLI adds exclusive creation and deterministic validation.

**Rejected.**

- Shared counters: readable ordering does not justify a race between workers.
- A committed generated index: it recreates the merge hotspot after source files
  were isolated.
- Database-backed ADRs: unnecessary infrastructure and weaker repository
  portability.
- Bugfix/refactor ADRs: commit and issue history are enough.

**Composes with.** `plan`, `source-driven-development`,
`commit-discipline`, and `learn`. It does not own planning, research
or doctrine extraction.
