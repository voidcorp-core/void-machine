---
name: void-tdd
description: TDD in three modes (strict/souple/exploratory) chosen by path. Iron Law in strict (no prod code without a failing test), mutation gate if tooled, anti-rustine. Use for any feature, bugfix, refactor.
---

# tdd — voidcorp craftsman edition

Curated aggregate of the best TDD practices for the TypeScript/web stack 2026. Ported from the DECLIK `void-tdd` skill (377 LOC, already top-5%), adapted to be stack-agnostic via `.void/config.json`.

**Attribution**: see `.source` in this directory. Primary sources: DECLIK port (which itself distills superpowers/test-driven-development + citypaul/tdd + nizos/tdd-guard). This skill **does not reinvent**; it composes at the right level for void-machine consumers.

The companion hook `tdd-guard` (see `../../hooks/tdd-guard.sh`) materializes the structural floor at the Edit/Write level: a sibling test file or an explicitly declared E2E test file MUST exist before governed production code is edited. It does not run the suite, so the failing-first (RED) step stays the engineer's discipline.

For E2E coverage, put `// tdd-cover: e2e tests/e2e/route.spec.ts` on the production
file's first line. The literal project-relative path must name an existing regular
`.test`/`.spec` JS/TS file inside the physical project root. One valid declaration
satisfies the structural floor; malformed, misplaced or conflicting declarations
refuse. It does not prove the route is covered or the suite passed. Keep real
test evidence, and never use exploratory mode to mean "tested elsewhere".

---

## Modes

Three postures, chosen from the actual behavior and project configuration. Resolve routine mode selection from those facts; ask only when a material trade-off needs the user.

| Mode | When | Posture |
|---|---|---|
| **strict** | New behavior on production code, hotfix on paying surface, refactor that changes observable behavior, DB integration that affects business invariants | Iron Law (zero line of production code without a failing test that requested it) + mutation testing when the project has a mutation runner + behavior/risk coverage + observed RED/GREEN evidence |
| **souple** | Integration glue tested at a higher level (E2E + handler covers the chain), framework wiring, config | RED-GREEN-REFACTOR without mutation gate, project coverage thresholds, no commit-by-phase ritual |
| **exploratory** | Documented spike, throwaway POC, scripts marked as such, draft work | No TDD obligation. The file MUST declare throwaway status + deletion date in a header comment. If the code survives the spike, it transitions to strict before merging to prod. |

### Auto-detection heuristic

If no explicit `Mode:` marker is in the task or a file header comment, apply:

- Path matches `<config.paths.business>` and not in `<config.paths.spikes>` nor in `docs/` → **strict**
- Path matches `<config.paths.spikes>`, draft folder, or scaffolds → **exploratory**
- Path matches `<config.paths.serverActions>` (boundary HTTP / Server Action) AND the pure logic is in `services/` with strict tests → **souple** on the handler, **strict** on the service
- Otherwise → **souple** for wiring; **strict** for new behavior

Paths and commands come from `.void/config.json`. Explicit project requirements take precedence.

### Override

The user can impose a mode via:

- Prompt marker: "implement X in strict mode" / "spike in exploratory mode"
- File header comment: `// tdd-mode: strict`
- Repo-wide: `.void/config.json` → `{ "modes": { "tdd": "strict" } }`

---

## Iron Law (strict only)

```
ZERO LINE OF PRODUCTION CODE WITHOUT A FAILING TEST THAT REQUESTED IT.
```

**No exception without explicit permission.** Keep the spirit AND the letter — violating one violates both.

### If you wrote code before the test (strict)

Stop and report the missing RED evidence honestly. Reproduce the intended behavior against the
unchanged base before continuing; preserve unrelated work. Never fabricate test chronology or
claim a test that first passed on the implementation proved the missing behavior. The reviewer
must be able to inspect the actual failing test before the production behavior change.
---

## Cycle

### Strict mode

```
RED → Verify RED → GREEN → Verify GREEN → [MUTATE → KILL MUTANTS] → REFACTOR
```

The bracketed steps run only when the project has a mutation runner (see MUTATE below).

### Souple mode

```
RED → GREEN → REFACTOR (if it has value)
```

### Exploratory mode

```
Code → [does the demo prove the idea?] → either transition to strict before merge, or delete.
```

### RED — write the failing test

One thing tested, a name that states the behavior, real code — assert on the observable
outcome, never on a mock's call count (that tests the mock, not the behavior). Mocks live
only at infrastructure boundaries. The full technique (how to express the test, factories,
mocking policy) is the `void-testing` skill's job; TDD owns only *when* and *that* it fails first.

Before finalizing the test, scan the mutator rules (boundaries, boolean combinations, equality, arithmetic identities, array/string ops, optional chaining, side effects). This scan needs no tooling and no runner: it is how you write a test that a mutant could not survive, whether or not the project can actually run one.

### Verify RED — watch it fail

**Strict: mandatory. Never skip.**

```bash
<config.commands.testUnit> path/to/file.test.ts
```

Confirm:

- Test fails (not a syntax error)
- The failure message matches what you expect
- Fails because the feature is missing, not because of a typo

### GREEN — minimal code

```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) { if (i === 2) throw e; }
  }
  throw new Error('unreachable');
}
```

**No more.** No speculative configuration options. No refactor during GREEN.

### Verify GREEN

```bash
<config.commands.testUnit> path/to/file.test.ts
```

Confirm:

- Test passes
- Other tests still pass
- Pristine output (no warnings, no errors)

### MUTATE (strict, only when a mutation runner is present)

The harness ships no mutation runner and installs none. `init` detects Stryker in the project's
dependencies and writes `commands.mutation` into `.void/config.json` only on that signal, so the
presence of that key *is* the capability check.

- Key present → run `<config.commands.mutation> --mutate <path>`, produce a killed/survived/score
  report, and treat the gate as mandatory in strict.
- Key absent → the gate does not apply. Never invent a `stryker` command and never block the cycle
  on it; the mutator scan at RED carries the intent instead. Adopting a runner is a project
  decision, not something this skill performs.

### KILL MUTANTS (strict, when MUTATE ran)

For each survivor:

- If the case value is clear → add a test
- If ambiguous (business judgment) → ask the user via AskUserQuestion before patching

All tests must pass after fix.

### REFACTOR

After GREEN, make only the refactor needed to keep the changed code clear, correctly bounded
and free of relevant duplication. KISS and SOLID guide that judgment. Stop once the behavior,
applicable proofs and design contract hold; optional naming or extraction preferences do not
start an improvement loop. Keep tests green. `void-refactor` owns behavior-preserving changes.
---

## Stack glue

### Commands (read from `.void/config.json`)

- Unit: `<config.commands.testUnit>` (e.g. `bunx vitest run`, `pnpm vitest`, `npm test`)
- E2E: `<config.commands.testE2e>` (e.g. `bunx playwright test`)
- Mutation: `<config.commands.mutation>` (e.g. `bunx stryker run`) — absent when no mutation runner is detected
- Watch: `<config.commands.testWatch>` (e.g. `bunx vitest --watch`)

### Conventions

- Test files: `Name.test.ts` co-located with the source file
- Real-I/O integration tests: `Name.integration.test.ts`
- E2E Playwright: `<config.paths.e2e>` (e.g. `apps/*/tests/e2e/*.spec.ts`)

See the `void-testing` skill for the full technique catalog (factories over `beforeEach`, fixture externalization, behavior-first naming, snapshot policy).

### Schema contracts at trust boundaries

If you touch a schema in `<config.paths.contracts>` (Zod schemas at trust boundaries):

1. RED: add a `parse()` case that should fail (invalid data) or succeed (valid data)
2. GREEN: modify the schema
3. Verify: every downstream call site that consumes this type must compile AND pass its tests

The contract is the **single source of truth**, never redefined in tests.

### Frontend behavior (strict)

For a UI change, RED lives at the smallest observable surface: component, hook, store, accessibility
contract, or rendered state. Cover every applicable loading/empty/error/success/partial state named
by the pre-build experience brief. An interactive control needs a role-first keyboard regression
test before any E2E proof; E2E may confirm the journey but cannot be the first place a keyboard bug
is caught. Record passing test evidence against the current diff hash so a later UI edit invalidates
the proof instead of inheriting green.

### Anti-pattern detected too often

Mocking the DB or Server Actions to make a test pass: it breaks at the next refactor without
protecting anything. Prefer integration tests (pglite / dev DB branch) or invoking the action
directly. Full anti-mock-business rationale: the `void-testing` skill.

---

## Coverage (strict)

The project's configured coverage thresholds remain binding; never lower them to obtain green.
Cover the changed invariants, error paths and boundaries, including meaningful counterexamples.
Use coverage to find missing behavior, not to create assertions that only mirror implementation.
No universal percentage overrides the project's policy. If a branch is covered at a higher
level, cite that real proof rather than duplicate it. A safety-critical gap still blocks.

## TDD Evidence (strict)

Observe a failing test before changing production behavior. Keep the RED command and result
from before the implementation, why it failed, then the GREEN command and result after it.
Bind results to the tested source state and scope so later changes invalidate affected proofs.
Separate RED and GREEN commits are not required; keep final commits logical and bisectable.
A test file's existence, a skill read, or an arbitrary failed command is not RED evidence.

Record the actual runner result and relevant assertion, not a ritual checklist. Existing
project evidence storage is enough; no extra telemetry service or transcript export is required.
Missing evidence is unknown, never reconstructed from memory as an observed run.

---

## Anti-rustine integrated

If you are tempted to:

- Skip TDD "just this once"
- Mock everything to "make the test pass"
- Cast `as any` to avoid real modeling
- Add a test after the fact that passes immediately

→ Stop signal. Redesign the approach. Source: project-level "no rustine" rule.

A test that is hard to write = a design that is hard to use. The test is the API oracle.

---

## Red Flags (strict)

Source: superpowers/test-driven-development. Keep the full list — this is the anti-drift psychology.

- Code written before the test
- Test written after the implementation
- Test that passes immediately
- Cannot explain why the test failed
- Tests added "later"
- Rationalization "just this once"
- "I already tested it manually"
- "Tests after reach the same goal"
- "It is the spirit, not the ritual"
- "Keep as reference" / "adapt the existing code"
- "I already spent X hours, deleting is a waste"
- "TDD is dogmatic, I am pragmatic"
- "This case is different because..."

→ **Stop, identify the missing proof, and restore the test-first discipline without destroying unrelated work.**

---

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Too simple to test" | Simple code breaks. The test takes 30 seconds. |
| "I test afterward" | Tests that pass immediately prove nothing. |
| "Tests after reach the same goal" | After-tests answer "what does this code do." Before-tests answer "what should this code do." |
| "I tested it manually" | Manual ≠ systematic. No trace, not re-executable. |
| "X hours of work to delete = waste" | Sunk-cost fallacy. Keeping unverified code is debt. |
| "Keep as reference, write tests first" | You will adapt it. That is testing-after. Delete = delete. |
| "Need to explore first" | OK. Throw away the exploration, restart in strict. |
| "Hard to test = design not clear" | Listen to the test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD is faster than debugging in prod. Pragmatic = test-first. |
| "Manual is faster" | Manual does not prove edge cases. You will re-test on every change. |

---

## Verification checklist

Before marking the work complete:

- [ ] TDD mode identified at start (strict / souple / exploratory)
- [ ] Every line of production code has a test that requested it (strict)
- [ ] Watched every test fail before impl (strict)
- [ ] Every test fails for the right reason (feature missing, not typo)
- [ ] Minimal code to pass each test
- [ ] All tests pass
- [ ] Pristine output (no warnings, no errors)
- [ ] Tests use real code (mocks only where unavoidable)
- [ ] Edge cases and errors covered
- [ ] Mutation testing run + survivors handled (strict, when `commands.mutation` exists)
- [ ] Relevant behavior covered and configured coverage thresholds satisfied
- [ ] Actual RED-before-implementation and GREEN evidence retained (strict)
- [ ] Necessary refactoring complete; optional improvements do not reopen the cycle

A missing required proof must be resolved or reported; do not restart already-proven work.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Do not know how to test | Write the desired signature. Write the assertion first. Ask the user. |
| Test too complex | Design too complex. Simplify the API. |
| Must mock everything | Code too coupled. Use parameter injection (see `void-hexagonal-architecture` skill). |
| Huge test setup | Extract helpers. Still complex? Rethink the design. |
| Mode not obvious | Inspect the changed behavior and project policy; ask only about a material trade-off. |

---

## Debugging integration

Bug found? **Write a failing test that reproduces it before any fix.** Follow the TDD cycle of the applicable mode. The test proves the fix and prevents the regression.

Never fix a bug without a reproducing test.

See the `void-debug` skill for the upstream root-cause discipline.

---

## Final rule

```
Production code → a test exists and failed first (strict)
                → a test exists (souple)
                → the code is marked as throwaway (exploratory)
Otherwise       → this is not voidcorp tdd.
```

No exception without explicit permission from the human partner.
