/**
 * `withWebhookSafety` — wrap a webhook handler with the canonical
 * void-machine async-safety pattern: verify → dedup → handle → mark.
 *
 * Composes with the `async-safety` and `security-guidance` skills.
 *
 * Order is enforced by the wrapper. The consumer owns idempotence of business effects.
 */

import type { Result } from '@voidcorp/pack-monorepo/result';
import { ok, err } from '@voidcorp/pack-monorepo/result';

export interface IdempotencyStore {
  /**
   * Atomic claim: returns 'claimed' if the key is new, 'already-processed' if
   * a previous run already marked it complete. A pending claim returns a store
   * error (retryable), never 'already-processed'. The TTL bounds the dedup window.
   */
  tryClaim(key: string, ttlMs: number): Promise<Result<'claimed' | 'already-processed', StoreError>>;
  markCompleted(key: string): Promise<Result<void, StoreError>>;
  release(key: string): Promise<Result<void, StoreError>>;
}

export type StoreError = { readonly kind: 'store-error'; readonly cause: unknown };

export interface WebhookSafetyOptions<TEvent> {
  /** Verify signature and provider-defined freshness of the delivery, before admission.
   * This callback owns replay policy; the wrapper invents no event-age limit. */
  readonly verify: (req: Request) => Promise<Result<TEvent, VerifyError>>;
  /** Compute the dedup key from the verified event (Stripe event.id, GitHub delivery ID, etc.). */
  readonly dedupKey: (event: TEvent) => string;
  /** Idempotency-key TTL. Default 7 days. */
  readonly dedupTtlMs?: number;
  /** The IdempotencyStore adapter. */
  readonly store: IdempotencyStore;
  /** Receives the verified event; business effects must tolerate retry. */
  readonly handler: (event: TEvent) => Promise<Result<void, HandlerError>>;
}

export type VerifyError =
  | { readonly kind: 'bad-signature' }
  | { readonly kind: 'replay-window-expired' }
  | { readonly kind: 'verify-error'; readonly cause: unknown };

export type HandlerError = { readonly kind: 'handler-error'; readonly cause: unknown };

export type WebhookOutcome =
  | { readonly status: 200; readonly body: { kind: 'ok' | 'duplicate' } }
  | { readonly status: 400; readonly body: { kind: 'bad-request'; reason: string } }
  | { readonly status: 500; readonly body: { kind: 'internal-error' } };

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function withWebhookSafety<TEvent>(
  opts: WebhookSafetyOptions<TEvent>,
): (req: Request) => Promise<WebhookOutcome> {
  const ttlMs = opts.dedupTtlMs ?? DEFAULT_TTL_MS;

  return async (req) => {
    // 1. Verify
    const verified = await opts.verify(req);
    if (!verified.ok) {
      const reason = verified.error.kind;
      return { status: 400, body: { kind: 'bad-request', reason } };
    }

    // 2. Dedup
    const key = opts.dedupKey(verified.value);
    const claim = await opts.store.tryClaim(key, ttlMs);
    if (!claim.ok) {
      return { status: 500, body: { kind: 'internal-error' } };
    }
    if (claim.value === 'already-processed') {
      return { status: 200, body: { kind: 'duplicate' } };
    }

    // 3. Handle
    try {
      const handled = await opts.handler(verified.value);
      if (!handled.ok) {
        await opts.store.release(key); // allow retry
        return { status: 500, body: { kind: 'internal-error' } };
      }
      // 4. Mark
      const completed = await opts.store.markCompleted(key);
      if (!completed.ok) {
        await opts.store.release(key);
        return { status: 500, body: { kind: 'internal-error' } };
      }
      return { status: 200, body: { kind: 'ok' } };
    } catch {
      await opts.store.release(key);
      return { status: 500, body: { kind: 'internal-error' } };
    }
  };
}

/** Internal helper for tests: build the outcome without running the wrapper. */
export function outcomeOk(): WebhookOutcome {
  return { status: 200, body: { kind: 'ok' } };
}

/** Re-export ok/err for convenience at adapter boundaries. */
export { ok, err };
