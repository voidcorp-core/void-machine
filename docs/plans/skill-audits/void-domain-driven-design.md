---
skill: domain-driven-design
status: reviewed
strategy: distill
target_loc: 400
phase: C
depends_on: [hexagonal-architecture, functional]
composes_with: [tdd, typescript-strict, security-guidance, code-review, refactor]
matrix_row: plans/skill-decision-matrix.md#domain-driven-design
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `domain-driven-design`

## Need

Without DDD discipline, the data model drives the design. Tables shape services, services shape components, components shape the UI. Business invariants leak: `User.status` may be `'active'`, `'pending'`, `'suspended'`, but nothing in code prevents an `active` user from being charged when they should not be. Stakeholders use one word ("Order") and code uses another ("Cart" / "Invoice" / "Transaction" inconsistently). `domain-driven-design` codifies bounded contexts (separate languages), aggregates (consistency boundaries), value objects (semantic primitives), and the ubiquitous language as the source of truth.

## Decision matrix anchor

- **Wins**: identifying bounded contexts, aggregates, ubiquitous language, anti-corruption layers between domains, value object identification
- **Loses to**: `hexagonal-architecture` on the technical boundary mechanism (ports / adapters / use-case layer). `functional` on data shapes within an aggregate (ADTs, immutability, smart constructors)
- **Cannot decide**: tactical patterns delegated to `functional` + `hexagonal-architecture`. Sub-domain analysis (Core / Supporting / Generic) — that is a product call, lives upstream in `brainstorm` / `plan-review` (CEO lens)
- **Composes with**: `hexagonal-architecture` (physical boundaries match logical), `functional` (data shape inside aggregates), `typescript-strict` (branded types for value objects), `code-review` (flag anemic models)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Eric Evans "Domain-Driven Design: Tackling Complexity in the Heart of Software" 2003 | book | foundation | kept (strategic DDD vocabulary, bounded contexts, ubiquitous language, aggregate concept) |
| Vaughn Vernon "Implementing Domain-Driven Design" 2013 | book | foundation | kept (tactical patterns adapted, aggregate sizing rule of thumb, "small aggregates") |
| Scott Wlaschin "Domain Modeling Made Functional" | https://pragprog.com/titles/swdddf | foundation | kept (DDD + FP synthesis: make illegal states unrepresentable, types over docs, choices as types) |
| Khalil Stemmler practical DDD in TypeScript | https://khalilstemmler.com/articles/categories/domain-driven-design/ | reviewed | kept (TS-flavored tactical examples — value objects via branded types, aggregate methods) |
| Vlad Khorikov "Domain Modeling" course / blog | https://enterprisecraftsmanship.com | reviewed | kept (always-valid domain model, exceptions vs Result for domain errors) |
| Vernon "Domain-Driven Design Distilled" 2016 | book | reviewed | reference (shorter introduction, useful for orientation) |
| citypaul/.dotfiles DDD notes | citypaul/.dotfiles | reviewed | partially kept (ubiquitous language enforcement in code reviews) |

## Adaptation strategy

`distill`. Strategic DDD (Evans) + tactical FP-flavored (Wlaschin) + TS pragmatics (Stemmler). Reject heavy tactical patterns (CQRS, event sourcing, mediator) by default — they remain available as a future pack if a project warrants them.

## What we keep (verbatim or near-verbatim)

- **Strategic DDD vocabulary** (Evans): Bounded Context, Ubiquitous Language, Context Map, Aggregate, Aggregate Root, Entity, Value Object, Domain Event, Domain Service. Use these names as-is. They are the lingua franca.
- **Bounded Context as the unit of language** (Evans): inside a context, every term has ONE meaning. Across contexts, the same word can mean different things and that is fine — it requires explicit translation at the boundary (anti-corruption layer).
- **Aggregate as a consistency boundary** (Evans + Vernon): one aggregate = one transactional unit. Invariants inside the aggregate are always true. Cross-aggregate operations are eventually consistent (or explicitly two-phase, but rarely needed at solopreneur scale).
- **Small aggregates** (Vernon's "design rule of thumb"): prefer many small aggregates referencing each other by ID over fewer large aggregates that load deep object graphs. Default to small; grow only when invariants demand it.
- **Always-valid domain model** (Khorikov): an aggregate or value object cannot exist in an invalid state. Construction validates. Mutations go through methods that preserve invariants. No `setStatus(...)` setter that accepts any string.
- **"Make illegal states unrepresentable"** (Wlaschin): the type system encodes invariants. A `DraftOrder` and a `ConfirmedOrder` are different types — there is no `Order.status: 'draft' | 'confirmed'` flag that an attacker (or a bug) can flip.
- **Ubiquitous Language as the source of truth**: the code uses the words stakeholders use. If the team says "fulfilment," the code does not say "shipment processing." If the term diverges between code and conversation, the code is wrong.

## What we adapt

- **TS-flavored tactical patterns**:
  - **Value Objects = branded types + smart constructors** (Stemmler + composes with `typescript-strict`): `Email`, `Money`, `UserId`, `IsoDate` are branded types. Construction returns `Result<T, ValidationError>` (composes with `functional`).
  - **Aggregates = TS classes OR discriminated-union state machines**: we allow both. Classes for aggregates with significant invariants (an `Order` with line items, discounts, status transitions). Discriminated unions for stateful flows (a `BookingFlow` with `Draft | Submitted | Confirmed | Cancelled` states, each carrying different data). Document the choice per aggregate.
  - **Domain events as plain typed records**: `{ kind: 'OrderConfirmed'; orderId: OrderId; at: IsoDate }`. Emitted by aggregates, collected by the use-case layer, dispatched via injected event-bus port (compose with `hexagonal-architecture`).
- **Repository pattern as port + adapter**: Vernon's repository concept becomes a port (`OrdersPort.findById`, `OrdersPort.save`) with adapters per persistence technology. Composes with `hexagonal-architecture`. Why: avoid Vernon's framework-specific repository implementations; the port abstraction is enough.
- **Domain errors as `Result<T, DomainError>` not exceptions** (Khorikov's "Result alternative"): expected domain failures (out of stock, insufficient balance) are values. Exceptions remain for unexpected technical failures (DB down, network timeout). Composes with `functional`.
- **Sub-domain analysis upstream**: identifying Core / Supporting / Generic sub-domains is a product call (which capabilities are competitive advantage vs commodity). We delegate this to `brainstorm` (idea pressure-test) and `plan-review` (CEO lens). The DDD skill consumes the result, does not produce it.

## What we reject

- **CQRS as default**: rejected. Split read / write models only when read scale or read shape diverges enough to justify the duplication. Most domains do not. Why: documented in `docs/DECISIONS.md` (per design spec hedge).
- **Event sourcing as default**: rejected. Replayable event log is an audit / temporal tool, not a default persistence strategy. Why: cost (event versioning, snapshot management, projection consistency) outweighs benefit for > 90% of domains.
- **Mediator pattern** (MediatR / dispatcher): rejected. Use-cases called directly. Composes with `hexagonal-architecture` "no DI container, no mediator."
- **Generic Repository<T> base class** (Vernon's example): rejected. Each port is named by what it does, with specific methods. A generic `Repository<T>.findById/save/delete` exposes too much, hides invariants, and lies about which operations are actually supported per aggregate.
- **Domain Services as the default place for "stuff that does not fit an aggregate"**: rejected as default. A domain service is justified when the operation involves multiple aggregates (e.g., `TransferFunds` across two accounts). Single-aggregate operations are aggregate methods. Why: domain services become anemic dumping grounds without this discipline.
- **Service layer as a synonym for use-case layer** (Vernon's "application services"): we use `use-cases/` (or `services/business/` in `pack-monorepo` convention) for the use-case layer. "Domain service" is a distinct concept (multi-aggregate operations). Two layers, two names.

## Hard rules surfaced by this skill

- **Each bounded context has its own module / package** with its own `domain/`, `use-cases/`, `adapters/`. Cross-context types are NOT shared directly — they cross via anti-corruption layer (an adapter that translates). Enforced by: SKILL.md + `pack-monorepo` import paths + `code-review` flags on cross-context type imports.
- **Aggregates always valid**: construction (`createOrder(...)`) validates. Mutations (`order.applyDiscount(...)`) preserve invariants. No public setters on aggregate fields. Enforced by: SKILL.md + `code-review` flags on public setters on domain classes.
- **Value objects are branded types with smart constructors** (composes with `typescript-strict`). Raw `string` / `number` for things with semantics is rejected. Enforced by: SKILL.md + `code-review` flags.
- **Small aggregates by default**: an aggregate that loads > 3 levels of nested objects on `findById` is suspect. Refactor by introducing aggregate IDs as references. Enforced by: SKILL.md + `code-review` smell ("large aggregate").
- **No generic `Repository<T>`**. Named ports per aggregate. Enforced by: SKILL.md + `code-review`.
- **Domain services for multi-aggregate operations only**. Single-aggregate logic = aggregate method. Enforced by: SKILL.md + `code-review`.
- **Ubiquitous language in code matches stakeholders' words**. Diverged terminology is a bug. Enforced by: `code-review` (the reviewer asks "is `cart` the team's word? what about `basket`?").
- **No CQRS / event sourcing / mediator by default**. Re-introducing any of them is an ADR in `docs/DECISIONS.md`.

## Modes — none

DDD applies uniformly. The intensity scales with domain complexity (a CRUD admin tool barely needs aggregates beyond entities-with-validation; an order-management system uses the full toolkit). The skill provides the vocabulary; the consumer dials the intensity per bounded context.

## Companion hooks

- **`ubiquitous-language-lint`** (advisory, not blocking) — maintains a project glossary at `docs/DOMAIN.md`. The `code-review` skill flags terms appearing in code but not in the glossary (and vice versa). The hook is informational; HITL decides whether to update the glossary or rename the code. ≤ 60 LOC.

(The structural rules are mostly enforced via `code-review` flags and `hexagonal-architecture`'s `boundary-direction-check` hook; DDD itself does not add many mechanical hooks because most rules are semantic.)

## Composition with other skills

- **With `hexagonal-architecture`**: DDD decides the bounded contexts and aggregates; hex decides where the boundaries sit physically (per-context package, port/adapter split). Aggregates are loaded/saved through repository ports.
- **With `functional`**: aggregates as discriminated unions for stateful flows. Value objects as branded types + smart constructors. Domain errors as `Result<T, DomainError>`. Make illegal states unrepresentable.
- **With `typescript-strict`**: value objects ARE branded types. Aggregate state machines ARE discriminated unions. The type system carries the invariants.
- **With `tdd`**: aggregate behavior is test-driven. Each invariant is a test. Construction validates → invalid input test. Mutation respects invariants → invariant-preservation test.
- **With `code-review`**: dimension `structure` includes "aggregates valid, value objects used, ubiquitous language matched, no anemic model."
- **With `refactor`**: refactors that touch aggregate boundaries (Extract Aggregate, Move Field across contexts) compose with this skill for the boundary decision.
- **With `security-guidance`**: anti-corruption layer at the bounded context boundary is also a trust boundary — validation + sanitization happen there.

## Anti-rules (what this skill MUST NOT do)

- MUST NOT prescribe CQRS / event sourcing / mediator / generic repositories by default.
- MUST NOT decide tactical implementation shape (FP / OOP) inside an aggregate — that is `functional`'s call.
- MUST NOT decide whether a sub-domain is Core / Supporting / Generic — that is a product call, lives upstream.
- MUST NOT decide which framework / DB / queue technology — pack concerns.
- MUST NOT silently allow cross-context type imports. The anti-corruption layer (adapter) MUST exist.
- MUST NOT decide aggregate identity strategy (UUID vs nanoid vs DB-assigned) — pack-monorepo provides a default, consumer overrides per context.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 400 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions bounded contexts + aggregates + value objects + ubiquitous language as headline
- [ ] `.source` file lists Evans 2003, Vernon 2013, Wlaschin, Stemmler, Khorikov, citypaul
- [ ] `ubiquitous-language-lint` advisory hook drafted at ≤ 100 LOC
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/domain-driven-design/` cover: anemic-model detection (public setter on aggregate), generic-Repository<T> detection, raw-string-as-domain-primitive detection, cross-context type import detection
- [ ] No overlap > 30% with `hexagonal-architecture` (DDD = content, hex = mechanism)
- [ ] No overlap > 30% with `functional` (DDD = bounded contexts and aggregates, functional = how to shape data inside)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **Aggregate as TS class vs discriminated union**: heuristic — class for "thing with many invariants and methods" (Order, Account), discriminated union for "stateful workflow with distinct shapes per state" (BookingFlow, SignupFlow). Document the heuristic with examples in SKILL.md.
- **Domain event bus port**: shape — `emit(event: DomainEvent)` or `emitAll(events: DomainEvent[])`? Lean batch (allows aggregate methods to accumulate events, use-case dispatches at the end of the transaction).
- **Aggregate identity generation**: who creates the ID? Lean smart constructor in the aggregate creates it (using an injected ID generator port for testability). Document pattern.
- **Anti-corruption layer pattern in TS**: convention name (`@/contexts/<src>/adapters/<dst>/translate.ts`?). Lean: adapter file at the destination context (`adapter` for the destination), naming convention defined in `pack-monorepo`.
- **Ubiquitous language glossary location**: `docs/DOMAIN.md` (single glossary) vs `<context>/DOMAIN.md` per context. Lean per-context (each bounded context has its own language; a single glossary blurs the boundaries).
- **DDD "lite" vs full**: where to draw the line? Heuristic — a < 2-developer project with < 5 entities barely needs aggregates beyond value-object-rich entities. A full bounded-context split is overkill until 2 contexts exist. Document the dialing-in advice in SKILL.md.
- **`docs/DOMAIN.md` template**: provide a starter via `voidcorp-harness init`? Lean yes for `pack-monorepo` activated projects.

## 2026-10-23: proportional delivery

Align the existing standard with the owning workflow, preserving its technical protection while
removing repeated or pattern-only obligations. See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
