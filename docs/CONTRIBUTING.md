# Contributing to void-machine

The working rules for this repo live in `CLAUDE.md` (mirrored as `AGENTS.md` for Codex) and the docs it points to. This file is the short index; those are the source of truth.

## Install the workspace

Use the pnpm version pinned in root `package.json` (currently 12.23.0), then run
`pnpm install --frozen-lockfile`. pnpm 12 reads dependency overrides from
`pnpm-workspace.yaml`; the legacy `package.json#pnpm` field is ignored. Keep the
package-manager and dependency documents generated in `pnpm-lock.yaml` together.
Do not drop overrides or regenerate dependency versions to silence a configuration
mismatch. Only esbuild is approved to run its dependency installation script;
other dependency builds remain subject to pnpm approval. Verify a pnpm migration
with a fresh normal install before testing `--ignore-scripts`, since reusing an
installation can hide missing build approvals. See the [pnpm migration guide](https://pnpm.io/migration).

## Before you write code

1. Read `CLAUDE.md` — the anti-bloat discipline (eight hard rules), sourcing discipline, and hard rules for any added code. A PR that violates the anti-bloat rules is blocked.
2. Read `packages/core/src/PHILOSOPHY.md` — the three pillars (safety / performance / DX) and why they win.
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

Use the existing Vitest projects for focused feedback: `pnpm test:engine`,
`pnpm test:local`, and `pnpm test:network`. `pnpm verify --changed-from <ref>`
selects local checks conservatively; `--list` explains the commands without executing.
`pnpm verify` runs the retained complete local checks, collecting independent cheap
errors before starting dependent work. Build/freshness failures stop dependents.
Run relevant checks during implementation and reuse unaffected proofs at handoff.

CI is ordinary YAML calling these project commands. Native exit codes and Actions
outcomes own failure; there is no workflow generator or per-gate JSON report.
The cheap group explicitly requires successful outcomes even with continue-on-error.
The required `validate` job refuses failed, skipped or missing preparation.
Docs-only changes keep reference/enforcement checks. Shared, unknown, installer,
configuration, renamed or deleted paths broaden. Product Markdown is source.
Native skipped OS jobs mean non-applicability, never an executed conformance proof.
See [CI chain](CI-CHAIN.md) for selection, candidate identity and promotion.

There is no repository pre-commit installation or `prepare` hook mutating Git config.
Personal hooks remain untouched. A maintainer may remove an obsolete local
`core.hooksPath` only after proving it is exactly the repository-owned `.githooks`
value; workers never mutate configuration shared between worktrees.

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

The scheduled/manual certification campaign is retired. Historical reports remain evidence of
those runs. For an explicitly requested ordering investigation, use native Vitest once with
`--sequence.shuffle --sequence.seed=10401`; a failed invocation remains red. The network command
accepts the same two options while retaining its fixed worker and timeout bounds.

- `pnpm verify --artifacts` — only the generated-artefact gates, in seconds.
  Adding a skill changes the `core-assets` mirror; verify it alongside hook bundle freshness.
- `pnpm verify --fix` — regenerate those artefacts instead of being told they
  are stale, then verify them. Never implicit: regenerating a committed file is
  a change, and a change happens because someone asked for it.

- `pnpm test` — the suite is the gate before "done".
- Every Vitest entry point imports `test/support/vitest-options.ts`. One global setup creates a
  run-owned root, and a per-file setup routes `HOME`, OS temporary files, XDG state and
  `VOID_GLOBAL_DIR` into it before test modules load. Global teardown removes the root after all
  workers finish. A package-local run and the root run therefore have the same containment and
  timeout contract; do not duplicate those values in package configs.
- The root config uses [Vitest 5 native projects](https://vitest.dev/guide/projects).
  `pnpm test:engine` runs the I/O-free mission-engine package with four workers;
  `pnpm test:local` runs the remaining local package/repository tests with one worker because
  they include indirect subprocess fixtures; `pnpm test:network` owns the UI, daemon, note and signal families
  with one thread. Native `sequence.groupOrder` separates these groups when running all projects.
  Shared global setup, per-file isolation and cleanup apply to every project.
- Target a regression directly: `pnpm exec vitest run path/to/file.test.ts`, optionally adding
  `--project=local`, `--project=engine` or `--project=network`. Filter by `-t` for a named case.
  For actual runtime collection use `pnpm exec vitest list --no-static-parse --json=tests.json`;
  Vitest 5's default static list is not evidence that modules loaded successfully.
  No source scanner, proof-tier taxonomy, import regex or per-file registry chooses tests.
- `pnpm lint` and `pnpm typecheck` — zero errors.
- `pnpm anti-bloat:check` — discovery contracts (description target ≤250 chars and hard cap 500, technical skill names, `.source` provenance), agent tool isolation and hook syntax. Skills and hooks stay concise without editorial line caps.
- `pnpm conformance:consumer` — pack the local CLI once, then prove account-free install,
  installed-hook execution and the Autopilot public surface for Claude, Codex, and both. The
  narrower `conformance:install`, `conformance:hooks` and `conformance:autopilot` commands select
  one suite through the same orchestrator. CI packs one exact-SHA artifact and makes Linux, macOS
  and Windows verify and execute those same bytes. Safety and compressed-size checks read that
  same archive. On each OS, one offline npm install and a package-name invocation prepare
  the immutable CLI shared by the suites; their writable projects remain independent. The available suites are install, hooks and
  autopilot; the syntax-worker latency campaign was retired with that worker.
- `CLAUDE.md` imports shared instructions from `AGENTS.md`; edit the common source.
- `void-machine self-host sync` then `void-machine self-host doctor` — compile and exercise the current sources as isolated Claude + Codex artifacts. Generated bytes live only under `.void/machine/generated/`; the command never owns native root agent files.

Self-host has one validation: missing, stale or drifted artifacts fail; missing optional runtime
CLIs remain degraded and untested. `self-host doctor` never builds. Legacy rollout receipts
remain readable without changing severity; `--mode` is rejected explicitly. Ordinary `doctor`
checks the published installation at `installRoot`, even in this repository. It is local by
default (`--no-remote` is a compatible no-op); `check` owns remote version comparisons.
The documentary repair flags `doctor --fix` and `--dry-run` are retired.

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

### Inspecting the prepared CLI

`conformance:pack` checks original tracked deliveries with `derive:check` before
any lifecycle generation, then packs once with pnpm. Its manifest binds source
SHA, package name/version, digest and workflow run/attempt. Consumers reject a
different checkout, changed checkout, run or digest; merge groups use their
combined SHA through the existing `GATE_SHA` expression.

`check:publish` and `check:size` read `VOID_CONFORMANCE_TARBALL` when supplied.
Without it, each command checks freshness and prepares its own temporary CLI
archive, including on an edited development tree, without claiming a clean HEAD
attestation. Full `verify` shares one invocation-owned preparation on a clean
tree; edited trees retain independent preparation. No artifact cache or
cross-OS node_modules transfer is involved.

Checkout trust tests own their fixture repositories and never rely on maintainer-local
ignores or self-host outputs being absent. Mission, independent-review and publication
proofs remain separate from native CI outcomes.
