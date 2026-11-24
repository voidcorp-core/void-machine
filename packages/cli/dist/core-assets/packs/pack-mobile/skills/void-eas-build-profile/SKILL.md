---
name: void-eas-build-profile
description: Configure eas.json profiles (development, preview, production) with the right env, bundle ID, signing, distribution. The 3-profile structure that fits 95% of Expo apps.
---

# eas-build-profile

Use when configuring EAS Build for an Expo app. The default `eas.json` Expo scaffolds is fine to start; this skill ships the void-machine convention for the 3 standard profiles + the why behind each option.

## The 3-profile structure

```jsonc
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true },
      "android": { "buildType": "apk" },
      "env": { "APP_VARIANT": "dev" }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" },
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "distribution": "store",
      "autoIncrement": true,
      "env": { "APP_VARIANT": "prod" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "team@voidcorp.io", "ascAppId": "1234567890", "appleTeamId": "ABCD1234" },
      "android": { "serviceAccountKeyPath": "./google-play.json", "track": "internal" }
    }
  }
}
```

## Each profile, in plain words

### `development`

- **Use case**: dev on simulator + device with hot reload, Metro bundler attached
- **`developmentClient: true`** → builds a dev client (custom Expo Go) embedding your native deps. Without it, `expo-router` and custom modules don't work in Expo Go.
- **`distribution: "internal"`** → not for App Store; for your team
- **`ios.simulator: true`** → produces a `.app` runnable in iOS Simulator; runs `xcodebuild -sdk iphonesimulator`
- **`android.buildType: "apk"`** → APK (not AAB); apk is easier to install ad-hoc

Builds with `eas build -p ios --profile development` then `eas build:run -p ios` to install.

### `preview`

- **Use case**: TestFlight equivalents, stakeholder testing, QA
- **`distribution: "internal"`** → shareable link from EAS dashboard; no store submission
- **`ios.simulator: false`** → real device build
- **`android.buildType: "apk"`** → APK still (easier for stakeholders)
- Identical to production except distribution channel and variant env

### `production`

- **Use case**: App Store / Play Store submission
- **`distribution: "store"`** → signed for store distribution
- **`autoIncrement: true`** → bumps `buildNumber` (iOS) and `versionCode` (Android) per build; required by stores
- **Default `android.buildType: "aab"`** (App Bundle) — required by Play Store

## Env per profile

The `env` block in each profile sets vars **at build time** (baked into the JS bundle for `EXPO_PUBLIC_*`, available via `process.env.X` in `app.config.ts`).

Pattern: `APP_VARIANT` env switches the bundle ID, name, and API URL via `app.config.ts`:

```ts
// app.config.ts
const variant = process.env.APP_VARIANT ?? 'dev';
const apiUrls = {
  dev:     'https://api-dev.voidcorp.io',
  preview: 'https://api-preview.voidcorp.io',
  prod:    'https://api.voidcorp.io',
};

export default ({ config }) => ({
  ...config,
  name: variant === 'prod' ? 'Solaar' : `Solaar ${variant}`,
  ios: { bundleIdentifier: `io.voidcorp.solaar.${variant}` },
  android: { package: `io.voidcorp.solaar.${variant}` },
  extra: { apiUrl: apiUrls[variant] },
});
```

This pattern installs all 3 variants on one device — useful for QA comparing prod-vs-preview behavior.

## Secrets — never in eas.json

The `env` block in `eas.json` ships in the bundle. **NEVER** put secrets there. For server-side secrets needed during build (e.g., to pull private deps):

```bash
eas secret:create --scope project --name NPM_TOKEN --value "..."
```

EAS injects secrets into the build environment; they don't end up in the JS bundle.

## Signing and credentials

Run once per profile:

```bash
eas credentials
```

Walks you through: iOS Distribution Certificate, Provisioning Profile, Push Notification Key, Android Keystore. Expo stores them encrypted on their servers.

For team setups: `eas credentials:configure` syncs across team members so anyone can build.

## `submit` config — for one-command store submission

After a production build, submit with:

```bash
eas submit -p ios --latest
eas submit -p android --latest
```

`submit` config in `eas.json` saves you from re-entering app store credentials each time. iOS requires Apple Team ID + ASC App ID; Android requires a service account JSON from Google Cloud (delegated rights for Play Store API).

## Channel-based OTA (`expo-updates`)

EAS Build embeds an `updates.channel` per build profile:

```jsonc
"production": {
  "channel": "production",
  // ...
}
```

`expo-updates` then fetches OTA updates from the matching channel. See `void-ota-update-strategy` for the full pattern.

## Anti-patterns

- ✗ **Same bundle ID across variants** — can't install dev + prod on same device
- ✗ **Same signing config across variants** — staging users get prod data leaks
- ✗ **`env` for secrets** — leaks into bundle
- ✗ **Manual version bumping** — `autoIncrement` exists for a reason
- ✗ **5+ profiles** — usually means you haven't clarified variant strategy. 3 is enough.

## Verification

```bash
eas build --profile preview --platform ios --local      # local build (no EAS minutes spent)
```

If local build succeeds, EAS will too. If it fails, the error is identical — debug locally before pushing to EAS.

## Composition

- `void-expo-config-plugins` — plugins define what's IN the binary; profiles define HOW it's built
- `void-ota-update-strategy` — channel-based OTA aligns with profile names
- `void-expo-router-pattern` — expo-router needs `developmentClient: true` in dev profile
- `void-env-validation` — runtime env via `extra` validated with same Zod discipline
