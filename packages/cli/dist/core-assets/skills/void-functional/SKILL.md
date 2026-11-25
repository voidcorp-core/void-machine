---
name: void-functional
description: Pure-by-default, errors as values (Result<T, E>), discriminated unions for state, immutability defaults, functional core / imperative shell. Side effects at adapters. Use for data flow or state.
---

# functional — voidcorp craftsman edition

The domain decides in pure code. The world translates in adapters. Expected failures are values, not exceptions. Choices are types, not flags. Immutability is the default; mutation earns its place.

This is `void-hexagonal-architecture`'s boundary viewed through a different lens — Bernhardt's functional core / imperative shell. Inside the hexagon: pure. At the adapters: effects.

**Attribution**: see `.source` in this directory. Foundation: Wlaschin "Domain Modeling Made Functional," Mark Seemann "Code That Fits in Your Head," Bernhardt "Functional Core, Imperative Shell," Khorikov.

---

## Pure by default

A function is **pure** if (a) same input → same output, (b) no observable side effects.

Most domain logic should be pure. Side effects (DB writes, network calls, logging, time, randomness) live at adapter boundaries — outside the pure core.

### Pure-in-effect

An async function that only `await`s injected ports is pure-in-effect: deterministic given the same ports. This is the practical equivalent of pure code in an async TS context.

### Red Flag — side effect inside a "pure" function

```typescript
function calculateInvoice(order: Order): Invoice {
  const id = randomUUID();              // RED FLAG — impure
  const at = Date.now();                // RED FLAG — impure
  fetch('https://analytics/...');       // RED FLAG — side effect
  return { id, at, ... };
}
```

Fix: inject the ports.

```typescript
function calculateInvoice(
  deps: { ids: IdPort; clock: ClockPort },
  order: Order,
): Invoice {
  return { id: deps.ids.newInvoiceId(), at: deps.clock.now(), ... };
}
```

Now `calculateInvoice` is pure-in-effect: deterministic given the same `deps`.

---

## Functional Core / Imperative Shell (Bernhardt)

All decisions happen in pure code (the "core"). All side effects happen in the "shell" (adapters).

```
shell (adapters) → core (pure decisions) → shell (effects)
```

The shell:
- Reads from outside (HTTP request, DB row, queue message)
- Calls the core with the relevant input
- Writes the result back outside (HTTP response, DB write, queue publish)

The core:
- Takes typed input
- Returns typed output (often `Result<T, E>`)
- No I/O, no side effects, no time / randomness without an injected port

This boundary IS the `void-hexagonal-architecture` boundary. Same line, different framing.

---

## Errors as values — `Result<T, E>`

Expected failures (validation error, business rule violation, expected external failure) are values.

The standardized shape, published in `@voidcorp/core/result`:

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function map<T, U, E>(r: Result<T, E>, fn: (t: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function flatMap<T, U, E>(
  r: Result<T, E>,
  fn: (t: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}
```

### Usage

```typescript
async function checkout(
  deps: CheckoutDeps,
  input: { cartId: CartId },
): Promise<Result<OrderConfirmation, CheckoutError>> {
  const cart = await deps.orders.findCartById(input.cartId);
  if (!cart.ok) return cart;

  const payment = await deps.payment.charge(cart.value.total);
  if (!payment.ok) return err({ kind: 'payment_failed', cause: payment.error });

  return ok({ orderId: cart.value.id, confirmedAt: deps.clock.now() });
}
```

The signature tells the caller everything: the input is what it claims, the output is either the typed success or the typed failure, no exception hidden in the implementation.

### Exceptions for the unexpected

Exceptions remain for truly unexpected bugs (DB down, network timeout, invariant violation that should be impossible). Sentry catches them. Domain code does not litter `try/catch` for these.

```typescript
// expected business failure → Result
function withdraw(account: Account, amount: Money): Result<Account, InsufficientFundsError>;

// unexpected technical failure → throw, let it bubble
async function chargeWithRetry(stripe: StripeClient, ...): Promise<Charge> {
  // network errors, retries, etc. — exceptions are fine here
}
```

---

## Algebraic Data Types (sum types)

A choice with N variants is a discriminated union. Not a flag bag.

```typescript
type Order =
  | { kind: 'draft'; id: OrderId; items: LineItem[] }
  | { kind: 'submitted'; id: OrderId; items: LineItem[]; submittedAt: IsoDate }
  | { kind: 'confirmed'; id: OrderId; items: LineItem[]; confirmedAt: IsoDate; tableNumber: number }
  | { kind: 'cancelled'; id: OrderId; reason: string; cancelledAt: IsoDate };

// transitions are functions on specific variants
function confirm(
  o: Order & { kind: 'submitted' },
  tableNumber: number,
  now: IsoDate,
): Order & { kind: 'confirmed' } {
  return { kind: 'confirmed', id: o.id, items: o.items, confirmedAt: now, tableNumber };
}
```

The compiler refuses `confirm(draftOrder, ...)`. State transitions are mechanical, exhaustive switches cover every case. Composes with `void-typescript-strict` exhaustive-switch enforcement and `void-domain-driven-design` aggregate state machines.

---

## Immutability defaults

```typescript
// preferred
type User = { readonly id: UserId; readonly email: Email; readonly createdAt: IsoDate };
const users: readonly User[] = [...];

// updates produce new values
const updated = { ...user, email: newEmail };
const usersPlusOne = [...users, newUser];
```

Mutation in place is an exception:

- Performance hot paths (large array transforms, with tests proving the win)
- Builder-style construction inside a private scope (then `return` an immutable result)

The companion `void-code-review` flags mutation in domain code without justification.

---

## Model absence explicitly

Choose the representation that matches the contract and handle it exhaustively:

- `T | undefined` or an optional property for an absent setting or field;
- `T | null` when explicit absence is part of an API, persistence or domain contract;
- `Option<T>` when named `some`/`none` cases clarify domain behavior.

Avoid unexplained `null | undefined` ambiguity. Preserve strict typing and
`exactOptionalPropertyTypes`; there is no universal lexical ban on `null` and no
annotation required to use a legitimate nullable contract.

---

## Composition over inheritance

Build behavior by composing functions.

```typescript
// composition
const sendWelcomeEmail = pipe(
  buildEmailPayload,
  withWelcomeTemplate,
  withSignature,
  send,
);
```

A `pipe` helper is in `@voidcorp/core`:

```typescript
export function pipe<A>(value: A): A;
export function pipe<A, B>(value: A, f1: (a: A) => B): B;
export function pipe<A, B, C>(value: A, f1: (a: A) => B, f2: (b: B) => C): C;
// ... up to ~10 stages, fully typed
```

Class hierarchies are an exception with a documented reason (framework integration, React error boundary).

---

## Banned (by default)

### Effect-TS / fp-ts as runtime dependency

Rejected as default. Available as opt-in via a future pack when a project needs structured concurrency, layered effects, or rich combinators.

### Haskell-style point-free / monad transformers / `traverse` / `applicative`

Reject as default vocabulary. Use plain TS function parameters and the minimal `Result` / `Option` / `pipe` helpers. Consumers reaching for richer combinators adopt fp-ts or Effect-TS as a pack.

### Ambiguous absence

Do not mix missing, unknown and explicitly empty values without a defined contract.

### Throwing for expected domain failures

Use `Result<T, E>`. Throw only for the unexpected.

### Currying as default

Curry when partial application is actually used at multiple call sites. Otherwise plain multi-arg.

### Side effects inside "pure" functions

Inject ports.

---

## Verification

Typechecking, behavioral tests and review verify absence handling and functional
boundaries. A literal scan cannot establish those properties.

---

## Composition with other skills

- **`void-typescript-strict`**: provides the type machinery (discriminated unions, exhaustive switches, branded types, `satisfies`). This skill says when to use them.
- **`void-hexagonal-architecture`**: the boundary is the same. Functional core = pure domain inside hex. Imperative shell = adapters at the edge.
- **`void-domain-driven-design`**: value objects as branded types + smart constructors returning `Result`. Aggregates as discriminated unions for stateful workflows. Always-valid domain.
- **`void-tdd`**: pure functions are trivially testable. RED writes a property-style or example-based test; GREEN implements pure.
- **`void-testing`**: pure functions need no mocks. Sociable tests by default.
- **`void-refactor`**: common moves — Replace Loop with Pipeline, Replace Conditional with Polymorphism (via discriminated-union dispatch), Replace Throw with Result, Extract Pure Function.
- **`void-security-guidance`**: pure validation at trust boundaries returning `Result<Validated, ValidationError>`.

---

## Anti-rules

- MUST NOT impose Effect-TS / fp-ts / monad transformers / point-free style as defaults.
- MUST NOT decide where the functional / imperative split sits — that is `void-hexagonal-architecture`'s call.
- MUST NOT decide what an aggregate is — that is `void-domain-driven-design`'s call.
- MUST NOT decide test ergonomics — that is `void-testing`'s call.
- MUST NOT silently allow side effects in supposedly-pure functions.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Should I throw or return Result? | Expected failure (validation, business rule) = Result. Unexpected (DB down) = throw, Sentry catches. |
| Need time / randomness in pure code | Inject a ClockPort / RandomPort. Configure with a fake in tests. |
| Discriminated union with 10 variants | Either: smaller domain (the cases are unrelated, separate types), or genuinely a 10-state machine — keep it, but document. |
| Pipeline becomes 12 stages | Probably mixing concerns. Split into two pipelines, name the intermediate type. |
| Need point-free for clarity | Try named partial application first. Adopt Effect-TS / fp-ts pack only if multiple use-cases benefit. |
| Cannot avoid mutation | Confine it to a private scope. Return immutable result. Add a test proving the perf win if performance-driven. |

---

## Final rule

```
Pure by default. Errors as values. Choices as types. Effects at the boundary.
Otherwise → it is not voidcorp functional.
```

The discipline is small. The payoff is exhaustively testable domain code and a typesystem that reflects what is actually true.
