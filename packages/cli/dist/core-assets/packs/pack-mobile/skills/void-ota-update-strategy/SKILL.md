---
name: void-ota-update-strategy
description: Ship JS-only fixes via EAS Update; full rebuild via EAS Build. Runtime versions, channels, rollback. The "when can I OTA vs when do I rebuild" decision.
---

# ota-update-strategy

Use when planning to ship a change to an Expo app already in users' hands. The fundamental choice: **JS-only change** → EAS Update (minutes); **native change** → EAS Build + store submit (hours/days). Getting this wrong means either users running broken apps or unnecessary store rejections.

## The fundamental rule

| Change type | Path | Speed |
|---|---|---|
| JS bug fix (logic, UI text, layout) | EAS Update | Minutes |
| Adding a new screen (no new native dep) | EAS Update | Minutes |
| Changing a string in `app.config.ts` env | EAS Update if same plugins | Minutes |
| New `expo-X` package added to plugins | EAS Build + submit | Hours + store review days |
| Native config changes (Info.plist, permissions) | EAS Build + submit | Hours + store review |
| New native module | EAS Build + submit | Hours + store review |
| Bump SDK version | EAS Build + submit | Hours + store review |

When in doubt: if the change touches `plugins:` or `ios:`/`android:` config in `app.config.ts`, it needs a rebuild.

## Branches and channels (mental model)

EAS Update splits the publishing target in two layers:

- **Branch** — where you PUBLISH an update (`eas update --branch production`)
- **Channel** — what the BUILD reads from (declared in `eas.json` per profile)

Builds read from a channel; channels point at branches; you publish to branches.

```jsonc
// eas.json
"production": {
  "channel": "production",
  // ...
}
```

This build is on channel `production`. By default, channel `production` points at branch `production`. To re-point: `eas channel:edit production --branch <other>`.

Publish to the production branch (so the production channel picks it up):

```bash
eas update --branch production --message "Fix avatar crash on iOS"
```

A user with a production-channel build pulls this update on next app launch.

Pre-launch / staging:

```bash
eas update --branch preview --message "..."
```

Users with a preview-channel build get this update; production users don't see it (different channel → different branch).

## Runtime versions — the critical detail

`expo-updates` checks **runtime version** before applying an update. If the update's runtime version doesn't match the build's, the update is silently skipped.

```ts
// app.config.ts
runtimeVersion: { policy: 'fingerprint' },
```

`'fingerprint'` is the modern policy: SDK + every native plugin + every native dep contribute to a hash. Add a native plugin → fingerprint changes → new builds have new runtime version → old builds won't accept new updates (which is correct: old build can't run the new code anyway).

Other policies:

- `'appVersion'` — uses `version` field (manual; you remember to bump it when adding native)
- `'sdkVersion'` — every SDK bump = new runtime (coarse; native changes within an SDK rev don't trigger)

`fingerprint` is the right default; the others are legacy. Don't use them on new apps.

## Update strategy: when does the user actually see the update

`expo-updates` config:

```ts
// app.config.ts (extra section or via expo-updates config block)
updates: {
  enabled: true,
  checkAutomatically: 'ON_LOAD',     // check on every cold start
  fallbackToCacheTimeout: 0,         // 0 = use cache instantly, check in background
}
```

| `checkAutomatically` | When checks happen |
|---|---|
| `ON_LOAD` | Every cold start |
| `ON_ERROR_RECOVERY` | Only after a crash |
| `NEVER` | Manual only (call `Updates.checkForUpdateAsync()` yourself) |

For most apps, `ON_LOAD` + `fallbackToCacheTimeout: 0` is right: instant launch with cached code, update applied silently on next launch.

If you need immediate apply (critical security fix), code-call:

```ts
import * as Updates from 'expo-updates';

async function applyUpdateIfAvailable() {
  const update = await Updates.checkForUpdateAsync();
  if (update.isAvailable) {
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();         // forces immediate reload
  }
}
```

Show a confirmation UI before forced reload — don't yank the user out of their current task.

## Rollback

If an update is broken, deploy a fixed one — there's no "delete" for OTA updates, but newer wins.

```bash
eas update --branch production --message "Revert: avatar crash fix had its own bug"
```

The new update reverts the change in code. Users get it on next check.

For a hard halt of bad updates, republish a known-good update at the head of the branch:

```bash
eas update:republish --branch production --group <previous-good-update-id>
```

Or re-point the production channel at a known-good branch:

```bash
eas channel:edit production --branch production-stable
```

This shifts every production-channel build to read the alternate branch.

## Testing updates before production

`eas channel:edit` lets you point a channel at any branch:

```bash
# Build was on production, but you want to test an update from "experimental" branch
eas channel:edit production --branch experimental
```

Test on real production-channel builds → switch back to production branch when validated:

```bash
eas channel:edit production --branch production
```

## What CAN'T go in an OTA update

- Anything touching native code (SDK bump, new module, config plugin change)
- Adding new permissions
- Changing the bundle ID, name, icon
- Splash screen image change (it's pre-bundled in the native shell)

These all require EAS Build + store submission. Plan ahead.

## Anti-patterns

- ✗ **`'appVersion'` runtime policy** — silently skips updates when devs forget to bump version. `fingerprint` removes this trap.
- ✗ **OTA-ing a native dep change** — update silently doesn't apply (different runtime version). Confusing for hours of debugging.
- ✗ **`Updates.reloadAsync()` without warning** — yanks user mid-task; bad UX
- ✗ **Same channel for staging + prod** — staging users get prod updates; prod users get unfinished work
- ✗ **No `extra` field for update metadata** — can't tell "which build is this user on" in Sentry / analytics

## Verification

After deploying an update:

```bash
eas update:list --branch production --limit 5
```

Shows recent updates with IDs, messages, runtime versions, dates. Spot the new one.

In the app, check:

```ts
import * as Updates from 'expo-updates';
console.log(Updates.updateId, Updates.createdAt);
```

This logs which update the user is currently on. Useful in a debug screen for QA.

## Composition

- `void-eas-build-profile` — channel names map to build profile names
- `void-expo-config-plugins` — plugin changes invalidate runtime versions
- `void-observability` — log `Updates.updateId` in every Sentry event so you can correlate "which JS is running"
- `void-async-safety` — `Updates.checkForUpdateAsync()` failures should not block app launch; timeout + fallback to cached
