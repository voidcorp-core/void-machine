---
name: void-qa
description: "Live browser QA of a running web app via the claude-in-chrome MCP: systematic exploration, edge/error/empty states, atomic fix loop, evidence-backed report. Report-only mode available."
---

# qa — voidcorp craftsman edition

You are a QA engineer AND a bug-fix engineer. Test a running web app like a real user within the selected scope, exercising its controls, forms and relevant states, using the **claude-in-chrome MCP** to drive the browser. When you find a bug, fix it in source with an atomic commit, then re-verify. Produce a structured report with before/after evidence.

This tests the *shipped, running app* through a real browser. It is not unit/E2E authoring (`void-tdd` + `void-testing` own that), and it does not judge visual craft from code (`void-ui-review` owns that — this skill composes it for the live visual pass).

**Attribution**: see `.source`. Vendored from gstack `/void-qa` + `/qa-only` + the live half of `/design-review`, repointed off the gstack browse daemon onto the claude-in-chrome MCP already present in Claude Code. The gstack runtime (browse binary, gbrain/learnings, telemetry, `~/.gstack` artifacts, test-framework bootstrap) is rejected.

---

## When to invoke

- Verifying a running app after a change (the default: a feature branch, "does it actually work?").
- Auditing a deployed site for bugs and broken flows.
- A report-only pass (no fixes) before a review or handoff.

Do NOT use this to author a unit/E2E suite (`void-tdd`/`void-testing`), to audit UI craft from code (`void-ui-review`), or to audit a dev-facing API/CLI/SDK surface (`void-devex-audit`).

## Browser tooling: claude-in-chrome (load first)

The execution primitives are the `mcp__claude-in-chrome__*` tools. If they are deferred, load the core set in **one** ToolSearch call before anything else:

`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__gif_creator,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__read_network_requests`

Command mapping from the old gstack browse (`$B`) to the MCP:

| Need | claude-in-chrome tool |
|------|-----------------------|
| Session tab context (**call first**) | `tabs_context_mcp` |
| Open the target in a **new** tab | `tabs_create_mcp` |
| Navigate | `navigate` |
| Click / type / screenshot | `computer` |
| Fill a form field | `form_input` |
| Read DOM / accessibility tree | `read_page` |
| Console errors after an action | `read_console_messages` (filter with `pattern`) |
| Network (data-fetch 404s) | `read_network_requests` |
| Responsive viewport | `resize_window` |
| Record a repro | `gif_creator` |

## Hard constraints (claude-in-chrome reality)

- **`tabs_context_mcp` first**, every session. Never reuse a tab id from another session; open a fresh tab with `tabs_create_mcp` unless the user names a tab.
- **Permissions are per-site.** If a site is not authorized and permission is refused, STOP and tell the user which site to allow — never loop retrying the same denied call.
- **Never trigger a JS dialog** (`alert`/`confirm`/`prompt`) or a browser modal — they block the extension and kill the session. For repro debugging use `console.log` + `read_console_messages`, not `alert`. Warn the user before touching any element that may open one.
- **Not headless.** claude-in-chrome drives the user's real, interactive Chrome (already logged in — no cookie import, no `~/.gstack/chromium-profile`). QA in a cloud/cron session with no interactive Chrome is **out of scope** — an assumed limitation the browse daemon did not have; say so rather than faking it.
- After 2-3 failed tool calls, a page that will not load, or unexpected tangents: stop and ask the user, do not keep retrying.

## Modes

- **Diff-aware** (default for change verification, including when its URL is supplied) — read the diff, map the changed contract to affected pages, controls, states and viewports. Test the homepage only when it is affected or is a required entry path to that contract. Preserve mobile/desktop and keyboard/touch verification of the affected surface.
- **Full** (explicitly requested audit) — systematic exploration across the requested site scope, evidence-backed issues and health score. A URL alone identifies the target; it does not select a full audit.
- **Quick** (`--quick`) — 30-second smoke: homepage + top 5 nav targets, load + console + broken links only.
- **Regression** (`--regression <baseline.json>`) — run the explicitly requested baseline scope, then compare fixed/new issues and applicable score changes.
- **Report-only** (`--report-only`, the old `/qa-only`) — phases through Report, then STOP. No fix loop, no commits.

## Precondition: clean working tree

Each fix must be its own atomic commit, so before fixing, `git status --porcelain` must be empty. If dirty, ask the user to commit / stash / abort first (recommend commit — preserve their work before QA adds fix commits). Report-only mode may run on a dirty tree.

## Workflow

1. **Orient** — `tabs_context_mcp`, open the target in a new tab, screenshot, read the page, check console. Detect the framework (Next.js `__next` / `_next/data`; Rails `csrf-token`; SPA = client routing) and note it. For an SPA, map nav from `read_page` (client routes, not raw links).
2. **Explore** — visit only the selected mode's pages and affected states. Per page: visual scan of the screenshot; click interactive elements; fill + submit forms (empty, invalid, edge, overflow); walk navigation in and out; exercise **the states a user actually hits — empty, loading, error, overflow**; check console after every interaction; for responsive, `resize_window` then **verify the screenshot dimensions actually changed** — on some setups it resizes the window without re-rendering to a true mobile viewport, so confirm before trusting a "mobile" shot (else note responsive as unverified). Depth over breadth: more time on core flows (auth, checkout, search), less on static pages.
3. **Document** — write each issue the moment you find it, never batch. Two evidence tiers: an **interactive** bug gets a before-screenshot, the action, an after-screenshot (a `gif_creator` repro for a flow); a **static** bug gets one annotated screenshot. Verify a bug reproduces once before writing it. For a UI quality pass, capture mobile and desktop for every applicable state and bind each capture to the current diff hash; a later CSS/UI diff makes it stale. Redact credentials (`[REDACTED]`). Surface every screenshot to the user (Read the file) — otherwise it is invisible.
4. **Health score** (only for an explicitly requested full audit or scored baseline) — per-category 0-100 (Console, Links, Visual, Functional, UX, Performance, Content, Accessibility) minus severity deductions (critical -25 / high -15 / medium -8 / low -3), weighted average. Record it as the baseline.
5. **Visual pass** (only for an explicitly requested visual audit, a new or materially redesigned journey, or an unresolved in-scope usability defect) — compose `void-ui-review` and hand the relevant current-diff screenshots to `core:visual-craft-director` in fresh context. Routine diff-aware verification retains its affected screenshots and functional/accessibility checks without a full visual audit or another specialist invocation. This skill drives the browser; `void-ui-review` supplies the craft bar; the specialist owns the independent verdict. If the browser or required captures are unavailable, report the UI pass blocked rather than certifying from prose.
6. **Triage** — Diff-aware verification fixes only demonstrated in-scope blocking defects in the changed contract. Findings outside that scope are reported as limits or separate decisions; do not enter the fix loop for them or for optional improvements. For explicitly requested broad audits, the authorized tiers remain `--quick` critical+high, full critical+high+medium, `--exhaustive` all severities. Severity alone never expands the authorized scope. Mark unfixable-from-source issues as deferred.
7. **Fix loop** (skipped in report-only) — for an authorized defect, locate its source, write and observe the failing regression before implementation (`void-tdd`/`void-testing`), make the minimal correction, then verify the affected behavior, screenshots and console. Commit the logical fix `fix(qa): <issue>` with its cause and actual proof. Classify verified / best-effort / reverted; a regression must be resolved or reverted without claiming success. In diff-aware delivery, reuse `void-implement`'s existing bounded correction cycle and stop once the affected contract is proven; no extra QA improvement loop.
8. **Self-regulation** (explicit broad audit) — every 5 fixes or after any revert, stop and evaluate: reverts, fixes touching many files, all-low-severity remaining, and unrelated-file edits all raise the "this is going wrong" signal. Above the threshold, or past a hard cap of ~50 fixes, STOP and show the user before continuing.
9. **Report** — state the scope, affected states/viewports verified, real defects, proof, fix status and material limits. Include a health-score delta only when that mode requested a score. A local change needs no whole-site score or unrelated N/A rows. Write under the project's report location, not `~/.gstack`.

## Composition & boundaries

- **With `void-ui-review`** — this skill owns driving the browser and the functional/fix loop; `void-ui-review` owns the visual-craft judgment when step 5 applies; local diff-aware verification does not automatically invoke a full audit. No restated design rules here.
- **With `void-tdd` / `void-testing`** — the regression test in the fix loop is authored per their discipline. This skill finds bugs in a running app; they own how the test that locks the fix is written.
- **Not `void-devex-audit`** — that audits a developer-facing surface (API/CLI/SDK/docs journey, TTHW); this QAs an end-user web app in a browser. Different surface.
- **Not E2E authoring** — Playwright suites are `void-testing`'s output; this is exploratory human-style QA of the deployed thing.
- **Supersedes** gstack `/void-qa`, `/qa-only`, and the live-screenshot half of `/design-review`.

## Anti-rules

- MUST NOT test by reading source — test as a user; read code only in the fix loop, to locate the bug.
- MUST NOT trigger a blocking JS dialog / modal — it kills the claude-in-chrome session.
- MUST NOT reuse a cross-session tab id, or assume a headless/CI browser — mark non-interactive sessions out of scope.
- MUST NOT bundle fixes — one atomic `fix(qa):` commit each; revert on regression.
- MUST NOT include credentials in the report — `[REDACTED]`.
- MUST NOT bootstrap a test framework or edit CI/CLAUDE.md — that is `void-tdd`/`void-testing`, not QA.
- MUST NOT vendor the gstack runtime (browse binary, gbrain/learnings, telemetry, `~/.gstack` artifacts, cookie-profile import).

## Final rule

```
Running app → select authorized scope → load browser → verify affected states/viewports →
record evidence → fix only in-scope defects with RED/GREEN → stop when proven → report.
Scoring and broad visual exploration apply only to the modes that request them.
Report-only stops before the fix loop. Otherwise → it is not voidcorp qa.
```

QA is the discipline of hitting the app the way a user will, before the user does — and, when it breaks, fixing it under the same evidence bar that found it.
