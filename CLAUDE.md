# CLAUDE.md — void-machine

<!-- void-machine:begin -->

## Void Machine (managed by `void-machine init`)

Claude Code doctrine active in this project:

- `void` — universal craftsman skills (TDD, TypeScript strict, hexagonal, DDD, ...)

### Doctrine — loaded into every session

@.void/installed/PHILOSOPHY.md
@.void/PROJECT-DOCTRINE.md

`PHILOSOPHY.md` is the universal Void Machine doctrine (managed — overwritten on init). `PROJECT-DOCTRINE.md` holds project-specific rules: context, ADRs, in-flight decisions (yours; init never overwrites what you have written in it).

To capture a new rule, just say it ("ajoute la règle…", "always X here", "never Y"). The `void-learn` skill auto-invokes, classifies project-specific vs universal, proposes the wording, waits for your confirmation, then writes. Never silent.

Every skill is invoked by its name: `/void-implement`, `/void-tdd`. A skill that composes another names it the same way; the syntax is the runtime's, the name is the skill's.

### Program — when present

If `.void/program.md` exists with `status: executing`, read it and its linked plan/spec before choosing implementation work. The programme holds global context; the local checkpoint holds session residue, and `ResumeBundle` composes both with Git. On a continue/start/resume request without a named work unit, use the declared progress provider: recover the scoped unit if exactly one is started; if several are started, stop and surface the competing claims; otherwise select the first ready unit from the declared order and native blocker relations. Fetch the complete unit before running `void-implement`. The declared progress provider owns mutable execution state; the program and checkpoint never store a current or next unit. If the provider or a required capability is unavailable, do not infer remote progress; stop the action that needs it. If no progress provider is declared, require a specific unit instead of selecting one. A specific user request overrides selection; human gates and merges remain human. The file's `autopilot` block carries consent to autonomous execution and is never inferred: `enabled: false`, an absent block, or an unreadable one forbids autonomous selection entirely.

An authorized merge includes routine local synchronization by the coordinator without asking for confirmation again. Verify the branch, remote, and verified merged commit, then fetch and advance the clean local target branch with `git merge --ff-only` to that commit. Stop on local changes, divergence, or an unexpected remote tip; preserve the work. This does not authorize another remote merge, deployment, history rewrite, or changes to shared Git state by commit-only workers. Runtime sandbox and approval controls still apply; never bypass them.

Run `void-machine doctor` to verify the install.

<!-- void-machine:end -->

> **Sister doc**: `AGENTS.md` is the Codex-flavored mirror of this file. The two are maintained in sync — any change to one MUST be reflected in the other in the same commit. CI enforces this on every push (`pnpm sync:docs`, which compares section headings after terminology normalization); the pre-commit hook in `.githooks/` refuses a commit that stages one sister doc without the other, and `pnpm install` wires it through the root `prepare` script so a fresh clone inherits the check instead of having to opt in. Adapted terminology only (Claude/Skill tool ↔ Codex/tools); the doctrine is identical.

You are working inside the **void-machine** repo itself — the meta-repo that produces the harness (Claude Code + Codex) for every VoidCorp project. This file governs work **on the harness**, not work on projects that consume it.

## What this repo is

A **public, MIT** harness installed free and account-free via `npx voidmachine` (the npm package is the primary channel; the voidcorp marketplace is self-hosted in this repo — `.claude-plugin/marketplace.json` lists every plugin as a local subdirectory — as an optional secondary channel; see `docs/DECISIONS.md`). It injects opinionated Claude Code configuration into any project:

- **Core** (`packages/core/`) — universal craftsman skills, agents, hooks, CLAUDE.md modules
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

## Visible mission workspace

For a request to code on a named project, use the optional presentation adapter
as described in `docs/NATIVE-SUPERVISION.md`: resolve the project and mission,
reuse their workspace, keep the coordinator left and native terminal workers
stacked right. Use `scripts/mission-presentation.mjs` from this harness checkout;
never assume cmux exists in the target project. Runtime-native delegation remains
the executor. Do not duplicate an agent to give it a pane, and do not turn a
presentation failure into a changed permission, proof or merge policy.

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
- Rewrite for void-machine, removing what doesn't fit, adding what's missing
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

void-machine is installed **in void-machine**, through the same `npx voidmachine init` a consumer runs. The enforcement floor that guards a customer project guards this one: write a secret, a `console.log`, an `any` or a `null` here and the write is refused, exactly as it would be in their repo.

What is active here is the **published** harness, not the working tree. That distinction is the whole safety of the arrangement: a rule broken while being developed cannot lock the repo it is being developed in. `.void/hooks/` therefore carries a released bundle, deliberately different from `packages/core/hooks/`, and is committed so a fresh clone — or an autopilot worktree — inherits the floor rather than silently losing it.

This is separate from `void-machine self-host sync`, which compiles the **current sources** into an isolated artifact under `.void/machine/generated/` and never wires the repo root (see `docs/ARCHITECTURE.md`, "Source self-host boundary"). Two different questions: self-host asks *do the sources still compile into a working harness*, the install asks *does the shipped harness hold while we work*.

Before this, the floor ran in every consumer project and in none of ours — which is why two NUL bytes reached committed source on 2026-08-06 through a mechanism that was working the whole time, just not connected here.

## Meta-rules

- Any new convention added in a commit MUST be reflected in `docs/*.md` in the same commit
- Any non-obvious decision (where a credible alternative exists) MUST be created as its own collision-free file with `void-machine decisions new`; accepted decision content is immutable and changes supersede it. The only in-place exception is a bounded repository-local reference migration whose surrounding text is unchanged and whose new target exists inside the repository. Accepted files are never deleted or renamed. `docs/DECISIONS.md` is a frozen legacy landing page, never a worker-owned artifact; `pnpm decisions:check` gates structure and immutability.
- Removed concepts must be removed from the docs at the same time
- Tests run via `pnpm test`; do not skip TDD when adding logic
- Versions are never hand-edited: release-please bumps every manifest in lockstep from Conventional Commits, and `pnpm version:check` fails CI on any drift (see `docs/RELEASING.md`)

## Skill routing inside this repo

| Task                                     | Skill / Tool                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Brainstorming the next feature           | `void-brainstorm`                                                              |
| Writing a plan                           | `void-plan`                                                              |
| Reviewing a written plan (pre-execution) | `void-plan-review` (lenses CEO/Eng/Design/DevEx, or `all`)                        |
| Implementing a ticket / feature          | `void-implement` (one unit, ready→shipped: TDD, UX, security, review, verify) |
| Decomposing work into tickets            | `void-ticket`                                                              |
| Draining independent tickets in parallel | `void-autopilot` (continuous loop → one worker and one PR per ticket → merge queue) |
| Adding a skill                           | `superpowers:writing-skills` (until vendored) + the naming rule: `kind: action` takes the bare verb, `kind: standard` the subject it governs |
| Building or auditing a UI                | `void-frontend-design` (build) + `void-ui-review` (audit/critique/polish)      |
| Auditing a live dev surface (API/CLI/SDK/docs) | `void-devex-audit` (measured TTHW, error-path tracing, evidence-backed DX scorecard) |
| Live browser QA of a running web app     | `void-qa` (claude-in-chrome MCP: explore, states, atomic fix loop, report; `--report-only` for no-fix) |
| Periodic engineering retrospective       | `void-retrospective` (window signals → improvement decisions → learn)  |
| Closing a session gracefully — before a clear, an interruption, or the end of a day | `void-checkpoint` (route state to its owner, keep the residue, one exact next action) |
| Ship a PR                                | `void-implement`'s ship pass + `void-commit-discipline` + `gh` (release-please owns versions/changelog) |

## On gstack and superpowers

- The gstack runtime was removed by DEV-395. QA, design, browser, and shipping use the harness-native paths (`void-qa`, `void-ui-review`/`void-frontend-design`, claude-in-chrome, `void-implement` + `gh`). Historical provenance remains in the coverage matrix and decision log; no shipped path depends on gstack.
- **superpowers**: the essential skills are now vendored into this harness (`void-brainstorm`, `void-plan`, `void-tdd`, `void-debug`, `void-verify`, plus `void-implement`/`void-ticket`) — prefer the vendored version (see the routing table). superpowers stays only for what is not yet vendored (e.g. `writing-skills`, `executing-plans`, `subagent-driven-development`). Document each adaptation in `docs/plans/skill-audits/`.

## Self-evolution principle

The harness improves from real project usage, never auto-applied.

- **Inbound**: while coding in a consumer project, a perceived "the harness should have X" is filed directly as a GitHub issue here (with source-project context), once it clears the agnostic + harness-worthy bar. The tracker is the triage zone; there is no per-project `proposed/` queue and no `feedback push` step.
- **Outbound**: the maintainer CLI `void-machine audit` reports skills not invoked recently, upstream deprecations, repeated matrix conflicts. Proposes deprecations as PRs.
- **HITL is absolute**: no automatic write into doctrine, ever. Every change is a deliberate commit.

## Autonomous mode (opt-in)

`void-autopilot` (core skill) is the single, **in-session** delivery loop. It replaced the cluster engine at the 2026-09-24 cutover, which deleted that engine rather than deprecating it — two engines in one release means two answers to "how does autonomous work reach `develop`". A human launches `/void-autopilot`; it keeps up to four tickets in flight, one worker and one pull request each, and leaves every merge to GitHub. A curator ranks the ready work; the loop admits a ticket only with a footprint that names its ground, runs disjoint footprints in parallel and colliding ones in sequence (lockfiles and migrations always sequential), and gives each worker its own worktree, where it runs `void-implement` whole. The loop merges on a local verdict: `autopilot review` delegates a fresh-context, read-only reviewer through the kernel in a worktree detached at the exact head, checks that worktree's `HEAD` before and after the run, and records the verdict bound to that head and to the native session the runtime listed; nothing read on GitHub decides a merge. In this repository the `independent-review` job also reviews every ready pull request and posts its check through a GitHub App of its own, which branch protection requires on each head and merge group: a native GitHub layer GitHub enforces at merge time. The deterministic kernel is the CLI `void-machine autopilot` (`next`, `review`, `stop`, `arm`, `disarm`, `fingerprint`, `judgment`): `next` rebuilds the state from the tracker, GitHub and git on every tick and decides; the skill acts. Durable boundaries: consent is the programme's `autopilot` block, never a run flag; **there is no `--auto-merge` flag, on any path**; a merge is armed only on a head a clean local verdict holds, through the merge queue or an auto-merge request, re-read afterwards, and disarmed the moment the loop can no longer vouch for it; never into the branch that deploys; never on a pull request that touches the machinery that judges merges (the protected-paths floor), which goes to a person; workers are **commit-only** and write nothing the repository shares across worktrees (`refs/stash`, tags, notes, remotes, config), which a fingerprint before and after each unit proves; server-side protection is required on the base, with a merge queue or, failing one, a branch that must be up to date, which the loop then merges serially; security hooks live; `--dangerously-skip-permissions` sandbox-gated. Promotion to the deploying branch stays human, and what a person judges there is the feature, not the code. A **headless backend** (walk-away/cron) is reserved and deferred. See `docs/specs/2026-09-22-autopilot-native-loop.md`, `docs/plans/2026-09-22-autopilot-native-loop-plan.md`, the continuous-loop ADR, and `docs/specs/2026-09-28-autopilot-merge-without-consumer-setup.md` for the local verdict.
