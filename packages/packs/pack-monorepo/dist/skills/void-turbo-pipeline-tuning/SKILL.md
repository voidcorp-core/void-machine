---
name: void-turbo-pipeline-tuning
description: Configure turbo.json tasks correctly — dependsOn, outputs, cache keys, persistent tasks, remote cache. Get build speed right without over-engineering.
---

# turbo-pipeline-tuning

Use when adding or modifying tasks in `turbo.json`, or when the monorepo's CI/local build feels slow. Turborepo's value is incremental caching; getting `dependsOn`, `outputs`, and cache keys right is the difference between "build in 4s" and "build in 90s".

If you don't have `turbo.json` (single-app), this skill does not apply.

## The 4 fields that matter

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],          // 1. order
      "outputs": ["dist/**", ".next/**"],// 2. cache artifacts
      "inputs": ["src/**", "tsconfig.json"], // 3. cache key (optional, smart default exists)
      "cache": true                     // 4. on/off
    }
  }
}
```

90% of pipeline bugs come from getting one of these wrong.

## `dependsOn` cheatsheet

- `^build` — depends on `build` of upstream workspace packages (the package's own deps)
- `build` — depends on `build` of the SAME package (rare; usually you want `^build`)
- `lint` — depends on `lint` of the SAME package
- `^lint` — depends on `lint` of upstream (rare; lint usually doesn't depend on others)
- `db:generate` — explicit task name in another package

The mental model: `^X` = wait for X in workspace deps. Bare `X` = wait for X in this package.

## `outputs` — get this right or kill cache

If a task writes files Turborepo doesn't know about, the cache is **wrong** (next run reads stale outputs). Common misses:

- ✗ `tsc --noEmit` writes nothing → `"outputs": []` (empty array, NOT omitted)
- ✓ `next build` → `"outputs": [".next/**", "!.next/cache/**"]`
- ✓ `tsup build` → `"outputs": ["dist/**"]`
- ✓ `drizzle-kit generate` → `"outputs": ["drizzle/**", "src/**/__generated__/**"]`
- ✗ Forgetting to list `dist/` → next consumer fails to import the freshly-built code

When a task has NO outputs (typecheck, lint, test), explicitly `"outputs": []`. Otherwise Turbo assumes "everything" and bloats the cache.

## `inputs` — most of the time, leave it alone

Default is "all files in the package not in `.gitignore`". That's almost always right. Override only when:

- A task reads files outside the package (rare, fragile) → list them explicitly
- A task should NOT invalidate on certain file changes (e.g., README.md, *.md) → `"inputs": ["src/**", "package.json", "tsconfig.json"]` to scope

Over-restricting `inputs` is the #1 source of "the cache lied to me" bugs. When in doubt, omit.

## `cache: false` — when

- Tasks with non-deterministic output (deploy, publish, OTA push)
- Tasks that mutate external state (DB migration push, registry publish)
- Watch / dev tasks (`"persistent": true` instead, see below)

`dev` is the canonical persistent task:

```json
"dev": { "cache": false, "persistent": true }
```

`persistent: true` tells Turbo "this task never ends" so it doesn't wait for completion before considering downstream tasks runnable.

## Remote cache: when to bother

Remote cache (Vercel Remote Cache, Turbo's hosted, self-host) is worth it when:

- Team ≥ 3 developers AND/OR
- CI runs ≥ 10 times per day AND/OR
- Build times ≥ 1 minute

For solo dev with local cache only, skip. The setup overhead exceeds the benefit.

Setup: `npx turbo login && npx turbo link`. CI: pass `TURBO_TOKEN` and `TURBO_TEAM` env vars.

## Common bugs and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| "Build seems to skip my changes" | Wrong `inputs` glob | Remove the inputs override; let Turbo default handle it |
| "Downstream package imports stale code" | Missing `outputs` entry | Add `dist/**` (or whatever the build writes) |
| "Cache key changes every run" | Generated file outside `outputs` | List the generated path in `outputs` |
| "Turbo runs tasks in wrong order" | Missing `dependsOn: ["^build"]` | Add it |
| "Full rebuild every CI run" | No remote cache OR build artifact ignored by .gitignore but not in outputs | Set up remote cache; verify outputs match |

## When NOT to add a task

- One-shot scripts: use a package.json script, not a Turbo task
- Tasks that run < 1 second: not worth the overhead
- Tasks specific to one developer's flow: keep in their shell history

Turbo tasks are for things the team runs in CI or routinely locally. Keep the surface small.

## Workflow

1. **Sketch the dependency DAG on paper.** What runs before what? Across packages?
2. **Write the minimal `dependsOn` + `outputs`** for each task. Don't overthink `inputs`.
3. **`turbo build --dry-run`** to see the plan.
4. **`turbo build --summarize`** to verify cache hits in CI.
5. **If a cache miss surprises you, `turbo build --verbose`** shows the cache key inputs.

## Composition

- `void-service-package` — new packages need their tasks declared in turbo.json (build, typecheck, test).
- `void-dependency-direction` — Turbo's `^build` only works correctly if package dependencies are well-declared in package.json.
- `void-tdd` — `test` task must have `"outputs": []`; otherwise vitest's cache directory pollutes Turbo's cache.
