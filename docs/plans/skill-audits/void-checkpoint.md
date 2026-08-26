# Skill audit — `void-checkpoint`

> Renamed from `session-handoff` on 2026-08-18: the skill and the file it writes
> now carry the same word, so the link needs no documentation.

Original to void-harness. Written from a failure observed repeatedly in this repository, not
adapted from an upstream skill. The nearest external relative is gstack's `/context-save`, from
which only half the idea survives.

## The failure it targets

A session ends. The next one reconstructs the state from the diff, the tracker and the branch
name. It reconstructs *what was done* accurately, because that is written down, and it
reconstructs *what was ruled out* not at all, because nothing records it. So it re-attempts a
dead end — confidently, since it presents itself as the obvious first idea — and pays the same
hour twice.

The corollary is that the expensive half of a session's knowledge is exactly the half no
artefact captures. A handoff whose job is to summarise the session therefore adds noise while
missing its actual subject.

## The load-bearing decision: route before writing

The failure mode of every handoff document is becoming a second copy of state that already
lives somewhere authoritative. Two copies of a fact means one is wrong within a day and the
reader cannot tell which.

So Step 0 is a routing table, not a template. Execution state goes to the tracker; what the code
does is in the diff; durable rules go to doctrine through `void-learn`; cross-session
facts go to memory; a decision with a credible alternative becomes an ADR. What survives that
filter is the handoff's real content — dead ends, labelled assumptions, proof freshness, one
exact next action — and that residue is short.

This generalises the rule `.void/program.md` states for this repo's programme: the declared
progress provider owns mutable execution state, and the durable file never stores a hand-maintained
"next unit". The skill applies the same discipline to everything a session is tempted to write down.

## What was rejected

- **A symmetric save/restore pair** (gstack `/context-save` + `/context-restore`). Restoring is
  not a skill's job here. The next session reads the tracker and the memory, which are
  authoritative; a restore file would duplicate them and would be trusted while stale. Only the
  closing half is kept.

- **An automatic hook on session end.** Tempting, and refused for the reason `void-learn`
  already documented for its own Stop nudge: a stop event cannot distinguish an interruption
  from a context limit from a completed turn. A handoff written on a false positive is
  authoritative and describes a moment nobody chose, which is worse than no handoff. The trigger
  stays the human, or the model's own reading of the conversation.

- **A session narrative.** "What happened, in order" is pleasant to write and nearly useless to
  read: it duplicates the commit messages, ages badly, and buries the next action at the bottom.
  The skill's ordering is the reader's need, not the writer's chronology.

- **Moving tracker state as a side effect of closing.** A session ending is not a unit
  completing. Conflating them is how a stopped ticket ends up marked done.

## What is new

- **Proof freshness as a handoff property.** Lifted from this repository's own reconciliation
  work (`proof-invalidation.ts`, DEV-464): a verification is a claim about a specific tree, and
  reusing it after a rebase asserts something about a tree that no longer exists. A handoff
  sentence has the same property, so "everything green" is refused in favour of the command and
  the commit it was green on.

- **Explicit assumption labelling.** "The adapter probably caches" and "the adapter caches,
  confirmed in `cache.ts:88`" are different claims. Handoffs routinely flatten them, and the
  next session spends half a day on the difference. Load-bearing assumptions must also say what
  would falsify them.

- **A falsifiable exit test.** Five questions, each of which can actually fail — most notably
  "can a stranger take the next action without asking a question?" and "would someone reading
  only this repeat one of your dead ends?". A checklist that cannot fail is decoration.

## Boundary with `void-learn`

`void-learn` extracts what outlives the unit of work: a rule, a preference, a harness gap.
`void-checkpoint` handles what does not outlive it but is still needed tomorrow morning. They
compose in one direction: capture the durable lesson first, then hand off the residue. A lesson
left in a handoff is a lesson the next session must re-read forever.

## Boundary with `void-retrospective`

`void-retrospective` looks back across a window of work to change how the team operates.
`void-checkpoint` looks forward across a single boundary to let one unit continue. Different
horizon, different reader, different output — no overlap to police.

## 2026-08-26 — programme and advisory-hook alignment

The original audit coupled routing to a tracker plus memory and rejected an automatic SessionEnd
writer. The semantic rejection still stands; the ownership vocabulary changed:

- `.void/program.md` owns versioned global context and an optional opaque progress locator;
- the declared progress provider owns mutable unit state when its adapter is available;
- `.void/machine/checkpoint.md` is always written locally for open session residue, even offline;
- `ResumeBundle` composes programme, checkpoint and Git for both runtimes and the CLI;
- `UserPromptSubmit` only reminds on explicit close intent, while `SessionEnd` only audits. Neither
  hook writes semantic state or calls another model.

Rejected: storing a current or next unit in either durable file, blocking a local checkpoint on
provider availability, or treating a session close as completion.
