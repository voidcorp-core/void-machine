---
title: Herdr personal workspace for agent coding
date: 2026-10-12
status: in-design
author: Folpe + Codex
ticket:
related: []
---

# Intent and observed baseline

Folpe wants eight selected Herdr plugins to reduce switching between agents,
projects, diffs, tickets and pull requests. This is a personal workstation setup,
not a new dependency or convention shipped by void-machine.

The live client and server are both 0.9.3, with no restart required. Only reviewr
is installed. The native sidebar carries mission and worker metadata. MACHINE
has a coordinator, REVIEW, PIPELINE and RUN; other projects have live sessions.
Ctrl+Q is the prefix, with existing agent, worktree and popup bindings to preserve.

# Options and recommendation

1. Recommended: eight plugins with distinct roles and on-demand secondary views.
   Keep the terminal as the primary coding surface and add two complementary
   browser views. This delivers the requested capabilities without a new app.
2. Ambitious: build a custom cross-project web dashboard over Herdr's API. It
   allows bespoke aggregation but adds authentication, terminal transport,
   reconnect handling and maintenance before demonstrating a missing capability.
3. Alternative: use Web UI as the daily workspace and keep terminal Herdr as a
   fallback. Evaluate after using the existing browser client with real work.

# Proposed organization

| Plugin | Role and placement |
| --- | --- |
| [Web UI](https://github.com/devswha/herdr-web-ui) | Main browser entry: agent chat and real pane terminals. |
| [Radar](https://github.com/hhdebb/herdr-radar) | Sidebar navigation across projects, worktrees and agents; retain native mission fields. |
| [World](https://github.com/IvoryHeart/herdr-world) | Separate aggregated browser overview; start on demand initially. |
| [reviewr](https://github.com/persiyanov/herdr-reviewr) | Update existing installation; persistent diff pane for the selected worktree. |
| [Annotate](https://github.com/plannotator/herdr-annotate) | On-demand annotations and prepared feedback, with deliberate submission. |
| [Zoetrope](https://github.com/furkankly/zoetrope) | On-demand graph of the identified agent session. |
| [PR Board](https://github.com/cdowell09/herdr-pr-board) | One reusable global tab for pull requests and CI status. |
| [Linear](https://github.com/mrolafsson/herdr-linear) | Ticket popup; project-specific worktree base and agent launch settings. |

First reshape MACHINE only: approximately 65% width for the coordinator, 35%
for review above a run terminal. Move PIPELINE to a separate tab without stopping
its process; lazygit remains available through the existing popup shortcut.
Other workspace layouts, processes, cwd and conversations remain unchanged.
Review must follow the explicitly selected worktree/base rather than remain
pinned to the completed DEV-1017 diff. Never guess which concurrent worker to review.

# Boundaries and rollout

Herdr remains the owner of panes, sessions and agent identity. Plugins consume
that state; no new Cockpit collector or duplicate mission database is introduced.
Keep native mission, worker, ticket, status and measurable-context rows when
integrating Radar. Its installer can change sidebar/theme/font configuration;
inspect and back up those exact files before activation. Preserve existing keys;
Annotate and Radar's documented shortcuts collide with current bindings.

Install sequentially with a verified per-step rollback. Provision required Go
and a compatible Bun for plugin builds without changing unrelated projects'
runtime selection. Use upstream verified releases where supported. Preserve the
old linked reviewr until its replacement passes a real diff check. Disable
automatic duplicate pane creation. Validate configuration before reload.

Serve browser clients locally first. Use their native authentication flows;
never copy connector credentials or hand-edit secrets. Linear's browser OAuth
may require Folpe. An unavailable login is reported as pending, never connected.
Do not exercise ticket mutations, feedback submission, PR publication or merges
as smoke tests. Respect terminal ownership when switching browser clients.

Cockpit is retired and can remain archived in place. Its source directory still
hosts a Claude conversation, and reviewr still uses a separate vendor directory
bearing the Cockpit name. Neither path is moved or deleted during this setup.
A future custom web project may reuse concepts after a concrete gap is observed;
reusing the retired collector is outside this proposal.

# Acceptance and verification

- Eight plugins installed at recorded versions, with successful relevant smoke
  checks; any unmet authentication or compatibility gate listed individually.
- Existing sessions and non-MACHINE layouts preserved by before/after inventory.
- Native mission fields remain visible; existing shortcuts still work.
- Review displays the intended worktree; PR Board displays actual PR/CI data.
- Annotate opens without sending; Zoetrope resolves the intended session.
- Web UI shows real agent chat and a real terminal; World shows actual workspaces.
  Reconnecting a browser does not restart its agent. Verify desktop and narrow
  viewport rendering; remote phone connectivity is not claimed from localhost.
- Record startup/stop instructions, rollback paths and a short user recap of
  capabilities actually verified, distinguishing installation from authentication.

TDD mode: exploratory configuration with real runtime checks and no new product
logic. No synthetic unit tests for plugin installation. If custom integration
code becomes necessary, stop to scope it and select its test mode separately.

Design self-review: eight distinct roles, explicit preservation and rollback,
no missing approval implied, no claim of completed installation. This document
is a proposal awaiting Folpe's approval, not an accepted architectural decision.
