---
name: void-env-validation
description: Validate environment variables at boot via Zod in @repo/core/env. Separate PUBLIC (NEXT_PUBLIC_*) from server-only. Fail fast at startup; never raw process.env in business code.
---

# env-validation

Use when adding any new environment variable, or when working in a project that doesn't yet have `@repo/core/env`. Env vars are an invisible trust boundary — they're inputs from outside the process, and "the database URL is undefined" should explode at boot, not at the first query.

This skill is the void-machine operational form. Composes with `void-security-guidance` (env doctrine) and enforced by the `no-process-env-in-app` hook.

## The principle

```
process.env.X        →   used ONLY inside @repo/core/env
import { env } from '@repo/core'  →   used everywhere else
```

`@repo/core/env` parses + validates `process.env` ONCE, exposes a typed object. Any business code reading `process.env` directly is forbidden (enforced by the `no-process-env-in-app` hook).

## The schema

```ts
// packages/core/src/env.ts
import { z } from 'zod';

const ServerSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_/),
  STRIPE_WEBHOOK_SECRET: z.string().min(10),
  SENTRY_DSN: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

const ClientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

function parseEnv() {
  const isServer = typeof window === 'undefined';
  const server = isServer ? ServerSchema.parse(process.env) : ({} as z.infer<typeof ServerSchema>);
  const client = ClientSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  return { ...client, ...server };
}

export const env = parseEnv();
export type Env = typeof env;
```

Three rules in this file:

1. **Server schema parsed only on server** (`typeof window === 'undefined'`). Otherwise the client bundle would include the server schema, leak field names + (worse) attempt to parse missing values.
2. **Client schema parsed both sides**, but Client schema only reads `NEXT_PUBLIC_*`. Anything else is a leak.
3. **Throws at module-load if missing/invalid.** This is intentional. App fails to boot rather than crash mid-request.

## Per-runtime sanity

| Runtime | What's available | What env reads |
|---|---|---|
| Node server | Full `process.env` | Server + Client schemas |
| Edge runtime | Subset (only NEXT_PUBLIC_*  + a few injected) | Server schema may fail — exclude server-only vars from edge routes |
| Browser | Only NEXT_PUBLIC_* + Next-injected | Client schema only |

If a server-only variable is read in an Edge route, the import chain pulls in the server schema, which fails on Edge (no `process.env.DATABASE_URL`). Solution: import `env` granularly:

```ts
// Edge-safe — explicit imports
import { env } from '@repo/core/env-client';
// Server-only
import { env } from '@repo/core/env-server';
```

Or split into `env-client.ts` and `env-server.ts` exports if your stack needs Edge support.

## Naming convention

- `NEXT_PUBLIC_*` for browser-visible (Next.js convention; baked into the bundle at build time)
- `<DOMAIN>_<NAME>` for server-only (e.g., `STRIPE_SECRET_KEY`, not `SECRET_KEY`)
- Never use single-word ambiguous names (`API_KEY` — for what?)

## Document configuration without secrets

For each variable added to the schema, document its name, constraints and whether it is
required in the project's existing onboarding, schema documentation or secret-free example.
Keep public configuration and non-sensitive manager references there; do not require a new
`.env.example` when the existing support already covers them. Examples contain no secret values.

## Onboard with the project's adopted secret manager

Apply the runtime-secret policy in `void-security-guidance`. When a manager is already adopted,
use its established runtime injection into the process validated by `@repo/core/env`, in local
development as well as staging and production. Do not copy an example to `.env` and fill secrets,
or export plaintext values to files, prompts, command arguments/history, logs or temporary files.
Use the project's documented secure authentication flow; provisioning and rotation follow the
separate scoped-authorization rules in `void-security-guidance`.

If the manager is unavailable or a required secure flow is missing, pause only the operations
that depend on those secrets. Continue independent work; do not create a plaintext fallback or
make manager repair a prerequisite for the whole task.

Existing legacy `.env` setups remain supported and protected. Do not read or rewrite their
secrets, commit them, or require a migration for unrelated work. Secret-free examples, public
configuration and non-sensitive references remain permitted under the existing guards.

## Anti-patterns

- ✗ **`process.env.STRIPE_KEY ?? 'default'`** — silent fallback hides config errors; the schema's `.parse` would throw correctly
- ✗ **`process.env.STRIPE_KEY!` (non-null assertion)** — bypasses TS type system; if missing at runtime, you get a useless undefined error mid-request instead of a clear schema error at boot
- ✗ **NEXT_PUBLIC for secrets** — anything `NEXT_PUBLIC_*` is in the bundle and visible to anyone
- ✗ **Server-only env imported in a Client Component** — caught at build time, but the import chain matters: keep `env-server` imports out of `'use client'` files
- ✗ **Optional everywhere** — if it's optional, the code must handle absence. If the code crashes when absent, it was actually required → mark as required in the schema

## Verification

In dev, simulate missing env:

```bash
DATABASE_URL= bun run dev
# Expected: app fails to start with Zod's error showing which field
```

If app starts and crashes later, your schema isn't comprehensive — find the missed import or non-null assertion.

## Composition

- `void-security-guidance` — env-as-trust-boundary doctrine.
- `void-server-action` — actions import `env`, never `process.env`.
- `void-webhook-handler-pattern` — webhook secrets pulled from `env`.
- `void-instrumentation-setup` — Sentry/OTel DSN from `env`.
- `no-process-env-in-app` hook (harness-server) — blocks `process.env.X` in `apps/*/src/` files outside the env module itself.
