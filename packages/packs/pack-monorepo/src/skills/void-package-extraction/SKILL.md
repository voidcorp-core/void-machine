---
name: void-package-extraction
description: Decide whether code in apps/<app>/ should be extracted into a new packages/<name>/ workspace. Most extractions are premature; this skill is the decision gate.
---

# package-extraction

Use when you are tempted to move code out of `apps/<app>/src/` into a new `packages/<name>/`. The instinct is good — sharing is virtuous — but **80% of extractions are premature** and end up creating coupling without the reuse benefit.

This skill is the gate. Composes with `void-service-package` (which is the creation workflow once you've decided yes).

## When this skill triggers

- "Let's extract this into a package so both apps can use it"
- "This helper is generic, it shouldn't live in apps/"
- "We're duplicating this in apps/web and apps/mobile"
- Any review comment "extract to packages/"

## The 3-question gate

Extract if and only if **all three** answers are yes:

1. **Are there ≥ 2 distinct consumers RIGHT NOW** (not "maybe later")? Distinct = different `apps/<name>/` packages.
2. **Would inlining the code in both apps cost > 30 minutes of duplication discipline per change**? If a 5-line helper diverges, the answer is no.
3. **Does the code own a CONCEPT, not just a function?** "billing engine" yes. "string utilities" no — those are scattered helpers, not a package.

If you can't say yes to all three, **inline the code in each app instead**. Duplication is cheaper than the wrong boundary.

## When NOT to extract

- ✗ Code used in only one app, "in case we need it later" — YAGNI, extract when the second consumer appears
- ✗ Helpers that wrap a single library function (`isValidEmail(s) { return z.string().email().safeParse(s).success }`) — copy 3 lines, don't add a package
- ✗ React components used in only one app — they belong in `apps/<app>/src/components/`
- ✗ Server logic specific to one app's route handlers — even if "feels generic", lives where it's used
- ✗ Types only — types live next to their use; if shared, in `@repo/api-types` (one package for the contracts, not one per concept)

## When YES to extract

- ✓ Auth logic consumed by web + mobile + worker
- ✓ A complete domain service (billing, scheduling, notifications) with own ports + adapters
- ✓ UI primitives consumed by web + mobile (Tappable, tokens) — that is `@repo/ui`
- ✓ A data model with its repository, shared by HTTP handlers and a background job

## Cost of premature extraction

- **Boundary thrashing**: API of the new package changes weekly because nobody knows what it should expose. PRs touching the package + every consumer.
- **Wrong abstraction**: extracted too early, before the second consumer's needs were clear. The package overfits the first consumer; the second has to fight it.
- **Import-direction violations**: the package starts importing from where it shouldn't (`@repo/db` from `@repo/billing`) because the boundary wasn't thought through.
- **Build complexity**: another tsconfig, another package.json, another dist target.

The cheap fix is to NOT extract until forced.

## Workflow

1. **Inline the duplication first.** Write the code in both apps. Live with it for one full feature cycle.
2. **Observe drift.** Are the two copies diverging? If yes, they were never the same concept — keep them separate. If they stay identical, you have a real case for extraction.
3. **Name the boundary in one sentence.** "This package owns <X>, exposes <Y>, is consumed by <Z>." If you can't, you're not ready.
4. **Run `void-service-package`** to create it properly (5+5 layout, port direction).
5. **Open a PR with ADR.** Extraction is structural; document via `void-decide`.

## Reverse: when to UN-extract

A package with one consumer for 6+ months should be inlined back. The boundary was a guess; reality says no. Reverse-extraction is a valid PR ("merge @repo/billing back into apps/web/src/services/billing").

## Composition

- `void-service-package` — the creation workflow (use this skill to decide, that one to create).
- `void-decide` — extractions are ADR-worthy.
- `void-dependency-direction` — extracted packages must respect `@repo/*` import direction.
- `void-hexagonal-architecture` — extracted packages own ports; adapters live in consumer apps.
