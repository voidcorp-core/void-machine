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
