# Mobile conventions (`@voidcorp/pack-mobile`)

Expo + React Native conventions. Composes with `@voidcorp/pack-react` for component primitives (Tappable, tokens, accessibility).

## Stack

- **Expo SDK** (latest LTS), managed workflow by default; eject only with explicit justification.
- **EAS Build** for binaries, **EAS Update** for OTA JS bundle updates.
- **expo-router** for filesystem routing (mirrors Next.js App Router conventions).

## Layout

```
apps/<app>/
├── app/                         # expo-router routes (mirrors Next.js conventions)
│   ├── (tabs)/                  # Tab navigation root
│   ├── (modal)/                 # Modal screens
│   └── _layout.tsx
├── components/                  # See harness-react (same purity rules)
├── services/                    # Domain logic (shared with web if monorepo)
├── adapters/                    # Native module wrappers
└── app.config.ts                # Expo config (NEVER app.json — config.ts is typed)
```

## Safe-area

- Wrap every screen root in `<SafeAreaView>` from `react-native-safe-area-context`.
- Never hard-code top padding to "skip the notch" — that breaks on devices without one.

## Touch targets

44×44 baseline (iOS) / 48×48 (Material). The `<Tappable>` primitive from `@repo/ui` enforces this on both web and native via platform-aware sizing.

## Native modules

- Prefer Expo modules (`expo-camera`, `expo-haptics`, …) over bare RN modules.
- If a native module is needed that Expo doesn't provide, build it as an Expo Module (typed, autolinked) — not as a config plugin patch.
- Document the dependency in `app.config.ts` plugins array with a comment explaining the WHY.

## OTA updates (EAS Update)

- Critical fixes can ship as JS-only via `eas update --branch production`.
- Native binary changes (new module, native config) require a new build.
- The `app/_runtime-version.ts` file declares the minimum runtime version; bump it when shipping a native binary so older OTA bundles don't run on the new binary.

## Composition

- `harness-react` — same component purity, same primitives (Tappable, tokens).
- `void-accessibility` — VoiceOver/TalkBack labels, focus order, dynamic type.
- `harness-server` — mobile app talks to the same Server Actions as the web app; share the action schemas via `@repo/api-types`.
