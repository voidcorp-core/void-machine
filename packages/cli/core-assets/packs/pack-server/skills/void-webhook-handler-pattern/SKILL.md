---
name: void-webhook-handler-pattern
description: Build a webhook handler with signature verification, idempotency, and dead-letter routing. Per-source patterns (Stripe, Resend, GitHub). Uses the shared async-safety contract.
---

# webhook-handler-pattern

Use when adding any inbound webhook endpoint (Stripe, Resend, GitHub, custom). Webhooks are **untrusted POST endpoints** that fire from external systems — every wrong handler is either a security breach (forged events accepted), a duplicate-charge bug (no idempotency), or a silent failure (no dead-letter).

## Location

```
apps/<app>/src/app/api/webhooks/<source>/route.ts
```

One folder per source. Path stable (external systems POST to a fixed URL — never rename without coordinating).

## Handler contract

Compose `void-async-safety` for the canonical executable `withWebhookSafety` example
and its `IdempotencyStore` contract. Keep signature/freshness verification in the provider
SDK adapter, validate its decoded data at that boundary, and map the typed outcome to HTTP.
Do not copy a second verify/claim/handle/mark implementation into this skill.

The handler's business effects and deduplication must share a transaction/outbox or use
the same stable idempotency key. A received or pending inbox row is **not** proof of a
completed event. Failed processing and failed completion persistence remain non-success
and retryable; only completed events may be acknowledged as duplicates. An in-flight
concurrent delivery must not report that unfinished processing as success.

A project may provide its own wrapper with this contract. The optional Next.js pack
exports the tested implementation; it does not supply the project's verifier or durable
store. No universal event-age limit is invented by the wrapper.

## Per-source notes

### Stripe

- Signature: `stripe-signature` header → `stripe.webhooks.constructEvent`
- Idempotency: `event.id` is the canonical key
- Retry: Stripe retries failed webhooks with exponential backoff for up to 3 days
- Test mode: separate `STRIPE_WEBHOOK_SECRET_TEST` env var

### Resend (via svix)

- Signature: `svix-id`, `svix-timestamp`, `svix-signature` headers → `new Webhook(secret).verify(body, headers)` from `svix` package
- Idempotency: `svix-id` header
- Retry: use the provider's current retry schedule and delivery diagnostics; do not infer completion from receipt.

### GitHub

- Signature: `x-hub-signature-256` header (HMAC SHA-256 of the body with your secret)
- Idempotency: `x-github-delivery` header (UUID)
- Retry: GitHub does not automatically redeliver failed deliveries; arrange manual or automated redelivery from its delivery records. A failure response is not durable acceptance.

### Custom (internal services calling each other)

- Signature: HMAC SHA-256 with a shared secret. Use Node's `crypto.timingSafeEqual` for the compare (constant-time, no early-exit on mismatch).
- Idempotency: caller-generated UUID v7 in `x-idempotency-key`
- Retry: caller's responsibility; receiver acknowledges with 2xx + the key it already saw

## Durable inbox

Use the application's existing durable store following `void-async-safety`. Its state
must distinguish pending claims from completed events and release/expire failed claims
for retry. A unique key alone cannot express completion. Apply schema changes through
`void-drizzle-migration-safe`; this skill supplies no independently evolving SQL schema.

## Dead-letter routing

A permanent failure may be recorded in a durable dead-letter destination for an operator
before applying the provider's acknowledgment policy. Never interpret an HTTP status as
a universal instruction to stop delivery: Stripe retries non-2xx responses, including 4xx;
GitHub does not automatically redeliver failures. Keep provider-specific retries explicit.
Never acknowledge a malformed event as successfully processed or silently drop a failure.

## Error responses

The canonical wrapper rejects verifier failures with 400 and returns 500 for handler or
store failures. The HTTP adapter preserves those outcomes. A 200 means completed work or
a previously completed duplicate, never an in-progress claim. If a queue/outbox is used,
its separate acceptance contract must mean durable responsibility for eventual processing.

## Anti-patterns

- ✗ **No signature verification** — anyone with the URL can forge events
- ✗ **Idempotency key = `Date.now()`** — re-delivery NOT detected; double-charges
- ✗ **Calling services synchronously for slow work** — work exceeding the provider's response deadline is a failed delivery; retry policy varies by provider. Enqueue background jobs for slow work (see `void-background-job-pattern`).
- ✗ **One handler for all sources** (`/api/webhooks/route.ts` switching on `source`) — different signatures, different idempotency keys, different retry semantics. One folder per source.
- ✗ **`==` for HMAC comparison** — use `crypto.timingSafeEqual`. Constant-time compare prevents timing attacks.

## Testing

- Unit-test the verifier with a real (sanitized) payload from the source's docs
- Integration-test by running the handler against a captured event JSON
- E2E: use Stripe CLI / Svix CLI / ngrok to deliver real webhooks to a dev endpoint

## Composition (informational)

- `void-async-safety` — generic retry, idempotency, dead-letter doctrine.
- `void-server-action` — both cross trust boundaries; same Zod discipline.
- `void-drizzle-migration-safe` — inbox table migration follows the safe pattern.
- `void-env-validation` — webhook secrets validated in `@repo/core/env`.
- `void-observability` — trace context per receive; Sentry breadcrumb.
- `void-security-guidance` — Zod re-validation IS the trust boundary; HMAC compare with constant-time.
