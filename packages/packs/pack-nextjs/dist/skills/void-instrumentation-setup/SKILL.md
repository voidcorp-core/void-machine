---
name: void-instrumentation-setup
description: Wire instrumentation.ts in Next.js 16 — Sentry, pino logger, OpenTelemetry traces. Edge vs Node runtime split. The single place observability is bootstrapped.
---

# instrumentation-setup

Use when setting up observability in a fresh Next.js app, OR when adding a new instrumentation tool (Sentry → +OTel, +Datadog, etc.). The pattern: ONE `instrumentation.ts` at the project root, conditionally initializes per runtime.

Composes with `void-observability` (the doctrine: pino, structured logs, Sentry user scope). This skill is the Next-specific wiring.

## File location

```
apps/<app>/
├── instrumentation.ts              # the bootstrap
├── instrumentation-node.ts         # Node-runtime-specific
├── instrumentation-edge.ts         # Edge-runtime-specific (optional)
└── src/
```

Next 16 auto-loads `instrumentation.ts` at server startup (both runtimes). `instrumentation-{node,edge}.ts` are convention-driven splits.

## Canonical bootstrap

```ts
// apps/web/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./instrumentation-edge');
  }
}
```

The dynamic imports keep edge bundles slim (Sentry's Node SDK doesn't ship to Edge runtime).

## Node runtime setup

```ts
// apps/web/instrumentation-node.ts
import * as Sentry from '@sentry/nextjs';
import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { logger, env } from '@repo/core';

// 1. Sentry
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend: (event) => {
    if (event.user?.id) event.user.id = hash(event.user.id);   // anonymize
    return event;
  },
});

// 2. OpenTelemetry (if you ship traces outside Sentry)
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

// 3. pino is initialized eagerly in @repo/core/logger — nothing to do here.

logger.info({ event: 'app.boot', runtime: 'nodejs' });
```

## Edge runtime setup

```ts
// apps/web/instrumentation-edge.ts
import * as Sentry from '@sentry/nextjs';
import { env } from '@repo/core';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 0.1,
  transportOptions: { fetchOptions: { keepalive: true } },   // Edge fetch quirk
});

// No OTel, no pino — Edge runtime doesn't support them.
// Use Sentry.captureMessage / addBreadcrumb for structured-ish logs.
```

Edge can't `fs.write`, can't load native modules, can't use Node `Buffer` outside polyfills. Keep instrumentation minimal.

## What lives where (decision table)

| Concern | Where |
|---|---|
| Sentry init | `instrumentation-node.ts` AND `instrumentation-edge.ts` |
| OpenTelemetry | `instrumentation-node.ts` only |
| pino logger | `@repo/core/logger` (auto-initialized on import) |
| Sentry user scope per-request | Server Action / Route handler wrapper (`withTraceContext`) |
| Request-level traces | OTel auto-instrumentation (Node) |
| Client-side errors | `app/global-error.tsx` + `Sentry.init` in a `'use client'` provider |

## Client-side Sentry

Server `instrumentation.ts` does NOT cover the browser. For client errors, add a separate provider:

```tsx
// apps/web/src/app/sentry-provider.tsx
'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

let initialized = false;

export function SentryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
    });
  }, []);
  return <>{children}</>;
}
```

Wire in `app/layout.tsx`. The `NEXT_PUBLIC_*` env is the only secret-ish value that's safe in the bundle.

## Anti-patterns

- ✗ **Calling `Sentry.init` inside route handlers** — re-inits every request, leaks event listeners
- ✗ **Same Sentry sample rate in dev and prod** — at 1.0 prod you'll exhaust your event quota
- ✗ **Logging PII raw** — `beforeSend` should redact user.id, email, etc. Hash or strip.
- ✗ **OTel auto-instrumentation in Edge** — silently fails because Edge can't load Node native bindings
- ✗ **One instrumentation.ts that branches on runtime inline** — the dynamic-import pattern keeps bundles clean

## Verification checklist

After setup, in dev:

1. Throw in a Server Component — should surface in Sentry
2. Throw in a Server Action — should surface
3. Throw in a Client Component — should surface (client-side init)
4. Check that user ID is hashed in Sentry events
5. Check that NODE_ENV-conditional behavior (sample rate) actually differs

## Composition

- `void-observability` — pino + Sentry doctrine (this skill is the Next wiring).
- `void-security-guidance` — Sentry user scope MUST be hashed; no PII in event payloads.
- `void-env-validation` — `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` validated via Zod in `@repo/core/env`.
- `void-loading-error-boundaries` — `error.tsx` uses Sentry.captureException; this skill ensures Sentry is initialized when that fires.
