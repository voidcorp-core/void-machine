import { describe, expect, it } from 'vitest';
import {
  err, ok, withWebhookSafety,
  type IdempotencyStore, type StoreError,
} from './withWebhookSafety.js';

function memoryStore(): IdempotencyStore {
  const completed = new Set<string>();
  const claimed = new Set<string>();
  return {
    async tryClaim(key) {
      if (completed.has(key)) return ok('already-processed');
      if (claimed.has(key)) return err({ kind: 'store-error', cause: 'busy' });
      claimed.add(key);
      return ok('claimed');
    },
    async markCompleted(key) { completed.add(key); claimed.delete(key); return ok(undefined); },
    async release(key) { claimed.delete(key); return ok(undefined); },
  };
}

const request = () => new Request('https://example.test/webhook', { method: 'POST' });
const storeFailure = (): { ok: false; error: StoreError } =>
  err({ kind: 'store-error', cause: 'unavailable' });

describe('withWebhookSafety', () => {
  it('retries a failed event and deduplicates only its completed delivery', async () => {
    let attempts = 0;
    let effects = 0;
    const handle = withWebhookSafety({
      verify: async () => ok({ id: 'event-1' }),
      dedupKey: (event) => event.id,
      store: memoryStore(),
      handler: async () => {
        attempts += 1;
        if (attempts === 1) return err({ kind: 'handler-error', cause: 'transient' });
        effects += 1;
        return ok(undefined);
      },
    });
    expect((await handle(request())).status).toBe(500);
    expect((await handle(request())).body.kind).toBe('ok');
    expect((await handle(request())).body.kind).toBe('duplicate');
    expect(effects).toBe(1);
  });

  it('retries after completion persistence fails without repeating an idempotent business effect', async () => {
    const store = memoryStore();
    let completedWrites = 0;
    const effects = new Set<string>();
    const handle = withWebhookSafety({
      verify: async () => ok({ id: 'event-1' }),
      dedupKey: (event) => event.id,
      store: { ...store, markCompleted: async (key) => {
        completedWrites += 1;
        return completedWrites === 1 ? storeFailure() : store.markCompleted(key);
      } },
      handler: async (event) => { effects.add(event.id); return ok(undefined); },
    });
    expect((await handle(request())).status).toBe(500);
    expect((await handle(request())).body.kind).toBe('ok');
    expect((await handle(request())).body.kind).toBe('duplicate');
    expect(effects.size).toBe(1);
  });

  it('does not acknowledge a concurrent delivery while the first is pending', async () => {
    let finish = () => {};
    let entered = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const handle = withWebhookSafety({
      verify: async () => ok({ id: 'event-1' }),
      dedupKey: (event) => event.id,
      store: memoryStore(),
      handler: async () => { entered(); await pending; return ok(undefined); },
    });
    const first = handle(request());
    await started;
    expect((await handle(request())).status).toBe(500);
    finish();
    expect((await first).body.kind).toBe('ok');
    expect((await handle(request())).body.kind).toBe('duplicate');
  });

  for (const kind of ['bad-signature', 'replay-window-expired'] as const) {
    it(`rejects ${kind} before claiming or handling an event`, async () => {
      const handle = withWebhookSafety({
        verify: async () => err({ kind }),
        dedupKey: () => { throw new Error('unverified event reached dedup'); },
        store: memoryStore(),
        handler: async () => { throw new Error('unverified event reached handler'); },
      });
      expect(await handle(request())).toEqual({ status: 400, body: { kind: 'bad-request', reason: kind } });
    });
  }

  it('accepts a fresh verified delivery of an old event without an invented event-age limit', async () => {
    const handle = withWebhookSafety({
      verify: async () => ok({ id: 'old-event', createdAt: 1 }),
      dedupKey: (event) => event.id,
      store: memoryStore(),
      handler: async () => ok(undefined),
    });
    expect((await handle(request())).body.kind).toBe('ok');
  });
});
