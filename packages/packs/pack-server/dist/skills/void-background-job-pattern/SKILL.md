---
name: void-background-job-pattern
description: "Run async work outside the request lifecycle: when to use a queue (Inngest, Trigger, Cloudflare Queues) vs a cron route. Idempotency, retry, dead-letter. Self-contained, no harness wrappers."
---

# background-job-pattern

Use when work needs to happen **outside the user's request lifecycle** — too slow for the 10s HTTP timeout, or scheduled, or needing retry. Default in void-machine: a managed queue (Inngest, Trigger.dev, Cloudflare Queues) for event-driven jobs; route handlers + cron config for time-based.

If the work completes in < 200ms AND happens during the request anyway, do it inline. Background jobs add latency to the UX (work happens later) and infrastructure cost. Not the default.

## When to use a background job

- Sending an email after signup (don't block the signup response on SMTP)
- Generating a PDF/export (multi-second work)
- Recomputing a cache after data change
- Polling an external API on schedule
- Cleanup tasks (delete soft-deleted rows after 30 days)
- Webhook retries when initial handler fails recoverably

## When NOT to use a background job

- Work that the user is actively waiting for (use Server Actions, await inline)
- Work that depends on per-request context (cookies, headers) the queue won't have
- Sub-100ms operations (queue overhead > work cost)
- One-off scripts (use a runbook, not a job)

## Three job types

| Type | Trigger | Tool example |
|---|---|---|
| **Event-driven** | Code event ("user.signed_up") | Inngest, Trigger.dev, Cloudflare Queues |
| **Scheduled** | Cron expression | Vercel Cron, Inngest schedule, Upstash QStash |
| **One-shot** | Manual or webhook | Same as event-driven |

Pick the type by **the trigger**, not by the work.

## The 5 layers every job must implement

```
1. Validate input        — Zod schema on the event payload
2. Idempotency           — same event delivered twice = one effect
3. Trace context         — log job name + event ID
4. Service call          — the business work in src/services/
5. Retry classification  — throw retryable errors, classify permanent ones
```

These hold whether you use a queue's native helpers or write the job by hand. The pattern is the substance.

## Event-driven jobs (Inngest example)

```ts
// apps/web/src/jobs/send-welcome-email.ts
import { inngest } from '@/adapters/inngest';
import { z } from 'zod';
import { logger } from '@repo/core';
import { emailService } from '@/services/email';

// 1. Validate event payload at the boundary (defense in depth)
const EventData = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
});

export const sendWelcomeEmail = inngest.createFunction(
  // 5. Retry classification: Inngest auto-retries thrown errors.
  //    Non-retryable: throw NonRetriableError (Inngest's marker class).
  { id: 'send-welcome-email', retries: 3 },
  { event: 'user.signed_up' },
  async ({ event, step }) => {
    // 1. Zod validate at the job boundary
    const data = EventData.parse(event.data);

    // 3. Trace context (event.id is Inngest's correlation key)
    logger.info({
      event: 'job.start',
      name: 'send-welcome-email',
      userId: data.userId,
      eventId: event.id,
    });

    // 4. Do the work in a step (Inngest's retry checkpoint — only re-runs
    //    failed steps on retry, not the whole function)
    await step.run('send-email', async () => {
      await emailService.sendWelcome({ to: data.email });
    });

    // 2. Idempotency: Inngest dedupes by event.id automatically for the
    //    same function. For non-Inngest queues, do `INSERT ON CONFLICT
    //    DO NOTHING` in an inbox table with event.id as key.

    return { ok: true };
  },
);
```

Trigger from a Server Action:

```ts
await inngest.send({ name: 'user.signed_up', data: { userId, email } });
```

Inngest's `step.run` IS the retry checkpoint. Trigger.dev and Cloudflare Queues have similar primitives (`task`, `step`). Use what your queue gives you natively. No wrapper from this pack required.

## Scheduled jobs (Vercel Cron example)

```ts
// apps/web/src/app/api/cron/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { env, logger } from '@repo/core';
import { cleanupSoftDeleted } from '@/services/admin';
import * as Sentry from '@sentry/nextjs';

export async function GET(req: NextRequest) {
  // 1. Auth via cron secret (Vercel injects the Authorization header
  //    based on the CRON_SECRET env var)
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Concurrency lock — skip if a previous run is still in-flight.
  //    Implement with Redis SETNX, Postgres advisory lock, or your
  //    queue's native job-deduplication.
  const lock = await tryAcquireLock('cron:cleanup', { ttlMs: 10 * 60 * 1000 });
  if (!lock) {
    logger.warn({ event: 'cron.skip', reason: 'previous-run-active', name: 'cleanup' });
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    // 3. Trace context
    logger.info({ event: 'cron.start', name: 'cleanup' });

    // 4. Do the work
    const result = await cleanupSoftDeleted({ olderThanDays: 30 });

    logger.info({ event: 'cron.done', name: 'cleanup', deleted: result.count });
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (err) {
    // 5. Always log + notify on cron failure; silent 500 means next run
    //    might also fail without anyone noticing
    Sentry.captureException(err, { tags: { cron: 'cleanup' } });
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await releaseLock(lock);
  }
}
```

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

The 5 layers (auth, concurrency lock, observability, work, error handling) are explicit. No wrappers required. `tryAcquireLock` / `releaseLock` are project-side primitives (Redis-backed, advisory lock, whatever fits) — typically 30 lines of code owned by the consumer.

## Idempotency strategies

Pick the one that matches your storage layer:

- **Queue-native dedupe** (Inngest, Trigger): they dedupe on the event ID for the same function — free.
- **Inbox table**: `INSERT ON CONFLICT DO NOTHING` on a key column; if no row inserted, you've seen this event.
- **Service-level idempotence**: design the work so re-running is safe (`UPDATE WHERE status = 'pending'`).
- **Cron with concurrency lock**: not strictly idempotent but prevents pile-up; combine with service-level idempotence for true safety.

If none of these fit, you have a job that's unsafe to retry — flag it, write an ADR (`void-decide`).

## Retry classification

Most queues retry on throwing handlers. Distinguish:

- **Retryable**: network errors, 5xx from external API, transient DB unavailability → throw normally
- **Non-retryable**: validation failures (Zod), 4xx from external API, "user doesn't exist" → throw a marked error class your queue recognizes (Inngest: `NonRetriableError`; Trigger: `AbortTaskRunError`; Cloudflare Queues: custom field)

If you can't tell, default to retryable. Worst case you waste retries; best case you survive a transient.

## Dead-letter

After retry budget exhausted:

- Inngest, Trigger.dev, Cloudflare Queues have native DLQs — configure them
- Or write your own `job_dead_letter` table the team reviews
- Surface in `Settings → Background jobs → Dead letter` UI
- Never silently drop a failed job

## Anti-patterns

- ✗ **`Promise.resolve().then(work)`** after a Server Action — serverless instance shuts down with the request; the work never runs
- ✗ **One mega-job that does 10 things** — split per concern; one job per event type
- ✗ **Cron without concurrency lock** — slow runs pile up, take down the worker
- ✗ **Cron without secret check** — anyone hitting the URL triggers your cron
- ✗ **Reading per-request context** — jobs don't have the user's cookies; pass identity in the event payload
- ✗ **Logging without job name + event ID** — can't correlate failures back to triggers
- ✗ **Sharing Zod schemas via copy-paste between sender and handler** — they drift; share via a `schemas/events.ts` module

## Local development

- **Inngest CLI**: `npx inngest-cli dev` runs a local worker + UI for piping events
- **Trigger.dev**: `npx trigger.dev dev`
- **Vercel Cron**: no local equivalent; call the route handler directly with the cron secret to simulate

## Composition (informational — each skill stands alone)

- `void-async-safety` — generic retry/idempotency/dead-letter doctrine.
- `void-webhook-handler-pattern` — webhooks often emit events that trigger jobs.
- `void-server-action` — actions emit events for async follow-up.
- `void-env-validation` — `CRON_SECRET`, queue API keys validated.
- `void-observability` — trace context links action → event → job.
