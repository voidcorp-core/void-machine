---
title: Select an Orchestra mission without changing its execution state
date: 2026-10-12
status: in-design
author: Folpe + Codex
ticket: DEV-1016, DEV-1017
related:
  - 2026-10-08-native-herdr-orchestration.md
---

# Explicit mission selection

## Problem and observed behavior

One coordinator can retain several unfinished missions while working on one of them.
The current reader correctly refuses to choose among multiple nonterminal missions.
On the real repository, two blocked missions and one running mission share ORCH's
canonical worktree; the source reader returns `ambiguous orchestra missions`.
This prevents file-backed mission projection during the DEV-1017 cutover.

The user has explicitly requested DEV-1017 before DEV-1016 completion. Closing older
missions, preferring the newest timestamp or treating blocked as terminal would
change the meaning of their history. The missing capability is explicit selection,
not weaker ambiguity detection. Selection must survive clear, compact and resume.

## Alternatives and recommendation

1. **Explicit local selection (recommended).** ORCH writes a small binding in its
   worktree. Hooks validate that choice and re-resolve the participant in Herdr.
   This adds one optional file, without a daemon or a second execution-state owner.
2. **One coordinator worktree per open mission.** Keep today's unique-discovery
   rule and move coordination to distinct worktrees. This avoids new selection
   state, but makes switching missions move the coordinator's working context and
   conflicts with preserving this existing ORCH session during migration.
3. **Native multi-mission control surface.** A richer mission switcher could provide
   discovery, selection and supervision together. It offers a more complete user
   experience but recreates a maintained control surface while retiring Cockpit.

Use option 1. The explicit binding selects context only; Linear still owns ticket
progress and mission/report files still own coordination state and evidence.

## Binding contract

Optional file: `<canonical coordinator worktree>/.void/machine/orchestra-selection.json`.
ORCH alone writes it atomically. It is local, unversioned and reconstructible from
the selected central mission; it never becomes part of the program descriptor.

Strict JSON schema 1, maximum 4096 UTF-8 bytes:

```json
{
  "schema": 1,
  "project": "<SHA-256 of canonical Git common directory>",
  "mission": "<existing central mission identifier>",
  "coordinator": {
    "label": "ORCH",
    "worktree": "/absolute/canonical/worktree"
  }
}
```

Unknown or duplicate keys, wrong types, traversal, symlinks, oversized content,
partial writes, a different repository/worktree or an absent mission refuse use.
Mission identifiers use the existing bounded identifier grammar, never a supplied
filesystem path. The binding contains no pane ID, workspace ID, status, timestamp,
session ID, review verdict or permission. Mission/report schema 1 remains unchanged.

## Reading, switching and continuity

- Without a binding, retain existing unique discovery and ambiguity refusal.
- With a binding, validate the full bounded discovery, then select exactly the
  named central mission. Do not bypass malformed state or discovery limits.
- The selected mission's coordinator label and canonical worktree must equal the
  binding and current worktree. Re-read `herdr pane list` and resolve that pair;
  a missing or duplicate live match refuses. The binding alone proves no identity.
- A worker in its separate worktree continues existing discovery. The coordinator
  selection never changes a worker's mission, attempt or report.
- An invalid or obsolete binding reports a concrete error and never falls back
  to another mission. Without a binding, ambiguity reports candidate identifiers
  and the need for ORCH to choose, within existing diagnostic output bounds.
- ORCH switches by atomically replacing the binding after reading the target
  mission and its reports. Hook reads never write or repair the binding.
- A selected terminal mission can only perform the existing guarded cleanup of
  tokens still belonging to that mission. It never clears another mission's tokens.
- Clear/compact/resume re-read the binding and central files; no new worker is
  launched merely because a coordinator session is resumed.

No automatic timestamp, status or token-based tie breaker is introduced. No state
in an older mission is changed to enable selection. This extends the approved
explicit-ORCH-choice behavior and preserves refusal of arbitrary selection.

## Verification and rollout

Strict TDD: first reproduce the missing explicit-selection behavior, then implement.
Cover multiple blocked/running missions; correct binding; missing binding; stale,
foreign and malformed binding; duplicate keys; limits and symlinks; wrong participant;
live pane absence/ambiguity; workers remaining on their own mission; terminal cleanup
against another mission's tokens; and no fallback after a bad selection.

Run the actual reader on the real repository with the three existing mission files
unchanged. Prove ORCH selects DEV-1017 only through its valid binding, and that the
unbound case still refuses. Preserve the observed pre-correction failure.
Verify the metadata hook through both runtime inputs and its generated bundle.
No invented lifecycle event or token counts as a live runtime proof.

An ADR records this selection boundary before implementation. Deliver through the
existing independent review and CI pipeline. Installing new global hooks, altering
Herdr server state, or removing Cockpit is outside this code change and retains its
separate concrete activation gate. The currently active guard bundle remains pinned.

## Self-review

The design separates selection from execution state, preserves label/worktree
identity and existing discovery bounds, and specifies invalid/stale/terminal cases.
It adds no daemon, generic registry, automatic migration or review bypass.
User approval of this written design is pending; no implementation has begun.
