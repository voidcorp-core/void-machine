# Ticket usage recap

The complete catalogue already exists: `void-machine cheatsheet --format markdown` lists
skills, hooks, agents and specialists with their descriptions and declared triggers. The default
HTML and JSON formats remain available. This is discovery, not proof of execution.

At ticket end run once:

```sh
void-machine mission inspect --id <mission> --usage
```

Add `--json` for the existing verdict object plus a `usage` field. Ordinary `inspect` output is
unchanged. The exit status remains the mission verdict (0 for verified/excepted, 1 otherwise),
not telemetry coverage. Text shows positive counts/outcomes and summarizes zero/unknown rows;
JSON retains all catalogue rows and per-runtime counts. Do not chain this optional recap as a delivery gate. `void-verify` owns
the one recap and `void-implement` composes it; no per-edit command or extra review loop.

| Item | One observed hit | Separate outcomes |
| --- | --- | --- |
| Skill | Claude native `runtime.tool.started`, subject `skill:<name>`, category skill | Recorded tool result |
| Hook | `hook.completed` | ok, skipped, blocked, degraded or recorded error |
| Specialist | Formal `specialist.started` | completed or failed |
| Advisory | `usage.advisory.started`, declared after a successful native start | None; no completion/verdict claim |

Requests and completions do not add specialist starts. Event IDs are deduplicated, not lifecycle
triples. Local skill aliases (`harness:void-tdd`, `core/void-tdd`) join the local skill; foreign
provider identity remains separate. Mixed-runtime counts keep Codex skill usage unknown. Hook subjects use the shipped wrapper command mapping (for example `tdd-order` belongs
to `tdd-guard`). Names observed outside the current catalogue remain visible. Payload bodies,
commands and transcripts are never exported.

Direct events retain the requested mission ID. To include an ongoing native session, the
coordinator explicitly opens a prospective interval at work start when its exact journal ID is
known; identification is not a new user task or delivery prerequisite:

```sh
void-machine mission usage-bind --id <target-mission> --source <source-session-journal>
# Continue the actual work. After a successful native specialist call, if its real context exists:
void-machine mission advisory-start --id <target-mission> --specialist core:security-engineer --runtime codex --context <actual-native-context>
void-machine mission usage-unbind --id <target-mission> --source <source-session-journal>
void-machine mission inspect --id <target-mission> --usage
```

Each command accepts `--json`. The target must already exist; the source journal must be intact.
No source ID is selected automatically. Never infer linkage from timestamps, titles, worktrees,
recent activity or inherited `CODEX_SESSION_ID`/`CODEX_THREAD_ID`. Missing identification remains
unknown. A shared session interval attributes its events to the declared work, not to an isolated
worker. The existing `VOID_MISSION_ID` still supports future runtime launches; these commands do
not change it or install source hooks into the host project.

The source owns opening/closing receipts, appended with the existing sequenced writer. Opening
begins strictly after its receipt; no historical range argument exists. A single target reference
is the second, non-atomic write. If it fails, the command reports `USAGE_REFERENCE_PENDING`: retry
the same command to repair the reference, without moving the opening boundary. Inspect remains
read-only and never repairs. One active target per source prevents conflicting attribution;
close it before another target. Close works after target mission closure and freezes the interval.
There is only one interval per source/target pair: bind/close retries return its existing state,
including closed, never reopen it. Do not recreate a mission to evade a verdict or reopen proof.

The report reads only explicit references (at most 32 source journals, each bounded by the
existing 8 MiB journal limit). It validates exact sequence/event anchors and chained prefix
digests, rejecting damaged, overlapping or mismatched intervals. Digests check integrity, not
authentication. Open intervals are provisional/shared-session; closed ones exclude later events.
Unavailable sources stay explicit and contribute no invented zeros. Linked events retain original
mission IDs and are deduplicated by source mission plus event ID; canonical verdict reducers see
only their original target stream. Linkage and advisory receipts cannot satisfy formal review.

Advisory receipts use a canonical specialist role and the real context ID returned by a successful
native call, with `coordinator-observed` provenance. They are declarations, not independent
attestations; syntax validation cannot prove a call happened. No retrospective starts, completions
or verdicts are manufactured. Retrying the same mission/runtime/context is idempotent; reusing it
for another role conflicts. Formal `specialist-event` admission remains unchanged.

A verified controller-plan routing hash binds a ticket path/content hash; without it the report
still says mission/session journal, not proven ticket. The user-approved work unit and its existing
mission remain the owner of scope. No source scan, global registry or new execution engine.

Unknown is not zero. When no execution telemetry of a kind is linked, its rows say `unknown`.
When records exist, numeric counts are observed lower bounds: zero means no recorded hit, not
proof of non-use. A broken/gapped/mixed journal is explicitly incomplete. Codex SKILL.md reads
are loads, not observable native invocations; no skill hits are inferred. Native specialist
advice without a distinct advisory receipt or canonical start also remains unobservable. Installed, applicable,
invoked and passed are different claims; this report cannot establish instruction compliance,
TDD order, specialist pertinence or code quality.

Inspection reads the local catalogue, target and explicitly linked journals only; it does not
write quarantine for malformed records. It retains readable observations and flags incomplete
coverage. No telemetry server, dashboard, network export, new quality gate or execution engine.
