---
schemaVersion: 1
id: "adr:0d9fd85a-f158-42c5-89a2-c70b6e452c07"
createdAt: "2026-10-13T08:54:37.785Z"
title: "Delegate adaptively through native capabilities with optional presentation"
status: accepted
deciders: ["Folpe"]
supersedes: ["adr:673f19ca-e968-4cd0-ac3d-bd2d6f5798a3"]
---

# Delegate adaptively through native capabilities with optional presentation

## Context

The current orchestration procedure makes Herdr discovery a prerequisite even for
native agents. Brainstorm and plan do not request independent investigation, and
interactive implementation can keep all work in the user's conversation. Folpe
approved adaptive delegation on 2026-10-13 after reviewing official OpenClaw,
Hermes, OpenAI and Anthropic patterns. See the approved
[spec](../specs/2026-10-13-adaptive-delegation.md), DEV-1019.

## Decision

Use void-orchestrate as the single portable delegation policy, selecting native
capabilities before optional presentation and isolating writes rather than every agent.

This supersedes the named predecessor only where it requires Herdr for new durable
work or unconditionally applies Herdr discovery. Its central file schema, ownership,
identity checks, Codex no-daemon options under Herdr, native receipt integrity,
review/merge gates and legacy collection remain binding when applicable.
No old run is relaunched or reinterpreted. In particular, no kernel transport is restored.

The coordinator owns intention, human dialogue and acceptance. Children receive
bounded briefs and relevant context; one writer owns a coherent change unit through
corrections. Native events or bounded waits collect actual results. Formal specialists
retain their exact envelopes and permissions; ordinary research has no fake receipt.
Missing mandatory isolation or independent review is visible, never silently relaxed.

## Consequences

Positive:

- Consumers can delegate research and substantial implementation without Herdr.
- The user keeps one contact while investigations preserve the main context.
- Worktrees protect concurrent authors without multiplying for read-only research.

Negative:

- Instructions cannot create absent runtime capabilities or enforce a global quota.
- Native-only sessions may not survive interruption; saved work and delivered results
  are separate claims, each requiring evidence.
- Behavioral probes are needed in addition to static instruction-contract checks.

## Alternatives considered

- **Always delegate every task:** rejected because trivial and tightly coupled work
  pays avoidable context/coordination overhead.
- **Keep Herdr mandatory:** rejected because consumer execution must be portable;
  presentation is optional and cannot confer permission or persistence guarantees.
- **Build a recursive global scheduler now:** rejected because it duplicates runtime
  ownership before the lighter policy has shown a measurable limitation.

## Reversal cost

Low for workflow policy: revert caller composition and managed instruction wording.
Existing schemas, sessions and permissions do not migrate. A future scheduler or
new transport would need its own design and evidence.
