---
name: void-typescript-strict
description: TS strict baseline. Zero any budget, branded types for domain primitives, discriminated unions over enums, exhaustive switches via never, satisfies over as. Use when editing TypeScript code.
---

# typescript-strict — voidcorp craftsman edition

Types describe truth. The compiler runs first. `any` is banned. `as` is rejected outside narrow exceptions. Non-interchangeable domain primitives use branded types. Discriminated unions model state. Exhaustive switches are verified by `never`. This skill is the language baseline — every other skill composes on top of it.

**Attribution**: see `.source` in this directory.

---

## tsconfig baseline (mandatory)

Every consumer's `tsconfig.json` extends the void-machine strict baseline, shipped as `tsconfig.strict.json` inside the `@voidcorp/pack-monorepo` pack. The `@voidcorp/*` packs are workspace packages, not yet published to npm — the `extends` below resolves once the pack is installed in the workspace (do not assume a bare npm install resolves it):

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true
  }
}
```

If a consumer disables any flag, they record the reason through the `void-decide` skill - that is a deliberate ADR, not a casual config tweak.

---

## Zero `any` budget

`any` is forbidden in committed code. There is no "just this once."

When you need an escape valve, use `unknown` and narrow:

```typescript
function parsePayload(raw: unknown): UserCommand {
  return userCommandSchema.parse(raw); // Zod narrows + returns the typed value
}
```

`unknown` forces narrowing before use. `any` silently propagates everywhere.

The companion hook `no-any-grep` blocks commits that introduce `: any` or `as any` outside whitelisted paths (`**/__fixtures__/**`, `**/__tests__/**`). See `../../hooks/no-any-grep.sh`.

---

## `as` cast — rejected by default

The `as` cast tells the compiler to trust you. Trust is the bug.

Allowed forms (the only ones):

- **`as const`** — pin a literal type. Always allowed.
- **`as unknown`** as a stepping stone to a deliberate narrowing chain. Use sparingly.
- **`as <Type>` after Zod schema validation** — preferred form: do not need `as` because `schema.parse()` returns the typed value. Use `parse`, not `as`.

Banned forms:

- `as <Type>` to "fix" a type error
- `as any` to escape narrowing
- Chained `as unknown as <Type>` to bypass exhaustive checks

The companion hook `no-as-cast-grep` warns (not blocks) on `as <Type>` outside the allowed set — false positives are common, the user confirms.

---

## Prefer `satisfies` over annotation, prefer `parse` over `as`

```typescript
// preferred: satisfies preserves the literal type AND checks against the constraint
const config = {
  retries: 3,
  backoffMs: 100,
} satisfies RetryConfig;

// acceptable: annotation widens to the constraint type
const config: RetryConfig = { retries: 3, backoffMs: 100 };

// rejected: as lies if the structure is wrong
const config = { retries: 3 } as RetryConfig; // BAD — missing field, compiler silent
```

For validated input, use the schema:

```typescript
// preferred
const cmd = userCommandSchema.parse(req.body);

// rejected
const cmd = req.body as UserCommand; // BAD — no runtime guarantee
```

---

## Discriminated unions over enums + boolean flags

State with N values = discriminated union. Not a flag bag.

<Good>
```typescript
type FetchState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: T }
  | { kind: 'error'; error: Error };
```
</Good>

<Bad>
```typescript
type FetchState<T> = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: T;
  error?: Error;
}; // BAD — every consumer must check status AND handle optional fields, invariants invisible
```
</Bad>

The discriminated form makes invalid states unrepresentable. The compiler narrows automatically inside `if (state.kind === 'success')` blocks.

### No `enum` keyword

TypeScript `enum` has known footguns: numeric enums are loose, declaration order matters, runtime emit unlike type aliases. Use `as const` objects + derived union type:

```typescript
const Status = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;
type Status = (typeof Status)[keyof typeof Status];
```

ESLint rule `@typescript-eslint/no-enum` (configured in `pack-monorepo`) blocks `enum` usage.

---

## Exhaustive switches via `never`

Every `switch` over a discriminated union has a `default` branch that proves exhaustiveness:

```typescript
function render(state: FetchState<User>): JSX.Element {
  switch (state.kind) {
    case 'idle': return <Idle />;
    case 'loading': return <Spinner />;
    case 'success': return <UserCard user={state.data} />;
    case 'error': return <ErrorView error={state.error} />;
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unhandled state: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

If you later add `{ kind: 'cancelled' }`, the compiler flags the switch — no production drift.

ESLint rule `@typescript-eslint/switch-exhaustiveness-check` (configured in `pack-monorepo`) enforces this.

---

## Branded types for domain primitives

Brand a primitive when accidental substitution or invalid construction violates a real domain contract. Preserve existing meaningful brands; avoid wrappers for local values with no distinct invariant.

```typescript
// in @voidcorp/core/branded
export type Brand<T, B extends string> = T & { readonly __brand: B };

// in your domain
type UserId = Brand<string, 'UserId'>;
type OrgId = Brand<string, 'OrgId'>;
type Email = Brand<string, 'Email'>;

// smart constructor
function createUserId(raw: string): UserId {
  if (!raw.startsWith('usr_')) throw new ValidationError('invalid UserId');
  return raw as UserId; // <-- only allowed `as`: post-validation in the constructor
}
```

A function taking `UserId` cannot accept a raw `string`. The compiler refuses. Same shape, different identity.

Typical candidates, when the contract requires non-interchangeability:

- IDs (`UserId`, `OrgId`, `OrderId`, ...)
- Email, PhoneNumber, IsoDate, IsoDuration
- Money (`{ amount: number; currency: CurrencyCode }`, with `CurrencyCode` itself branded)
- Anything that "looks like a string but is not interchangeable"

Composes with `void-domain-driven-design` (value objects in DDD terms) and `void-functional` (smart constructors return `Result<UserId, ValidationError>`).

---

## Optional vs undefined — pick the right tool

With `exactOptionalPropertyTypes: true`:

- `{ name?: string }` means the property may be **absent**, but if present, it is a `string` (not `string | undefined`).
- `{ name: string | undefined }` means the property is **always present**, possibly `undefined`.

These are different. For domain models, prefer present-but-nullable (`name: string | null`) — explicit, no ambiguity between "missing" and "present-but-empty." For DTOs and external schemas, optional is fine.

Banned: spreading `{ ...maybeObj }` where `maybeObj` has `undefined` values — `exactOptionalPropertyTypes` complains. Build the object literal explicitly.

---

## `Result<T, E>` for error-as-value (composes with `void-functional`)

The `void-functional` skill owns the full rationale. From a types perspective:

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

This is a discriminated union. The compiler narrows inside `if (result.ok)`. Errors are values, not exceptions for expected failure modes. Exceptions remain for truly unexpected bugs.

A function signature `parse(raw: unknown): Result<UserCommand, ValidationError>` tells the caller everything: input is untrusted, output is either a typed command or a typed error. No try/catch hidden semantics.

---

## Hard rules summary

- `tsconfig.json` extends `@voidcorp/pack-monorepo/tsconfig.strict.json`
- Zero `any` in committed code. Use `unknown` and narrow.
- No `as <Type>` outside the allowed set (`as const`, post-Zod, smart constructors)
- No `enum` keyword. Use `as const` objects + derived union.
- Every switch over a union has a `default: never` exhaustiveness check
- Branded types for IDs / Email / Money / IsoDate / any semantic primitive
- Prefer `satisfies` over annotation; prefer `schema.parse()` over `as`
- Respect `exactOptionalPropertyTypes` semantics

---

## Companion hooks

- **`tsc-noemit-precommit`** — `tsc --noEmit` must pass before commit. Composed with `pre-commit typecheck+test`.
- **`no-any-grep`** — blocks `: any` and `as any` in staged diff outside fixtures/tests whitelist.
- **`no-as-cast-grep`** — warns (not blocks) on `as <Type>` outside the allowed set.

See `../../hooks/`.

---

## Composition with other skills

- **With `void-functional`**: this skill provides the type machinery (discriminated unions, `Result`, branded primitives); `void-functional` decides WHEN to model with sum types vs records, when to return `Result` vs throw.
- **With `void-domain-driven-design`**: this skill enforces meaningful non-interchangeable domain types; DDD decides which entities are aggregates and which are value objects.
- **With `void-hexagonal-architecture`**: ports are typed interfaces; types travel across boundaries via Zod schemas.
- **With `void-tdd`**: a RED test using a branded type forces the production code to surface a smart constructor.
- **With `void-code-review`**: review skill flags untyped IDs, `any` slips, missing `satisfies`.

---

## Anti-rules

- MUST NOT decide business logic. Types describe; behavior is elsewhere.
- MUST NOT decide test strategy. `void-testing` and `void-tdd` own that.
- MUST NOT decide architecture boundaries. `void-hexagonal-architecture` owns that.
- MUST NOT decide style. Biome / Prettier owns that.
- MUST NOT silently allow `any` "just this once."

---

## When you are stuck

| Problem | Solution |
|---|---|
| Cannot express the type | Use `unknown` + narrow. If still stuck, the design is leaking. |
| Library has wrong types | Wrap with a typed adapter at the boundary (do not patch with `as`). |
| Generic too complex | Split. Type-level computation > 3 nesting levels is a smell. |
| `exactOptionalPropertyTypes` complains on spread | Build the literal explicitly without `undefined` properties. |
| Need to bypass for a fixture | Use the `**/__fixtures__/**` whitelist + explain in fixture file header. |

---

## Final rule

```
Every TypeScript file → no any, no rogue as, exhaustive switches, brands where domain contracts require them.
Otherwise            → this is not voidcorp typescript-strict.
```

The compiler is the first reviewer. If it does not flag a category of bug, this skill exists to make sure you do.
