---
name: void-interface-motion
description: Design functional feedback and expressive interface sequences. Use for app or site animation, choreography, scroll reveals, easing, or reduced-motion alternatives.
---

# Interface motion

Make the outcome legible before choosing an effect. This standard owns motion
craft; `void-frontend-design` owns layout and brand application,
`void-accessibility` owns the wider accessibility floor, and `void-ui-review`
owns independent review. The project's `DESIGN.md` owns its motion language.
No library is required. Attribution and adaptations: `.source`.

## Classify each interaction

Write its trigger, intended outcome and usable final state before animating.
Classify per interaction, never by page type:

| Context | Observable criterion | Contract |
| --- | --- | --- |
| Functional | The user needs feedback for an action or state change, such as submit, expand, select or dismiss. | Default duration <250ms. Complete the action immediately; feedback must not delay it. |
| Expressive | A specified narrative outcome depends on relationships between ordered beats: for example, showing how three parts assemble into one product. Name what the viewer should understand and which beat conveys it. | Choose duration from that sequence and reading time, not an arbitrary global cap. The sequence must remain optional and interruptible. |
| No motion | No state relationship or narrative outcome becomes clearer. | Keep the content still; decoration alone does not justify a sequence. |

A landing may have an expressive product story while its signup form remains
functional. A slow validation response never becomes expressive because it sits
inside a hero. A label such as "premium" is not an observable narrative outcome.
Record the classification and outcome in the existing design brief, not a new
approval workflow. Short functional feedback remains the default when unclear.

## Invariants in both contexts

These are non-negotiable for functional and expressive motion alike:

1. **Preserve information with reduced motion.** Honor `prefers-reduced-motion`
   before playback and when the preference changes. Replace spatial travel,
   parallax and zoom with an instant state change or a static ordered narrative;
   a gentle crossfade is optional if comfortable. Preserve the same information,
   controls and reading order. A three-beat assembly story becomes three labeled
   stills, not an empty container or a single unexplained end frame.
2. **Content stays available without animation.** Start from an already-visible,
   usable document. Motion enhances it; neither scroll entry, script loading,
   playback completion nor background-tab timing unlocks content or actions.
   On cancellation, failure or teardown, restore a usable state and preserve
   focus. Reveals must never leave essential content at opacity zero.
3. **No non-compositable properties in hot animation paths.** Prefer `transform`
   and `opacity`; never animate layout or paint properties frame by frame on a
   frequent interaction or continuous sequence. Measure the actual browser trace:
   a property name alone is not proof of compositor execution. Rework the effect
   or keep it static if it misses the budget.

Accessibility also constrains sequences in either context:

- **WCAG 2.2.2:** automatically starting movement, blinking or scrolling lasting
  more than five seconds alongside other content needs a mechanism to pause,
  stop or hide it, unless essential to the activity. Scroll entry, hover or focus
  are not intentional play activation. A pause must persist while the user
  operates the rest of the page; trapping focus on the moving element is not a
  control. Auto-updating information has its own pause/stop/hide or update-rate
  control requirement, without the five-second exception.
- **WCAG 2.3.1:** avoid flashing. Never exceed three flashes in any one-second
  period unless below both the general-flash and red-flash thresholds. Do not
  guess that a small flashing region is safe. A pause or stop control cannot
  excuse unsafe flashing that has already occurred.
- **Reduced-motion support does not replace these safeguards.** Meet them for
  everyone, including users who have not configured a motion preference.

## Compose a sequence

1. **Temporal hierarchy:** identify the primary beat, supporting beats and the
   moment to read. Give one focal event priority at a time. Stagger by meaningful
   groups, with a bounded total duration independent of list length; never make
   a user wait through every item before acting.
2. **Timeline and orchestration:** name phase boundaries and relationships such
   as "after the part arrives" rather than scattering unrelated timers. Define
   entry, interruption, reversal, completion and teardown. Repeated activation
   must replace or retarget the current sequence, not accumulate competing runs.
3. **Physical easing:** accelerate and decelerate consistently with direction,
   distance and implied mass. Use a controlled settle for arrival and a clear
   departure for exit. Functional controls avoid bounce or elastic overshoot.
   An expressive overshoot needs a specific playful or physical meaning; it must
   not move the interaction target away from the user's pointer or focus.
4. **Spatial continuity (FLIP):** measure First and Last geometry around one layout
   change, Invert the visual displacement with a transform, then Play back to the
   final geometry. Batch reads and writes at those boundaries, not each frame.
   Preserve element identity and focus. Re-measure if responsive layout changes;
   do not blindly retain stale coordinates or scale text into unreadability.
5. **Compositing budget:** bound concurrent animated elements, layer area and
   sequence duration. Profile the lowest supported device and both viewport
   sizes against the project's frame budget. At 60Hz the whole frame has about
   16.7ms, not all of it available to animation. Avoid blanket layer promotion;
   use `will-change` only for a measured need and release it afterwards.

## Verify the outcome

Exercise normal motion, reduced motion and animation unavailable. Try rapid
activation, reverse/cancel, resizing and background/resume. Check that content,
focus and actions survive every path; do not merely check that a timeline ran.
For expressive work, compare what the moving and static versions communicate.
Verify automatic-movement controls and flashing limits separately. Record the
observed frame trace and viewport evidence when implementing UI; source-only
review cannot certify smoothness or rendered accessibility.

Choose the consumer project's existing animation tools. Keep optional
library-specific recipes in references or a front-end pack, never in this core
procedure. This standard does not select dependencies, author video pipelines,
or duplicate the broader frontend or accessibility review process.
