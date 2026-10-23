---
name: void-domain-driven-design
description: Bounded contexts, aggregates as consistency boundaries, value objects as branded types, always-valid domain, ubiquitous language. No CQRS, event sourcing, or generic Repository<T>. Use on the domain.
---

# domain-driven-design — voidcorp craftsman edition

The data model does not drive the design. The domain does. Inside a bounded context, every word has one meaning. Aggregates enforce invariants. Value objects model semantic primitives. The code uses the words the team uses.

**Attribution**: see `.source` in this directory. Foundation: Evans 2003, Vernon 2013, Wlaschin "Domain Modeling Made Functional," Stemmler TS adaptation, Khorikov.

---

## Strategic DDD — the vocabulary

| Term | Definition |
|---|---|
| **Bounded Context** | A boundary inside which a model is valid and a language is consistent. One context = one module/package. |
| **Ubiquitous Language** | The shared vocabulary inside a context. Code uses the same words stakeholders use. Diverging is a bug. |
| **Context Map** | The graph of bounded contexts and their relationships (partnership, conformist, anti-corruption layer, ...). Documented in `docs/CONTEXT-MAP.md` for non-trivial systems. |
| **Aggregate** | A cluster of objects treated as a single unit for consistency. The aggregate enforces its own invariants. |
| **Aggregate Root** | The single entity through which the aggregate is accessed. The only thing repositories return. |
| **Entity** | An object identified by its identity (UserId), not its attributes. Two entities with the same fields but different IDs are distinct. |
| **Value Object** | An object identified by its attributes. Two value objects with the same fields are equal. Immutable. |
| **Domain Service** | A stateless operation that does not fit any single aggregate (e.g., `TransferFunds` across two accounts). |
| **Domain Event** | A typed record describing something that happened in the domain (`OrderConfirmed`, `UserSuspended`). Emitted by aggregates. |

---

## Bounded Context = unit of language

Inside one context, `Order` means ONE thing. Across contexts, `Order` can mean different things — and that is fine, as long as the boundary translates.

Example:

- In the **Checkout** context, `Order` = a cart in the process of being paid.
- In the **Fulfilment** context, `Order` = a list of items to ship.
- In the **Accounting** context, `Order` = a revenue line on the ledger.

These are three distinct types in three distinct packages. They share an ID (`OrderId`) and are translated at the boundary by an **anti-corruption layer** (an adapter that maps from one context's model to another's).

The companion advisory hook `ubiquitous-language-lint` flags terms appearing in code but not in `docs/DOMAIN.md` (the per-context glossary).

### Banned

- Cross-context type imports (`import { Order } from '@/contexts/fulfilment'` from inside the checkout context). The boundary MUST go through an adapter.
- A single shared `Order` type across all contexts. That is "Big Ball of Mud" by another name.

---

## Aggregates — consistency boundaries

An aggregate is a transactional unit. Loading and saving happens at the aggregate root. Invariants inside the aggregate are ALWAYS true (by construction and by aggregate methods).

### Small aggregates (Vernon's rule)

Prefer many small aggregates referencing each other by ID over fewer large aggregates that load deep graphs. Default to small.

<Good>
```typescript
// small aggregates
class Order { id: OrderId; customerId: CustomerId; lineItems: LineItem[]; ... }
class Customer { id: CustomerId; email: Email; ... }
// Order does NOT contain the full Customer object — just the ID
```
</Good>

<Bad>
```typescript
// large aggregate loading everything
class Order {
  customer: Customer;     // loads the customer's address book, preferences, ...
  shipments: Shipment[];  // loads every shipment with carrier details
  invoices: Invoice[];    // loads every invoice with line items
  ...
}
// loading one Order from DB now requires N joins or N+1 queries
```
</Bad>

### Always-valid domain model (Khorikov)

```typescript
class Order {
  private constructor(
    readonly id: OrderId,
    private status: OrderStatus,
    private items: LineItem[],
  ) {}

  static create(input: { items: LineItem[]; customerId: CustomerId }): Result<Order, ValidationError> {
    if (input.items.length === 0) return err({ kind: 'empty_order' });
    return ok(new Order(newOrderId(), 'draft', input.items));
  }

  confirm(): Result<void, OrderError> {
    if (this.status !== 'draft') return err({ kind: 'not_draft', currentStatus: this.status });
    this.status = 'confirmed';
    return ok(undefined);
  }
}
```

- No public constructor (smart constructor `create`).
- No setter `setStatus(s: string)` that accepts any value.
- Every mutation goes through a method that preserves invariants and returns `Result`.

### State machines as discriminated unions (alternative shape)

For workflows with distinct shapes per state, prefer a discriminated union:

```typescript
type Booking =
  | { kind: 'draft'; id: BookingId; partyOf: number }
  | { kind: 'submitted'; id: BookingId; partyOf: number; submittedAt: IsoDate }
  | { kind: 'confirmed'; id: BookingId; partyOf: number; confirmedAt: IsoDate; tableNumber: number }
  | { kind: 'cancelled'; id: BookingId; reason: string; cancelledAt: IsoDate };
```

Transitions are functions: `submit(b: Booking & { kind: 'draft' }): Booking & { kind: 'submitted' }`. The compiler refuses to call `submit` on a `confirmed` booking. Composes with `void-typescript-strict` exhaustive switches and `void-functional` ADTs.

### Heuristic: class vs discriminated union

- Class for aggregates with many invariants and behavior methods (Order, Account)
- Discriminated union for stateful workflows with distinct data per state (BookingFlow, SignupFlow)
- Document the choice per aggregate in `docs/DOMAIN.md`

---

## Value objects — branded types with smart constructors

A value object is identified by attributes. Two `Email`s with the same string are equal. Immutable.

```typescript
type Email = string & { readonly __brand: 'Email' };

export function createEmail(raw: string): Result<Email, ValidationError> {
  if (!EMAIL_REGEX.test(raw)) return err({ kind: 'invalid_email', raw });
  return ok(raw as Email);
}
```

Use a branded type when it prevents a concrete mix-up or enforces an invariant: for example distinct `UserId`/`OrgId`, validated `Email`, or monetary units. Preserve existing meaningful brands. A local primitive with no distinct invariant needs no wrapper merely to satisfy a pattern.

Composes with `void-typescript-strict` (branded type mechanics) and `void-functional` (smart constructors return `Result`).

### Banned: raw primitives for things with semantics

```typescript
function transferFunds(from: string, to: string, amount: number) { ... }
// BAD — nothing prevents transferFunds('alice@example.com', '42', -100)
```

```typescript
function transferFunds(from: AccountId, to: AccountId, amount: Money): Result<void, TransferError> { ... }
// GOOD — the compiler refuses raw strings; Money carries currency
```

---

## Repositories — ports per aggregate, no generic `Repository<T>`

A repository in DDD = a port in `void-hexagonal-architecture`. Named by what it does, methods specific to the aggregate's invariants.

<Good>
```typescript
interface OrdersPort {
  findById(id: OrderId): Promise<Result<Order, NotFoundError>>;
  findByCustomer(customerId: CustomerId): Promise<Result<Order[], never>>;
  save(order: Order): Promise<Result<void, ConflictError>>;
  // NO `delete()` if orders are never deleted (audit constraint)
}
```
</Good>

<Bad>
```typescript
interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(t: T): Promise<void>;
  delete(id: string): Promise<void>;
}
// BAD — exposes operations the aggregate may not allow (`delete`); lies about success (`null` vs Result)
```
</Bad>

---

## Domain Services — multi-aggregate operations only

A domain service is justified when the operation involves multiple aggregates.

```typescript
// domain service: TransferFunds across two Account aggregates
export async function transferFunds(
  deps: { accounts: AccountsPort; events: EventBusPort },
  input: { from: AccountId; to: AccountId; amount: Money },
): Promise<Result<TransferResult, TransferError>> {
  // ... orchestration across two aggregates ...
}
```

Single-aggregate operations are aggregate methods — `account.deposit(amount)`, not `AccountService.deposit(account, amount)`. Without this discipline, domain services become anemic dumping grounds.

---

## Domain Events — typed records emitted by aggregates

```typescript
type OrderEvent =
  | { kind: 'OrderConfirmed'; orderId: OrderId; at: IsoDate }
  | { kind: 'OrderCancelled'; orderId: OrderId; reason: string; at: IsoDate };
```

Aggregates collect events; use-cases dispatch them via an injected `EventBusPort` at the end of the transaction. Composes with `void-hexagonal-architecture` (event bus as a port).

---

## Banned by default

### CQRS, event sourcing, mediator, generic `Repository<T>`

All rejected per `.void/installed/PHILOSOPHY.md` Wing Chun. Re-introducing any of them is an ADR, written through the `void-decide` skill.

### Anemic models (data + setters, logic elsewhere)

Public setters on aggregate fields are forbidden. Mutations go through methods that preserve invariants.

### Service classes named `*Manager`, `*Helper`, `*Util`

Evans' anemic anti-patterns. A `UserManager` that holds `signUp`, `login`, `delete` is a domain service collection — split into named operations.

### Cross-context type imports

The anti-corruption layer (adapter) is mandatory. No direct import.

---

## Companion hooks

- **`ubiquitous-language-lint`** (advisory) — flags code terms not in `docs/DOMAIN.md` (per-context glossary), and glossary terms not present in code. Informational; HITL decides. See `../../hooks/`.

(The structural rules surface through `void-code-review` flags and `void-hexagonal-architecture`'s `boundary-direction-check` hook.)

---

## Composition with other skills

- **`void-hexagonal-architecture`**: this skill decides what an aggregate IS; hex decides where it sits physically. Repositories are ports.
- **`void-functional`**: aggregates as discriminated unions for stateful flows. Value objects as branded types + smart constructors returning `Result`. Always-valid domain.
- **`void-typescript-strict`**: value objects ARE branded types. State machines ARE discriminated unions.
- **`void-tdd`**: aggregate invariants are test-driven — each invariant is a test.
- **`void-code-review`**: structure dimension flags anemic models, generic repositories, raw primitives, public setters.
- **`void-refactor`**: refactors that touch aggregate boundaries (Extract Aggregate, Move Field across contexts) compose for the boundary decision.
- **`void-security-guidance`**: anti-corruption layer at the context boundary is also a trust boundary.

---

## Anti-rules

- MUST NOT prescribe CQRS / event sourcing / mediator / generic repositories by default.
- MUST NOT decide tactical implementation shape (FP / OOP) inside an aggregate — `void-functional`'s call.
- MUST NOT decide whether a sub-domain is Core / Supporting / Generic — product call, lives upstream.
- MUST NOT decide framework / DB / queue — pack concerns.
- MUST NOT silently allow cross-context type imports.
- MUST NOT decide aggregate identity strategy (UUID / nanoid / DB-assigned) — pack provides default, consumer overrides.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Where does this aggregate sit? | Identify the bounded context. One context per package. Cross-context = anti-corruption adapter. |
| Class or discriminated union? | Class for many-invariants + methods. Union for distinct-shape-per-state workflows. |
| Should this be an aggregate or a value object? | Identity matters → entity / aggregate root. Pure attributes → value object. |
| Aggregate growing too large | Apply small-aggregate rule. Reference other aggregates by ID, not by inclusion. |
| Stuck naming | Use the stakeholders' word. If terminology is unclear, the domain is unclear — fix that first. |
| Need to share data across contexts | Anti-corruption adapter at the destination context. No direct type import. |

---

## Final rule

```
Bounded contexts are independent. Aggregates are always valid.
Value objects use branded types. The code speaks the team's language.
Otherwise → it is not voidcorp DDD.
```

The domain is the heart. The technology is plumbing. Get the domain right and the rest follows.
