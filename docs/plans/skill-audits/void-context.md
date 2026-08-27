---
skill: void-context
status: reviewed
strategy: distill
target_loc: 230
phase: B
depends_on: []
composes_with: [debug, plan, superpowers:dispatching-parallel-agents, superpowers:subagent-driven-development]
matrix_row: plans/skill-decision-matrix.md#context
audit_date: 2026-08-27
auditor: Folpe + Claude Opus 4.8
---

# Skill audit: `context`

## Need

Without this skill, an agent treats the context window as free scratch space and lets it rot: it runs one giant "kitchen-sink" session across unrelated tasks, stacks correction after correction when a fix fails, reads twenty files in the main window to answer one question, and keeps all task state in the conversation. The result is silent quality decay — dropped constraints, repeated questions, contradicted decisions — with no error to flag it. This skill makes context a managed budget: clear between subjects, reset after two failed corrections, compact long threads, delegate exploration to fresh-context subagents, and persist durable state on disk so a reset loses nothing.

## Decision matrix anchor

(Row not yet present in `plans/skill-decision-matrix.md`; to be added by the matrix owner — this audit does not edit the shared matrix.)

- **Wins**: deciding when to `/clear` vs `/compact`, when a correction loop must be reset, when to push investigation into a subagent, where task state must live (disk vs conversation).
- **Loses to**: `plan` for the actual plan structure (this skill only mandates that the plan lives on disk); `debug` for the investigation method itself (this skill only says do it in a subagent).
- **Cannot decide**: the substantive content of a task; which subagent to dispatch for a given domain (that is the consumer's routing call).
- **Composes with**: `debug`, `plan`, subagent dispatch (`superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development`).

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Claude Code best practices (context) | https://www.anthropic.com/engineering/claude-code-best-practices | read | kept (`/clear` between tasks, `/compact`, subagent delegation) |
| Effective context engineering for AI agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | read | kept (context as finite attention-competing budget; subagents return distilled conclusions) |
| Boris Cherny / Cat Wu interviews | Latent Space / Claude Code podcast appearances | skimmed | kept (framing: "context is the fundamental constraint"; subagents protect the main window) |
| get-shit-done / Ralph autonomous loops | community practice | skimmed | kept (anti-context-rot: decompose + persist state on filesystem so work survives a reset) |
| superpowers/dispatching-parallel-agents | superpowers/skills | composed | wrapped as vendored target for fan-out investigation |
| superpowers/subagent-driven-development | superpowers/skills | composed | wrapped as vendored target for subagent-run plan steps |

## Adaptation strategy

`distill`. Extract the load-bearing principles from the official Claude Code context guidance and the creators' "context is the fundamental constraint" framing, plus the anti-context-rot / on-disk-state principle from autonomous-loop practice. Rewrite for void-harness. This skill absorbs the "context-engineering / anti-context-rot" concept so no separate skill is needed for it.

## What we keep (verbatim or near-verbatim)

- **`/clear` between unrelated tasks** (Claude Code best practices). Kitchen-sink session is the named anti-pattern.
- **`/compact <focus>`** for long coherent sessions (Claude Code best practices). Keep the named thread rather than a generic digest.
- **Delegate heavy investigation to subagents with fresh context** (best practices + creators' framing). The subagent returns the conclusion, not the raw material; this protects the main window.
- **Context is a finite, attention-competing budget** (effective-context-engineering). Everything in the window competes; the irrelevant majority degrades the relevant minority.

## What we adapt

- **The two-correction reset rule**: changed from a general "don't over-correct" sentiment to a concrete trigger — after exactly two failed correction attempts, `/clear` and re-prompt with a single reformulated statement folding in what the failures taught. Why: a countable trigger is enforceable behavior; vague advice is not.
- **Anti-context-rot → on-disk state mandate**: adapted from autonomous-loop practice into a survivability test — "if you `/clear` now, can the next session resume from disk alone?" Why: gives the principle a binary check rather than a vibe, and ties it directly to `plan`.
- **Signal table**: adapted the diffuse "watch for degradation" advice into a signal → meaning → move table. Why: makes the skill actionable at the moment of degradation rather than retrospectively.

## What we reject

- **Hard turn/token thresholds for auto-clearing** ("clear every N messages"): rejected. A configured reliable window may trigger one advisory checkpoint nudge in the healthy 40–60% band, but the harness never infers a denominator and never invokes `/clear` or `/compact`.
- **A bespoke context-budget framework / DSL**: rejected per anti-bloat rule 5. The moves are native commands (`/clear`, `/compact`) plus subagent dispatch; no machinery to build.
- **Duplicating the investigation method**: rejected. The skill says investigate in a subagent; the method itself stays in `debug`.

## Hard rules surfaced by this skill

- **`/clear` between unrelated tasks**. Enforced by: SKILL.md guidance + the kitchen-sink anti-rule.
- **No third correction after two failures — reset and reformulate**. Enforced by: SKILL.md two-correction reset rule.
- **Durable task state lives on disk, not only in conversation**. Enforced by: SKILL.md survivability test + composition with `plan`.
- **Heavy exploration is delegated to a fresh-context subagent**. Enforced by: SKILL.md operating procedure step 2.

## Modes (if applicable)

No strict/souple split. The skill is a single behavioral discipline; the four moves are selected by situation (subject change → clear, heavy-but-coherent → compact, exploration → subagent, loop → reset), not by a mode flag.

## Companion hooks

The shared `context-continuity` handler reads at most 1,048,576 transcript bytes per invocation,
tracks bounded working-set facts, preserves its delimited block on `PreCompact`, and can emit one
configured threshold nudge per cycle. It does not infer subject changes, author semantic residue,
or invoke `/clear` or `/compact`; those behavioural decisions remain with this skill and
`void-checkpoint`.

## Composition with other skills

- **`debug`**: investigation runs in a subagent that returns the timeline + root cause, not every log read; protects the main window.
- **`plan`**: owns approved execution structure; mutable progress stays with the declared provider.
- **`checkpoint`**: owns semantic session residue while the hook owns only the delimited mechanical block.
- **`superpowers:dispatching-parallel-agents`** (vendored target): fan-out investigations to keep the main window clean.
- **`superpowers:subagent-driven-development`** (vendored target): independent plan steps run in fresh-context subagents.
- Shared state is avoided: programme, provider, checkpoint, ADR, and doctrine facts each keep one owner.

## Anti-rules (what this skill MUST NOT do)

- MUST NOT run one giant session across unrelated tasks.
- MUST NOT stack a third correction after two failed attempts.
- MUST NOT keep task state only in the conversation.
- MUST NOT do heavy multi-file exploration in the main window when a subagent can return the conclusion.
- MUST NOT treat "no error" as "context is healthy."

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 230 LOC (hard cap 400, anti-bloat target ≤ 280)
- [ ] Frontmatter `description` ≤ 200 chars, trigger-phrased ("Use when..."), precise for auto-discovery
- [ ] `.source` file lists Claude Code best practices + effective-context-engineering + creators' framing + autonomous-loop anti-rot + the two superpowers composed targets, with URLs
- [ ] `## Rationalizations` table present
- [ ] `## Verification` section present
- [ ] Matrix row added in `plans/skill-decision-matrix.md#context` (by matrix owner — not edited in this PR)
- [ ] No overlap > 30% with `debug` (this skill says "do it in a subagent"; that skill owns the method)
- [ ] No overlap > 30% with `plan` (this skill says "state on disk"; that skill owns plan structure)
- [ ] Sister-doc parity: AGENTS.md flavor matches (Codex terminology for `/clear`/`/compact` equivalents)
- [ ] Audit status moved from `draft` → `reviewed` after user review

## 2026-08-27 mechanical continuity review

The Claude Code and Codex hook contracts were verified from their official documentation before
implementation. Neither runtime exposes a reliable window size or lets a hook invoke `/clear` or
`/compact`. The shipped mechanism therefore uses only explicit project configuration for the first
denominator, remains advisory at the threshold, and treats `PreCompact` as the sole pre-loss write
boundary. Prime-agent inspired only the bounded cumulative read/modified lists; its semantic
summary was not copied.
