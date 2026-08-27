---
schemaVersion: 1
id: "adr:da9bb0a9-9c5a-46df-9459-27a583e92af2"
createdAt: "2026-08-27T19:18:25.770Z"
title: "PreCompact may preserve mechanical checkpoint state"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# PreCompact may preserve mechanical checkpoint state

## Context

`void-checkpoint` deliberately rejected an automatic SessionEnd writer. A stop event cannot tell
an interruption from a completed turn, and a hook without the conversation's judgement would make
semantic claims about dead ends, assumptions, and the next action. A false semantic checkpoint is
worse than an absent one because the next session trusts it.

`PreCompact` has a different meaning. Both supported runtimes emit it only when compaction is about
to discard context. The event is an observed loss boundary, not a guess about whether work ended.
The hook can preserve bounded facts it already observed: usage counters, recent read and modified
paths, revision identity, and cycle state. It still cannot author semantic residue or trigger the
runtime's `/clear` or `/compact` commands.

Keeping those facts in a sidecar would give the next session two files to reconcile. Rewriting the
whole checkpoint would instead let a mechanical adapter erase human-authored semantic sections.
The two authorities therefore need one file with an explicit ownership boundary.

## Decision

`PreCompact` may atomically add or replace one delimited mechanical block in
`.void/machine/checkpoint.md`; only `void-checkpoint` may author the semantic sections around it.

The hook refuses ambiguous markers, preserves all bytes outside the block, never invents semantic
content, and never blocks compaction on a continuity failure. `UserPromptSubmit` and `SessionEnd`
remain advisory for semantic checkpointing. This decision supersedes only the audit note's broad
claim that no hook writes the checkpoint; its rejection of an automatic semantic SessionEnd writer
remains in force.

## Consequences

Positive:

- Mechanical facts survive announced compaction in the same file that `ResumeBundle` already reads.
- The semantic authority remains explicit and testable: the skill preserves the block byte-for-byte,
  while the hook preserves semantic prose byte-for-byte.
- Claude Code and Codex share the same event contract and portable handler.

Negative:

- The checkpoint has two writers, so delimiter validation, a no-wait lock, and atomic replacement
  are required.
- A failed or ambiguous write leaves continuity degraded and the previous checkpoint authoritative.
- `/clear` has no pre-event; without a recent semantic checkpoint, reconstruction can still be
  required after a clear.

## Alternatives considered

- **Keep every hook advisory.** Rejected because a known compaction boundary would still discard
  observed working-set facts that need no semantic judgement.
- **Write mechanical state to a sidecar.** Rejected because it creates two local authorities and a
  reconciliation protocol without adding information.
- **Let the hook rewrite the full checkpoint.** Rejected because it could silently replace dead
  ends, assumptions, or the next action with guesses.
- **Use SessionEnd or Stop as the writer.** Rejected because those events remain ambiguous about
  whether there is open work to resume.

## Reversal cost

Low. Removing the event wiring makes the delimited block inert; the tolerant checkpoint parser can
ignore it, and no persistent schema migration or sidecar cleanup is required.
