---
name: void-service-package
description: "Create or extend a packages/<name>/ service in a harness-monorepo workspace: the 5+5 file layout, @repo/* boundaries, ports-and-adapters direction. Composes with hexagonal-architecture, DDD."
---

# service-package

Use when adding a new `packages/<name>/` package to a Turborepo workspace that follows the void-machine `pack-monorepo` conventions, or when extending an existing one. The pack module document defines the topology (see `claude/modules/01-monorepo-layout.md`); this skill is the **execution checklist** for creating one.

If you are working in `apps/<app>/` business code, this skill does not apply — that is internal application code, not a shared package.

## When this skill triggers

- "Add a `@repo/billing` package" / "extract billing into its own package"
- "Create a new shared service for X"
- "Move logic from apps/web into a package so apps/api can use it too"
- Any creation of a new directory under `packages/` at the top level

## The 5+5 layout (mandatory)

```
packages/<name>/
├── package.json
├── tsconfig.json                            # extends ../../tsconfig.strict.json
├── src/
│   ├── <name>.service.ts                    # domain logic
│   ├── <name>.repository.ts                 # I/O (DB, HTTP, queue)
│   ├── <name>.helper.ts                     # pure functions
│   ├── <name>.types.ts                      # Zod schemas + inferred TS types
│   ├── index.ts                             # public barrel
│   ├── <name>.service.test.ts
│   ├── <name>.repository.test.ts
│   ├── <name>.helper.test.ts
│   ├── <name>.types.test.ts
│   └── index.test.ts                        # contract tests on the barrel
```

The "5+5" is **five source files + five test files**, paired one-to-one. No `utils/`, no `lib/`, no `common/`. A file does one thing.

## Direction of dependencies

```
service ─→ repository (port)   service ─→ helper   service ─→ types
              ↑
        adapter (in apps/<app>/src/adapters/<name>/)
```

- `service.ts` defines the **interface** the repository must satisfy (the port).
- The concrete adapter lives in the **consuming app**, under `apps/<app>/src/adapters/`, not in this package.
- `repository.ts` in this package may hold a default/in-memory implementation for tests, but the prod adapter is wired by the app.
- `helper.ts` is pure. No I/O. No `Date.now()`. Take time as a parameter.

If your package needs `@repo/db` directly: stop. Move the DB-touching code into an adapter in the consuming app. The package owns the **port**, not the adapter.

## Allowed imports

Follow `void-dependency-direction`: the package manifest declares dependencies;
the project's architecture decides whether they belong. This service convention
prefers domain-owned ports and app composition. It does not claim the shared hook
forbids every dependency except `@repo/core`.

## `package.json` template

```json
{
  "name": "@repo/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@repo/core": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "tsconfig": "workspace:*",
    "vitest": "catalog:"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`exports` points at `src/index.ts` directly — Turborepo + tsup compile at the app boundary, packages stay as TS source for fast iteration.

## Workflow

1. **Confirm the boundary first.** Before any file, write one line in the PR description: *"This package owns X, exposes Y, and is consumed by Z."* If you cannot, the package is premature.
2. **Create the directory + `package.json` + `tsconfig.json`** (extends `../../tsconfig.strict.json`).
3. **Write the types file first** (`<name>.types.ts`): Zod schemas + inferred types. Tests assert that invalid payloads parse to errors.
4. **Write the service.test.ts** describing the public behavior, then `service.ts` to make it pass (TDD strict, see `void-tdd`).
5. **Write the helper + helper.test.ts** as pure-function tests (table-driven).
6. **Write the repository port** (`repository.ts`): just the interface and a default in-memory implementation. Real DB adapter lives in the consuming app.
7. **Export from `index.ts`** only what consumers must touch. No re-exports of internal helpers.
8. **Add to `tsconfig.base.json` paths** if your monorepo uses TS path aliases (most do).
9. **Run `bunx turbo run typecheck test --filter @repo/<name>`** before commit.

## Anti-patterns

- ✗ A `utils/` or `common/` directory — split into helpers per concern instead.
- ✗ A `<name>.types.ts` that's only TypeScript types with no Zod schema — at boundaries you need runtime validation. Internal-only types live next to their use.
- ✗ Importing the concrete DB into `service.ts` — wire the adapter in the app.
- ✗ Re-exporting an entire submodule from `index.ts` (`export * from './internal'`) — list explicit names so the public surface is auditable.
- ✗ Adding a sixth source file because "it doesn't fit anywhere" — that's a code smell. Either the boundary is wrong (split the package) or the file collapses into an existing one.

## Composition

- `void-hexagonal-architecture` — port direction enforced. Service defines port; adapter is in app, not package.
- `void-domain-driven-design` — name the package per aggregate or capability, not per technical concern.
- `void-functional` — `helper.ts` is pure; pass time, randomness, and side effects as parameters.
- `void-tdd` — strict on `service.ts` and `helper.ts`; souple on `repository.ts` if it only forwards.
- `void-typescript-strict` — `tsconfig.strict.json` is mandatory; no `any`, no `as` casts in committed code.
