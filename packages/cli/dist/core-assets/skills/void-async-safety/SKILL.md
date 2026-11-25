---
name: void-async-safety
description: Idempotency by design. At-least-once with consumer dedup. Signature verify, replay window, idempotency keys, outbox, bounded retries, DLQ. Use for async/webhook/job/cron code.
---

# async-safety — voidcorp craftsman edition

The network is unreliable. Webhooks redeliver. Jobs restart mid-run. Crons stack when one runs slow. Without idempotency by design, every re-delivery becomes a corruption risk. This skill codifies the patterns so handlers are safe by construction.

**Attribution**: see `.source`. Foundation: Stripe webhook patterns + Outbox pattern (Microservices.io) + Pat Helland "Life Beyond Distributed Transactions" + Bryan Cantrill on distributed failure modes.

---

## At-least-once is the default

Assume every message can be delivered N times. The consumer handles dedup.

Exactly-once delivery requires two-phase commits across systems — extreme effort, rarely worth it. At-least-once + consumer dedup covers > 99% of real cases at a fraction of the cost.

---

## Webhook safety — the canonical pattern

Every webhook handler does FOUR things, IN THIS ORDER:

1. **Verify authenticity and replay policy** using the provider contract (authenticated timestamp when available)
2. **Check idempotency key** (claim atomically; if already processed, return success without re-processing)
3. **Handle the event** (business logic)
4. **Mark idempotency key as completed** (or release on failure for retry)

The `pack-nextjs` provides a `withWebhookSafety()` wrapper:

```typescript
import { withWebhookSafety } from '@voidcorp/pack-nextjs/async';

const handleWebhook = withWebhookSafety({
  verify: (req) => verifyStripeSignature(req, env.STRIPE_WEBHOOK_SECRET),
  dedupKey: (event) => event.id,                  // Stripe event ID
  store: stripeIdempotencyStore,                  // injected
  handler: async (event) => handleStripeEvent(deps, event),
});

export async function POST(req: Request): Promise<Response> {
  const outcome = await handleWebhook(req);
  return Response.json(outcome.body, { status: outcome.status });
}
```

The wrapper owns verify → claim → handle → mark and returns a typed outcome; the HTTP
adapter maps its status and body. Verification and handling return `Result`, not an
untyped event or success by absence of an exception. Signature verification belongs to
the provider SDK adapter passed as `verify`; it runs before any claim or business effect.

### Replay window enforcement

The verifier must use the provider SDK's authenticated delivery metadata and freshness policy.
For Stripe, check the signed delivery timestamp through its SDK; do not reject an old
business event merely because its creation time is old. Retries are new signed deliveries.
The wrapper has no `replayWindowMs` option and supplies no universal five-minute policy.
A verifier failure is rejected before deduplication or business handling. Providers without
a signed timestamp require their documented replay/deduplication policy, not a fabricated
timestamp check. See the provider reference in this skill's `.source`.

### Banned

- State mutation BEFORE signature verification.
- Hand-rolled signature check (use the wrapper / the provider's official lib).
- In-memory `Set` for dedup (lost on process restart).
- Ignoring the provider's authenticated freshness policy when one exists, or omitting durable event deduplication.

---

## Idempotency keys — port + store

The exported `IdempotencyStore` in `@voidcorp/pack-nextjs/async` owns this contract:

- `tryClaim` atomically claims a new key. `already-processed` means **completed**, never
  merely received or in progress. A pending claim returns a retryable store error.
- A failed handler releases its claim. A failed completion write returns non-success and
  releases for retry. Release failure never turns the operation into success.
- The consumer provides a durable adapter; the harness does not ship a Redis/Postgres store.
  Tests may use an in-memory implementation of the same contract.
- A claim cannot make an external effect atomic with its completion record. Use a shared
  transaction/outbox where possible, or make the business effect idempotent by the stable
  event key. After an uncertain completion, a retry may execute the handler again.

Do not implement deduplication as "inbox row exists → acknowledge": an unfinished row
must remain retryable. This is the single safety contract used by the webhook handler skill.

### Deduplication retention

Choose retention from the provider's automatic and manual redelivery windows and the
business invariant. The wrapper passes `dedupTtlMs` (default seven days) to the
store; the durable adapter must enforce that retention. Override it when the
provider contract or business invariant requires a longer window.

---

## Outbox pattern — for "DB write + external notification"

When a business operation must (a) update the DB AND (b) notify an external system, doing them in sequence creates an inconsistency window:

```typescript
// banned (without outbox)
await db.transaction(async (tx) => {
  await tx.insert(orders).values(order);
});
await stripe.refunds.create({ charge: order.chargeId });
// if Stripe call fails, DB has the refund record but Stripe doesn't
```

### With outbox

The DB write AND the "event to publish" sit in the SAME transaction:

```typescript
await db.transaction(async (tx) => {
  await tx.insert(orders).values(order);
  await tx.insert(domain_events).values({
    aggregate_id: order.id,
    event_type: 'OrderRefunded',
    payload: { chargeId: order.chargeId, amount: order.amount },
  });
});

// later: a background dispatcher reads domain_events and publishes
//        (composes with the outbox dispatcher in pack-monorepo / pack-nextjs)
```

If the transaction commits, the event is durable. If it fails, neither happened. The dispatcher retries the publish until success.

The `domain_events` table schema lives in `pack-monorepo` (composes with `void-migrations`).

---

## Fail-soft outbound HTTP — for a third party you don't control

The outbox is for a write that **must** eventually happen. The mirror case is a **read** on the request path that you can survive without: an FX rate, a recommendation, an enrichment lookup. A synchronous call to a vendor you don't control must never be allowed to hang or fail the whole request when that vendor is slow or down.

```typescript
// banned: no timeout, no fallback — a flaky vendor takes down your request
const rates = await fetch('https://fx.example/rates').then((r) => r.json());

// fail-soft: bounded time + graceful degrade
async function getRates(cache: RatesCache): Promise<Rates> {
  try {
    const res = await fetch('https://fx.example/rates', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const rates = parseRates(await res.json());
    await cache.set(rates); // refresh the fallback for next time
    return rates;
  } catch (err) {
    logger.warn('fx rates degraded, serving last-known', { err }); // observable, not silent
    return cache.getLastKnown() ?? DEFAULT_RATES; // degrade, do not fail the request
  }
}
```

Three rules:

1. **Always bound the time** — `AbortSignal.timeout(ms)`. An unbounded `fetch` inherits the vendor's worst day.
2. **Retry only idempotent reads, with a cap** — a bounded retry (2-3, with backoff) for a GET; never auto-retry a non-idempotent POST (that is the outbox's job, with a dedup key).
3. **Decide critical vs degradable up front.** Critical (payment authorize) → surface the failure to the caller, do not fake success. Degradable (rates, recommendations) → fall back to a cached/default value and log the degradation. The failure mode is a deliberate choice, never an unhandled throw.

This composes with `void-observability` (the degradation is a structured warn, never swallowed) and `void-functional` (the outcome is a value — `Rates` or the fallback — not an exception that escapes the boundary).

---

## Job safety — the canonical pattern

Same shape as webhooks, with explicit state machine (composes with `void-functional` discriminated unions):

```typescript
type JobState =
  | { kind: 'queued'; id: JobId; payload: unknown; queuedAt: IsoDate }
  | { kind: 'in-flight'; id: JobId; startedAt: IsoDate; attempt: number }
  | { kind: 'completed'; id: JobId; completedAt: IsoDate; result: unknown }
  | { kind: 'failed'; id: JobId; failedAt: IsoDate; attempt: number; lastError: string }
  | { kind: 'dead-lettered'; id: JobId; finalError: string; attempts: number };
```

Transitions are explicit. No "did it succeed? unclear" state.

The target shape is a `withJobSafety()` wrapper. **Not yet shipped** — `pack-nextjs`
ships `withWebhookSafety` today; `withJobSafety` / `withCronSafety` are the planned
Phase E form (see the pack README). Until they land, apply this shape by hand; do
not import a wrapper that does not exist yet.

```typescript
export const refundOrderJob = withJobSafety({
  dedupKey: (input) => `refund:${input.orderId}`,
  maxAttempts: 5,
  backoff: 'exponential-with-jitter',
  store: jobIdempotencyStore,
  handler: async (input) => refundOrder(deps, input),
});
```

---

## Retries — exponential backoff + jitter

```
attempt 1: 1s + jitter(0–1s)
attempt 2: 2s + jitter(0–2s)
attempt 3: 4s + jitter(0–4s)
attempt 4: 8s + jitter(0–8s)
attempt 5: 16s + jitter(0–16s)
DLQ
```

Jitter prevents thundering herd (multiple jobs failing simultaneously and retrying in sync).

### Max attempts default: 3–5

After exhaustion, dead-letter and alert. Beyond that, the failure is structural; a human must look.

### Banned

- Unbounded retries
- Custom retry loops in business code (use the queue library's semantics)
- Catching exceptions and silently retrying

---

## Cron safety — overlap protection

Same status as `withJobSafety` above: `withCronSafety` is the planned Phase E shape,
not yet shipped by `pack-nextjs`. Apply it by hand until it lands.

```typescript
export const dailyReportCron = withCronSafety({
  name: 'daily-report',
  overlapStrategy: 'skip-if-running',  // or 'queue-up'
  handler: async () => generateDailyReport(deps),
});
```

The wrapper acquires a Postgres advisory lock keyed by cron name. If the previous run is still in flight, skip with a structured log entry. Composes with `void-observability`.

### Banned

- Cron jobs that take longer than the cron interval without overlap protection — they will stack and crash the workers.

---

## Composition with other skills

- **With `void-observability`**: trace propagates across job / webhook / queue boundaries via the message envelope. Job lifecycle events (queued / in-flight / completed / failed / dead-lettered) are structured logs.
- **With `void-security-guidance`**: signature verification + replay window + signed message envelopes.
- **With `void-migrations`**: `domain_events` outbox table schema goes through the migrations discipline.
- **With `void-tdd`**: idempotency is testable. Test: same event delivered twice → same final state. Test: signature missing → reject.
- **With `void-hexagonal-architecture`**: webhook handler at adapter boundary, business logic in use-case. `IdempotencyStore` as port.
- **With `void-functional`**: job state as discriminated union. `Result<JobOutcome, JobError>` everywhere.
- **With `void-code-review`**: flags missing signature verification, missing idempotency check, save-then-publish without outbox, custom retry loops in business code.
- **With `void-commit-discipline`**: webhook handler commits' "why" mentions the provider + the idempotency strategy.

---

## Companion hooks

None directly in core. The discipline is encoded in `pack-monorepo` / `pack-nextjs` wrappers (`withWebhookSafety`, `withJobSafety`, `withCronSafety`) and surfaced via `void-code-review` flags.

---

## Anti-rules

- MUST NOT decide queue technology (pack concern — BullMQ vs Inngest vs Trigger.dev vs Vercel Cron).
- MUST NOT decide alerting thresholds (ops concern).
- MUST NOT silently allow non-idempotent handlers.
- MUST NOT skip signature verification.
- MUST NOT use in-memory dedup that loses state on restart.
- MUST NOT permit unbounded retries.
- MUST NOT skip the outbox pattern when DB + external are both modified.
- MUST NOT call an outbound third party on the request path without a timeout and a decided failure mode (surface if critical, degrade if not).

---

## When you are stuck

| Problem | Solution |
|---|---|
| Same Stripe event processed twice | Idempotency key not stored, or check happens after mutation. Order: verify → dedup → handle. |
| Webhook handler slow → timeout → retry → duplicate work | Make handler fast: enqueue a job and return 200 immediately. The job handles idempotency. |
| A vendor API call sometimes hangs and stalls the whole request | Bound it with `AbortSignal.timeout`; decide critical (surface) vs degradable (cached/default fallback + a warn log). See "Fail-soft outbound HTTP". |
| Job lost after worker crash | Queue lib should re-deliver. Verify your queue is durable (BullMQ default is durable). |
| Cron stacking | `withCronSafety()` with skip-if-running. |
| External call fails after DB commit | Outbox pattern. Both in one transaction. |
| Need exactly-once | You probably don't. At-least-once + dedup covers the case. If truly required, consult the queue library's two-phase commit story. |

---

## Final rule

```
Every async boundary → verify, dedup, handle, mark. Outbox for DB+notify. Bounded retries with backoff+jitter. DLQ on exhaustion.
Otherwise → it is not voidcorp async-safety.
```

The network does not care about your assumptions. Code as if every message arrives N times.
