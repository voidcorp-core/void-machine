---
name: void-expo-router-pattern
description: File-based routing in Expo via expo-router — layouts, tabs, modals, deep links. Mirrors Next.js App Router so monorepos can share mental model. Stack-aware navigation patterns.
---

# expo-router-pattern

Use when adding screens / navigation to an Expo app using `expo-router`. The convention mirrors Next.js App Router by design — same `(group)/`, `_layout.tsx`, `[param]`, dynamic segments — so a monorepo sharing web + mobile keeps one routing mental model.

If your app uses React Navigation directly (not expo-router), this skill does not apply (different API entirely).

## File layout (Solaar archetype)

```
apps/mobile/app/
├── _layout.tsx                # root layout: providers, Stack navigator
├── (tabs)/                    # tab navigation root
│   ├── _layout.tsx            # tab bar config
│   ├── index.tsx              # / → Home tab
│   ├── contacts/
│   │   ├── index.tsx          # /contacts
│   │   └── [id].tsx           # /contacts/123
│   ├── notes.tsx
│   └── settings.tsx
├── (modal)/                   # modal-presented screens
│   ├── _layout.tsx            # presentation: 'modal'
│   ├── new-contact.tsx        # /new-contact (slides up)
│   └── share.tsx
├── (auth)/                    # auth flow (no tabs)
│   ├── _layout.tsx            # presentation: stack, no tab bar
│   ├── sign-in.tsx
│   └── sign-up.tsx
└── +not-found.tsx             # 404
```

## Layouts: what each `_layout.tsx` does

### Root `app/_layout.tsx`

- Wraps `<Stack />` (or `<Slot />` for layoutless)
- Provides global Providers (Auth, Query Client, Theme, i18n)
- Initializes Sentry, fonts, splash hide
- Owns navigation theme (`DarkTheme` / `DefaultTheme`)

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { Providers } from '@/providers';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ /* ... */ });
  if (!loaded) return null;

  return (
    <Providers>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(modal)" options={{ presentation: 'modal' }} />
        <Stack.Screen name="(auth)" />
      </Stack>
    </Providers>
  );
}
```

### `(tabs)/_layout.tsx`

```tsx
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: 'gold' }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="contacts" options={{ title: 'Contacts' }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes' }} />
      <Tabs.Screen name="settings" options={{ title: 'Réglages' }} />
    </Tabs>
  );
}
```

### `(modal)/_layout.tsx`

```tsx
import { Stack } from 'expo-router';

export default function ModalLayout() {
  return <Stack screenOptions={{ presentation: 'modal' }} />;
}
```

## Navigation primitives

```tsx
import { useRouter, Link } from 'expo-router';

function ContactCard({ id }: { id: string }) {
  const router = useRouter();
  return (
    <>
      {/* Imperative */}
      <Pressable onPress={() => router.push(`/contacts/${id}`)} />

      {/* Declarative — composes with Tappable from @repo/ui */}
      <Link href={{ pathname: '/contacts/[id]', params: { id } }} asChild>
        <Tappable>{children}</Tappable>
      </Link>
    </>
  );
}
```

Prefer `<Link>` over `router.push` — typed params, better a11y (renders an actual touchable surface), works with deep links.

## Dynamic segments + typed routes

```
app/(tabs)/contacts/[id].tsx     →  /contacts/:id
app/(tabs)/contacts/[...rest].tsx →  /contacts/* (catch-all)
```

Access params:

```tsx
import { useLocalSearchParams } from 'expo-router';

export default function Contact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ContactView id={id} />;
}
```

Enable **typed routes** in `app.config.ts`:

```ts
experiments: { typedRoutes: true }
```

Then `<Link href="/contacts/xyz" />` is type-checked at build time.

## Deep links

`expo-router` automatically configures deep links from the file structure. To open the app at `/contacts/123` from outside:

```
iOS: yourscheme://contacts/123
Android: same
Universal Link / App Link: https://app.solaar.com/contacts/123
```

`scheme` in `app.config.ts`:

```ts
scheme: 'solaar',
```

Universal Links need additional setup (`apple-app-site-association`, `assetlinks.json` on the web).

## Modals

Two patterns:

### A. Modal as a route (`(modal)/` group)

Stack-based modal presentation, full route URL, supports deep linking. Use for screens that ARE work — new-contact form, share sheet, settings detail.

### B. Modal as local state

`useState` + a `<Modal>` component from React Native or Radix-ish mobile library. Use for transient UI — confirmation dialog, toast.

Same rule as web: if the modal should be shareable / deep-linkable / browser-backable, it's a route. Otherwise local state.

## Auth flow

`(auth)/` group with its own layout, no tab bar. Root layout redirects unauthenticated users:

```tsx
// app/_layout.tsx
import { Redirect } from 'expo-router';
import { useAuth } from '@/auth';

export default function RootLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/sign-in" />;
  return <Stack>...</Stack>;
}
```

## Anti-patterns

- ✗ **Mixing `react-navigation` directly with `expo-router`** — they conflict; pick one
- ✗ **One mega `_layout.tsx` at root with all logic** — push down to per-group layouts
- ✗ **Dynamic `useEffect` to redirect** — use `<Redirect>` or middleware-like guards in `_layout.tsx`
- ✗ **`router.replace` in render** — only call navigation actions in effects/handlers
- ✗ **Hardcoded path strings everywhere** — enable typedRoutes; centralize destinations in a constants file otherwise

## Composition

- `void-expo-config-plugins` — `expo-router` is itself a config plugin (`plugins: ['expo-router']`)
- `void-eas-build-profile` — dev profile must have `developmentClient: true` for expo-router to work in dev
- `void-route-group-decision` — same `(group)/` convention; same WHY (group by trust posture)
- `void-state-architecture` — modal-as-route vs modal-as-state decision
- `void-accessibility-check` — touch targets, focus management apply identically
