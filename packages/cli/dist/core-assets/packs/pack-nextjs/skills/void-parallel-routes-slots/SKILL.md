---
name: void-parallel-routes-slots
description: Use Next.js parallel routes (@slot) and intercepting routes ((.)foo) — when they're the right tool, when they're an anti-pattern. The "modal that's also a deep-linkable page" archetype.
---

# parallel-routes-slots

Use when you need to render **multiple independent UI pieces in the same layout that can navigate independently**, or to **show a modal that's also a deep-linkable route**. Parallel routes and intercepting routes are powerful but easy to mis-apply.

If you only need a different page at a different URL → use a normal route. No slots needed.

## Parallel routes (`@slot`)

A `@slot` folder is a **named layout slot** that can be filled by any of its child pages.

```
app/dashboard/
├── @analytics/
│   ├── page.tsx                # default content for the slot
│   └── audience/page.tsx       # different content at the slot
├── @team/
│   ├── page.tsx
│   └── invite/page.tsx
└── layout.tsx                  # consumes both slots
```

```tsx
// app/dashboard/layout.tsx
export default function Layout({
  children,
  analytics,
  team,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  team: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <main className="col-span-2">{children}</main>
      <aside>{analytics}</aside>
      <aside>{team}</aside>
    </div>
  );
}
```

Each slot can independently navigate. The URL `/dashboard/audience/invite` could render `@analytics/audience` AND `@team/invite` AND the main `children` page simultaneously.

## When parallel routes WIN

- **Dashboard layouts** with widgets that load independently and can be refreshed/navigated without rerouting the main view
- **Admin panels** with side panels showing different details based on selection
- **Layouts where streaming partial content matters**: each slot has its own loading.tsx, so the user sees content as each piece arrives

## When parallel routes LOSE

- A single page with sections → just compose components in the page, no slots needed
- Conditional rendering based on user role → handle in the page, not via slots
- Modals (use intercepting routes — different mechanism, below)
- Mobile-first apps where slot layouts collapse to stack anyway → adds complexity for no gain on mobile

## Default content (`page.tsx`) per slot

Every slot **must** have a `page.tsx` rendering its default empty state. Without it, you get a 404 when the slot is "empty" but the parent route renders. Common forgetting → cryptic Next errors.

## Intercepting routes — the modal pattern

`(.)foo`, `(..)foo`, `(..)(..)foo`, `(...)foo` intercept a URL and render a different component **based on how the user arrived**.

```
app/
├── photos/
│   ├── [id]/
│   │   └── page.tsx              # full-page photo view
│   └── page.tsx                  # photo grid
└── @modal/
    └── (.)photos/[id]/
        └── page.tsx              # modal photo view
```

When the user is on `/photos` and clicks a photo, the URL changes to `/photos/123` but they see a MODAL on top of the grid (the intercepting route fires). If they refresh or share the link, they get the full-page view.

This is the **deep-linkable modal** pattern — modal for in-app navigation, full page for direct link.

## Intercepting route syntax

| Pattern | Means |
|---|---|
| `(.)foo` | Intercept `foo` from the same level |
| `(..)foo` | Intercept `foo` from one level up |
| `(..)(..)foo` | Intercept from two levels up |
| `(...)foo` | Intercept from the root |

The dots count is **route-segment** counts, not file-path. Easy to miscount.

## When intercepting routes WIN

- Photo viewer, image gallery (the canonical use case)
- "Edit" / "Quick view" overlays that should be linkable
- Onboarding wizards that take over the UI but stay on a route

## When intercepting routes LOSE

- Truly transient modals (delete confirmation, settings) — use state, not routes
- Mobile drawers / sheets — usually trigger different UX patterns, intercepting is overkill
- Modals that aren't shareable — adds URL complexity for no benefit

## Anti-patterns

- ✗ **Slots without default `page.tsx`** — runtime errors when slot is "empty"
- ✗ **Nested intercepting routes** — debugging becomes impossible
- ✗ **Mixing slots with `useState` modal management** in the same surface — pick one
- ✗ **Slot for what should be a component** — if the content doesn't navigate independently, it's a component, not a slot
- ✗ **Intercepting routes that don't have a non-intercepting fallback** — refresh shows 404 instead of the full-page view

## Workflow

1. **Default**: simple route. No slots. No interception.
2. **Need independent loading + navigation** of UI pieces in same layout? → parallel routes
3. **Need a modal that's also a deep link** (refresh works, share link works)? → intercepting routes
4. **Otherwise**: state-managed modal/sheet via `useState` + Radix Dialog.

## Composition

- `void-route-group-decision` — slots and intercepting routes live within route groups.
- `void-cache-component-pattern` — each slot has its own cache scope.
- `void-loading-error-boundaries` — slots can have their own `loading.tsx`, `error.tsx`.
- `void-state-architecture` — transient modals use `useState`, not routes.
