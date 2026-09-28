# gh fixtures

Real outputs, captured read-only on 2026-09-22 with gh 2.100.0. Tests derive
variants from them by overriding fields; no shape here was written by hand.

| File | Source |
| --- | --- |
| `pr-view-open.json` | `gh pr view 381 --json number,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,autoMergeRequest,statusCheckRollup` (this repository) |
| `pr-view-merged.json` | same fields, PR 395 (this repository) |
| `pr-view-auto-merge.json` | same fields, PR 379 (this repository): an armed `autoMergeRequest`, a failed and a skipped check run |
| `pr-view-comments.json` | `gh pr view 378 --json comments` (this repository); tests add it to the views above, as gh prints both when both are requested |
| `pr-view-files.json` | `gh pr view 392 --json files,changedFiles` (this repository): a real change list, `.void/program.md` among it |
| `pulls-files-rest.json` | `gh api 'repos/{owner}/{repo}/pulls/395/files?per_page=100&page=1' --jq '[.[] \| del(.patch)]'` (this repository): the REST file list, two renames with their `previous_filename`; `patch` dropped for size |
| `check-run-queued.json` | one `statusCheckRollup` entry of zed-industries/zed PR 64608: a check run not yet completed |
| `status-contexts.json` | two `statusCheckRollup` entries of kubernetes/kubernetes PR 142315: commit statuses, the shape `void/independent-review` takes |
| `pr-view-queued.json` | `gh pr view 192072 -R flutter/flutter --json autoMergeRequest,state`: a pull request sitting in a merge queue, with no auto-merge request |
| `pr-queue-membership-queued.json` | `gh api graphql` `pullRequest(number) { id isInMergeQueue }` of that same flutter/flutter pull request |
| `pr-queue-membership-absent.json` | the same query on PR 381 (this repository), outside the queue |
| `queue-absent.json` | `gh api graphql` `repository.mergeQueue(branch: "develop")` on this repository |
| `queue-present.json` | the same query on zed-industries/zed `main` |
| `protection-required-checks-strict.json` | `gh api repos/{owner}/{repo}/branches/develop/protection/required_status_checks` (this repository): classic protection with `strict: true` |
| `rules-branch-required-checks.json` | `gh api repos/zed-industries/zed/rules/branches/main`: rulesets, one `required_status_checks` rule with `strict_required_status_checks_policy: false` |
| `timeline-*.json` | `gh api graphql` `pullRequest.timelineItems` (merge queue events and commits) of zed PRs 64552 and 64434 |

No pull request of this repository carries a commit status, hence the public
sources. The queued captures (2026-09-24) come from flutter/flutter because no
pull request of this repository sat in its merge queue at capture time.
