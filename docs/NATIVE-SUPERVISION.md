# Native mission supervision

Local presentation integration for the approved
[spec](specs/2026-09-05-visible-agent-supervision.md), carried since 4.1 by the
presentation port of the delegation kernel
([spec](specs/2026-09-28-supervised-agent-delegation.md), "Adaptateurs de présentation").

## Procedure

One procedure, for every caller: the coordinator, `void-autopilot` (workers and reviewers) and
`void-implement` (specialists). None of its steps asks the agent whether a display exists.

1. Resolve the target project through the existing project discovery and read its
   rules. Resolve the mission through the provider or the explicit user objective.
   Record Git branch/status; preserve unrelated changes. Reuse native continuity.
2. The coordinator stays in the terminal it already runs in. Nothing creates a
   workspace for display, and no second coordinator is ever launched for one.
3. A work run gets its isolated worktree first, through the existing execution
   workflow; a review run gets the checkout it judges.
4. Every delegated agent is launched with `void-machine agents dispatch`, and no
   other way. The kernel admits the run, launches the native session, and opens
   the run's view itself once the launch is acknowledged, typing the runtime's
   display command (`claude attach <id>`, `codex resume <thread> --remote ...`)
   into it; a view never launches anything. The same run exists whatever the
   terminal can show, so the caller has nothing to decide. A refused dispatch is
   reported with its cause and repair; it is never replaced by another launch path.
5. Follow runs with `agents wait` and `agents status`, which report actual native
   execution: working, turn-ended, waiting-human, failed, stopped, reconciling.
   Missing observations are unknown, never inferred; an idle screen is not proof
   of a stalled task. A run `waiting-human` is answered by the person in that
   agent's own session: no other session can approve in their place.
6. `agents accept` collects a result and retires the run; `agents stop` ends one.
   Either closes the view the kernel owns, and nothing else: the worktree, the
   branch and the proofs keep their own lifecycle, and no process kill, worktree
   deletion or branch cleanup belongs to presentation.

What stays outside this path, by construction rather than by choice: a Claude `fork`
subagent, which inherits the coordinator's context, and agents the `Workflow` tool
launches. Both remain native and are not shown.

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
- **cmux**: beside the coordinator, then stacked below the last run; the new surface is found by diffing
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
