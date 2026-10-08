---
schemaVersion: 1
id: "adr:673f19ca-e968-4cd0-ac3d-bd2d6f5798a3"
createdAt: "2026-10-08T15:02:01.785Z"
title: "Delegate through native agents and Herdr with file-based mission continuity"
status: proposed
deciders: ["folpe"]
supersedes: ["adr:5dd5306b-721f-4e9b-b592-c765c8eb823e","adr:af7d9cc5-2dab-4908-a908-44e4121510e9","adr:0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7","adr:cb1369b3-bcdb-4730-892a-daa7801bc6a2","adr:6660e476-77c4-420b-801d-00f941c9395e"]
---

# Delegate through native agents and Herdr with file-based mission continuity

## Context

DEV-1016 requests orchestration independent of cockpit, with short native agents,
long-lived Herdr workers and durable mission files. The incidents of 7 and 8 October
show shared Codex daemon hooks attributing another project's session to a pane.
The same mismatch was observed during preparation: inherited workspace w9 referred
to Cortex, while the MACHINE coordinator was verified at wA:p2.

The develop baseline bc1722cb requires kernel delegation even for short reviews;
its Codex adapter uses the shared daemon. Removing cockpit calls alone cannot
implement the requested behavior. The kernel's judgment and merge rules serve a
different purpose and must survive the change of execution transport.

## Decision

Proposed: delegate short analysis and review to native subagents, long implementation
to Herdr agents, and recover coordination from versioned-format mission files.

Herdr owns live sessions and terminals. The harness owns briefs, bounded workflow,
review evidence and acceptance. Pane identity is label plus canonical worktree within
an explicitly verified server/workspace; a native session reference serves resume.
Codex launch and resume under Herdr must retain --no-daemon and the required working
directories. A file report is untrusted evidence, never a merge grant.

The linked spec defines the migration:
[DEV-1016](../specs/2026-10-08-native-herdr-orchestration.md).

Supersession is limited to delegation transport, result collection and native-session
binding in the five named decisions. Exact reviewed commit, base, acceptance criteria,
independent read-only review, bounded correction cycles, CI, protected paths, shared
Git integrity, consent and human promotion remain binding. Native review evidence must
be admitted through a validated receipt before existing merge logic can consume it.
No existing review is silently converted, and no in-flight run is relaunched or erased.

## Consequences

Positive:

- One live-session owner, with visible workers and no cockpit dependency.
- File ownership separates coordinator state from each worker's report.
- A cleared coordinator can recover without scraping terminal output or relaunching work.

Negative:

- Automatic restore must preserve launch options; documented resume support alone does
  not prove no-daemon, writable mission access or correct identity after restart.
- Local reports can be altered by an agent with write access. Independent verification
  and the existing merge guards remain necessary; YAML is not authentication.
- The migration touches review admission and requires behavioral proofs before the
  old delegation path can be removed from active callers.

## Alternatives considered

- **Keep kernel sessions and improve cockpit identity repair:** preserves the existing
  launch contract, but retains duplicated session ownership and contradicts DEV-1016.
- **Build a resident multi-runtime orchestra supervisor:** could supervise hosts and
  disconnected operation, but duplicates Herdr and adds a daemon the ticket excludes.
- **Add only a personal skill beside existing kernel dispatch:** cheap initially, but
  leaves capture redirecting native agents and two conflicting orchestration rules.

## Reversal cost

Medium. Restore the prior delegation adapters and caller routing while retaining
mission files as historical evidence. Review and merge policy need not be redesigned.
This decision remains proposed until the written design is accepted.
