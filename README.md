# void-harness

[![npm](https://img.shields.io/npm/v/voidharness?color=0b7285&label=voidharness)](https://www.npmjs.com/package/voidharness)
[![ci](https://github.com/voidcorp-core/void-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/voidcorp-core/void-harness/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance%20signed-0b7285)](https://www.npmjs.com/package/voidharness)
[![license](https://img.shields.io/badge/license-MIT-0b7285)](./LICENSE)

Coding agents forget your standards between sessions. You explain the testing
discipline, the architecture boundaries, the naming, and the next session starts
from nothing. Repos drift one helpful suggestion at a time.

void-harness installs those standards as files the agent reads, and as hooks
that stop the work when they are broken. It runs on Claude Code and Codex from
one source, and it tells you what is actually installed and active rather than
what should be.

```
npx voidharness init
```

Free, no account, no API key, no network fetch on the default path.

Already on 2.x? Thirteen skills changed name in 3.0 and the layout under `.void/`
moved. `update` does the layout; the names are yours to search for. See
[docs/MIGRATING-3.0.md](docs/MIGRATING-3.0.md).

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
secrets or lockfiles, no forbidden cross-package imports.

Stack packs add conventions for what you actually use:

```
npx voidharness init --pack nextjs --pack monorepo
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
| Core skills | 41 | Automatically, when what you are doing matches |
| Stack pack skills | 28 | Same, for the packs you activated |
| Hooks | 31 | On the tool call, before the write lands |
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

For your own project rather than the catalogue, `npx voidharness status` reports
what is installed, active and actually used.

The commands worth knowing are the ones no sentence can trigger, because they
report or change state rather than shape behaviour:

```
npx voidharness status            # what is installed, active, and actually used
npx voidharness doctor            # health-check the wiring
npx voidharness add <pack>        # activate a stack pack
npx voidharness runtime add codex # wire a second runtime
npx voidharness update            # recompile owned assets from a newer CLI
```

## Context continuity, within the limits the runtimes expose

Claude Code and Codex both route `UserPromptSubmit`, `PostToolUse`, `PreCompact`, and
`SessionStart` through the same local continuity handler. It keeps one bounded mechanical block in
`.void/machine/checkpoint.md`: the latest complete token observation, the 20 most recent unique
read paths, the 20 most recent unique modified paths, overflow counts, and semantic/work revisions.
`PreCompact` seals that block atomically; the next `SessionStart` injects the semantic checkpoint,
the bounded working set, and an explicit complete/degraded status.

The runtime does not expose a reliable context-window size. If you know it, opt into a threshold
nudge in `.void/config.json`:

```json
{
  "context": {
    "windowTokens": 200000,
    "checkpointThresholdPercent": 50
  }
}
```

The threshold must be an integer from 40 through 60 and defaults to 50 when `context` is present.
Without `windowTokens`, the handler records the latest usage counters but computes no percentage
and emits no threshold nudge. Transcript reads stay local, inspect only usage counters, and are
bounded to 1,048,576 bytes per invocation; prompt and response content are neither logged nor sent.

The limits are intentional: the harness never invokes `/clear` or `/compact`, and the hook never
writes objective, progress, dead ends, assumptions, or a next action. A nudge asks the agent to
invoke `void-checkpoint`; it does not invoke the skill. A brutal `/clear` before a recent semantic
checkpoint can therefore still require reconstruction.

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
npx voidharness status     # per-capability lifecycle, offline, no model call
npx voidharness doctor     # health check of the wiring itself
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

## Verify the supply chain yourself

Releases are published from CI with no npm token anywhere in this repo, through
npm Trusted Publishing (OIDC), and carry a provenance attestation signed by
GitHub Actions and recorded in the sigstore transparency log.

Rather than take that sentence's word for it:

```bash
npm audit signatures     # in a project that installs it
npm view voidharness dist.attestations
```

The release flow is in [`docs/RELEASING.md`](docs/RELEASING.md).

## Add a runtime later

The harness is runtime-agnostic by construction: one doctrine, compiled through
an adapter per runtime. A Claude-only project has only `CLAUDE.md`; a Codex-only
project only `AGENTS.md`. Adding the other one later touches nothing you already
have.

```
npx voidharness runtime list
npx voidharness runtime add codex
```

## Enforce the floor on every pull request

Local hooks protect the machine that has them. To make the same floor
unavoidable server-side, add the reusable workflow. Five lines in
`.github/workflows/void-enforce.yml`:

```yaml
name: void-enforce
on: pull_request
jobs:
  enforce:
    uses: voidcorp-core/void-harness/.github/workflows/enforce.yml@main
```

It runs protected-path, secret-content, TDD and boundary checks through the same
portable Node bundle used inline, annotates the offending lines, and fails
closed: a missing dependency or an unresolvable base is a red check, never a
silent pass. Pin `@main` to a release tag for a stable floor. It enforces the
doctrine floor only; keep your own lint and test CI.

## Going further

- **Missions** turn a ticket into a risk classification, an applicability
  matrix, and an execution plan with append-only local evidence:
  `npx voidharness mission plan --ticket <path> --json`. Verification runs argv
  directly with `shell:false`; evidence stays under `.void/runs/`, redacted and
  bounded. See [`docs/POLICIES.md`](docs/POLICIES.md).
- **Native specialists** (`solution-architect`, `security-engineer`,
  `test-qa-engineer`) are installed as real agent definitions, invocable by
  name, each returning the same versioned JSON contract. An orchestrator uses
  those same definitions rather than a parallel prompt of its own.
- **Claude Code marketplace** is an optional secondary channel:
  `/plugin marketplace add voidcorp-core/void-harness`. The bundled local
  assets remain the default.

## Contributing

```bash
pnpm install
pnpm verify     # every gate CI runs, in its order
```

`pnpm verify --artifacts` runs just the generated-artefact gates in seconds, and
`pnpm verify --fix` regenerates them. Start with
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md), then
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the package boundaries.

Eight anti-bloat rules gate every pull request: a skill stays under 400 lines
and covers one subject, two skills may not overlap by more than 30%, a
discovery description has a non-blocking 250-character target and a hard cap at 500, hooks stay under 100 lines
with no home-grown DSL, agents keep an explicit scope, and skill tests gate the
release. They exist because a doctrine that grows without limit stops being
read.

## Philosophy

Three non-negotiables, in order: **safety** (test-first, paired assertions,
schema-validated boundaries), **performance** (back-of-the-envelope before code,
mechanical sympathy, batch over react), **developer experience** (fast feedback,
no magic, every convention motivated in writing).

Inspired by Wing Chun's economy of means, TigerStyle from TigerBeetle, the
citypaul dotfiles, and the compound-engineering loop. Read
[`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) for the reasoning and the sources.

> *Du vide naît la structure.* Build more, move fast, be better.

## License

MIT. Built at VoidCorp by Folpe, released for anyone.
