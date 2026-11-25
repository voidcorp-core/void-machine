# `voidmachine`

CLI for the [void-machine](https://github.com/voidcorp-core/void-machine): register the marketplace, enable the `harness` core plugin plus the stack packs a project needs, and health-check the setup.

## Quick start

```bash
# In any project: register the marketplace, enable core + the packs you pick,
# scaffold .void/config.json, and patch CLAUDE.md / AGENTS.md.
cd my-project
npx voidmachine init                          # core only
npx voidmachine init --pack pack-nextjs --pack pack-monorepo

# Verify the setup (offline-friendly)
npx voidmachine doctor
```

Pack names accept any form: `pack-nextjs`, `harness-nextjs`, or `nextjs`.

## Commands

The generated `cheatsheet` command and its HTML, Markdown and JSON exports
have been removed. See the [essential workflow guide](https://github.com/voidcorp-core/void-machine/blob/develop/docs/CHEATSHEET.md),
use native skill discovery in your runtime, or run `void-machine --help`.
Invoking the former command follows the unknown-command contract (exit 2).
Previously exported files are left untouched.

### `init`

Sets up the current project:

- Creates `.void/config.json` (pinned plugin versions, stack, paths, TDD modes)
- Registers the marketplace in `.claude/settings.json` and enables `harness` plus the chosen packs
- Patches common `AGENTS.md`; Claude receives a native `@AGENTS.md` import in `CLAUDE.md`

```
npx voidmachine init [--pack <name>...] [--all-packs] [--force]
```

After `init`, restart Claude Code; skills appear as `/harness:<name>` and `/void-<pack>:<name>`.

### `add` / `remove`

Enable or disable a pack on an already-initialized project (updates `.claude/settings.json` and `.void/config.json`).

```
npx voidmachine add pack-nextjs
npx voidmachine remove pack-nextjs
```

### `doctor`

Health-check the published installation at `installRoot`: configuration, doctrine, file integrity, runtime wiring and CLI/layout compatibility. This is local in every repository, including the source checkout; `--no-remote` is a compatible no-op. Use `check` for remote version comparisons. Exit `0` without blockers, `1` on installation failures. The retired `--fix` and `--dry-run` flags exit `2` with a diagnostic.

```
npx voidmachine doctor [--no-remote]
```

### `list` / `check` / `update`

`list` shows packs and their detection status; `check` reports version drift; `update` refreshes pinned versions.

### Decision records: breaking command removal

`decisions new`, `decisions check` and `decisions render` have been removed.
Remove calls to them from scripts and CI. Write Markdown files with light YAML
frontmatter directly, following `void-decide`: a stable unique `id`, `title`,
`createdAt` or `date`, `status`, and optional `supersedes` references.
No replacement CLI, schema gate or generated index is required.

Keep existing records, IDs, metadata and links. Ordinary wording and link corrections
use normal Git commits; a material change creates a new record linking its
predecessor. Established directories remain valid; new projects may use
`docs/decisions/`. The projects view and separate
conformance capability remain available with their existing parsing limits.

### `install --global`

Escape hatch (rare): installs the `harness` plugin at the user-global level (`~/.claude-plugin/plugins/harness/`) instead of per-project. The recommended flow is `init`.

```
npx voidmachine install --global [--dry-run]
```

### `help`

Print the command reference.

## License

MIT.

## Evaluation and usage retirement (breaking removal)

The `mission usage-bind`, `mission usage-unbind`, `mission advisory-start` commands
and `mission inspect --usage` option are removed. Use ordinary `mission inspect`
for mission verdicts and `agents status` for observed workers. The eval workspace
and root `pnpm eval` script no longer exist; optional scenarios and historical
reports remain in `apps/eval-harness/README.md`.

The `@voidcorp/hook-runner` invocation-health exports are removed:
`cachedInvocationAlert`, `refreshInvocationVerdict`, `invocationAlert`, `journalFingerprint`,
`installedSkillNames`, `resolutionVerdict`, `livenessVerdict`, `replacementFor`,
`withSuccessor`, `ResolutionVerdict` and `LivenessVerdict`. Consumers should remove
usage-based health calls; no replacement absence-of-use heuristic is provided.
Doctor retains installation and runtime wiring diagnostics. Existing journals and
caches remain untouched; startup no longer reads or refreshes invocation alerts.

## Graph, audit and score retirement

Breaking removal: the CLI no longer accepts `graph` (including project,
knowledge, impact, owners, tests-for, path, live, build and check variants), `why`
or `audit`. The `void-graph` and `void-audit` skills, graph studio, bundled graph,
frozen certification and local `backlog:index` generator are retired.

The public `@voidcorp/harness-graph/project` API and root package exports are
removed from the workspace and release inputs. Consumers must remove those
imports or stay on an earlier release that supplies them. There is no compatible
replacement API; this change does not unpublish historical releases.

Use Git and repository search for navigation, and the compiler, linter and
applicable tests for verification. These do not reproduce graph topology,
automatic impact analysis or test selection. Do not narrow verification by
claiming the removed graph has established the affected scope.

`status` now reports installation receipt/version and detected runtime facts
(`installed`, `wired`, `fired`, `observed`), with unavailable evidence shown as
`unknown`. Its current `.void/machine/status.json` snapshot is schema version 2;
readers must stop expecting `score` or `capabilities`. `doctor`, Projects UI,
project discovery, checkpoint/resume and canonical mission/review/worker proofs
remain available.

No command removes historical graph caches, custom knowledge files, score
history, usage logs, reports or local backlog exports as part of this retirement.
Old files are historical inputs owned by the user, not a reason to recreate the
removed engine. Installation/update retains the existing ownership/conflict
rules for shipped assets; customized assets are not silently overwritten.
