# DEV-1405: one-tick GitHub observations

The tick now reads repository `mergeQueue` and, only when the deploying branch
is implicit, `defaultBranchRef` in one GraphQL response. Each PR's bounded
`timelineItems` query includes `id` and `isInMergeQueue` only when its base has a
queue. Current membership still overrides stale queue history; commit and force
push events still close the previous ejection episode.

There is no retained observation or cache. `readCurrentChecks`, check/workflow
pagination, REST file pagination and rename sources remain unchanged. Without a
queue, the explicit base/head comparison remains. The standalone default-branch
and membership readers used by mutation commands remain fresh, as do their
checks and post-mutation observations. No merge policy changes.

## Observed invocation counts

The existing captured-response runner records every invocation. Before production
edits, the 12-case matrix passed with the previous call counts. Changing its
expected counts and adding grouped-response refusal cases produced 14 failures;
the implementation then passed all 19 selected regressions. Each matrix case
also compares the complete PR observation against the original captured fields.
One page each of checks, workflow runs and changed files is assumed; the base is
explicit and all PRs are open and up to date.

| PRs | Queue | Deploy branch | Before | After | Avoided |
| --- | --- | --- | ---: | ---: | ---: |
| 0 | absent | explicit | 1 | 1 | 0 |
| 0 | absent | implicit | 2 | 1 | 1 |
| 0 | present | explicit | 1 | 1 | 0 |
| 0 | present | implicit | 2 | 1 | 1 |
| 1 | absent | explicit | 7 | 7 | 0 |
| 1 | absent | implicit | 8 | 7 | 1 |
| 1 | present | explicit | 7 | 6 | 1 |
| 1 | present | implicit | 8 | 6 | 2 |
| 4 | absent | explicit | 25 | 25 | 0 |
| 4 | absent | implicit | 26 | 25 | 1 |
| 4 | present | explicit | 25 | 21 | 4 |
| 4 | present | implicit | 26 | 21 | 5 |

These are **gh invocations**, observed through fixture transport, not measured
HTTP requests, production latency, server cost, tokens or money. `base: auto`
still performs its two separate branch probes; those are outside this matrix.
Combined fixture answers compose existing captured repository/PR fields; no
production GitHub mutation or live performance benchmark was run.

## Preserved refusal and freshness evidence

The affected suites cover missing default branch, membership, node ID and
timeline fields; repository and PR GraphQL partial errors; current membership
opposed to old timeline entries; same-head checks changing on a subsequent tick;
file pagination bounds and rename origins; paginated checks/workflows, identity
and ambiguous associations; and mutation commands refusing invalid inputs and
rereading their exact heads. No synthetic transport framework was added.

Executed: the three affected suites (`loop-observe`, `loop-checks`,
`autopilot-loop`), 203 passing tests; CLI typecheck; scoped Biome lint, zero
errors with one pre-existing optional-chain warning outside the edited lines.
No tracked delivery is derived from these CLI TypeScript sources. Internal
ignored dependency outputs were compiled to run the tests; no catalogue,
manifest, lockfile or installed runtime was changed. Independent review and CI
belong to the coordinator's exact-commit delivery pass.

## Source contract checked

Installed `gh`: **2.105.0**, observed with `gh --version` on 24 November 2026.
No upgrade. Read before query changes:

- [GitHub CLI api manual](https://cli.github.com/manual/gh_api): argv fields,
  repository placeholders and GraphQL variables.
- [GraphQL Repository](https://docs.github.com/en/graphql/reference/repos#repository):
  nullable `mergeQueue(branch:)` and `defaultBranchRef`.
- [GraphQL PullRequest](https://docs.github.com/en/graphql/reference/pulls#pullrequest):
  `id`, `isInMergeQueue` and bounded filtered `timelineItems`.
- [REST pull request files](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files):
  pagination, maximum page size 100 and 3,000-file response bound.
