---
skill: typescript-strict
status: reviewed
strategy: distill
target_loc: 300
phase: B
depends_on: []
composes_with: [tdd, testing, refactor, hexagonal-architecture, domain-driven-design, code-review, frontend-design, functional]
matrix_row: plans/skill-decision-matrix.md#typescript-strict
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `typescript-strict`

## Need

Without an enforced TypeScript discipline, an LLM-driven agent will reach for `any`, swallow type errors with `as`, skip exhaustive switches, leave `unknown` un-narrowed, and use raw `string` for every domain primitive. The type system becomes decorative — the compiler stops being a reviewer. `typescript-strict` makes the type system load-bearing: types describe truth, `any` is forbidden, `unknown` requires narrowing, exhaustive switches are mandatory, branded types model domain primitives, and the compiler is the first reviewer that runs on every change.

## Decision matrix anchor

- **Wins**: every TypeScript file. Types, signatures, exhaustive switches, `unknown` vs `any`, narrowing patterns, branded types
- **Loses to**: `functional` on data-shape choices (immutability, ADTs, error modeling). `domain-driven-design` on domain modeling (which bounded context, which aggregate root)
- **Cannot decide**: business logic, test strategy, architecture boundaries
- **Composes with**: every other skill (it is the language baseline)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| TypeScript official handbook (Hejlsberg et al.) | https://www.typescriptlang.org/docs/handbook/ | reference | foundation — type system semantics |
| citypaul `tsconfig` + TS stance | citypaul/.dotfiles | reviewed | kept (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes baseline) |
| Matt Pocock "Total TypeScript" | https://www.totaltypescript.com | reviewed | kept (branded types pattern, `satisfies` operator, generic helpers) |
| tkdodo blog (Dominik Dorfmeister) "TypeScript discriminated unions" + "type narrowing" series | https://tkdodo.eu/blog/type-script-tag-of-doom | reviewed | kept (discriminated unions, `as const`, no-`as` discipline) |
| type-fest | https://github.com/sindresorhus/type-fest | reviewed | referenced as a library, NOT vendored. Consumers add it if they need it. |
| Tan Li Hau "TypeScript Performance" notes | https://tanlh.com | skimmed | referenced (mention type performance pitfalls — deep generics, etc.) |
| zod | https://zod.dev | reference | kept as the boundary validation library. Composes with this skill at trust boundaries. |

## Adaptation strategy

`distill`. Author from first principles, attribution in prologue + `.source` file. No verbatim copy from any single source — the rules are common knowledge, the discipline is in the enforcement.

## What we keep (verbatim or near-verbatim)

- **`tsconfig.json` strict baseline** (from citypaul): `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`. Published as `@voidcorp/pack-monorepo/tsconfig.strict.json`.
- **Branded types pattern** (from Pocock): `type UserId = string & { readonly __brand: 'UserId' }`. Smart constructor (`createUserId()`) returns the branded type after validation. Plain `string` never satisfies `UserId`.
- **Discriminated unions over enums + boolean flags** (from tkdodo): an entity with three possible states is `type S = { kind: 'loading' } | { kind: 'success', data: T } | { kind: 'error', error: E }`, NOT `{ status: 'loading' | 'success' | 'error', data?: T, error?: E }`.
- **`satisfies` over `as`** (from Pocock): when narrowing a literal, prefer `const config = { ... } satisfies Config` over `const config: Config = { ... }` (preserves the literal type) over `const config = { ... } as Config` (lies to the compiler).
- **Exhaustive switches via `never`** (textbook): every `switch` over a discriminated union has a `default: const _exhaustive: never = value; throw new Error(...)`. The compiler catches missing cases at compile time.

## What we adapt

- **`any` forbidden, `unknown` is the escape valve**: standard rule. We adapt by adding a hook (`no-any-grep`) that fails the commit on `: any` or `as any` outside whitelisted test fixtures. Why: a rule without enforcement decays into "I'll fix it later."
- **`as` cast forbidden except after schema validation**: when you have validated input through Zod, the parser returns the typed value — no `as` needed. We adapt by extending the hook to flag `as <Type>` (excluding `as const` and `as unknown` narrowing patterns). Why: `as` is the most common type-system bypass.
- **Branded types for domain primitives — required, not optional**: `UserId`, `Email`, `Money` (amount + currency), `IsoDate`. The brand is in the type, the validation in the smart constructor. Why: raw `string` for things with semantics is the #1 source of "passed the wrong ID" bugs.
- **Zero `any` budget**: no exceptions. `unknown` is always available, narrowing is always possible. The only legitimate exception is third-party type declarations we cannot edit — and even then, we wrap them with a typed adapter. Why: a "soft" rule with exceptions becomes a hard rule with creeping exceptions.

## What we reject

- **type-fest as a default dependency**: rejected. Consumers add it explicitly if they need its utilities. Why: bundling utility libraries by default violates Wing Chun (every dep earns its place).
- **Effect-TS as the standard async/error library**: rejected for the core. Excellent for some projects, overkill for most. Optional opt-in via a future pack. Why: imposing Effect-TS on every consumer is a massive ergonomic shift that not every project wants.
- **`enum` keyword**: rejected (use `as const` object + derived union type). Why: TS enums have known footguns (numeric enums are loose, declaration ordering matters, they emit runtime code unlike type aliases).
- **Class hierarchies as default modeling**: rejected. Composition via plain objects + functions is the default; classes are an exception that earns its place. Why: discriminated unions + smart constructors model state better than inheritance for most cases. Defers to `functional` skill for the full rationale.

## Hard rules surfaced by this skill

- **`tsconfig.json` MUST extend `@voidcorp/pack-monorepo/tsconfig.strict.json`**. Enforced by: `pack-monorepo` install + `tsc --noEmit` in `pre-commit typecheck+test` hook.
- **`any` is forbidden in committed code**. `unknown` is the escape valve. Narrow before use. Enforced by: SKILL.md + `no-any-grep` hook.
- **`as <Type>` casts are forbidden**, except `as const` and `as unknown` narrowing patterns. Schema validation (Zod) is the legitimate way to obtain a typed value from external input. Enforced by: SKILL.md + `no-as-cast-grep` hook (with whitelisted patterns).
- **Exhaustive switches over discriminated unions**. Compile-time `never` check in default branch. Enforced by: SKILL.md guidance + ESLint rule (`@typescript-eslint/switch-exhaustiveness-check`).
- **Branded types for domain primitives**. Raw `string` for things with semantics is rejected at PR review. Enforced by: SKILL.md + `code-review` skill flags untyped IDs/emails/etc.
- **No `enum` keyword**. Use `as const` objects. Enforced by: SKILL.md + ESLint rule (`@typescript-eslint/no-enum`).

## Modes — none (rules are non-negotiable)

Within the TS/web baseline, these rules apply uniformly. There is no `strict` / `souple` here — softening any of these is project-level technical debt, not a mode.

## Companion hooks

- **`tsc-noemit-precommit`** (composed with `pre-commit typecheck+test`) — `tsc --noEmit` must pass before commit. Output captured to a temp file; on failure, the commit blocks with the type errors printed. ≤ 30 LOC shell.
- **`no-any-grep`** (PreCommit) — fail if `\b(:|as)\s*any\b` appears in staged diff outside `**/__fixtures__/**` and `**/__tests__/**` whitelist. ≤ 30 LOC.
- **`no-as-cast-grep`** (PreCommit) — warn (do NOT block) if `as <Type>` appears outside the whitelist (`as const`, `as unknown`, `as React.ReactNode`, post-Zod-parse). Warn-only because false positives are common; user can confirm. ≤ 40 LOC.
- **`switch-exhaustiveness-eslint`** — relies on the standard ESLint rule, pack-monorepo includes it in shared config.

## Composition with other skills

- **With `functional`**: this skill provides the type machinery (discriminated unions, `Result<T, E>`-shaped types, branded primitives). `functional` decides WHEN to model with sum types vs records, when to use `Result` vs throw. Co-evolved.
- **With `domain-driven-design`**: this skill enforces branded types for IDs / Email / Money / Date. `domain-driven-design` decides which entities are aggregates and which are value objects.
- **With `hexagonal-architecture`**: ports are typed interfaces; types travel across boundaries via Zod schemas. This skill enforces the typing; hexagonal enforces the boundary placement.
- **With `tdd`**: a `RED` test that exercises a domain primitive uses the branded type, forcing the production code to surface a smart constructor. The type system and the test pressure design together.
- **With `code-review`**: the reviewer skill checks for untyped IDs, `any` slips, missing `satisfies` in config objects.

## Anti-rules (what this skill MUST NOT do)

- MUST NOT decide business logic. Types describe; behavior is elsewhere.
- MUST NOT decide test strategy. `testing` and `tdd` own that.
- MUST NOT decide architecture boundaries (which file imports which). `hexagonal-architecture` owns that.
- MUST NOT decide style (formatting, semicolons, quotes). Biome / Prettier owns that, via shared config in `pack-monorepo`.
- MUST NOT silently allow `any` "just this once." Either it's a documented exception in the SKILL.md (none currently exists) or it's rejected.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 300 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions `any` ban + branded types + exhaustive switches as the headline rules
- [ ] `.source` file lists Pocock + tkdodo + citypaul + Hejlsberg handbook
- [ ] Hooks drafted: `tsc-noemit-precommit`, `no-any-grep`, `no-as-cast-grep` — each ≤ 100 LOC, smoke-tested on fixtures
- [ ] `pack-monorepo/tsconfig.strict.json` published with the strict flags
- [ ] ESLint config in `pack-monorepo` includes `switch-exhaustiveness-check` + `no-enum`
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/typescript-strict/` cover: `any` rejection, `as` warning vs `as const` allowed, branded type smart constructor, exhaustive switch with missing case
- [ ] No overlap > 30% with `functional` (this skill = type machinery; functional = when/how to use it)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the pack

## Open questions

- **Branded type implementation: nominal vs intersection-with-symbol vs class**: lean intersection-with-symbol or `unique symbol` brand. Decide before publishing the smart-constructor helper in `@voidcorp/core/branded`.
- **Whitelist for `any` in test fixtures**: confirm `**/__fixtures__/**` + `**/*.test.ts` factory helpers are enough, or do we need explicit `// allow-any: <reason>` magic comment? Lean magic comment for surgical exceptions.
- **`exactOptionalPropertyTypes` known incompatibilities**: some popular libraries (older React types, some form libraries) misbehave. Document the workaround pattern (avoid spreading `undefined` properties) in SKILL.md.
- **Biome vs ESLint for the exhaustiveness check**: void-starter uses Biome by default. Biome may not have the switch-exhaustiveness rule yet — pack-monorepo may need to mix Biome + ESLint just for this rule. Confirm before publishing.
- **Migration path for projects already on a looser tsconfig**: a one-shot codemod that lists every `any` / `as` / non-exhaustive switch, suggests fixes, but does not auto-apply (HITL principle). Defer to Phase E.

## 2026-10-23: proportional delivery

Align the existing standard with the owning workflow, preserving its technical protection while
removing repeated or pattern-only obligations. See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
