# DEV-917: preserve a queued back-merge head

## Scope and cause

The canonical workflow pushed `chore/back-merge-main` before inspecting its open
pull request. A second release arriving while that PR was queued therefore tried
to rewrite GitHub's locked head and failed with `GH006`. The issue was reproduced
by executing the shipped Bash against a real temporary Git remote whose receive
hook rejects updates while queued. Only the GitHub API is substituted.

## Implementation

Read the canonical PR before checkout, merge or push. Reject duplicate PRs, failed
lookups and foreign repository/head/base identities before remote mutation. Read
GitHub's boolean `isInMergeQueue` field; missing or malformed state fails closed.
A queued PR produces an explicit deferral and no push, PR creation, merge request
or dequeue. Keep the ancestry guard, conflict refusal, force-with-lease and native
auto-merge protections intact.

This implements the ticket's next-trigger option. There is no polling, new branch
or background retry. **Without another push to `main` or manual dispatch, deferral
does not guarantee a catch-up run.** After the queued PR merges, checkout on the
next trigger fetches current refs and reconstruction starts from current develop.
If the PR enters the queue after inspection, the server still rejects the push;
the workflow fails without retrying or weakening protection.

The existing workflow owns the decision, so no standalone decision script is
needed. PR identity validation is shared by the pre-push and pre-auto-merge checks.
Capturing `gh pr list` in an assignment also preserves its failure status, which
the original process substitution discarded.

Sources: [GitHub PullRequest fields](https://docs.github.com/en/graphql/reference/pulls),
[gh api variables](https://cli.github.com/manual/gh_api), and
[gh pr view JSON fields](https://cli.github.com/manual/gh_pr_view).
Queue membership is not inferred from `mergeStateStatus` or `autoMergeRequest`.

## TDD evidence

- Base: `8fee97c9ba8ab7ad17c24a45204dd849f54acf24`.
- RED: `2f0230ca`, `pnpm exec vitest run test/workflows/back-merge-decision.test.ts`:
  12 failed, 6 passed. The queue case received `GH006: Protected branch update
  failed`; lookup and identity cases exposed writes before inspection.
- GREEN: the same command after the workflow correction: 18 passed.
- Scenarios include equal-tree ancestry, already-synchronized develop, queued
  deferral, lookup errors, duplicate/foreign PRs, malformed queue state, create and
  update of an unqueued PR, the queue-entry race, and a second trigger after merge.

## Verification and boundaries

Independent final review, PR publication and CI collection belong to ORCH. This
worker supplies commits only; the protected workflow merge remains human.
No live GitHub mutation was attempted to simulate the production failure. The
receive-hook fixture proves the workflow's ordering and fail-closed behavior;
GitHub queue execution will be observed through the published PR and CI.
