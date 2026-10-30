---
title: Proportional delivery implementation
date: 2026-10-23
status: executing
spec: docs/specs/2026-10-23-proportional-delivery.md
author: Folpe + Codex
---

# Execution

One isolated writer on the approved scope; coordinator retains review and delivery decisions.

1. Reproduce contradictory guidance in skill contract tests (strict RED observed).
2. Revise owning skills and relevant contradictions, preserving test-first behavior, specialists,
   security and independent review (GREEN; no runtime schema change).
3. Document the accepted policy and superseding ADR; regenerate shipped assets and references.
4. Run relevant tests and repository integrity checks, commit, obtain one independent Claude
   review, and correct only concrete findings with targeted verification.

## Verification

Skill contract suite, anti-bloat, reference resolution, generated artifact consistency, doctrine
parity and relevant bounded review tests. No UI implementation or dependency change is planned.

## Resume point

Workflow guidance implemented. Complete generation and validation, then independent review.
Tracker progress is not inferred; this is an explicit user-requested standalone unit.
