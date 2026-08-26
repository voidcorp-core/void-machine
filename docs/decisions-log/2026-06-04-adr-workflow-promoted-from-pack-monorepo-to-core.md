---
date: 2026-06-04
title: "adr-workflow promoted from pack-monorepo to core"
---

## 2026-06-04: adr-workflow promoted from pack-monorepo to core

Context: `adr-workflow` lived in pack-monorepo, but ADRs are a universal craftsman
concern and the repo meta-rule already mandates logging non-obvious decisions.

Decision: move the skill to `packages/core/skills/void-decide`, generalize the
"monorepo" wording to "codebase", add the missing `.source`, and drop "ADR workflow"
from the pack-monorepo manifest description. Audit note updated (pack → core).

Alternatives rejected:
- Leave it in pack-monorepo: consumers without the monorepo pack would lack a
  universal discipline the meta-rules assume exists.
