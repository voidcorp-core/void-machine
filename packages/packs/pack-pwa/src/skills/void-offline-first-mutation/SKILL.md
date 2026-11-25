---
name: void-offline-first-mutation
description: "Implement a UI mutation that works offline via the capture-queue + sync pattern: IndexedDB, optimistic UI, idempotency keys, retry, conflict resolution. Self-contained, no harness wrappers."
---

# offline-first-mutation

Use when implementing **any user-triggered write** in a PWA that must succeed when the device is offline (mobile in subway, mobile in field, flaky wifi) and reconcile when connectivity returns.

If the mutation is read-only or the user can tolerate "please try again when online", this skill does not apply.

## When this skill triggers

- "User taps the save button" / "user posts a comment" / "user updates a profile field"
- "Capture this action even if offline"
- Any flow where dropping the user's input is a product failure

## The model (capture-queue + sync)

```
┌────────────┐    enqueue    ┌─────────────┐    sync()    ┌──────────────┐
│ UI write   │ ────────────► │ IndexedDB   │ ───────────► │ Server Action │
│ (optimistic│               │ capture     │              │ (or POST API) │
│  update)   │               │ queue       │              └──────────────┘
└────────────┘               └─────────────┘                       │
       ▲                            │                              ▼
       │       conflict ?           │                       commit | reject
       └────────────────────────────┴───── server wins ────────────┘
```

Three guarantees:

1. **Local first**: UI updates synchronously from the optimistic state — the user never waits for the network.
2. **Durable**: the intent is persisted to IndexedDB **before** the UI confirms; an immediate browser crash doesn't lose it.
3. **Idempotent**: each intent carries a client-generated `idempotencyKey` so retries are safe.

## Anatomy of an intent

```ts
type Intent<TPayload> = {
  readonly id: string;                  // client UUID v7 — sortable, also serves as idempotencyKey
  readonly kind: string;                // 'note.create', 'contact.update', etc.
  readonly payload: TPayload;           // serializable
  readonly createdAt: number;           // epoch ms (client clock; used for ordering, not for truth)
  readonly attempts: number;            // bumped on each retry
  readonly status: 'pending' | 'syncing' | 'committed' | 'failed';
  readonly lastError?: { code: string; message: string };
};
```

`status` transitions:

- `pending` → `syncing` (sync picks it up, network in-flight)
- `syncing` → `committed` (server returned 2xx)
- `syncing` → `pending` (retryable error: network, 5xx, 429 — schedule next attempt with backoff)
- `syncing` → `failed` (non-retryable: 4xx other than 429 — surface to user, do not retry automatically)

## Capture-queue primitives (write them once per project)

The capture-queue is small enough to own outright. Write these in your project (e.g., `packages/offline/src/`):

```ts
// packages/offline/src/capture-queue.ts
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'offline-queue';
const STORE = 'intents';

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function enqueue<T>(intent: Omit<Intent<T>, 'attempts' | 'status' | 'createdAt'> & { createdAt?: number }): Promise<Intent<T>> {
  const full: Intent<T> = {
    ...intent,
    createdAt: intent.createdAt ?? Date.now(),
    attempts: 0,
    status: 'pending',
  };
  const d = await db();
  await d.put(STORE, full);
  return full;
}

export async function pending(): Promise<Intent<unknown>[]> {
  const d = await db();
  return (await d.getAll(STORE)).filter((i) => i.status === 'pending');
}

export async function markStatus(id: string, status: Intent<unknown>['status'], lastError?: Intent<unknown>['lastError']): Promise<void> {
  const d = await db();
  const intent = await d.get(STORE, id);
  if (!intent) return;
  await d.put(STORE, { ...intent, status, lastError, attempts: intent.attempts + (status === 'pending' ? 1 : 0) });
}

export async function failed(): Promise<Intent<unknown>[]> {
  const d = await db();
  return (await d.getAll(STORE)).filter((i) => i.status === 'failed');
}
```

## Sync engine

```ts
// packages/offline/src/sync.ts
import { pending, markStatus } from './capture-queue';

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000, 300_000, 1_800_000, 14_400_000]; // 2s..4h

export type SyncHandler<T> = (intent: Intent<T>) => Promise<void>;

export async function sync(handlers: Record<string, SyncHandler<unknown>>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const items = await pending();
  for (const intent of items) {
    const handler = handlers[intent.kind];
    if (!handler) continue;

    await markStatus(intent.id, 'syncing');
    try {
      await handler(intent);
      await markStatus(intent.id, 'committed');
    } catch (err) {
      if (isPermanentFailure(err)) {
        await markStatus(intent.id, 'failed', { code: 'permanent', message: String(err) });
      } else {
        // Schedule retry — caller's responsibility to call sync() again after backoff
        await markStatus(intent.id, 'pending', { code: 'transient', message: String(err) });
      }
    }
  }
}

function isPermanentFailure(err: unknown): boolean {
  // Adapt to your error types — 4xx (not 429) is permanent
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: number }).status;
    return s >= 400 && s < 500 && s !== 429;
  }
  return false;
}
```

That's ~60 lines of code consumers OWN — not a wrapper from this pack. Easier to debug, easier to adapt to your stack (Dexie, idb-keyval, raw IndexedDB).

## Use it in a component

```tsx
'use client';

import { useState } from 'react';
import { enqueue } from '@/offline/capture-queue';
import { sync } from '@/offline/sync';
import { createNoteAction } from '@/actions/notes';

export function NoteForm() {
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formData: FormData) {
    setSubmitting(true);
    const intent = await enqueue({
      id: crypto.randomUUID(),
      kind: 'note.create',
      payload: {
        title: formData.get('title'),
        body: formData.get('body'),
      },
    });

    // Optimistic UI update — show the note in the list immediately
    addNoteOptimistic({ id: intent.id, ...intent.payload, status: 'pending' });

    // Kick off sync in background — do not await
    sync({
      'note.create': async (i) => {
        await createNoteAction({
          idempotencyKey: i.id,
          ...(i.payload as { title: string; body: string }),
        });
      },
    });

    setSubmitting(false);
    // Form clears immediately — the optimistic note is in the list already.
  }

  return <form action={onSubmit}>...</form>;
}
```

## Server-side idempotency

The Server Action MUST honor `idempotencyKey`:

```ts
'use server';

export async function createNoteAction(input: { idempotencyKey: string; title: string; body: string }) {
  // Inbox pattern: check if we've already committed this key
  const existing = await db.query.notes.findFirst({
    where: eq(notes.idempotencyKey, input.idempotencyKey),
  });
  if (existing) return { ok: true, data: existing };       // safe re-deliver

  // Otherwise create + commit
  const [created] = await db.insert(notes).values({ ... }).returning();
  return { ok: true, data: created };
}
```

The `idempotencyKey` column on the notes table needs a unique index. Migration follows the safe pattern (see `void-drizzle-migration-safe`).

## Conflict resolution

When the server response contradicts the local optimistic state (e.g., a concurrent edit from another device), the **server wins**. Two cases:

- **Field-level conflict** (last-write-wins): server returns its version, UI overwrites the optimistic state.
- **Validation rejection** (e.g., title became required): mark intent as `failed`, surface a toast to the user with the option to edit and retry.

For richer reconciliation (operational transforms, CRDTs), don't try to roll your own — use Yjs or Automerge. Outside this skill's scope.

## Backoff schedule

Default retry intervals: **2s, 5s, 15s, 60s, 5min, 30min, 4h**. After 4h with no success, mark `failed` and notify the user. Driven by the caller (re-call `sync()` from a `setTimeout` or `requestIdleCallback` chain).

Pause sync entirely when `navigator.onLine === false`. Resume on `online` event:

```ts
window.addEventListener('online', () => sync(handlers));
```

## Dead-letter

Intents in `failed` status surface in a dead-letter UI (`Settings → Pending sync`) where the user can:

- Retry manually (`markStatus(id, 'pending')` + `sync()`)
- Edit and resubmit (creates a new intent, discards the old)
- Delete (drops the change permanently)

Never silently drop a failed intent — the user wrote it, it's their data.

## Anti-patterns

- ✗ **Optimistic update without persistence**: tab close = lost data.
- ✗ **Client-generated IDs that aren't UUID v7 / ULID**: ordering breaks across devices.
- ✗ **`idempotencyKey` reused across mutations**: server returns the wrong response.
- ✗ **Showing "Saved!" toast on enqueue**: lies to the user — sync hasn't happened. Use "Captured" or no toast.
- ✗ **Catching `failed` errors and swallowing them**: dead-letter MUST be visible.
- ✗ **Mixing capture-queue with React Query**: pick one for mutations. RQ for reads, capture-queue for offline-tolerant writes.

## Composition (informational)

- `void-server-action` — sync target; idempotency-key handling lives there.
- `void-async-safety` — backoff schedule, dead-letter, bounded retry semantics.
- `void-drizzle-migration-safe` — adding the `idempotencyKey` unique index.
- `void-observability` — log sync attempts with `idempotencyKey` so a failed intent can be traced end-to-end.
