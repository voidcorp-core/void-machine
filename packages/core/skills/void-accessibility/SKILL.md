---
name: void-accessibility
description: WCAG 2.2 AA floor. Radix primitives only, touch >=44x44, keyboard parity, semantic HTML, form labels, aria-live errors, mobile-first dual-quality. Use when building or modifying UI.
---

# accessibility — voidcorp craftsman edition

A11y is not a launch-time audit. It is the default at every interactive surface. Radix handles the hard parts; we honor the rules. Mobile-first dual-quality means both viewports ship at first-class quality.

**Attribution**: see `.source`. Foundation: WCAG 2.2 AA + Radix UI + Apple HIG + WAI-ARIA APG + Folpe mobile-first dual-quality.

---

## The floor

WCAG 2.2 AA is the minimum. Not the goal — the floor. Specific projects (regulated, public-sector) may target AAA via `voidcorp.config.json` `wcag_level: 'AAA'`.

---

## Interactive primitives — wrap Radix

```tsx
// banned
<div onClick={handleClick} role="button" tabIndex={0}>
  Submit
</div>

// allowed (Radix base)
<button onClick={handleClick}>Submit</button>

// preferred (shadcn-style via @repo/ui, wraps Radix)
import { Button } from '@repo/ui';
<Button onClick={handleClick}>Submit</Button>
```

Radix provides focus management, keyboard nav, ARIA wiring. Hand-rolling these is the #1 source of subtle a11y bugs.

For composite widgets (dropdown, dialog, popover, tooltip, tabs, accordion, slider, switch, toggle group, navigation menu) — use the Radix primitive. Period.

The companion `void-code-review` flag catches raw `<div onClick>` / `<span onClick>` on interactive surfaces.

---

## Semantic HTML over ARIA

```tsx
// banned
<div role="navigation">...</div>
<div role="heading" aria-level={2}>Title</div>

// allowed
<nav>...</nav>
<h2>Title</h2>
```

ARIA is the escape hatch for cases semantic HTML cannot express. The rule of least power: use HTML if it fits; reach for ARIA only when nothing else works.

---

## Contrast — AA minimum

| Type | Minimum ratio |
|---|---|
| Normal text | 4.5:1 |
| Large text (18pt+ or 14pt+ bold) | 3:1 |
| UI components / graphical objects | 3:1 |

The design system palette (in `pack-nextjs`) documents contrast ratios for every token combination. Tokens that fail AA are marked and not used for text.

The companion hook `axe-precommit` runs axe-core on staged UI changes and flags AA violations.

---

## Touch targets — Apple HIG floor

Every interactive element ≥ **44×44px**, regardless of viewport. Small icons are wrapped in a padded tap area.

```tsx
// banned
<button className="p-1"><Icon size={16} /></button>

// allowed (via @repo/ui Tappable)
<Tappable onClick={...}><Icon size={16} /></Tappable>
// Tappable enforces min-h-11 min-w-11 (44px) regardless of icon size
```

The `Tappable` helper (provided by `pack-nextjs`) enforces minimum dimensions via Tailwind classes.

---

## Keyboard navigation — parity with touch

For every UI interaction reachable by touch, there is a keyboard equivalent:

| Key | Action |
|---|---|
| Tab | Move focus forward |
| Shift+Tab | Move focus backward |
| Enter | Activate primary action |
| Space | Toggle / activate (per native semantics) |
| Escape | Close modal, popover, menu |
| Arrow keys | Navigate inside composite widgets (Radix handles this for Tabs, Menu, Slider, etc.) |

### Focus visible

Every focusable element shows a focus ring. Tailwind: `focus-visible:ring-2 focus-visible:ring-primary` (or design-system token).

### Banned

```css
/* banned */
outline: none;
```

without an alternative focus indicator (`focus-visible:ring-*` or equivalent).

---

## Skip-to-content

Every page with > 3 nav items has a skip-to-content link at the top:

```tsx
<a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 ...">
  Skip to content
</a>
<main id="main">...</main>
```

The companion `@repo/ui` `Layout` component provides this by default.

---

## Forms

### Labels associated

```tsx
// banned (placeholder as label)
<input type="email" placeholder="Email address" />

// allowed
<label htmlFor="email">Email address</label>
<input id="email" type="email" />

// or, when label is visually hidden
<label htmlFor="search" className="sr-only">Search</label>
<input id="search" type="search" placeholder="Search..." />
```

Placeholder is NOT a label — it disappears on input, often fails AA contrast, and is handled inconsistently by screen readers.

### Errors announced

```tsx
<label htmlFor="email">Email address</label>
<input id="email" aria-describedby="email-error" />
{error && (
  <p id="email-error" role="alert" aria-live="polite">
    {error.message}
  </p>
)}
```

Screen readers receive the update. Visual users see it too.

---

## Color is not the only signal

Success / error / warning indicators combine COLOR + ICON + TEXT:

```tsx
// banned (color only)
<span className="text-red-500">Failed</span>

// allowed
<span className="text-red-500 flex items-center gap-1">
  <XCircleIcon className="h-4 w-4" aria-hidden="true" />
  Failed
</span>
```

Colorblind users get parity. The aria-hidden on the icon prevents it from being announced redundantly.

---

## Mobile-first dual-quality

Every UI is designed mobile-first AND must reach first-class quality on both viewports simultaneously. (Folpe rule, documented in `.void/installed/PHILOSOPHY.md`.)

### Concrete invariants

- Layout starts at **360–390px** (iPhone 12 mini → iPhone 15 Pro), progressively enhanced wider.
- Touch targets ≥ 44×44 on every interactive element regardless of viewport.
- Keyboard navigation parity with touch.
- Performance budget: LCP < 2.5s on slow 4G mobile AND on desktop fiber (measure with the project's perf tooling — Lighthouse CI, WebPageTest, bundlesize).
- No mobile-only nor desktop-only features without an explicit decision recorded through the `void-decide` skill.
- Both viewports screenshot-reviewed before merge.

The companion `viewport-screenshot-gate` hook (shared with `void-frontend-design`) is an optional PR-text heuristic; it does not validate images or enforce a native/CI gate. Review the actual mobile and desktop captures before merge.

---

## Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

The design system handles this by default in `pack-nextjs`. Specific animations may override with a reduced-motion variant.

---

## Banned

- `<div onClick>` / `<span onClick>` on interactive elements
- `outline: none` without a focus alternative
- Placeholder text as label
- Color as only indicator
- Custom dropdown / modal / tooltip implementations (use Radix)
- Auto-playing media with sound
- `tabIndex="-1"` to remove from tab order without a reason (rare legitimate cases: programmatically focused after user action)

---

## Companion hooks

- `axe-precommit` (pre-commit on UI changes) — axe-core static analysis, blocks on AA violations. ≤ 80 LOC.
- `viewport-screenshot-gate` (pre-PR on UI changes, shared with `void-frontend-design`) — optional PR-text heuristic, not a wired native/CI gate or image validation. Review actual captures.

---

## Composition with other skills

- **With `void-frontend-design`**: shared mobile-first dual-quality invariant. `void-frontend-design` decides density / hierarchy / motion; this skill enforces a11y across them.
- **With `void-code-review`**: dimension `correctness` includes a11y at the UI surface.
- **With `pack-nextjs`**: provides `@repo/ui` (Radix-wrapped) + `Tappable` + axe-core integration + design system palette tokens.
- **With `void-ui-review`**: its technical-audit pass includes the a11y dimension (contrast, keyboard, focus, 44px) — composes with this skill. Live-URL visual a11y audit is deferred to Vague 4.
- **With `DESIGN.md`**: the design-system contract incorporates a11y constraints (produced by `impeccable document`/`init` or by hand).

---

## Anti-rules

- MUST NOT decide visual design (color, typography, motion language).
- MUST NOT silently allow `<div onClick>` on interactive surfaces.
- MUST NOT permit `outline: none` without alternative.
- MUST NOT skip dual-viewport verification.
- MUST NOT permit color-only indicators.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Need a custom widget Radix does not have | Check WAI-ARIA APG patterns. Implement carefully. Add to design-system docs. |
| Contrast token fails AA | Adjust the palette OR use a token marked for non-text usage only. |
| Cannot tab into composite widget | Verify Radix primitive is used. Hand-rolled focus management is the #1 bug source. |
| Touch target too small | Wrap in `Tappable`. |
| Reduced-motion conflicts with critical animation | Document the exception + provide a non-motion alternative. |

---

## Final rule

```
Every UI → Radix primitive, AA contrast, ≥ 44px touch, keyboard parity, semantic HTML, form labels, dual-viewport verified.
Otherwise → it is not voidcorp accessibility.
```

A11y is not a tax. It is the floor. Build on it; do not negotiate with it.
