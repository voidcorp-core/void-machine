---
name: void-verify
description: Verify acceptance with applicable tests, types, hooks and independent review; reuse unaffected proofs and report concrete limits. Use before claiming completion.
---

# verify — voidcorp craftsman edition

Completion rests on observed acceptance and applicable proofs. This skill checks evidence and communicates limits; `void-implement` owns which passes the change needs.

**Attribution**: see `.source`. Primary source: superpowers/verify + citypaul completion checklists.

---

## When to run

Before claiming a deliverable complete. Scale verification to the affected behavior and project requirements; a small change still needs the proof of its result.

---

## Local development and integration

During development, run the smallest meaningful configured test command against the
changed behavior, plus affected types and local hooks. Keep the PR in draft; do not
wait for full remote CI after each edit or commit. Fresh local evidence still gates
claims about the behavior tested. `commands.testUnit` and `commands.typecheck` in
`.void/config.json` describe project commands; preserve their argv.

When the candidate is committed and independently reviewed, run the applicable final
checks below and mark the PR ready. Wait for real required CI on that head and, if
configured, the merge group before integration. Local success cannot replace a required
server check. Returning to draft cancels obsolete PR work without resetting reviews.

For an explicitly requested CI setup or optimization, use the installed
[executable admission guard and workflow template](references/ci-feedback.md).
They defer draft validation with an explicit non-success outcome, rerun on readiness,
and preserve merge queue checks. Never install them or change remote protection merely
because this skill was invoked.

## Applicable evidence

Inspect the accepted scope and actual diff. Reuse current unaffected proofs when their declared
inputs are unchanged; rerun affected checks and required candidate/merge-group checks. A changed
comment does not invalidate an unrelated behavior proof, but uncertainty about dependencies
must stay explicit. Never reuse a stale subject or downgrade a project's required CI.

| Concern | Evidence when applicable |
| --- | --- |
| Behavior | Actual RED before production behavior, then relevant tests GREEN; `void-tdd` + `void-testing` |
| Types and static checks | Configured typecheck/lint for affected packages; no invented commands |
| Coverage | Changed invariants, boundaries and errors; configured thresholds remain binding |
| Hooks | Actual required hook result for the edit or staged set, not merely installed configuration |
| UI | Affected controls/states verified on mobile and desktop, including keyboard and touch |
| Security | Affected trust boundaries inspected during implementation and final review |
| Observability | New failure/side-effect paths have useful diagnostics without secrets |
| Documentation | Changed public behavior or convention documented; no template-only requirement |
| Review | Exact candidate/base, independent reviewer, original findings and evidenced resolutions |
| Delivery | Accepted criteria met; required CI/merge/deployment states observed separately |

Installed, applicable, invoked and passed are different claims. An unknown result is never
reported as passed. A skill read does not prove its instructions were applied; a hook's presence
does not prove it ran; a test file does not prove a RED/GREEN cycle. Show available evidence and
name unobservable parts without manufacturing a new blocking gate for telemetry alone.

## Scope and completion

For each acceptance criterion determine whether it is done, partial, changed or unverified.
Code that handles a deliverable is not proof of that deliverable: a webhook handler is not proof
that the provider delivered its event. Resolve the actual missing proof or permission. Ask only
for a decision beyond the mandate, not approval of a routine verification step.

Stop when the accepted outcome, applicable proofs and independent review hold. Fix concrete
blocking defects; optional improvements never request another general review or correction.
Remove unrelated scope unless the requested behavior requires it.

## Reporting

Give the result, relevant commands/results, independent review outcome and material limits.
Do not print a twelve-item checklist with irrelevant N/A rows. Keep applicability reasoning in
the existing task/review evidence; summarize it when it explains a real omission or decision.
For a plan, update its existing resume point; the tracker owns mutable programme progress.
The PR evidence and final report reuse the same observed results rather than duplicate work.

Once at ticket end, if a mission ID exists, include the informational recap from
`void-machine mission inspect --id <mission> --usage` (`--json` for structured output).
Reuse that recap in the final report; do not run it per edit or chain its exit status as a new
completion gate. Its exit status remains the mission verdict, not telemetry coverage. Missing
mission linkage or telemetry is explicitly unknown. Codex skill reads are not invocation hits.
For the complete catalogue and triggers, use `void-machine cheatsheet --format markdown`.

## Bounded review evidence

Use the review receipt from `void-implement`: exact commit and base, acceptance criteria,
independent reviewer, conclusions, proofs and blocking-defect resolutions. A mutable worktree
alone is insufficient. Reuse unaffected evidence after correction and verify the affected
behavior only; do not trigger another general panel. Native runtime identity absence or refusal
is an explicit provenance limitation, not an extra certification gate. Actual independence and
valid evidence remain required. An unresolved blocking defect prevents completion.
