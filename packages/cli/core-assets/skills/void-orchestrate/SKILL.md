---
name: void-orchestrate
description: Delegate independent research and substantial implementation through native agents; choose context, isolation and bounded concurrency, collect results and preserve review evidence. Herdr is optional.
---

# Orchestrate

The user-facing coordinator keeps intent, decisions and synthesis. This skill owns
adaptive delegation, transport and continuity; `void-implement` owns delivery quality
and `void-autopilot` its loop. Neither a pane nor a report grants merge permission.

## Choose work and capabilities

Read project instructions, the approved task and Git state; preserve other writers'
changes. Before dispatch, inspect the actual native agent tools and their supported
context, permissions, completion and resume capabilities. Herdr is optional: native
agents work without it. Select its adapter below only when available and useful for
a durable terminal worker; do not claim durability from a pane or unsupported API.

- Work directly for a tiny targeted change, a single tool call, mechanical processing,
  or tightly coupled work where delegation adds no useful separation.
- Delegate bounded independent research and exploration during brainstorm and plan.
  Keep the user conversation, evaluation of sources and decisions in the coordinator.
- Delegate substantial implementation to one writer when supported. A writer
  already assigned the unit executes it; never delegate the same complete workflow
  recursively. Retain that writer for corrections. Before parallel feature slices,
  define disjoint ownership, dependencies and acceptance of the integrated result.
- No native agent capability: execute sequentially and state the limitation. A
  mandatory independent review or required isolation remains a blocker; do not
  replace it with self-review or silently weaken its requirement.

## Brief and bound the delegation

Use a fresh context by default. Choose a supported fork only when the task needs
conversation history. Give objective, relevant context/source revision, owned paths,
permissions, acceptance, result format and bounds. Tell writers they are not alone
and must preserve others' changes. Ask researchers for conclusions, source references,
uncertainty and remaining questions, not all intermediate logs. Ordinary research
uses this lightweight brief: do not invent specialist events or review receipts.
Formal specialist envelopes and evidence follow the independent contract below.

Count writer, research and review children together against observed available runtime slots
and the coordinator's bounded dispatch; queue work when full. Preserve tighter caller
limits, including Autopilot's ticket cap and the central schema's four-worker limit.
This is no machine-wide quota. Do not create recursive child coordinators or redispatch
the same complete workflow. Required formal specialists remain dispatched by their
designated owner within the shared available capacity. Do not duplicate a child's work
in the coordinator. Run independent work concurrently only when it helps the critical
path; use ordinary tools for mechanical operations. Respect permissions throughout.

Read-only research needs no new worktree. Reviews use an immutable exact subject.
Concurrent authors need isolated assigned worktrees and disjoint ownership; if
isolation fails, serialize rather than share concurrent writes. Required isolation
that cannot be met stays blocked. A sole writer may reuse its assigned checkout;
Autopilot retains its per-ticket worktree requirement. Follow the universal durable
worktree invariant and existing shared Git restrictions, irrespective of display.

## Collect and resume honestly

Prefer native completion events; otherwise wait in bounded slices. A wait timeout
is not failure. Reconcile an uncertain launch or side effect before retrying. Use
partial results when useful, distinguish failure from missing output, and verify
acceptance before claiming success. Reuse the same session for corrections; confirm
that a new instruction was consumed or reflected in the result before calling it applied.

Distinguish saved work, live session, retained result and delivered result. A finished
turn or report alone proves no accepted outcome or crash recovery. Use the selected
runtime's actual persistence/recovery path; expose a lost session or unknown effects.
Never invent a durable inbox. Preserve formal receipts separately from working notes.

## Short native specialists

Pass the returned specialist envelope unchanged: runtime, agentName, missionId,
contextPack and, when present, reviewSubject and reviewScope. Invoke the runtime's
native fresh-context primitive; native Agent calls are not intercepted. Keep the
real opaque context ID exactly as returned, including slash-prefixed names; it is
data, never a filesystem path. Record actual starts/completions with
`mission specialist-event`; never invent IDs or convert a failed call into a review.
Before another invocation, reconcile any existing invocation for the same envelope.
Preserve the complete result; incomplete results go back to the same agent.
With `panel.provider: orchestrator`, only ORCH launches and collects this panel.
Missing required native capability is reported with cause and next action.

## Herdr adapter: recovery

The following Herdr sections apply only when this optional adapter is selected.
Native delegation without it does not require these central files or pane discovery.

Read project instructions, the approved task and the current Git status. Preserve
other writers' changes. Resolve the canonical Git common directory, SHA-256 its
absolute real path as UTF-8, and inspect
`~/.local/state/orchestra/<project>/<mission>/`. Never use an inherited workspace
variable or a stale pane ID as authority. Read mission.md, the applicable
workers/<label>/brief.md and report.md. Re-read `herdr pane list` before every
identity decision. Match **label + worktree**, using the canonical worktree path.
Refuse multiple matches, incomplete discovery, symlinks, traversal and invalid data.
After reattachment/restart, ORCH atomically updates pane_id and coordinator.workspace
from that validated fresh inventory. Hooks and workers never write these hints.
A missing unrelated historical worktree does not invalidate a current identity.

The coordinator is the existing ORCH session, never a second agent opened for display.
Resolve its own label + worktree before selecting its workspace. Keep each writer
in its assigned worktree. Do not affect any other project, workspace or pane.
An uncertain launch or prompt acknowledgement requires reconciliation of that same
worker before retrying. A timeout proves neither launch failure nor prompt loss.

## Herdr adapter: explicit coordinator context

If unique discovery refuses multiple compatible missions, ORCH reads the target
mission and reports, then atomically replaces its local, unversioned
`<canonical worktree>/.void/machine/orchestra-selection.json`. Schema 1 is strict
JSON, at most 4096 UTF-8 bytes: `{ "schema": 1, "project": "<project-sha256>",
"mission": "<existing-id>", "coordinator": { "label": "ORCH", "worktree":
"/absolute/canonical/worktree" } }`. ORCH alone writes it; hooks never repair it.
No unknown or duplicate keys, YAML, traversal, symlinks or partial writes.

This selects context only, never execution state or permissions. Full bounded
central discovery still runs; malformed unrelated missions or limits refuse.
A stale/invalid binding never falls back. Verify selected coordinator label and
canonical worktree against the current worktree and a fresh `herdr pane list`;
missing or duplicate live matches refuse. Never prefer timestamps, running status
or pane tokens to decide intent. Without a binding, preserve unique discovery.
Clear/compact/resume re-read selection and central state without launching workers.
Separate worker worktrees retain their own mission, attempt and report discovery.
A selected terminal mission retains the guarded cleanup below: never clear tokens
belonging to another mission. No binding belongs in the programme descriptor.

## Herdr adapter: central files and ownership

Use schema: 1 YAML frontmatter, strict string keys and one document, followed by
Markdown. Reject duplicate keys, tags, anchors, aliases and unknown fields. Bound
mission/report to 64 KiB, brief to 256 KiB, discovery to 64 entries and 1 MiB of
mission bytes; exceeding a bound is incomplete, never a unique match.
See the shipped technical contract `docs/ORCHESTRA.md` in the harness source for
schemas; the operational fields are listed here so an installed skill is sufficient.

- mission.md: schema, mission, project, status, updated_at (UTC ISO), repository
  (canonical Git common path), coordinator {label, worktree, workspace?}, workers.
- Worker entries: label, agent (codex or claude), worktree, branch, ticket, status,
  attempt; optional pane_id and session are hints only. At most four workers.
- Coordinator status and worker status: planned, running, blocked, done, failed.
- report.md: schema, mission, attempt, worker, branch, status (running, blocked,
  done, failed), commits (full SHAs), tests (passed, failed, not_run), updated_at.
  Body: actual commands/results, proof locations, risks, questions and remaining work.
- brief.md: absolute paths, exact base, footprint, acceptance criteria, ownership,
  permissions, forbidden effects and current attempt. No secrets. Explicitly warn
  that other writers exist and their changes must be preserved.

ORCH alone writes mission and briefs; each worker alone writes its report. Use an
atomic replacement: write an exclusive temporary sibling, then rename. Hooks never
write these files. A new work turn gets a new attempt; resume keeps its attempt.
A valid report for the current mission/attempt overrides workers[].status at every
event. An absent report falls back to the manifest. Malformed, foreign, partial or
unrecognized stale reports refuse usage; never turn a parse failure into absence.
The files carry coordination state, not independent review proof.

## Herdr adapter: copyable starting files

Replace the example project hash with SHA-256 of the canonical common Git path.
Replace every path, branch, ticket and timestamp from actual observations. These
three files are authored by their owner, never by the hook.

mission.md:

```yaml
---
schema: 1
mission: dev-42
project: "<project-sha256>"
status: planned
updated_at: "2026-10-08T10:00:00.000Z"
repository: /absolute/repository/.git
coordinator:
  label: ORCH
  worktree: /absolute/repository
  workspace: wA
workers:
  - label: WORK-1
    agent: codex
    worktree: /absolute/worktrees/dev-42
    branch: work/dev-42
    ticket: DEV-42
    status: planned
    attempt: implementation-1
---
# Mission
Scope, acceptance criteria, canonical mission journal and proof locations.
```

workers/WORK-1/brief.md:

```yaml
---
schema: 1
mission: dev-42
attempt: implementation-1
worker: WORK-1
---
# Work
Worktree: /absolute/worktrees/dev-42. Branch: work/dev-42.
Base: <verified full commit SHA>. Ticket: DEV-42.
Footprint: <exact owned files/directories>; preserve every other writer's edits.
Acceptance: <complete observable criteria and verification commands>.
Limits: <role permissions, forbidden effects, human gates>.
Report: /absolute/mission/workers/WORK-1/report.md, owned only by this worker.
Resume: <actual runtime session and the recipe from the table below>.
```

workers/WORK-1/report.md:

```yaml
---
schema: 1
mission: dev-42
attempt: implementation-1
worker: WORK-1
branch: work/dev-42
status: running
commits: []
tests: not_run
updated_at: "2026-10-08T10:00:00.000Z"
---
# Checkpoint
Completed: <actual changes>. Verification: <commands, results and proof paths>.
Remaining: <work and exact next action>. Risks/questions: <observed limitations>.
```

## Herdr adapter: durable workers

Read installed `herdr --help`, `herdr agent --help` and the live schema before
issuing commands. Use structured argv, exact acknowledged identities and bounded
waits/output. The launch recipes for the selected worktree are:

| Kind | Launch argv | Resume argv | Short contexts | ctx capability |
| --- | --- | --- | --- | --- |
| codex | `--no-daemon --add-dir <absolute-mission>` | `resume <actual-session> --no-daemon --add-dir <absolute-mission>` | Native fresh context | Unmeasurable without a supported usage source |
| claude | `--add-dir <absolute-mission>` | `--resume <actual-session> --add-dir <absolute-mission>` | Native Agent, no interception | Fresh transcript usage plus required context.windowTokens |

Use the selected kind's executable and preserve these options on every launch/resume:

```sh
herdr agent start <unique-mission-worker-name> --kind <kind> --pane <resolved-pane> -- <argv-from-table>
```

The arguments after `--` belong to the selected runtime. The name is unique within
the mission; it is not an invented native session ID. Resolve the pane first and
keep the session ID actually returned by the runtime.

Apply the role's existing permission/read-only policy; `--add-dir` only grants the
specified directory, never disables a sandbox or an approval. Unsupported kind or
option: diagnose and stop that launch. Do not update or restart Herdr to make it fit.
Register planned worker before creating its owned surface. Keep the returned pane
ID as a hint, launch once, submit the brief once, then reconcile by label + worktree.
Use `herdr agent wait` in bounded slices and read the report after every turn.
Idle/done is a turn ending, never proof the task passed. Request a missing report
from the same session. Follow up in that session; never create a duplicate worker.
After /clear read the same mission; after a killed process resume its actual session
in the same worktree. Missing session: retain the mission and expose the loss.

`resume_argv` is absent from Herdr 0.9.0 and 0.9.1, present from 0.9.2. Publish it
only after the installed schema proves support. Otherwise retain the complete resume
recipe in the brief. Never claim restart restoration was tested without doing it.

## Herdr adapter: projection and closure

The hook publishes source void-machine on SessionStart startup/resume/clear/compact
and Stop after re-reading central state and fresh Herdr identities. Pane tokens:
mission, worker, ticket, wstatus; coordinator-only workspace: mission, wstatus, workers.
These are file status, never agent state. ctx requires the selected kind's measured capability from the table; unavailable measurement stays unavailable. Clear
removes ctx before fresh measurement. State TTL is 86400000 ms, ctx TTL 7200000 ms.
Sequences are exact nanosecond decimal BigInts captured before discovery. Old or
equal seq is ignored by Herdr. Tokens are global keys, not source namespaces: another
source may overwrite them; null clears globally. Never reconfigure cockpit to win.

Terminal mission cleanup explicitly clears keys on all still-resolved owned panes,
only where the currently projected mission still matches. Only the resolved
coordinator clears workspace keys, again after verifying the displayed mission.
A late closure of A must not clear B. A worker SessionEnd never cleans the workspace.
When no mission is active, recover the verified displayed terminal mission; do not
choose arbitrary history. Discovery/transport errors never trigger a purge.
After collection and acceptance ORCH may close its owned surfaces; retain worktrees,
branches and evidence according to their own lifecycle. Do not close the coordinator.

## Independent review

Commit the candidate before the independent pass. Keep a fresh read-only reviewer,
different from the writer, on the exact reviewedCommit, baseCommit and
acceptanceCriteriaHash. Preserve its actual canonical request/start/completion and
receipt (native-context or supported review-artifact provenance). Artifact provenance
stays within the existing project boundary and must match its digest and invocation.
A central report marked done is never a review receipt. Preserve limitations honestly.

For autopilot, `autopilot review --ticket <id> --pr <n> --head <sha> --round <1|2>
--mission <canonical-id>` checks the target ticket against the existing bounded ticket reader (filename identity
and frozen content hash), then prepares the exact review subject/worktree and, when
pending, returns awaiting-native-review. ORCH performs the native invocation and
records its real receipts, then repeats the same command to collect. Do not start a
new mission to repair a pending attempt. Budgets, protected paths, HEAD drift checks,
local verdict admission and merge holds remain enforced. In-flight legacy runs are
collected through their existing transport and journals; never duplicate them.
