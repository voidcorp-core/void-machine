# `@voidcorp/pack-monorepo`

Turborepo monorepo conventions for the [void-machine](https://github.com/voidcorp-core/void-machine).

## What this pack provides

### Core helpers (`@voidcorp/pack-monorepo/*`)

- **`./result`** — `Result<T, E>` discriminated union + `ok`, `err`, `map`, `flatMap`, `mapErr`, `unwrap`, `unwrapOrThrow`, `tryCatch`, `tryCatchAsync`, `combine`. Composes with the `void-functional` skill.
- **`./option`** — `Option<T>` + helpers. Use when you want exhaustive pattern matching (the compiler refuses to forget the `none` branch).
- **`./pipe`** — type-safe `pipe(value, f1, f2, ...)` up to 10 stages.

### Shared configs

- **`tsconfig.strict.json`** — the strict TypeScript baseline mandated by the `void-typescript-strict` skill (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax). Extend it in your consumer `tsconfig.json`.

No shared Biome configuration is shipped by this pack. Configure and verify the
required rules in the consumer's existing linter; the root repository config does
not become consumer enforcement through `init`.

### Claude / Codex modules (`@voidcorp/pack-monorepo/claude/*`)

- **`modules/`** — CLAUDE.md / AGENTS.md fragments that explain the harness-monorepo conventions to the agent (Turbo task graph, workspace layout, `@repo/*` package boundaries, ADR workflow, 5+5 service layout).
- **`skills/`** — pack-specific skills that EXTEND core skills with monorepo conventions (e.g., declared workspace dependencies and domain-owned ports).
- **`hooks/`** — pack-installed hooks (commitlint, gitleaks, etc.) that the consumer's lefthook.yml composes.

## Install

```bash
# Via the void-machine CLI
npx voidmachine init --pack pack-monorepo
```

The CLI installs the pack and wires its Claude / Codex modules into the consumer's CLAUDE.md / AGENTS.md.

## Direct consumer usage

```typescript
import { ok, err, type Result } from '@voidcorp/pack-monorepo/result';
import { pipe } from '@voidcorp/pack-monorepo/pipe';

function divide(a: number, b: number): Result<number, 'div-by-zero'> {
  return b === 0 ? err('div-by-zero') : ok(a / b);
}
```

In TS configs:

```json
{
  "extends": "@voidcorp/pack-monorepo/tsconfig.strict.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["node"]
  }
}
```

This example compiles and emits under TypeScript 5.0 through 7.0, and
`src/tsconfig-strict.test.ts` proves it against each of them. Two lines are the consumer's to
keep, because the shared file cannot carry them:

- `rootDir`: since TypeScript 6 an `outDir` without it is an error (TS5011). A `rootDir` in the
  shared file would resolve against the pack, not against your project.
- `types`: since TypeScript 6 a project no longer loads every installed `@types/*` package. Keep
  `"node"` for a Node project; a project without Node globals drops the line.

## Status

MVP. The Result / Option / pipe helpers are shipped. The shared Biome / lefthook / commitlint configs and the `@repo/core` env / logger / errors modules land in subsequent commits.

## License

MIT.
