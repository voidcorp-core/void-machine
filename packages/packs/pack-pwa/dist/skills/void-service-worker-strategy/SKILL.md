---
name: void-service-worker-strategy
description: Pick caching strategy per route class (NetworkFirst, CacheFirst, StaleWhileRevalidate, NetworkOnly), version your caches, handle update activation. Use Serwist (Next) or vite-plugin-pwa.
---

# service-worker-strategy

Use when configuring or modifying a service worker in a PWA project. The strategy choice per route class is the difference between "instant repeat visits" and "stale content shown for days" or "no offline support".

If your app has no service worker yet, this skill says how to add one. If it has one but feels broken, this skill says how to debug.

## The library choice

| Stack | Library |
|---|---|
| Next.js 16 | **Serwist** (modern Workbox successor, App Router compatible) |
| Vite | **vite-plugin-pwa** (wraps Workbox) |
| Astro | `@vite-pwa/astro` |
| Custom | Workbox directly (hard mode; only if you understand SW internals) |

Don't hand-write a service worker. Serwist/Workbox handles the lifecycle gotchas (skipWaiting, clientsClaim, cache versioning) you'd otherwise rediscover the hard way.

## Strategies per route class

Match the strategy to the **freshness vs availability** trade-off of each resource type.

| Resource | Strategy | Why |
|---|---|---|
| HTML pages (`/`, `/blog/*`) | `NetworkFirst({ networkTimeoutSeconds: 3 })` | Fresh content preferred; fallback to cache after 3s for offline |
| JS / CSS bundles (hashed names) | `CacheFirst` | Hash in name = immutable; cache forever |
| Fonts | `CacheFirst({ maxAge: 1 year })` | Rarely changes; large download |
| Images | `CacheFirst({ maxAge: 30 days, maxEntries: 60 })` | Expensive bandwidth |
| API responses | `NetworkOnly` (default) | Fresh data required; capture-queue handles offline writes |
| API responses (tolerable stale, e.g. /me) | `StaleWhileRevalidate` | Show cached, update in background |
| Manifest | `NetworkOnly` | Browser handles caching natively |
| `/api/health` | `NetworkOnly` | Should always reflect server reality |

## Canonical Serwist config sketch (Next 16)

> Serwist evolves quickly; the **strategy-per-resource-class principles** below are the substance. The exact config shape may differ per Serwist version — always cross-reference the current Serwist docs when scaffolding.

```ts
// apps/web/app/sw.ts (shape — confirm against current Serwist version)
import { Serwist, NetworkFirst, CacheFirst, NetworkOnly } from 'serwist';

const SW_VERSION = '__BUILD_HASH__';   // injected by build

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,  // injected: static assets to pre-cache
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // HTML pages: prefer fresh, fall back to cache after 3s on slow networks
    {
      matcher: ({ request }) => request.destination === 'document',
      handler: new NetworkFirst({
        cacheName: `html-${SW_VERSION}`,
        networkTimeoutSeconds: 3,
      }),
    },
    // JS/CSS: hashed filenames are immutable; cache forever
    {
      matcher: ({ request }) => request.destination === 'script' || request.destination === 'style',
      handler: new CacheFirst({ cacheName: `static-${SW_VERSION}` }),
    },
    // Images: cache for 30 days, cap at 60 entries
    {
      matcher: ({ request }) => request.destination === 'image',
      handler: new CacheFirst({ cacheName: `images-${SW_VERSION}` }),
    },
    // API: never cache; let the network speak
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
  ],
});

serwist.addEventListeners();
```

`vite-plugin-pwa` exposes the same strategies under Workbox names (`NetworkFirst`, etc.) with slightly different option keys. The **what** (per-resource strategy + version cacheName + max age) transfers; the **how** (exact constructor call) is library-specific.

## Cache versioning — the critical detail

Without versioning, an updated worker reads old caches with old asset URLs → broken page after deploy.

The pattern: include `SW_VERSION` (build hash, app version, anything that changes per deploy) in EVERY `cacheName`:

```ts
cacheName: `html-${SW_VERSION}`        // not just `html`
```

On worker activation, old caches (with old version names) are orphaned. Periodic cleanup:

```ts
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.endsWith(`-${SW_VERSION}`))
        .map((k) => caches.delete(k))
    );
  })());
});
```

Serwist handles this if `cleanupOutdatedCaches: true` (default in newer versions).

## Update activation UX

Three patterns; pick one.

### A. Silent — worker activates on next page load

Default. Simplest. New worker becomes active after the user closes/reopens the tab. Works for most apps.

### B. "Reload to update" prompt

When a new worker is waiting, show a banner. User clicks → `skipWaiting()` + reload.

```ts
// In a Client Component
import { Workbox } from 'workbox-window';

const wb = new Workbox('/sw.js');
wb.addEventListener('waiting', () => {
  setShowUpdatePrompt(true);
});

function applyUpdate() {
  wb.addEventListener('controlling', () => window.location.reload());
  wb.messageSkipWaiting();
}
```

Use when shipping critical fixes that should not wait for tab close.

### C. Auto-apply (aggressive)

`skipWaiting: true` + `clientsClaim: true` (shown in canonical config above). New worker takes over immediately. Risk: in-flight requests served by old worker can race with new worker.

Default to C for greenfield, B for production-critical apps where users keep tabs open for days.

## Anti-patterns

- ✗ **No version in cacheName** — orphan caches grow forever, eventually quota-exceed
- ✗ **CacheFirst on HTML** — stuck on stale page after deploy
- ✗ **NetworkFirst without networkTimeoutSeconds** — slow networks see infinite spinner instead of cached fallback
- ✗ **Workbox plugin without HTTPS** — service workers only register on HTTPS or localhost (silent failure otherwise)
- ✗ **`skipWaiting` for sensitive data screens** — old worker mid-checkout, new worker takes over, weird state. Pattern B (prompt) is safer for checkout flows.
- ✗ **Caching POST/PUT/DELETE** — only GET is cacheable; service workers don't cache mutations

## Debugging

DevTools → Application → Service Workers:

- "Update on reload" checkbox helps during development
- "Unregister" + hard reload resets state
- "Bypass for network" disables SW temporarily

DevTools → Application → Cache Storage:

- Lists all named caches
- Click a cache → see entries, sizes, last accessed
- Should see one cache PER cacheName variant (versioned correctly)

## Composition

- `void-manifest-checklist` — manifest declares the SW scope; service worker honors it.
- `void-install-prompt-ux` — SW must be registered before install prompt fires.
- `void-offline-first-mutation` — capture-queue lives alongside SW; SW handles GET caching, capture-queue handles mutations.
- `void-cache-component-pattern` — Next's server-side cache is independent of SW; both layers compose.
- `void-async-safety` — SW activation race conditions are timing bugs; bounded retries on update apply.
