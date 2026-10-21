# Fast local feedback, real integration checks

The sibling files are shipped with this skill and copied by `init` into the selected
runtime's skill directory. Resolve them relative to the SKILL.md you actually loaded,
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
   The example uses npm. For pnpm/Bun use their pinned setup and frozen install.
   Define `ci:verify` in package.json to run the actual complete lint, typecheck, build,
   and test commands appropriate to the project. Do not equate `testUnit` with the
   whole integration suite; discover the project's existing CI contract. Missing
   `ci:verify` fails rather than silently passing. Never use `--if-present` or `true`.
4. Preserve remote protection and exact-head checks. Keep the required check names
   stable. Review protection adoption separately if no quality check is required;
   this template alone does not configure GitHub protection. Retain the separate
   `void-enforce` floor and independent review. This template does not replace either.
5. Test draft, ready without another commit, new head, return to draft, merge group,
   and manual run. `CI_DEFERRED_DRAFT` is expected non-admission during preparation,
   not a failed test: tests have not run. Readiness runs the full suite even at the
   same SHA. Never treat a skipped required job as successful test evidence.

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

Rollback: restore the prior workflow triggers and admission step together. Restoring
full draft CI costs runner time but does not weaken the floor. Leave protection and
review evidence unchanged. Existing missions and receipts are not migrated.

Sources read for GitHub Actions (hosted service):
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions
