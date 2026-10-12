---
title: Apply the personal Herdr workspace globally
date: 2026-10-12
status: implemented-with-verification-limits
spec: docs/specs/2026-10-12-herdr-personal-workspace.md
ticket:
author: Folpe + Codex
high_risk: false
---

# Goal and authorization

Install the eight approved plugins and make their navigation and project layout
available across existing and future projects. Folpe approved execution and the
global scope on 2026-10-12. Preserve live agents, worktrees and unrelated files.
This standalone workstation task does not select a programme ticket.

# Steps

1. **Establish rollback and dependencies.** Depends on none. Exploratory mode.
   Back up the Herdr config, registry, existing plugin config and terminal config
   before their installers can modify them. Save workspace/pane/agent inventory.
   Install compatible build dependencies; keep existing project runtime choices.
   Gate: hashes and inventory recorded; documented minimum versions satisfied.
2. **Install and configure the eight plugins.** Depends on 1. Exploratory mode.
   Pin the inspected upstream commits. Migrate the linked reviewr reversibly;
   preserve its old files. Compose Radar with existing mission rows, set global
   conflict-free shortcuts, configure PR Board and Linear without guessed repo
   mappings or credentials. Start browser services on loopback only.
   Gate: all manifests registered, configuration valid, action logs inspected,
   authentication gaps named and remaining plugins proceed independently.
3. **Apply the common project layout.** Depends on 2. Souple mode for local glue.
   Use Herdr workspace/worktree events for future projects. A small personal
   plugin preserves existing processes, uses explicit IDs and applies once per
   project workspace. Test repeated events and populated-workspace refusal
   before activation. Migrate existing ORCH/AGENTS/PIPELINE/RUN layouts and
   add review/run companions to single-pane project workspaces. Preserve scratch
   and worker tabs. Gate: live terminal identities and agent sessions retained;
   isolated new Git project obtains one layout, including on repeated invocation.
4. **Verify real usage and document recovery.** Depends on 3. Exploratory mode.
   Observe diff, PR Board, annotations, session graph, browser workspace and
   terminal views. Use native OAuth only if needed; do not send agent prompts,
   publish reviews or change tickets for smoke tests. Record exact versions,
   startup commands, shortcuts and per-plugin results in local setup evidence.
   Gate: short user recap separates verified capability from pending login/UI
   checks; rollback and new-project behavior are documented.

# Review and commits

The approved organization and explicit global extension authorize this sequence.
No repeat organization approval. Surface only a concrete incompatible behavior
or an action requiring native user interaction. Keep source changes outside
unrelated projects. Expected repository commits are documentation only; personal
configuration and evidence remain local. Hooks and whitespace checks gate commits.

# Execution result, 2026-10-12

1. DONE. Private backups retained; the three standalone file hashes rechecked.
   Registry directory copied with links preserved. Go 1.27.2 installed, Bun 1.4.3
   isolated from the existing Bun 1.3.13. Zoetrope 0.2.0 installed from the verified
   official binary after its Homebrew build required a newer Xcode.
2. DONE. Eight plugins enabled, plus one personal layout helper. Herdr config
   validates; Linear OAuth and World local login verified. Web services listen
   only on loopback. Web UI uses a local link with explicit isolated Bun paths;
   the remaining plugins use pinned native installations. Mission rows retained.
3. DONE for existing projects and future single-pane Git workspaces. Seven
   project spaces adapted; all 38 original terminal identities and four agent
   occupants preserved, including every reported native session identity.
   Current inventory: eight spaces, 43 panes. Seven helper tests pass; a real
   workspace-created hook produced ORCH/REVIEW/RUN, and repeat invocation did
   not duplicate panes. Populated/custom workspaces are left intact.
4. PARTIAL verification, installation complete. Real diff, PR/CI board,
   annotation manager, Claude session graph, browser chat/terminals and World
   views observed. No agent prompt, review or ticket mutation sent as a test.
   Desktop screenshots saved locally. World narrow rendering was observed;
   Web UI narrow rendering remains unverified because the viewport override
   affected the other browser tab. No remote phone access configured.

# Remaining boundaries

- MACHINE already lacked a native session ID in the baseline. Zoetrope reports
  that gap; its Claude graph works. Do not invent a SessionStart or restart an
  active agent merely to erase this verification limit.
- The automatic layout applies to new Git workspaces/worktrees, not arbitrary
  scratch tabs. Ordinary browser reconnect was observed; full Herdr restart and
  automatic restoration of companion processes were not exercised.
- Linear uses the repository's remote default branch when creating a worktree.
  Its launch prompt requests the project's prescribed base and installed
  void-implement skill; repository-specific base mappings remain unset.
- World is a persistent local user service, rather than the initial on-demand
  proposal, matching the approved recurring workstation setup. Its generated
  service default was corrected to loopback before acceptance.

Local guide, pinned registry, verification receipt and screenshots:
`.void/machine/herdr-setup-20261012/`. These are workstation evidence, not shipped
harness assets. `void-machine doctor` reports self-host healthy. Repository
changes are documentation only: no product typecheck or application test suite
rerun; local helper tests, runtime checks, whitespace and normal commit hooks
are the relevant gates. No strict-mode PR or independent-review claim is made.

No further installation or server restart is needed. A future session should
consult the local guide before changing this personal configuration.
