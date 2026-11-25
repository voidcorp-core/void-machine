# Monorepo layout (`@voidcorp/pack-monorepo`)

This repository is a Turborepo workspace following the void-machine `pack-monorepo` conventions.

## Topology

```
<repo>/
├── apps/
│   └── <app>/                       # Next.js, CLI, or worker apps
│       ├── src/
│       └── package.json
├── packages/                        # Tier 1: always-on workspace packages
│   ├── core/                        # @repo/core   — logger, env, errors, Result, Option, pipe
│   ├── auth/                        # @repo/auth   — Better-Auth wrapper, RBAC, action factories
│   ├── db/                          # @repo/db     — Drizzle schema + getDb()
│   ├── ui/                          # @repo/ui     — Radix-backed primitives, ThemeProvider
│   └── config/                      # @repo/config — shared tsconfig, biome, vitest base
├── _modules/                        # Tier 2: opt-in, build-time activation via env vars
└── tooling/                         # repo-wide scripts
```

The split between `packages/` and `_modules/` is the load-bearing boundary: tier 1 is always installed and built, tier 2 activates at build time via env var presence.

## `@repo/*` package boundaries

`void-dependency-direction` owns the package-boundary procedure: declare accepted
dependencies in the consuming package manifest and follow the project's architecture.
The hook checks detected undeclared scoped imports, not a universal `@repo/core`-only
topology. TypeScript path aliases do not enforce layers. Domain code remains independent
of concrete infrastructure; use domain-owned ports and compose adapters at the edge,
as described by `void-hexagonal-architecture`.

## Service layout (`5+5` per service package)

```
packages/<name>/src/
  <name>.service.ts          # domain logic (always present)
  <name>.repository.ts       # DB / external I/O (always present)
  <name>.helper.ts           # pure functions (always present)
  <name>.types.ts            # Zod schemas + inferred TS types (always present)
  index.ts                   # public barrel (always present)
```

Composes with `void-hexagonal-architecture` (ports + adapters), `void-domain-driven-design` (named per aggregate), `void-functional` (helpers are pure).

## Hard rules

- Match file naming exactly (`Name.tsx`, `Name.helper.ts`, `Name.test.ts`).
- Service layer NEVER touches DB directly — always through repository.
- Component layer NEVER touches DB — always through service.
- Helpers are PURE: no I/O, no side effects.
- Use `@repo/core/logger`, never `console.log` in committed code.
- Use `@repo/core/env`, never `process.env` directly in business code.
- Use typed errors from `@repo/core/errors`, never throw strings.
- Server Actions live in `apps/<app>/src/actions/`, NEVER in packages.
- No em dashes, no emojis in code / docs / commits.

## Composition with void-machine skills

- **`void-hexagonal-architecture`** — port direction + adapter thinness enforced via the layout.
- **`void-tdd`** — paths default to `apps/*/src/**` business code; spikes in `apps/*/scripts/spike-*`.
- **`void-migrations`** — migration files at `apps/*/db/migrations/` (Drizzle convention).
- **`void-observability`** — `@repo/core/logger` is the only logger; structured logs by default.
- **`void-async-safety`** — retry / idempotency / dead-letter discipline applied to webhooks, jobs, crons. Concrete patterns in `void-webhook-handler-pattern` and `void-background-job-pattern`.
