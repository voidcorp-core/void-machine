---
skill: frontend-design
status: reviewed
strategy: vendor-plugin
target_loc: 350
phase: D
depends_on: [accessibility]
composes_with: [typescript-strict, code-review]
matrix_row: plans/skill-decision-matrix.md#frontend-design
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `frontend-design`

## Need

Without `frontend-design`, AI-generated UI tends to "vibe coded" output: blue-to-violet gradient cliches, generic hero "Build faster, ship smarter," insufficient information density, mid hierarchy, motion as decoration. The result reads as generated. The Vercel `frontend-design` plugin (already installed globally as `frontend-design:frontend-design`) addresses exactly this. This skill re-publishes it as a void-harness skill with our matrix integration + mobile-first dual-quality invariant + composition with `accessibility`.

## Decision matrix anchor

- **Wins**: any new UI component or layout. Anti-AI-slop rules, density, hierarchy, motion discipline, mobile-first layout
- **Loses to**: `gstack:/design-consultation` for design system creation. `gstack:/design-review` for live audits
- **Cannot decide**: brand identity (DESIGN.md owns it)
- **Composes with**: `accessibility`, `typescript-strict`
- **Mobile-first dual-quality invariant**: layout starts 360–390px, progressively enhanced. No desktop-only layout shipped without an equivalent mobile experience (or explicit documented decision). Both viewports screenshot-reviewed before merge

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Vercel `frontend-design` plugin (installed globally as `frontend-design:frontend-design`) | https://github.com/vercel-labs/agent-skills | foundation | **vendored as void-harness skill** with our matrix integration + mobile-first dual-quality invariant + accessibility composition |
| citypaul/.dotfiles UI patterns | citypaul/.dotfiles | reviewed | partially kept (density, hierarchy notes) |
| Refactoring UI (Adam Wathan + Steve Schoger) | book | reference | foundation (density, hierarchy, motion principles) |
| Apple HIG visual design chapter | https://developer.apple.com/design/human-interface-guidelines | reference | mobile layout heuristics |
| Folpe DESIGN.md per-project | DECLIK/DESIGN.md, solaar designs | reference | brand identity stays in consumer DESIGN.md; this skill is generic |
| pbakaus/impeccable-design (referenced by citypaul) | github | reviewed | reference (informed citypaul's UI notes) |

## Adaptation strategy

`vendor-plugin`. Re-publish Vercel `frontend-design` as `voidcorp:frontend-design` with attribution. Three deliberate additions:

1. **Mobile-first dual-quality invariant** — the load-bearing void-harness addition. Folpe rule, documented in `docs/PHILOSOPHY.md`.
2. **Matrix integration** — boundary with `accessibility`, with `gstack:/design-consultation`, with `gstack:/design-review` (where each one wins / loses / composes).
3. **Composition with `pack-nextjs-pwa` shadcn defaults** — anti-AI-slop rules expressed in terms of shadcn components and Tailwind tokens.

We FORK rather than reference because the void-harness invariant (mobile-first dual-quality) is a non-trivial addition that the upstream does not encode.

## What we keep (verbatim or near-verbatim)

- **Anti-AI-slop banned-strings list** (Vercel + amplified): no generic blue-to-violet gradients, no hero "Build faster, ship smarter" copy, no abstract 3D shape decorations by default, no "AI-generated lorem-ipsum-tier" microcopy. Why: these signal "vibe coded" and lose user trust before the content is read.
- **Density first** (Refactoring UI): information density > whitespace by default. Whitespace earns its place via hierarchy, not as default. Generic AI output over-uses whitespace and under-uses density.
- **Type hierarchy: 3 sizes max + weight + color** (Refactoring UI): no random ad hoc font sizes. The design system tokens express the 3 sizes.
- **Motion: purpose-driven, < 250ms, ease-out** (Refactoring UI + Apple HIG): no bouncy decorations. Motion communicates state change, not entertainment. Respect `prefers-reduced-motion` (composes with `accessibility`).
- **Components from `@repo/ui`** (or shadcn re-export): no hand-rolled buttons / modals / forms. Composes with `accessibility` (Radix base).

## What we adapt

- **Mobile-first dual-quality invariant** (Folpe rule, void-harness addition):
  - Layout STARTS at 360–390px (iPhone 12 mini → 15 Pro range).
  - Progressively enhanced to wider viewports — never the reverse.
  - Both viewports screenshot-reviewed before merge.
  - No mobile-only OR desktop-only features without explicit ADR.
  - The `viewport-screenshot-gate` hook (shared with `accessibility`) enforces both screenshots.
- **Brand identity stays in `DESIGN.md` per project** (void-harness convention): this skill does NOT impose colors / typography / motion language. It imposes the DISCIPLINE. The brand-specific palette and font stack live in `DESIGN.md` and are realized via design system tokens.
- **Composition with shadcn defaults** (`pack-nextjs-pwa`): the anti-AI-slop rules are expressed concretely: "do not use `bg-gradient-to-r from-blue-500 to-purple-500` as a generic background." Vercel plugin's rules are framework-agnostic; we ground them in the void stack.
- **Information architecture before visual design**: the discipline is structural first (what is the hierarchy, what is the primary action, what is the supporting context), THEN visual (typography, color, motion). AI-generated UI tends to skip the IA step.

## What we reject

- **Generic gradients (blue → violet, purple → pink, etc.) as default decoration**: rejected.
- **Hero copy "Build faster, ship smarter" / "Ship 10× faster" / similar**: rejected.
- **Abstract 3D / blobs / orbs as primary hero visual**: rejected by default. Acceptable when the brand justifies it (DESIGN.md).
- **Lorem ipsum / placeholder text in shipped UI**: rejected.
- **Random ad hoc font sizes outside the 3-size system**: rejected.
- **Decorative animations longer than 250ms**: rejected. Motion serves communication.
- **Hand-rolled UI primitives** (button, modal, dropdown, etc.) when shadcn / Radix covers them: rejected (composes with `accessibility`).
- **Desktop-only or mobile-only layouts without documented decision**: rejected.

## Hard rules surfaced by this skill

- **Layout starts at 360–390px, progressively enhanced**. Enforced by: SKILL.md + `viewport-screenshot-gate` hook (mobile screenshot mandatory).
- **Both viewports screenshot-reviewed before merge**. Enforced by: hook + `code-review`.
- **No mobile-only / desktop-only features without ADR**. Enforced by: SKILL.md + `code-review`.
- **Components from `@repo/ui` / shadcn / Radix only**. Enforced by: SKILL.md + composes with `accessibility`.
- **Banned strings**: no "Build faster ship smarter" / similar AI-slop in committed copy. Enforced by: `anti-ai-slop-grep` hook (warn-only — false positives expected).
- **Type hierarchy: 3 sizes max + weight + color**. Enforced by: SKILL.md + design system tokens enforce.
- **Motion < 250ms, purpose-driven, ease-out**. Enforced by: SKILL.md + `code-review`.

## Modes — none

The discipline is uniform. Brand expression varies per project (DESIGN.md); the discipline does not.

## Companion hooks

- `viewport-screenshot-gate` (pre-PR on UI changes, shared with `accessibility`) — fails PRs lacking both mobile and desktop screenshots. ≤ 60 LOC.
- `anti-ai-slop-grep` (pre-commit) — warns on banned copy patterns. Initial list: ~10 obvious patterns; grows from `harness-evolution` feedback. False positives expected, hence warn-only. ≤ 50 LOC.

## Composition with other skills

- **With `accessibility`**: a11y is a precondition, not a layer on top. Shared mobile-first dual-quality invariant. Shared `viewport-screenshot-gate` hook.
- **With `typescript-strict`**: component props strongly typed; no `any` in UI code; discriminated unions for component variants.
- **With `code-review`**: dimensions `readability` and `correctness` include UI quality flags.
- **With `pack-nextjs-pwa`**: provides `@repo/ui` (Radix / shadcn-wrapped) + design system tokens + Tailwind config.
- **With `gstack:/design-consultation`**: design system creation (DESIGN.md) is UPSTREAM. This skill consumes the design system.
- **With `gstack:/design-review`**: live visual audit on URLs is DOWNSTREAM. This skill prevents the issues that design-review would otherwise catch.
- **With `gstack:/design-shotgun`**: design variant exploration is UPSTREAM (option generation before this skill decides density / hierarchy / motion).

## Anti-rules

- MUST NOT decide brand identity (colors / typography / motion language) — DESIGN.md owns.
- MUST NOT replace `gstack:/design-consultation` (system creation) or `/design-review` (live audit).
- MUST NOT permit hand-rolled UI primitives (composes with accessibility).
- MUST NOT skip dual-viewport verification.
- MUST NOT silently allow banned copy / banned visual patterns.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 350 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions anti-AI-slop + density + 3-size hierarchy + motion discipline + mobile-first dual-quality as headline
- [ ] `.source` file lists Vercel frontend-design plugin + Refactoring UI + Apple HIG + citypaul + DESIGN.md convention
- [ ] `viewport-screenshot-gate` and `anti-ai-slop-grep` hooks drafted at ≤ 100 LOC each
- [ ] `pack-nextjs-pwa` publishes `@repo/ui` design system + Tailwind config matching this skill's invariants
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/frontend-design/` cover: banned-copy detection, hand-rolled-primitive detection, missing-mobile-screenshot detection, gradient-cliche detection
- [ ] No overlap > 30% with `accessibility` (this skill = aesthetic / structural; a11y = floor)
- [ ] No overlap > 30% with `gstack:/design-consultation` (this skill = component-level discipline; consultation = system creation)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor (Codex uses gstack the same way Claude does)
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## DEV-444 pre-build adaptation

- Added the Experience Designer as a fresh read-only upstream brief, not a second build skill.
- The builder consumes IA, state, responsive, keyboard, and accessibility intent without self-approval.
- Post-build craft judgment remains in `ui-review` and the Visual Craft Director to keep overlap bounded.

## Open questions

- **Vendor verbatim from Vercel plugin vs fork**: lean fork. The mobile-first dual-quality invariant is non-trivial addition.
- **Anti-AI-slop banned-strings list**: start with 5–10 obvious patterns ("build faster ship smarter," "ship 10x faster," "unlock your potential," etc.). Grow from `harness-evolution` feedback queue.
- **Mobile viewport range**: 360–390px is iPhone 12 mini → 15 Pro. Cover iPhone SE (320px) via media query but not as the default design target. Document.
- **shadcn config preset**: `pack-nextjs-pwa` ships a shadcn `components.json` preset matching this skill's discipline (no generic gradients, density-first, etc.). Reference here in the SKILL.md.
- **Motion library**: Framer Motion vs CSS animations vs view transitions. Lean: CSS animations + view transitions for state changes, Framer Motion as opt-in for complex orchestrations. Document in `pack-nextjs-pwa`.

## impeccable build-craft vendoring (DEV-389, de-gstackification Vague 3)

Enriched this skill (219 → 266 LOC) with impeccable's **build-time** craft that it lacked: the current-AI-tell absolute bans (side-stripe borders, gradient text, glassmorphism-as-default, hero-metric template, eyebrow/numbered-section-markers, cream/sand body background, breakpoint text-overflow); the color-strategy commitment axis (Restrained/Committed/Full/Drenched) + OKLCH + the physical-scene rule; typography specifics (65-75ch, contrast-axis pairing, clamp ≤6rem, letter-spacing floor, text-wrap); layout/interaction specifics (cards-are-lazy, flex-1D/grid-2D, auto-fit minmax, semantic z-index, dropdown clipping); motion specifics (ease-out exponential, reduced-motion alternative, reveal-must-enhance-visible); the `system-ui`-as-primary-font ban; and the Krug reading model from design-review. The audit/critique half of impeccable + design-review became the new `harness:ui-review` (the ceiling to this floor). Full distribution matrix + rejected/deferred pieces: see `plans/skill-audits/void-ui-review.md`. Composition/anti-rules repointed from the gstack design skills to `ui-review` + `forge` + the `DESIGN.md` contract.

## 2026-10-23: proportional delivery

Align the existing standard with the owning workflow, preserving its technical protection while
removing repeated or pattern-only obligations. See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
