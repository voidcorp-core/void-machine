---
title: Adaptive native delegation across development workflows
date: 2026-10-13
status: approved
author: Folpe + Codex
ticket: DEV-1019
related:
  - 2026-09-28-supervised-agent-delegation.md
  - 2026-10-08-native-herdr-orchestration.md
---

# Adaptive native delegation

## Approval and objective

Folpe approved the conversational proposal with "ok go" on 2026-10-13 after
comparison with OpenAI, Anthropic, OpenClaw and Hermes Agent. This document records
that approved first slice; it does not approve a new scheduler, runtime or merge.
The user-facing coordinator retains intent and decisions. Independent substantial
research and implementation are delegated when native capabilities permit, across
brainstorm, plan, implement and autopilot, with or without Herdr.

## Observed baseline

Base: develop 446691befd3cb2a376b7884c4c32ac772aa06c94. The active root checkout
and its installed released skills are older; editing those would miss DEV-1017.
The shipped void-orchestrate owns native short contexts and durable Herdr workers.
Its recovery currently assumes Herdr and its short-agent instructions only describe
formal specialist envelopes. Brainstorm/plan do not explicitly request delegation.
Implement already has one lead writer and independent read-only specialists.
Autopilot owns separate ticket worktrees. The old agents kernel is collectible
legacy, not the launcher for this change. DEV-1016 owns operational Herdr proofs;
DEV-1014 owns Maestro/Cortex. This unit changes neither programme nor their scope.

## Contract

One policy owner: packages/core/skills/void-orchestrate/SKILL.md. Callers express
the task and preserve their own design, delivery and merge gates.

- Choose direct work for a tiny targeted change, a single tool call, mechanical
  processing, or tightly coupled work where delegation adds no useful separation.
- Explicitly delegate bounded independent research/exploration in brainstorm and
  plan. ORCH keeps the conversation, source evaluation and final decisions.
- In implement, the interactive coordinator delegates substantial implementation
  to one writer when supported. A writer already assigned the unit executes it;
  it never recursively delegates the same complete workflow. One lead writer per
  unit remains authoritative through corrections. Parallel feature slices must
  first have disjoint ownership, dependencies and integration acceptance.
- Brief every child with objective, relevant context/source revision, owned paths,
  permissions, acceptance, result format and bounds. New context is the default;
  a supported fork is selected only for a task requiring conversation history.
  Formal specialist envelopes/receipts remain unchanged; ad hoc research does not
  invent mission specialist events or independent-review evidence.
- Check actual native capabilities before transport selection. Native agents do
  not require Herdr. Durable-session claims require supported native capability.
  No agent capability permits honest sequential execution, except a mandatory
  independent review or isolation requirement must remain an explicit blocker.
- Read-only research needs no new worktree. Reviews bind an immutable exact
  subject. Concurrent authors use isolated assigned worktrees and disjoint work;
  isolation failure serializes work, never silently shares concurrent writes.
  Preserve shared Git and role permissions. Native worktree placement remains
  governed by the universal durable-path invariant.
- Count writer, research and review children together against observed available
  runtime slots and the coordinator's bounded dispatch. Autopilot's ticket cap
  and Orchestra's four-worker schema are unchanged. No global machine-wide quota
  is claimed. No recursive fan-out or repeated work in coordinator and child.
- Collect on native completion events when available; otherwise use bounded waits.
  A wait timeout is not failure. Reuse the same session for corrections and confirm
  consumption/result before claiming an instruction applied. Collect partial
  results/failures honestly and reconcile uncertain effects before retrying.
- Distinguish saved work, live session, retained result and delivered result. Neither
  a pane nor a report proves task completion or crash-resistant execution. Use the
  existing persistence path when selected, never invent a universal durable inbox.
- Herdr-specific discovery, central files, metadata and launch recipes are scoped
  to that optional adapter. No changes to other projects, servers or permissions.

## Acceptance and proof

1. Both generated runtime instruction blocks request applicable delegation through
   the same policy owner, without an unconditional Herdr requirement.
2. All five workflow callers resolve that owner. Skills remain below 400 lines.
3. Tiny direct task; independent research; already-delegated writer; missing native
   capability; missing isolation; unchanged independent review are covered by
   concrete contract checks and bounded native instruction probes.
4. Consumer generation/install checks prove distribution; static prose assertions
   are never reported as proof that an agent executed the behavior.
5. A fresh independent review and applicable repository gates pass before PR.

## Scope boundaries

This slice supplies portable executable instructions, distribution and evidence.
It does not add a global scheduler, durable event inbox, automatic tool interception,
recursive teams, live steering protocol, semantic model router, new transport,
permission/merge changes or global consumer updates. A speedup is not asserted
without comparable measurements. Later complexity must earn its place from use.

## Source distillation

- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://docs.openclaw.ai/tools/subagents/tool-reference
- https://docs.openclaw.ai/tools/subagents/slash-command
- https://docs.openclaw.ai/concepts/parallel-specialist-lanes
- https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation
- https://hermes-agent.nousresearch.com/docs/guides/delegation-patterns

Adapt focused briefs, selective parallelism and honest lifecycle distinctions.
Reject silent isolation fallback, nested budget multiplication and assuming an
agent's completed turn proves an accepted outcome. No upstream code is vendored.
