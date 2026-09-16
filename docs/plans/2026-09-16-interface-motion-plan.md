---
title: Contextual interface motion
date: 2026-09-16
status: implemented-awaiting-verification
spec: docs/specs/2026-09-15-approved-six-ticket-cluster.md
---

# DEV-531: contextual interface motion

Implement the already approved contextual motion rule and dedicated core skill.
The frozen provider ticket remains unchanged. This bounded plan supplements the
[cluster plan](2026-09-15-approved-six-ticket-cluster-plan.md).

## Preparation correction

The nine preparation reviews are consumed. Eight passed; the accessibility
finding `expressive-motion-safety-coverage` adds these requirements to the skill,
contract coverage and independent semantic review:

- Automatically starting movement, blinking or scrolling lasting more than five
  seconds alongside other content must offer pause, stop or hide, unless it is
  essential to the activity. Indirect triggers such as scrolling into view do
  not automatically exempt a sequence. This implements WCAG 2.2 SC 2.2.2.
- Prohibit flashes violating WCAG 2.2 SC 2.3.1: content may not flash more than
  three times within any one-second period unless it remains below both the
  general-flash and red-flash thresholds. Prefer no flashing; a stop control
  cannot make an unsafe flash acceptable.
- Reduced-motion support is additional to these safeguards, never a substitute.
  Apply them in both functional and expressive contexts.

Sources read on 2026-09-16: W3C's [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
and [Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).
Both are Level A criteria included in the WCAG 2.2 AA floor. The five-second
condition applies to movement, not the separate auto-updating requirement.

## Implementation sequence

1. Read original hyperframes material and primary motion/accessibility sources
   before distilling principles. Record what was adapted and rejected in the
   audit and `.source`; reject video rendering and pipeline conventions first.
   Keep library-specific recipes optional and outside the core skill body.
2. Write the strict contract test first. Obtain an observed failing run through
   cockpit RUN before authoring the skill or changing frontend guidance.
3. Author the compact library-agnostic skill: classify each interaction by its
   observable outcome. Functional feedback defaults to less than 250 ms;
   expressive sequencing requires an explicit narrative outcome. A form within
   a landing retains the functional contract. Choose no motion when neither
   outcome needs it. Cover orchestration, physical easing, FLIP continuity,
   temporal hierarchy and measured compositing budgets without a library mandate.
4. Preserve the three invariants in both contexts: a reduced-motion alternative
   retains information and narrative order; content and actions remain available
   without animation; hot animation paths use compositable properties. Include
   the preparation safeguards above. Do not hide content pending scroll or script.
5. Update all motion assertions in frontend-design, including discovery text,
   prohibitions and closing summary. Keep the default and explicit delegation;
   detailed procedure belongs to the dedicated skill, with overlap below 30%.
6. Create two collision-free ADRs using `void-harness decisions new`: contextual
   rule instead of an absolute cap, and dedicated skill instead of extending
   frontend-design. Existing accepted decisions remain immutable.
7. Regenerate declared outputs through `pnpm derive`, then run relevant contracts,
   anti-bloat and final `pnpm verify`, all via coordinator-serialized cockpit RUN.
   Capture command, worktree/tree identity, exit status and relevant output.

## Behavioral proof and review

The contract test covers non-contradiction across every frontend motion assertion,
interaction-level classification including a mixed landing/form, the three
invariants, the pause and flash safeguards, library separation and delegation.
Avoid incidental wording assertions or a second general skill-validator suite.
Record red then green evidence; no retry, quarantine or raised timeout turns a
failure into proof. The ticket's stricter 200-character description and 400-line
skill limits apply.

Dogfood the drafted guidance against real graph-studio interactions. Record
inspected source paths and actual classifications (functional, expressive or no
motion), including reduced-motion and non-animation outcomes. Separate observed
source behavior from recommendations; do not invent execution or create demo UI.
No UI implementation is requested, so viewport rendering changes are not
applicable. This does not replace independent frontend, accessibility and doctrine
semantic review of correctness and overlap. Supply the QA reviewer with the
red/green runs, final verification result and the graph-studio evidence.

## Ownership and delivery

Author only `packages/core/skills/void-interface-motion/`, the frontend-design
skill, `test/skills/interface-motion.test.ts`, the motion skill audit, this plan
and the two new motion ADRs. Generated ownership is `packages/core/data`,
`packages/core/graph/void-graph.mjs`, `packages/cli/core-assets`,
`docs/CHEATSHEET.md` and `docs/SKILL-REFERENCES.md`. Report required widening before
writing. Do not install unreleased guidance into root enforcement.

The coordinator owns mission receipts, specialist dispatch, tracker mutations,
integration and publication. No shared Git ref/config/stash/tag/remote mutation,
push or merge. Preparation creates this plan only; implementation and all test,
build, lint and commit actions await the controller's next writer action.

## Implementation handoff

- DONE: source distillation, library-agnostic skill, all frontend motion assertions,
  three invariants plus independent WCAG safeguards, source audit and two new
  CLI-created ADRs. No optional library recipe was necessary.
- DONE: strict contract RED (seven failures) then GREEN (seven passes), through
  cockpit RUN; `/private/tmp/dev531-red.log` and `/private/tmp/dev531-green.log`.
- DONE: build and declared derivation through cockpit RUN;
  `/private/tmp/dev531-build.log` and `/private/tmp/dev531-derive.log`.
- DONE: source-based application to graph-studio, including functional, expressive
  and no-motion classifications, existing gaps and honest rendering limitations;
  see the skill audit and `/private/tmp/dev531-dogfood.log`.
- PENDING: full `pnpm verify` on the implementation commit, followed by the
  coordinator's independent semantic panel. Logs and SHA accompany the worker
  report; this plan does not certify checks not yet run.

No mutation runner is configured and no runtime business logic or UI is changed.
Coverage is the seven authored contract cases plus existing asset validators;
mobile/desktop screenshots and new observability instrumentation do not apply.
Security quick scan found no new trust boundary, dependency or outbound action.
The anti-patch review checks the guidance's actual semantics: string contracts
are omission guards, never a substitute for independent motion judgment.

### Integration correction from observed verification

The first full run failed on missing taxonomy registration, the README skill
count and a measured package-size breach. Existing assertions reproduce these
failures; their expectations remain unchanged. The coordinator approved bounded
widening to `docs/cheatsheet-taxonomy.json`, `README.md` and the voidharness ceiling
in `scripts/check-package-size.mjs`. Add the interface group entry, change the
count from 41 to 42, regenerate, and raise only that ceiling from 920,000 to
930,000 bytes after inspecting the actual packed-file delta. The audit records
measurements and rationale. Targeted affected gates and full verification must
pass on the correction; the failed run is retained, never retried unchanged.

Targeted correction verification passed: 42 tests across motion, cheat sheet,
README counts and size boundaries; all four real packages are within ceilings.
Logs: `/private/tmp/dev531-correction-green.log` and
`/private/tmp/dev531-correction-size.log`. The subsequent full run is recorded in
`/private/tmp/dev531-final-verify.log` and the worker handoff, against its commit.
