---
name: void-autopilot
description: Use to drain a bounded cluster of independent ready tickets, each run end-to-end by implement in its own worktree, reconciled into one integration PR a human merges.
---

# autopilot

Take up to four independent ready tickets, work each one properly, hand back a single
integration PR. You stay the merge gate.

**Attribution**: see `.source`.

---

## What this skill does NOT do

It owns no ticket cycle. Every worker runs the canonical `void-implement` skill, whole, once
per ticket. If you find yourself writing "then the worker runs the tests, then reviews…"
inside autopilot, stop: that behaviour has one owner, and duplicating it means the two copies
drift and tickets get a different standard depending on how they were started.

It also never merges. Not with a flag, not when the checks are green, not when the diff is
small. `mergeGate: human` is the only value the programme descriptor accepts.

---

## The layers

**L0 — this skill.** Reads the connectors, hydrates observations, calls the CLI, applies the
action plans it gets back, re-observes, and persists nothing itself except through the CLI.
It is the only layer allowed to talk to the tracker.

**The CLI — `void-harness autopilot`.** Pure computation: selection, review budget, lease
protocol, run state, next action. It contacts nothing — no tracker, no GitHub, no git — and
spawns no agent. Every input and output carries `schemaVersion: 1`.

**The adapters.** Claude executes the orchestration plan with its Workflow primitive, Codex
with native subagents. Both read the *same* `OrchestrationPlan` and return the *same*
`WorkerResult`. An adapter that is missing, or a permission that cannot be proven, returns
`unsupported-runtime` before any progress-provider mutation.

**The workers.** One ticket, one worktree, one branch, one full `void-implement` run.

---

## Where the target comes from

The run takes no argument in the normal case. `.void/program.md` names the progress provider, its
opaque scope and the base, so there is nothing to repoint and nothing to ask: not which work unit,
not which cluster, not which run id, not which provider.

That file is also the consent, and consent is never inferred. An absent `.void/program.md`, a
`status` other than `executing`, an `autopilot` block that is missing or unreadable, or
`autopilot.enabled: false` all mean the same thing — say so and stop. Inventing a target here
claims tickets nobody agreed to hand over.

---

## The cycle

1. **Preflight.** Prove the runtime adapter, the connectors, git permissions, the base branch
   protection and worktree creation. All of it, before the lease. A capability discovered
   missing halfway through leaves a claimed cluster nobody is working.
2. **Plan.** Pipe the candidate observation into `autopilot plan`. Four is a ceiling, not a
   quota: the review budget shrinks the cluster when footprint, confidence or collision risk
   would make one PR unreviewable.
3. **Confirm with the human.** Show the cluster, the lanes, the exclusions and their causes.
4. **Lease.** Apply the ordered actions the CLI returns, then **re-observe every ticket**.
   The lease is active only when all of them converged. Partial convergence releases what was
   taken — half a cluster produces an integration PR that can never be complete.
5. **Create the worktrees.** The controller creates every worktree and branch before any
   spawn, including for sequential tickets. A worker never chooses its own checkout and never
   works in the main one.
6. **Fan out.** Parallel where footprints are disjoint and confident; sequential for overlap,
   low confidence, lockfiles, migrations and shared-ownership files. A migration is never
   parallel, whatever the estimate says.
7. **Collect.** Parse every result against the schema. Prose is not a result. A worker that
   was interrupted after committing is re-observed through its git ref, never replayed blind.
8. **Reconcile.** One integration branch, cut from the *pinned* base commit. Each verified
   range is merged `--no-ff` so the PR body can claim per-ticket provenance honestly. A range
   whose ancestry was not proven is excluded before the branch exists — a clean `git merge`
   exit code says nothing about *what* was merged. Files the plan marks `reconcileOnly` are
   reverted to the base and rebuilt once, at the end.
9. **Seal.** Run the full suite on the integrated tree. Every proof is bound to the
   integration SHA, the diff hash and the exact argv; rebase, conflict or a moved base makes
   it stale and it is re-run. Nothing is published on a proof about a tree that no longer
   exists.
10. **Publish.** One explicit, non-forced refspec, one branch, one PR. Never a worker branch:
    pushing one publishes unreviewed history under an official-looking name and starts CI on
    it. The body carries included and excluded tickets with their commit ranges, the conflicts
    resolved and why, the local proofs and the remote runs actually spent.
11. **Drive the checks.** A red check this diff explains is fixed locally and the *same*
    branch is pushed again — counting the extra run rather than hiding it. A red check the
    diff does not explain is escalated, never silenced: no required check is ever disabled to
    make a run finish. When every required check is green the PR is left ready, and the
    included tickets move to In Review with the PR link and their range.
12. **Close on proof.** Done comes from an observed merge, never from a local cursor: an
    absent PR is not a merge, and a closed one is not a merge either.

---

## Resuming, and closing

A session that comes back reads the remote before it reads its own cursor. Pipe the full pull
request observation — number, state, head ref and sha, base ref and sha, merge sha, checks —
into `autopilot status`, and act on the verdict it returns:

| Verdict | What it means | What you do |
|---|---|---|
| `publish` | nothing was observed on the remote | publish; it is idempotent against an existing request |
| `republish` | the remote head lags the local one | push the same branch again |
| `rebase` | the base moved under the run | rebase, reconcile again, re-run the whole suite; the proofs are stale |
| `await-checks` / `fix-checks` | required checks pending, or red on this diff | wait, or fix locally and push again |
| `ready` | every required check is green | leave it for the human, move the included tickets to In Review |
| `merged` | GitHub reported a merge commit | move the included tickets to Done, close the lease |
| `blocked` | closed unmerged, a foreign branch, a merge with no commit, a red check this diff does not own | stop and report; none of these is a completion |
| `observe-again` | the reading was partial | read it again; a partial answer is not an answer |

The verdicts that end a run demand evidence and refuse an inference. An absent pull request is
an absence. A closed one is a refusal. Only a merge commit is a merge. Tracker writes carry an
idempotency key derived from the run, so a write whose result came back unknown is retried as
the same write and never as a second one — and a partial write keeps the run in
`tracker-reconciliation` rather than letting it call itself synced.

`abort` releases the claim, never the work: leases go back, branches, commits and the cursor
stay exactly where they are, and no ticket moves forward.

---

## What a worker is given, and what it may do

Given: exactly one ticket id, one worktree path, one branch, and the paths of the global plan
and spec. It re-fetches the complete ticket itself — never work from a summary.

May: run every `void-implement` pass whose predicate fires, run its own targeted gates, apply a
migration **in dev/local only**, and commit a bisectable range.

May not: push, open or update a pull request, merge anything, move the ticket to In Review or
Done, or touch a file the plan marks `reconcileOnly`. These are denied in the orchestration
plan itself, not only in the prompt, so an adapter that honours the plan cannot grant them.

---

## Red flags

| Rationalization | Reality |
|---|---|
| "The worker can just push its branch, it is faster" | Workers are commit-only. A pushed worker branch triggers CI on work that has not been reconciled. |
| "Both tickets touch different folders, run them in parallel" | Different folders, same lockfile is still a collision. The partition decides, not the intuition. |
| "The tracker write probably worked, carry on" | A write with an unknown result is unknown. Re-observe; never conclude from a request that timed out. |
| "Only one ticket failed, ship the other three" | That is exactly right — and it is what partial success does. But the failed one keeps its branch and its blocker. |
| "The cluster is only three tickets, skip the review budget" | The budget is what shrank it to three. |
| "Autopilot should run the tests too" | `void-implement` runs them. Autopilot runs the full suite once, at reconciliation, on the integrated branch. |
| "The suite was green before the rebase, publish" | The proof was about a tree that no longer exists. Re-run it. |
| "That check is flaky, turn it off and the PR goes green" | The check is the gate. A failure it does not own is escalated, not silenced. |
| "The PR is gone from the list, it must have been merged" | An absent pull request proves nothing. Done comes from an observed merge SHA. |

---

## Composition

Upstream: `void-ticket` authors the work units and the program descriptor.
Per ticket: `void-implement`, entire, once. Downstream: the reconciler owns the
integration branch, the suite and the PR. The human owns the merge.
