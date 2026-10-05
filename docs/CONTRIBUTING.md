# Contributing to void-machine

The working rules for this repo live in `CLAUDE.md` (mirrored as `AGENTS.md` for Codex) and the docs it points to. This file is the short index; those are the source of truth.

## Before you write code

1. Read `CLAUDE.md` — the anti-bloat discipline (eight hard rules), sourcing discipline, and hard rules for any added code. A PR that violates the anti-bloat rules is blocked.
2. Read `docs/PHILOSOPHY.md` — the three pillars (safety / performance / DX) and why they win.
3. Read `docs/ARCHITECTURE.md` — package boundaries and dependency direction.
4. Skim `docs/DECISIONS.md`, then use `void-machine decisions render` for the current decision projection. Do not re-litigate a settled call without superseding it.

## Running the CLI you just changed

```
pnpm cli <command>          # e.g. pnpm cli projects, pnpm cli ui
```

Use this, not the `void-machine` on your PATH. That one is the **published**
package, so a command added in your working tree answers `unknown command` and
sends you reading the help of an older version — which is exactly what happened
the first time `ui` was tried. `pnpm cli` rebuilds first, so it always runs the
tree rather than the last build.

## The gates (run before you push)

The three daily commands are deliberately few:

- `pnpm test:fast` for the CPU-only edit loop.
- `pnpm test:component` when filesystem or subprocess behavior changed.
- `pnpm verify` once before handoff or push; it runs every required gate in the same order as CI.

Agent campaigns are a separate measurement lane. A campaign cell runs only
targeted checks for its fixture; it must not invoke `pnpm verify`, certification
stress, or network checks as an inner loop. The campaign scheduler uses bounded
parallelism and persists each cell result as it completes. A failed or
unavailable runtime stops admission when configured and leaves the remaining
cells as `unknown`; it never turns an incomplete campaign into a green report.
The release lane still runs `pnpm verify` once on the integrated result.

`scripts/verify.mjs` is the only gate catalogue. The managed block in
`.github/workflows/ci.yml` is generated from it, and every CI gate writes one report bound to the
checked-out SHA and exact argv. The final step rejects a missing, duplicate, stale or red report.
Performance benchmarks remain explicit observations through `pnpm verify --observations`; shared
PR runners do not authorize correctness from wall-clock thresholds.
Install conformance proves the packed syntax worker by the identity the runtime verifies and two
exact answers; its repeated latency campaign is printed as the `syntax-worker-latency` observation
(`complete` or `latency-anomaly`) with every sample kept. Only a measured timeout is an anomaly; a
wrong answer, a launch error or an incomplete campaign still fails the install.
Repeated reliability stress is not a laptop gate. `.github/workflows/test-certification.yml` runs
twenty seeded fast attempts and ten seeded complete attempts weekly or on explicit dispatch, with
fixed worker budgets and exact-SHA JSON reports. A failure stops the campaign and remains red; the
workflow never retries an attempt. A separately triggered GitHub run has a new run identity and
does not erase the earlier red evidence.

- `pnpm verify --artifacts` — only the generated-artefact gates, in seconds.
  Adding a skill moves the graph, `certification.json`, the consumer bundle AND
  the `core-assets` mirror; this is the class of failure that otherwise gets
  discovered from CI, one round trip at a time.
- `pnpm verify --fix` — regenerate those artefacts instead of being told they
  are stale, then verify them. Never implicit: regenerating a committed file is
  a change, and a change happens because someone asked for it.

- `pnpm test` — the suite is the gate before "done".
- Every Vitest entry point imports `test/support/vitest-options.ts`. One global setup creates a
  run-owned root, and a per-file setup routes `HOME`, OS temporary files, XDG state and
  `VOID_GLOBAL_DIR` into it before test modules load. Global teardown removes the root after all
  workers finish. A package-local run and the root run therefore have the same containment and
  timeout contract; do not duplicate those values in package configs.
- The root Vitest config derives exclusive projects from `test/support/test-catalog.ts`. Proof tier
  answers what a test proves; resource class controls how it is scheduled. `pnpm test:fast` is the
  CPU-only edit loop, `pnpm test:component` owns filesystem and subprocess checks, and
  `pnpm test:network` is explicit because it needs loopback sockets. Use the tier commands when the
  semantic boundary matters. Contract subprocess tests use two bounded workers; consumer and
  system subprocess tests stay sequential in separate groups. Loading Vitest fails if a test path
  has no tier or more than one. Any increase to a worker budget requires the complete stress proof,
  not a retry-until-green run.
- `pnpm lint` and `pnpm typecheck` — zero errors.
- `pnpm anti-bloat:check` — the eight anti-bloat rules (skill ≤400 LOC, hook ≤100 LOC, discovery description non-blocking target ≤250 chars and hard cap 500, `.source` + audit note per skill, ...).
- `pnpm graph:check` / `pnpm graph:check-bundle` — regenerate `catalog.v3.json`, its `model.json` compatibility projection, and the bundle when graph inputs change.
- `pnpm conformance:consumer` — pack the local CLI once, then prove account-free install,
  installed-hook execution and the Autopilot public surface for Claude, Codex, and both. The
  narrower `conformance:install`, `conformance:hooks` and `conformance:autopilot` commands select
  one suite through the same orchestrator. CI packs one exact-SHA artifact and makes Linux, macOS
  and Windows verify and execute those same bytes.
- `pnpm sync:docs` — `CLAUDE.md` and `AGENTS.md` must stay in parity (a pre-commit hook enforces this; change one, change the other in the same commit).
- `void-machine self-host sync --mode shadow` then `void-machine self-host doctor` — compile and exercise the current sources as isolated Claude + Codex artifacts. Generated bytes live only under `.void/generated/`; the command never owns native root agent files.

Self-host rollout modes are `shadow`, `warn`, `enforce`, and `release-gate`.
`shadow`/`warn` report blockers without failing the command. `enforce` and
`release-gate` fail on a missing, stale, drifted, or non-executable artifact;
native runtime executables that are unavailable remain an explicit degraded
state until their dedicated certification lane.

## Programme and session handoff

An executing multi-session programme may install one versioned `.void/program.md` descriptor.
Root `AGENTS.md` and `CLAUDE.md` load its global plan and spec; `ResumeBundle` composes it with the
local `.void/machine/checkpoint.md` and Git so a later session can resume from a plain “continue”.

The programme records durable context and routing: global plan, approved spec, optional progress
provider and opaque scope, stable unit order, native ready/started/review/done roles, human gates,
and the `void-autopilot` consent block. It does not duplicate a mutable current or next unit. The
declared progress provider is the execution ledger:

- recover exactly one unit in the declared started role before claiming new work;
- claim the selected ready unit in the provider's started role before editing;
- keep native blockers, ownership, comments and review evidence truthful when supported;
- move to the declared review role only after the unit gates pass;
- move to the declared done role only after merge and final verification;
- never auto-complete a human gate.

The `autopilot` block is required and carries consent to autonomous execution: `schemaVersion: 2`
and an explicit `enabled`. It declares no merge gate: the loop merges into the integration branch on
a local verdict, never into `deployBranch` or the repository default branch, and a person who merges
themselves runs `void-machine autopilot merges --by-human`. A program that does not want autopilot declares
`enabled: false` rather than omitting the block, because consent is never inferred from silence.
`packages/cli/src/lib/autopilot/program.ts` is the single parser of this contract, and its tests
validate this repository's own `.void/program.md` so the schema and the file cannot drift.

Ready means every native blocker relation is complete. If a required provider capability is
unavailable, only the action needing it stops; programme and checkpoint remain readable offline.
A specific user request still overrides automatic selection. When every scoped unit and human gate
is complete, the final programme change marks `.void/program.md` completed; it never repoints
itself to unrelated work.

The same protocol ships to consumer projects through the managed runtime-doc block. It is
provider-agnostic and dormant unless the consumer has a project-owned `.void/program.md` with
`status: executing`; `void-ticket` creates that descriptor only after an approved multi-unit pool
and native dependencies exist. The local checkpoint is replaced on a deliberate session close and
never carries the current or next unit.

## Commits

Conventional Commits, and every message ends with **why**, not just what (see `void-commit-discipline`). Any new convention added in a commit must be reflected in `docs/*.md` in the same commit. Create each non-obvious decision with `void-machine decisions new`; accepted decision content is immutable and changes supersede it. The only in-place exception is a bounded repository-local reference migration whose surrounding text is unchanged and whose new target exists inside the repository. Never delete or rename an accepted file, and never edit a shared index. `pnpm decisions:check` validates the records and this narrow immutability exception.

## Filing a gap

A perceived harness gap is filed **directly as a GitHub issue** on `voidcorp-core/void-machine` once it clears the agnostic + harness-worthy bar (see `docs/HARNESS_EVOLUTION.md`). There is no per-repo proposal queue.
