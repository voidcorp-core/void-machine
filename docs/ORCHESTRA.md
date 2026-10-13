# Central native mission files

This is the optional Herdr adapter's persistence and projection contract, not a
prerequisite for native delegation. `void-orchestrate` owns portable research/writer
dispatch. Ordinary read-only research uses a focused brief without new central files
or fabricated specialist receipts. Formal review proof remains its existing owner's
responsibility. The schema and its four-worker bound are unchanged by adaptive
delegation; these files are neither a global quota nor a durable result inbox.

DEV-1016 uses `~/.local/state/orchestra/<project>/<mission>/`. The project key is
SHA-256 of the UTF-8 canonical Git common-directory absolute path. Resolve it with
`git rev-parse --path-format=absolute --git-common-dir`, then `realpath`. Repository
homonyms therefore never share a namespace. Moving the common directory requires
an explicit migration by the coordinator; hooks never move or write central state.

The schema 1 codec lives in `packages/hook-runner/src/lifecycle/orchestra-codec.ts`.
Mission and report documents have strict YAML frontmatter and a Markdown body,
limited to 65536 UTF-8 bytes. YAML aliases, anchors, tags, duplicate keys and unknown
fields refuse. A report matches mission, worker label, branch and attempt exactly.
Its valid status is authoritative; only an absent report falls back to the worker
manifest. Mission refresh timestamps do not invalidate a current-attempt report.

ORCH alone writes mission and briefs. Each worker writes only its own report.
Writers create an exclusive temporary sibling, validate the whole document, then
rename it over the destination; they never overwrite another owner's file.
An attempt is an opaque bounded identifier, renewed for a new turn and retained for
resume. A worker may retain an optional `session` reference for native resume.
It never identifies a pane. Briefs are limited to 256 KiB and carry the absolute
mission/worktree/report paths, exact base, acceptance criteria and owned paths.

Discovery reads at most 64 mission directories and 1 MiB of mission bytes. A limit
or malformed state is a diagnosed incomplete discovery, never an empty or unique
result. Historical missing worktrees and unrelated pane working directories do not
invalidate a live target. Pane identity is label plus canonical worktree, re-read
from Herdr every time. Cached pane/workspace IDs and inherited environment never
select a target. Multiple compatible active missions refuse automatic selection.
Without an explicit binding, terminal missions remain readable; with no active
mission only the currently projected, identity-verified mission selects cleanup.

## Explicit coordinator selection

When several missions share a coordinator worktree, ORCH chooses context without
changing their execution state. After reading the target mission and reports, ORCH
alone atomically replaces `<canonical worktree>/.void/machine/orchestra-selection.json`:

```json
{
  "schema": 1,
  "project": "<SHA-256 of canonical Git common-directory path>",
  "mission": "<existing central mission identifier>",
  "coordinator": { "label": "ORCH", "worktree": "/absolute/canonical/worktree" }
}
```

This optional, local, unversioned file contains no status, pane/workspace/session
ID, timestamp, permission or review verdict. It is reconstructible from central
state and never belongs in the programme. Strict JSON (not YAML), duplicate and
unknown key rejection, a 4096 UTF-8 byte maximum and the existing symlink-safe,
bounded reader apply. A partial write, concurrent replacement, stale target or
foreign project/worktree refuses use with a diagnostic; there is no fallback.

Full discovery still validates every mission within the 64-entry/1-MiB limits,
including unrelated malformed missions. Selection must name the selected mission's
coordinator at the current canonical worktree, then resolve label plus worktree
against a fresh `herdr pane list`. Missing or duplicate live matches refuse.
Neither status nor timestamps break ties. Without a binding, unique discovery is
unchanged and ambiguity names bounded candidate identifiers for ORCH to choose.

Clear, compact and resume re-read the file and central state; resuming never launches
a worker by itself. Workers in separate worktrees keep their own discovery, attempts
and reports. Hooks never write or repair the binding. A selected terminal mission
can clear only pane/workspace tokens still displaying that mission, preserving
another mission's tokens. See the [approved selection design](specs/2026-10-12-orchestra-explicit-selection.md)
and [decision](decisions-log/2026-10-12-orchestra-explicit-selection--e7be95ab-5bca-4542-9f38-e811a6bd9b10.md).

## Metadata lifecycle

The `herdr-metadata` hook reads central state on SessionStart startup/resume/clear/
compact, Stop and SessionEnd. It publishes with source `void-machine`. It never
reports agent lifecycle or grants permissions. File status is `wstatus`.
State keys use 86400000 ms TTL; measurable Claude context uses 7200000 ms TTL and
requires configured `context.windowTokens`. Codex context is unmeasurable here.
Clear removes previous ctx before any fresh measurement. Every publication sends
a decimal BigInt nanosecond sequence captured before discovery, plus increasing
per-command offsets; it never serializes this u64 through a JavaScript Number.

Only a resolved coordinator publishes workspace keys. Terminal coordinator cleanup
covers all still-resolved mission panes and its workspace; each target must still
show that mission. Worker SessionEnd never clears workspace metadata. Lookup or
transport failure causes no purge. Calls use literal argv, `shell:false`, 256 KiB
stdout/stderr bounds and one shared two-second subprocess deadline.

Herdr 0.9.0 tokens are global per resource: last accepted write wins, omitted keys
stay, null clears globally, TTL applies to touched keys, and equal/older seq from
the same source is ignored. `ctx` and `ticket` collide with personal cockpit hooks;
DEV-1017 owns their removal. No personal hook is changed by this migration.
`resume_argv` requires Herdr 0.9.2; 0.9.0/0.9.1 cannot preserve extra launch options
through server restart. No real restart proof has been executed for DEV-1016.

## Guarding native Codex session attachment

`lifecycle herdr-session codex` in the shipped hook bundle is the temporary global
ownership guard for Herdr integration 8. It proves foreground ancestry before
delegating the untouched payload to Herdr's native script. It neither publishes
session state nor alters Orchestra metadata, central files or project telemetry.
The separate `herdr-metadata` handler remains responsible for mission projection.

Configure this route only through a deliberate personal migration with one guarded
SessionStart call and no parallel unguarded native call. Keep the existing cockpit
guard until the replacement artifact and exact configuration diff are accepted.
Before activation, save private backups, compare the current source hashes, inspect
all effective hook entries and retain a byte-exact rollback. No installer changes
personal configuration automatically. Integration reinstallation requires checking
that the guarded route is still the sole native session caller.

The [Codex guard contract](CODEX.md#global-herdr-session-ownership-guard) describes
limits, diagnostic visibility and residual process-identity assumptions. Fixture
relay proofs do not close DEV-1016's live clear/kill/restart gates or authorize a
server restart, permanent layout change, plugin retirement or personal activation.

## Native review identities

Canonical specialist lifecycle context IDs are opaque bounded strings, including
runtime names such as `/root/preparation_panel/security`. They are data, never file
paths. Blank values, control characters and values beyond 160 characters refuse.
A central report or Herdr status never proves independent review. The canonical
review receipt retains exact commit, base, criteria and actual invocation evidence;
missing runtime identity uses the existing verified artifact provenance boundary.

Autopilot additionally reuses the controller's bounded ticket reader: the ticket's
filename identity must equal the target ticket and its current bytes must hash to
the frozen contentHash. The canonical mission.started routing hash must match the
stored binding. Passing --mission alone does not select arbitrary acceptance criteria.
Before a native local verdict is recorded, review history uses the same finding
reconciliation as the mission controller. A completion omitting a historical
blocker refuses collection unless its resolution names passed, intact canonical
proof from this mission, recorded before the review, fresh for the reviewed
checkout's project-state hash. The authentic completion and receipt remain intact;
a later empty findings array alone never clears a blocker.
YAML stays the official parser; Zod Mini provides strict schemas with reduced bundle
weight. Native review does not require the legacy transport to be installed.

Distribution measurement (DEV-1016): pnpm pack initially 2232.4 kB; using Zod
Mini instead of the full runtime reduced the final pack to 2128.0 kB. The old
2095 kB ceiling becomes 2173 kB, retaining approximately 45 kB headroom for the
official YAML parser, strict schemas and native receipt collection. No payload or
license was omitted. Hook performance is checked by the existing context-continuity
benchmark; its historic global startup baseline remains separately tracked DEV-662.
