---
name: void-autopilot
description: Use to run the continuous delivery loop, where a curator ranks the backlog, up to four workers each run void-implement to a PR, and a local review verdict gates each merge until drained or stopped.
---

# autopilot

A continuous loop that takes tickets from the tracker to the integration branch without a human
at each merge. A curator ranks what is worth doing, up to four workers each carry one ticket to
a pull request, a reviewer reads each one once, and the loop merges the head it passed, through
GitHub's merge queue when the base has one. A person who says they merge themselves gets every
reviewed pull request instead. Promotion to the branch that deploys stays human.

**Attribution**: see `.source`.

## What this skill does NOT do

It owns no ticket cycle. Every worker runs the canonical `void-implement` skill, whole, once per
ticket, with applicability owned there. If you find yourself writing "then the worker runs the tests,
then reviews..." inside autopilot, stop: that behaviour has one owner, and two copies drift until
a ticket gets a different standard depending on how it was started.

It never merges on a flag. Not on the command line, not because the checks are green, not because
the diff is small. There is no `--auto-merge` on any path and no merge gate to configure: the loop
merges into the integration branch only a head a local verdict passed, and never into the branch
that deploys -- `autopilot.deployBranch`, or the repository's default branch when config
names none. When the person says they merge themselves, run `void-machine autopilot merges
--by-human`: from the next tick every reviewed pull request goes to them instead (see Who merges).
Promotion from the integration branch to the one that deploys stays human.

It never merges a change to the machinery that judges merges. A pull request touching
`.github/**`, `.void/program.md`, `packages/core/hooks/**`,
what a judging workflow runs from outside `.github`
(`scripts/auto-merge-contract.mjs`, `scripts/verify.mjs`,
`packages/core/enforce/**`), what judges a publication (`scripts/prepare-release-artifact.mjs`,
`scripts/verify-release-publication.mjs` and the two release contracts they read), the loop code that believes a verdict and merges (`loop.ts`,
`loop-observe.ts`, `branch-identity.ts`, `commands/autopilot-loop.ts`), the local chain of judgment
(`packages/void-machine/src/**`, `commands/agents.ts`, `authority.ts`, `config.ts`, `judgments.ts`,
`merge-hold.ts`, the review command, its parser and the reviewer's definition,
`footprint-area.ts`), or the
runtime configuration installed here, which a reviewer running in a worktree of the head loads too
(`.void/hooks/**`, `.claude/**`, `.mcp.json`, `.codex/**`, `.void/config.json`) goes to a person with the file named (`protected-path`). A rename
counts by its source and its destination. Config adds paths through
`autopilot.protectedPaths`; nothing removes from that floor.

It never closes, cancels or deletes a ticket, and it never touches `main` or repository settings.
Autopilot consent alone never authorizes credential operations: these require separate explicit
scope under `void-security-guidance`. Role restrictions, including read-only reviewers, remain binding.

## Consent and target

The run takes no argument. Its sole authority is `.void/config.json` `autopilot`,
with `schemaVersion: 3` and an explicit boolean `enabled`. `enabled: false`, an absent
block, old versions, invalid or unreadable config refuse dependent autonomous actions.
Historical programmes supply no consent or veto. Never promote v2 automatically: reconcile
prior consent, branches, project/milestone scope, human gates, additive protections,
verification commands and sequential ownership before a human explicitly declares v3.
`init`, `update` and pack changes preserve old declarations and historical files.
`next`, review, fingerprints, publication and doctor share the authority reader.

Resolve `progress.provider/scope/states` through native tools. Scope is the opaque native
project-and-milestone locator; that milestone links the approved plan and decisions.
Read the plan, complete ticket and actual membership, blockers and holds before admission.
The kernel receives observations; it does not independently verify Linear or milestone membership.
Milestone membership alone grants no new permission. Missing scope, plan or required provider
capability blocks dependent selection; local checkpoint and Git work remain available.

On resume, read the full checkpoint, including Engaged work and Planned work. Reconcile all
engaged tickets, PRs, Git and native workers before acting: several engaged units are normal,
not a reason to launch duplicates or halt independent work. An uncertain worker is reconciled
before replacement. Remove completed work from intentions only after observing completion.
Respect changed planned order within authorized scope and blockers. Removing a planned item
cancels no remote ticket and deletes no worktree. Saved observations grant no consent or fresh
proof; nothing recovers decisions after the last successful checkpoint. Preserve merge-hold,
including its fail-closed unreadable state; former human merges remain human during migration.

## The cursor between code and model

The model renders narrow, typed judgments; the policy stays in the code. Agents keep their whole
freedom over the work itself -- ranking, implementing, resolving a conflict, reading a diff. At
each decision point their answer is closed, and the CLI admits it against a schema before anything
acts. An answer that does not fit is a refusal naming the field, never an interpretation.

| Decision point | Judgment the model renders | Policy the code applies |
|---|---|---|
| Is a ticket workable | `readiness`: `ready`, `needs-enrichment` or `ambiguous`, with a reason | only `ready` gets a slot |
| What comes next | `queue`: ordered entries, each with a justification and a footprint | the head takes a free slot unless it collides |
| A conflict after ejection | `conflict`: the conflicting `headSha`, `mechanical` or `semantic`, with a reason | `semantic` waits for a human |
| A review | `review`: the `headSha` read, round 1 or 2, `blocking[]` each with location, scenario and correction, `advisory[]` | a blocking finding without a scenario is invalid; no merge without a clean verdict on the exact head; two rounds at most |

Slots, collisions, review rounds, stops, resumption and the merge are the kernel's. No agent may
skip a step, merge, or decide that a refusal does not apply to it.

## Four roles, one subject each

**Curator.** Decides what is worth doing next. Touches the tracker, never code.

**Orchestrator.** Runs the loop and may inspect the ticket, code or diff needed to explain,
dispatch or resolve a coordination question. Implementation stays with the assigned writer.

**Workers**, one per slot, are commit-only. Each carries one ticket to a committed candidate
and proof references in its own worktree; the coordinator owns pushes and pull requests.

**Reviewer.** The independent pass of `void-implement`, invoked by ORCH through
`void-orchestrate` in a fresh read-only context on the exact head SHA. `autopilot review`
prepares and collects its canonical receipt locally. There is no second review at merge
time: the merge happens on that head alone.

Coordinator inspection never replaces the fresh independent review or grants merge permission.
Read only the context needed for the question; do not duplicate a systematic review.

## Curator

Build an initial selection bounded to the authorized native project and milestone, using the
approved plan, intended order, dependencies, open PRs and human holds. Keep at most sixteen
queue entries; fetch complete selected units and relevant relations before declaring readiness.
Preserve human priorities and assignments. Refresh affected units after a merge or new evidence;
do not rescan and rerank the entire backlog after every merge.

- **Enrich before ready.** A vague ticket goes through `void-ticket` before it can be declared
  `ready`. Ambiguous arrivals stay visible and non-admitted, without stopping independent work.
- **Name the ground.** Every entry has a footprint. Colliding ownership stays sequential.
- **New work.** A clear approved arrival belongs in the same native project and milestone;
  write those native links and read back membership. Unclear scope needs a decision, not a guess.
- **Never close, cancel or delete.** Preserve tickets and human ownership; planned-list changes
  are intentions only.

Return the typed `queue` judgment with a reason per entry. The curator can run in the
orchestrator's session or as an agent; its output is data the kernel admits, never authority.

## Orchestrator

The loop is one question asked again and again: `void-machine autopilot next --json`, with the
tracker state on stdin. The command reads config authority, GitHub, the shared git state and the stop
signal itself; GitHub is the authority on a merge, so no agent reports it.

What you pipe in is the tracker as you observed it -- `void-machine autopilot --help` gives the
shape: `schemaVersion: 1`, the curator's `queue`, every ticket in scope with its provider status,
`humanWait`, pull request, branch, footprint and the raw `readiness` attached to it, the `recent`
outcomes of this run, the `liveWorkers` you actually have, and `quota` (`low` once the runtime
reports its limit is near). Pass judgments through raw; the kernel admits each one where it is
used, so one malformed answer refuses its own decision and nothing else.

Act on each returned action, then ask again:

| Action | What you do |
|---|---|
| `assign` | read the complete ticket and current relations, verify blockers and holds, claim once (In Progress, assigned), run `autopilot fingerprint --before <ticket>`, create or reuse its worktree, create the controlled mission there with title and full frozen ticket via `void-orchestrate`, hand its ID, complete execution contract, source identity and observed claim to the worker |
| `wait` | nothing; the reason says who is working |
| `hand-back-to-worker` | give the ticket back to its worker, alive or respawned in the same worktree, with the reason and the pull request; a respawned worker resumes its mission (see Respawning) |
| `mark-human-wait` | record it in `recent` with its `reason`, which `recent` requires and the recap repeats, put the decision's `humanWaitLabel` on the ticket, publish a concise material blocker or actual handoff, free the slot; keep reporting its pull request and footprint, which hold its ground until that pull request merges or closes |
| `merge` | `void-machine autopilot merge --ticket <id> --pr <n> --head <headSha>`, on a base with no merge queue: it proves again the hold, the verdict and the target, merges exactly that head with `--match-head-commit`, and arms the native auto-merge on it when the base's policy refuses a direct merge; never `gh pr merge` by hand, never `--admin` |
| `update-branch` | `void-machine autopilot update-branch --pr <n> --head <headSha>`: GitHub merges the base into the branch if its head is still that one; the new head is reviewed before anything merges it |
| `enable-auto-merge` | `void-machine autopilot arm --ticket <id> --pr <n> --head <headSha>`, on a base with a merge queue: the same guards, then it records the head, arms on exactly that head and reads GitHub back; never `gh pr merge --auto` by hand, never `--admin` |
| `disable-auto-merge` | `void-machine autopilot disarm --pr <n>`, before the action that follows it for the same ticket; it turns its auto-merge off, then takes it out of the merge queue, and fails while GitHub still shows either; never `gh pr merge --disable-auto` alone, which leaves a queued pull request in the queue |
| `review` | `void-machine autopilot review --ticket <id> --pr <n> --head <headSha> --round <round> --mission <canonical-id> --worktree <assigned-path>` from the coordinator checkout; on awaiting-native-review use `void-orchestrate` for the actual reviewer, record canonical receipts, then repeat to collect. The same attempt keeps its 30 minute deadline; failures retain the existing budget |
| `requeue` | the same command, to put an ejected head back in the queue; the kernel bounds how often |
| `drain` | take nothing new; keep acting on the tickets in flight |
| `freeze` | stop acting, once the disarms before it succeeded |
| `recap` | write the final recap and end the run |

A pull request observed merged has no action: move its ticket to Done, clean its worktree, count it
in `recent`, and ask the curator to re-rank. `refusals` name judgments the kernel would not admit:
send each back to the agent that produced it.

**Spawning.** Every worker gets its worktree before it starts, at the durable location the
doctrine's worktree rule names, reused when its branch already has one. A worker never chooses its
own checkout and never works in the main one. Compose `void-orchestrate` to choose supported
native delegation and publish its observed worker lifecycle through `agents record`
under the canonical mission, as `void-orchestrate` defines. Count writers,
researchers and reviewers against available dispatch capacity; the ticket cap is unchanged.
An assigned worker executes the unit once, without recursively delegating the complete cycle.
`liveWorkers` reflects reconciled actual sessions and current evidence, never stale pane hints.
No permission is widened. Collect results before closure; uncertainty requires reconciliation.

**Respawning.** A hand-back goes to the same native session that holds the ticket, with the
reason and pull request as data. Re-read mission, Git and actual session evidence; consult central
brief/report and actual native identities. Keep the worker runId until its assignment
closes, publishing each observed transition through `void-orchestrate`. Never a second run
beside an existing or uncertain invocation. A missing session is reported; retain its evidence.

A respawned worker resumes; it never starts the ticket again. Its code is in its
worktree and its branch, its progress in its mission journal, `.void/machine/runs/<mission>/events.jsonl`
under the installation root, which is the main checkout and not the worktree. It finds its mission
as the open one whose `mission.json` carries the ticket id as its title, runs
`void-machine mission resume --id <mission> --json` and acts on the recovery decision it prints,
then goes on with `mission dispatch`. `resume` records itself once per checkpoint; it exits 1 while
the mission waits and refuses a closed one, and neither is answered by opening a new mission: the
worker reports it. When the worktree is gone, recreate it from the branch. When the branch the
tracker names for the ticket is gone too, locally and on the remote, the work is lost: do not
spawn over it, record `mark-human-wait` yourself with the reason `branch-missing`.

**The fingerprint.** A worktree isolates the working tree, the index and `HEAD`, and nothing else:
the local config and the files it includes, the stash, tags, notes, remotes, the local base and
deploy branches, replace refs, `hooks/` and `info/` are one set for every worktree. The upstream
(`remote`, `merge`) of every branch but the bases and the one that deploys is left out, since units
in flight set it when they create or push their branch and drop it with a merged one; the bases'
own settings still count; only regular root `info/refs`, Git’s generated transport cache, is exempt. Start each worktree from
`origin/<base>` and never move a local base branch while units are in flight. The baseline
recorded at `assign` is written once: a second `--before` for the same ticket is refused, so a unit
cannot re-record the state it left as the state it found. `autopilot fingerprint --after <ticket>`
checks it; the coordinator publishes only through `autopilot publish --ticket <ticket> --head <sha>
--remote <remote> --branch <branch>`, which couples that guard to the literal SHA push. Never follow
refusal with direct Git. A differing fingerprint proves drift, not which worker caused it; keep
unrelated authorized local work moving while the affected publication waits. Human renewal retains evidence; see [publication and recovery](references/publication.md).

**Disarming.** Armed means GitHub merges without anyone acting again: an auto-merge request, or,
once the checks pass on a base with a merge queue, an entry in that queue and no request at all.
GitHub keeps an auto-merge armed across a push by anyone with write access, shows
no armed head, and its required check trusts the status alone. So `arm` records the head it armed,
and `next` returns `disable-auto-merge` when it can no longer vouch for an armed pull request: its
head moved since `arm` recorded it (then `hand-back-to-worker`, `head-moved-after-arming`: the new
head is unreviewed), no clean local verdict holds the armed head (then
`mark-human-wait`, `armed-verdict-unproven`), nothing recorded the arming (then
`mark-human-wait`, `arming-unrecorded`), or a person took the merges back (then
`mark-human-wait`, `human-merge-hold`). An armed merge survives a tick only while the loop vouches
for its head and hands it to nobody (`wait merging`): a worker at work, any
hand-back, a human wait and an immediate stop all come with the disarm. Disarm first, always.

**The review is local.** `autopilot review` prepares the exact head in a detached worktree,
checks its `HEAD` before and after collection and refuses any protected path. ORCH invokes the
native reviewer there. Collection requires the canonical independent receipt and actual matching
request/start/completion: reviewedCommit, baseCommit, acceptanceCriteriaHash, distinct writer and
reviewer, read-only scope and authentic native-context or review-artifact provenance. A central
report marked done proves none of these. The verdict is recorded in
`.void/machine/autopilot/reviews/<ticket>/<head>.json`; `next` decides on that record alone.
One attempt runs per head, pending rereads do not reset its deadline, recorded verdicts are
immutable and rounds are counted from existing records. Legacy in-flight runs retain their own
collector and journals. A verdict posted on the pull request is a copy for people. Checks,
protected paths, shared-state fingerprints, human holds and merge permissions are unchanged.
Remove a review worktree with the ticket's own only after the pull request is observed merged.

**Who merges.** The loop, by default. When the person says they merge themselves, run
`void-machine autopilot merges --by-human`; `--automatic` gives the merges back, and bare
`merges` prints the state. The hold is a file in the machine's state,
`.void/machine/autopilot/merge-hold.json`, never config, which is protected and versioned:
it takes effect on the next tick, with no pull request, and every decision reports it in
`merges`. It hands a pull request over after the review, never before: a head is reviewed, its
checks settle, then it goes to the person (`mark-human-wait`, `human-merge-hold`), and an armed
merge is disarmed first. A hold file that cannot be read counts as a hold. Those waits never
count toward the streak that stops the loop. A hold only takes authority away; removing it
returns to the default the person already accepted.

**No state lives in the session.** Who holds which ticket comes from the tracker (status, assignee,
pull request link, the human-wait label); the rest comes from GitHub. The label is the one every
decision names in `humanWaitLabel`: `autopilot.humanWaitLabel` when config declares it,
`void:human-wait` otherwise; report `humanWait` as that label's presence, nothing else. After a restart -- an OS
update, a cut, a saturated context -- the first `next` rebuilds the slots from those two sources,
and a ticket already held is resumed, never seated twice. Report each ticket's branch and pull
request whenever they exist, whatever its status: a ticket still ready but with a branch or a pull
request is a unit in flight, and the kernel resumes it instead of seating a second worker. A
ticket whose state is ambiguous goes to a human rather than being relaunched.

**Judgments survive a restart.** A worker's conflict class is a comment carrying a machine block:
two HTML comment markers around a fenced JSON value, the block `void-machine autopilot judgment
conflict-class` prints for the JSON on its stdin; `next` reads it from GitHub and admits it again.
The review verdict is the local record above, never a comment. The tracker you pipe in carries
neither, so a restart loses nothing.

## Workers

Given: the complete current ticket contract, source identity and observed claim, its worktree,
branch, canonical mission ID, and approved milestone plan/spec. An immediately dispatched worker reuses
that handoff without another fetch or claim. A summary is insufficient: refresh missing, truncated
or uncertain information, and relevant status/relations after a delay, resume or material change.
Standalone `void-implement` still owns its own intake and claim.

It runs `void-implement` whole and `mission dispatch` in that worktree, reusing the mission
the coordinator created once with `--title <ticket-id> --ticket <full-frozen-ticket>`.
A respawn retains that identity and its budgets. Before any context compaction it writes to the
mission what it has done: each specialist result through `mission specialist-event`, each proof
through `mission verify`, a committed candidate through `mission writer-event`. The journal accepts
only these typed events, no free note; what is not yet one of them does not survive a respawn, and
uncommitted edits survive only in the worktree. During development, the coordinator may create or reuse a draft pull request
for the branch; drafts are permitted for development, never for merge admission. After the worker
returns its commit and green proofs, the coordinator runs the guarded `autopilot publish` command
and prepares the same pull request when authorized (create one only if absent), then moves the
ticket to In Review. A person-held draft is never made ready implicitly. The coordinator may
explicitly request review of a completed draft through the existing `autopilot review --mission
<canonical-id> --worktree <assigned-path>` entry, with its ticket/PR/head/round arguments. Admission
reads the authenticated plan, valid writer lifecycle, clean committed subject and current applicable
proofs before starting an attempt. Partial work, pending correction or changed evidence refuses
that review. A clean review of the unchanged draft waits for readiness without another writer or
reviewer; draft always refuses `merge` and `arm`. Early draft review is optional.
Blocking findings come back as a hand-back and are corrected as a batch, per `void-implement`.

On a hand-back the worker reads the reason: failing checks, blocking findings, a conflict, or a
base that moved. It updates its branch by merging the base into it,
never by rewriting pushed history, re-runs its proofs, and returns its commit to the coordinator.
The coordinator updates the same PR; the worker does not create another one.

May: run every `void-implement` pass whose predicate fires, run its own gates, apply a migration in
dev/local only, and return its commits and proofs to the coordinator.

May not: enable auto-merge, merge anything, post or record a verdict, run `autopilot review`, push, create or change pull requests, move a ticket to Done, close or cancel a ticket, touch another ticket's branch or worktree,
prune the mission journals, or write the git state the repository shares -- `refs/stash`, tags,
notes, remotes, the repository config.

## Reviewer

`independent-code-reviewer`, collected by `autopilot review` on a ready pull request or an explicitly admitted completed draft.
Its brief carries the diff against the merge base as data, what blocks, and the answer it returns:
its own completion contract, each finding classified, a blocking one located at `path:line` in the
head. The kernel binds the answer to the head and the round; a reviewer that could not judge, whose
verdict contradicts its findings, or whose answer the contract refuses, gives no verdict.

**What blocks.** Only what is wrong or dangerous, with a concrete scenario: incorrect behaviour, a
vulnerability, an unstable or empty proof, a broken consumer. Each blocking finding names its
location, the scenario and the correction. Everything else is advisory. The number of blocking
findings measures nothing; a pass that files four advisories and blocks on none is a good pass.

**Advisories** stay in the review result and recap. They create no ticket automatically and never
return to the loop without a separate decision to pursue them.

**Rounds.** After a correction, round 2 receives round 1's blocking findings and checks the
corrections, affected behavior and demonstrated regressions against the new diff; it opens no new general reading. Still blocking after round 2, the kernel
hands the ticket to a human with the finding. The kernel counts rounds from the local records, one
per head a verdict blocked, not from the round a verdict announces, and a reviewer that failed
without a verdict is an attempt it delegates again, not a round.

## Conflicts and the merge queue

A head merges once a clean local verdict holds it, no check on it fails or is pending (a head no
check runs on merges on its verdict alone), no protected path is touched and its branch is up to
date with the base. When the base has a merge queue, GitHub rebuilds the combined commit of every
pull request ahead and reruns the required checks before it merges. Two tickets green alone and
broken together cannot reach the base. Required checks a repository adds on the base are one more
gate GitHub enforces at merge time; the loop needs none.

A pull request ejected from the queue whose head still passes its checks and carries a clean
verdict has nothing for its worker to fix: the kernel answers `requeue`, at most twice for the same
head, then sends the ticket to a human. An ejected head whose own checks fail goes back to its
worker as failing checks. A pull request in conflict with the base goes back to its worker. The
worker classifies the conflict as the typed `conflict` judgment on the conflicting head, posted
through `autopilot judgment conflict-class`: `mechanical` it resolves, re-runs
its proofs and returns its commit for coordinator publication. Before declaring a `semantic`
conflict, the coordinator consults accepted decisions. Only genuinely incompatible intentions
that those decisions cannot reconcile require a human choice, with the concrete behavior and a
recommendation. The affected ticket and dependent or colliding work wait; independent work continues.

**Serial fallback.** This path requires no queue service or paid plan.
For CI optimization, use [void-verify CI feedback](../void-verify/references/ci-feedback.md);
add neither a second scheduler nor a mandatory duration gate.
Without a merge queue, merges run one at a time: the oldest ready pull request
(or the one already merging) holds the turn. The kernel reads whether the base moved past its head
itself, since GitHub reports it only under a protection that requires it: a head behind gets
`update-branch`, its new head is reviewed again, then merged, then the next. `merge` reads it once
more just before merging. Same guarantee, lower throughput; the residual window is a person
merging by hand between that read and the merge. The kernel keeps the turn; you do not.

## Stopping

**Drain.** Requested by a person (`void-machine autopilot stop --drain`, from any pane) or reached
on its own: nothing ready or preparable, or quota low. Several independent human waits do not
stop other authorized work. A shared unavailable capability stops the actions that need it;
dependency, collision and correction limits still apply.
The loop takes nothing new, carries the tickets in flight to a merge or a human wait, closes its
agents, cleans the merged worktrees, and writes the recap.

**Now.** `void-machine autopilot stop --now`. Everything freezes, a merge GitHub would run on its
own included: `next` returns a `disable-auto-merge` for every armed pull request, then `freeze`.
Run the disarms, then stop. When `next` cannot read what is armed, or a disarm fails, it does not
pretend to have frozen: disarm by hand what it names and tell the person. Nothing is lost: the
state is in the tracker and GitHub. Use `void-checkpoint` for the local handoff and planned work.

The stop file stays until someone deletes it; a new run starts only once it is gone.

**The recap.** What merged, what waits and why, advisories retained in review results, and the time each
ticket took. It is the account a person reads when they come back; write it from observed state,
never from memory of the session.

## Red flags

| Rationalization | Reality |
|---|---|
| "The checks are green, merge it myself" | Only `merge` or `enable-auto-merge` from the kernel merges, through its command, and only on the SHA it names. |
| "They said they'd merge, I'll remember that" | Run `autopilot merges --by-human`. The loop reads the file every tick; a session forgets. |
| "The worker already reviewed its diff" | Self-review is not independent. The reviewer is a separate context on the exact SHA. |
| "Post the verdict comment by hand, it is quicker" | No comment counts: the loop merges on the local record `autopilot review` writes. A hand-written one is text. |
| "The reviewer failed, approve it and move on" | A failed review is delegated again once, then a person looks. Nothing approves a head the reviewer did not judge. |
| "That advisory matters, block on it" | Blocking needs a scenario where it is wrong or dangerous. Otherwise retain it as advisory without automatic ticket creation. |
| "This duplicate ticket can just be closed" | The curator never closes. Comment, and leave it to a person. |
| "P1 on the label, so it goes first" | The ranking reads the project, not the label. Justify the move on the ticket. |
| "Both tickets touch different folders, seat them together" | Different folders, same lockfile is still a collision. The kernel decides. |
| "The conflict is semantic but I see what they meant" | Consult accepted decisions; unresolved incompatible intentions wait for a human. |
| "I remember which worker had which ticket" | Rebuild from the tracker and GitHub. The session is not the state. |
| "The PR is gone from the list, it must have been merged" | Only a merged pull request observed on GitHub is a merge. |

## Composition

Upstream: `void-ticket` authors and enriches the tickets and native milestone membership and plan links. Per ticket:
`void-implement`, entire, once, in the worker's worktree. The merge into the integration branch
belongs to the loop, on a local verdict, or to a person who holds the merges; the promotion to the
branch that deploys always belongs to a person.
