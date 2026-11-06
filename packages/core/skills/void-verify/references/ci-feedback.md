# Fast local feedback, real integration checks

The sibling files are shipped with this skill and copied by `init` into the selected
runtime's skill directory. `update` refreshes owned references; adopted workflows
remain project-owned and are never overwritten by that reference refresh. Resolve them relative to the SKILL.md you actually loaded,
not from a developer checkout or a global installation.

On an explicit CI configuration request:

1. Inspect existing workflows, required check names, package manager, branch names,
   review publication and release dependencies. Preserve their owners. Do not overwrite
   existing workflows with this example or install a second quality workflow.
2. Adopt the behavior in `quality.yml` into the existing quality workflow. Copy
   `ci-admission.mjs` to `.github/scripts/ci-admission.mjs`. Keep the admission step
   inside an existing **required** quality job, before dependency installation, without
   `continue-on-error`, `always()` on later quality steps, or a job-level draft skip.
3. Set up the project's actual package manager and immutable lockfile installation.
   The example uses npm and an illustrative Node version; preserve the project's
   supported Node version owner (for example `.node-version`). For pnpm/Bun use
   their pinned setup and frozen install. Do not introduce another package manager.
   Define `ci:verify` in package.json to run the actual complete lint, typecheck, build,
   and test commands appropriate to the project. Do not equate `testUnit` with the
   whole integration suite; discover the project's existing CI contract. Missing
   `ci:verify` fails rather than silently passing. Never use `--if-present` or `true`.
4. Preserve remote protection and exact-head checks. Keep the required check names
   stable. Review protection adoption separately if no quality check is required;
   this template alone does not configure GitHub protection. Retain the separate
   `void-enforce` floor and independent review. This template does not replace either.
5. Test draft, ready without another commit, new head, return to draft, merge group,
   and manual run. A deliberately added schedule is supported by the guard and
   runs real checks; it does not prove a separate PR candidate. `CI_DEFERRED_DRAFT` is expected non-admission during preparation,
   not a failed test: tests have not run. Readiness runs the full suite even at the
   same SHA. Continue focused local work during draft non-admission, without
   retrying the remote refusal. Never treat a skipped required job as test evidence.

Development runs configured local tests for the changed behavior and affected types.
There is no network hook or mandatory remote wait per edit. Only obsolete PR runs are
cancelled. Distinct merge groups, manual runs and release runs must have distinct
concurrency keys: `cancel-in-progress: false` alone still replaces pending runs in a
shared group. Keep integration checks before entry to the protected branch; checking
only after merge permits broken integration.

GitHub couples required PR and merge queue checks. Preserve both. Remove a redundant
post-merge run only after checking that no release, promotion or artifact consumer
needs it, and that the protected integration path proves the merged result. The
example has no push trigger; add one where it provides distinct release evidence.

For reusable enforcement, the caller must also declare `ready_for_review`,
`converted_to_draft` and `merge_group: checks_requested`, keeping its existing
check names. Put concurrency only in that caller; the called workflow inherits
`github.workflow` and must not cancel the same group. Its admission guard runs
from the immutable harness checkout before Node setup and floor execution.
GitHub-hosted runner usage belongs to the caller, even when the reusable workflow
is public and the caller private. Compare latency and job-minutes before making
any billing claim.

Dependency audit is a separate project-owned job, without a `needs` edge that
prevents lint/tests/build from running during an advisory-service outage. Preserve
its actual package-manager/lockfile contract and severity policy: installing Bun
is not an audit solution for npm or pnpm consumers. `npm ci` advisory output alone
is not a complete audit gate. Bun consumers can adopt the packaged
`core-assets/templates/github/void-dependency-audit.yml` and `dependency-audit.mjs`,
plus this sibling `ci-admission.mjs`; the audit guide is `docs/DEPENDENCY-AUDIT.md`
in a matching source checkout. Its ready-PR and merge-group runs judge their own
revision; a weekly scheduled run catches new advisories without a lockfile change
and is surveillance, not a substitute for a required candidate check. Unavailable
or malformed evidence stays non-green. No workflow path filter may hide required
checks or prevent scheduled registry refresh.

Rollback: restore the prior workflow triggers and admission step together. Restoring
full draft CI costs runner time but does not weaken the floor. Leave protection and
review evidence unchanged. Existing missions and receipts are not migrated.

Sources read for GitHub Actions (hosted service):
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions

- https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
