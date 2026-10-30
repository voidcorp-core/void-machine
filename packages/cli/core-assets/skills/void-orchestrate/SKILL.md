---
name: void-orchestrate
description: Delegate independent research and substantial implementation through native agents; choose context, isolation and bounded concurrency, collect results and preserve review evidence. Publish observed worker lifecycle events.
---

# Orchestrate

The user-facing coordinator keeps intent, decisions and synthesis. This skill owns
adaptive delegation, transport and continuity; `void-implement` owns delivery quality
and `void-autopilot` its loop. Neither a pane nor a report grants merge permission.

## Choose work and capabilities

Read project instructions, the approved task and Git state; preserve other writers'
changes. Before dispatch, inspect the actual native agent tools and their supported
context, permissions, completion and resume capabilities. Use the best supported
capabilities for the task in the current session; an installed executable or an
environment hint alone does not validate a host, identity or permission.

Use native execution independently of presentation. The harness publishes worker
observations; external plugins own windows, tabs and panes. Never discover or call
a multiplexer to delegate, and never duplicate an agent to make it visible.
An absent display cannot change execution permissions or invalidate real evidence.

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

## Native model choice

Use the current runtime's declared model/effort controls and project-configured identifiers.
An explicit user choice wins; do not infer availability, price or capability from a product name.
Without an explicit choice, match the bounded task to an available native configuration:

| Work | Selection |
| --- | --- |
| Mechanical lookup, extraction, formatting | An economical model when supported and sufficient |
| Domain advice or implementation | Enough capability for the actual contract and uncertainty |
| Sensitive architecture/security, independent review, failed-proof adjudication | Retain judgment capability; never downgrade just for cost |

Keep the assigned writer and reuse valid specialist advice. Do not restart a retained context
merely to change its model; the writer's whole quality cycle stays intact. A cheaper explicit
choice never waives acceptance or independent review: report insufficient capability as a
conflict, rather than silently upgrading or claiming the quality requirement is met.

- Discover supported identifiers and controls before dispatch; pass only supported options.
  Respect native constraints between model overrides, effort and context/fork modes.
- An unavailable explicit choice stops the dependent launch with its cause and next action.
  If no explicit choice exists and selection is unsupported, inherit/default transparently;
  do not claim that a particular model or lower price was selected.
- Diagnose an unsupported optional setting instead of passing it anyway. Do not silently
  change provider, credentials, permissions or the user's choice to make a launch work.
- Reconcile an uncertain launch before retrying the same work. At most one retry for a
  confirmed transient failure; otherwise report the limitation. Never cascade across models.
- Requested and observed models differ: retain the requested option in the ordinary brief,
  and report the effective model only when the runtime supplies it; otherwise it is unknown.
  Use existing evidence/reporting, not a new registry. Report cost/time only when observed.

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
limits, including Autopilot's ticket cap.
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

`void-implement` owns domain detection and the required primary domain consultation before coding.
Dispatch that smallest relevant expert set once, collect actual advice and reuse it while its
inputs hold. This skill owns transport and provenance, not a second applicability policy or
an all-specialist preparation quorum. Extra experts need a distinct uncovered risk.

For a lightweight consultation outside formal dispatch, after the native call actually succeeds
and returns a context ID, the coordinator may record `void-machine mission advisory-start --id
<mission> --specialist core:<role> --runtime claude|codex --context <actual-native-context>`.
This is a coordinator-observed usage receipt, not `specialist-event`, completion or review proof.
Never record a planned/failed start, reconstruct past receipts, or block delivery on missing
telemetry. Repeated submission of the same context is idempotent; a different role conflicts.

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

## Publish worker observations

For each mission worker or reviewer, keep one `run_<opaque-id>` for its assignment.
Reuse the unit's open canonical mission; if it has none, create it with
`void-machine mission start --title <unit> --json` and retain its returned ID.
Do not recreate a mission to evade a refusal. This publication never substitutes
for the mission's implementation, verification or independent review receipts.

After an actual successful native dispatch acknowledgement, publish:

```sh
void-machine agents record --mission <mis_id> --event-file <observation.json>
```

The file contains `observationId`, `kind` and `payload`. Use a stable observation ID
and exactly the same content on a retry. The payload always carries `schemaVersion: 1`
and `runId`. Publish these three kinds at their real boundaries:

- `worker.dispatched`: add `missionId`, `ticket` (or `unknown`), `role` (`work` or
  `review`), `runtime` (`claude` or `codex`), the verified absolute `worktree`,
  `branch` (`detached` requires `headSha`), and `attachCommand` (verified argv or
  `unknown`). Never invent an attachment recipe or use presentation hints as identity.
- `worker.state`: add `state` (`running`, `blocked`, `done`, `failed`) and the UTC
  `observedAt`; optional `reason` explains a wait. Publish the initial running state
  and subsequent observed changes. A turn ending while awaiting the coordinator
  is blocked, not done. No observation means unknown, never inferred failure.
- `worker.finished`: add `outcome` (`succeeded`, `failed`, `stopped`) after final
  collection or confirmed terminal failure/stop, preceded by done for succeeded,
  failed otherwise. Finish before closing the mission. It does not mean merged.

Keep the same assignment through corrections and resume. Repeated running states
across distinct turns need distinct observation IDs. A finished assignment is closed;
new work afterwards gets a new run ID. Keep real native identities in the existing
brief/evidence; the observation ID is not a fabricated native receipt.

A publication error is visible and retried with the same identity/content after its
cause is resolved; it never authorizes another launch. No brief, transcript, secret
or result content belongs in these metadata. Native calls outside this procedure are
not automatically captured, including unsupported Codex observation paths.

`void-machine agents status --json` reads all project mission journals and reports
active assignments, their last observed state and coverage issues. It does not poll
runtimes or control presentation. Partial coverage is explicit and exits nonzero;
never treat an unreadable history as no workers. External tools consume this public
contract; the harness does not open or close their surfaces.

Existing legacy runs retain their session and journal. Their mutating CLI commands
publish the same events; `void-machine agents publish <runId>` retries publication
from saved transitions without re-executing or stopping the runtime. This does not
make the legacy launcher mandatory for new work.

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
