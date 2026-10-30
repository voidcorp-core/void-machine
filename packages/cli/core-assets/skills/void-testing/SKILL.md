---
name: void-testing
description: How to write a good test. Behavior over implementation, real code over mocks, factories over beforeEach, pyramid respected, pristine output, no snapshot creep. Use when writing or modifying tests.
---

# testing — voidcorp craftsman edition

`void-tdd` provides the cycle (when to write the test). This skill provides the technique (how to write a good one). Mocking is the last resort. Behavior, not implementation. Factories, not `beforeEach`. Pristine output is a passing condition.

**Attribution**: see `.source` in this directory.

---

## Core principles

### 1. Test the behavior, not the implementation

Assertions describe what the user / consumer of the code observes. They do not describe which private method ran, which collaborator was invoked, which exact internal sequence happened.

<Good>
```typescript
test('retries failed operations 3 times before giving up', async () => {
  let attempts = 0;
  const op = () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
    return 'success';
  };
  expect(await retryOperation(op)).toBe('success');
  expect(attempts).toBe(3); // observable: how many times the operation ran
});
```
</Good>

<Bad>
```typescript
test('retry', () => {
  const spy = vi.fn().mockRejectedValueOnce(...).mockResolvedValueOnce(...);
  retryOperation(spy);
  expect(spy).toHaveBeenCalledTimes(3); // tests the spy, not the behavior
  expect(retryOperation['_internalDelay']).toBeDefined(); // tests internals
});
```
</Bad>

For UI: query by accessible role / label, not by class or `data-testid`. `data-testid` is the escape hatch when no semantic query works, not the default.

For interactive UI, pair the accessible query with the user input that proves the contract:
`userEvent.keyboard` for keyboard paths, pointer input only for pointer behavior, and visible output
for state transitions. Test loading, empty, error, success, and partial states only when applicable,
but make that applicability explicit. Component, hook, and store tests stay at their observable
boundaries; a broad E2E test does not substitute for the focused regression that identifies which
contract broke.

### 2. Sociable tests over solitary tests

Let collaborators run inside the test by default. Only mock at infrastructure boundaries:

- HTTP → MSW (Mock Service Worker)
- DB → pglite (in-memory Postgres) or Neon dev branch
- Filesystem → `memfs` or a temp directory
- Time → `vi.useFakeTimers()`
- Randomness → seeded RNG

Mocking a collaborator that does pure computation is a code smell. If you find yourself mocking `formatCurrency()` to test `renderInvoice()`, the design is too coupled — or your test should run `formatCurrency` for real.

### 3. Nullable infrastructure pattern (Shore)

For the infrastructure that DOES need a test double, the wrapper exposes a `createNull()` variant that returns deterministic / empty results. No mocking library invocation; the constructor handles it.

```typescript
class StripeClient {
  static create(apiKey: string): StripeClient { /* real */ }
  static createNull(opts?: { charges?: ChargeFixture[] }): StripeClient { /* in-memory */ }
}

// in tests:
const stripe = StripeClient.createNull({ charges: [makeCharge({ amount_cents: 1000 })] });
```

The nullable variant is production-typed. Tests do not reach into a mocking framework. The boundary is owned by the domain.

### 4. Pristine output

After a test passes, the output is clean:

- No `console.log` from production code
- No warnings (React act warnings, deprecation warnings, etc.)
- No leaked unhandled rejections
- No leaked timers / open handles

Pristine output is a passing condition, not a nice-to-have. Vitest config: `onConsoleLog: 'fail'`.

### 5. Release E2E proves the shipped artifact

Release proof exercises the immutable deployable artifact, not a development compiler. Keep build
readiness (the process started and became healthy) separate from application assertions, so a slow
compile cannot consume the assertion budget or hide a failed startup.

Fixtures use the lowest faithful boundary that preserves the behavior under test. Establishing an
authenticated precondition may use a server/API boundary; the authentication UI remains an E2E
subject when authentication itself is the behavior being proved.

External state is namespaced per run/worker and cleanup is idempotent and bounded, including after
interruption. Browser storage state is sensitive ephemeral output and belongs under the test output
directory, never in source control.

Test-only security overrides are typed, bounded, and paired with independent proof of production
defaults and denial behavior. A malformed or out-of-range override falls back to safe production
defaults. No retry-on-failure, quarantine, skip, or assertion-timeout inflation is a flake fix.

---

## Naming

Describe the behavior. Imperative. Specific.

<Good>
- `retries failed operations 3 times before giving up`
- `rejects payment when card balance is below total`
- `emits user-created event after first successful login`
</Good>

<Bad>
- `test retry` (vacuous)
- `should work` (says nothing)
- `retryOperation` (function name, not behavior)
- `it should retry` (the "should" is fluff)
</Bad>

The companion hook `test-name-lint` warns on weak patterns (`test`, `works`, `should` as the entire name).

---

## Fixtures and factories

### Factories over `beforeEach`

`beforeEach` for environment setup (mount DOM, reset DB, install fake timers). NOT for test data.

<Good>
```typescript
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: createUserId('usr_test_001'),
    email: 'user@example.com',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

test('rejects suspended users', () => {
  const user = makeUser({ suspended: true });
  expect(authorize(user)).toEqual({ ok: false, error: 'suspended' });
});
```
</Good>

<Bad>
```typescript
let user: User;
beforeEach(() => {
  user = { id: '...', email: '...', /* shared mutable state */ };
});
test('rejects suspended users', () => {
  user.suspended = true; // mutates shared state, leaks between tests
  expect(authorize(user)).toEqual({ ok: false, error: 'suspended' });
});
```
</Bad>

### Externalize > 5-line fixtures

Inline fixtures are fine when small (< 5 lines). Larger fixtures go to `tests/fixtures/<name>.ts`. Each fixture exposes a factory function with overrides.

Heavy data (multi-KB JSON, sample images): load from disk, never inline.

---

## Test pyramid

Heuristic ratios for a TS/web project:

- **~70% unit tests**: pure functions, business logic, schema validation. Run in < 100ms each.
- **~20% integration tests**: real infrastructure via pglite / MSW / temp filesystem. Run in < 1s each typically.
- **~10% E2E tests**: Playwright on critical user paths. Run in seconds.

Numbers are a heuristic, not a quota. A solopreneur with strong types may run closer to 50/40/10 because integration tests buy more confidence per unit of effort. Adjust by data, not by tradition.

**Inverted pyramid is a smell**: if your E2E suite carries the proof and your unit suite is sparse, your design is probably testing badly (too coupled to make unit tests cheap). Fix the design.

---

## Mocking strategy

### When to use what

| Test target | Boundary technique |
|---|---|
| Pure business logic | No mock. Real code. |
| HTTP client → external API | MSW handlers in `tests/msw/handlers.ts` (or pglite for inbound HTTP if testing a Next.js route handler) |
| ORM → Postgres | pglite (in-memory) for unit-of-work. Neon dev branch for E2E-like integration |
| Date / Time | `vi.useFakeTimers()`, advance explicitly |
| `Math.random` / UUID | seeded RNG passed via parameter (composes with `void-hexagonal-architecture` port pattern) |
| File system | `memfs` or temp directory |
| Server Actions | invoke directly; the sandbox is light |

### What NOT to mock

- A pure function (run it)
- A business service (compose, do not mock)
- The framework router (use the framework's testing utilities)
- The ORM at the unit level (use pglite — see `void-tdd` anti-pattern)

The companion hook `no-business-mock` warns on `vi.mock('@/services/...')` patterns.

---

## Banned practices

### Snapshot testing — banned by default

Snapshots devolve into "update on green" — the test passes regardless of correctness. Allowed only for:

- **UI visual regression**: in `**/__visual__/**` directory with documented review process
- **Compiler output sanity** (`__generated__/` snapshots): same constraint

Each snapshot has a reason. No `.toMatchSnapshot()` outside the whitelist without explicit code-review approval.

### `.only` / `.skip` / `fdescribe` / `xit`

Banned in committed code. They mean "I will not run this." If you mean "this case is intentionally not yet tested," write a `it.todo('description')` — the test runner reports todos.

The companion hook `no-only-no-skip` blocks commits with `.only` / `fdescribe` / `xit` in the staged diff (allowed in `**/__skip-on-purpose__/**` whitelist with justifying comment).

### Implementation spies as primary assertion

`expect(spy).toHaveBeenCalledWith(...)` is for "did the side effect at this boundary happen" — only at infrastructure boundaries. It is not the assertion for business behavior.

### `describe.each` for unrelated scenarios

`describe.each([...])` is for genuinely parametric tests (boundary values, equivalence classes). It is NOT for grouping 5 different scenarios that share scaffolding — that hides the differences.

### Inline DB mocks for business-layer tests

Use pglite or dev branch. Mocking Drizzle breaks at every schema change while protecting nothing real.

---

## Composition with other skills

- **With `void-tdd`**: `void-tdd` is the cycle (when), `void-testing` is the technique (how). RED step delegates the *how* here.
- **With the mutation gate** (strict TDD, when the project declares a mutation runner): a high survivor rate is a `void-testing` signal — the tests are not asserting on the right things. KILL step iterates back here.
- **With `void-typescript-strict`**: tests use branded types from production. A test needing `as any` is signaling a missing factory or brittle type.
- **With `void-hexagonal-architecture`**: ports tested with nullable infrastructure. In-memory adapters owned by the domain.
- **With `void-migrations`**: DB migrations have their own discipline; this skill's pyramid does not apply to migration tests.

---

## Companion hooks

- **`no-only-no-skip`** — block on `.only` / `fdescribe` / `xit` / `.skip` in staged diff (whitelist: `**/__skip-on-purpose__/**`)
- **`test-name-lint`** — warn on weak test names matching `/^\s*(test|works|should)\s*$/i`
- **`no-business-mock`** — warn on `vi.mock\('@/(services|domain)/...'\)` patterns
- **`no-snapshot-default`** — warn on new `.toMatchSnapshot()` outside `**/__visual__/**` whitelist

See `../../hooks/`.

---

## Anti-rules

- MUST NOT decide WHETHER a test exists. That is `void-tdd`'s Iron Law.
- MUST NOT decide coverage thresholds. That is the project's configured policy, applied by `void-tdd` alongside behavior/risk coverage.
- MUST NOT decide architecture (what is a port, what is an adapter). Hexagonal owns that.
- MUST NOT decide framework specifics (which Vitest reporter, Playwright trace mode). Pack-level config.
- MUST NOT silently allow snapshot creep.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Test feels brittle, breaks on refactor | Coupled to implementation. Test the behavior at the boundary instead. |
| Need to mock 5 things to test 1 thing | Coupling smell. Inject dependencies via parameters. Compose with `void-hexagonal-architecture`. |
| Fixture is huge | Externalize to `tests/fixtures/`. Use a factory with overrides. |
| Test name is weak | Describe the behavior, not the function. Imperative. |
| Snapshot wants to update on every change | Snapshot is wrong. Replace with explicit assertions. |
| Pyramid feels wrong | Adjust by data after 50+ tests. The 70/20/10 is a heuristic. |

---

## Final rule

```
A test → asserts behavior, uses real code where possible, runs deterministically, produces pristine output.
Otherwise → it is not a voidcorp testing test.
```

Tests prove behavior. They are a specification, not a record.
