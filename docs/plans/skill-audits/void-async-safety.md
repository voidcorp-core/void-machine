---
skill: async-safety
status: reviewed
strategy: distill
target_loc: 400
phase: D
depends_on: []
composes_with: [observability, security-guidance, code-review]
matrix_row: plans/skill-decision-matrix.md#async-safety
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `async-safety`

## Need

Without `async-safety`, webhooks get processed twice, retries duplicate state, jobs lose work on restart. TypeScript types do not catch this — types describe shape, not concurrency. Stripe sends the same `charge.succeeded` event twice (network retry); GitHub re-delivers a webhook on a temporary 5xx; the queue worker dies mid-job and the message is re-delivered. Without idempotency by design, every re-delivery is a corruption risk. This skill codifies the patterns: idempotency keys, replay protection, retries with backoff, outbox, "at-least-once is the default."

## Decision matrix anchor

- **Wins**: concurrent code, retries, webhooks, jobs, distributed coordination. Idempotency design
- **Loses to**: `hexagonal-architecture` on where the async boundary sits (which port is at the edge)
- **Cannot decide**: queue technology (pack concern — BullMQ vs Inngest vs Trigger.dev vs Vercel Cron)
- **Composes with**: `observability` (trace propagation across job boundaries), `security-guidance` (replay attack protection at webhook signature verification), `migrations` (outbox table schema), `tdd` (test the idempotency)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Stripe "Designing robust webhook handlers" | https://stripe.com/blog/idempotency | foundation | kept (idempotency keys, replay protection model) |
| Stripe webhook signing docs | https://docs.stripe.com/webhooks#verify-events | reference | kept (signature + timestamp window pattern) |
| Bryan Cantrill talks on distributed-systems failure modes | various conf talks | reference | mental model: "the network is unreliable; assume re-delivery" |
| Outbox pattern (Microservices.io) | https://microservices.io/patterns/data/transactional-outbox.html | foundation | kept (DB write + external notification in one transaction) |
| Pat Helland "Life Beyond Distributed Transactions" | https://queue.acm.org/detail.cfm?id=3025012 | reference | reference (entity / activity / contracts framing) |
| GitHub webhook redelivery docs | https://docs.github.com/en/webhooks | reference | kept (every webhook source can re-deliver; verify signatures + delivery ID) |
| n8n retry semantics | https://docs.n8n.io | reference | tactical (consumer workflows) |
| BullMQ patterns | https://docs.bullmq.io | reference | tactical |
| Inngest patterns | https://www.inngest.com/docs | reference | tactical (alternative to BullMQ) |

## Adaptation strategy

`distill`. Principles from Stripe + Outbox pattern + Pat Helland's framing. Stack-specific implementations (BullMQ vs Inngest vs Trigger.dev vs Vercel Cron) live in packs.

## What we keep (verbatim or near-verbatim)

- **Every webhook handler is idempotent** (Stripe): same event delivered twice produces no additional state change. The handler is safe to call N times.
- **Dedup key from upstream** (Stripe): use the upstream's event ID (Stripe `event.id`, GitHub `X-GitHub-Delivery`) as the idempotency key. Store with TTL (typically 30 days for Stripe-class systems).
- **Signature verification at boundary** (Stripe webhook signing): verify HMAC + timestamp window (reject events > 5 minutes old). Composes with `security-guidance` (replay attack protection).
- **Outbox pattern for DB-write + external-notification** (Microservices.io): the business write and the "publish this event" sit in the same transaction. A background dispatcher reads the outbox and publishes. Without it, the DB commits and the publish fails (or vice versa), leaving the system inconsistent.
- **At-least-once is the default** (Helland): assume every message can be delivered N times. The consumer handles dedup. Exactly-once requires extreme effort (two-phase commit across systems) and is rarely worth it.
- **Retries with exponential backoff + jitter**: 2^n + random — prevents thundering herd. Max attempts declared up front; dead-letter queue on exhaustion.
- **Bounded retries**: max 3–5 attempts for most cases. Beyond that, the failure is structural; alert humans.

## What we adapt

- **Idempotency-key storage choice** abstracted to a port (composes with `hexagonal-architecture`): `IdempotencyStore` port with `tryClaim(key, ttl)` and `release(key)` methods. Adapters: Redis (default for high-volume), Postgres-with-UPSERT (default for low-volume). Why: testable in-memory adapter; technology choice is pack-level.
- **Outbox table provided by `pack-monorepo`**: a `domain_events` table with columns `id, aggregate_id, event_type, payload, created_at, dispatched_at, attempts`. Drizzle schema published. Migrations-safety applies. Why: outbox needs a table; provide a sane default.
- **Webhook handler wrapper** (`pack-nextjs-pwa`): `withWebhookSafety({ verify, dedup, store })` wraps a handler with signature verification + idempotency key check + structured logging. Business handler stays pure. Why: the boilerplate is identical across webhooks; centralize it.
- **Job lifecycle as a state machine** (composes with `functional` discriminated unions): job states `Queued | InFlight | Completed | Failed | DeadLettered`. Transitions are explicit; no implicit "did it succeed? unclear" state. Why: prevents the "job seemed to finish but I'm not sure" cases.
- **Cron overlap protection**: advisory lock on the cron job ID if the previous run is still in flight. Skip with structured log entry. Why: a slow cron job should not stack.

## What we reject

- **At-most-once delivery as default**: rejected. Achievable only under careful design (no retries, no redelivery, single delivery path) — which is fragile. At-least-once + consumer dedup is the default.
- **Custom retry-loop in business code**: rejected. Use the queue / job library's retry semantics. Hand-rolled retries hide failure modes.
- **Catching exceptions and silently retrying**: rejected. Either the failure is expected (validation, business rule) → handle explicitly via `Result`. Or unexpected → log and let the queue retry per its policy.
- **Storing idempotency keys in memory** (Map / Set): rejected. Process restart loses them. Use the IdempotencyStore port (Redis or Postgres).
- **Webhook handlers that mutate state BEFORE signature verification**: rejected. Verify FIRST, then mutate.
- **Jobs that take longer than the cron interval without overlap protection**: rejected.

## Hard rules surfaced by this skill

- **Webhook signature verification BEFORE state mutation**. Enforced by: SKILL.md + `withWebhookSafety()` wrapper enforces order + `code-review`.
- **Idempotency key check on every webhook / job handler**. Enforced by: SKILL.md + wrapper + `code-review`.
- **Replay window enforced** (reject events older than configured threshold, default 5 minutes). Enforced by: wrapper.
- **Outbox for DB-write + external-notification** patterns. Enforced by: SKILL.md + `code-review` flags "save then publish" sequences without outbox.
- **At-least-once is the default; consumers handle dedup**. Enforced by: SKILL.md.
- **Retries are bounded with backoff + jitter**. Enforced by: SKILL.md + queue config (pack-level).
- **Dead-letter queue on retry exhaustion + structured alert**. Enforced by: SKILL.md + pack config.
- **Cron overlap protection via advisory lock**. Enforced by: SKILL.md + pack wrapper.

## Modes — none

The discipline is uniform. Volume (high-frequency Stripe vs low-frequency cron) dictates storage choice for idempotency keys, not whether to use them.

## Companion hooks

None directly. The discipline is encoded in `pack-monorepo` / `pack-nextjs-pwa` wrappers (`withWebhookSafety`, `withJobSafety`, `withCronSafety`) and `code-review` flags.

## Composition with other skills

- **With `observability`**: trace propagates across job / webhook / queue boundaries via the message envelope. Job start / end / retry are structured events.
- **With `security-guidance`**: signature verification + replay window. Composes directly.
- **With `migrations`**: outbox table schema goes through the migrations discipline.
- **With `tdd`**: idempotency is testable. Test: same event delivered twice → same final state. Test: signature missing → reject. Test: replay window expired → reject.
- **With `hexagonal-architecture`**: webhook handler at the adapter boundary, business logic in use-case. IdempotencyStore as port.
- **With `functional`**: job state as discriminated union. `Result<JobOutcome, JobError>`.
- **With `code-review`**: flags missing signature verification, missing idempotency check, save-then-publish without outbox, custom retry loops in business code.

## Anti-rules

- MUST NOT decide queue technology (pack concern).
- MUST NOT decide alerting thresholds (ops concern).
- MUST NOT silently allow non-idempotent handlers.
- MUST NOT skip signature verification on webhooks.
- MUST NOT use in-memory dedup that loses state on restart.
- MUST NOT permit unbounded retries.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 400 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions idempotency keys + signature verify + outbox + at-least-once + bounded retries as headline
- [ ] `.source` file lists Stripe + Outbox + Pat Helland + GitHub webhooks + BullMQ + Inngest
- [ ] No new core hooks (discipline encoded in pack wrappers + code-review)
- [ ] `pack-monorepo` publishes `domain_events` outbox table + `IdempotencyStore` port + Postgres adapter
- [ ] `pack-nextjs-pwa` publishes `withWebhookSafety`, `withJobSafety`, `withCronSafety` wrappers
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/async-safety/` cover: duplicate-delivery idempotency, replay-window rejection, missing-signature rejection, retry-exhaustion-to-DLQ
- [ ] No overlap > 30% with other skills
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **Default outbox dispatcher**: `pg_notify` + worker vs poll-based vs Inngest. Lean Inngest as a `pack-nextjs-pwa` opt-in; otherwise poll-based default in `pack-monorepo`.
- **Idempotency-key TTL default**: 24h (memory-efficient) vs 30d (Stripe-grade). Lean 7 days as a middle ground; per-handler override.
- **Webhook replay window default**: 5 minutes (Stripe default) vs longer (some sources delay re-delivery). Lean 5 minutes default; override per webhook source.
- **Dead-letter handling**: automatic alert via Sentry vs separate DLQ surface. Lean Sentry alert + DLQ table (queryable post-incident).
- **Cron overlap protection mechanism**: Postgres advisory locks vs Redis SETNX. Lean Postgres advisory (no Redis dependency).

## Revision 2026-06-19 — fail-soft outbound HTTP (issue #17 cluster B, B1)

The skill covered the outbox (a write that must eventually happen) and inbound webhook safety, but not the mirror case: a synchronous OUTBOUND call to a third party on the request path. Added a "Fail-soft outbound HTTP" section — bound the time (`AbortSignal.timeout`), retry only idempotent reads with a cap, and decide critical (surface) vs degradable (cached/default fallback + structured warn) up front. Composes with observability + functional (outcome as a value, not an escaping throw). Plus an anti-rule and a stuck-table row.

## 2026-10-30 coherence correction

Compose the existing tested wrapper rather than duplicate its verify/claim/handle/mark
sequence. Provider verification owns authenticated delivery freshness; the wrapper
owns ordering and typed failure propagation. Pending receipt is not completion and
failed completion persistence must not return success. No provider crypto implementation
or universal event-age/TTL policy is introduced. See the correction audit for RED/GREEN
and the explicit limits of the in-memory store and verifier test doubles.
