---
name: void-rate-limit-strategy
description: Choose rate limit window, max, and key strategy per action class. Per-user for authed, per-IP for public, escalation for auth-adjacent. Default values + when to deviate.
---

# rate-limit-strategy

Use when applying a rate limit to a Server Action, route handler, or webhook. Rate limits are mandatory at every trust boundary (per `void-security-guidance`); this skill says HOW to choose the right window/max/key per use case.

If you're tempted to skip rate limit "because it's internal" — wrong. The trust boundary is the URL. Anything reachable from a browser is rate-limited.

## The 3 parameters

```ts
{ window: '1 min', max: 10, key: 'user:${user.id}:contact-form' }
```

- `window` — time window (1 min, 1 hour, 24 hours)
- `max` — number of requests allowed in the window
- `key` — what gets counted (per user? per IP? per action?)

## Default presets

Per action class, here are the void-machine defaults. Deviate with explicit justification in a code comment.

| Action class | Window / Max | Key | Why |
|---|---|---|---|
| Standard read (data fetch, list) | 1 min / 100 | `user:${id}` | Generous; reads are cheap |
| Standard write (create, update) | 1 min / 30 | `user:${id}` | Conservative; writes are expensive |
| Search / filter | 1 min / 60 | `user:${id}` OR `ip:${ip}` | Mid |
| Auth: login | 5 min / 5 | `ip:${ip}` + `email:${email}` (BOTH) | Credential stuffing |
| Auth: password reset | 1 hour / 3 | `ip:${ip}` + `email:${email}` | Account enumeration |
| Auth: 2FA verify | 5 min / 5 | `user:${id}` | Brute force |
| Auth: 2FA resend | 5 min / 1 | `user:${id}` | SMS cost |
| LLM call | 1 hour / 50 | `user:${id}` | Cost control |
| File upload | 1 hour / 20 | `user:${id}` | Bandwidth + disk |
| Webhook receiver | 1 min / 1000 | `source:${source}` | Permissive; senders should self-throttle |
| Public form (contact, signup) | 5 min / 3 | `ip:${ip}` | Anti-spam |

These are **starting points**. If your traffic patterns show 1 min / 30 is too tight for a specific write that users do legitimately 50 times/min (e.g., batch import), document the deviation and raise.

## Key strategy: `user:` vs `ip:`

- **Per-user (`user:${id}`)** — for authenticated actions. User is the right scope; one user shouldn't tank another user's quota by sharing an IP (office NAT, mobile carrier CGN).
- **Per-IP (`ip:${ip}`)** — for unauthenticated actions where user identity doesn't exist yet (login, public form, signup).
- **Both (`user:${id}` AND `ip:${ip}`)** — for auth-adjacent flows (login, password reset, 2FA). One attacker can rotate emails on one IP; one IP can host one stolen credential. Block on either limit.

When using BOTH, configure the rate limiter to use `Math.max` semantics: the more restrictive limit wins.

## Sliding window vs token bucket vs fixed window

Pick one strategy per app, stick with it. The differences in practice:

- **Fixed window**: simple, off-by-one at boundary (user makes 30 in second 59, then 30 more in second 1 of next window = 60 in 2s). Use for non-security limits.
- **Sliding window**: smoother, no boundary spike. Use for cost-sensitive limits (LLM, uploads).
- **Token bucket**: allows burst then refill. Use when "burst is OK but sustained is not" (search-as-you-type, real-time API).

The void-machine default is **sliding window** via Upstash Redis or Vercel KV (`@upstash/ratelimit`). Token bucket only when burst is the intended UX.

## Implementation (Upstash example, no wrapper)

```ts
// apps/web/src/adapters/ratelimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from '@repo/core';

const redis = Redis.fromEnv();

export const ratelimit = {
  perUser: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:user',
  }),
  perIp: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '5 m'),
    prefix: 'rl:ip',
  }),
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '5 m'),
    prefix: 'rl:auth',
  }),
};
```

Use in a Server Action:

```ts
// inside an action handler, after auth resolves session
const { success } = await ratelimit.perUser.limit(`${session.userId}:note.create`);
if (!success) return { ok: false as const, error: 'rate-limited' };
```

For per-IP or composite keys (login: both IP and email):

```ts
const ip = headers().get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
const { success: ipOk } = await ratelimit.auth.limit(`ip:${ip}:login`);
const { success: emailOk } = await ratelimit.auth.limit(`email:${input.email}:login`);
if (!ipOk || !emailOk) return { ok: false as const, error: 'rate-limited' };
```

Webhook handlers rate-limit per-source:

```ts
const { success } = await ratelimit.perUser.limit(`webhook:stripe`);
if (!success) return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
```

If you DRY this into a `defineAction` helper (recommended once the pattern repeats), the helper accepts a `rateLimit` option and applies the same primitive under the hood.

## Escalation: progressive lockout

For high-stakes auth flows, ramp the cost of repeated failures:

```ts
{
  window: '5 min',
  max: 5,
  // After 5 failures, escalate: 1 hour cooldown
  escalate: { afterFails: 5, lockoutMin: 60 },
}
```

Not all limiters support this natively; if your stack doesn't, implement at the service layer: count failures in a separate counter, when threshold crossed, return 403 with a lockout response.

## Anti-patterns

- ✗ **No rate limit on Server Actions because "we'll add it later"** — every action ships with one or doesn't ship
- ✗ **Same limit for reads and writes** — wastes capacity OR makes writes too easy to abuse
- ✗ **IP-only limit on authed actions** — office NAT or carrier CGN punishes legit users; use user key
- ✗ **No rate limit on webhook receivers** — a buggy sender can flood you
- ✗ **Rate limit at the database query level** — too late; the request already consumed compute. Rate limit at the boundary.
- ✗ **Identical message for "rate limited" and "denied"** — leaks "your credentials are valid, just slow down" (info disclosure). For auth flows, return a generic 429.

## Monitoring

Surface 429 responses in your dashboard. Sudden spikes = either an attack OR a UX bug (unintended retries from the client). Both need attention.

## Composition (informational)

- `void-security-guidance` — rate limit is a security control; Zod is the schema control; both at every boundary.
- `void-async-safety` — webhook + background-job retry semantics interact with rate limits.
- `void-server-action` — actions apply rate limit before service call (layer 3 of 5).
- `void-webhook-handler-pattern` — webhook rate limits use a per-source key.
- `void-llm-cost-discipline` — LLM call rate limits are cost-control, more conservative than CPU-control limits.
