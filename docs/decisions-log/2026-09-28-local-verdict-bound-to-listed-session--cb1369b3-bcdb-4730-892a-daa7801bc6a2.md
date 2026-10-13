---
schemaVersion: 1
id: "adr:cb1369b3-bcdb-4730-892a-daa7801bc6a2"
createdAt: "2026-09-28T17:28:15.880Z"
title: "A local review verdict binds to the session the runtime lists, and a forged result for that session stays inside the accepted residual risk"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# A local review verdict binds to the session the runtime lists, and a forged result for that session stays inside the accepted residual risk

## Context

`adr:6660e476-77c4-420b-801d-00f941c9395e` has autopilot merge on a local verdict: a
fresh-context, read-only reviewer the kernel delegates on the head, recorded in the local journal.
It accepts that a disobedient worker on the owner's machine could write a false local verdict, and
bounds that risk by the binding to the head, the protected paths, the shared-state fingerprint and
the human promotion to the branch that deploys.

The review of #434 raised a narrower case. The reviewer's answer reaches the kernel through the
delegation Stop hook, which writes `result.json` under `.void/machine/runs/**`
(`adr:af7d9cc5-2dab-4908-a908-44e4121510e9`). A delegated `work` agent can write there too. If the
kernel believed that file alone, a worker could rebind the review run to a session of its own in
the run record and record a clean result for it, without touching the verdict record at all.

## Decision

`autopilot review` accepts the reviewer's result only through `acceptReview`, which reads the run's
native session from the runtime listing at acceptance time, never from the run record, refuses a
record or a result naming any other session, and returns that session, which the verdict record
carries beside the run it came from; a result written for the live session itself stays inside the
residual risk `adr:6660e476-77c4-420b-801d-00f941c9395e` accepts.

## Consequences

Positive:

- Rebinding a review run, or recording a result for a session other than the one the runtime lists
  under it, is refused: the forgery now needs the live session id and a write in the same window as
  the reviewer's own answer.
- The verdict record names the run and the session, so a person auditing a merge can find the
  reviewer's native transcript.
- The review command also checks the worktree `HEAD` before and after, refuses a dirty worktree,
  and records the head itself; the reviewer never states what it judged.

Negative:

- The result text is still read from a file an agent on the machine can write. A worker that reads
  the live session id and overwrites `result.json` before acceptance forges a verdict. That is the
  same class as writing the verdict record directly, which the residual risk already accepts, with
  the same bounds; a repository that cannot accept it adds required checks on GitHub, as this one
  does with its review App.
- The reviewer runs in a worktree of the head and loads the project instructions found there
  (`CLAUDE.md`, `AGENTS.md`), which a pull request may change. Its runtime configuration
  (`.claude/**`, `.mcp.json`) and the reviewer's definition are protected paths, so a pull request
  changing them goes to a person; the instructions are read as data under review and the brief says
  so, which reduces the risk without removing it.

## Alternatives considered

- **Cross-check the text against the native transcript under `~/.claude/projects`:** rejected. The
  transcript format is internal to Claude Code and undocumented, the hooks documentation warns it
  may lag the final message, and it is also writable by an agent on the machine; it would add a
  dependency on an unstable format without closing the class.
- **A per-run nonce the verdict must echo:** rejected. The nonce travels in the brief, which lives
  in the run directory an agent can read, so it proves nothing a forger cannot copy.
- **Keep the verdict off the machine (a check posted by a credential only `main` can read):** that
  is `adr:03e82acc-0f4b-4718-9b88-3d1b2acd4903`, which a consumer cannot set up; it stays available
  as the optional GitHub layer.

## Reversal cost

Low. The binding lives in `acceptReview` and `autopilot review`; removing it changes two modules and
their tests, and the verdict record keeps the same shape.
