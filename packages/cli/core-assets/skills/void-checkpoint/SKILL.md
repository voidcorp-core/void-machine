---
name: void-checkpoint
description: Write .void/machine/checkpoint.md before a clear, an interruption, or the end of a day, so the next session resumes without re-deriving anything. Keeps only what no other artefact holds.
---

# checkpoint

A session ends. The next one starts with an empty context and your name on the branch.

Everything you currently hold — why that approach was abandoned, which result is proven and
which is assumed, what you would have done next — evaporates in about a second. Reconstructing
it costs the next session an hour, and it usually reconstructs it wrong, because the cheapest
thing to recover is what you did and the most expensive is what you ruled out.

This skill spends five minutes to buy that hour back.

**Attribution**: see `.source`.

---

## When it fires

This is a **graceful shutdown**: the moment you deliberately stop, chosen by a human, not
guessed by a runtime. Three of them, and they are the ones that actually lose work:

- **Before a `clear`.** The context is about to be discarded on purpose. Whatever was only in
  it dies here unless it is written down first.
- **Before an interruption.** You are stopping mid-unit, and the reason you stopped is itself
  part of what the next session needs.
- **At the end of a day.** The gap is long enough that you will return as a stranger to your
  own work.

Two more, less common and just as valid: the context window is close to its limit and the work
continues afterwards, or the work is about to pass to another agent, machine, or person.

Do NOT fire when the work is genuinely finished and nothing is open: there is nothing to
resume, and a checkpoint written for a closed unit becomes a stale note nobody deletes.

---

## Step 0 — Route, before you write a word

The failure mode of every checkpoint is that it becomes a second copy of state that already lives
somewhere authoritative. Two copies of a fact means one of them is wrong within a day, and the
reader cannot tell which.

So the first move is triage. For every fact you are tempted to write down:

| The fact is… | It belongs in | Never in the checkpoint |
|---|---|---|
| Execution state — status, assignee, blockers, links | the declared **progress source** | a hand-maintained current or next unit |
| Global programme context, phase, plan and spec | **`.void/program.md`** | a session observation |
| What the code now does | the **diff and its commit messages** | a prose summary of the change |
| A durable rule, preference, or convention | **doctrine** (via `void-learn`) | a paragraph the next session must re-read forever |
| A design decision with a credible alternative | an **ADR** | a bullet that loses its reasoning |

What survives that filter is the checkpoint's actual subject: **the things no artefact holds** —
the dead ends, the unproven assumptions, the freshness of your evidence, and the exact next
move. That list is short. A checkpoint that is long has failed the triage.

If routing sends something to a shared owner, propose that write and get the required human
approval before applying it. When the owner is available, write it there **first**, then reference
it. A checkpoint that promises "I'll file this later" is where facts go to die.

---

## Step 1 — Write what nothing else holds

An argument passed with the invocation is what the human specifically wants carried
over. Cover it, but never let it stand in for the routing above: what they name is one
item of the residue, not the whole of it.

In this order, because it is the order the next session needs it.

**1. Where you are.** Branch, worktree, and whether anything is uncommitted. One line. If the
working tree is dirty, say exactly which files and why they were left that way
— an unexplained dirty tree reads as an interrupted edit and gets discarded.

**2. What is proven, and against what.** Not "tests pass". Which command, on which commit. A
proof is a claim about a specific tree; after a rebase or a dependency change it is a claim
about a tree that no longer exists. Say `pnpm verify green on a1b2c3d`, not `everything green`.
If you did not run it, say you did not run it.

**3. What you tried that did not work.** The most valuable and most often omitted section. For
each dead end: what you attempted, what actually happened, and why you stopped. Without it the
next session repeats it — confidently, because it looks like the obvious first idea. This is
the section to write even when it is unflattering.

**4. What you assumed.** Label every unverified belief as unverified. "The adapter probably
caches" and "the adapter caches, confirmed in `cache.ts:88`" are different claims, and a
checkpoint that flattens them costs half a day. If an assumption is load-bearing, say what would
falsify it.

**5. What is open.** Blockers, decisions waiting on a human, questions with no answer yet. Each
one with who or what unblocks it.

**6. The next action.** Exactly one, exact enough to execute: a command to run, a file and line
to open, a specific question to ask. "Continue the ticket" is not a next action. "Run
`pnpm vitest run x.test.ts`; it fails on the third case because the fixture has no `id`" is.
This is the first physical move for the next session, never a duplicated current or next unit and
never a priority decision.

---

## Step 2 — The freshness rule

Anything time-relative rots the moment you write it. Convert as you go:

- "yesterday", "last week", "recently" → the absolute date.
- "the latest version" → the version.
- "the new file" → the path.
- "he said" / "as discussed" → who, and what they said.
- "it" and "that" with no antecedent in the same sentence → name the thing.

The reader is a stranger with your permissions and none of your context. Write for them.

---

## Step 3 — Test it before you close

Read what you wrote as if you had never seen this work. Then:

1. **Can a stranger take the next action without asking a question?** If not, the next action is
   not specific enough.
2. **Does any line duplicate the progress source, program, diff, or doctrine?** Delete it and link instead.
3. **Is every claim either proven-with-evidence or labelled as an assumption?**
4. **Would someone reading only this repeat one of your dead ends?** If yes, the dead end is
   missing or too vague.
5. **Does it contain a secret, a token, a full prompt, or private source?** Then it does not
   get written anywhere shared. Redact and reference.

A checkpoint that fails any of these is not shorter than one that passes — it is longer, and wrong.

---

## Where it is written

Write the session residue to **`.void/machine/checkpoint.md`**. This is the canonical local
checkpoint consumed by `ResumeBundle`; REPLACE it each time rather than appending. It answers one
question: *what was happening just before the stop*. It lives under `machine/` and is NOT
committed because it describes one machine at one moment.

The checkpoint has no network dependency. If the declared progress source or provider is
unavailable, record that unresolved gap when it matters and still write
`.void/machine/checkpoint.md`. Do not turn an unavailable provider into a reason to lose the
session residue.

`.void/program.md` remains the versioned global view: programme identity, plan, spec and optional
progress locator. The program and checkpoint never store a current or next unit. Mutable progress
stays with the declared provider; the checkpoint's exact next action is only a local physical
resume move.

One destination per fact. If you cannot decide, the fact probably failed Step 0.

### The checkpoint's shape

`##` sections, any subset, read leniently. Frontmatter carries `date`, `branch` and `head`; branch
and HEAD bind the evidence to the tree it describes, and `resume` reports when either moved.

```markdown
---
date: 2026-08-17
branch: folpe/dev-621-resume
head: a1b2c3d
---

## Objective        What this session was for. One line.
## Position         Where that sits in the arc - what is done, what remains.
## State            What is proven, and against which commit.
## Next action      Exactly one, exact enough to execute.
## Open loops       - one per line
## Dead ends        - what was tried, what happened, why you stopped
## Assumptions      - each labelled unverified
## Working set      - the paths that were in hand
```

Position is the section people skip and then miss: returning after days, *how far along is this*
is a different question from *what was I doing*, and nothing else in the repo answers it.

Write it with `void-harness resume` in mind — that command reads this file, and reading your own
checkpoint back is the cheapest test of whether it was worth writing.

Before every semantic rewrite, read the current file and preserve the single delimited mechanical
block from `<!-- void-harness:context-continuity:begin -->` through its matching end marker
byte-for-byte. Require exactly one mechanical block; refuse the rewrite when more than one block
exists or either marker is ambiguous.
The lifecycle hook owns that block; this skill owns every semantic section around it.

---

## HITL

This skill proposes shared writes; the human decides. The local checkpoint is the requested
shutdown artefact. Do not move provider state as a side effect of closing a session — a session
ending is not a unit completing. Never write a checkpoint that claims work is done when it is
merely stopped.

**The hook boundary.** `UserPromptSubmit` detects explicit close intent and can remind the model to
invoke this skill before the closing response. `SessionEnd` can only audit checkpoint presence,
freshness, branch and HEAD after the model is gone. Both stay advisory. `PreCompact` may preserve
only the delimited mechanical block before known context loss. Hooks never invent or change dead
ends, assumptions or a next action. A command such as `/clear` can still bypass the prompt hook;
invoke this skill first.

---

## Red flags

| Rationalization | Reality |
|---|---|
| "I'll remember this tomorrow" | You will remember what you did. You will not remember what you ruled out, which is the expensive half. |
| "The diff explains it" | The diff explains the change. It never explains the three approaches that came first. |
| "I'll write the checkpoint when I actually need it" | You need it precisely when you can no longer write it. |
| "Let me summarize the whole session" | A narrative of what happened is not a plan for what is next. Route, then write the residue. |
| "Everything is green" | Green against which commit, from which command? A stale proof is worse than no proof, because it is trusted. |
| "The progress source says it all" | Then keep the checkpoint to the local residue, but verify that the provider really carries mutable status and blockers rather than assuming it does. |
| "I'll note the dead end if it comes up again" | It comes up again in the next session, as a fresh idea, and costs the same hour twice. |

---

## Composition

Upstream: whatever produced the work. Adjacent: `void-learn` takes durable rules out of the
session; `void-decide` takes structural choices. Downstream: `ResumeBundle` composes the programme,
this checkpoint and Git into the context read by the CLI and both runtimes.
