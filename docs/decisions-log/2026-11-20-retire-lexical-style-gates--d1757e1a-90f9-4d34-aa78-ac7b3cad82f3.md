---
schemaVersion: 1
id: "adr:d1757e1a-90f9-4d34-aa78-ac7b3cad82f3"
createdAt: "2026-11-20T13:25:20.378Z"
title: "Retire lexical test-name and visual-style write gates"
status: accepted
deciders: ["folpe"]
supersedes: ["legacy:2026-06-04-claude-md-authoring-skill-four-scoped-agents-no-ai-design-sl"]
---

# Retire lexical test-name and visual-style write gates

## Context

The installed gate rejects a descriptive test named `works across timezone boundaries`
solely for its prefix, and rejects a stylesheet using Inter regardless of its brand
or contrast. The same test-name pattern also rejects a regression fixture inside a
string. Neither lexical match demonstrates a broken test or an inaccessible UI.
Each gate starts a separate runner on every applicable edit.

## Decision

Retire `test-name` and `design-slop` from write enforcement and CI rule dispatch,
their wrappers and discovery entries, while retaining naming, visual-design and
accessibility guidance in the existing skills and review.

This supersedes only the visual-style hook added by the June 2026 decision; its
other skill and agent decisions remain unchanged. No other enforcement rule is
weakened. Unknown rule names still fail closed. Installation and refresh replace
the retired hook entries with the matching bundle; live manual activation removes
those entries before loading a bundle that no longer recognizes them.

## Consequences

Positive:

- Two runner invocations and two lexical causes of refusal disappear per applicable edit.
- Test names and visual choices can express the project's actual behavior and brand.
- No replacement warning engine, configuration flag or permanent no-op alias is added.

Negative:

- Weak test descriptions and poor visual choices require contextual review. These
  gates never measured coverage, test relevance, contrast or actual rendered quality.
- A partial update retaining old wiring with the new bundle is invalid; the
  installer must publish the matching assets together. Existing old installations
  keep their old behavior until updated.

## Alternatives considered

- **Keep the lexical blocks and add exceptions**: retains interruptions and requires
  annotations that prove neither test quality nor accessibility.
- **Convert the same regex to automatic warnings**: retains the two runner calls and
  noisy judgments without adding reliable evidence. Existing review guidance suffices.
- **Accept all unknown rule names**: would conceal broken safety wiring. Retired
  manifest entries are removed instead, preserving the refusal for unknown rules.

## Reversal cost

Low: restore the scoped rules and matching manifests from Git if representative
evidence demonstrates that their benefit exceeds false refusals and execution cost.
No speed percentage or reduction in escaped regressions is claimed without measurement.
