# React 19 conventions (`@voidcorp/pack-react`)

This pack covers React component conventions independent of the framework (Next.js, Vite, Expo). For Next-specific layout see `@voidcorp/pack-nextjs`; for mobile-specific touch/safe-area see `@voidcorp/pack-mobile`.

## Components are pure UI

```
apps/<app>/src/components/
```

Components MUST:
- Receive data via props (never query DB)
- Defer side effects to event handlers or actions
- Use design tokens from `@repo/ui`, never inline hex/px
- Honor accessibility from the first render (composes with `void-accessibility`)

Components MUST NOT:
- `import { db } from '@/...'` — enforced by `no-db-in-components` hook
- Inline `fetch` to external APIs — go through a service
- `process.env.*` — use `@repo/core/env`
- Use `'use server'` — Server Actions live in `app/(actions)/`, not in `components/`

## Touch targets

Minimum 44×44 px (iOS HIG) / 48×48 dp (Material). Use `<Tappable>` from `@repo/ui` which enforces this automatically. Composes with `void-accessibility`.

## Dual-quality mobile-first

Design tokens express both "mobile baseline" and "desktop enhancement":

```ts
// @repo/ui/tokens.ts
export const space = { sm: 8, md: 16, lg: 24 } as const;       // baseline
export const spaceLg = { sm: 12, md: 24, lg: 40 } as const;    // desktop enhancement
```

Components default to baseline; opt into the enhancement via media query.

## shadcn/Radix primitives

- `@repo/ui` exports shadcn-style components built on Radix.
- Variants via `class-variance-authority`, never ad-hoc `if (variant === ...)` walls.
- Compose primitives; do not fork. If a primitive is missing, add it to `@repo/ui`, do not duplicate in apps.

## Composition

- `harness-nextjs` — App Router puts components in `apps/<app>/src/components/`.
- `harness-mobile` — React Native shares the same primitive contract (Tappable, tokens).
- `void-frontend-design` — anti AI-slop, sober palette, real density.
- `void-accessibility` — keyboard, screen reader, color contrast, touch targets.
