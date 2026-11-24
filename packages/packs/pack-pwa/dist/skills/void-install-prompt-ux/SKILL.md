---
name: void-install-prompt-ux
description: Surface the PWA install prompt at the right moment (engagement signal) with the right UI (custom button, not auto-prompt). Capture beforeinstallprompt, defer, recover declined.
---

# install-prompt-ux

Use when adding "Install app" UX to a PWA, or when figuring out why the default browser prompt doesn't appear / appears at the wrong time. Default browser behavior is broken for most apps — too early, too generic, no recovery.

This skill is the void-machine pattern: capture the event, defer it, surface a custom button at a meaningful moment.

## The browser default is bad

Without custom code, Chrome (etc.) decides when to show a small browser-styled "Add to Home Screen" toast. The decision is opaque (engagement heuristic), the UI is generic, and once dismissed it doesn't reappear soon. Users either miss it or click "Cancel" reflexively.

Solution: hijack the prompt, defer it, show your own button.

## The `beforeinstallprompt` flow

```tsx
// apps/web/src/components/InstallPrompt.tsx
'use client';

import { useEffect, useState } from 'react';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // 1. Capture the event when the browser fires it
    const onBIP = (e: Event) => {
      e.preventDefault();                         // don't show browser default
      setDeferred(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', onBIP);

    // 2. Detect already-installed (PWA opened from home screen)
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // 3. Sanity check: are we already in standalone mode?
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled || !deferred) return null;

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();                      // shows the browser native prompt NOW
    const { outcome } = await deferred.userChoice;
    setDeferred(null);                            // one shot per page load; can't re-prompt
    if (outcome === 'accepted') {
      // Tracked, navigated to standalone — onInstalled fires shortly
    } else {
      // User dismissed — store decision, don't pester
      localStorage.setItem('install-dismissed-at', String(Date.now()));
    }
  }

  return (
    <button onClick={handleInstall}>Installer l'app</button>
  );
}
```

## When to show your custom button

NOT immediately. Show only after an engagement signal — proof the user finds the app useful:

| Signal | Threshold (default) |
|---|---|
| Sessions completed | ≥ 2 |
| Time in-app this session | ≥ 30 seconds |
| Key action completed | 1 (e.g., created their first contact in Solaar) |
| Days since first visit | ≥ 1 |

Combine: "shown after 2 sessions AND ≥ 30s AND not dismissed in the last 7 days". The combination kills the "saw an empty app, prompted to install, declined forever" failure.

```tsx
const ENGAGEMENT_THRESHOLD = { sessions: 2, secondsThisSession: 30 };

function shouldShow(state) {
  const dismissedAt = Number(localStorage.getItem('install-dismissed-at') ?? 0);
  const daysSinceDismiss = (Date.now() - dismissedAt) / (24 * 60 * 60 * 1000);
  if (dismissedAt && daysSinceDismiss < 7) return false;
  return state.sessions >= ENGAGEMENT_THRESHOLD.sessions &&
         state.secondsThisSession >= ENGAGEMENT_THRESHOLD.secondsThisSession;
}
```

## Recovery: dismissed → can we re-prompt?

Once `beforeinstallprompt` is dismissed, Chrome won't refire for at least 90 days (per their heuristic, not contractual). Strategies:

- **Cooldown**: store `install-dismissed-at`, don't show button for 7-14 days. After cooldown, if `deferred` is again non-null (Chrome decided to re-fire), show.
- **Fallback for unsupported browsers** (Safari iOS): provide instructions in a help page ("Tap Share → Add to Home Screen").

iOS Safari doesn't fire `beforeinstallprompt` at all. The button can still be useful as a "How to install on iPhone" link.

## Placement of the install button

Three patterns; pick one based on app type:

- **A. In the settings/profile menu**: discoverable for power users, low-friction. Default.
- **B. As a dismissible banner**: more aggressive; for content-heavy apps where install is the conversion goal
- **C. After a key action**: e.g., "Just created your first contact! Install the app to access it offline." Highest conversion when timed right.

Avoid: modal pop-ups on first visit (worst conversion + user trust).

## Anti-patterns

- ✗ **Calling `deferred.prompt()` without user gesture** — browsers reject; the prompt won't fire
- ✗ **Showing the install button before SW registers** — install prompt requires manifest + SW; show only after `serviceWorker.ready`
- ✗ **No recovery for dismissed users** — silent forever
- ✗ **Pestering on every page** — kills trust; one button in the settings menu is enough for most apps
- ✗ **No handling for iOS** — Safari doesn't fire BIP; without a fallback "how to install" page, iOS users have no path

## Anatomy of a great PWA install flow (Solaar archetype)

1. New visitor → no install UX
2. Visit 2, 30s in → small "Installer" button appears in settings menu (subtle)
3. After creating first contact → contextual prompt: "Vos contacts dans la poche. Installer ?"
4. User dismisses → 7-day cooldown
5. After 7 days, if still using the app → re-prompt in the contextual spot, not in face

## Verification

DevTools → Application → Manifest → "Add to home screen" button (forces install in dev).
Lighthouse → PWA category → "Installable" should be green; otherwise read the failure reasons (usually missing icon, missing start_url, etc.).

## Composition

- `void-manifest-checklist` — installability requires a valid manifest first
- `void-service-worker-strategy` — installability requires SW registered
- `void-accessibility-check` — install button is interactive; needs label, focus ring
- `void-observability` — track install events (`window.addEventListener('appinstalled', ...)`) for conversion measurement
- `void-frontend-design` — when to show, where to place — UX trade-offs covered here
