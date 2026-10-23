---
title: Stable versioned CLI and unified project update
date: 2026-10-13
status: approved
author: Folpe + Codex
ticket: DEV-1022
related:
  - 2026-07-21-void-harness-public-multiruntime-os.md
  - 2026-09-10-consumer-version-compatibility.md
---

# Stable versioned CLI and unified project update

## Request and verified problem

Folpe requests a stable published CLI independent of the open source checkout,
one update command for CLI and installed project harness, explicit incompatibility
detection, and preservation of project configurations. He selected: current project
by default, all projects only through an explicit option.

On 2026-10-13 the local `~/.local/bin/void-machine` shell launcher directly executes
`/Users/folpe/Developer/void-machine/packages/cli/bin/void-machine.mjs`, using a
hardcoded Node executable. The checkout is on a personal branch. Installed consumer
hooks are 5.0.1, while this CLI reads its version and implementation from that branch.
The observed command is therefore neither the stable release nor independent of Git.

Qualification update, 2026-10-13: the coordinator subsequently observed
`~/.local/bin/void-machine` as a symlink to
`../lib/node_modules/voidmachine/bin/void-machine.mjs`, with package identity
`voidmachine@5.0.1` and symlink mtime `2026-10-13T16:49:40Z`. The `voidmachine`
alias also exists. This supersedes the earlier observation as the machine's current
bootstrap state; it does not erase the historical checkout-wrapper problem.
Bootstrap must handle verified npm-owned bins as well as an identified source
wrapper. Verify the package/bin relationship before adoption; a path convention
alone does not establish ownership. Worker qualification uses isolated homes only.

At source commit 7c17790eb70d3ab489c9bab9138ad01e5fcc50f4:

- `packages/cli/src/commands/update.ts:478` materializes the running CLI's bundled
  assets; it does not upgrade that CLI. It starts migrations before validation.
- `packages/cli/src/lib/local-install.ts:171` prepares owned file changes;
  `lib/transaction.ts:107` rolls back caught failures within one project. Neither
  proves crash recovery nor a global CLI/project transaction.
- `commands/doctor.ts:132` rejects a stale executable, but `update` lacks that guard.
- `commands/init.ts:516` can warn and drop an unknown selected pack. That is not
  acceptable preservation for an unattended version upgrade.
- `lib/projects/catalog.ts` already owns bounded cross-project discovery. A second
  project registry is unnecessary.

## Options and decision proposed for approval

1. **Recommended: versioned local release installation plus stable launcher.**
   Resolve a release once, stage that exact npm artifact, validate compatibility,
   update the selected project(s), then activate the new executable. The previous
   release remains available for recovery. Reuse npm distribution and the existing
   project installation transaction; no daemon or source build.
2. **Smallest alternative: launcher running npx latest.** It removes Git coupling,
   but default execution depends on mutable release/cache resolution and does not
   coordinate the project installation or recovery. It misses the requested contract.
3. **Most ambitious: continuously reconcile all projects in the background.** This
   would avoid explicit updates entirely, but adds a daemon, concurrent writes and
   background consent. It conflicts with the selected current-project default.

A per-project package dependency would improve reproducibility differently, but
would add harness dependencies and lockfile changes to every consumer. Keep the
existing project-local materialization contract instead.

## Public behavior

- `void-machine update` updates the managed CLI and the current installed project's
  harness to one exact stable release. Outside a harness project, it updates only
  the CLI and says explicitly that no project was selected; it never implies init.
- `void-machine update --all` selects installed projects from the existing configured
  discovery roots. It prints the complete canonical target set, deduplicates shared
  installation roots, and refuses incomplete discovery or ambiguous ownership.
  It never scans arbitrary disk locations or treats unrelated directories as targets.
- `--dry-run` resolves the target and performs compatibility/planning without changing
  active CLI, project files, registry configuration or Git. Downloads may populate a
  separate staging/cache area and must be reported as such.
- Exact-version acquisition remains available for reproducible execution and tests.
  Default update selects the stable channel once, excludes prereleases and refuses
  unintended downgrades. A moved registry tag cannot change an in-progress target.
- Existing local/cache/pin options and marketplace installs are explicitly classified
  before any write. Unsupported combinations fail with a precise remedy; the new
  flow never silently converts a marketplace installation into a local one.
- Ordinary commands and runtime hooks perform no implicit self-update, project update
  or network fetch. Installed releases remain executable offline.
- Output identifies executing CLI version, active default CLI version, each project's
  installed harness version, target, and outcome. A generic green message cannot hide
  a preserved old version or partial failure. Automation receives a nonzero exit on
  any incompatible, failed or unrecovered selected target.

## Installation and independence

Use a user-owned versioned release store outside all source checkouts and a stable
launcher in the user's command path. Exact layout and platform adapters belong in
the plan. Each release is an immutable complete published package, with its bundled
assets and validated identity/integrity; npm manages package acquisition and any
package-manager lockfiles. No hand-edited versions or generated lockfiles.

The launcher delegates to the active installed release, preserving arguments, exit
status, signals and working directory. It does not depend on a Git branch, worktree,
source `dist`, repository dependencies or the current working directory for its own
implementation. Validate the selected Node engine; do not embed a development Node
path or install a new runtime silently.

The first migration backs up the identified checkout-based launcher and replaces it
only after the stable release passes its smoke checks. Preserve unknown user-owned
executables and shell configuration; report PATH conflicts instead of overwriting
unrelated commands or relying on a shell cache. Platform support follows the existing
macOS/Linux/Windows CLI contract. Keep npm aliases coherent without claiming ownership
of unrelated user aliases. No global harness skills or hooks are installed.

## Compatibility before effects

One shared preflight classifies compatibility before layout migration, receipt repair,
Git-exclude changes, project publication or launcher activation. Both `update` and
ordinary project-mutating CLI paths consume the same verdict; doctor reports it.
Read-only diagnostics remain available to explain a refusal.

Check actual package identity/version and Node requirements, installed receipt and
manifest agreement, supported configuration/program schemas, selected packs, runtime
adapter contracts and the versions of the selected installed Claude/Codex runtimes
where the package declares requirements. Missing runtime/version evidence is reported
as unknown or blocking according to the operation, never invented compatible.
Runtime trust still belongs to its native UI; the updater cannot approve it.

Compatibility must be declared by the release contract and exercised by tests;
version equality or 'newer CLI is always compatible' is not a substitute. A missing,
malformed, unsupported or contradictory record is not an absent installation. A
supported manifest-only clone remains an explicit rehydration case with ownership
checks. An older executable cannot silently replace newer installed assets.

Updating the global CLI must not write other projects. When later invoked in an
unselected incompatible project, it must diagnose that mismatch before effects and
point to the same update command. It must not silently run against incompatible
state. Retained releases permit recovery; no automatic checkout fallback is allowed.

## Configuration preservation and migrations

Preserve project settings, selected packs, runtime selection, custom hooks, nonmanaged
instruction text, authored doctrine, permissions, merge policy, runtime trust and
unrelated assets. Reuse the existing co-owned merge and hash-ownership rules. Preserve
source-repository canonical doctrine even when its working branch differs from release.

A removed/renamed pack or incompatible setting is an explicit preflight result, never
a warning followed by dropping it. Managed-file restoration follows the existing
ownership policy and reports changes. No implicit force, permission broadening,
secret access, dependency change, Git checkout, commit or push.

Apply only deterministic migrations with known equivalent behavior, with the changed
paths reported and included in recovery. For example, moving a human-merge policy
must preserve that hold, including the relevant machine-local policy record. If the
old meaning cannot be preserved, refuse before writes and explain the required
choice. An unrelated runtime process is never restarted automatically; report when
a session reload or native trust review is still required.

## Transaction, concurrency and recovery

Reuse project staging, ownership and smoke checks. Verify the actual final projected
file set after preservation/collision decisions, not only a pristine staged harness.
Move update-owned layout/receipt/exclude effects into the recoverable scope or remove
them from the path; do not claim full rollback while such writes remain outside it.

Prepare the target release and all selected projects before publication. Serialize
project application to limit memory and file races. Hold a bounded exclusive update
lock and revalidate snapshots before replacing files; never overwrite concurrent
user/agent changes. Activate the new default CLI only after selected projects pass.

Persist enough bounded local operation state and backups for recovery across process
interruption. On a handled failure restore the prior CLI selection and affected
project files/modes. On interruption the next same update command reconciles the
recorded operation before starting another. Never overwrite a post-interruption user
edit during rollback: retain evidence and report the exact conflict. Multi-project
publication is recoverable and serialized, not falsely described as a filesystem-wide
atomic transaction. No green partial success and no manual version synchronization
are part of the normal successful path.

## Tests and delivery acceptance

Strict TDD for release resolution, version/schema compatibility, ownership decisions,
activation and recovery. Sequential integration tests use isolated homes, bounded
fixtures and fake transports where appropriate; prove the actual packed CLI as well.
No large concurrent local suites; broad OS/runtime certification remains in CI.

Required observations:

1. The installed CLI still runs when the source checkout is absent or on another
   branch. CLI, bundled assets and project receipt identify the intended release.
2. One update handles CLI and current project; other project files remain unchanged.
   The explicit all-project form uses a complete validated set and one exact target.
3. Offline ordinary use succeeds. Network/package/integrity/engine failures keep the
   old active installation; registry movement cannot change the resolved target.
4. Stale CLI, future/invalid schemas, manifest-only clone, retired pack and unsupported
   runtime cases produce specific truthful outcomes before project changes.
5. Custom config/doctrine/hooks/packs and human-merge policy survive. Tests include
   the 4-to-5 programme change which previously required manual reconciliation.
6. Failed smoke, interrupted update, repeated invocation, concurrent update and a
   conflicting user edit exercise recovery without false success or lost changes.
7. The actual projected consumer installation passes smoke and installed hook probes;
   sensitive-path/content protection remains active. No real secret fixture is used.
8. After normal publication, replace this machine's source launcher, update Machine
   and Cortex through the supported command, verify preserved configuration hashes,
   exact installed versions and independence from the personal branch. Other projects
   require explicit all-project selection; workers close after results are collected.

## Prior decisions and source grounding

Preserve exact offline `hydrate` semantics from
`../decisions-log/2026-08-04-exact-rehydration-manifest--36a1df8a-0356-45f6-9cf0-d740f5e73598.md`.
Acquisition belongs to explicit update, not hydrate or session startup. The accepted
ADR remains immutable; implementation records the deliberate explicit-update boundary
in a new ADR and supersedes only any incompatible provision if necessary.

Preserve project-local assets and advisory freshness from the local-runtime-assets
and freshness-cache decisions. The CLI and assets retain release-please lockstep;
this feature does not create another release cadence or a private distribution feed.

Installed npm observed: 11.20.0; Node: 24.15.0. Official npm 11 documentation grounds
exact package installation, prefix isolation, disabled install scripts, cache behavior
and explicit engine validation. Implementation must verify its exact selected flags:

- https://docs.npmjs.com/cli/v11/commands/npm-install/
- https://docs.npmjs.com/cli/v11/commands/npm-exec/
- https://docs.npmjs.com/cli/v11/using-npm/config/

Self-review: current behavior and sources verified; current-project default confirmed
by Folpe; recovery limitations explicit; no placeholder design choice or automatic
permission widening. Written contract approved by Folpe on 2026-10-13; proceed to planning and implementation.
