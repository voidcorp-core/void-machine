---
title: Opt-in knowledge post-commit hook
date: 2026-09-16
status: implementing
spec: docs/specs/2026-09-15-approved-six-ticket-cluster.md
ticket: DEV-611
---

# Implementation contract

Deliver the approved opt-in post-commit adapter using the existing project graph
builder. This plan incorporates preparation findings
`bound-post-commit-regeneration-duration` and `commit-latency-proof-missing`.
It records requirements, not execution evidence or benchmark results. The frozen
mission ticket remains unchanged. Implementation awaits the coordinator's handoff.

## Authority and source anchors

- [Approved scope](../specs/2026-09-15-approved-six-ticket-cluster.md) and
  [coordination plan](2026-09-15-approved-six-ticket-cluster-plan.md) restrict this
  unit to the hook; checkpoint, programme and CI freshness retain their contracts.
- [Knowledge specification](../specs/2026-08-17-project-knowledge-system.md)
  preserves `PROJECT_CACHE_READ_ONLY`. Its historical approximately 3.5 second
  reconstruction observation is a planning reference, not a current benchmark.
- `packages/cli/src/lib/project-knowledge.ts` owns serialization and transactional
  publication. It currently writes even identical output; the bounded correction
  compares actual serialized bytes before entering that transaction.
- `packages/cli/src/commands/graph.ts` already composes `buildProjectGraph` and
  `writeProjectKnowledge`. Preserve `graph project-build` / `knowledge-build` and
  `graph project-check` / `knowledge-check`, including their error contracts.
- `packages/harness-graph/src/project/build.ts` returns `cacheStatus`,
  `cachePublished`, issues and metrics; `project-build-context.ts` supplies
  scanned/read/hashed/extracted/reused file counts. Reuse these observations.
- Installed Git preparation anchor: 2.50.1 (Apple Git-155). Official sources read:
  [hooks](https://raw.githubusercontent.com/git/git/v2.50.1/Documentation/githooks.adoc),
  [path resolution](https://raw.githubusercontent.com/git/git/v2.50.1/Documentation/git-rev-parse.adoc),
  [core.hooksPath](https://git-scm.com/docs/git-config/2.50.0).
  Git executes post-commit after committing, from the non-bare worktree root;
  relative hooks paths use hook execution cwd. Merge has a distinct event.
  Rebase coverage must be observed, not inferred from its name.

Full native DEV-611 and relations were read during preparation. DEV-610 and
DEV-619 were independently re-read and both report Done. Reobserve before coding;
the coordinator owns claims, mission events, panels, integration and publication.

## Public interface and ownership

`void-harness knowledge hook install` and `void-harness knowledge hook uninstall`
are the public commands. Register them through the existing command catalogue,
main dispatcher and help renderer. Help and invalid arguments cannot mutate.
An internal `knowledge hook run` route may support the installed adapter; it is
not a new general regeneration API and receives the same root/safety checks.

Installation resolves the local installed executable and quotes its invocation;
no network, package installation or npx lookup is allowed. The executable adapter
stays at most 100 lines. Installation is never implicit in init or update.

Resolve effective hooks location using Git, including linked worktrees and
core.hooksPath, without modifying Git configuration. Reject bare/non-repository
contexts, symlink escapes, unsafe targets, external/shared destinations whose
ownership cannot be established, and ambiguous locations. Report the path and
reason. Same-repository common hooks are allowed only with output naming their
linked-worktree scope. Resolve the current worktree at invocation time.

Install succeeds without rewriting a byte-identical managed adapter. Preserve
every unknown existing hook and refuse composition: no wrapping, renaming,
appending or force option. Uninstall removes only the exact owned adapter;
absence is a successful no-op, and modified managed bytes are a visible conflict.
Install/uninstall return nonzero on unsafe targets, conflicts or write failures.

Implementation ownership is exactly the frozen ticket's list: CLI
`lib/project-knowledge.ts` and test, new `lib/knowledge-hook.ts` and test, new
`commands/knowledge-hook.ts` and test, main/help/command-catalog and their tests,
`test/cli/knowledge-hook.test.ts`, `docs/ARCHITECTURE.md`, this knowledge-hook plan,
and declared generated assets (`packages/core/data`, core graph bundle,
`packages/cli/core-assets`, CHEATSHEET and SKILL-REFERENCES). Derived files use
existing generators under the coordinator's serialized RUN allocation.
Signal any required widening, including a structural ADR, before writing it.

## Foreground completion and recovery

The hook returns zero on every regeneration outcome. The commit already exists;
there is no staging, amend, automatic follow-up commit or index snapshot.
Missing `.void` produces a visible skip without creating an installation.
Changed output explicitly says the artifact remains in the working tree for
review and a later human commit. Identical bytes preserve both bytes and mtime.
Never say the completed commit or its CI contains the new artifact. Report
partial/degraded builder observations rather than presenting them as complete.

Bound regeneration to **15,000 ms**, with at most **1,000 ms** termination grace.
This allows more than four times the specification's historical reconstruction
time while putting a finite ceiling on optional work after a commit. It is an
initial product bound, not evidence that representative builds already meet it.
No retries or background continuation follow expiry. Normal success targets the
stricter measured latency acceptance below.

Use a supervised foreground execution boundary that remains responsive while
extraction runs. A Promise timeout racing an in-process writer is insufficient:
the timed-out writer must be stopped, not merely ignored. The supervisor must
force-terminate the owned writer at the deadline and observe its exit before
reporting timeout and returning to Git; the 1 second grace is exit observation
headroom, not permission to continue writing. No detached/unref'ed writer or
unbounded wait is permitted. Preserve atomic artifact publication. If portable
process containment cannot be established within the declared files, stop and
signal the implementation constraint rather than returning while it can write.
Read official documentation for the installed Node version before implementing
the selected process/worker lifecycle API; do not introduce a dependency.

Failure, timeout and unavailable executable diagnostics say that the commit
completed but knowledge was not confirmed updated. Give the exact recovery:
`void-harness graph project-build`, inspect the result and artifact diff, then
include it in a later human commit. Timeout cannot promise the artifact is
unchanged if termination races its atomic publication. The separate
`void-harness graph project-check` gate remains unchanged.

## Latency evidence and acceptance

There is **no marginal-cost claim** in this contract. Reusing an incremental
builder and preserving mtime do not prove cross-process reuse. Keep the existing
cache boundary; no trusted persistent cache, daemon or second graph engine.

After implementation, measure real commits in an isolated disposable consumer
repository populated with a versioned snapshot of this harness's source corpus
at a recorded SHA, including TypeScript, tests, ADRs and declared invariants.
Record file counts/bytes, OS, hardware, Git/Node versions, compiler availability,
exact CLI build and exclusions. This is a representative repository-sized
workload, not a two-file timing fixture. Do not install in harness shared hooks.

Use two matched isolated repositories, one without the hook and one installed
through the public command. Prime equivalent knowledge artifacts outside timing.
Run **20 paired samples per workload**, alternating baseline/hook order, each
commit in a fresh Git process and every hook in a fresh CLI process:

1. Unchanged sources: real `git commit --allow-empty` with stable source bytes.
2. Single edit: the same deterministic one-file TypeScript edit and real commit
   in each repository; stage fixture sources outside the measured interval.

Measure process start through Git exit with a monotonic clock. Retain individual
baseline/hook durations and paired added wall time; report median, p95, maximum,
standard deviation and sample count. Include hook regeneration duration and
actual `cacheStatus`, `cachePublished`, extracted/reused/read/hashed counts and
issues. Never label a cold scan incremental reuse. Keep setup/cleanup and report
writes outside the measured source tree or timing interval.

Acceptance: for each workload, paired added latency **p95 <= 10,000 ms**, no
successful representative regeneration reaches **15,000 ms**, and no timeout.
The 10 second budget deliberately leaves 5 seconds of headroom before the hard
deadline and acknowledges the existing full-process reconstruction cost. It is
a release criterion to verify, not a performance result. A missed budget is a
finding to investigate; do not rerun until green, drop outliers, loosen limits or
weaken cache security. Return raw evidence and explanation to the coordinator.

## Strict TDD slices and proof gates

1. RED: repeated identical publication preserves mtime/bytes; changed publication
   updates content; read/write failures stay visible. Then implement the narrow
   byte-comparison correction using the existing transaction.
2. RED: command grammar/help and safe install/uninstall/idempotence, existing and
   modified hooks, unsafe paths and scope reporting. Then implement the adapter
   and command wiring within the declared files.
3. RED: real Git normal/empty commits, regeneration failure and missing `.void`,
   spaces in paths and executable paths, linked worktrees and hooksPath. Prove
   HEAD contains exactly the requested commit, the hook does not stage changes,
   and changed knowledge remains dirty with the required message.
4. RED: a stalled regenerator that ignores graceful termination and attempts a
   delayed write. Exercise the actual supervisor in a disposable repository;
   verify Git succeeds, timeout/recovery are visible, the execution unit exits,
   no writer remains, and no late write occurs after return. Shorter
   injected clocks/deadlines may cover unit transitions; one real consumer proof
   uses the production 15 second deadline and 1 second grace. Measure total Git
   time against its baseline plus that 16 second envelope, allowing at most
   1 second recorded scheduler/launch allowance; a breach is a failure to explain.
5. Observe actual merge and rebase hook invocation with real Git and record which
   operations invoke post-commit. Do not add other event adapters to manufacture
   coverage. Verify the unchanged CI freshness command still rejects stale data.
6. Run the representative performance protocol, relevant CLI/knowledge contracts,
   lint/typecheck, required generated-artifact gates and full suite via serialized
   cockpit RUN. Root supplies independent post-implementation review. Quote real
   command output; disposable installation proof is not claimed as harness hook
   dogfood. Any harness builder assessment stays read-only.

No tests, builds, doctor invocation, commits or RUN tasks were executed during
this preparation pass. No root enforcement, checkpoint/programme, shared Git
configuration, refs, stash, tags, remotes or mission cleanup is changed. The sole
preparation edit is this plan; the next action is coordinator review of the
preparation correction and an explicit implementation handoff.


## Implemented supervision boundary

Read-only inventory on 16 September narrowed the required containment to the
actual trusted regenerator. `packages/harness-graph/src/project/extractors/git.ts`
is the only production subprocess import under `project/`: `execFile` executes
trusted Git with `config --name-only --list`, `rev-parse`, `diff --no-ext-diff
--no-textconv`, `ls-files`, and `log`. `safeGitArgs` disables hooks, fsmonitor,
filters, protocols and submodule recursion. These children cannot publish
knowledge. `writeProjectKnowledge` and its transaction perform all publication
in the single supervised Node process. There is no public executable injection.

Use `spawn(process.execPath, fixed CLI argv, { shell: false })`, force-kill that
writer at 15 seconds and await `close`. This works on POSIX and Windows without
process groups or a new framework. The stalled-writer fixture attempts a delayed
write itself and holds a read-only Git child; it does not invent an unsupported
arbitrary writer descendant. A future change introducing another artifact writer
must revisit this boundary. Node v26.8.2 official child-process documentation was
read before implementing lifecycle calls; its Windows kill semantics terminate
forcibly. The no-background-writer guarantee and latency bounds are unchanged.


## Execution observations

The cockpit RUN environment uses Node **v24.15.0** and Git **2.50.1 (Apple
Git-155)**, captured in `/private/tmp/dev611-runtime.log`. The tool shell's
v26.8.2 is a different environment. The same lifecycle semantics were checked
against the [v24.15.0 official documentation](https://raw.githubusercontent.com/nodejs/node/v24.15.0/doc/api/child_process.md)
before final verification; evidence and benchmark reports name their actual Node.

Strict RED observations: identical publication rewrote mtime; the original CLI
rejected the new command; an unbounded stalled regenerator returned after its
18 second delayed write; a nested independent repository accepted a hook; an
identical symlink target bypassed publication safety; and 700 declaration
failures displaced the artifact-review message from bounded output. Each was
observed before its correction. The resulting focused checks pass **7 publication
and 12 real-Git tests**, including the production 15 second timeout, absent writer
PID and observation beyond its scheduled late write. Diagnostics now show at
most eight entries and an explicit omitted count. No timeout limit was increased.
