---
skill: commit-discipline
status: draft
strategy: original
target_loc: 200
phase: D
depends_on: [verify]
composes_with: []
matrix_row: plans/skill-decision-matrix.md#commit-discipline
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `commit-discipline`

## Need

Without `commit-discipline`, commit messages drift to "fix stuff" / "wip". Git log loses its value as living documentation. `commit-discipline` enforces conventional commits, mandatory "why" in body, and rejects ambiguous subjects.

## Decision matrix anchor

- **Wins**: every commit. Conventional commit format, "why" in the body, scope, breaking-change marking
- **Loses to**: nothing — final gate before commit
- **Cannot decide**: whether the change itself is correct
- **Composes with**: `verify`

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Conventional Commits spec | https://www.conventionalcommits.org | foundation | kept verbatim |
| Folpe "always say why" rule (from DECLIK CLAUDE.md) | DECLIK/CLAUDE.md | kept | the load-bearing addition |
| citypaul commit guidance | citypaul/.dotfiles | reviewed | partially kept |

## Adaptation strategy

`original`. Slim. Conventional commits + Folpe "why" + scope guidance.

## Hard rules (draft)

- Format: `<type>(<scope>): <subject>` then blank line then body
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf`, `style`. No invented types
- Subject: imperative, lowercase, no period, ≤ 72 chars
- Body MUST include a "why" — the rationale, the constraint, the link to spec/issue. Not just what changed
- Breaking changes: `BREAKING CHANGE: <description>` footer
- Multi-line bullets in body OK. Em dashes banned (English-only, ASCII-only)
- Co-Authored-By trailer for LLM pair: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

## Modes — none

## Companion hooks

- `commitlint-precommit` (commit-msg hook) — already in void-starter, materialize via lefthook config
- `no-emdash-no-emoji-in-commit-msg` (commit-msg) — fail if em dash or emoji detected

## Composition

- Runs AFTER `verify`. The completion handoff produces the "what done"; commit-discipline frames it for git

## Anti-rules — see matrix
## Verification checklist — TBD
## Open questions

- Co-author trailer: hard-required or recommended? Lean recommended (user may pair-program with humans too)

## 2026-10-23: proportional delivery composition correction

Remove mandatory phase commits that contradicted the observed RED/GREEN evidence contract.
See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
