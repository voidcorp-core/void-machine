# Stable CLI and project updates

After a release containing the stable update protocol is published, bootstrap with
`npx voidmachine@<released-version> update`. The older npm CLI cannot supply the new
update behavior itself. No version is changed by hand.

```sh
void-machine update                         # stable CLI and current installed project
void-machine update --all                   # complete configured discovery set
void-machine update --dry-run               # prepare without publication
void-machine update --version X.Y.Z         # one exact stable release, no downgrade
void-machine hydrate                        # offline, exact manifest version only
```

Outside an installed project, update explicitly reports CLI-only selection. A nested
working directory selects its enclosing installation. Linked worktrees resolve to the
canonical installation and are deduplicated. `--all` uses the existing discovery roots
in `voidGlobalDir()/discovery.json`, or that discovery owner's documented derived roots.
Unreadable configuration, incomplete scanning or missing installation records refuse.
The complete canonical target list and installed versions are printed before acquisition.

Output identifies the executing CLI, current managed default and pinned target. The
registry is resolved once; changing its tag cannot change an operation already prepared.
Tarball SHA-512, package identity, Node engine, supported schemas and runtime adapters
are checked before candidate execution. The target's bundled compiler prepares and
smokes the final projection, including retained user assets. Native runtime versions are
not certified by these synthetic installation probes; native trust remains in its UI.

The store is `voidGlobalDir()/cli` (normally `~/.void/cli`). Immutable completed releases
live under `releases/<version>/node_modules/voidmachine`; `active.json` selects one.
The stable launcher runs offline without a checkout, preserving arguments, working
directory and process exit/signals. POSIX uses env Node; Windows adds command and
PowerShell adapters. No Node installation, global skills, shell configuration or native
trust changes are performed. PATH conflicts are reported. Refresh a shell's cached
command selection after bootstrap if required.

Bootstrap adopts only qualified package/bin links, a literal known source wrapper,
or exact known npm11 Windows wrappers with a matching package/bin declaration.
Unknown canonical launchers refuse; unrelated aliases remain untouched and are named.
The first launcher snapshot stays in `cli/bootstrap`; later operations do not overwrite
it. Prior completed releases remain available. Update does not automatically fall back
to a checkout or execute an unverified package.

All selected projects are prepared before publication. File hashes and native modes are checked
again during transaction preparation and before each write. Projects publish serially,
then launchers, then active selection. This is recoverable publication, not a filesystem-wide
atomic transaction. A handled failure restores operation-owned states. After interruption,
repeat the same selection to recover before beginning another update. A live updater
blocks another updater; an old timestamp alone never permits lock takeover.

The journal measures the filesystem's representation of a requested mode before publishing;
it does not pretend Windows implements POSIX execute/owner bits ([native mode semantics](https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c#L1712-L1762)). Recovery covers process
interruption, not a power-loss durability guarantee for every filesystem or storage device.

When recovery finds a later edit, it preserves the edit, names its path, exits nonzero
and keeps `cli/operation` snapshots. Preserve that evidence while resolving the named
conflict. Do not delete a lock or journal merely to make a refusal disappear. Malformed
or unreadable recovery records refuse explicitly. Dry run refuses a pending recovery;
repeat the original command without `--dry-run` first. Dry run may populate the reported
staging/cache and transient lock, but never publishes project, launcher or active files.

Custom settings, retained packs, authored doctrine, custom hooks and native permissions
follow existing co-owned merges. Managed assets restored from the release are named.
Retired packs, invalid/future schemas and contradictory records refuse before publication.
A manifest-only clone is supported when runtime selection can be established. An older
CLI cannot mutate a newer installation; use update to acquire a compatible candidate.
Doctor reports the same compatibility verdict while read-only diagnostics stay available.

The only automatic programme policy migration is proven equivalence. A schema1 human gate
becomes schema2 with its human hold published first, preserving enabled/disabled consent,
comments, unrelated YAML and existing hold bytes. Missing, damaged or union-reviewed
policy is never guessed equivalent. No programme is created or relocated by update.

`--local`, `--cache-only`, `--pins-only`, `--force`, `--untrack-derived` and marketplace
conversion are unsupported here. Use `hydrate` for exact offline materialization.
Preserve and explicitly reconcile legacy layouts before stable update. Tracked generated
files need a separately reviewed `git rm --cached` limited to the intended paths; update
does not alter the index or retire a project registry. These boundaries replace the older
public update behavior described in historical migration documents.

## Verification ownership

The single packed behavior owner is `packages/cli/scripts/conformance-update.mjs`.
`conformance-install.mjs` invokes it after its existing Claude/Codex/both init/hydrate
and receipt-recovery proofs. All existing hooks, Autopilot and latency conformance remain.
The exact-SHA `consumer-artifact` job runs `pnpm conformance:pack` once. Every
`install-conformance` matrix job runs this unchanged command on that artifact:

```sh
pnpm conformance:consumer --tarball "${{ runner.temp }}/void-consumer-artifact/consumer.tgz"
```

| Existing CI job | Actual stable-update execution |
| --- | --- |
| `install conformance (ubuntu-latest)` | npm-generated POSIX bins adopted; direct executable `void-machine` and `voidmachine`; offline version from unrelated cwd after bootstrap package disappears; real update, interruption and recovery through the new executable |
| `install conformance (macos-latest)` | The same POSIX executable and recovery proof on macOS |
| `install conformance (windows-latest)` | Actual npm-generated Windows bins adopted; `cmd.exe /d /s /c` executes both new `.cmd` aliases; `powershell.exe -NoLogo -NoProfile -NonInteractive -File` executes both `.ps1` aliases; actual update, interruption and recovery through the new `.cmd`, followed by the recovered `.ps1` |
| `validate` | `test/cli/stable-update-packed.test.ts` is a focused adapter to the same six phases on the host OS; it does not certify other OSes |

The six shared phases prove complete-all preview without activation, manifest-only current
project update with an unchanged unselected project, explicit all-project update, termination
after the launcher rename before active selection, rollback before deliberately failed network
acquisition, and successful repeated invocation. A test-only Node preload instruments the
actual filesystem rename and kills the child; it adds no production fault flag. Receipt,
authored configuration/doctrine, managed before/after bytes, active selection and journal
postconditions decide success. Installed sensitive-path/content probes still deny writes.
Registry transport supplies the same pinned verified tarball; npm extraction and all child
execution are real and isolated. Existing finite process deadlines remain unchanged.

Focused adjacent tests own artifact validation, candidate scope, policy preservation,
locking, concurrent edits and canonical selection. The shared guard precedes init, add,
remove, hydrate, runtime add, install, doctor fix, graph publication, decision creation,
mission mutations (including dispatch), native agents spawn/attach, adoption apply,
security mutations and Autopilot effects. Read-only help, inspection and diagnosis remain
available; public update performs recovery before its own target compatibility preparation.
Final integrated evidence belongs to the exact candidate commit and ORCH's canonical verification.
Publication and real Machine/Cortex rollout are separate acceptance evidence, never
inferred from isolated fixtures. See the approved DEV-1022 spec and execution plan.
