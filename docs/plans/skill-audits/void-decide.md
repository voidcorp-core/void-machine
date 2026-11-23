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

- Nygard's Context / Decision / Consequences and preservation of earlier reasoning.
- MADR status and explicit supersession.
- Terse records with accountable deciders.
- Credible rejected alternatives and explicit reversal cost.

**Adaptations.**

- Promoted from monorepo-specific to universal core in 2026-06-04.
- Replaced `NNNN` allocation with `adr:<uuid>` identity and a readable
  date/slug/UUID filename.
- One decision owns one Markdown file with light frontmatter; no generated index.
- Since the approved 2026-11-23 simplification, ordinary typo, link and wording
  corrections use normal Git commits. Material changes create a new decision
  linking the previous one. Historical files, IDs, metadata and links stay intact.
- The former custom CLI, schema validator, text immutability gate and mechanical
  reference exception are removed. The Markdown format works with ordinary
  repository tools, without a required authoring command or history service.
- Existing metadata readers keep their historical compatibility and parsing
  bounds; they are not a mandatory authoring schema.

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
