# DEV-1407: native test projects and retained behavioral evidence

## Scope and source contract

Vitest resolves to **5.0.1** in the unchanged lockfile. The implementation follows the official
[projects](https://vitest.dev/guide/projects), [CLI](https://vitest.dev/guide/cli.html),
[sequence](https://vitest.dev/config/sequence.html) and [pool](https://vitest.dev/config/pool.html)
contracts: inline projects inherit shared options in v5, root global setup runs once, group
ordering separates resource groups, and `list --no-static-parse` evaluates test modules.
A static list is not a runtime collection; neither form executes test bodies.

Three path groups replace the recursive import/annotation classifier and its proof tiers:

| Project | Natural boundary | Budget |
| --- | --- | --- |
| engine | I/O-free `packages/mission-engine/src` | Four workers, group 0 |
| local | Remaining package, repository and app tests | One worker, group 1 |
| network | CLI UI and native daemon/note/signal families | One thread, group 2 |

The mission-engine package is explicitly pure in ARCHITECTURE.md. Local tests include indirect
Git/process fixtures, so their budget is conservative. This reduces concurrency for cheap tests
outside that package; no throughput improvement is claimed. There is no per-file registry,
resource inference, scheduler or new dependency. The shared options, global setup and per-file
setup are unchanged: run-owned home/cache/temp, Git auto-maintenance suppression and teardown
remain. The network runner retains its two-second probe, one 120-second Vitest invocation,
SIGKILL, thread pool, rejected arguments, nonzero failures and explicit unavailable outcome.
Native shuffle/seed remain available for a requested investigation, without a scheduled campaign.

The gate generator and exact-SHA JSON aggregation remain until DEV-1408. Its existing generated
YAML block now calls the native engine/local/network commands; no failed gate is weakened.
Build/pack reuse belongs to DEV-1143, not this change.

## Oracle mapping

The removed oracle validated 24 declarations; it executed **zero** scenarios. This table maps
supported behavior to actual test owners. It does not certify those old labels or manufacture
24 new scenarios. Several historical expectations no longer describe the current public API.

| Historical area | Retained executable proof and current meaning |
| --- | --- |
| Fresh Claude/Codex/both install, local update, delivered skills | `packages/cli/scripts/conformance-install.mjs` exercises all three runtimes, update, ownership recovery and delivered skill paths; `conformance-install.test.ts` tests the orchestrator. `test/cli/runtime.test.ts` proves runtime addition. |
| Adjacent skill and managed collision | `packages/cli/src/lib/local-install.test.ts` proves unowned assets are refused unless force is explicit, adjacent project skills are preserved and never claimed, and all conflicts are reported. The current adjacent-skill case can install other assets successfully; the old blanket refusal declaration was not the product contract. |
| Co-owned config/docs and user modifications | `test/cli/force-preserves-co-owned.test.ts`, `project-skills-stay-visible.test.ts`, `unreadable-settings-is-not-empty.test.ts` and `packages/cli/src/lib/receipts.test.ts` exercise actual bytes, permissions/ownership and force behavior. |
| Transaction and stale-removal rollback | `packages/cli/src/lib/transaction.test.ts` injects failures at mutations 0/1 and asserts byte-for-byte restoration and stale-file recovery. `local-install.test.ts` preserves old doctrine and permissions on publication failure. |
| Corrupt, unsupported or unreadable receipts | Added three cases in `receipts.test.ts` exercise the real reader with malformed JSON, schema version 999 and an unreadable directory. None confers ownership. Separately, existing `commands/update.test.ts` proves legitimate manifest reconstruction, disk-byte checks and receipt precedence. Current `readInstallReceipt` returns undefined, not the oracle's obsolete `INSTALL_RECEIPT_INVALID` diagnostic. |
| Linked worktree roots | `packages/void-machine/test/doctor-contract.test.ts` discovers a linked worktree from nested cwd; `packages/cli/src/commands/update.test.ts` updates the linked install and verifies the owning receipt. |
| Runtime absent and auth ambiguous | `packages/void-machine/test/claude-runtime-contract.test.ts` runs an unavailable executable and a real process producing a structured authentication refusal, admits no result payload and redacts its text. `codex-daemon-contract.test.ts` refuses missing/wrong-version daemon and thread-start rejection with a login remedy. Native runtimes own authentication; no current generic `auth-ambiguous` probe/classification is claimed. |
| Offline plan | `packages/cli/scripts/conformance-autopilot.mjs` exercises current offline fingerprint/judgment and refuses the retired `autopilot plan`; `lib/autopilot/preflight.test.ts` proves no remote probe under offline operation. The old plan API is not recreated. |
| Interrupted release | There is no current Autopilot release/restore API. The label and diagnostic were declarative oracle vocabulary, not an executable recovery proof. Current interruption behavior is concretely covered by `commands/autopilot-review.test.ts`: close an interrupted attempt, reuse a crash-left worktree, stop a reviewer past deadline and recover an orphaned reviewer. This does not claim historical release restoration. |
| Exact SHA / merge refusal | `commands/autopilot-review.test.ts` rejects head/worktree drift; `lib/autopilot/native-review.test.ts`, `loop.test.ts` and `test/autopilot` retain local receipt identity, exact-head admission, holds and merge refusal proofs. |

No supported product behavior was deleted with the oracle. The new receipt tests characterize an
existing safety boundary; they do not change receipt semantics. Cross-platform conformance remains
in CI; local macOS execution is not a claim of Linux/Windows execution.

## Retired campaigns and measurement boundary

This change removes the weekly/manual `test-certification.yml` and `stress-proof.mjs` plus their
exclusive tests. Historical reports/audits remain intact. It removes the oracle schema, manifest,
duplicate validators, typing, exclusive tests and consumer preflight, and the test classifier.

The latency campaign and on-demand syntax-worker benchmark had **already** been removed in
commit `a96a19b6` (DEV-1373): `conformance-latency.mjs` and
`packages/hook-runner/benchmarks/syntax-worker.mjs`. No current benchmark was found to preserve;
this ticket corrects stale documentation and claims zero additional latency-campaign saving.
Actual hook input/protocol/timeout/termination tests remain in `hook-runner/src/cli.test.ts`,
`runtime-input.test.ts`, the consumer hook suite and process adapters. Hook input size bounds
remain tested. No new campaign, cadence or benchmark replaces the removed syntax worker.

## Actual runtime collection reconciliation

The baseline commit `19f1bc6c` and admitted base `150f99b6` have the identical tree
`c3faab426dc2f11593795b1d32081f70d11ef88e`. Its existing successful runtime collection is
reused, not recollected. On the initial migrated candidate, the same native command ran with
`list --no-static-parse --maxWorkers=1 --json=<file>`. Both exited zero.
The comparison counts `(repository-relative file, name)` as a **multiset**, including repeated
names. Worktree prefixes are normalized in both filenames and dynamically generated names.

| Change | Cases |
| --- | ---: |
| Baseline, 343 files | 5,215 |
| Retired classifier tests | -6 |
| Retired stress runner/workflow tests | -5 |
| Retired oracle validator tests | -12 |
| Generic YAML/Bash cases for the deleted certification workflow | -2 |
| New native hook/indirect-subprocess collection proof | +1 |
| New invalid-receipt ownership cases | +3 |
| Final, 339 files | **5,194** |

Two retained descriptions are renamed (campaign → diagnostic seeds; classifier → test setup),
paired one-for-one rather than counted as new behavior. Every other retained `(file, name)`
multiplicity is identical. The same ten repeated keys remain; no duplicate is newly introduced.
After the routing correction below, projects collect engine 765 cases/44 files, local 4,312/286,
network 117/9.
The complete raw before/after collections, normalized comparison and execution logs are retained
in the ignored DEV-1407 task evidence directory; collection alone claims no body execution.

## Executed verification and limits

- RED before migration: the new native local selector and the two changed network argv assertions
  failed (3 failures, 14 passes). A subsequent targeted run exposed a missing ignored
  mission-engine export; building workspace prerequisites resolved that environment failure.
- GREEN: changed collection/verify/runner tests, 60 passes; receipt reader tests, 9 passes.
- One full `pnpm test` invocation on the initial candidate exited zero: engine 765 passes in 1.79 s, local 4,381 passes
  in 364.35 s, network 48 passes in 4.79 s. One pre-existing conditional real-Semgrep case is
  skipped because Semgrep is unavailable. These are observed Vitest durations, not a before/after
  speedup or isolated benchmark. The local duration includes import/worker overhead; preparation
  is separate. No assertion retry or timeout increase was used.
- Workspace build, typecheck, lint, CI projection and `derive:check` pass. Lint reports existing
  warnings/information; changed-file lint passes. Shared setup files and generated deliveries
  have no diff. No consumer floor is activated or repaired by this task.
- Read-only `doctor --no-remote` follows the linked worktree to the root published installation
  and reports seven existing installation checks failed, including manifest drift. This is not
  reported as a green installation; that floor is outside this ticket's mutation scope.
- Independent review and hosted CI remain coordinator-owned on the committed candidate.

Structurally, default suite orchestration now launches three Vitest processes instead of four
(and still one loopback probe). The classifier's file-content reads, the recurring stress
workflow and the non-executing oracle are removed. This does not measure elapsed-time savings,
and the reduced local concurrency can cost throughput. No saving is attributed to already
retired engines, the syntax benchmark, build/pack reuse or the still-existing gate generator.

## Corrected indirect socket routing

Review preparation compared resource membership as well as retained case counts. The initial
candidate incorrectly moved `cli-note-contract.test.ts` (40 cases) and `process-signal.test.ts`
(one case) from the old network group into local. Both import `test/process-signal.ts`, which
opens a real TCP listener on 127.0.0.1. Their fixture bounds (20-second children, 30-second CLI
tests), socket teardown and child cleanup survived, but the local route omitted the required
capability probe and network wrapper's 120-second thread-pool bound. Passing the full suite in a
socket-capable environment did not prove correct capability routing.

The network path now owns the natural daemon/note/signal families. The existing native collection
regression proves that both indirect consumers actually collect in `network`; it failed before
this correction and passes after it. This moves five files (69 cases) from the initial candidate's
local group: CLI note 40, process signal one, note contract 23, legacy note journals three and
runtime note two. Grouping their family also contains future note/signal fixtures without a
per-file exception registry. Alongside the three cheap UI cases grouped with their server,
the corrected network group contains 117 cases versus the original scanner's 86.

Affected verification only: 17 collection/runner tests pass; one network invocation passes all
117 cases in nine files in 25.91 s, within the unchanged 120-second ceiling; changed-file lint
passes. Actual runtime collection of the affected runtime/UI/support paths returns 459 cases.
Its `(file, name)` multiset exactly matches those paths in the prior full collection. Composing
that actual targeted result with unchanged prior entries preserves all 5,194 cases, 339 files
and ten repeated keys. `correction-collection-composed.json` is explicitly a composition, not a
claim of a new full collection. The actual targeted JSON and comparison metadata are retained
separately. Unaffected full-suite proofs are reused; no second full campaign is run.
