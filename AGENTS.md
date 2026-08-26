# AGENTS.md — void-harness

<!-- void-harness:begin -->

## void-harness (managed by `void-harness init`)

Codex doctrine active in this project:

- `void` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)

### Doctrine — read at the start of every session

- `.void/installed/PHILOSOPHY.md`
- `.void/PROJECT-DOCTRINE.md`

`PHILOSOPHY.md` is the universal void-harness doctrine (managed — overwritten on init). `PROJECT-DOCTRINE.md` holds project-specific rules: context, ADRs, in-flight decisions (created once, never overwritten by init).

To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The `void-learn` workflow classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.

Every skill is invoked by its name: `$void-implement`, `$void-tdd`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.

### Program — when present

If `.void/program.md` exists with `status: executing`, read it and its linked plan/spec before choosing implementation work. The programme holds global context; the local checkpoint holds session residue, and `ResumeBundle` composes both with Git. On a continue/start/resume request without a named work unit, use the declared progress provider: recover the scoped unit if exactly one is started; if several are started, stop and surface the competing claims; otherwise select the first ready unit from the declared order and native blocker relations. Fetch the complete unit before running `void-implement`. The declared progress provider owns mutable execution state; the program and checkpoint never store a current or next unit. If the provider or a required capability is unavailable, do not infer remote progress; stop the action that needs it. If no progress provider is declared, require a specific unit instead of selecting one. A specific user request overrides selection; human gates and merges remain human. The file's `autopilot` block carries consent to autonomous execution and is never inferred: `enabled: false`, an absent block, or an unreadable one forbids autonomous selection entirely.

Run `void-harness doctor` to verify the install.

<!-- void-harness:end -->

> **Sister doc**: `CLAUDE.md` is the Claude Code-flavored mirror of this file. The two are maintained in sync — any change to one MUST be reflected in the other in the same commit. CI enforces this on every push (`pnpm sync:docs`, which compares section headings after terminology normalization); the pre-commit hook in `.githooks/` refuses a commit that stages one sister doc without the other, and `pnpm install` wires it through the root `prepare` script so a fresh clone inherits the check instead of having to opt in. Adapted terminology only (Codex/tools ↔ Claude/Skill tool); the doctrine is identical.

You are working inside the **void-harness** repo itself — the meta-repo that produces the harness (Codex + Claude Code) for every VoidCorp project. This file governs work **on the harness**, not work on projects that consume it.

## What this repo is

A **public, MIT** harness installed free and account-free via `npx voidharness` (the npm package is the primary channel; the voidcorp marketplace is self-hosted in this repo — `.claude-plugin/marketplace.json` lists every plugin as a local subdirectory — as an optional secondary channel; see `docs/DECISIONS.md`). It injects opinionated agent configuration into any project:

- **Core** (`packages/core/`) — universal craftsman skills, agents, hooks, AGENTS.md / CLAUDE.md modules
- **Packs** (`packages/packs/*`) — stack-specific add-ons activated per project
- **CLI** (`packages/cli/`) — install / add / update / doctor commands

## Read before writing

1. `README.md` — vision + target architecture
2. `docs/PHILOSOPHY.md` — three pillars (safety / performance / DX) + sources
3. `docs/ARCHITECTURE.md` — package boundaries + dependency direction
4. `docs/specs/` and `docs/plans/` — approved designs, and how each was executed

## Program bootstrap

`.void/program.md` is the durable global programme descriptor when it exists with
`status: executing`. Before choosing implementation work, read its global plan and spec.
`ResumeBundle` composes that context with the local checkpoint and Git.

If the user asks to continue, start, or resume without naming a work unit:

1. use the declared progress adapter and recover exactly one already-started scoped unit;
2. if several units are started, stop and surface the competing claims;
3. otherwise select the first ready unit from the declared order and native blocker relations;
4. fetch the complete provider-native unit and relations before running `void-implement`;
5. keep mutable provider state and review evidence current when the adapter supports them.

The declared provider owns mutable progress. The programme and checkpoint never store a current or
next unit. If no provider is declared, require a specific unit; if a required capability is
unavailable, stop that action rather than infer remote progress. A specific user request overrides
automatic selection. Human gates and merges remain human.

## Anti-bloat discipline

Eight hard rules. **Any PR violating these is blocked.**

1. **≤ 400 lines per skill.** No exception. If you need more, split.
2. **One skill = one subject.** A skill that talks about TDD AND mutation testing splits into two.
3. **No responsibility overlap > 30%** between two skills. If detected, fuse or clarify boundary.
4. **Discovery `description` hard cap 500 chars; editorial target ≤ 250**, for skills and agents. Exceeding the target alone is non-blocking; use 251–500 only for triggers, synonyms, or exclusions that improve selection. Procedure stays in the body.
5. **Hooks ≤ 100 lines**, shell or simple TS. No DSL maison, no framework. Shared logic goes in a sourced, `_`-prefixed hook library (e.g. `hooks/_hooklib.sh`), which is exempt from the per-hook cap.
6. **Agents have an explicit scope**. `doctrine-critic` judges code against doctrine — it does not also do QA, design, or shipping (those are their own skills/workflows).
7. **Skill tests pass in CI.** A broken skill blocks the release.
8. **Every skill this harness ships is named `void-<what someone would type>`**, and its frontmatter declares which grammar applies to the part after the prefix. `kind: action` takes the bare verb (`void-plan`, `void-verify`, `void-implement`); `kind: standard` takes the subject it governs (`void-tdd`, `void-observability`, `void-accessibility`). The prefix is not decoration: a runtime resolves skills from several providers, a bare name is a claim on a common word, and the level this harness installs into loses every collision it enters — silently. See the decision on prefixing every shipped skill. Agents, which live apart, take a person you could hire (`solution-architect`, `doctrine-critic`). No gerund on an action, no agent-noun for a mechanism (`-writer`, `-runner`), no filler suffix (`-workflow`, `-management`, `-first`). Enforced by `scripts/anti-bloat-check.sh`, and every reference is proven to resolve by `pnpm skills:check-references`. **Renaming a skill starts at `docs/SKILL-REFERENCES.md`** — the generated register of every place code names a skill, plus every `void-` name that is machinery rather than a skill. It is not maintained by hand: `pnpm derive` regenerates it, `pnpm derive:check` fails when it is stale, and the same script refuses any `void-` token or any `skills/<name>/SKILL.md` path that resolves to nothing. A probe naming the `tdd` directory survived the prefix pass and made `init` report sixteen missing native specialists, which is nowhere near the cause; that class of failure is now a red build. That name has exactly one owner: a runtime answers `/<name>` from `skills/<name>/SKILL.md` and from `commands/<name>.md` alike, so a name defined in both is offered twice with two descriptions that drift apart — a command that only restates a skill is deleted, not renamed.

## Sourcing discipline (no verbatim vendoring)

Core skills are **distilled and adapted** from external sources (superpowers, citypaul, TigerStyle, etc.) — never copied verbatim. Verbatim vendoring was rejected: it freezes upstream bugs and creates a fork burden.

For each skill:

- Read the source, extract the load-bearing principles ("why it works")
- Rewrite for void-harness, removing what doesn't fit, adding what's missing
- Add a `.source` file next to the skill listing inspirations + URLs
- Document the specific adaptations and rejections in `docs/plans/skill-audits/<skill-name>.md` (one audit note per skill)
- **Never reinvent without justified improvement.** YAGNI applies hardest here.

A skill that ends up 95% the same as its source remains valuable as "voidcorp's deliberately authored version" — but it was rewritten, not pasted.

## Hard rules for any code added to this repo

- Match file naming exactly per convention (`Name.ts`, `Name.test.ts`, etc.)
- Pure helpers: no I/O, no side effects
- No `console.log` in committed code — use the project logger
- No em dashes or emojis as AI-slop filler. Both are allowed where they carry meaning (typographic separators in prose, glyphs in code such as the render layer); just do not sprinkle them decoratively. Not a hard CI gate.
- Read the official documentation of any third-party tool **before** writing its config
- Conventional commits, every message ends with **why**, not just **what**
- A build reads only versioned files. A script named `build-*` or `prepare-*` must never reach for `.void/`, the home directory, or the clock: a published artefact that differs by who compiled it carries their state to everyone. Enforced by `test/builders/inputs-are-versioned.test.ts`

## This repo consumes its own output

void-harness is installed **in void-harness**, through the same `npx voidharness init` a consumer runs. The enforcement floor that guards a customer project guards this one: write a secret, a `console.log`, an `any` or a `null` here and the write is refused, exactly as it would be in their repo.

What is active here is the **published** harness, not the working tree. That distinction is the whole safety of the arrangement: a rule broken while being developed cannot lock the repo it is being developed in. `.void/hooks/` therefore carries a released bundle, deliberately different from `packages/core/hooks/`, and is committed so a fresh clone — or an autopilot worktree — inherits the floor rather than silently losing it. `.codex/hooks.json` is committed for the same reason.

This is separate from `void-harness self-host sync`, which compiles the **current sources** into an isolated artifact under `.void/machine/generated/` and never wires the repo root (see `docs/ARCHITECTURE.md`, "Source self-host boundary"). Two different questions: self-host asks *do the sources still compile into a working harness*, the install asks *does the shipped harness hold while we work*.

Before this, the floor ran in every consumer project and in none of ours — which is why two NUL bytes reached committed source on 2026-08-06 through a mechanism that was working the whole time, just not connected here.

## Meta-rules

- Any new convention added in a commit MUST be reflected in `docs/*.md` in the same commit
- Any non-obvious decision (where a credible alternative exists) MUST be created as its own collision-free file with `void-harness decisions new`; accepted decision content is immutable and changes supersede it. The only in-place exception is a bounded repository-local reference migration whose surrounding text is unchanged and whose new target exists inside the repository. Accepted files are never deleted or renamed. `docs/DECISIONS.md` is a frozen legacy landing page, never a worker-owned artifact; `pnpm decisions:check` gates structure and immutability.
- Removed concepts must be removed from the docs at the same time
- Tests run via `pnpm test`; do not skip TDD when adding logic
- Versions are never hand-edited: release-please bumps every manifest in lockstep from Conventional Commits, and `pnpm version:check` fails CI on any drift (see `docs/RELEASING.md`)

## Tool routing inside this repo

| Task | Tool / Pattern |
|---|---|
| Brainstorming the next feature | `void-brainstorm` skill (loads natively in Codex) |
| Writing a plan | `void-plan` skill |
| Reviewing a written plan (pre-execution) | `void-plan-review` skill (lenses CEO/Eng/Design/DevEx, or `all`) |
| Implementing a ticket / feature | `void-implement` skill (one unit, ready→shipped: TDD, UX, security, review, verify) |
| Decomposing work into tickets | `void-ticket` skill |
| Draining independent tickets in parallel | `void-autopilot` skill (cluster → worktree workers → one integration PR you merge) |
| Adding a skill | Author the SKILL.md by hand, run skill-test suite in `test/`; the naming rule applies: `kind: action` takes the bare verb, `kind: standard` the subject it governs |
| Building or auditing a UI | `void-frontend-design` (build) + `void-ui-review` (audit/critique/polish) skills |
| Auditing a live dev surface (API/CLI/SDK/docs) | `void-devex-audit` skill (measured TTHW, error-path tracing, evidence-backed DX scorecard) |
| Live browser QA of a running web app | `void-qa` skill (claude-in-chrome MCP: explore, states, atomic fix loop, report; `--report-only` for no-fix) |
| Periodic engineering retrospective | `void-retrospective` skill (window signals → improvement decisions → learn) |
| Closing a session gracefully — before a clear, an interruption, or the end of a day | `void-checkpoint` skill (route state to its owner, keep the residue, one exact next action) |
| Ship a PR | `void-implement` pass 11 + `void-commit-discipline` + `gh` (release-please owns versions/changelog) |

## On gstack and superpowers (Codex perspective)

- **gstack** stays installed globally pending the Vague 6 teardown (DEV-395). QA, design, browser, and ship are now harness-native (`void-qa`, `void-ui-review`/`void-frontend-design`, claude-in-chrome, `void-implement`+gh); what remains gstack-provided until teardown is tracked in the gstack-coverage-matrix.
- **superpowers** is a Claude Code-specific skill bundle. Codex consumers don't interact with it directly; the harness's adapted equivalents (`void-brainstorm`, `void-plan`, `void-tdd`, `void-debug`, `void-verify`, plus `void-implement`/`void-ticket`) target both runtimes and are preferred over the superpowers originals (see the routing table). Document the adaptation in `docs/plans/skill-audits/`.

## Self-evolution principle

The harness improves from real project usage, never auto-applied.

- **Inbound**: while coding in a consumer project, a perceived "the harness should have X" is filed directly as a GitHub issue here (with source-project context), once it clears the agnostic + harness-worthy bar. The tracker is the triage zone; there is no per-project `proposed/` queue and no `feedback push` step.
- **Outbound**: the maintainer CLI `void-harness audit` reports skills not invoked recently, upstream deprecations, repeated matrix conflicts. Proposes deprecations as PRs.
- **HITL is absolute**: no automatic write into doctrine, ever. Every change is a deliberate commit.

## Autonomous mode (opt-in)

`void-autopilot` (core skill) is the single, **in-session** backlog drainer. It replaced `backlog-autopilot` at the 2026-07-30 cutover, which deleted the superseded engine rather than deprecating it — two engines in one release means two answers to "how does a cluster get drained". A human launches `void-autopilot`; it drains a tracker pool into one integration PR. The flow: an in-session launcher selects independent ready tickets, a **review budget** shrinks the cluster from structural doubt (unknown footprint, low confidence, collision zone) rather than from ticket estimates, routing is **parallel where footprints are disjoint, sequential where they collide** (lockfiles and migrations always sequential), and — after **human confirmation** — the runtime adapter fans out one **worktree subagent** per ticket. Claude executes the `OrchestrationPlan` through the **Workflow** tool, Codex through **native subagents**; both consume the same plan and return the same `WorkerResult`. The reconciler then integrates the verified commit ranges, seals the full suite against the integration SHA, publishes one branch through one explicit non-forced refspec, drives the checks, and holds the tracker until a human merges. The deterministic core (selection, review budget, lease, reconciliation, publication, recovery, tracker lifecycle) is the CLI `void-harness autopilot`; it contacts nothing and spawns no agent. The per-ticket quality cycle is the dedicated `void-implement` skill (single source of truth) that each worker runs; tickets are authored by `void-ticket`. Durable boundaries: HITL at backlog curation and PR merge, **commit-only** workers, server-side branch protection required on the base, security hooks live, skip-permissions full-auto sandbox-gated. **There is no `--auto-merge`, on any path** — it is refused by the CLI and by a source gate, because merging is where a human reads the diff as a whole. Multi-cluster autonomy and a **headless backend** (walk-away/cron) are reserved and deferred. See `docs/specs/2026-07-25-autopilot.md`, `docs/plans/2026-07-25-autopilot-plan.md`, and the Autopilot ADR.
