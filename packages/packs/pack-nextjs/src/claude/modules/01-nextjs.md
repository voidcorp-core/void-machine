# Next.js 16 App Router (`@voidcorp/pack-nextjs`)

This app runs on Next.js 16 with the App Router, React 19, and Cache Components. This module covers Next-specific layout and rendering; for React component conventions see `@voidcorp/pack-react`, for Server Actions see `@voidcorp/pack-server`, for PWA see `@voidcorp/pack-pwa`.

## Layout

```
apps/<app>/src/
├── app/                          # App Router
│   ├── (api|actions)/            # Route handlers + Server Actions (see harness-server)
│   ├── (marketing)/              # Marketing routes (public)
│   ├── (app)/                    # Authenticated routes
│   └── api/webhooks/<src>/       # Webhook handlers (see harness-server)
├── components/                   # Pure UI (see harness-react)
├── services/                     # Domain + use-cases (pure-by-default)
├── adapters/                     # Port implementations
├── domain/                       # Aggregates + value objects
└── infrastructure/               # instrumentation.ts, Sentry init, raw infra
```

## Route groups

- `(api|actions)`: every file is a trust boundary — composes with `void-server-action`.
- `(marketing)`: public, statically rendered by default, no auth.
- `(app)`: authenticated, requires middleware gate.
- `api/webhooks/<source>`: webhook handlers — see `void-webhook-handler-pattern` for the 5-layer pattern (signature, idempotency, Zod, service, ack).

## Cache Components (Next 16)

- Cache by default; opt out with `'use no cache'` per fetch / per component for dynamic data.
- Cache keys include user / org scope where appropriate. Never cache user-specific content under a shared key (composes with `void-security-guidance` PII).
- Use `revalidatePath('/specific-path')` after mutations — never broad `revalidatePath('/')` which kills cache hit rate.

## E2E artifact proof

- `next dev` is for local feedback only. It is never release proof because it compiles routes on
  demand and changes the timing being measured.
- CI and release proof build once with `next build`, then serve the deployment-equivalent artifact.
  `next start` is prescribed only for a Node-server deployment; a Vercel preview, standalone image,
  static export, or other adapter must prove its own real artifact instead of being represented by
  `next start`.
- Playwright waits for observable process readiness before application assertions. Keep build
  readiness and assertion budgets separate; do not hide compilation in a larger assertion timeout.
- Parallel workers derive unique run/worker identities for external state. Authentication storage
  is sensitive ephemeral output and is written under the test output directory, never committed.
- Preserve the no-retry rule. A failed artifact proof is evidence to diagnose, not a reason to retry
  until green.

## instrumentation.ts

- Initialize Sentry here (server + edge runtimes), pino logger, OpenTelemetry exporter.
- Anonymize user scope: `Sentry.setUser({ id: hash(userId) })`, never raw IDs.

## Composition

- `harness-react` — `components/` is pure UI, no DB.
- `harness-server` — `(actions)/` and `api/webhooks/` are trust boundaries.
- `harness-pwa` — manifest, service worker, offline patterns.
- `void-hexagonal-architecture` — `components → services → adapters → infrastructure` direction.
- `void-observability` — Sentry + pino wired in instrumentation.ts.
