# Native mission supervision

`void-orchestrate` is the shared procedure for coordinators, implement specialists
and autopilot workers. The approved [native design](specs/2026-10-08-native-herdr-orchestration.md)
and [central file contract](ORCHESTRA.md) define identity, projection and continuity.

## Procedure

1. Resolve the named project, read rules and Git state, then recover its central
   mission. Keep the current ORCH coordinator. Preserve other writers' changes.
2. Short specialists/reviewers run through native fresh-context primitives. Claude
   Agent is not intercepted. Keep the envelope and actual invocation identity;
   record its real canonical completion, including precise limitations.
3. Durable workers get isolated worktrees before Herdr launch. ORCH atomically writes
   mission.md and workers/<label>/brief.md; only the worker writes its report.md.
4. Re-read `herdr pane list` and match label plus canonical worktree before acting.
   Pane IDs and workspace hints are never authorities. Ambiguous or incomplete
   discovery refuses. No duplicate agent after an uncertain acknowledgement.
5. Use the installed runtime recipe: Codex launch and resume include --no-daemon
   and --add-dir for the central mission; Claude includes --add-dir. Existing role
   permissions remain. A required unsupported capability is diagnosed.
6. Wait in bounded slices, read report and actual Git proofs, and follow up in the
   same session. Idle/done is only the end of a turn. Resume after clear/kill from
   the same mission/attempt. Missing session is visible, never silently recreated.
7. Collect and accept before closing owned worker panes. Keep worktrees, branches
   and proofs on their separate lifecycle. Do not close ORCH or unrelated panes.

## Projection boundary

The project hook runs on SessionStart startup/resume/clear/compact, Stop and
SessionEnd. It reads central state only; no durable home writes. Source void-machine
publishes pane mission/worker/ticket/wstatus and coordinator-only workspace
mission/wstatus/workers. ctx requires an actual supported measurement and configured
window. Clear removes ctx first. TTL is per touched key (24 hours state, 2 hours ctx),
sequence per source/resource; old or equal sequence is ignored. Sequence is captured
before discovery to prevent a delayed old snapshot winning a newer write.

Tokens are global, not namespaced by source: last accepted write wins and null
clears globally. The known cockpit ctx/ticket collision is not fixed by changing
cockpit or personal configuration. Terminal cleanup checks the currently projected
mission on each still-resolved owned pane and on the coordinator's workspace. A late
closure of A cannot clear B; a worker SessionEnd never clears workspace. Discovery
or transport failures diagnose and do not purge.

Herdr 0.9.0 protocol 22 lacks resume_argv (also absent in 0.9.1); it appears in 0.9.2.
Only publish a restore recipe after checking the installed schema. No server update
or restart is part of this migration. Real restart and Cortex conformance were not
executed under the DEV-1016 authorization; ORCH owns controlled live projection.

## Review and compatibility

A report marked done is coordination state. Independent review requires canonical
request/start/completion provenance for the exact reviewedCommit, baseCommit and
acceptanceCriteriaHash, with a distinct read-only reviewer. Native context IDs are
bounded opaque noncontrol data, never paths. Artifact provenance stays project-bound
and digest-checked. `autopilot review --mission` prepares/collects this evidence under
existing protected paths, attempt deadlines, budgets and merge holds.

Legacy kernel runs, their result hook, journals and presentation adapters remain
readable and collectible. They are not the mandatory launcher for new work. The
legacy cmux/tmux/Herdr presentation port still closes only surfaces it can prove it
owns. This migration changes neither merge policy nor runtime permissions.
