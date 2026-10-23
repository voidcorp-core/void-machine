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
| Specialist | `specialist.started` | completed or failed |

Requests and completions do not add specialist starts. Event IDs are deduplicated, not lifecycle
triples. Local skill aliases (`harness:void-tdd`, `core/void-tdd`) join the local skill; foreign
provider identity remains separate. Mixed-runtime counts keep Codex skill usage unknown. Hook subjects use the shipped wrapper command mapping (for example `tdd-order` belongs
to `tdd-guard`). Names observed outside the current catalogue remain visible. Payload bodies,
commands and transcripts are never exported.

Only events with the requested mission ID count. A verified controller-plan routing hash binds
a ticket path/content hash; without it the report says mission/session journal, not proven ticket.
No timestamp, worktree, title or specialist context ID guesses connect independent journals.
The existing `VOID_MISSION_ID` can link telemetry when set before launching a runtime with that
mission; this command never sets it, rewrites past events, changes consumer configuration or
launches a runtime. Already-running sessions cannot be retrospectively linked this way.

Unknown is not zero. When no execution telemetry of a kind is linked, its rows say `unknown`.
When records exist, numeric counts are observed lower bounds: zero means no recorded hit, not
proof of non-use. A broken/gapped/mixed journal is explicitly incomplete. Codex SKILL.md reads
are loads, not observable native invocations; no skill hits are inferred. Native specialist
advice that did not emit canonical starts also remains unobservable. Installed, applicable,
invoked and passed are different claims; this report cannot establish instruction compliance,
TDD order, specialist pertinence or code quality.

The command reads the local catalogue and selected journal only; usage inspection does not
write quarantine for malformed records. It retains readable observations and flags incomplete
coverage. No telemetry server, dashboard, network export, new quality gate or execution engine.
