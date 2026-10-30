# PROJECT-DOCTRINE.md

What is true of **this** project and could not be inferred from the code: its domain vocabulary,
the trade-offs already settled, the rules it has paid for. Loaded into every session, so write
only what you want read every time.

This file is yours. `void-machine init` creates it, and never overwrites one you have written in.
Universal rules live in `.void/installed/PHILOSOPHY.md` and belong to the harness.

Say a rule out loud — "ajoute la règle…", "always X here", "never Y" — and `void-learn` proposes
the wording, waits for your yes, then writes it here. Sections appear as you use them.

Full format, with the shape of each section:
https://github.com/voidcorp-core/void-machine/blob/main/docs/PROJECT-DOCTRINE-FORMAT.md

## Quality bar

- **A flaky proof is invalid**: Before adding a gate, test, or abstraction, delete or fuse any
  existing proof that owns the same responsibility. A retry, raised assertion timeout, quarantine,
  or rerun must never turn a red gate green.
  - **Why**: Implement and Autopilot depend on green evidence as an absolute authorization. A
    probabilistic instrument can stop an autonomous run on chance or, worse, manufacture a false
    success.
  - **Enforced by**: test architecture, CI inventory gates, `void-testing`, `void-debug`, and code
    review.

## Hard rules

- **Worktrees Git** : appliquer l'invariant universel
  [Git worktree placement and lifetime](https://github.com/voidcorp-core/void-machine/blob/develop/packages/core/PHILOSOPHY.md#git-worktree-placement-and-lifetime),
  porté dans `packages/core/PHILOSOPHY.md` et sa copie `docs/PHILOSOPHY.md`.
  Il couvre emplacement durable, réutilisation, migration conservatrice et cycle
  de vie lié au ticket, indépendamment des outils d'affichage.
  - **Why** : une seule règle autoritaire partagée par les consommateurs et les skills.
  - **Enforced by** : doctrine universelle, skill `void-autopilot` (worktree créée ou réutilisée
    avant chaque worker, retirée seulement après un merge observé) et `docs/WORKTREES.md`.

- **Linear outbound reports**: publish only an operational summary and links to the PR or CI; keep implementation details, internal paths, and detailed test results in review artefacts. If the outbound control rejects a detailed payload, reduce the content without attempting a workaround.
  - **Why**: detailed Linear comments are repeatedly refused when they publish internal repository context; a short status plus linked evidence keeps the tracker useful and safe.
  - **Enforced by**: `void-learn` and manual outbound review.

## Trade-offs already decided

- **Machine vocation**: follow [the Cortex/Machine boundary](../docs/MACHINE-VOCATION.md)
  and its linked ADR, explicitly requested by Folpe on 2026-10-29. Development is the
  first specialty; Machine executes the mandate and proposes knowledge, while Cortex
  owns intent, durable personal memory, permissions and final acceptance.
  - **Why**: preserve the existing investment without creating a competing user brain.
  - **Enforced by**: architecture and code review; this documentation change adds no runtime gate.
