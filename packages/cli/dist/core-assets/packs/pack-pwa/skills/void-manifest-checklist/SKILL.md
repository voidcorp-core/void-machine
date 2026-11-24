---
name: void-manifest-checklist
description: "Get manifest.webmanifest right the first time — required fields, icon sizes (192, 512, maskable), display modes, scope, start_url. Single artifact: every field motivated, no dead options."
---

# manifest-checklist

Use when creating or updating the web app manifest. The manifest is the document that tells browsers "this is a PWA, install it like an app". A wrong manifest is the difference between "no install prompt ever" and "installable on all platforms".

If you have no manifest yet, this skill is the green-field checklist. If you have one and "install" doesn't work somewhere, this skill is the debug.

## File location and reference

```
apps/<app>/public/manifest.webmanifest     # the file
apps/<app>/app/layout.tsx                  # references via <link>
```

Reference in `<head>`:

```tsx
// app/layout.tsx
export const metadata = {
  manifest: '/manifest.webmanifest',
};
```

Or for Next 16's typed metadata.ts:

```ts
// app/manifest.ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return { /* ... */ };
}
```

Use the TS file if your stack supports it — typo-safe.

## Required fields

```json
{
  "name": "Solaar",
  "short_name": "Solaar",
  "description": "Relationship intelligence companion.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "lang": "fr",
  "dir": "ltr",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Every field above has a reason. Skipping ANY breaks installability on some platform.

## Field-by-field

### `name` and `short_name`

- `name`: full name shown in the install prompt and OS app list
- `short_name`: home screen label (truncated platforms). ≤ 12 chars ideal

Distinct values when the full name is long: `name: "Solaar by VoidCorp"`, `short_name: "Solaar"`.

### `start_url` and `scope`

- `start_url`: where the app opens on launch from home screen. Almost always `/`.
- `scope`: paths that "belong to" the app. Outside scope, the OS opens browser instead of in-app. Almost always `/`.

If you scope to `/app/` and the user visits `/marketing/`, they'll bounce out to browser. Usually undesired.

### `display`

| Value | Effect |
|---|---|
| `standalone` | Full-screen app, no browser UI. **Default for PWAs.** |
| `fullscreen` | Even hides the status bar (for games) |
| `minimal-ui` | Some browser controls visible |
| `browser` | Normal browser tab (no PWA-ness) |

Use `standalone`. The others are niche.

### `theme_color` and `background_color`

- `theme_color`: status bar / title bar color in standalone mode
- `background_color`: splash screen color before the app's CSS loads

Set both to your app's primary background. Mismatch causes a flash on launch.

### `lang` and `dir`

- `lang`: primary language ISO code (`fr`, `en`, `pt-BR`)
- `dir`: `ltr` or `rtl`

Don't omit. AT and OS use them for accessibility hints.

### `icons`

The minimum: **4 icons** — 192 and 512 in both `any` and `maskable` purposes.

- `any` purpose: standard square icons (used on browsers, older Android)
- `maskable`: safe-zone respected (used by Android adaptive icons, where the OS clips to circle/squircle/etc.). MUST have 20% padding around the actual logo

Larger sizes (1024) are nice but not required. iOS uses its own `apple-touch-icon.png` (set separately in `<head>`).

Generate from one SVG via:

```bash
npx pwa-asset-generator logo.svg public/icons/ --maskable-only false --padding "20%"
```

## Optional fields worth adding

```json
{
  "categories": ["productivity", "business"],
  "screenshots": [
    {
      "src": "/screenshots/home-narrow.png",
      "sizes": "390x844",
      "form_factor": "narrow",
      "label": "Accueil sur mobile"
    },
    {
      "src": "/screenshots/home-wide.png",
      "sizes": "1280x720",
      "form_factor": "wide",
      "label": "Accueil sur desktop"
    }
  ],
  "shortcuts": [
    {
      "name": "Nouveau contact",
      "url": "/contacts/new",
      "icons": [{ "src": "/icons/new-contact.png", "sizes": "96x96" }]
    }
  ],
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
}
```

- `categories`: helps Play Store / OS app categorization
- `screenshots`: shown in install prompt on Android (Chrome). **Set form_factor** so each is shown on the right platform
- `shortcuts`: appear on long-press of the app icon (Android)
- `share_target`: receive shared content from other apps

## Anti-patterns

- ✗ **Same icon for `any` and `maskable`** — maskable needs 20% padding; non-padded icon gets clipped on Android
- ✗ **Both `manifest.webmanifest` and `manifest.json`** — confuse browsers; pick `.webmanifest` (correct mime type)
- ✗ **`start_url: "/?source=pwa"`** with tracking query — breaks back-navigation, surprises the user
- ✗ **`scope: "."`** — relative scope is fragile; use `/`
- ✗ **Missing maskable icon** — Android adaptive icons render with broken padding
- ✗ **Theme color set on `<meta>` but missing in manifest** — inconsistent splash screen

## Verification

Browser DevTools → Application → Manifest:

- Shows parsed manifest with warnings
- "Installability" badge red? Read the reasons listed
- Use Chrome DevTools Lighthouse → PWA category for a comprehensive audit (target 100)

## Composition

- `void-install-prompt-ux` — installability depends on manifest being valid
- `void-service-worker-strategy` — SW + manifest are the two PWA artifacts; both required for install prompt
- `void-accessibility-check` — `lang` + `dir` are a11y signals
- `void-frontend-design` — theme_color and icon design should match the brand
