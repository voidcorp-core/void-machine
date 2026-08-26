# `voidharness`

CLI for the [void-harness](https://github.com/voidcorp-core/void-harness): register the marketplace, enable the `harness` core plugin plus the stack packs a project needs, and health-check the setup.

## Quick start

```bash
# In any project: register the marketplace, enable core + the packs you pick,
# scaffold .void/config.json, and patch CLAUDE.md / AGENTS.md.
cd my-project
npx voidharness init                          # core only
npx voidharness init --pack pack-nextjs --pack pack-monorepo

# Verify the setup (offline-friendly)
npx voidharness doctor
```

Pack names accept any form: `pack-nextjs`, `harness-nextjs`, or `nextjs`.

## Commands

### `init`

Sets up the current project:

- Creates `.void/config.json` (pinned plugin versions, stack, paths, TDD modes)
- Registers the marketplace in `.claude/settings.json` and enables `harness` plus the chosen packs
- Patches `CLAUDE.md` / `AGENTS.md` (sister docs, cross-referenced)

```
npx voidharness init [--pack <name>...] [--all-packs] [--force]
```

After `init`, restart Claude Code; skills appear as `/harness:<name>` and `/void-<pack>:<name>`.

### `add` / `remove`

Enable or disable a pack on an already-initialized project (updates `.claude/settings.json` and `.void/config.json`).

```
npx voidharness add pack-nextjs
npx voidharness remove pack-nextjs
```

### `doctor`

Health-check: `.void/config.json` validity, marketplace + plugins registered in `.claude/settings.json`, the CLAUDE.md block, `jq` (required by the hooks), and version drift against the marketplace HEAD. `--no-remote` runs fully offline. Exit `0` if all checks pass, `1` otherwise.

```
npx voidharness doctor [--no-remote]
```

### `list` / `check` / `update`

`list` shows packs and their detection status; `check` reports version drift; `update` refreshes pinned versions.

### `decisions`

Creates, validates and projects ADRs without a shared counter or generated
index. Existing decision directories are preserved; new projects default to
`docs/decisions/`.

```bash
npx voidharness decisions new --title "Use X" --slug use-x
npx voidharness decisions check [--base <git-ref>]
npx voidharness decisions render --format markdown|json
```

Accepted decision content is immutable. Reverse it with a new record and
`--supersedes <adr:id>`. A proven repository-local path substitution is the
only in-place exception; the new target must exist and the surrounding record
must remain unchanged. Rendered views expose both declared and effective status
and identify the records that supersede an older decision.

### `install --global`

Escape hatch (rare): installs the `harness` plugin at the user-global level (`~/.claude-plugin/plugins/harness/`) instead of per-project. The recommended flow is `init`.

```
npx voidharness install --global [--dry-run]
```

### `help`

Print the command reference.

## License

MIT.
