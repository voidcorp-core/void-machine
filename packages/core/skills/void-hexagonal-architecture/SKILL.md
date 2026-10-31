---
name: void-hexagonal-architecture
description: Ports + adapters. Domain owns interfaces, adapters at the edge, function-parameter injection only, no DI / CQRS / mediator. Use when placing code or crossing module boundaries.
---

# hexagonal-architecture — voidcorp craftsman edition

The domain decides; the world translates. Ports are interfaces the domain owns. Adapters wire ports to concrete technologies at the edge. Components do not touch the DB; services do not touch the framework router; use-cases orchestrate ports with no I/O of their own. The boundary makes the domain testable in isolation and replaceable infrastructure cheap.

**Attribution**: see `.source` in this directory. Foundation: Cockburn 2005, Graca "Explicit Architecture," Bernhardt "Functional Core, Imperative Shell."

---

## Core terms

| Term | Definition |
|---|---|
| **Domain** | The pure code that knows the business. Entities, aggregates, value objects, domain services. No I/O. |
| **Port** | An interface owned by the domain that describes what the domain needs from the outside. Named by behavior (`OrdersPort.save`), not technology (`PostgresOrders` is an adapter). |
| **Adapter** | An implementation of a port at the edge. Translates domain types to/from the external API. Thin. |
| **Use-case** (application layer) | A thin function orchestrating ports for a specific user goal. Pure-by-default (no I/O), side effects via injected ports. Lives in `services/` (per `pack-monorepo` convention). |
| **In-memory adapter** | A port adapter that runs in memory, owned by the domain test fixtures. Used by unit tests. Composes with `void-testing` skill's nullable infrastructure pattern. |

---

## Dependency direction

```
   domain  →  ports  ←  adapters
                              ↓
                     infrastructure (Drizzle, fetch, Resend SDK, ...)
```

Read it: the domain depends on its own port interfaces. Adapters depend on the port interfaces and on infrastructure. The domain never imports concrete infrastructure. Adapters may depend on domain-owned ports.

Review enforces this architectural direction. The `boundary-direction-check` hook checks declared package dependencies; it does not infer domain/adapters layers from paths.

---

## Function-parameter injection (no DI container)

The use-case takes its dependencies as a `deps` parameter:

```typescript
export interface CheckoutDeps {
  readonly orders: OrdersPort;
  readonly payment: PaymentPort;
  readonly events: EventBusPort;
  readonly clock: ClockPort;
}

export async function checkoutCart(
  deps: CheckoutDeps,
  input: { cartId: CartId; userId: UserId },
): Promise<Result<OrderConfirmation, CheckoutError>> {
  const cart = await deps.orders.findCartById(input.cartId);
  if (!cart.ok) return cart;
  // ... pure orchestration ...
  return ok({ orderId: cart.value.id, confirmedAt: deps.clock.now() });
}
```

Composition at the call site:

```typescript
// in the framework boundary (Next.js Server Action, etc.)
const deps: CheckoutDeps = {
  orders: createDrizzleOrdersAdapter(db),
  payment: createStripePaymentAdapter(stripe),
  events: createPgOutboxEventBusAdapter(db),
  clock: createSystemClockAdapter(),
};
const result = await checkoutCart(deps, { cartId, userId });
```

Tests use in-memory adapters with the same shape — see `void-testing` skill nullable infrastructure pattern.

### No DI containers (tsyringe, awilix, inversify)

Rejected per `.void/installed/PHILOSOPHY.md` Wing Chun. Function-parameter injection is the same logical pattern with zero runtime cost, zero magic, zero learning curve.

---

## Use-cases (the application layer)

A use-case is a function for a specific user goal. It:

- Takes `deps` (injected ports) and `input` (parsed, validated)
- Returns `Result<Output, Error>` (composes with `void-functional`)
- Orchestrates ports — no `fetch`, no `Date.now()`, no `console.log` inside
- Lives in `services/<context>/<use-case>.ts`

### Smell: use-case with > 5 `deps` fields

The use-case is doing too much. Split into multiple use-cases, or extract a sub-flow.

### Smell: use-case with `if (deps.featureFlag)` branches

The use-case is encoding multiple flows. Split into two use-cases, the boundary picks which to call.

---

## Adapters — thin, one job

An adapter does ONE thing: translate domain types to/from the external API.

```typescript
export function createDrizzleOrdersAdapter(db: Database): OrdersPort {
  return {
    async findById(id) {
      const row = await db.select().from(orders).where(eq(orders.id, id)).get();
      if (!row) return err({ kind: 'not_found', id });
      return ok(rowToDomain(row));   // <-- translation, nothing else
    },
    async save(order) {
      await db.insert(orders).values(domainToRow(order)).onConflictDoUpdate(...);
      return ok(undefined);
    },
  };
}
```

### Banned in adapters

- Business decisions ("if order total > $1000, set priority")
- Cross-port coordination ("save to DB AND emit event in one method")
- Business invariants belong in the domain. Validate untrusted external data at adapter ingress (for example with Zod), before passing typed input to a use-case.

### The "fat port" smell

A `PaymentPort` that grew to handle refunds + disputes + billing reports has too many concerns. Split: `PaymentChargesPort`, `PaymentRefundsPort`, `PaymentReportingPort`. Composes with `void-domain-driven-design` (each port aligns with one bounded-context capability).

---

## Layered convention (`pack-monorepo` provides)

```
src/
├── domain/                 # entities, aggregates, value objects, domain events
├── services/               # use-cases (application layer) — orchestrate ports
│   └── <context>/
├── adapters/               # all adapters (port implementations)
│   ├── repositories/       # persistence adapters (DB)
│   └── external/           # third-party APIs (Stripe, Resend, ...)
└── infrastructure/         # raw infra (Drizzle config, Stripe SDK instances)
```

The `pack-monorepo` enforces import direction via tsconfig `paths`:

- `domain/` cannot import from `services/`, `adapters/`, `infrastructure/`
- `services/` can import from `domain/` only
- `adapters/` can import from `domain/`, `services/` (for port interfaces), `infrastructure/`

The companion hook `boundary-direction-check` greps cross-layer violations as a belt-and-suspenders.

---

## In-memory adapter pattern

Every port has an in-memory adapter co-located in production code (`adapters/in-memory/`):

```typescript
export function createInMemoryOrdersAdapter(
  seed: { orders?: Order[] } = {},
): OrdersPort {
  const store = new Map<OrderId, Order>(
    (seed.orders ?? []).map((o) => [o.id, o]),
  );
  return {
    async findById(id) {
      const o = store.get(id);
      return o ? ok(o) : err({ kind: 'not_found', id });
    },
    async save(o) { store.set(o.id, o); return ok(undefined); },
  };
}
```

Tests use it directly:

```typescript
test('checkout confirms the cart', async () => {
  const deps = {
    orders: createInMemoryOrdersAdapter({ orders: [makeCart({ id: cartId })] }),
    payment: createInMemoryPaymentAdapter({ alwaysSucceed: true }),
    events: createInMemoryEventBusAdapter(),
    clock: createFakeClockAdapter('2026-01-01T00:00:00Z'),
  };
  const result = await checkoutCart(deps, { cartId, userId });
  expect(result.ok).toBe(true);
});
```

No mocking framework. The shape of in-memory matches the shape of production. Composes with `void-testing` skill's nullable infrastructure pattern.

---

## Composition with other skills

- **`void-domain-driven-design`**: decides bounded contexts, aggregates, ubiquitous language. This skill decides where the boundaries sit physically. Repository ports per aggregate.
- **`void-functional`**: ports return `Result<T, E>`. Use-cases are pure functions. Functional core / imperative shell IS the hex boundary, viewed through a different lens.
- **`void-tdd`**: hex makes the domain testable in isolation; RED writes a use-case test with in-memory adapters; GREEN implements.
- **`void-testing`**: nullable infrastructure pattern (Shore) IS the in-memory-adapter pattern at the port level. Co-evolved.
- **`void-security-guidance`**: trust boundary = adapter ingress. Zod validation of external input happens at the adapter.
- **`void-typescript-strict`**: port interfaces use branded types for domain primitives. Types travel across boundaries via Zod schemas.
- **`void-refactor`**: cross-boundary moves (Move from `services/` to `adapters/`, or vice versa) — this skill decides target placement; refactor executes the move.

---

## Banned

### DI containers (tsyringe, awilix, inversify)

Per `.void/installed/PHILOSOPHY.md` Wing Chun. Function-parameter injection covers the same need with zero cost.

### CQRS as default

Split read / write models only when read scale or read shape diverges enough to justify duplication. Most domains do not. Re-introducing CQRS is an ADR, written through the `void-decide` skill.

### Mediator pattern (MediatR-style dispatch)

Use-cases called directly. The call graph stays visible.

### Generic `Repository<T>` base class

Each port is named by what it does, with specific methods. A generic CRUD repository exposes too much and hides invariants.

### Event sourcing as default

Replayable event log is an audit / temporal tool, not a default persistence strategy. Re-introducing is an ADR.

### Domain → infrastructure imports

Review rejects this dependency direction; a package-manifest check alone cannot prove internal layer isolation.

---

## Companion hooks

- **`boundary-direction-check`** (PreToolUse) checks scoped package imports against the nearest package manifest. It does not validate internal layer imports. See `void-dependency-direction` for the pack convention.

---

## Anti-rules

- MUST NOT decide which framework, queue technology, cache technology — those are pack concerns.
- MUST NOT decide DB schema — `void-domain-driven-design` picks aggregates; `void-migrations` handles mechanics.
- MUST NOT impose DI containers, CQRS, mediator, event sourcing — all rejected at the architecture level.
- MUST NOT silently allow domain → infrastructure imports.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Where does this code go? | Ask: pure decision = `domain/` or `services/`. I/O = `adapters/`. Infra detail = `infrastructure/`. |
| Adapter is growing logic | Adapter is too fat. Move logic to a use-case in `services/`. |
| Use-case has too many deps | Use-case is doing too much. Split. |
| Need to test a use-case with side effects | Inject ports. Use in-memory adapters in tests. |
| Need to swap DB / SDK | Adapter only. Domain unchanged. |
| Need cross-cutting concern (transaction, trace) | Higher-order wrapper `withTransaction(useCase)` composes at the call site. |

---

## Final rule

```
Domain → pure decisions.
Adapters → translation at the edge.
Use-cases → orchestrate ports with no I/O of their own.
Infrastructure NEVER depends on the domain.
Otherwise → it is not voidcorp hexagonal.
```

The architecture is the seam between what the business cares about and what the technology happens to be. Make the seam clean.
