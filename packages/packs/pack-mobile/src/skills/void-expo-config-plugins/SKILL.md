---
name: void-expo-config-plugins
description: Add native functionality to an Expo app via config plugins, never by ejecting. Pick existing Expo modules first, write a custom plugin only when none fits. Document everything in app.config.ts.
---

# expo-config-plugins

Use when an Expo app needs functionality not available in JS — push notifications, camera, haptics, secure storage, or any native iOS/Android API. The Expo way: config plugins + Expo Modules. Ejecting to bare React Native is a one-way door — almost never the right answer.

## The decision tree

```
1. Is there an `expo-X` package on npm?         → use it (e.g., expo-camera, expo-haptics)
2. Is there a community config plugin?           → use it (search "expo-plugin" + your need)
3. Does it just need a Podfile / Manifest tweak? → write a custom config plugin (~30 lines)
4. Does it need new Swift/Kotlin code?           → write an Expo Module
5. Truly nothing fits?                           → reconsider the requirement; ejecting last resort
```

Most teams hit (1) for 80% of needs and never go past (3).

## What a config plugin is

A function that mutates the native iOS/Android project files at build time. It does not run in the app — it runs in EAS Build / `expo prebuild`.

```ts
// app.config.ts
import { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Solaar',
  slug: 'solaar',
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '15.1', useFrameworks: 'static' },
        android: { compileSdkVersion: 34, targetSdkVersion: 34 },
      },
    ],
    './plugins/my-custom-plugin',     // local plugin
  ],
});
```

Each entry is either:

- A string: package name; uses the package's default plugin
- A tuple `[name, props]`: passes config to the plugin

## Common Expo modules

Pin the ones below mentally — they handle 80% of native needs:

| Need | Package |
|---|---|
| Camera | `expo-camera` |
| Push notifications | `expo-notifications` |
| Haptics (vibrate, tap feedback) | `expo-haptics` |
| Secure storage (keychain / keystore) | `expo-secure-store` |
| File system | `expo-file-system` |
| Local notifications | `expo-notifications` |
| Authentication (OAuth, biometrics) | `expo-auth-session`, `expo-local-authentication` |
| Location | `expo-location` |
| Linking (deep links) | `expo-linking` |
| Updates | `expo-updates` |
| Sharing | `expo-sharing` |
| WebView | `expo-webview` (or `react-native-webview`) |
| Storage (key-value) | `expo-sqlite` or `react-native-mmkv` |

For each: install, add to `plugins` array if it needs prebuild config, use the JS API in your code.

## When to write a custom plugin

Two cases:

### A. Config-only (Info.plist, AndroidManifest tweaks)

```ts
// plugins/with-app-tracking.ts
import { ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

const withAppTracking: ConfigPlugin<{ reason: string }> = (config, { reason }) => {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSUserTrackingUsageDescription = reason;
    return cfg;
  });
};

export default withAppTracking;
```

Usage:

```ts
// app.config.ts
plugins: [
  ['./plugins/with-app-tracking', { reason: 'Personalize your experience' }],
];
```

This pattern handles: permission strings, URL schemes, custom Info.plist keys, AndroidManifest entries, build settings.

### B. Native code (Swift / Kotlin)

If you need actual native code, write an **Expo Module**, not a config plugin. Expo Modules are first-class native modules with auto-linking + TS bindings.

```bash
npx create-expo-module@latest --local my-native-module
```

The generated package has `ios/`, `android/`, and `src/` (TS bindings). Build runs `expo prebuild` automatically.

## When NOT to do native

Most "I need a native feature" turns out to be solvable in JS:

- **"I need to read the file system"** → `expo-file-system`, no native code
- **"I need biometric auth"** → `expo-local-authentication`
- **"I need to detect device type"** → `expo-device` provides everything

Try the JS path first. Native is overhead: build complexity, EAS Build minutes, debugging hardness.

## `app.config.ts` vs `app.json`

Use `app.config.ts`. Reasons:

- TypeScript = typo-safe
- Dynamic values (env vars, computed flags) supported
- One source of truth for dev/staging/prod variants

Example:

```ts
// app.config.ts
import { ConfigContext, ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT ?? 'dev';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant === 'prod' ? 'Solaar' : `Solaar (${variant})`,
  slug: 'solaar',
  ios: {
    bundleIdentifier: `io.voidcorp.solaar.${variant}`,
  },
  android: {
    package: `io.voidcorp.solaar.${variant}`,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  },
});
```

Dev + staging + prod variants installed side-by-side on a single device thanks to bundle ID variation.

## Anti-patterns

- ✗ **Ejecting on first sign of native need** — almost always reversible to "use an Expo module"
- ✗ **Hand-editing `ios/` or `android/`** after prebuild — gets nuked on next `expo prebuild`; bad merges between repo and prebuild
- ✗ **Mixing `app.json` and `app.config.ts`** — pick one, delete the other; precedence is unclear
- ✗ **`extra` field used for secrets** — `extra` ships in the JS bundle, visible to anyone
- ✗ **Plugin order matters and you ignored it** — some plugins must come before others (e.g., expo-router before any router consumer); follow plugin docs

## Verification

`npx expo prebuild --no-install --clean` — runs the plugin pipeline locally, generates `ios/` and `android/` you can inspect. If something's broken at native level, you'll see it before EAS.

## Composition

- `void-eas-build-profile` — config plugins + build profiles together define what binary ships
- `void-ota-update-strategy` — JS-only changes don't need a rebuild; native config changes do
- `void-state-architecture` — share state architecture with web siblings; only native deps differ
- `void-env-validation` — env reaches the app via `extra` or EAS Build env; validate with same schema discipline
