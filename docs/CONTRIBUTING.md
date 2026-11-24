# Contributing to void-machine

The working rules for this repo live in `CLAUDE.md` (mirrored as `AGENTS.md` for Codex) and the docs it points to. This file is the short index; those are the source of truth.

## Before you write code

1. Read `CLAUDE.md` — the anti-bloat discipline (eight hard rules), sourcing discipline, and hard rules for any added code. A PR that violates the anti-bloat rules is blocked.
2. Read `docs/PHILOSOPHY.md` — the three pillars (safety / performance / DX) and why they win.
3. Read `docs/ARCHITECTURE.md` — package boundaries and dependency direction.
4. Read the relevant Markdown records in `docs/decisions-log/`; `docs/DECISIONS.md` preserves the older history. Link a new record to its predecessor when materially changing a settled choice.

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
Install conformance proves the packed runner and native runtime wiring, preserves
user doctrine and adjacent files, and exercises update and receipt recovery.
The retired syntax worker has no installation prerequisite or latency campaign.

`pnpm lint` uses this repository's Biome 2.4.16 configuration. The explicit-any,
console, undeclared-dependency and focused/skipped-test rules are errors. Run the
configured checks after coherent changes, before accepting test evidence; do not
wait until the final handoff to discover violations. Tests containing intentional
invalid source should use data strings or narrowly justified fixture handling.
CLI output exceptions must not exempt application logging.
The repository configuration is not a consumer preset installed by `init`.
Consumers configure and verify equivalents in their existing toolchain; missing
coverage is reported honestly, without a new checker or a general work veto.
See [test evidence and validation](HOOK-TEST-EVIDENCE.md) for scope and limitations.

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
- `pnpm anti-bloat:check` — discovery contracts (description target ≤250 chars and hard cap 500, technical skill names, `.source` provenance), agent tool isolation and hook syntax. Skills and hooks stay concise without editorial line caps.
- `pnpm graph:check` / `pnpm graph:check-bundle` — regenerate `catalog.v3.json`, its `model.json` compatibility projection, and the bundle when graph inputs change.
- `pnpm conformance:consumer` — pack the local CLI once, then prove account-free install,
  installed-hook execution and the Autopilot public surface for Claude, Codex, and both. The
  narrower `conformance:install`, `conformance:hooks` and `conformance:autopilot` commands select
  one suite through the same orchestrator. CI packs one exact-SHA artifact and makes Linux, macOS
  and Windows verify and execute those same bytes. The default run also executes the latency
  suite; select it alone with `pnpm conformance:consumer --suite latency`.
- `pnpm sync:docs` — `CLAUDE.md` and `AGENTS.md` must stay in parity (a pre-commit hook enforces this; change one, change the other in the same commit).
- `void-machine self-host sync --mode shadow` then `void-machine self-host doctor` — compile and exercise the current sources as isolated Claude + Codex artifacts. Generated bytes live only under `.void/generated/`; the command never owns native root agent files.

Self-host rollout modes are `shadow`, `warn`, `enforce`, and `release-gate`.
`shadow`/`warn` report blockers without failing the command. `enforce` and
`release-gate` fail on a missing, stale, drifted, or non-executable artifact;
native runtime executables that are unavailable remain an explicit degraded
state until their dedicated certification lane.

## Authority and session handoff

[Explicit config authority](AUTOPILOT-AUTHORITY.md) requires schemaVersion 3 and an explicit
boolean enabled. The native project/milestone locator lives in `progress.scope`; the milestone
links the approved plan and native relations own progress. Historical programme files are kept
without being read, moved or rewritten. Installation never migrates autonomous consent.

Read the complete checkpoint and reconcile all engaged tickets, PRs, Git and native workers.
Keep the bounded planned list as intention, preserve human priorities and assignments, and
refresh affected observations after a merge. Missing required provider, scope or plan stops
only dependent selection. No duplicate worker for uncertain activity; no permission from
membership alone. Claim selected work before editing, use review after its gates pass, and
mark done only after merge and final verification. Human gates remain human.

## Commits

Conventional Commits, and every message ends with **why**, not just what (see `void-commit-discipline`). Any new convention added in a commit must be reflected in `docs/*.md` in the same commit. Write lasting structural decisions as short Markdown records with light frontmatter through `void-decide`. Keep stable unique names and IDs, historical metadata and replacement links. Ordinary corrections use normal Git commits; material changes create a linked new decision. `void-learn` still requires human agreement for doctrine changes.

## Filing a gap

A perceived harness gap is filed **directly as a GitHub issue** on `voidcorp-core/void-machine` once it clears the agnostic + harness-worthy bar (see `docs/HARNESS_EVOLUTION.md`). There is no per-repo proposal queue.
