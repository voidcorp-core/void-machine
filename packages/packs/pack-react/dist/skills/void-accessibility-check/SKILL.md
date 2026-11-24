---
name: void-accessibility-check
description: "Per-component accessibility checklist: semantic HTML, ARIA, keyboard, focus, contrast, touch targets. Auto-applies on any React component edit. Composes with accessibility."
---

# accessibility-check

Use when creating or editing **any React component** in a `components/` directory. The 7-point checklist below is the gate — if a component ships violating any of these, it ships broken for somebody.

Composes with `void-accessibility` (the generic doctrine and Radix-as-primitive philosophy). This skill is the **execution checklist** for one component.

If the file is in `services/`, `adapters/`, or `domain/`, this skill does not apply (those are not UI).

## When this skill triggers

- New file under `apps/*/src/components/` or `packages/ui/src/`
- Editing JSX in a component file
- "Add a button that does X" / "make this a card" / any UI creation

## The 7-point gate

A component does not ship until all 7 are satisfied. Each one has an easy check + the lazy mistake to avoid.

### 1. Semantic HTML

Choose the tag that matches the role, before reaching for ARIA.

- Action that submits or navigates → `<button>` or `<a>`, never `<div onClick>`.
- Heading → `<h1>` to `<h6>` in document order, never `<div className="text-2xl font-bold">`.
- List → `<ul>` / `<ol>` / `<li>`.
- Form control → `<input>`, `<select>`, `<textarea>` with associated `<label>`.

Lazy mistake: shadcn primitives wrap divs but expose the right role (via Radix). Always check the underlying element — `<DropdownMenuItem>` is keyboard-navigable because Radix sets `role="menuitem"`. Custom replacements lose that.

### 2. Labels and names

Every interactive element has a programmatic name accessible to screen readers.

```tsx
// ✓
<button aria-label="Close dialog"><XIcon /></button>
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// ✗
<button><XIcon /></button>                           // unnamed
<input type="email" placeholder="Email" />           // placeholder is NOT a label
```

Lazy mistake: relying on placeholder text. Placeholders disappear on focus and don't announce as labels. Use a real `<label>` or `aria-label`.

### 3. Keyboard navigation

Every interactive element reachable by Tab, operable by Enter / Space, dismissible by Esc (for modals/menus).

- Tab order follows visual order (avoid `tabIndex` ≥ 1).
- `outline` is **never** stripped without a replacement focus ring (use a `:focus-visible` style).
- Modals trap focus (Radix Dialog does this automatically; if you build a modal from scratch you must trap).

Lazy mistake: `outline: none` in global CSS. The focus ring is the only signal a keyboard user has for where they are.

### 4. Focus management on action

When an action changes context (open modal, route to new page, reveal an error):

- Modal opens → focus moves to the modal (Radix handles).
- Modal closes → focus returns to the trigger (Radix handles).
- Form submit with error → focus moves to the first invalid field, or to an error summary.
- Route change → focus moves to the new page's `<h1>` (or main content) on Next.js soft navigation (manual via `next/navigation` `useRouter` + `useEffect`).

Lazy mistake: forgetting to restore focus when a dialog closes — keyboard user lands at the top of the page.

### 5. Contrast

WCAG AA minimum:

- Normal text: **4.5:1** against background.
- Large text (≥ 18px bold or ≥ 24px): **3:1**.
- Interactive elements (button borders, focus rings, form field borders): **3:1**.

Quick checks:

- The design tokens in `@repo/ui` should already meet AA. If you reach for a non-token color, justify it in a comment.
- Disabled buttons are often the lazy violator (`opacity: 0.5` halves contrast).

Lazy mistake: gray-on-gray placeholder text. Most placeholders are 2.5:1 — fail.

### 6. Touch targets

Minimum **44×44 CSS px** (iOS HIG) / **48×48 dp** (Material). Applies to anything tappable.

```tsx
// ✓ Tappable from @repo/ui enforces it
<Tappable onPress={handlePress}><Icon /></Tappable>

// ✗ Bare icon with 24px hitbox
<button onClick={handlePress}><Icon size={24} /></button>
```

Lazy mistake: dense icon-only toolbars with 24-32px buttons. Fail on every phone.

### 7. Motion and reduced motion

Animations respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Or per-component via `useReducedMotion()` from Framer Motion.

Lazy mistake: shipping a beautiful parallax that triggers vestibular nausea for ~3% of users.

## Workflow

For each new or edited component:

1. **Run the 7-point gate mentally** before opening the JSX.
2. If you're not sure what role the component plays, write one sentence first: "this is a button that submits a form" / "this is a heading announcing the section". The sentence dictates the tag.
3. **Prefer Radix primitives** from `@repo/ui` over building from scratch — Radix gets roles, keyboard, focus right.
4. **Run a Lighthouse a11y audit** on the route the component lands in (`pnpm dlx @lhci/cli` or DevTools). Target score: 100. Anything under 95 = block.
5. **Manual keyboard test**: Tab through the component, Enter/Space/Esc as appropriate. If you have to use the mouse to operate it, it's broken.
6. **Screen reader test on at least one new component per PR**: macOS VoiceOver (`Cmd+F5`), Windows NVDA, Android TalkBack, or iOS VoiceOver. You'll hear gaps immediately.

## When AA is not enough

`void-accessibility` floor is AA. AAA is sometimes the goal for **specific surfaces** (form errors, primary CTAs). It's not the project-wide default — declare it explicitly in `PROJECT-DOCTRINE.md` if so.

## Composition

- `void-accessibility` — the doctrine; this skill is the gate.
- `void-frontend-design` — anti AI-slop, sober density, real visual hierarchy.
- the `pack-react` doctrine module on components — components are pure UI (no DB, no fetch) which is itself an a11y win (less surface to break).
- `void-tdd` — interactive components get jsdom tests asserting roles and keyboard behavior (`@testing-library/user-event`).
