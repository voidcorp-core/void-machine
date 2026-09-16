# Interface motion: source audit and application

DEV-531 implements the approved contextual rule and dedicated skill. Source
inspection: 2026-09-16. This is authored guidance, not a copy of upstream prose.

## Adaptations and rejections

| Primary source | Retained principle and adaptation | Rejected |
| --- | --- | --- |
| [Hyperframes animation](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-animation/SKILL.md) | Compose a small number of meaningful phases; separate general craft from runtime recipes. | Video rendering first: no composition attributes, seek-driven global registries, frame workers, render pipeline, asset installation or runtime selection. |
| [Hyperframes timelines](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-animation/adapters/gsap-timeline-and-labels.md) | Explicit relationships between phases become interruptible interface choreography. | A compulsory paused timeline and deterministic video playhead cannot govern a live interface. |
| [Hyperframes easing](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-animation/adapters/gsap-easing-and-stagger.md) | Controlled settling, meaningful grouped staggering and rare purposeful overshoot. | Fixed cinematic timing, baked spring implementation, house curve names and the assertion that interactive spring solvers are unsuitable. |
| [web.dev animation guide](https://web.dev/articles/animations-guide) | Favor transform/opacity, inspect layout and paint in a trace, keep layer promotion selective. | Treating a property name as proof that a browser uses the compositor. The ticket's no non-compositable hot-path rule is deliberately stricter than the article's general advice. |
| [Original FLIP explanation](https://aerotwist.com/blog/flip-your-animations/) | Measure before/after geometry once, invert visually, then animate the transform. | No copied implementation or framework adapter. Preserve identity and focus in the interface application. |
| [MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) | Respect the preference by replacing spatial motion. | Disappearing narrative information. Labeled static beats are the local adaptation for an expressive sequence. |
| [WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) and [2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) | Add the preparation panel's automatic-movement control requirement and independent flash limits in both contexts. | Reduced motion as a substitute for these requirements; assuming an indirect scroll trigger is deliberate playback. |

No library recipe is needed for this deliverable, so no GSAP API, licensing or
price claim is shipped. No dependency is added. Hyperframes source links explain
provenance only; consumers are not instructed to install or execute it.

## Boundary and semantic review

Frontend-design retains a short functional default and delegates. Its description,
visual default list, IA step, Motion section, craft bullet, troubleshooting row
and final rule all follow the same context rule. The existing visible-default
reveal invariant survives. UI-review has no absolute duration claim to change.

The 107-line motion skill owns classification, invariants, choreography and its
verification. Frontend-design retains a short summary and references rather than
copying the five-step procedure. Shared invariant summaries occupy well below
30% of either skill; the independent panel must assess semantic overlap, not
infer it from line count alone. String contracts guard omissions and known
contradictions; they cannot prove a sensible classification or accessible UI.

## Real graph-studio application

Read-only application against existing source at `a1234adbd337bc05688443f9cb75446757cbac6d`
(the test commit; graph-studio matches the base). Captured through cockpit RUN
in `/private/tmp/dev531-dogfood.log`; replay by reading the named source files.
This applies the draft skill to a real consumer, not a synthetic demo. These are
source observations and recommendations, not executed browser behavior.

| Existing interaction and inspected source | Classification and evidence | Reduced-motion / animation-unavailable outcome |
| --- | --- | --- |
| Search and layer/family checkboxes, `apps/graph-studio/src/ui/controls.ts` | Functional. `rerender(setSearch(state, search.value))` and the toggle handlers update state directly, without a narrative sequence. | The handlers do not require animation completion. This source establishes that the state update is immediate; it does not prove rendered focus behavior. |
| Node focus, `apps/graph-studio/src/render/camera.ts` | Functional spatial orientation. `duration: 0.8` exceeds the short-feedback default; the source offers no explicit reason for the exception. | No reduced-motion branch appears here. Recommend immediate camera placement preserving the selected target; unavailable tweening currently lacks a local fallback. This is a gap, not a passing example. |
| Play flow, `apps/graph-studio/src/render/flow.ts` and `src/scene/flow.ts` | Expressive explanation: BFS routing wavefronts make the order of downstream relationships visible. The timeline schedules each wave at `i * 0.45`; this has an observable narrative outcome, not just a page-type exemption. | No local reduced-motion or cancel branch. A static ordered wavefront list from `flowChain` would preserve that explanation; existing static edges alone do not establish equivalent temporal information. Recommend bounded total duration and replacement on replay. |
| Cost overlay, `apps/graph-studio/src/render/overlays.ts` | No motion. `activePulseTween?.kill()` precedes replacement with the static cost builder. Color carries the current state. | This path refreshes the graph without waiting for a tween. Static presentation retains the cost meaning; contrast and non-color cues require rendered review elsewhere. |
| Boot overlay, `apps/graph-studio/src/render/intro.ts` | No motion recommended under this contract: the source names a camera sweep and “SYSTEM ONLINE”, without a multi-beat explanatory outcome. | Reduced motion removes the overlay immediately. Normal playback removes it only in `onComplete`; an unavailable or interrupted tween could leave visual obstruction despite `pointerEvents: 'none'`. |
| Panel scanline and scene rotation, `apps/graph-studio/src/ui/styles.css` and `src/render/graph.ts` | No motion recommended: these are repeating decoration, not state feedback or an explanatory sequence. Source shows `animation: scanline 4.5s linear infinite` and recurring `requestAnimationFrame(spin)`. Repeated total duration exceeds five seconds, even though a cycle does not. | The preference disables CSS effects and prevents initial rotation. The inspected paths expose no persistent pause control for everyone; preference handling alone does not discharge 2.2.2. Removing these effects preserves the graph information. |

Graph-studio is not changed by this ticket. The existing gaps lose to the bounded
motion-guidance deliverable and are not silently repaired or filed as new work.
WebGL camera and color updates are not CSS compositor evidence; no performance
claim is inferred from this inspection. Flash thresholds, dynamic preference
changes and rendering were not measured. Mobile/desktop rendering changes are
not applicable because this diff contains no UI implementation. Source review
cannot certify the existing application's WCAG conformance or frame rate.

## Evidence

- RED: seven contract failures before skill authoring, cockpit RUN exit 1,
  `/private/tmp/dev531-red.log`; test commit `a1234adb`.
- GREEN: seven contract passes after the motion skill and frontend changes,
  cockpit RUN exit 0, `/private/tmp/dev531-green.log`.
- Two new ADR identities came from `void-harness decisions new`; the records
  describe decisions already approved in DEV-531, retaining proposed status for
  the repository's normal acceptance through review.
- Final generated-asset and full-verification results accompany the worker
  handoff with their exact command logs and observed commit identity. Independent post-implementation review is owned
  by the coordinator and is not replaced by this author's assessment.

## Full-verification correction

The first full verification on `c853eefb` failed on two deterministic integration
omissions: `test/cheatsheet/cheatsheet.test.ts:52` reported the new skill without a
taxonomy group, and `test/readme/readme-counts.test.ts:53` reported 41 skills where
the generated model has 42. The generator cannot infer editorial classification
or rewrite the README count. The existing tests already own these obligations;
no duplicate test or weakened assertion is added. Register the skill in the
existing interface group, update the count, and regenerate the cheat sheet.

The package-size gate also measured 923.4 kB against 920.0 kB. The coordinator's
sealed base measured 919.8 kB, leaving only 0.2 kB before this feature. Inspection
of the actual tarball found 341 unique file paths, no tests/logs/observed state,
and precisely the required motion skill, source/metadata, frontend replacement
and generated catalog/model/certification changes in core-assets. Their net
uncompressed growth is 11,449 bytes; the candidate tarball is 923,420 bytes.
Do not infer an exact compressed delta from the rounded base measurement.

With coordinator authorization, the ceiling becomes 930,000 bytes: a bounded
10 kB increase for this feature, approximately 6.6 kB above the measured package.
Required safety prose is retained. The existing boundary tests and real packing
gate stay intact. Evidence: `/private/tmp/dev531-verify.log`,
`/private/tmp/dev531-pack.log`, `/private/tmp/dev531-pack-delta.log`.

Observed ownership widening, approved before writing: `README.md`,
`docs/cheatsheet-taxonomy.json`, and only the CLI ceiling/comment in
`scripts/check-package-size.mjs`. Frozen ticket and footprint files are unchanged.
