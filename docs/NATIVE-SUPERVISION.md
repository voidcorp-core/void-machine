# Native mission supervision

Local presentation integration for the approved
[spec](specs/2026-09-05-visible-agent-supervision.md), carried since 4.1 by the
presentation port of the delegation kernel
([spec](specs/2026-09-28-supervised-agent-delegation.md), "Adaptateurs de présentation").

## Procedure (independent of the multiplexer)

1. Resolve the target project through the existing project discovery and read its
   rules. Resolve the mission through the provider or the explicit user objective.
   Record Git branch/status; preserve unrelated changes. Reuse native continuity.
2. Work in the multiplexer the coordinator already runs in; nothing creates a
   workspace for display. Without a multiplexer nothing is shown and native
   execution is unchanged.
3. If this mission has no coordinator, launch the authorized native runtime in the
   returned coordinator surface, with target project cwd and complete brief. Choose
   the user's runtime preference first. Never spawn a second coordinator solely for
   display. Native runtime invocation, permissions and sessions remain owned by the
   existing runtime adapter. A shell surface is not a running agent.
4. When the coordinator delegates an independently runnable terminal worker, first
   create its isolated worktree through the existing execution workflow, then
   dispatch it with `void-machine agents dispatch`. The kernel opens the run's
   surface itself once the launch is acknowledged, typing the runtime's display
   command (`claude attach <id>`) into it; the surface never launches anything.
   Native subagents without a terminal remain in the overview; do not simulate them
   with duplicate runtime sessions.
5. Update status from actual native execution or canonical mission observations.
   RUN/REVIEW/WAIT/FAILED/STOPPED are observations; VERIFIED requires fresh delivery
   proofs. Missing observations are UNKNOWN. Model, ctx and quota remain unknown
   unless available from the runtime. An idle screen is not proof of a stalled task.
6. Close only owned, completed display resources after native process termination
   is observed and the return and useful proof artifacts have been recovered.
   Preserve unfinished work and native resume references. No automatic
   process kill, worktree deletion or branch cleanup belongs to presentation.

## Adapter boundary

The presentation port (`packages/void-machine/src/runtime/presentation.ts`) opens a
surface that runs a display command, labels it, says whether it is still there and
closes it. It does not spawn agents, create worktrees, run tests, select models or
authorize merges, and every answer is a value: a multiplexer that fails leaves the
run without a view, with the cause in `agents status`, and changes no permission,
proof or state.

Detection reads the caller's environment, in this order: `HERDR_ENV=1` gives herdr,
a live cmux socket owned by the user (`CMUX_SOCKET_PATH`) gives cmux, `TMUX` gives
tmux, anything else gives none. The adapters live in
`packages/void-machine/src/adapters/presentation/`:

- **herdr**: a `crew` tab for work runs and a `review` tab for reviews, each a grid
  of four panes before the next tab opens; the pane is labelled `WORK-n` or
  `REVIEW-n` and carries `run=<runId>` and `ticket=DEV-n` as pane metadata (source
  `void-machine`). The cockpit's crew view reads the same `ticket=` token.
- **tmux**: `split-window` beside the caller, then below the last run pane, the
  display command passed as argv; the title is the label and the pane option
  `@void_run` carries the run.
- **cmux**: the logic of the former mission presentation script: beside the
  coordinator, then stacked below the last run; the new surface is found by diffing
  the workspace tree, and nothing is attributed when that diff is ambiguous. Its
  title `WORK-n | <runId>` is its ownership mark.

Each surface records the server it lives on (`surface.json` beside the run). A
surface closes when its run retires or stops, and only after the multiplexer shows
that it still carries the run's label and marker: a pane a person closed counts as
already closed, a pane that now shows something else is left alone, and the
caller's own pane is never closed. Closing never touches the run, the worktree or
the evidence; a run whose pane was closed by hand keeps working, and `status` says so.

## cmux implementation

Observed cmux 0.64.22 (102), socket v2. Official reference:
https://cmux.com/docs/api and docs/cli-contract.md (`new-split --command`,
`tree`, `rename-tab`, `close-surface`), read again on 2026-09-28.
Use structured CLI arguments, explicit workspace/surface identities and bounded
calls. Native status colors identify workers (blue) and reviews (cyan); text
carries status independently of color. No changes to the user's global theme.
