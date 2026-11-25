# Server-side conventions (`@voidcorp/pack-server`)

This pack covers the server trust boundary: Server Actions, webhook handlers, scheduled / background jobs, Drizzle migrations. It is **stack-agnostic** — works in Next.js, Hono, standalone Bun/Node servers.

## Trust boundaries are sacred

Every endpoint that receives data from outside the process is a **trust boundary**. Apply at every one:

1. **Auth** — verify session before doing anything else
2. **Zod ingress** — schema validates the input object (no untyped `formData.get()`)
3. **Rate limit** — per-user or per-IP (see `void-rate-limit-strategy`)
4. **Observability** — trace ID + Sentry user scope (hashed)
5. **Service call** — pure domain logic in `src/services/`

The skill `void-server-action` ships the executable pattern for these layers; this module is the orientation reference.

## Webhook handlers

Live at `apps/<app>/src/app/api/webhooks/<source>/route.ts`. The 5-layer pattern (signature verification, idempotency, Zod re-validation, service call, ack) is documented in `void-webhook-handler-pattern` with per-source examples (Stripe, Resend, GitHub, custom HMAC).

No wrapper required — the pattern is short enough to inline. If your project repeats it 3+ times, DRY into a project-side helper.

## Background jobs

- Event-driven: Inngest / Trigger.dev / Cloudflare Queues
- Scheduled: Vercel Cron / Inngest schedule
- Pattern: `void-background-job-pattern` (5 layers: validate / idempotent / observable / work / classify retries)

## Drizzle migrations safety

- Migrations live at `apps/<app>/db/migrations/` (Drizzle default).
- New columns: NULL or DEFAULT first, then backfill, then NOT NULL (no exclusive locks on prod tables).
- Index creation: `CREATE INDEX CONCURRENTLY` on Postgres.
- Composes with `void-migrations` (generic) + `void-drizzle-migration-safe` (Drizzle-specific).

## Server Actions vs route handlers

| Use case | Layer |
|---|---|
| UI mutation triggered by a button/form | Server Action (`app/(actions)/`) |
| External system POSTs (webhook) | Route handler (`api/webhooks/`) — see `void-webhook-handler-pattern` |
| Public read-only API | Route handler (`api/`) |
| Internal cron / queue job | Route handler + auth via secret — see `void-background-job-pattern` |

## E2E authentication and security proof

- Scenarios that do not test authentication acquire their session through a server/API fixture
  boundary. Keep the authentication UI path for the scenario whose behavior is authentication.
- Functional E2E does not disable rate limiting. Prove the production-default threshold and the
  denial response (`429`) in an independent test lane; fixture setup through `auth.api` is valid
  preparation but is not evidence for the client-facing rate-limit contract.
- A test-only security override is a typed, bounded profile. Malformed or out-of-range values fall
  back to safe production defaults; a production deployment manifest must reject the hermetic test
  adapter.
- Accounts and mutable state are unique to the run and worker. Register idempotent, bounded cleanup
  for every resource, including partial setup and interrupted runs. Never commit or attach browser
  storage state or credentials.

## Composition (informational)

- `harness-react` — components call Server Actions, not the DB.
- `harness-nextjs` — Server Actions in `app/(actions)/`, webhooks in `app/api/webhooks/`.
- `void-async-safety` — generic retry/idempotency/dead-letter doctrine.
- `void-security-guidance` — Zod at ingress, no PII in returned errors.
- `void-observability` — trace + Sentry on every handler.
