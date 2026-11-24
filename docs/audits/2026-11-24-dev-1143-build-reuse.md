# DEV-1143 preparation reuse

The supported publication contract releases the CLI only. Internal workspace
packs remain built for types/tests and bundled assets, but no longer receive
separate publication-safety or size packs. The existing consumer archive sharing
across operating systems is preserved, not counted as a new saving.

Baseline c8f1ba2fa590a339f1aeabd7c9ea48297cef8020, macOS, Node 26.12.1,
pnpm 10.34.5, dependencies already installed with scripts disabled. A PATH wrapper
logged actual pnpm calls, including nested prepack calls; `/usr/bin/time -p`
measured each command once, sequentially, on the same machine.

| Baseline command | Packs | `build:cli` | Elapsed seconds |
| --- | ---: | ---: | ---: |
| `pnpm conformance:pack` | 1 | 1 | 5.03 |
| `pnpm check:publish` | 3 | 1 | 4.72 |
| `pnpm check:size` | 3 | 1 | 4.67 |
| Total | 7 | 3 | 14.42 |

The seven-pack baseline already excludes the retired graph package. Four removed
packs belong to unpublished internal modules, and two CLI packs are avoided by
reuse. Each CLI prepack invokes five package/asset builds. The CLI archive is
914,621 bytes in the retained baseline producer, motivating a 1.1 MB ceiling
instead of the obsolete 2.173 MB budget. Slight size differences between repeated
packs are not interpreted as product savings.

Freshness now runs before pack can regenerate tracked deliveries. The original
RED test committed a stale delivery and observed it repaired before the late
cleanliness refusal. GREEN keeps those stale bytes unchanged and never invokes
pack. A failed preparator never promotes an output directory. Identity tests
reject another SHA, digest, workflow run/attempt or package version. Clean local
verify shares one temporary preparation; a dirty local tree retains autonomous
inspection without claiming a clean commit. Consumer source checkouts must be
clean when using attested bytes.

One offline npm installation per consumer invocation replaces six in the retained
three-suite inventory (one install suite, three hook fixtures, two autopilot
fixtures). The package-name invocation and real init/update operations remain.
Independent writable fixtures remain; no node_modules crosses operating systems.
The historical seven-install and nine-pack baselines included removed suites and
are not this change's measurement.

CI validation still builds its workspace for types/tests, and self-host proves
its separately isolated installation. Release builds the two internal TypeScript
packs after CLI prepack so their exports remain available. No registry-side
publication verification, OIDC separation, lifecycle or native merge SHA binding
is removed. Validation depends on the artifact producer but runs on failure/skip
so a failed producer or a draft cannot become a successful skipped required job.

Local elapsed samples are not GitHub job-minute savings or billed cost. Runner
scheduling, artifact transfer and the added producer dependency affect latency;
CI elapsed time, summed job durations and billing remain unmeasured until a real
candidate workflow runs. No remote permissions or publication settings changed.

Official semantics used: [pnpm 10 pack lifecycle](https://pnpm.io/10.x/cli/pack),
[upload-artifact v7 immutability](https://github.com/actions/upload-artifact/tree/v7),
[download-artifact v7 current-run downloads](https://github.com/actions/download-artifact/tree/v7).

## Observed candidate comparison

Candidate b5cd39580c56fb2712c0efeaa4de1bcef536bc3a, same machine/tools and
installed dependencies, one sequential sample of each retained command:

| Candidate command | Packs | `build:cli` | Elapsed seconds |
| --- | ---: | ---: | ---: |
| `pnpm conformance:pack` | 1 | 1 | 5.60 |
| `pnpm check:publish` with that artifact | 0 | 0 | 0.38 |
| `pnpm check:size` with that artifact | 0 | 0 | 0.37 |
| Total | 1 | 1 | 6.35 |

The producer includes the new pre-generation freshness proof, costing one
additional mission-engine build. The trace therefore records six individual
package/asset build calls after, versus fifteen before; it does not pretend
freshness is free. Total local elapsed for this path was 14.42 s before and
6.35 s after. This is a single comparable local observation, not a CI latency
or billing forecast.

Real conformance, against each candidate's own verified CLI archive, passed all
three suites: 19.84 s before, 17.11 s after. The npm trace proves six installs
plus one package-name exec before, one install plus one package-name exec after.
The baseline used an isolated clean clone of c8f1ba2; the candidate used its
clean worktree. Each invocation created fresh fixture homes/caches, with no
shared node_modules or consumer data across these measurements.

The same candidate passed standalone safety and size on an edited tree before
commit. Clean/dirty preparation routing and failed-preparator refusal are also
exercised by real child-process fixtures. Detailed logs remain in the task's
local handoff evidence; CI and the independent exact-head review are coordinator
responsibilities, still outstanding at writer handoff.

## CI admission correction

The first candidate run [45435504694](https://github.com/voidcorp-core/void-machine/actions/runs/45435504694)
was rejected before any job started; this is not a failed package assertion.
The new artifact path had used `runner.temp` in `jobs.validate.env`, where that
context is unavailable. GitHub's [context availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
allows it in `jobs.<job_id>.steps.env`. The catalogue now places the variable on
only the safety and size steps, using its existing `ciEnv` projection. The
focused regression refuses the runner context in the job header and requires
the two step environment bindings. No packaging, assertion, permission or
artifact identity behavior changes; the earlier runtime measurements remain
applicable. A new candidate CI run is still needed to establish remote admission.

## CI output isolation and existing-contract corrections

[Run 45436355453](https://github.com/voidcorp-core/void-machine/actions/runs/45436355453)
on 7644b82 passed enforcement and conformance on Linux, macOS and Windows, but
failed validation. Its safety/size readers correctly rejected untracked gate
reports created by earlier steps. The checkout-trust test additionally depended
on the caller's repository cleanliness after self-host generation. Local Git
ignores had hidden those outputs during the earlier writer checks.

Generated CI now stores reports below `$RUNNER_TEMP/gate-reports`; the existing
report reader/writer accepts that declared runner directory as well as repository
paths and still refuses external siblings. A real-process test proves writing a
report leaves the source checkout clean. The checkout trust fixture now uses
owned repositories, independent of self-host outputs, and explicitly refuses both
modified tracked bytes and a new untracked source. The production cleanliness
guard has no new exclusions. Self-host's existing output contract is unchanged.

Temporary labels no longer use the reserved skill prefix. Package fixture names
come from the canonical product identity, and the identity guard is unchanged.
Existing admission assertions now prove validation remains admitted after a
failed/skipped producer unless cancelled, with draft refusal still inside the
required job. Release assertions check preparation once, internal export builds,
types/tests and safety/size before binding the exact tarball, without OIDC or
repacking. The pre-generation stale-byte and canonical-rename process tests
remain the behavioral proof for those boundaries.

The CI-derived failures were reproduced before correction (five failed tests and
unresolved temporary identifiers). The affected verification set passes 135 tests
in 12 files; affected lint, CLI types and skill references pass. This is a bounded
correction before the first independent review, not a replay of the earlier
unrecorded broad test invocation. A new-head CI run remains required.
