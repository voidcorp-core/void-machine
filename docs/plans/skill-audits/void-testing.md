---
skill: testing
status: reviewed
strategy: distill
target_loc: 400
phase: B
depends_on: [tdd]
composes_with: [mutation-testing, typescript-strict, hexagonal-architecture, migrations]
matrix_row: plans/skill-decision-matrix.md#testing
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `testing`

## Need

Without `testing`, TDD's RED step lacks technique. An LLM agent writes tests that mock the world, balloon fixtures inline, invert the test pyramid (E2E for things a unit could prove), assert on implementation details, and name tests by function name not by behavior. The result: a suite that passes everything, proves nothing, breaks on every refactor, and gets ignored. `testing` codifies what makes a *good* test: real code over mocks, factories over `beforeEach`, behavior over implementation, pyramid respected, fixtures externalized.

## Decision matrix anchor

- **Wins**: how to express a test once you know what to test. Mocking strategy, fixture design, test pyramid placement, integration vs unit choice, naming conventions, assertion style
- **Loses to**: `tdd` on **when** to write the test (always: before, in strict mode). `migrations` on testing DB migrations specifically
- **Cannot decide**: whether a feature deserves a test (TDD's call: yes, always, in strict mode). Production architecture. Whether a test suite is "complete enough" (coverage rule lives in `tdd`)
- **Composes with**: `tdd` (provides the cycle), `mutation-testing` (validates the test quality)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Kent C. Dodds "Common Testing Mistakes" + Testing Library philosophy | https://kentcdodds.com/blog/common-mistakes-with-react-testing-library | reviewed | kept (test behavior not implementation, query by accessible role, no testing internals) |
| James Shore "Testing Without Mocks" (Art of Agile Development 2nd ed.) | https://www.jamesshore.com/v2/books/aoad2/testing_without_mocks | reviewed | kept (sociable tests, infrastructure wrappers, nullable infrastructure pattern) |
| Martin Fowler "Mocks Aren't Stubs" | https://martinfowler.com/articles/mocksArentStubs.html | foundation | reference (terminology baseline: dummy / stub / spy / mock / fake) |
| citypaul testing notes | citypaul/.dotfiles | reviewed | partially kept (pyramid ratios, fixture externalization) |
| superpowers test patterns | superpowers/skills | reviewed | partially kept (verify-test-fails-for-right-reason, pristine output) |
| Vitest docs | https://vitest.dev | reference | tactical specifics live in `pack-monorepo` |
| Playwright docs | https://playwright.dev/docs/test-fixtures, https://playwright.dev/docs/test-parallel, https://playwright.dev/docs/auth | reviewed | kept (isolated fixtures, worker identities, authentication state); tactical specifics live in packs |
| Next.js CLI | https://nextjs.org/docs/app/api-reference/cli/next | reviewed | kept (build once, then start the production artifact; deployment adapters must prove their own artifact) |
| Better Auth rate limit | https://better-auth.com/docs/concepts/rate-limit | reviewed | kept (production defaults, client/server distinction, 429 proof; test setup must not disable the control) |
| MSW (Mock Service Worker) | https://mswjs.io | reviewed | kept as the recommended HTTP boundary mocking layer (not the default for unit tests — only for integration tests that cross HTTP) |
| pglite | https://pglite.dev | reviewed | kept as the in-memory Postgres for fast integration tests against Drizzle |

## Adaptation strategy

`distill`. Core skill is framework-agnostic; framework specifics (Vitest config patterns, Playwright fixtures, MSW handlers) live in `pack-monorepo` and `pack-nextjs-pwa`. The skill's job is the discipline: what makes a good test, what makes a bad one, how to choose between unit / integration / E2E.

## What we keep (verbatim or near-verbatim)

- **Test the behavior, not the implementation** (Dodds): assertions describe what the user / consumer observes, not which private methods were called. For UI: query by accessible role / label, not by class / data-testid (data-testid is the escape hatch, not the default).
- **Sociable tests over solitary tests** (Shore): default to letting collaborators run in the test. Only mock at infrastructure boundaries (HTTP, DB, filesystem, time, randomness). Mocking a collaborator that does pure computation is a code smell.
- **Nullable infrastructure pattern** (Shore): for the infrastructure that you DO need to mock, the wrapper exposes a `createNull()` variant that returns deterministic / empty results. No mocking library invocation; the constructor handles it. This is testable AND production-typed.
- **Pristine output** (superpowers): after a test passes, the output is clean. No warnings, no `console.log` from production code, no leaked unhandled rejections. Pristine output is a passing condition, not a nice-to-have.
- **One assertion intent per test** (textbook): multiple `expect` lines OK if they all assert the same behavior (e.g., "the result has the right shape AND the side effect happened"). Multiple unrelated assertions = split into two tests.
- **Test pyramid ratios** (Cohn / citypaul): ~70% unit (pure, fast), ~20% integration (with real infrastructure via pglite / MSW), ~10% E2E (Playwright on critical user paths). The numbers are a heuristic, not a quota.

## What we adapt

- **Mocking strategy — real code first, MSW at HTTP boundary, pglite at DB boundary, `vi.useFakeTimers()` at time boundary**: textbook becomes our specific tooling choice. Why: a generic "don't mock" leaves the reader without a path; the concrete tooling is the path.
- **Naming convention — describe the behavior**: `"retries failed operations 3 times"` over `"test retry"` over `"retryOperation should work"`. Adapted by adding a hook (`test-name-lint`) that warns on weak patterns (`test\("(test|works|should)\b`). Why: a rule without enforcement decays.
- **Factories > `beforeEach`**: factory functions returning test data (with sensible defaults + overrides). `beforeEach` reserved for environment setup (mount DOM, reset DB, install fake timers). Why: factories localize the data shape per test, `beforeEach` shares hidden state across tests.
- **Fixtures externalized when > 5 lines**: inline if smaller, in `tests/fixtures/<name>.ts` if larger. Each fixture has a factory function (e.g., `makeUser(overrides?)`). Why: large inline fixtures bury the test intent under data noise.
- **Verify-RED gate borrowed from `tdd`**: even in `souple` mode, the first run of a new test should fail; if it passes immediately, the test is wrong (it asserts something already true). Adapted as a soft-rule reminder in the SKILL.md.

## What we reject

- **Snapshot testing as a default**: rejected. Banned-by-default, allowed only for UI regression with documented exception (component visual snapshot + reviewed updates). Why: snapshots devolve into "update on green" — the test passes regardless of correctness.
- **Test names like "should X"**: rejected. The "should" is grammatical fluff. `it('retries 3 times')` over `it('should retry 3 times')`. Why: terser names line up better, the "should" is implied.
- **`expect(spy).toHaveBeenCalledWith(...)` as primary assertion for business logic**: rejected. That tests the implementation (which collaborator was called), not the behavior. Spies are for "did the side effect happen" only at infrastructure boundaries. Why: implementation-coupled tests break on refactor, providing pain without protection.
- **`describe.each` / `it.each` for parametric tests that are actually different scenarios**: rejected for unrelated cases (a 5-row table that tests 5 different behaviors with shared scaffolding hides the differences). Kept for genuinely parametric tests (boundary values, equivalence classes). Why: parametric tests are a tool, not a structure.
- **Inline `mock(...)` of DB modules in business-layer tests**: rejected. Use pglite or Neon dev branch. Composes with `tdd` anti-mock-DB anti-pattern. Why: mocking the ORM breaks at every Drizzle upgrade or schema change while protecting nothing real.

## Hard rules surfaced by this skill

- **Test names describe behavior, not function name**. Enforced by: SKILL.md guidance + `test-name-lint` hook (warns on weak patterns).
- **No mocking of business collaborators**. Only infrastructure (HTTP, DB, FS, time, random). Enforced by: SKILL.md + `no-business-mock` hook (warn on `vi.mock('@/services/...')` patterns).
- **No `console.log` / leaked unhandled rejections in test output**. Pristine output is a passing condition. Enforced by: `vitest.config` strict mode + skill guidance.
- **`.only` / `fdescribe` / `xit` / `.skip` banned from committed code**. Enforced by: `no-only-no-skip` hook (block on detection in staged diff).
- **Fixtures > 5 lines live in `tests/fixtures/`**. Enforced by: SKILL.md + `code-review` skill flags inline-fixture bloat.
- **Snapshot tests forbidden by default**. Allowed for UI with documented exception. Enforced by: `no-snapshot-default` hook (warn).
- **Integration tests against DB use pglite or Neon dev branch, not mocks**. Enforced by: SKILL.md + `tdd` anti-mock-DB rule.

## Modes — none

Within a TDD mode (`strict` / `souple` / `exploratory`), the `testing` discipline applies uniformly. The cycle decides whether a test is required; this skill decides what makes the test good.

## Companion hooks

- **`no-only-no-skip`** (pre-commit) — fail if `.only` / `fdescribe` / `xit` appears in staged diff (allowed in `**/__skip-on-purpose__/**` whitelist, used rarely with a justifying comment). ≤ 30 LOC.
- **`test-name-lint`** (pre-commit) — warn (do not block) on weak test names matching `/\b(test|works|should)\b/i` as the entirety of the test name. ≤ 30 LOC.
- **`no-business-mock`** (pre-commit) — warn on `vi.mock\('@/(services|domain)/...'\)` patterns. False positives expected, hence warn. ≤ 40 LOC.
- **`no-snapshot-default`** (pre-commit) — warn on new `.toMatchSnapshot()` / `.toMatchInlineSnapshot()` outside `**/__visual__/**` whitelist. ≤ 30 LOC.

## Composition with other skills

- **With `tdd`**: `tdd` provides the cycle (when), `testing` provides the technique (how). The cycle's RED step delegates the *how* of writing the test to this skill.
- **With `mutation-testing`**: a high-mutation-survivor rate is a `testing` signal — the tests are not asserting on the right things. The MUTATE step delegates to the mutation-testing skill; the KILL step iterates back here.
- **With `typescript-strict`**: tests use the same branded types as production. A test that needs `as any` to construct a fixture is signaling either a missing factory or a brittle type.
- **With `hexagonal-architecture`**: ports are tested with nullable infrastructure (Shore pattern). Unit tests against ports use in-memory adapters owned by the domain.
- **With `migrations`**: DB migrations are tested via Neon dev branch + integration tests, not via `testing`'s default unit/integration patterns (different concern, dedicated skill).

## Anti-rules (what this skill MUST NOT do)

- MUST NOT decide WHETHER a test exists. That's `tdd`'s Iron Law in strict mode (yes, always).
- MUST NOT decide test coverage thresholds. That's `tdd`'s 100%-on-business-layer default + documented exceptions.
- MUST NOT decide architecture (what's a port, what's an adapter). Hexagonal owns that.
- MUST NOT decide framework specifics (which Vitest reporter, Playwright trace mode). Those are pack-level config.
- MUST NOT silently allow snapshot creep. Each snapshot test is an exception that needs a reason.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 400 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions "behavior over implementation, real code over mocks, pyramid respected" as headline
- [ ] `.source` file lists Dodds + Shore + Fowler + citypaul + superpowers + MSW + pglite
- [ ] Hooks drafted: `no-only-no-skip`, `test-name-lint`, `no-business-mock`, `no-snapshot-default` — each ≤ 100 LOC, smoke-tested
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/testing/` cover: weak test name detection, snapshot default rejection, business-mock detection, factory pattern recognition
- [ ] No overlap > 30% with `tdd` (this skill = technique; tdd = cycle + when)
- [ ] No overlap > 30% with `mutation-testing` (this skill = how to write good tests; mutation = how to verify the tests are good)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## DEV-444 frontend adaptation

- Kept test technique here while TDD retains cycle and timing ownership.
- Added role-first keyboard input and explicit applicable-state coverage at component/hook/store boundaries.
- Rejected E2E as a substitute for the focused regression that identifies a broken interaction contract.

## Open questions

- **Snapshot whitelist mechanism**: `**/__visual__/**` directory convention vs `// allow-snapshot: <reason>` magic comment. Lean directory convention (simpler enforcement, harder to abuse).
- **MSW handlers location**: per-test inline vs shared in `tests/msw/handlers.ts`. Lean shared with per-test override pattern.
- **pglite for unit-of-work tests**: when does pglite become slower than a stubbed repository? Heuristic: < 1s per test = pglite OK; > 1s = consider stub. Refine after first 50 real tests.
- **E2E selector strategy**: `getByRole` (recommended Playwright) vs `data-testid`. Lean role-first; testid as escape hatch with explicit code-review approval.
- **Coverage tool default**: vitest v8 vs c8 vs istanbul. Lean vitest v8 in `pack-monorepo`. Document the choice with rationale.
- **Test pyramid actual ratios for solopreneur scale**: the 70/20/10 split assumes a team. For a solo dev with strong types and good design, 50/40/10 might be more accurate (integration tests buy more confidence per unit of effort). Defer to first 6 months of data.

## 2026-10-23: proportional delivery

Align the existing standard with the owning workflow, preserving its technical protection while
removing repeated or pattern-only obligations. See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
