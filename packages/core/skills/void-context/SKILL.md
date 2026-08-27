---
name: void-context
description: Context is the agent's core constraint. Use when a task spans many files, a session mixes subjects, corrections loop, or replies forget earlier constraints. Clear, compact, delegate to subagents.
---

# context — voidcorp craftsman edition

The context window is not infinite scratch space; it is the single fundamental constraint on an agent's reasoning. Everything in it competes for attention, and a polluted window degrades quality silently — the model does not announce that it forgot your earlier constraint, it simply drops it. This skill teaches you to treat context as a managed budget: clear it between unrelated tasks, compact it when long, delegate heavy reading to fresh-context subagents, and keep durable state on the filesystem so it survives any reset.

**Attribution**: see `.source`.

---

## Why context is the constraint

A long session accumulates dead weight: abandoned approaches, stale file dumps, three superseded versions of the same plan, two failed fix attempts. The model attends to all of it. The symptom is never an error — it is a slow rot: the agent re-asks a settled question, contradicts a decision made earlier, or "fixes" something already correct. By the time you notice, the window has been degraded for many turns.

So the discipline is proactive, not reactive. You manage the budget before it overflows, the same way you would not wait for an OOM to think about memory.

---

## The four moves

### 1. `/clear` between unrelated tasks

When you finish one task and start a logically separate one, run `/clear`. Carrying the first task's context into the second is the "kitchen-sink session" anti-pattern: nothing in the residue helps the new task, and all of it competes for attention. If work remains open, invoke `void-checkpoint` first: `/clear` has no pre-event, and the harness cannot preserve semantic residue after it is gone.

Rule of thumb: if the next task would not cite anything from the current conversation, clear first.

### 2. The two-correction reset

If two attempts to correct the agent both fail, **stop stacking a third correction**. Each failed correction adds confused context (the wrong attempt, your patch, the next wrong attempt) that makes the third try worse, not better.

Instead:

1. `/clear`.
2. Re-prompt from scratch with a single reformulated statement that folds in what the failures taught you ("X must handle the empty case, and must not touch the cache layer").

A clean window with a sharp prompt beats a dirty window with three patches. Correcting over and over is the most common way a session quietly rots.

### 3. `/compact <focus>` for long-but-coherent work

When a task is genuinely long and coherent (not mixed subjects, just big), do not clear — you would lose the thread. Run `/compact <focus>` to summarize the history down to what matters, naming the focus so the compaction keeps the relevant fil rather than a generic digest.

Use `/clear` when subjects changed; use `/compact` when the subject is the same but the history is heavy. The `PreCompact` hook preserves the bounded mechanical block before compaction; it does not invent dead ends, assumptions, or the next action.

### 4. Delegate heavy investigation to fresh-context subagents

Exploration is the biggest context sink: reading twenty files to answer one question dumps twenty files into the window, of which you needed two sentences. Push that work into a subagent with its own fresh context. The subagent reads broadly and returns only its conclusion; your main window receives the answer, not the raw material.

This is the cure for "infinite exploration," where the agent keeps reading more files in a widening search and the window fills with material it will never cite. Dispatch a subagent, state the question, accept the conclusion.

Vendored targets: `superpowers:dispatching-parallel-agents` (fan out several investigations at once) and `superpowers:subagent-driven-development` (run independent plan steps in subagents). Until vendored, use those directly.

A subagent must return a **compacted structured summary** — findings, the answer, the relevant file:line pointers — never the raw bytes it read. Raw output dumped back into the main window defeats the delegation.

---

## Frequent intentional compaction

Treat context usage like a gauge you keep in a healthy band, not a tank you fill to the brim. Aim to keep effective usage around **40–60%**; a window run to the limit reasons worse long before it errors.

- When `.void/config.json` declares a reliable `context.windowTokens`, the lifecycle hook can emit one `void-checkpoint` nudge per cycle at the configured 40–60% threshold (50% by default). Without that denominator it reports no percentage and emits no threshold nudge.
- After each verified phase, route durable programme and provider state to their owners, invoke `void-checkpoint` for session residue, then trim the chat. The disk is the durable record; the window is working memory.
- Compaction is a deliberate move you schedule, not an emergency you react to. Do it at clean boundaries (phase done, gate passed), where the summary is easy to write and nothing in flight is lost.

The hook never invokes `/clear` or `/compact`, and never writes a semantic checkpoint. Its nudge is advisory; the runtime and the agent still own those actions.

## Leverage hierarchy

Errors compound asymmetrically by stage. A bad research conclusion cascades into thousands of wrong lines; a bad plan into hundreds; a bad line of code stays mostly local and isolated.

So concentrate human review and verification **upstream**: research > plan > code. The cheapest place to catch a mistake is the research summary, the next-cheapest is the plan, and the most expensive is after it is coded. Spend scrutiny where leverage is highest, not evenly.

---

## Anti-context-rot: state lives on the filesystem

A long task must not keep its state only in the conversation, because the conversation is the thing you will reset. Durable state goes on disk:

- The versioned programme descriptor and its linked plan/spec, when a programme exists.
- Mutable execution state in the declared progress provider, never duplicated locally.
- `.void/machine/checkpoint.md` for session residue and the bounded mechanical working set.
- Durable decisions in ADRs and reusable rules in doctrine, through their owning skills.

The test: **if you `/clear` right now, can the next session pick up the task from disk alone?** If not, the state is trapped in the window and one reset will lose it. Write it down first.

Decompose long tasks into sub-tasks with their own gates (composes with `void-plan`). Each sub-task is small enough to run in a clean-ish window; the plan file stitches them across resets.

---

## Signs you must act

| Signal | What it means | Move |
|---|---|---|
| Reply forgets a constraint you set earlier | Window degraded; constraint scrolled out of effective attention | `/compact <focus>` or `/clear` + re-prompt |
| Two corrections in a row failed | Correction stacking; context now confused | two-correction reset (`/clear` + reformulate) |
| Subjects are mixing (the agent references the previous task) | Kitchen-sink session | `/clear` |
| Responses slowing / wandering, search widening | Infinite exploration, window bloated with file dumps | delegate to a fresh-context subagent |
| You are about to read many files to answer one question | Exploration sink | delegate to a subagent, take the conclusion |

---

## Operating procedure

1. **Before a new task**: is it related to the current one? No → checkpoint any open residue, then `/clear`. Yes → continue.
2. **Before heavy reading**: will this dump many files for a small answer? Yes → dispatch a subagent.
3. **During a long coherent task**: window feeling heavy but subject unchanged → `/compact <focus>`.
4. **On a stuck correction loop**: hit two failed corrections → `/clear`, reformulate the prompt with the lessons folded in.
5. **Throughout a long task**: persist plan + notes to disk so any reset is survivable.

---

## Rationalizations

| Rationalization | Reality |
|---|---|
| "Keeping everything in context is safer — I might need it." | The model attends to all of it; the irrelevant 90% degrades the relevant 10%. Keeping everything is the harm, not the safety. |
| "One more correction will fix it." | After two failures, the third inherits a confused window. A clean re-prompt wins. |
| "Clearing loses my work." | It loses semantic residue that was only in chat. Route state and invoke `void-checkpoint` first; then `/clear` has a durable recovery point. |
| "Reading the files myself is faster than dispatching a subagent." | Faster this turn, slower every turn after — those files now sit in your window forever. The subagent returns the conclusion, not the bytes. |
| "The session is fine, no errors." | Context rot produces no errors. It produces dropped constraints and repeated questions. Silence is not health. |
| "Compacting might drop something important." | Name the focus. `/compact <focus>` keeps the named thread; an unmanaged window drops things at random instead. |

---

## Composition with other skills

- **`void-debug`**: investigate without drowning the window — gather evidence in a subagent, bring back the timeline and root cause, not every log line read.
- **`void-plan`**: owns the approved execution structure; mutable progress remains with its declared provider.
- **`void-checkpoint`**: owns semantic session residue; the lifecycle hook owns only the delimited mechanical block it must preserve.
- **`superpowers:dispatching-parallel-agents`** (vendored target): fan out independent investigations to protect the main window.
- **`superpowers:subagent-driven-development`** (vendored target): run independent plan steps in fresh-context subagents.

This skill absorbs the "context-engineering / anti-context-rot" concept; other skills do the work, this one keeps the window clean enough for them to do it well.

---

## Anti-rules

- MUST NOT run a single giant session across many unrelated tasks — `/clear` between them.
- MUST NOT stack a third correction after two failed ones — reset and reformulate.
- MUST NOT keep task state only in the conversation — persist plan and notes to disk.
- MUST NOT do heavy multi-file exploration in the main window when a subagent can return the conclusion.
- MUST NOT treat "no error" as "context is healthy" — rot is silent.

---

## Verification

- [ ] Unrelated tasks are separated by a `/clear` (no kitchen-sink session).
- [ ] No correction stacked beyond two attempts without a reset + reformulation.
- [ ] Long coherent work was `/compact <focus>`-ed rather than left to bloat.
- [ ] Heavy investigation was delegated to a fresh-context subagent that returned only its conclusion.
- [ ] Programme, provider state, checkpoint residue, decisions, and doctrine are routed to their single authoritative owners before a reset.
- [ ] Open semantic residue is checkpointed before `/clear`; no hook capability is assumed beyond mechanical preservation and an advisory nudge.
- [ ] Acting on degradation signals before they compound, not after errors appear.

---

## Final rule

```
Context is the budget. Clear between subjects, reset after two failed corrections,
compact long threads, delegate exploration to fresh-context subagents, keep state on disk.
Otherwise → the window rots silently and quality drops with no warning.
```
