---
name: void-frontend-design
description: Anti-AI-slop UI. Density first, 3-size hierarchy, motion <250ms, components via @repo/ui (Radix/shadcn), mobile-first dual-quality. Brand from DESIGN.md. Use when building or modifying UI.
---

# frontend-design — voidcorp craftsman edition

AI-generated UI tends to "vibe coded": blue-to-violet gradients, generic hero copy, low information density, mid hierarchy, motion as decoration. The result reads as generated. This skill encodes the discipline that breaks that pattern.

Brand identity (palette, typography stack, motion language) lives in the consumer project's `DESIGN.md`. This skill imposes the DISCIPLINE that applies across all brand identities.

**Attribution**: see `.source`. Foundation: Vercel `void-frontend-design` plugin + Refactoring UI + Apple HIG + citypaul UI notes; the current-AI-tell bans, color-strategy axis, and type/layout/motion specifics are vendored from `impeccable` (DEV-389); the Krug reading model from gstack `/design-review`.

---

## Mobile-first dual-quality

Every UI is designed mobile-first AND must reach first-class quality on both viewports simultaneously. (Folpe rule, `.void/installed/PHILOSOPHY.md`.)

- **Layout starts at 360–390px** (iPhone 12 mini → 15 Pro range), progressively enhanced wider.
- **Never the reverse.** No "desktop-first then squeeze for mobile."
- **Both viewports screenshot-reviewed before merge** — `viewport-screenshot-gate` hook (shared with `void-accessibility`).
- **No mobile-only / desktop-only features** without an explicit decision recorded through the `void-decide` skill.
- **Performance budget enforced for both**: LCP < 2.5s on slow 4G mobile AND on desktop fiber (measure with the project's perf tooling — Lighthouse CI, WebPageTest, bundlesize).

---

## Pre-build experience pass

Before implementation, invoke `core:experience-designer` in a fresh read-only context with the
ticket, product intent, `DESIGN.md`, and existing interface evidence. Its build brief names the IA,
primary action, keyboard path, responsive intent, and applicable UI states. Missing or stale
pre-build attestation blocks implementation. This skill consumes that brief and owns the build; it
does not self-approve the post-build result.

---

## Anti-AI-slop — banned patterns

### Banned copy

- "Build faster, ship smarter"
- "Ship 10× faster"
- "Unlock your potential"
- "Empower your team"
- "Transform your workflow"
- Generic CTA: "Get Started Free Forever"

These signal "vibe coded" and lose user trust before the content is read. The companion hook `anti-ai-slop-grep` warns on these patterns in staged copy. Override per-string with explicit code review approval — the discipline is heuristic, the writer is final.

### Banned visual patterns by default

- Blue → violet / purple → pink gradient backgrounds as default decoration
- Abstract 3D / blobs / orbs as primary hero visual
- Lorem ipsum or placeholder text in shipped UI
- Random ad hoc font sizes outside the 3-size system
- Decorative animations longer than 250ms

These are defaults. Brand can override via `DESIGN.md` if the brand justifies a specific pattern (e.g., a brand that legitimately uses a specific gradient). Override is documented; default is rejection.

### Absolute bans — the current AI tells (match-and-refuse; vendored from impeccable)

If you are about to write any of these, rewrite the element with different structure:

- **Side-stripe borders** — a colored `border-left`/`border-right` > 1px on cards/alerts/list-items. Use a full border, a background tint, a leading number/icon, or nothing.
- **Gradient text** — `background-clip: text` over a gradient. Use a single solid color; emphasize with weight or size.
- **Glassmorphism as default** — decorative blur/glass cards. Rare and purposeful, or nothing.
- **The hero-metric template** — an oversized figure over a tiny caption, flanked by supporting stats and a gradient flourish. The default SaaS landing scaffold; reach for a real layout instead.
- **Uppercase tracked eyebrows above every section** and **numbered section markers (01 / 02 / 03) as default scaffolding.** One deliberate kicker or a real ordered sequence is voice; one on *every* section is AI grammar — pick a different cadence.
- **The cream / sand / beige body background** — the warm-neutral band (OKLCH L 0.84-0.97, C < 0.06, hue 40-100) reading as paper/parchment is the saturated AI default of 2026, tell-tale even under names like `--cream`/`--sand`/`--linen`. Carry "warmth" through accent + type + imagery, not a warm-tinted near-white body.
- **Text that overflows its container** at any breakpoint — long heading words + large `clamp()` + narrow grids. The viewport is part of the design; test heading copy at every width.

---

## Color strategy — commit before picking colors (vendored from impeccable)

Pick a strategy on the commitment axis first; picking colors without one produces the timid default.

- **Restrained** — tinted neutrals + one accent ≤ 10%. Product default.
- **Committed** — one saturated color carries 30-60% of the surface. Identity-driven pages.
- **Full palette** — 3-4 named roles, each used deliberately. Campaigns, data viz.
- **Drenched** — the surface IS the color. Heroes, campaign pages.

Use OKLCH. Dark vs light is never a reflex ("tools look cool dark", "light to be safe") — write one sentence of physical scene (who uses this, where, under what light, in what mood); if it doesn't force the answer, add detail until it does. Tint neutrals 0.005-0.015 toward the brand hue, never toward warm/cool "because it feels that way."

---

## Information architecture before visual design

The discipline is structural FIRST:

1. **What is the hierarchy?** What does the user need to read / do first, second, third?
2. **What is the primary action?** Singular. The page exists to lead to this action.
3. **What is supporting context?** Provided but recessed.
4. **What is noise?** Cut.

THEN visual:

5. Typography expresses the hierarchy
6. Color guides attention to the primary action
7. Motion communicates state change, not entertainment

AI-generated UI tends to skip the IA step and jump to visual. The result feels busy and unfocused.

---

## Density first

Information density > whitespace by default. Whitespace earns its place via hierarchy, not as default.

Generic AI output over-uses whitespace ("looks clean!") and under-uses density. Real users want to do work, not admire margins.

**How users actually read** (Krug, *Don't Make Me Think* — vendored via design-review): they *scan*, not read; they *satisfice* (pick the first reasonable option, so make the right choice the most visible one); they *muddle through*. Design rule: "omit needless words, then omit again." The **mindless-click test** — every decision point should be an obvious click, not a puzzle the user has to solve.

### Density heuristics

- Lists with > 3 items: tabular, not card-grid-with-images.
- Forms: compact, with inline labels when label space matches input width.
- Dashboards: tabular metrics with sparklines. Cards only for genuinely independent objects.
- Hero sections: useful from the first scroll. No 100vh splash without immediate value.

---

## Type hierarchy: 3 sizes max + weight + color

The design system tokens (in `pack-nextjs`) expose exactly 3 type sizes:

| Token | Use |
|---|---|
| `text-display` | Page hero, section header (rare) |
| `text-heading` | Section title |
| `text-body` | Everything else |

Differentiation within `text-body` comes from weight (`font-medium`, `font-bold`) and color (`text-primary`, `text-muted`).

### Specifics (vendored from impeccable)

- Cap body line length at **65-75ch**.
- Pair fonts on a **contrast axis** (serif + sans, geometric + humanist) or one family in multiple weights — never two similar-but-not-identical sans.
- Display heading `clamp()` max **≤ 6rem** (above that the page is shouting), letter-spacing floor **≥ -0.04em** (tighter and letters touch).
- `text-wrap: balance` on h1-h3; `text-wrap: pretty` on long prose.

### Banned

- Random custom font sizes (`text-[19px]`, `text-[27px]`, etc.) outside the token system
- Five+ levels of heading hierarchy
- Lowercase `text-xs` for body copy on mobile (under 14px is unreadable for many users)
- **`system-ui` / `-apple-system` as the primary display or body font** — the "I gave up on typography" tell. Choose a real typeface.

---

## Color guides attention

The primary action is the most saturated, most contrasted, most singular color on the screen. Everything else recesses.

- ONE primary action color per view. Two competing primaries = no primary.
- Secondary actions: muted, lower contrast.
- Tertiary: ghost / link style.
- Destructive: red — but reserve for actually destructive (delete, unsubscribe). Not for "Cancel."

WCAG AA contrast minimum (composes with `void-accessibility` — 4.5:1 normal text, 3:1 large / UI components).

---

## Motion: purpose-driven, < 250ms, ease-out

```css
/* allowed */
.dropdown-content { animation: slide-down 200ms ease-out; }

/* banned */
.hero-decoration { animation: float 8s ease-in-out infinite; }
```

Motion communicates state change. Not entertainment. Reserve for:

- Opening / closing (modal, dropdown, drawer)
- Affordance feedback (button press)
- State transition (success, error)

Duration: < 250ms. Easing: `ease-out` for entry, `ease-in` for exit. The design system (`pack-nextjs`) provides default tokens.

`prefers-reduced-motion` respected — composes with `void-accessibility`. The design system handles by default.

### Banned

- Looping decorative animations
- Bouncy easing on functional UI (`ease-in-out-back` etc.) — reserves for playful brands explicitly
- Animations longer than 250ms unless documented (page transitions, intentional reveals)

---

## Layout & interaction craft (vendored from impeccable)

- **Cards are the lazy answer** — use them only when they are truly the best affordance; nested cards are always wrong.
- **Flexbox for 1D, Grid for 2D.** Don't reach for Grid when `flex-wrap` fits. Responsive grid without breakpoints: `repeat(auto-fit, minmax(280px, 1fr))`.
- **Semantic z-index scale** (dropdown → sticky → modal-backdrop → modal → toast → tooltip). Never `999` / `9999`.
- **Vary spacing for rhythm** — uniform spacing reads as a wireframe.
- **Motion easing**: ease-out with exponential curves (quart / quint / expo); no bounce, no elastic on functional UI. Every animation needs a `prefers-reduced-motion` alternative (crossfade or instant).
- **Reveal animations must enhance an already-visible default** — never gate content visibility on a class-triggered transition; it pauses on hidden tabs / headless renderers and the section ships blank.
- **Dropdown clipping**: a `position: absolute` menu inside `overflow: hidden`/`auto` is clipped — use `<dialog>` / the popover API / `position: fixed` / a portal to escape the stacking context.

---

## Components from `@repo/ui`

Composed with `void-accessibility`. No hand-rolled UI primitives:

```tsx
// banned
<div className="px-4 py-2 bg-blue-500 rounded" onClick={...}>Submit</div>

// preferred
import { Button } from '@repo/ui';
<Button variant="primary" onClick={...}>Submit</Button>
```

`@repo/ui` is shadcn-style — Radix base + Tailwind tokens + design system extension. Provided by `pack-nextjs`.

---

## Composition with other skills

- **With `void-accessibility`**: a11y is a precondition. Shared mobile-first dual-quality invariant. Shared `viewport-screenshot-gate` hook.
- **With `void-typescript-strict`**: component props strongly typed; discriminated unions for variants; no `any` in UI.
- **With `void-code-review`**: dimensions `readability` and `correctness` include UI quality flags.
- **With `pack-nextjs`**: provides `@repo/ui` + design system tokens + Tailwind config + shadcn preset matching this discipline.
- **With `void-ui-review`**: the audit/critique ceiling to this build-time floor — it catches on an existing UI what this skill prevents while building. Downstream.
- **With `core:experience-designer`**: the read-only pre-build brief upstream; this skill implements it without absorbing product or audit ownership.
- **With `DESIGN.md`**: the brand contract (palette, type, motion, decisions) is UPSTREAM; this skill consumes it. The file is produced by `impeccable document`/`init` or authored by hand — the schema is the interface, not a gstack workflow.
- **With `forge`** (voidcorp plugin): market recon, 12-dimension critique, and multi-variant design prompts live there (the design-shotgun/consultation exploration), bridged by the `docs/specs/` `source: forge` artifact contract, not a code dependency.

---

## Companion hooks

- `viewport-screenshot-gate` (pre-PR on UI changes, shared with `void-accessibility`) — fails PRs lacking both mobile and desktop screenshots.
- `anti-ai-slop-grep` (pre-commit) — warns on banned copy patterns. Initial list of ~10; grows from `void-learn` harness-gap feedback.

See `../../hooks/`.

---

## Anti-rules

- MUST NOT decide brand identity (colors / typography / motion language) — `DESIGN.md` per project owns.
- MUST NOT do the audit/critique pass — that is `void-ui-review` (this skill is build-time; ui-review is audit-time).
- MUST NOT permit hand-rolled UI primitives.
- MUST NOT skip dual-viewport verification.
- MUST NOT silently allow banned copy / banned visual patterns.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Layout looks generic | Density audit. Information architecture first. Cut what does not earn its place. |
| Hero feels weak | Singular primary action. Recess everything else. Cut decorative gradient if generic. |
| Too many font sizes | Reduce to the 3-token system. Vary by weight and color. |
| Motion feels excessive | Cut decorative animations. Keep only state-change communication. |
| Mobile screenshot fails | Diagnose and repair the affected layout at 360–390px; retain unaffected proofs and verify desktop parity. |
| Cannot reach AA contrast | Design system token failure. Adjust palette tokens, not per-component overrides. |

---

## Final rule

```
Every UI → IA first, density first, 3-size hierarchy, motion <250ms, @repo/ui components, dual-viewport verified, brand-from-DESIGN.md.
Otherwise → it is not voidcorp frontend-design.
```

AI generates infinite UI. The discipline is what makes ours stop looking generated.
