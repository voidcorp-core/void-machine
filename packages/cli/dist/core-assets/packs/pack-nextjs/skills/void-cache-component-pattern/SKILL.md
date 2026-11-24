---
name: void-cache-component-pattern
description: Use Next.js 16 Cache Components correctly — when to opt in ('use cache'), when to opt out ('use no cache'), cache key strategy, scoping by user/org. Default is cached; uncache deliberately.
---

# cache-component-pattern

Use when writing or modifying any Next.js 16 Server Component, route handler, or fetch in `app/`. Cache Components is Next 16's default-cache model — flipping the previous default-dynamic stance. Getting this right is the difference between a page rendered in 30ms (cached) and 800ms (regenerated every request).

## The default

Next 16 caches by default at the Server Component / fetch level. You opt out, not in. This is the inverse of Next 13/14.

```tsx
// app/blog/[slug]/page.tsx — cached by default
export default async function Page({ params }: { params: { slug: string } }) {
  const post = await db.query.posts.findFirst({ where: eq(posts.slug, params.slug) });
  return <Article post={post} />;
}
```

This page IS cached. The `params.slug` is the key. New slugs trigger a fresh render; existing slugs serve from cache.

## When to opt OUT — `'use no cache'`

Some content cannot be cached. Tag the component or fetch:

```tsx
// app/dashboard/page.tsx — user-specific
'use no cache';

export default async function Page() {
  const user = await getCurrentUser();      // session-dependent
  return <Dashboard user={user} />;
}
```

Use `'use no cache'` when the response depends on:

- Current user identity (`getCurrentUser`, `cookies()`, `headers()`)
- Live data with sub-minute staleness requirements (real-time dashboards, inbox)
- Random sampling, A/B tests at render time
- `Date.now()` or similar non-deterministic inputs you don't want to key

The rule: if the same URL could legitimately render two different responses to two different users, opt out.

## Per-fetch opt-out

Inside a component that's MOSTLY cacheable but has one dynamic call:

```tsx
export default async function Page() {
  // Cached
  const post = await db.query.posts.findFirst({ where: eq(posts.slug, slug) });

  // Not cached — re-fetched every request
  const liveViewerCount = await fetch('https://api/views', { cache: 'no-store' });

  return <Article post={post} viewers={liveViewerCount} />;
}
```

`{ cache: 'no-store' }` opts out one fetch. The page stays cached for the parts that can be.

## Cache key strategy

The key for a cached component is **automatically derived** from:

- Route params (`[slug]`, `[id]`)
- Search params used in the component (only those READ; uses are tracked)
- Cookies / headers used (tracked similarly — but reading these usually opts you out automatically)

You influence the key by what you read. To cache one variant per locale:

```tsx
// app/[locale]/page.tsx
export default async function Page({ params }: { params: { locale: string } }) {
  return <Home locale={params.locale} />;
}
```

`/en` and `/fr` are separate cache entries because `locale` is in the URL.

To cache one variant per org WITHOUT putting org in the URL: don't. Put it in the URL. Caching cross-cuts user scopes is a security accident waiting to happen.

## The "shared cache across users" trap

```tsx
// ✗ DANGEROUS — caches user-specific data under a route-only key
export default async function Page() {
  const user = await getCurrentUser();
  const posts = await db.query.posts.findMany({ where: eq(posts.authorId, user.id) });
  return <PostList posts={posts} />;
}
```

If Next caches this without realizing `user.id` is in play, user A could see user B's posts. The `getCurrentUser` call reads cookies, which marks the page dynamic — but only if Next is configured correctly. **Always add `'use no cache'` when the response depends on the user, even if Next "would have" detected it.** Belt and braces; the cost of being explicit is zero, the cost of a leak is unbounded.

## `revalidate` for time-based freshness

Cached but with a maximum age:

```tsx
export const revalidate = 60;  // seconds

export default async function Page() { ... }
```

Use cases: news headlines, leaderboards, dashboards updated every minute. The cache serves stale content for up to 60s, then re-renders on the next request.

For tag-based revalidation (invalidate specific entries after a mutation):

```tsx
import { revalidateTag } from 'next/cache';

export async function publishPost() {
  await db.insert(posts).values(...);
  revalidateTag('posts-list');
}
```

In the cached component: `fetch(url, { next: { tags: ['posts-list'] } })`. The tag links them.

## `revalidatePath` vs `revalidateTag`

| Function | Use when | Scope |
|---|---|---|
| `revalidatePath('/blog/[slug]', 'page')` | One specific page invalidated after a mutation | Single path |
| `revalidatePath('/blog', 'layout')` | A whole subtree invalidated (rare) | Layout + all children |
| `revalidateTag('posts-list')` | Multiple pages share the same data | Every fetch with that tag |

Default to `revalidateTag`. Path-based revalidation is fragile (parameterized paths are tricky).

## Anti-patterns

- ✗ **`'use no cache'` at the layout level** — blanket-opts-out the entire subtree. Use it on specific routes.
- ✗ **Caching `getCurrentUser()` results** — `cache(getCurrentUser)` is a request-scoped React `cache`, NOT a cross-request Next cache; don't confuse the two
- ✗ **`revalidate = 0`** — equivalent to `'use no cache'` but less explicit. Use the directive.
- ✗ **Broad `revalidatePath('/')` after every mutation** — kills cache hit rate; be surgical
- ✗ **Mixing `cache: 'no-store'` AND `next: { revalidate }` on the same fetch** — they conflict; pick one

## Debug: "is this actually cached?"

Add a server-side `console.log(Date.now())` in the Server Component. Hit refresh. If the timestamp changes, the page is NOT cached. If it's stable across refreshes, it is.

Or use Next's built-in `?_cache-debug=1` (if available in your version) to inspect cache hit/miss per route in DevTools.

## Workflow

1. **Before writing the component**, ask: does the response depend on the user, on cookies, or on "right now"?
2. **If yes**, top of the file: `'use no cache';`. Done.
3. **If no**, leave it cached. No directive needed.
4. **Per-fetch overrides** for surgical exceptions (one dynamic fetch in a mostly-cached page).
5. **Tag your fetches** if they'll need invalidation after mutations (`next: { tags: [...] }`).
6. **Invalidate from Server Actions** via `revalidateTag` after the mutation succeeds.

## Composition

- `void-client-vs-server-component` — only Server Components participate in Cache Components.
- `void-server-action` — actions call `revalidateTag` / `revalidatePath` after mutations.
- `void-security-guidance` — explicit `'use no cache'` on user-scoped content is a security control, not just a perf one.
- `void-observability` — log cache misses on routes you expect cached; surface as a perf signal.
