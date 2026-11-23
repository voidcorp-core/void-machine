# void-machine

[![npm](https://img.shields.io/npm/v/voidmachine?color=0b7285&label=voidmachine)](https://www.npmjs.com/package/voidmachine)
[![ci](https://github.com/voidcorp-core/void-machine/actions/workflows/ci.yml/badge.svg)](https://github.com/voidcorp-core/void-machine/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance%20signed-0b7285)](https://www.npmjs.com/package/voidmachine)
[![license](https://img.shields.io/badge/license-MIT-0b7285)](./LICENSE)

Void Machine's architectural vocation is to be **Void Cortex's action and execution
system**. Software development is its first specialty; the product shipped today
is the development harness described below. Cortex owns intent, durable context,
authorization and final acceptance; Machine executes within that mandate.
See [vocation, boundaries and progressive evolution](docs/MACHINE-VOCATION.md).
This direction does not claim a general-purpose Cortex integration is available.

Coding agents forget your standards between sessions. You explain the testing
discipline, the architecture boundaries, the naming, and the next session starts
from nothing. Repos drift one helpful suggestion at a time.

void-machine installs those standards as files the agent reads, and as hooks
that stop the work when they are broken. It runs on Claude Code and Codex from
one source, and it tells you what is actually installed and active rather than
what should be.

```
npx voidmachine init
```

Free, no account, no API key, no network fetch on the default path.

Already on 3.x? The product was renamed in 4.0; `update` takes over every block
the old name wrote, and the old command and settings keep working. See
[docs/MIGRATING-4.0.md](docs/MIGRATING-4.0.md). Coming from 2.x, read
[docs/MIGRATING-3.0.md](docs/MIGRATING-3.0.md) first.

## What lands in your project

`init` detects the project and the agent runtimes you have, then writes each
runtime's native files:

| Runtime | Doctrine document | Skills | Agents | Hooks |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/skills` | `.claude/agents` | `.claude/settings.json` |
| Codex | `AGENTS.md` | `.agents/skills` | `.codex/agents` | portable Node runner |

Alongside them, a receipt at `.void/machine/receipts/install-v1.json` records exactly
which files the harness owns. `update` and `remove` only ever touch those; a
file you edited is preserved, and a rollback restores the previous bytes.

What the doctrine covers: test-first discipline, hexagonal and DDD boundaries,
TypeScript strictness, security review, migration safety, frontend craft. Hooks
enforce the parts a machine can check, such as TDD ordering, no edits to
secrets or manual edits to lockfiles, no forbidden cross-package imports.

Stack packs add conventions for what you actually use:

```
npx voidmachine init --pack nextjs --pack monorepo
```

Available: `nextjs`, `monorepo`, `react`, `server`, `pwa`, `mobile`.

## Most of it never needs a command

This is the part that surprises people, so it goes first: you do not drive the
harness. You describe what you want in plain language, and the relevant skill
loads itself because its description matched. Hooks fire on their own, on the
tool call, before the damage. Asking "add a test for this" pulls the TDD
discipline in without anyone typing `void-tdd`.

What is installed, in numbers:

| | Count | How it fires |
|---|---|---|
| Core skills | 42 | Automatically, when what you are doing matches |
| Stack pack skills | 28 | Same, for the packs you activated |
| Hooks | 15 | Native tool guards and optional diagnostics; see the runtime manifests |
| Agents | 21 | Delegated by a skill, or invoked by name |
| Specialists | 16 | Invoked in their own fresh context during review |

You can still call a skill explicitly when you want that one and not the one
that would have matched: `/void-tdd` on Claude Code, or by name on Codex.
Agents work the same way: `doctrine-critic` judges a diff against the doctrine,
while `solution-architect`, `security-engineer` and `test-qa-engineer` each
review in their own fresh context.

**[The cheat sheet](docs/CHEATSHEET.md) lists every one of them**, grouped by
what it is for, with what each hook actually blocks. It is generated from the
same catalogue these counts come from, so it cannot drift from what ships.

To explore that catalogue alongside your project's installation evidence, run
`void-machine cheatsheet > cheatsheet.html`. Open the resulting file offline:
search by intention, filter by runtime, pack or type, and copy invocations.
`--format markdown` and `--format json` export the same information. Inspection
writes only to stdout; creating the file is your shell redirection.

At ticket end, `void-machine mission inspect --id <mission> --usage` adds observed skill,
hook and specialist counts. Unlinked telemetry stays unknown; counts do not certify quality.
See [the usage recap contract](docs/TICKET-USAGE.md).

For your own project rather than the catalogue, `npx voidmachine status` reports
what is installed, active and actually used.

The commands worth knowing are the ones no sentence can trigger, because they
report or change state rather than shape behaviour:

```
npx voidmachine status            # what is installed, active, and actually used
npx voidmachine doctor            # health-check the wiring
npx voidmachine add <pack>        # activate a stack pack
npx voidmachine runtime add codex # wire a second runtime
npx voidmachine update            # recompile owned assets from a newer CLI
```

## Manual checkpoint and semantic resume

Use `void-checkpoint` to save useful session residue before leaving or clearing context.
On Claude Code and Codex, `SessionStart` reads that checkpoint and Git state.
It reports missing or stale context without requiring a mechanical block, seal or revision.
Existing checkpoints remain untouched; legacy mechanical blocks are ignored on reads.
No continuous context tracker, automatic checkpoint reminder or end-of-session audit runs.

Optional Herdr metadata can still display Claude's latest complete token usage when
`.void/config.json` supplies a positive `context.windowTokens`. This read-only measurement
examines at most 1,048,576 transcript bytes and uses only usage counters. Project containment,
no-follow file checks and exact session binding protect external Claude transcript reads.
Unknown windows, unavailable transcripts and Codex yield no percentage. No threshold nudge,
checkpoint write or automatic compaction follows. Herdr discovery failure disables only the
relevant Herdr operations; commands still require a verified target.

## What it does not do

It does not make an agent good. It removes the failure modes that come from an
agent having no standing context, and it makes the remaining gaps visible. The
judgement is still the model's.

Some things are honestly incomplete:

- Codex reaches the same doctrine but not yet the same read-only isolation for
  every agent. Where it falls short, `doctor` reports `degraded` rather than
  claiming parity. The current state is written down in [`docs/CODEX.md`](docs/CODEX.md).
- Local hooks only run on a machine that installed them. Cloud agents and
  `--dangerously-skip-permissions` runs bypass them entirely, which is why the
  server-side floor below exists.
- Stack profiles carry an explicit expiry. Past it they fail degraded instead
  of serving guidance that may have aged out.

## See what is actually there

```
npx voidmachine status     # per-capability lifecycle, offline, no model call
npx voidmachine doctor     # health check of the wiring itself
npx voidmachine check      # version freshness for the installed channel
```

`status` reads a frozen capability certification plus local telemetry and shows
each capability's state: `available`, `installed`, `verified`, `used`,
`effective`. The distinction is the point. A skill that is installed and never
invoked is not doing anything for you, and the report says so instead of
counting it as a win.

Both surfaces also report whether your install is behind the version published
on npm. That check is advisory, never fails a run, sends nothing about your
machine, and reports `unknown` with a cause when the registry is unreachable
rather than claiming you are current. `doctor --no-remote` skips it.

`check` uses the installed bundled version from the local receipt, or the committed
manifest on a fresh clone. Legacy plugin pins apply only to marketplace installs;
`check --doctrine` explicitly compares marketplace doctrine. `doctor` and a successful
bundled install/update also report owned scripts exposed to Biome or Knip. This advice
never edits your analyzer configuration: it names specific harness files and preserves
project files alongside them. Complex Knip configuration needs manual inspection.


## Verify the supply chain yourself

Releases are published from CI with no npm token anywhere in this repo, through
npm Trusted Publishing (OIDC), and carry a provenance attestation signed by
GitHub Actions and recorded in the sigstore transparency log.

Rather than take that sentence's word for it:

```bash
npm audit signatures     # in a project that installs it
npm view voidmachine dist.attestations
```

The release flow is in [`docs/RELEASING.md`](docs/RELEASING.md).

## Add a runtime later

The harness is runtime-agnostic by construction: one doctrine, compiled through
an adapter per runtime. A Claude-only project has only `CLAUDE.md`; a Codex-only
project only `AGENTS.md`. Adding the other one later touches nothing you already
have.

```
npx voidmachine runtime list
npx voidmachine runtime add codex
```

## Enforce the floor on every pull request

Local hooks protect the machine that has them. Adopt the reusable enforcement
workflow into your existing caller, preserving its job/check names and branch
filters. For a new caller, `.github/workflows/void-enforce.yml` can contain:

```yaml
name: void-enforce
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]
  merge_group:
    types: [checks_requested]
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  enforce:
    uses: voidcorp-core/void-machine/.github/workflows/enforce.yml@<full-sha>
```

Replace `<full-sha>` with a reviewed immutable version containing the admission
behavior below. The placeholder is not an executable version pin. Keep concurrency
in the caller only: the reusable workflow inherits the caller's `github.workflow`,
so duplicating its group in the callee can cancel its own invocation.

A draft stops inside the required `enforce` job with `CI_DEFERRED_DRAFT` before
setup and floor execution. This means preparation is deferred, not that tests
failed or passed; agents continue focused local work rather than retrying it.
Marking the same head ready runs the complete floor, and `merge_group` proves the
queued integration. Only obsolete PR runs share cancellation groups; queue runs
remain distinct. Do not replace admission with a skipped required job.

The floor checks protected paths, secret content, TDD and boundaries through the
portable Node bundle, failing closed on missing dependencies or an unresolved
base. It complements your existing quality workflow. Keep the project's package
manager, lockfile and Node version owner when adopting the installed `void-verify`
[quality example](packages/core/skills/void-verify/references/ci-feedback.md).
For Bun projects, the optional [dependency audit](docs/DEPENDENCY-AUDIT.md) keeps
required candidate checks and periodic advisory surveillance independent of quality.
Do not install Bun just to add this example to an npm or pnpm project.

Adoption is explicit: neither installation nor update overwrites your workflows
or changes branch protection. Check the actual required names before rollout.
GitHub-hosted runner usage for this public reusable workflow is billed to the
caller, including a private caller; reuse does not transfer billing to this repo.
See GitHub's [reusable workflow contract](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
Measure elapsed feedback time and summed job-minutes separately; this example
makes no claim about a consumer's invoice savings.

## Going further

- **Missions** turn a ticket into a risk classification, an applicability
  matrix, and an execution plan with append-only local evidence:
  `npx voidmachine mission plan --ticket <path> --json`. Verification runs argv
  directly with `shell:false`; evidence stays under `.void/runs/`, redacted and
  bounded. See [`docs/POLICIES.md`](docs/POLICIES.md).
- **Native specialists** (`solution-architect`, `security-engineer`,
  `test-qa-engineer`) are installed as real agent definitions, invocable by
  name, each returning the same versioned JSON contract. An orchestrator uses
  those same definitions rather than a parallel prompt of its own.
- **Claude Code marketplace** is an optional secondary channel:
  `/plugin marketplace add voidcorp-core/void-machine`. The bundled local
  assets remain the default.

Decision records are authored directly as Markdown with light frontmatter through
`void-decide`. The public `decisions new`, `decisions check` and `decisions render`
commands have been removed; see the [migration note](packages/cli/README.md#decision-records-breaking-command-removal). Historical records and their readers remain available.

## Contributing

Source maintainers: consult the [Linear idea index](docs/LINEAR-INDEX.md) before
revisiting backlog decisions. After a confirmed Linear issue or comment write,
follow its incremental-refresh procedure; a local failure never replays the
remote write. The index and `pnpm backlog:index` are private-workspace tooling,
excluded from consumer installations. Export data stays under the source-only
ignore rules in `.void/.gitignore`.

```bash
pnpm install
pnpm verify     # every gate CI runs, in its order
```

`pnpm verify --artifacts` runs just the generated-artefact gates in seconds, and
`pnpm verify --fix` regenerates them. Start with
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md), then
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the package boundaries.

Keep skills and hooks concise and focused without absolute line caps or a
home-grown DSL. Review responsibility overlap in context. Discovery descriptions
keep a non-blocking 250-character target and a hard cap at 500; technical names,
resolved references, explicit agent scopes and applicable skill tests remain
required. Load detailed references only when useful so the doctrine stays readable.

## Philosophy

Three non-negotiables, in order: **safety** (test-first, validation at trust boundaries
and where invariants can change), **performance** (back-of-the-envelope before code,
mechanical sympathy, batch over react), **developer experience** (fast feedback,
no magic, every convention motivated in writing).

Inspired by Wing Chun's economy of means, TigerStyle from TigerBeetle, the
citypaul dotfiles, and the compound-engineering loop. Read
[`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) for the reasoning and the sources.

> *Du vide naît la structure.* Build more, move fast, be better.

## License

MIT. Built at VoidCorp by Folpe, released for anyone.
