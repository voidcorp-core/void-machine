---
name: void-route-group-decision
description: Decide when to use a (route-group), what to name it, and how to share layouts. The void-machine convention groups by trust boundary, not by visual section.
---

# route-group-decision

Use when adding any new route in `app/`, or when refactor an existing flat `app/` into groups. Route groups (folders named `(name)`) don't affect URL but DO affect layout and convention scope.

## The void-machine convention

```
app/
├── (api|actions)/        # trust boundaries (Server Actions, route handlers)
│   ├── (actions)/<feature>/
│   └── (api)/<resource>/route.ts
├── (marketing)/          # public, statically rendered, no auth
│   ├── layout.tsx        # marketing nav + footer
│   ├── page.tsx          # /
│   ├── pricing/page.tsx  # /pricing
│   └── blog/[slug]/page.tsx
├── (app)/                # authenticated app
│   ├── layout.tsx        # auth gate + app shell
│   ├── dashboard/page.tsx
│   └── settings/page.tsx
└── api/webhooks/<source>/route.ts   # webhooks NOT in (api|actions) — different lifecycle
```

The principle: **group by trust boundary and rendering model, not by visual section**.

## Why these specific groups

- `(api|actions)` — every file inside is a trust boundary. The skill `void-server-action` applies. The "no fetch in components" rule applies in reverse: these files MUST fetch / mutate.
- `(marketing)` — statically renderable (Cache Components opted in by default), no auth, indexable by search engines. Different layout (marketing nav vs app shell).
- `(app)` — authenticated. Layout checks session, redirects to login if absent. All routes inside trust the layout's auth gate.
- `api/webhooks/<source>/` — NOT in a route group because the convention is path-stable for external systems. Stripe sends to `/api/webhooks/stripe`, period.

## When to add a new group

You need ALL three:

1. **A distinct layout** the new routes share (not just a different page)
2. **A distinct trust posture** OR rendering model (cached vs dynamic, auth vs public)
3. **≥ 2 routes** that fit the group

If you'd only put one route inside, don't add the group. Put the route in the closest existing group or at top level.

## Naming the group

- Use parentheses: `(name)` — they're invisible in URL
- Lowercase, single word, plural if it represents a category
- Conventional names: `(api|actions)`, `(marketing)`, `(app)`, `(admin)`, `(public)`, `(authed)`
- Avoid: `(misc)`, `(stuff)`, `(my-new-feature)` — groups are coarse, not feature-scoped

## Sharing layouts across groups

You can't directly — groups are siblings, each owns its layout. To share a header across `(marketing)` and `(app)`:

- Option A: put the shared header in `app/layout.tsx` (the root)
- Option B: extract the header as a component, import in each group's layout

A is cleaner if the header is truly shared by every group. B is right if only some groups share it.

## The `app/layout.tsx` (root)

ONE root layout, contains:

- `<html>` and `<body>` tags (mandatory — only the root layout has these)
- Providers needed everywhere (Theme, i18n, Sentry, query client if RQ used)
- Global stylesheets

Should NOT contain:

- Navigation (lives in group layouts)
- Auth check (lives in `(app)/layout.tsx`)
- Marketing-specific markup

If root layout grows past 40 lines, you have layout-creep — push down.

## Parallel routes and intercepting routes — separate concept

`@modal`, `(.)`, `(..)`, `(..)(..)`, `(...)` are **NOT** route groups. They're parallel/intercepting routes. See `void-parallel-routes-slots` for that pattern.

A route group is `(name)` (parentheses around a folder). Don't confuse them.

## Anti-patterns

- ✗ **`(feature-name)` group for one route** — premature. Put the route at top level until you have a second.
- ✗ **Auth check in every page** instead of the `(app)/layout.tsx` — repetition + miss risk
- ✗ **Mixing public + authed routes in the same group** — the layout can't enforce a uniform auth posture
- ✗ **Group nesting**: `(app)/(admin)/...` — usually a smell. Flatten to `(admin)/` and put the auth check in its layout
- ✗ **Renaming a group after launch** — the convention is propagated through skill references and CLAUDE.md modules; rename is cheap technically but expensive culturally

## Workflow

1. **List the routes you're adding.** 3 routes? They probably go in one group.
2. **Identify the trust posture.** Public? Authed? Trust boundary? That picks the group.
3. **Check existing groups.** Does one fit? If yes, use it. Don't create new groups for routes that fit.
4. **Layout content:** what's truly shared between these routes? That's the layout. Everything else is page-specific.
5. **If creating a new group**, write an ADR (`void-decide`). Group convention drift is annoying to undo.

## Composition

- `void-cache-component-pattern` — `(marketing)` is cache-by-default; `(app)` mostly `'use no cache'`.
- `void-server-action` — `(actions)/` is where Server Actions live.
- `void-decide` — adding/renaming groups is ADR-worthy.
- `void-security-guidance` — `(app)/layout.tsx` is the auth boundary; redirects centralized here.
