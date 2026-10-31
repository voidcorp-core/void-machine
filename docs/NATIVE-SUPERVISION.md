# Native mission supervision

`void-orchestrate` owns native delegation, isolation, bounded concurrency and
collection. `void-implement` owns delivery quality; `void-autopilot` owns its loop.
The [worker lifecycle contract](WORKER-LIFECYCLE.md) publishes observations for
external presentation tools. Machine does not discover or control multiplexers.

## Execution and publication

1. Read the task, Git state and existing mission. Reuse the assigned writer and
   native identity; preserve other writers and the coordinator's current session.
2. Assign the worktree before launch. Use supported native capabilities and actual
   role permissions. Never duplicate an agent merely to display it.
3. After a successful dispatch acknowledgement, publish `worker.dispatched` with
   the real mission/ticket/worktree and `worker.state` running via `agents record`.
4. Publish observed state changes with stable observation identities and UTC time.
   Prefer native completion events, otherwise bounded observation. A timeout is
   unknown; a finished turn awaiting the coordinator is blocked, not done.
5. Reuse the same assignment and native session for corrections. Reconcile an
   uncertain launch before another attempt. Preserve missing-session evidence.
6. Collect the final result and publish done/failed followed by `worker.finished`.
   Close the mission afterwards. Publication is idempotent; an I/O failure never
   authorizes redispatch. Worktrees and branches retain their own lifecycle.

`agents status --json` reads the last published observations across the project's
worktrees. It does not certify that a process is alive or that all native calls
were captured. Partial coverage exits nonzero and retains readable entries.
Unsupported attachment remains `unknown`; neither a command nor a report grants
permission. An external plugin may read journals or the snapshot without being
installed, detected or called by Machine.

## Review and compatibility

Keep canonical specialist request/start/completion and exact-subject independent
review receipts separately. Worker completion is an execution observation, not a
review verdict, test proof, merge authorization or final acceptance by Cortex.
No permission or protected-path rule is relaxed by this presentation boundary.

Legacy runtime runs remain readable and collectable. Their mutating CLI commands
publish the same worker contract; `agents publish <runId>` can replay publication
from persisted transitions. It neither launches a runtime nor migrates its session.
Legacy presentation modules are inert on active delegation/status paths. No existing
pane is inspected, closed or migrated by this change.

The existing `herdr-metadata` hook is a transitional exception, tracked by DEV-1134
for migration to the external plugin. Its code and installed bundle are unchanged.
The [former central-file contract](ORCHESTRA.md) remains historical compatibility
material for existing missions; it is not the public API for new displays.
