---
skill: qa
status: shipped
strategy: distill + repoint (browse daemon → claude-in-chrome MCP)
target_loc: 400
actual_loc: 104
activation: on-demand
phase: F
depends_on: [ui-review, tdd, testing]
composes_with: [ui-review, tdd, testing]
source_ticket: DEV-390
epic: DEV-383
audit_date: 2026-07-10
auditor: Folpe + Claude Opus 4.8
---

# Skill audit: `qa`

## Need

De-gstackification Vague 4 (REBUILD). The gstack QA methodology (`/qa`, `/qa-only`, the live half of `/design-review`) is valuable, but it drives the gstack `browse` daemon — ~190 CDP/Chromium files we will not port (a full port is weeks; a re-point is days). Claude Code already ships the `claude-in-chrome` MCP. This ticket re-points the QA *prose* onto that MCP, so the harness gets live-browser QA without carrying the daemon.

## Decision: one `harness:qa`, re-pointed, composing ui-review + tdd

- **One skill, one subject.** The subject is "live browser QA of a running web app." `/qa-only` becomes a `--report-only` mode (report-only is a mode, not a subject); the live visual QA from `/design-review` becomes a "visual pass" that **composes `ui-review`** rather than restating its methodology. No second skill, no duplicated design rules.
- **Re-point, don't port.** Every `$B <cmd>` browse call maps to a `mcp__claude-in-chrome__*` tool (a mapping table is in the skill). `tabs_context_mcp` is called first, per the claude-in-chrome contract.
- **Reject the runtime AND the bootstrap.** The gstack runtime (browse binary, gbrain/learnings, telemetry, `~/.gstack` artifacts, cookie-profile import) is rejected as operational surface, not doctrine. Separately, the gstack `/qa` Test-Framework-Bootstrap block (detect runtime → install a framework → write TESTING.md) is rejected as **scope creep**: standing up a test framework is `harness:tdd`/`harness:testing`, and a QA skill that also bootstraps one would be two subjects. The regression test in the fix loop composes tdd/testing instead of reimplementing test authoring.

## How the < 30% overlap is held

- **vs `ui-review`** — this skill drives the browser and owns the functional exploration + atomic fix loop; `ui-review` owns visual-craft judgment (applied here to live screenshots via composition). Different subject, one directional compose.
- **vs `devex-audit`** — that audits a developer-facing surface (API/CLI/SDK/docs journey, TTHW); this QAs an end-user web app in a browser. Different surface.
- **vs `tdd`/`testing`** — they author unit/E2E suites; this is exploratory human-style QA of the deployed app, and it composes them only for the regression test that locks a fix.

## Companion change: lift the anti-claude-in-chrome rule (gated by Folpe)

`~/.claude/CLAUDE.md` (Folpe's personal, cross-project global config) carries "Always use /browse … Never use `mcp__claude-in-chrome__*`". That rule predates the claude-in-chrome adoption and makes this skill unusable. The ticket requires lifting it "in the same move." Because it is Folpe's personal file affecting every project (not the void-harness repo), the exact edit is confirmed with him rather than applied silently — see the ship step.

## Assumed limitation (documented, not a gap)

claude-in-chrome drives the user's real interactive Chrome. QA in a headless cloud/cron session with no interactive browser is **out of scope** — a capability the browse daemon had and this does not. The skill states this rather than faking a result. If walk-away/headless QA is ever needed, that is a separate initiative (a headless driver), not this ticket.

## DEV-444 evidence adaptation

- `qa` remains the browser driver and now binds mobile/desktop applicable-state captures to the current diff.
- Visual methodology stays in `ui-review`; independent verdict ownership stays with Visual Craft Director.
- Missing browser proof blocks UI certification instead of falling back to model judgment.

## Dogfood (AC — observed 2026-07-10)

Ran the skill end-to-end via claude-in-chrome against a real running app (`sesame`, an authenticated Next.js real-estate app on localhost:3000), report-only to protect live data. Exercised: `tabs_context_mcp` → new tab → navigate → Orient (nav map, framework, console) → Explore (dashboard, missions) → **empty state** (search with no match → clean "Aucun ordre…") → form input → console/network checks → responsive attempt. Surfaced two app findings (filter buttons with no accessible name; a subtitle count that ignores the active search filter) and one **skill/tooling** finding, folded back in: `resize_window` resized the window but the screenshot stayed desktop-width (1232px), i.e. no true mobile-viewport re-render on this setup — the skill's responsive step now says to verify the screenshot dimensions changed before trusting a "mobile" shot. AC "a full QA flow end-to-end on a real site, observed" met.

## Open follow-ups

- Consider a devtools device-emulation path for reliable mobile-viewport captures if `resize_window` proves consistently unreliable — today the skill just flags the caveat.
- `ui-review`'s live-audit note was repointed to this skill in the DEV-390 diff. `devex-audit` still carries the identical "deferred to Vague 4 (claude-in-chrome)" language (5 spots): its live-browser layer now has a home too, but un-deferring it means flipping its "MUST NOT drive a browser" anti-rule — a real change to a DEV-398 skill, deliberately left as a **fast-follow** rather than a contradictory partial edit inside this PR.

## 2026-10-23: proportional delivery composition correction

Keep diff-aware QA within the affected states/viewports and existing correction budget; broad scoring and visual audits stay explicit.
See [Proportional delivery](../../PROPORTIONAL-DELIVERY.md).
