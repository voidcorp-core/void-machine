# Progressive Web App (`@voidcorp/pack-pwa`)

PWA conventions for offline-first apps. Stack-agnostic — works with Next.js, Vite, Astro. For mobile-app conventions (Expo/React Native) see `@voidcorp/pack-mobile`.

## Required artifacts

```
public/
├── manifest.webmanifest                 # required
├── icons/
│   ├── icon-192.png                     # required (any-purpose)
│   ├── icon-512.png                     # required (any-purpose)
│   ├── icon-maskable-192.png            # required (Android adaptive)
│   └── icon-maskable-512.png            # required
└── sw.js                                # built by Workbox/Serwist (don't hand-write)
```

`manifest.webmanifest` is the authoritative metadata; do **not** also keep a stale `manifest.json`.

## Service worker

- Prefer **Serwist** (modern Workbox successor) for Next.js, **vite-plugin-pwa** for Vite.
- Strategies:
  - HTML pages: `NetworkFirst` with 3s timeout, fallback to cache
  - Static assets (JS/CSS/fonts): `CacheFirst`
  - API calls: `NetworkOnly` by default; opt-in `NetworkFirst` for tolerable reads
- Versioning: include a build hash in cache names so old workers expire correctly.

## Offline-first data

The Solaar pattern: every write goes through a **capture queue** (IndexedDB) and a **sync engine**:

```
UI write → captureQueue.enqueue(intent) → optimistic update → sync()
                                                                 ↓
                                                       server (Server Action)
```

- `captureQueue` persists intents in IndexedDB with idempotency keys.
- `sync()` retries with exponential backoff, marks intents as committed/failed.
- Conflict resolution: server is source of truth; local optimistic state is overwritten on conflict.

The capture-queue + sync pattern is small (~100 lines) — consumers own it directly in their codebase. See `void-offline-first-mutation` skill for the canonical implementation.

## Install prompt UX

- Do not auto-prompt on first visit (sketchy). Wait for a meaningful engagement signal (≥ 2 sessions OR ≥ 30s in-app).
- Honor `beforeinstallprompt` event; capture and defer.
- Provide an explicit "Install" button in the app menu.

## Composition

- `harness-react` — components subscribe to capture-queue state via hooks.
- `harness-server` — Server Actions are the sync target; their idempotency-key handling pairs with capture-queue keys.
- `harness-nextjs` — Serwist plugin in `next.config.ts`, manifest in `app/manifest.ts`.
- `void-async-safety` — sync engine retries are bounded, dead-letter routing on permanent failure.
