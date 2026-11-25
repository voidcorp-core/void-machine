---
name: void-api-and-interface-design
description: Contract-first design of any public interface — package exports, HTTP/REST, RPC/tRPC, SDK, module boundary. Minimal surface, stable boundary types, versioning. Use when shaping a public API.
---

# api-and-interface-design — voidcorp craftsman edition

A public interface is a promise. The contract is the promise; the implementation is replaceable. Once a consumer depends on a signature, that signature costs you forever — every shape you expose is a shape you must keep working or deprecate on a schedule. This skill governs how you draw the contract of anything other code consumes: what it accepts, what it returns, how it fails, how it changes.

Design the contract before the implementation. The implementation is private and free to churn; the contract is public and expensive to change.

**Attribution**: see `.source` in this directory. Foundation: Parnas "information hiding," Bloch "How to Design a Good API," contract-first / OpenAPI, SemVer.

---

## Boundary with neighboring skills

This skill is narrow. It does NOT cover layered architecture or domain vocabulary.

| Concern | Owner |
|---|---|
| Where the boundary sits physically, dependency direction, ports vs adapters | `void-hexagonal-architecture` |
| What the domain IS — bounded contexts, aggregates, ubiquitous language | `void-domain-driven-design` |
| **The shape, stability, and versioning of a public contract — viewed from the outside** | **this skill** |

A port (hex) is an interface the domain owns. This skill says how to draw that port well *as seen by its consumer*: minimal, hard to misuse, stable, versioned. Hex decides the port exists and which side owns it; DDD supplies the words inside it; this skill shapes the contract.

---

## Contract-first — the order of operations

Before writing the implementation, write the contract down:

1. **Signature** — the operations, their names (ubiquitous-language words, per `void-domain-driven-design`).
2. **Input type** — exactly what is accepted, validated at the boundary.
3. **Output type** — a dedicated boundary type, never an internal/DB row.
4. **Error set** — the failures a consumer must handle, as values.
5. **Invariants** — what the contract guarantees (idempotency, ordering, pagination).

The contract is reviewable on its own, before a single line of logic. For HTTP/RPC this is the OpenAPI / schema spec; for a package it is the exported `.d.ts`; for a module it is the interface. Implementation-first design (writing logic, then "extracting" an API from whatever leaked out) is the anti-pattern this skill exists to prevent.

---

## Minimal surface — when in doubt, leave it out

Everything public is a liability. You cannot un-ship a method without breaking someone.

- Expose the smallest set of operations that satisfies the use case. Internal helpers stay un-exported.
- A capability you are unsure about: keep it private. Adding later is non-breaking; removing later is breaking.
- One way to do a thing, not three. Redundant entry points multiply the contract you must keep stable.

Bloch's rule: *when in doubt, leave it out.* You can always add; you can rarely remove.

---

## Make it hard to misuse

The best contract makes the invalid call fail to compile, not fail at runtime. Composes with `void-typescript-strict`.

### Illegal states unrepresentable

```typescript
// BAD — caller can pass a window that ends before it starts
function schedule(input: { startsAt: IsoDate; endsAt: IsoDate }): Result<Booking, ScheduleError>;

// BETTER — a validated value object can only exist if valid
function schedule(input: { window: TimeWindow }): Result<Booking, ScheduleError>;
// TimeWindow's smart constructor (per domain-driven-design) refuses end < start
```

### No positional booleans, no bare primitives

```typescript
// BAD — call site reads createUser('a@b.co', true, false); nobody knows what true/false mean
function createUser(email: string, isAdmin: boolean, sendWelcome: boolean): User;

// GOOD — named options object + branded input types
function createUser(input: {
  email: Email;                       // branded, validated (domain-driven-design)
  role: 'admin' | 'member';           // discriminated, not a boolean
  welcome?: { send: boolean };
}): Result<User, CreateUserError>;
```

Named parameters survive reordering and additions; positional booleans rot the moment a third flag appears.

---

## Stable boundary types — never leak the inside

The types crossing a public boundary are part of the contract. Internal and DB types are not.

- **No leaking ORM rows / DB models / framework request objects** across a public boundary. A schema change must not silently break a consumer.
- **Dedicated boundary types (DTOs / branded types)**. They are mapped to/from internal types in the adapter (per `void-hexagonal-architecture`), exactly where translation already lives.
- **Validate input at the boundary**. External input is untrusted; parse it into the boundary type with a schema (Zod) before anything else touches it. Composes with `void-security-guidance`.

```typescript
// boundary input parsed before it reaches the use-case
const parsed = createUserRequestSchema.safeParse(req.body);
if (!parsed.success) return badRequest(parsed.error);   // 400, no internal detail leaked
const result = await createUser(deps, toCreateUserInput(parsed.data));
```

The boundary type is a wall: internal churn stays internal, external input stays validated.

---

## Errors are part of the contract

What can go wrong is as much a promise as what goes right. Consumers branch on failures; surprise failures are bugs you shipped.

- **Typed results at the boundary** — return `Result<T, E>` where `E` is a closed, named set of failures. Composes with `void-functional`.
- **Stable error identity** — a stable `code` (and a stable HTTP status for network APIs). Consumers match on the code, not on the message string.
- **Non-sensitive messages** — never leak stack traces, internal IDs, SQL, or PII across the boundary. Messages are for humans; codes are for machines.

```typescript
type CreateUserError =
  | { code: 'email_taken'; status: 409 }
  | { code: 'invalid_email'; status: 400 }
  | { code: 'rate_limited'; status: 429; retryAfterSec: number };
```

Adding a new error variant is additive only if consumers already have a default branch; otherwise it is a breaking change (see versioning).

---

## Versioning and backward compatibility

A breaking change to a published contract is a broken promise to every consumer. SemVer encodes the promise: MAJOR breaks, MINOR adds, PATCH fixes.

**Additive-first.** New optional field, new operation, new error variant behind a default branch — non-breaking, ship as MINOR.

**Breaking requires a new version or a deprecation cycle.** Removing a field, renaming an operation, narrowing an input, tightening an output, changing an error code — all breaking. Either ship a new version (`/v2`, major bump) or run a deprecation cycle: **deprecate before you remove.**

Deprecation cycle:

1. Mark the old surface deprecated (`@deprecated` JSDoc / `Deprecation` header / changelog), point to the replacement.
2. Ship the replacement alongside. Both work.
3. Give consumers a window (a release count or a date).
4. Remove in the next MAJOR only.

Never shorten the cycle silently. A consumer that wakes up to a 410 they were never warned about is the failure mode this rule prevents.

---

## Network APIs — idempotency and pagination

For interfaces crossing the wire, two contract terms earn their place when relevant. Composes with `void-async-safety`.

- **Idempotency** — any non-`GET` a client may retry (a payment, a create) accepts an idempotency key, and the server guarantees one effect per key. Retries are inevitable on a network; the contract must make them safe.
- **Pagination** — any collection that can grow is paginated from day one, with a stable cursor contract. Returning an unbounded list is a promise you cannot keep at scale, and adding pagination later is breaking.

Both are decided at contract time. Retrofitting either breaks consumers.

---

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll design the API once the implementation works." | The implementation will leak its shape into the contract. Design the contract first; it is reviewable alone. |
| "Expose it now, someone might need it." | Public surface is forever. Add when a real consumer appears; removing is the breaking change you cannot take back. |
| "Returning the DB row is faster." | The row is your schema. A migration now silently breaks every consumer. Map to a boundary type. |
| "A boolean flag is simpler than an enum." | Until the third flag. `fn(x, true, false)` is unreadable and reorder-fragile. Named options + unions. |
| "Throwing is fine, callers can catch." | Thrown errors are invisible in the type. Consumers forget the catch. Typed `Result` makes failure part of the signature. |
| "It's a small rename, no big deal." | A rename is a breaking change. Deprecate the old name, add the new, remove next major. |
| "We'll add pagination when the list gets big." | By then consumers depend on the array shape. Adding pagination is breaking. Paginate from day one. |
| "Internal API, compatibility doesn't matter." | If another module imports it, it has consumers. The promise still holds across the module boundary. |

---

## Verification

Before a public interface is considered designed:

- [ ] The contract (signatures, input types, output types, error set, invariants) was written and reviewed **before** the implementation.
- [ ] Public surface is minimal — every exported symbol has a current consumer; helpers are un-exported.
- [ ] No internal / ORM / framework type crosses the boundary; boundary uses dedicated DTOs or branded types.
- [ ] All external input is validated at the boundary with a schema before use (composes with `void-security-guidance`).
- [ ] Failures are a closed, typed `Result` set with stable codes (and stable HTTP statuses for network APIs); messages carry no sensitive detail.
- [ ] No positional booleans; multi-arg calls use a named options object; primitives with semantics are branded.
- [ ] The contract is versioned; any breaking change is gated behind a new version or a documented deprecation cycle (deprecate → coexist → remove next major).
- [ ] For network APIs: retryable mutations accept an idempotency key; growable collections are paginated with a stable cursor.

---

## Composition with other skills

- **`void-hexagonal-architecture`**: the domain owns ports (interfaces). Hex says the port exists and who owns it; this skill says how to draw that port well as seen from outside — minimal, misuse-resistant, versioned. Boundary types map to internal types in the adapter.
- **`void-domain-driven-design`**: contract names come from the ubiquitous language. Input/output types reuse value objects (branded types) and aggregate identities. DDD names; this skill shapes the public face.
- **`void-typescript-strict`**: branded types at the boundary, discriminated unions for inputs and error sets, `satisfies` for response shapes, exhaustive handling of the error union.
- **`void-functional`**: `Result<T, E>` is the boundary return; the error set is a closed ADT.
- **`void-security-guidance`**: external input parsed/validated at the boundary (Zod); errors carry no sensitive payload.
- **`void-async-safety`**: idempotency keys and retry semantics for network mutations; pagination for growable reads.
- **`void-devex-audit`**: this skill is the build-time floor (design a minimal, misuse-resistant, versioned contract); `void-devex-audit` is the audit-time ceiling that measures the shipped contract's developer experience (TTHW, error paths, docs, upgrade) after it deploys.

---

## Anti-rules

- MUST NOT decide where the boundary sits physically or the dependency direction — `void-hexagonal-architecture`'s call.
- MUST NOT define the domain model, bounded contexts, or aggregates — `void-domain-driven-design`'s call.
- MUST NOT expose internal, ORM, or framework types across a public boundary.
- MUST NOT break a published contract without a new version or a documented deprecation cycle.
- MUST NOT design the API after the implementation (implementation-first).
- MUST NOT decide the transport / framework / serialization library — pack concern.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Should this be public? | If no current consumer needs it, keep it private. Add later; never break later. |
| Class, options object, or positional args? | More than one argument, or any boolean → named options object. |
| How should failures surface? | Typed `Result` with a closed error set and stable codes. No throwing across the boundary. |
| Is this change breaking? | Removing / renaming / narrowing input / widening required output / changing a code = breaking. Additive = safe. |
| Need to remove a field consumers use? | Deprecate, coexist, remove next major. Never silent. |
| DB type or boundary type? | Always a boundary type. The DB shape is private. |

---

## Final rule

```
Contract before implementation. Minimal surface. Stable boundary types.
Errors typed. Breaking change → new version or deprecation cycle.
Otherwise → it is not a voidcorp public interface.
```

The implementation is yours to change. The contract belongs to everyone who calls it. Treat it like a promise, because it is one.
