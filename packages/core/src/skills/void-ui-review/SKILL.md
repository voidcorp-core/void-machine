---
name: void-ui-review
description: "Audit and polish an EXISTING UI: the AI-slop test, heuristic critique, technical audit (contrast/a11y/responsive/perf), refine modes. The audit ceiling to frontend-design's build floor."
---

# ui-review — voidcorp craftsman edition

`void-frontend-design` is the build-time floor: the discipline applied while writing UI. This skill is the audit-time ceiling: a deliberate pass over an *existing* interface to find what makes it read as generated, identify concrete defects, and refine within scope. Invoke it to critique, audit, or polish a UI that already renders.

It proposes findings and edits at the component level; it does not rewrite the brand (`DESIGN.md` owns that) and it does not re-teach the build rules (`void-frontend-design` owns those — this skill assumes them and checks against them).

**Attribution**: see `.source`. Vendored from `impeccable` (the audit/critique/refine methodology) + gstack `/design-review` (designer's-eye QA) + gstack `/design-consultation`/`/design-shotgun` (the pieces that stayed here; recon/design-prompt went to `forge`). Live browser operation is delegated to `void-qa`.

---

## Classify the register first

Judgment differs by register — apply the matching bar:

- **Brand** — marketing, landing, campaign, portfolio: *design IS the product*. Boldness, distinctiveness, and a memorable moment are the bar.
- **Product** — app UI, admin, dashboard, tool: *design SERVES the product*. Clarity, density, and low cognitive load are the bar.

Pick by task cue first ("landing page" vs "dashboard"), then the surface in focus, then the `register` field in `PRODUCT.md`/`DESIGN.md`.

## The AI-slop test (the core pass)

If someone could look at this and say "AI made that" without doubt, it has failed. Run the **category-reflex check at two altitudes** — the second catches what the first misses:

- **First-order** — could someone guess the theme + palette from the *category alone*? (SaaS → blue/violet; fintech → navy/gold; AI tool → cream/sand.) If yes, it is the first training-data reflex. Rework the color strategy and the physical-scene sentence until the answer is not obvious from the domain.
- **Second-order** — could someone guess the aesthetic family from *category-plus-anti-reference*? ("AI tool that's not SaaS-cream → editorial-typographic"; "fintech that's not navy → terminal dark".) The first reflex was dodged; the second wasn't. Rework until neither answer is obvious.

Cross-register slop (the absolute bans — side-stripe, gradient text, glassmorphism, hero-metric, eyebrow-on-every-section, cream/sand body, text overflow) is owned by `void-frontend-design`; flag any that survived into the shipped UI as findings here.

## Critique pass (designer's eye, heuristic)

- **First impression** — look for 3 seconds, then look away. What did you retain? Run the **squint test**: blur the screen — does the hierarchy still read, does the primary action still dominate? If everything is equally loud, there is no hierarchy.
- **Information architecture** — is the primary action singular and the most prominent? Is supporting context recessed, and noise cut?
- **Interaction-state coverage** — every state the user hits, described as what they *see*: loading, empty, error, success, partial. A missing state is a finding, not a detail.
- **Emotional arc** — the 5-second / 5-minute / 5-year read: does the first glance earn the second, and does it hold up on the hundredth visit?
- Ground findings in the affected journey and visual evidence. Completion follows accepted requirements and resolution of concrete defects, without numeric ratings.

## Technical audit pass

- **Contrast** — body ≥ 4.5:1, large text ≥ 3:1, placeholders held to 4.5:1 (not the muted-gray default). The commonest failure: muted gray on tinted near-white.
- **Accessibility** — keyboard path, focus order, ARIA, 44px targets (composes with `void-accessibility`).
- **Responsive** — per-viewport intent; test heading copy at every breakpoint for overflow; mobile-first dual-quality (composes with `void-frontend-design`).
- **Performance** — LCP budget, no layout-thrash animation, image sizing (composes with the perf tooling).

## Independent post-build verdict

For a changed UI, `void-qa` supplies current-diff screenshots and behavioral proof, then
`core:visual-craft-director` reviews them in a fresh context distinct from the builder and pre-build
designer. It reviews hierarchy, information architecture, interaction states, responsive intent,
distinctiveness and accessibility against accepted requirements, reporting concrete defects. Missing browser access,
mobile/desktop or applicable-state captures, current-diff binding, or test proof blocks approval.
Model judgment alone is never visual certification.

## Refine modes

Once findings exist, drive a focused refine rather than a vague "make it better":

- `polish` — final pre-ship quality pass · `harden` — errors, i18n, edge/empty states · `distill` — strip to essence.
- `bolder` — amplify a bland/safe design (brand register) · `quieter` — tone down an overstimulating one · `colorize` — strategic color into a flat UI.
- `clarify` — UX copy, labels, error messages · `layout` — spacing, rhythm, hierarchy · `typeset` — type hierarchy and fonts.

Each is a scoped edit driven by the critique/audit findings, not a rewrite.

## Live browser audit — via `void-qa`

The live layer — screenshotting the running UI, driving interactions, checking states in a real browser — is not in this prose skill; the browser home for it is `void-qa` (the claude-in-chrome MCP re-point, DEV-390). When a check needs a running browser, compose `void-qa` (its visual pass invokes this skill's methodology against the live screenshots) rather than reviewing from code alone. The multi-variant comparison board remains out of scope (forge).

## Composition & boundaries

- **With `void-frontend-design`** — the build-time floor to this audit ceiling; the bans and build specifics live there, this skill checks against them and does not restate them (no > 30% overlap).
- **With `core:visual-craft-director`** — this skill supplies the rubric; the specialist supplies the independent post-build verdict over evidence captured by `void-qa`.
- **With `void-accessibility`** — the a11y audit dimension composes with it.
- **Not `void-plan-review`'s Design lens** — that judges a *written plan* before any code exists (does the plan name the states, the responsive intent?); this judges the *shipped UI*. Different artifact, different lifecycle stage.
- **Not `void-devex-audit`** — that audits a shipped dev-facing surface (the API/CLI/SDK/docs journey: naming, errors, TTHW); this audits the visual/interaction UI. Sibling audit skills, different subject.
- **With `forge`** (voidcorp plugin) — market recon, the 12-dimension scored critique, multi-variant design prompts, and the slop-registry live there; bridged by the `docs/specs/` `source: forge` artifact contract.
- **Supersedes** the external `impeccable` skill's prose methodology (now harness-native) and gstack `/design-review`/`/design-consultation`/`/design-shotgun`.

## Anti-rules

- MUST NOT decide brand identity — `DESIGN.md` owns palette/type/motion.
- MUST NOT restate `void-frontend-design`'s build rules — assume and check against them.
- MUST NOT drive a browser or make live requests — compose `void-qa` and review its current-diff evidence.
- MUST NOT rewrite a UI wholesale under a refine mode — a refine is a scoped, finding-driven edit.
- MUST NOT vendor the gstack/impeccable runtime (scripts, reference command files, comparison board).

## Final rule

```
Existing UI → classify register → AI-slop test → critique (squint + states) → technical audit → scoped refine.
Otherwise → it is not voidcorp ui-review.
```

Anyone can generate a UI. This skill is what makes ours stop looking generated after it already shipped.
