---
schemaVersion: 1
id: "adr:6660e476-77c4-420b-801d-00f941c9395e"
createdAt: "2026-09-28T09:41:18.915Z"
title: "Autopilot merges on a local review verdict bound to the head SHA, with no GitHub App in a consumer project"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903"]
---

# Autopilot merges on a local review verdict bound to the head SHA, with no GitHub App in a consumer project

## Context

`adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903` has a dedicated GitHub App post the
`independent-review` check, and the autopilot loop arms a merge only on that check. A
consumer project cannot run the 4.0 loop: `openPullOutcome` waits for that check before it
reads `mergeGate`, and the check needs an App, an environment, two secrets, two variables
and branch protection that no published file installs. Observed on
`voidcorp-core/void-cortex` with `voidmachine@4.0.0`: even with a human merge gate, every
pull request waits forever.

Folpe's principle, 2026-09-28: a consumer gets an operation that is simple on the surface,
reliable and safe; safety is never paid for in operation; a consumer never creates a
GitHub App. The binding design is the autonomous merge spec
(`docs/specs/2026-09-28-autopilot-merge-without-consumer-setup.md`); its independent
reviewer is a `review` run of the kernel's delegation capability
(`docs/specs/2026-09-28-supervised-agent-delegation.md`,
`adr:0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7`).

## Decision

Autopilot has a single merge mode: by default it merges on its own into the integration
branch, once a fresh-context, read-only reviewer launched by the kernel in a worktree
detached at the head SHA has recorded a verdict with no blocker in the local journal, no
GitHub check is failing or pending on that SHA, no protected path is touched and the branch
is up to date with its base, through `gh pr merge --match-head-commit <sha>`; a human hold,
written by `void-machine autopilot merges --by-human` to
`.void/machine/autopilot/merge-hold.json`, hands the ready pull request to a person instead,
and no GitHub App is required in a consumer project.

This supersedes `adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903` for the merge mode only:

- The `mergeGate` and `trust` keys cease to exist. The loop never merges into the branch
  that deploys, and a protected path always goes to a person.
- The kernel checks the review worktree's `HEAD` before and after the run and records the
  judged SHA itself; the reviewer never declares it.
- No verdict is read from GitHub. On a public repository anyone can comment; the local
  verdict is authoritative, and a comment is its copy for humans.
- The hold only ever reduces authority; `void-machine autopilot merges --automatic` removes
  it, which only returns to the default the human already accepted. It hands the pull
  request over after the review, never before. It is local machine state, read on every tick and
  independent of any agent's memory, and never written to `.void/program.md`, which is
  protected and versioned: a hold there would take effect only after a human-merged pull
  request, and a dirty tree would block the `--ff-only` synchronization.
- A base with a merge queue or required checks keeps the existing auto-merge path, which
  GitHub arbitrates.

What stays in force from `adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903`: in this repository,
the dedicated App keeps posting `independent-review`, and branch protection keeps requiring
it from that App. void-machine is public and ships a tool other people install; a required
check whose origin is proved by construction is the native GitHub layer the spec leaves
open to any repository that wants more than the local verdict, and this repository wants it
because a defect merged here reaches every consumer. That App and its workflow are this
repository's own configuration. The product ships no App, no review workflow and no
`doctor` prerequisite for one.

## Residual risk accepted

As written in the spec, verbatim:

> Un worker désobéissant, sur la machine du propriétaire, pourrait écrire un faux verdict
> local. Bornes : le lien au SHA, les chemins protégés (la machinerie ne change pas sans
> humain), l'empreinte d'état Git partagé autour de chaque unité, et la promotion humaine
> vers la branche qui déploie. Un dépôt qui ne peut pas accepter ce risque ajoute des checks
> requis côté GitHub.

In English: a disobedient worker, on the owner's machine, could write a false local
verdict. Its bounds are the binding to the SHA, the protected paths (the machinery does not
change without a human), the fingerprint of shared Git state around each unit, and the
human promotion to the branch that deploys. A repository that cannot accept this risk adds
required checks on GitHub.

## Consequences

Positive:

- A consumer project runs the loop to a merge after `update`, with no App, environment,
  secret, variable or branch protection to create.
- Without CI a project stays autonomous: the worker's local checks and the independent
  reviewer cover the pull request; `doctor` keeps recommending `enforce` without imposing it.
- `--match-head-commit` makes GitHub refuse the merge if the head moved after the verdict.

Negative:

- The verdict's integrity rests on the owner's machine rather than on a credential only
  `main` can read; the residual risk above is accepted, not removed.
- The chain of judgment moves into the kernel and the autopilot program, so
  `PROTECTED_PATHS_FLOOR` must follow it in the same commit
  (`packages/void-machine/src/**`, `packages/cli/src/commands/agents.ts`,
  `packages/cli/src/lib/autopilot/program.ts`, `judgments.ts`); otherwise the loop could
  merge a change to its own judge.
- The "Autonomous mode" section of `CLAUDE.md` and `AGENTS.md` describes the App-armed merge
  and must be rewritten in the same commit as the mode change.

## Alternatives considered

- **Ship the review App and workflow to consumers:** rejected. It is the setup no consumer
  performs today, and it charges safety to operation, which the principle forbids.
- **Keep two modes (`mergeGate: human` and automatic):** rejected. Two modes are two answers
  to how work reaches the integration branch; the hold covers the human case without a
  configuration key.
- **Read the verdict from a GitHub comment or check posted with a workflow token:**
  rejected. On a public repository anyone can comment, and any workflow can post a check
  under that name, as `adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903` already established.

## Reversal cost

Medium. Restoring an App-required merge for consumers means shipping the App setup this
decision removes; the loop transitions and the local verdict journal would stay, since a
GitHub required check composes with them.
