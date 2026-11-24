---
name: void-client-vs-server-component
description: Decide which components run on server vs client in a React 19 / Next.js app and place the 'use client' boundary correctly. Server Components by default; client is the exception.
---

# client-vs-server-component

Use when creating any React 19 component in a project that supports Server Components (Next.js App Router, similar). The choice is **not** "type 'use client' if the component is interactive" — that's the lazy heuristic that leads to 80% of the app shipping to the browser.

## The default

**Server Component (no `'use client'`) by default.** Add `'use client'` only when you need browser-only APIs:

- React state hooks: `useState`, `useReducer`, `useContext`, `useRef`
- Effects: `useEffect`, `useLayoutEffect`
- Browser APIs: `window`, `document`, `localStorage`, `IntersectionObserver`
- Event handlers attached at component level (`onClick`, `onChange`, `onSubmit`)
- Third-party libraries that use any of the above

If your component does **none** of these — even if it ends up inside a Client Component — leave it server. RSC composition lets you pass server-rendered children into client wrappers.

## The boundary placement rule

Push `'use client'` **as far down the tree as possible**. Bad pattern:

```tsx
// ✗ app/dashboard/page.tsx
'use client';                                  // entire page becomes client
import { useState } from 'react';
import { UserList } from './UserList';        // also becomes client, even if it didn't need to

export default function Page() {
  const [filter, setFilter] = useState('');
  return (
    <>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} />
      <UserList filter={filter} />
    </>
  );
}
```

Good pattern — isolate the interactive part:

```tsx
// ✓ app/dashboard/page.tsx (Server)
import { UserList } from './UserList';         // stays server
import { FilterInput } from './FilterInput';   // client island

export default function Page() {
  return (
    <>
      <FilterInput />
      <UserList />
    </>
  );
}
```

`FilterInput` owns the `useState`. It can either:
- Push the filter to the URL and let `UserList` re-render server-side via search params
- Or render `<UserList />` as a child it receives from the server and re-filter client-side from a snapshot

The pattern: **client wraps server children**. Server Component as child of Client Component is allowed; the inverse is not.

## State + data: who owns what

| Concern | Lives on | Component type |
|---|---|---|
| URL params (`?filter=...`) | Server (read via `searchParams`) | Server Component |
| Persistent server-side data | Server (DB / cache) | Server Component fetching directly |
| Transient UI state (open/closed, focus, input value) | Client (`useState`) | Client Component |
| Cross-component client state | Client (URL > Zustand > Context) | Client provider tree |
| Optimistic updates | Client (capture-queue, see `void-offline-first-mutation`) | Client component |

When in doubt, ask: "does this state need to survive a hard refresh?" If yes → server (or URL). If no → client.

## Anti-patterns

- ✗ **`'use client'` at the top of `app/layout.tsx`** — destroys server rendering for the whole subtree
- ✗ **Wrapping all components in client just to use `<Link>`** — Next's `Link` works in Server Components
- ✗ **`useEffect` to fetch data in a Client Component when a Server Component could fetch it on the server** — slow, waterfall, ugly loading states
- ✗ **`import { db } from '@repo/db'` in a Client Component** — caught by `no-db-in-components` hook; refactor as a Server Action or Server Component fetch
- ✗ **Marking a leaf component `'use client'` because its parent is** — children inherit client mode if the parent passes them through children prop into a client wrapper; explicit `'use client'` is only needed where state/effects live

## Forms — special case

Use **Server Actions** (`'use server'`) called from a Server Component form. The form HTML is server-rendered. JS hydration adds progressive enhancement:

```tsx
// app/contact/page.tsx (Server)
import { sendContact } from './actions';

export default function Page() {
  return (
    <form action={sendContact}>
      <input name="email" type="email" required />
      <button type="submit">Send</button>
    </form>
  );
}
```

Need controlled state for validation feedback? Wrap just the input in a client component. The form action stays server.

## Performance signal: "JS payload"

Open DevTools → Network tab → filter by JS. If your `app/dashboard` route ships > 100KB of JS, you have too much client. Audit which components are `'use client'`. 90% should not be.

## Composition

- `void-cache-component-pattern` — Server Components ARE the cache substrate; mark `'use cache'` for caching.
- `void-state-architecture` — guides client-state placement once you've decided to use Client Components.
- `void-form-pattern` — react-hook-form + Zod for client-controlled forms (Server Actions otherwise).
- the `pack-react` doctrine module on components — components are pure UI either way (no DB, no fetch via service).
- `void-hexagonal-architecture` — Server Components can call services directly (they're the boundary); Client Components call Server Actions.
