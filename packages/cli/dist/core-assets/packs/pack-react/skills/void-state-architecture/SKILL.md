---
name: void-state-architecture
description: Decide where state lives — local, lifted, URL, server, client global. The decision tree to avoid useState-in-the-wrong-place sprawl. Default to URL or server before reaching for global stores.
---

# state-architecture

Use when adding any state to a React app. The wrong location is the most common architectural drift: state ends up too high (every input re-renders the page), too low (sibling components can't communicate), or in a global store when URL would have sufficed.

## The decision tree (top → bottom; use the highest that works)

```
1. Can it live in the URL?            → URL search params or path segment
2. Can the server own it?              → DB / cache, render via Server Component
3. Is it ONE component's concern?      → useState in that component
4. Is it ≤ 3 sibling components?       → lift to closest common parent
5. Is it cross-tree client-only?       → Zustand (or Jotai for atoms)
6. Is it server data with caching?     → React Query (TanStack) / SWR
```

Default to (1) or (2). Reach for (5) last. Context is mentioned below but rarely the right answer.

## (1) URL state — the most under-used

State that should survive a refresh, be shareable, or be back-button-friendly belongs in the URL:

- Filters, sorts, pagination, tabs
- "Which item is selected" in a list/detail layout
- Modal open/closed when the modal is shareable (`?invite=true`)
- Search queries

```tsx
// Server Component reading searchParams
export default function Page({ searchParams }: { searchParams: { sort?: string } }) {
  const sort = searchParams.sort ?? 'newest';
  return <ItemList sort={sort} />;
}

// Client Component pushing to URL
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
export function SortSelect() {
  const router = useRouter();
  const params = useSearchParams();
  return <select onChange={(e) => router.push(`?${new URLSearchParams({ ...Object.fromEntries(params), sort: e.target.value })}`)}>...</select>;
}
```

The benefit: refresh works, share link works, back button works, server can SSR with the right data. Three lines of effort, huge UX win.

## (2) Server state — the second most under-used

If the data is in the database (or any server cache), the source of truth is the server. Don't mirror it into `useState`:

```tsx
// ✗ Client component fetching + storing
'use client';
export function UserCard({ userId }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch(`/api/users/${userId}`).then(r => r.json()).then(setUser); }, [userId]);
  if (!user) return <Spinner />;
  return <Card>{user.name}</Card>;
}

// ✓ Server Component fetching directly
export async function UserCard({ userId }: { userId: string }) {
  const user = await userService.getById(userId);
  return <Card>{user.name}</Card>;
}
```

When server-fetch isn't feasible (interactive lists with optimistic updates), reach for React Query — but read (1) and (2) first.

## (3) Local state — `useState` in one component

For state ONE component cares about (input value, dropdown open, hover, focus):

```tsx
const [open, setOpen] = useState(false);
```

Fine. Don't lift it. Don't put it in context. Don't put it in Zustand.

## (4) Lifted state — closest common parent

When 2-3 siblings share state, lift to the closest common parent. NOT to the page root, NOT to a layout, NOT to context. The closest common parent.

```tsx
function TabContainer() {                       // closest common parent
  const [active, setActive] = useState('overview');
  return (
    <>
      <TabHeader active={active} onChange={setActive} />
      <TabContent active={active} />
    </>
  );
}
```

If lifting forces you to drill props through 4+ levels, you have a structural problem — not a state location problem. Refactor the component tree first.

## (5) Client global state — Zustand / Jotai

Use **only** when:

- State is genuinely cross-tree (consumed by components that don't share a useful common parent — e.g., a toast queue, a command palette open state)
- And it's client-side only (no server source of truth)
- And lifting would cross > 5 component levels

```ts
// stores/toast.ts
import { create } from 'zustand';
export const useToast = create<{ items: Toast[]; push(t: Toast): void; dismiss(id: string): void }>(...);
```

If you can't justify ALL THREE conditions, don't add a store. Zustand is light but each store is a new mental load + a new place to debug.

## When Context is right

- Theme (rarely changes, deeply read)
- Locale / i18n (same)
- Auth user (Server Components read it from cookies; Client Components get a snapshot via `<UserProvider>`)

Anything that **changes frequently** (form state, list selection, hover) in Context **kills perf**: every consumer re-renders on every change. That's not a Context problem, that's a wrong-tool problem.

## Server state caching: React Query vs Server Components

If you're on RSC + Server Actions, your "server state" is fetched server-side. React Query becomes useful only for:

- Lists with optimistic updates that don't go through a Server Action (rare)
- Real-time data with explicit refetch needs (e.g., dashboards polling every 5s)
- Apps that aren't RSC (Vite SPA, Expo)

In Next.js App Router with Server Actions, you can mostly skip React Query.

## Anti-patterns

- ✗ **Storing form values in a Zustand store** — local state in the form component is correct
- ✗ **Storing server data in `useState`** — leads to stale data, refetch dance
- ✗ **Putting `filterValue` in Context** — every consumer re-renders on every keystroke
- ✗ **Using `useState` for what should be in the URL** — refresh loses state, share-link breaks
- ✗ **Three different stores for the same feature** (`useUserStore`, `useUserPreferencesStore`, `useUserSessionStore`) — fuse or use selectors

## Workflow

For each state you're about to add:

1. **Can it be URL?** If yes, use URL search params.
2. **Can it be server?** If yes, fetch in a Server Component.
3. **Does ONE component need it?** `useState` there.
4. **Do ≤3 siblings need it?** Lift to common parent.
5. **Genuinely cross-tree client-only?** Zustand store; one per concern.
6. **Server data with caching needs?** React Query, but exhaust 1+2 first.

## Composition

- `void-client-vs-server-component` — server state lives in Server Components, client state lives in Client Components.
- `void-form-pattern` — react-hook-form handles form state; this skill says it's local.
- `void-offline-first-mutation` — capture-queue uses IndexedDB for offline writes (a 7th tier above Zustand, scoped to writes-pending-sync).
- `void-cache-component-pattern` — server data caching strategy.
