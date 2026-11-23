# Migrating to 4.0

The product is renamed: void-harness becomes Void Machine. The repository is
`voidcorp-core/void-machine`, the npm package `voidmachine`, the command
`void-machine` (alias `vm`). Nothing you wrote has to change for 4.0 to work;
what follows is what to rename at your own pace.

## Upgrading

```
npx voidmachine@latest update
```

The 3.x releases stay on npm under `voidharness`; a 3.x project is never told to
fetch a `voidmachine@3` that does not exist.

## What `update` takes over for you

The blocks a 3.x install wrote carry the former name. 4.0 reads both names and
writes the new one, replacing each old block where it stands, never beside it:

| Block | 3.x marker | 4.0 marker |
| --- | --- | --- |
| CLAUDE.md, AGENTS.md | `<!-- void-harness:begin -->` | `<!-- void-machine:begin -->` |
| `.gitignore`, `.git/info/exclude` | `# void-harness:begin` | `# void-machine:begin` |
| `.void/machine/checkpoint.md` | `<!-- void-harness:context-continuity:begin -->` | `<!-- void-machine:context-continuity:begin -->` |

Checkpoint blocks from either namespace are now legacy: the semantic resume parser ignores
them. Hooks no longer rewrite checkpoints; existing files are left intact.

## What stays working, and what to rename

- **The `void-harness` command** is still installed and still runs the CLI, with
  a one-line notice on stderr. Scripts and CI steps can move to `void-machine`
  whenever convenient.
- **`VOID_HARNESS_*` settings** are still read. Each one has a `VOID_MACHINE_*`
  twin that wins when both are set, so renaming one in a shell profile or a CI
  secret takes effect immediately and a stale old value cannot override it:
  `VOID_MACHINE_ALLOW_DANGEROUS`, `VOID_MACHINE_ALLOW_SECRET_EDIT`,
  `VOID_MACHINE_NO_TRIM`, `VOID_MACHINE_TRIM_BYTES`, `VOID_MACHINE_BASE_REF`,
  `VOID_MACHINE_LARGE_CHANGE_THRESHOLD`, `VOID_MACHINE_FORMAT_TIMEOUT_MS`,
  `VOID_MACHINE_TYPECHECK_TIMEOUT_MS`, `VOID_MACHINE_VERSION`.
- **A workflow calling the reusable `enforce.yml`** by the former repository slug
  breaks at the rename: GitHub redirects git and web traffic, never a `uses:`.
  `doctor` reports it; point the reference at `voidcorp-core/void-machine`.
