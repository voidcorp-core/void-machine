---
name: void-testing-server-modules
description: Unit-test modules guarded by server-only / client-only under Vitest by aliasing those packages to an empty stub. Test-time only; never a substitute for the real build-time boundary.
---

# testing-server-modules

`server-only` and `client-only` are import-time tripwires: they exist to **throw** the moment a server module is pulled into a client bundle (or vice-versa). That is exactly what you want at build time — and exactly what breaks Vitest, which runs neither in an RSC server graph nor in a browser. Importing any module whose chain reaches `server-only` crashes the test run with a cryptic `"This module cannot be imported from a Client Component module"` before a single assertion runs.

**Attribution**: see `.source`.

---

## The fix — alias the tripwire to an empty stub in the Vitest config

The tripwire's only job is to throw outside its runtime. Tests are outside its runtime by design, so the correct test-time substitute is an **empty module** — not a mock, not a partial.

```ts
// vitest.base.ts (shared config in the monorepo — extend it per package)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      'server-only': new URL('./test/stubs/empty.ts', import.meta.url).pathname,
      'client-only': new URL('./test/stubs/empty.ts', import.meta.url).pathname,
    },
  },
});
```

```ts
// test/stubs/empty.ts
export {}; // server-only / client-only export nothing; their side effect is the throw.
```

A single shared stub serves both. In a monorepo, put the alias in the `vitest.base` config every package extends, so no package re-discovers the gotcha (composes with `void-turbo-pipeline-tuning` and the shared `@repo/config`).

---

## What the alias does and does NOT buy you

- **Does**: lets you unit-test the *pure logic* inside a server module (the service, the mapper, the validation) without standing up an RSC runtime.
- **Does NOT**: make the module safe to import from a Client Component. The real server/client boundary still holds at build time — the alias is **test-only**. If a client component genuinely imports a server module, that is a real boundary violation the build will (correctly) reject; do not "fix" it by widening the alias. Keep the pure, testable logic in a runtime-agnostic `services/` module and let the thin server wrapper carry the `server-only` import (composes with `void-env-validation`, which keeps server-only env access out of the edge/client chain).

---

## When this applies

- A Vitest run fails on import with a `server-only` / `client-only` error before any test body executes.
- You are setting up the shared test config for a Next.js / RSC monorepo and want every package to inherit the alias once.

## When it does NOT

- Pure modules with no `server-only` import need no alias — prefer keeping domain logic runtime-agnostic so the question never arises.
- Integration/e2e runners that DO execute in the real runtime (Playwright, the Next.js test runtime) must NOT stub these — there the tripwire is meaningful.

---

## Anti-rules

- MUST NOT mock `server-only` with anything but an empty module — it has no API to mock, only a side effect to neutralize.
- MUST NOT use the alias to import a server module from client code in production — the alias is test-only; the boundary is real.
- MUST NOT scatter the alias per-test-file — define it once in the shared Vitest config.

---

## Final rule

```
server-only/client-only break Vitest → alias to an empty stub in the shared config, test the pure logic.
The build-time boundary stays real → never let the alias paper over a true client/server violation.
```
