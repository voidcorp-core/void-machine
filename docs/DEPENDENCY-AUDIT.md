# Independent dependency audit for Bun consumers

The optional `packages/core/templates/github/void-dependency-audit.yml` workflow
runs independently of lint, types, tests and build. It has no `needs` edge and does
not run inside a quality job. A registry outage therefore cannot prevent those
checks from running. Both vulnerabilities and unavailable evidence still fail the
audit job; branch protection remains the consuming project's explicit policy.

The companion `dependency-audit.mjs` executes `bun audit --json` once, without a
shell, with a 120-second process timeout and a 1 MiB output bound. The whole job
has a ten-minute limit. It writes `result.json` and `summary.md`, appends the result
to the Actions summary, and uploads the report even when the audit fails.

| State | Exit | Meaning |
| --- | --- | --- |
| `clean` | 0 | Successful, recognized empty registry response |
| `vulnerabilities` | 1 | Recognized advisory records returned |
| `unavailable` | 2 | Process failure, timeout, malformed/ambiguous response or registry error |

An empty stdout, even with exit zero, is unavailable. No retry or
`continue-on-error` turns unavailable evidence into a pass. If setup fails before
the wrapper starts, the job fails and missing reports are explicit; there is no
fabricated clean result. Raw stderr is not copied into artifacts.

## Candidate checks and advisory surveillance

The template keeps the `dependency-audit` job name. Draft PRs stop at the shared
admission guard before tooling setup: `CI_DEFERRED_DRAFT` is expected preparation,
not a failed audit or a clean result. Marking a PR ready triggers the audit for
the same head; merge groups audit their integration SHA. Do not skip a required
job or add lockfile-only path filters, which can hide a required result. Only
obsolete PR runs are canceled; queue, main push, schedule and manual runs have
separate groups. Independent quality checks can finish even when audit fails.

The weekly schedule (Monday 04:17 UTC) queries current advisories even when the
lockfile has not changed. It runs the default branch and is surveillance, not
proof of a PR or merge-group candidate. Keep the required ready-PR/queue audit if
that is your protection policy. GitHub schedules may be delayed or dropped and
inactive public repositories can have them disabled; monitor the latest result
and use manual dispatch when necessary. The template retains its main push check;
remove or change it only after reviewing the consuming project's evidence needs.

The shared guard explicitly admits `schedule`. Copy the matching updated guard;
an older guard refuses that event. Reports are uploaded after successful admission,
including audit errors or timeouts. Draft non-admission creates no audit report.
All recognized advisory severities still fail: this change adds no severity
exception, retry or allowlist. A missing tool, registry authentication failure or
an unrecognized response remains unavailable. Never add secrets or
`pull_request_target` to make fork audits appear clean.

## Scope and official contract

This template pins Bun 1.3.14, matching the affected Cortex consumer. It audits the
npm packages Bun submits to its default registry, not the whole supply chain.
In that version, non-npm dependencies and packages assigned to a different scoped
registry are omitted; JSON mode does not list those omissions. A `clean` response
must not be represented as coverage of those dependencies. Projects using these
sources need their own corresponding audit coverage.

The [Bun audit documentation](https://bun.com/docs/pm/cli/audit) explains lockfile
operation and JSON output. The version-specific authority is
[Bun 1.3.14 audit_command.zig](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/cli/audit_command.zig):
exit 1 is shared by findings and registry failures, while an empty response can
exit zero. The wrapper consequently validates the response instead of treating a
process status as a security verdict. The
[official setup-bun action](https://github.com/oven-sh/setup-bun) supports the
explicit `bun-version` input. Action references are pinned to immutable commits.
Changing Bun's version requires checking its response and package-selection
contract again.

## Adoption and distribution

The existing core-assets copier ships the workflow and audit wrapper under
`core-assets/templates/github/`. They are manual templates, not installer-owned
consumer workflows: `init` and `update` do not silently apply them or overwrite
custom CI. A harness release makes the files available; each existing consumer
adopts them through its own reviewed change. New Bun consumers can use the same
files with the admission guard. This does not change the independent security-baseline template or the
harness release job's npm signature audit.

From a chosen, verified harness checkout or extracted package, copy:

- `templates/github/void-dependency-audit.yml` to `.github/workflows/void-dependency-audit.yml`;
- `templates/github/dependency-audit.mjs` to `.github/scripts/dependency-audit.mjs`;
- `skills/void-verify/references/ci-admission.mjs` to `.github/scripts/ci-admission.mjs`.

In a source checkout, the template base is `packages/core`; in the npm package it
is `core-assets`. The same admission reference is installed beside the selected
Claude/Codex `void-verify` skill. Keep the adopted files versioned together; reuse
an existing matching guard rather than introducing another one. Merge behavior
into an existing audit workflow when present, preserving its check name. Adjust
branch filters only for the project's actual integration/release contract.

This is a Bun-specific example, not a reason to install Bun in an npm or pnpm
project. Keep those projects' existing audit tooling, immutable lockfiles, Node
version ownership and failure policy. Likewise, adapt the illustrative Node 24
setup in this template to the consuming project's supported Node owner. `init`
and `update` distribute owned references but leave adopted workflows and local
customizations untouched. Updating the harness alone does not change active CI.

Private/scoped registries and forks without credentials may lack audit evidence;
report that limitation and keep the relevant result non-green rather than adding
privileges. The GitHub runner time belongs to the consuming repository. No local
measurement here establishes consumer latency, job-minute or invoice savings.

### Cortex migration patch (not applied)

Cortex currently pins Bun 1.3.14 and executes `bun run audit` before lint in its
`quality` job. Its `e2e` job depends on `quality`. Adopt the workflow, wrapper and admission guard above, then
apply this bounded edit to `.github/workflows/ci.yml`:

```diff
       - run: bun install --frozen-lockfile
-      - run: bun run audit
       - run: bun run lint
```

Keep the remaining quality steps and the existing e2e dependency unchanged.
The local package script `audit: bun audit` can remain for interactive use; CI
uses the wrapper for the three-state report. The audit is still non-green on an
outage, but quality and its dependent e2e can finish independently. Inspect the
new audit check and branch-protection requirements before merging the consumer
change. No Cortex file or active installation is modified by this harness change.

GitHub references: [events and schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
and [reusable workflow billing](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#how-reusable-workflows-use-runners).
