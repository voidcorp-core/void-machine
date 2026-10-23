---
skill: tdd
status: draft
strategy: port-DECLIK
target_loc: 400
phase: B
depends_on: [testing, refactor, mutation-testing]
composes_with: [typescript-strict, code-review, verify]
matrix_row: plans/skill-decision-matrix.md#tdd
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `tdd`

## Need

Without an enforced TDD discipline, an LLM-driven agent will write production code first and rationalize tests afterward. Tests-after answer "what does this code do" (a tautology), not "what should this code do" (a specification). The result: code passes its tests, ships, fails on edge cases none of its tests covered because none of them were ever written to fail.

`tdd` exists to make tests-first the default and to declare the legitimate exceptions explicitly (refactor, deletion, config, fixtures, migrations, spikes, codemods, type-only, doc-only, generated). Without this skill, every project re-litigates "should we TDD this?" — and the answer drifts.

## Decision matrix anchor

From `plans/skill-decision-matrix.md`:

- **Wins**: any implementation of new behavior, bugfix, refactor that changes observable behavior
- **Loses to**: `refactor` for pure refactor mode (no behavior change). `migrations` for DB migration mechanics.
- **Cannot decide**: what the production code architecture should be (defers to `hexagonal-architecture`, `domain-driven-design`); naming (defers to `typescript-strict`); test ergonomics within a framework (defers to `testing`).
- **Composes with**: `testing` (TDD provides the cycle, testing provides the technique), `refactor` (R of RED-GREEN-REFACTOR delegates here).

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| DECLIK `.claude/skills/tdd/SKILL.md` | `/Users/folpe/Developer/DECLIK/.claude/skills/tdd/SKILL.md` | read in full (377 LOC) | **kept as primary base**. Already top-5%: 3 modes contextual auto-detected, Iron Law preserved, Verify RED gate, mutation gate in strict, anti-mock dogmatism, coverage 100% with documented exceptions, evidence in commit history, Red Flags + Common Rationalizations exhaustive |
| superpowers/test-driven-development | `~/.claude/plugins/.../superpowers/.../skills/test-driven-development/` | already integrated into DECLIK SKILL (Red Flags + Rationalizations preserved with attribution) | rejected as standalone source; its content already lives in DECLIK port |
| citypaul/tdd | citypaul/.dotfiles `claude/.claude/...` | reviewed (via README + plans/ in citypaul repo) | partially kept: TDD Evidence in commit history pattern is excellent and already in DECLIK port |
| nizos/tdd-guard | https://github.com/nizos/tdd-guard | reviewed (2.2k stars, 78 releases) | **kept as companion hook**, NOT a skill. Materializes the Iron Law at the Edit/Write level. Multi-framework support matches our needs (Vitest, Jest, pytest, Playwright) |
| Kent Beck "Test-Driven Development: By Example" (2002) | (book) | known | foundation; informs the cycle definition |
| morodomi/tdd-skills 7-phase pipeline | https://github.com/morodomi/tdd-skills | reviewed | rejected: too rigid (INIT → PLAN → RED → GREEN → REFACTOR → REVIEW → COMMIT enforces phase-by-phase commits which conflicts with DECLIK's "evidence in commit history without forced phase boundaries" stance) |

## Adaptation strategy

**`port-DECLIK`**. The DECLIK SKILL.md (377 LOC) is at our target quality bar. Three minimal adaptations make it stack-agnostic within the TypeScript/web baseline:

1. **Paths hardcoded → read from `voidcorp.config.json`**. DECLIK currently expects `apps/*/src/**`, `apps/*/scripts/spike-*`, `apps/*/src/app/(api|actions)/**`. Replace with `config.paths.src`, `config.paths.spikes`, `config.paths.serverActions` (consumer-defined, defaults provided per pack).
2. **Commands hardcoded → read from `voidcorp.config.json`**. Replace `bunx vitest`, `bunx playwright`, `bunx stryker` with `config.commands.testUnit`, `config.commands.testE2e`, `config.commands.mutation` (consumer-defined, sensible defaults: `vitest` / `playwright` / `stryker`).
3. **DECLIK-specific references moved to `pack-monorepo` extension**. The references `@repo/core/logger` (forbidden console.log), `src/lib/contracts.ts` Zod contracts path, the 5+5 service layout — all stack-specific. They move to a `pack-monorepo` extension fragment that the consumer optionally includes.

Total adapted lines: estimated ≤ 30. Functional equivalence preserved.

## What we keep (verbatim or near-verbatim)

- **Three modes**: `strict` / `souple` / `exploratory` with auto-detection by path + override via marker / `.claude/mode.json` / explicit prompt
- **Iron Law in strict mode**: "Zero line of production code without a failing test that requested it" (originally phrased in French as "Zero ligne de prod sans un test failant qui l'a demandee" in the DECLIK source; translated here as the canonical English form)
- **Cycle**:
  - strict: `RED → Verify RED → GREEN → Verify GREEN → MUTATE → KILL MUTANTS → REFACTOR`
  - souple: `RED → GREEN → REFACTOR (if value)`
  - exploratory: declared throwaway, basculates to strict before merge or gets deleted
- **Verify RED gate**: mandatory in strict — confirm the test fails for the right reason (feature missing, not syntax typo)
- **Anti-mock dogmatism**: "Tests that mock the DB → prefer pglite or dev DB branch. Mocking the DB breaks at next refactor without protecting anything." Translated verbatim, applies to any ORM (Drizzle, Prisma).
- **Coverage 100% default on business layer (services + domain) in strict** with documented exceptions process
- **TDD Evidence in commit history** — commit log shows `RED → GREEN → [MUTATE → KILL] → REFACTOR` progression, or a documented exception in the PR body
- **Red Flags list** (all 14 from DECLIK port) — kept verbatim, anti-drift psychology
- **Common Rationalizations table** (all 10 rows) — kept verbatim
- **Verification checklist** (13 items) — kept verbatim
- **"When you are blocked" table** — kept verbatim
- **Final rule statement** — kept verbatim, modes labeled

## What we adapt

- **Path / command parameterization**: see strategy section above. Why: the skill must work for any consumer in the TypeScript/web stack, not just DECLIK's specific layout.
- **Companion hook reference**: DECLIK SKILL doesn't yet mention `tdd-guard` as the mechanical enforcer. We add a short "Companion hook" section pointing to `packages/core/claude/hooks/tdd-guard.sh` and listing the legitimate bypasses (Section 0bis.3 of the design spec).
- **Cross-skill references**: DECLIK refers to `mutation-testing`, `refactor`, `hexagonal-architecture` skills. Keep the references but adjust paths to `voidcorp:mutation-testing` etc. and ensure those skills exist in our core.
- **Language**: translate the French phrasings (Iron Law motto, mode names, etc.) to English while preserving the doctrine. Mode names: keep `strict` / `souple` / `exploratory` — `souple` is more precise than its English equivalent ("flexible" loses the implication of "less rigorous but still disciplined"). Flag `souple` as a borrowed French technical term in the prologue.

## What we reject

- **morodomi 7-phase forced commit boundary**: rejected. Phases are useful as mental cycle, not as commit gate. DECLIK's "evidence in history without forced phase boundaries" is more pragmatic for solo / pair work.
- **superpowers/test-driven-development as standalone**: rejected as separate skill. Its content (Iron Law, Red Flags, Rationalizations) is preserved in the DECLIK port with attribution. Two skills covering the same ground violates the anti-bloat overlap rule.
- **mutation testing inline**: rejected. The cycle references mutation as a phase, but the *how* of mutation testing (Stryker config, mutator selection, killing strategy) lives in its own `mutation-testing` skill. Keeps `tdd` under target LOC.

## Hard rules surfaced by this skill

- **In strict mode, no production code lands without a failing test that requested it**. Enforced by: SKILL.md doctrine + `tdd-guard` hook (PreToolUse) + `code-review` skill checks evidence in diff
- **In strict mode, every test is observed failing before any production code is written**. Enforced by: SKILL.md "Verify RED" section + cycle definition
- **In strict mode, mutation testing runs after GREEN**. Survivors are either fixed (add test) or escalated (judgment call). Enforced by: SKILL.md + `mutation-testing` skill composition
- **In strict mode, 100% coverage on business layer is the default**. Exceptions documented in `README.md` of the package + `CLAUDE.md` exception list. Enforced by: SKILL.md + CI coverage report (pack-specific)
- **No mocking of DB / Server Actions for business logic tests**. Use pglite, dev DB branch, or invoke directly. Enforced by: SKILL.md anti-pattern section + `testing` skill

## Modes

| Mode | Trigger | Enforcement level |
|---|---|---|
| `strict` | New business logic, hotfix on payment surface, refactor that changes payment behavior. Auto-detected if path matches `config.paths.business` (default: `apps/*/src/**`) AND not in `config.paths.spikes`. Override via `// tdd-mode: strict` or `.claude/mode.json`. | Iron Law + Verify RED + Mutation + 100% coverage + Evidence trail |
| `souple` | Glue code at integration boundary covered by higher-level test (E2E route handler covers the chain). Auto-detected if path matches `config.paths.serverActions` AND the underlying service has its own strict tests. | RED → GREEN → REFACTOR. No mutation gate. 80% min coverage on business code. No commit phase rituals. |
| `exploratory` | Spike, POC, throwaway script. Auto-detected if path matches `config.paths.spikes` (default: `apps/*/scripts/spike-*`) OR file has `// tdd-mode: exploratory` header. | No TDD obligation. File MUST declare throwaway status + deletion date in header comment. If it survives the spike, it basculates to strict before any prod merge. |

**Auto-detection precedence**: file header marker > `.claude/mode.json` repo-wide > path heuristic > `souple` default (with "ask user" prompt if ambiguous).

## Companion hooks

- `tdd-guard` (PreToolUse on Edit / Write) — see `packages/core/claude/hooks/tdd-guard.sh`. Blocks edits to production paths (`config.paths.business`) when no corresponding `*.test.ts` change is staged AND no bypass applies (config / fixture / migration / spike / type-only / doc-only / generated / pure deletion — see Section 0bis.3 of the design spec). In `souple` mode, warns instead of blocks. In `exploratory` mode, no-op.

## Composition with other skills

- **With `testing`**: `tdd` provides the cycle (when to write), `testing` provides the technique (how to write a good test, fixture strategy, mocking decisions, test pyramid). The cycle's RED step delegates the *how* to `testing`.
- **With `refactor`**: the R step of the cycle is delegated. `refactor` decides when and how; `tdd` ensures the R step doesn't change behavior (tests must stay green).
- **With `mutation-testing`**: the MUTATE step is delegated. `tdd` triggers, `mutation-testing` runs Stryker and produces the report.
- **With `hexagonal-architecture` / `domain-driven-design`**: `tdd` covers the cycle, the architecture skills cover what the cycle is producing. If a test is hard to write, that's a `tdd` signal — but the redesign defers to the architecture skills.
- **With `code-review`**: `code-review` verifies the cycle was respected (evidence in commit history, or documented exception). It does not re-litigate the test choices.

## Anti-rules (what this skill MUST NOT do)

- MUST NOT decide the production code architecture. Hexagonal vs layered vs functional core is `hexagonal-architecture` and `functional`'s call.
- MUST NOT decide naming. Variable / function / type naming is `typescript-strict`'s call.
- MUST NOT decide test ergonomics inside a framework (which `describe` style, fixture format). That's `testing`.
- MUST NOT silently allow skipped TDD without an explicit mode change and a recorded reason. "Just this once" is a Red Flag → delete and restart.
- MUST NOT pretend to know whether a refactor is worth doing. That's the user's taste call; `refactor` surfaces options.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at ≤ 400 LOC (currently DECLIK source = 377, target ≤ 400 after adaptations)
- [ ] Frontmatter `description` ≤ 200 chars
- [ ] `.source` file lists DECLIK port + superpowers + citypaul + nizos + Beck book
- [ ] `tdd-guard` hook drafted at ≤ 100 LOC with the 10 bypass cases tested
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/tdd/` cover at least: strict mode auto-detect, souple mode auto-detect, exploratory header marker, override via `.claude/mode.json`, bypass for config file edit, bypass for pure deletion
- [ ] No overlap > 30% with `testing`, `refactor`, `mutation-testing` (each owns a distinct part of the cycle)
- [ ] Sister-doc parity: AGENTS.md flavor of `tdd` matches CLAUDE.md flavor (terminology adjusted, doctrine identical)
- [ ] Audit note status moved from `draft` → `reviewed` after user review

## DEV-444 frontend adaptation

- Kept TDD's ownership to sequence and proof timing; `testing` still owns test technique.
- Added focused component/hook/store/a11y/state RED and keyboard-before-E2E evidence tied to the current diff.
- Rejected E2E-only frontend proof because it catches interaction regressions too late and too broadly.

## Open questions

- **Stack-agnostic command resolution**: should `voidcorp.config.json` expose primitive commands (`test`, `e2e`, `mutation`) or composed commands (`test:unit`, `test:integration`, `test:e2e`)? Lean toward primitive + the skill composes — but defer to first real consumer.
- **Coverage tool**: vitest's built-in v8 vs c8 vs istanbul. Strict mode's 100% target needs a reliable measurement. Default to vitest v8 in pack-nextjs-pwa, document the choice.
- **Mode persistence across sessions**: should `souple` once chosen carry over to the next session in the same file? Probably yes via `.claude/mode.json` per-file map. Open.
- **Interaction with `mutation-testing` skill**: where does the Stryker config live? Suggest `pack-monorepo` provides a default `stryker.conf.json` + the `mutation-testing` skill documents per-package overrides.
- **`souple` as English term**: confirm with user that we keep the French word as a technical term. Alternative `lenient` loses the implication of "still disciplined, less ritualized" that `souple` captures.

## 2026-10-23: proportional delivery

Preserve the source principles while removing repeated approvals, proof duplication and optional
improvement loops; the owning boundaries and retained safeguards are recorded in
[Proportional delivery](../../PROPORTIONAL-DELIVERY.md). Actual TDD and required checks remain.
