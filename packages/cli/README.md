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
- Patches `CLAUDE.md` / `AGENTS.md` (sister docs, cross-referenced)

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

Health-check: `.void/config.json` validity, marketplace + plugins registered in `.claude/settings.json`, the CLAUDE.md block, `jq` (required by the hooks), and version drift against the marketplace HEAD. `--no-remote` runs fully offline. Exit `0` if all checks pass, `1` otherwise.

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
`docs/decisions/`. The projects view, declared graph/why readers and separate
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
