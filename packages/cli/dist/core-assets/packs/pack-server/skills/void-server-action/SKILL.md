---
name: void-server-action
description: "Create a Next.js 16 Server Action with the void trust-boundary checklist: Zod ingress, auth, rate limit, observability, structured errors. Composes with security-guidance, async-safety."
---

# server-action

Use when adding any `'use server'` function (in Next.js, Hono, or any Server Action-capable runtime) following the void-machine `pack-server` conventions. Server Actions cross a trust boundary — the input came from a browser. Treat them like HTTP handlers, not like internal function calls.

If the function is **not** marked `'use server'` (it's a normal service function in `src/services/`), use `void-tdd` directly and skip this skill.

## When this skill triggers

- "Add a Server Action for X"
- "Create the action that handles the contact form"
- "Wire this button to a mutation"
- Any new file or function exporting `'use server'`

## Location (mandatory)

```
apps/<app>/src/
├── actions/<feature>/<verb>.ts          # preferred: typed Server Actions
└── app/<route>/_actions.ts              # only if tightly coupled to one route
```

Server Actions **never** live inside `packages/`. Packages own services (pure-by-default); apps own actions (the trust boundary).

## The five non-negotiable layers (in order)

Every Server Action goes through these layers, top to bottom, **always**:

```
1. Auth          — verify session; reject unauthenticated requests
2. Zod ingress   — schema validates the input object (no untyped formData)
3. Rate limit    — per-user or per-IP (see rate-limit-strategy)
4. Observability — trace ID, Sentry user scope (anonymized via hash)
5. Service call  — pure domain logic in src/services/<feature>/
```

Skipping any of these is a security or operability bug. There are no "internal" Server Actions — anything `'use server'` is reachable from the public internet via a forged request.

## Canonical skeleton (vanilla — no wrapper assumed)

```ts
// apps/web/src/actions/billing/cancel-subscription.ts
'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { logger, env } from '@repo/core';
import * as Sentry from '@sentry/nextjs';
import { ratelimit } from '@/adapters/ratelimit';
import { getSession } from '@/services/auth';
import { cancelSubscription as cancelSubscriptionService } from '@/services/billing/cancel';

const Input = z.object({
  subscriptionId: z.string().uuid(),
  reason: z.string().min(1).max(500).optional(),
});

export async function cancelSubscription(raw: unknown) {
  // 1. Auth
  const session = await getSession(cookies());
  if (!session) return { ok: false as const, error: 'unauthenticated' };

  // 2. Zod ingress
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: 'invalid-input' };
  const input = parsed.data;

  // 3. Rate limit (per-user)
  const rl = await ratelimit.check(`user:${session.userId}:billing.cancel`, { window: '1 min', max: 5 });
  if (!rl.ok) return { ok: false as const, error: 'rate-limited' };

  // 4. Observability — trace context + Sentry scope (hashed user)
  Sentry.setUser({ id: hashUserId(session.userId) });
  const traceId = crypto.randomUUID();
  logger.info({ traceId, userId: session.userId, action: 'billing.cancelSubscription' }, 'start');

  // 5. Service call — pure
  const result = await cancelSubscriptionService({
    subscriptionId: input.subscriptionId,
    userId: session.userId,
    reason: input.reason,
  });

  if (!result.ok) {
    logger.warn({ traceId, error: result.error }, 'cancelSubscription failed');
    return { ok: false as const, error: result.error.code };
  }
  return { ok: true as const, data: result.value };
}
```

40 lines. The 5 layers are explicit and a reviewer can audit at a glance.

## Optional: `defineAction` helper

If your project repeats the 5 layers in every action (it will), DRY them into a `defineAction` helper. This is a project-side convention many void-machine monorepos add in `@repo/auth` or `@repo/server`:

```ts
// Equivalent action using a project-side defineAction helper
export const cancelSubscription = defineAction({
  name: 'billing.cancelSubscription',
  auth: 'required',
  input: Input,
  rateLimit: { window: '1 min', max: 5 },
  handler: async ({ input, user, traceId }) => {
    /* just the service call + result mapping */
  },
});
```

The helper is convenience — the 5 layers below it are the substance. Build it once when the pattern repeats 3+ times; not before.

## Return type discipline

Server Actions return a **discriminated union**, never throw to the client:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };       // error is a stable, human-readable code
```

- ✗ Don't return raw domain objects — they leak schema. Pick a DTO.
- ✗ Don't `throw new Error('...')` — Next swallows the message and the client sees a 500 with no actionable info. Use the Result type.
- ✗ Don't return Date or BigInt — they don't serialize across the action boundary. Convert in the handler.

## Forbidden

- `db.query(...)` directly in the action — call a service. The service calls a repository.
- `process.env.STRIPE_KEY` — use `@repo/core/env`.
- Inline `fetch('https://external/...')` — go through an adapter behind a port.
- `revalidatePath('/')` without scope — pass the specific path you mutated; broad revalidation kills cache hit rate.
- `redirect('...')` from inside a `try/catch` — Next.js `redirect()` throws on purpose; catching it breaks navigation.

## Forms vs. typed actions

Two flavors, pick by use case:

| Use | Action signature | Input source |
|---|---|---|
| Submit-on-click button / typed payload | `async function(input: T)` | Object (Zod object schema) |
| HTML form with `<form action={action}>` | `async function(formData: FormData)` | FormData (Zod parses entries; `getAll` for repeated fields) |

For the FormData variant, always parse via Zod — never reach into FormData manually with raw `.get()` casts. But `Object.fromEntries(formData)` is **not** a safe default: it keeps only the **last** value of a repeated field, so a multi-select, a checkbox group, or `<input multiple>` is silently truncated to one entry. Read any field that can repeat with `getAll` and validate it as an array:

```ts
const schema = z.object({
  title: z.string().min(1),
  tagIds: z.array(z.string()).default([]),   // repeated field
});
// Single-value fields via .get(); repeated fields via .getAll().
const input = schema.parse({
  title: formData.get('title'),
  tagIds: formData.getAll('tagId'),
});
```

`Object.fromEntries(formData)` is fine only when every field is known-single-valued — and that assumption breaks the day someone adds a multi-select. Prefer the explicit shape above for any form with a repeatable input.

## Workflow

1. **Define the service first**, in `src/services/<feature>/<verb>.ts`. Pure-by-default; deps injected; tested in strict TDD mode.
2. **Write the Zod input schema** in the action file. Aim for the smallest possible surface; reject unknown keys.
3. **Pick the action shape**: object input (typed payload) or FormData input (HTML form). Parse FormData via Zod; use `getAll` + `z.array` for any repeatable field (never `Object.fromEntries`, which drops all but the last value).
4. **Decide auth posture**: logged-in required, optional, or public (`public` requires explicit justification in a comment).
5. **Set the rate limit**. Default per-user 30/min for mutations, 100/min for reads. Stricter on auth-adjacent actions (see `void-rate-limit-strategy`).
6. **Wire trace + Sentry scope** explicitly in the handler (until you extract a `defineAction` helper).
7. **Write the action test** in `<verb>.test.ts` next to the action — assert auth, validation, rate limit, and happy path. Service tests already cover the domain.

## Composition (informational)

- `void-security-guidance` — Zod at every ingress; sensitive data redacted from logs; no PII in error messages returned to client.
- `void-webhook-handler-pattern` — webhooks share the 5-layer pattern; same Zod discipline, different transport.
- `void-rate-limit-strategy` — preset windows/max per action class.
- `void-observability` — trace ID + Sentry user scope (hashed); same pattern across actions, webhooks, jobs.
- `void-tdd` — souple mode on the action (boundary), strict on the underlying service.
- `void-service-package` — when the service grows enough to deserve its own package, extract it (rare, but the path is there).
