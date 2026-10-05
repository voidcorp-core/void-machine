# Skill audit — `autopilot`

Distilled first from `backlog-autopilot` (this repo), which it replaced at range D of the
cutover, then rewritten on 2026-09-22 for the continuous loop of the
[native loop spec](../../specs/2026-09-22-autopilot-native-loop.md). Neither was a rename: each
time the boundaries changed and capabilities were deliberately dropped.

## The 2026-09-22 rewrite: from clusters to a continuous loop

The cluster engine cost 25 to 114 minutes per ticket while the direct mode shipped sixteen in two
hours. Most of that cost was machinery the skill described: an integration pull request per
cluster, range reconciliation, a sealed suite, a grant with seven refusals, a lease, a chain
budget. The rewrite keeps what protects and hands the rest to GitHub.

### What was kept

- **`void-implement` as the one owner of the ticket cycle**, run whole by each worker, specialist
  panel included. Nothing of the cycle is restated.
- **Worktree isolation as a hard rule**, and the admission that it isolates only the working
  tree, the index and `HEAD`. The shared-ref prohibition survives, now proved by a fingerprint
  taken before and after each unit rather than by a denial list in a plan.
- **Footprint collisions and `sequential` paths.** Two tickets that overlap never hold two slots.
  A ticket naming no ground is still not admitted.
- **Consent as a durable declaration.** Absent, unreadable or `enabled: false` still stops the run;
  `mergeGate: union-reviewed` with a `deployBranch` still is the only consent to a machine merge.
- **No `--auto-merge` flag, on any path**, and promotion to the deploying branch stays human.

### What was dropped, and why

- **The integration pull request, its reconciliation, the sealed suite and the grant.** The
  GitHub merge queue rebuilds and retests the combined commit before every merge, which is what
  reconciliation bought, with no code of ours. See the decision on develop merges through the
  merge queue.
- **The union reading.** Each pull request is read on its own, once, and the combination is
  proved by the required checks rather than read. The loss is named in that decision: an
  interaction the tests do not cover can merge.
- **The lease, the chain budget, the draft pull request as progress surface.** The loop keeps no
  state of its own: the tracker and GitHub are the state, so there is nothing to lease and a
  restart is an ordinary tick. Progress is visible in the cockpit panes and in the pull requests.
- **The scaffold-and-hydrate procedure.** One command, `autopilot next`, takes the tracker state
  and returns typed actions; its help gives the shape.
- **Auto-merge as a refused capability.** It comes back, but not as a flag: the kernel returns
  `enable-auto-merge` on the exact head SHA it judged, under the programme's declaration only.

### What is new

- **The cursor between code and model** (after TypeSafe's System One): four typed judgments —
  readiness, queue, conflict class, review verdict — admitted by schema before they move a slot.
- **A dedicated curator** that reads the project, ranks Todo then Backlog then Triage on the
  project's interest rather than the priority label, realigns the tracker with a justification
  per moved ticket, enriches through `void-ticket`, and never closes, cancels or deletes. This
  moves backlog curation from human-only to delegated; see the decision on curator reordering.
- **A bounded reviewer** whose verdict is a commit status GitHub checks: blocking only with a
  scenario, advisories filed once in Triage, two rounds at most, and a re-run of the
  `independent-review` job because a status triggers no workflow.
- **Drain and immediate stops** through a local signal file any pane can write, and a recap
  written from observed state.

### Merge authority, tightened after the loop's review

- **One verdict writer.** `autopilot verdict` posts the comment and the status together, bound to
  the current head, and the loop believes a comment only when the status on the same head agrees. Rejected: a GitHub App or
  dedicated reviewer identity, which Folpe declined; the ADR states that these guards stop a
  mistake or an injection, not an actor holding the credentials.
- **No verdict hook.** A `review-verdict-write` rule once refused hand-written verdicts by parsing
  shell lines; two reviews found seventy, then twenty-three forms it missed. Removed: parsing a
  shell line is never complete, the rule cost more upkeep than it protected, and any other HTTP
  client bypassed it. The barrier is the review key, verified by the required check, plus the
  disarm.
- **The review key.** Replaces the review seal, whose HMAC bound the loop and not GitHub: the
  required check could not hold the nonce and trusted the status alone. `autopilot review-key`
  draws an Ed25519 pair once in the orchestration checkout; `autopilot verdict` signs repository,
  ticket, pull request, head, outcome, findings digest and time; the `independent-review` job
  verifies with the public key read from the base, the loop with its own after checking the base
  carries it. Rejected: the public key as a repository variable (a collaborator's token rewrites it
  with no trace in git), an expiry on signatures (the head is immutable), and a `rotate` command
  (any agent could call it). Limits stated: it protects from a worker and an injection, not from a
  process reading the orchestration checkout, and the workflow itself stays unpinned.
- **Disarming.** GitHub keeps no armed head and keeps an auto-merge across a push with write
  access, so `autopilot arm` records the head it arms and the kernel disarms a moved head (back to
  the worker), an armed head no signed verdict proves, or an unrecorded arming (to a human). The
  disarm rides on every outcome but the two that keep watching a vouched head (`wait merging`,
  `rerun-review-check`), and an immediate stop disarms everything before it freezes: after the
  first review, a hand-back on red CI left the merge armed while the worker pushed a new head.
  Rejected: reading the armed head from the timeline, whose commit entries carry commit dates a
  worker can backdate.
- **Protected paths.** The loop never merges a change to its own judge; the floor is a constant
  the programme can only extend. It covers what a judging workflow runs from outside `.github`
  (the promotion audit, the auto-merge contract, `verify.mjs`, the enforcement floor) and the loop
  code that believes a verdict.
- **Auto-merge by default into develop**, never into main; the release back-merge is exempt from
  the verdict by its bot author's id and by commits proved in git to be the release output. The
  promotion audit accepts an automatic merge whose head carries a success verdict, and the
  back-merge by the same proof; a hand merge still has to be the named human's.

### Still shipped until the engine is removed

`workflows/autopilot.workflow.js` and `references/codex-subagents.md` drive the cluster engine's
subcommands, which stay in the CLI until the loop passes its real batch (checkpoint B of the plan).
Install conformance asserts the workflow is installed, and their tests exercise the old CLI
contract. They are removed with the engine, not before, so the proven path is not deleted ahead of
its replacement's proof.

## History: the first distillation from `backlog-autopilot`

What was dropped then, and why:

- **`--auto-merge`.** It existed behind a risk gate and was never the thing that made the
  feature useful. Refused on every code path, not merely defaulted off. The loop keeps that
  refusal; a machine merge is a programme declaration, never a switch.
- **The headless / `claude -p` backend.** It ran out-of-session and lost MCP, connector and
  subscription inheritance — the very things that let a worker read the ticket it implements.
  Still reserved.
- **The streaming surface and cluster auto-detection by Linear graph edges.** They described or
  guessed instead of proving.

## Boundary with `implement`

Autopilot owns curation, slots, isolation, collisions, the merge path and stopping. `implement`
owns everything that happens to one ticket, including the independent review the loop's reviewer
performs. The overlap is deliberately zero: no pass of the quality cycle is restated here, so the
two cannot drift into two standards.

## One launch path (DEV-929, 2026-09-30)

"Spawning" used to choose: a surface beside the orchestrator when the project had a cockpit
presentation, a native subagent otherwise. A launch that depends on what the agent believes about
its terminal is a launch nobody can predict, and the two paths gave a worker different
permissions. Every worker is now one `void-machine agents dispatch --role work` run in its
worktree, a hand-back is `agents send` to that same run, and the view is the kernel's business.
Rejected: keeping the native subagent as a fallback when the dispatch is refused, which would
hide the refusal the kernel exists to state.
