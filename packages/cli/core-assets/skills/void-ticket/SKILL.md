---
name: void-ticket
description: Use when turning a finished brainstorm, plan, or design decision into a tracker ticket. Triggers on creating a ticket or issue, logging work, or breaking an approved spec into tickets.
---

# ticket

A ticket an implementation agent can understand and execute within the agreed scope. It does NOT invent scope: it ingests what was already decided (the brainstorm, the plan, this conversation, the relevant ADR) and renders it as a complete, estimated, labeled work item in the tracker. Downstream, `void-implement` executes it.

**Core principle:** the ticket is the contract between the thinking and the building. State the goal, acceptance and constraints clearly. Native sizing, useful classification and milestones make the backlog pilotable; routine investigation remains with the writer.

**Attribution**: see `.source`.

---

## When to invoke

- After `void-brainstorm` or `void-plan` produced a decision or spec, to capture it as trackable work.
- When the user says create a ticket, log this, or break this into tickets.
- Always writes to the project's tracker (Linear / Jira / GitHub / ...). On a project with a fixed tracker, team, and label conventions, use them and do not re-ask.

Do NOT use this to execute a ticket (`void-implement`) or to sequence many steps (`void-plan`).
This skill is not a prerequisite for an explicit user request with clear acceptance criteria;
create tracker work only when requested or required by the authorized scope.

---

## Ingest first, do not invent

Pull from what already exists, in order: the approved spec/plan, the brainstorm decisions, this conversation's decisions, the applicable ADR(s), the code conventions. The ticket RECORDS decisions already made. If a load-bearing decision is missing, go get it or flag it. Do not guess scope into existence.

A `docs/specs/*.md` spec with `source: forge` in its frontmatter (the forge→harness artifact contract) is a first-class source: its 18 recon variables, winning design, and critique verdict already answer scope, persona, and constraints — ingest them, do not re-ask. A partial forge spec (missing critique, or an older `forge_version` field) is ingested for what it has, with the gaps listed as the ticket's open questions.

---

## Admission: a finding earns its place or it is dropped

Most of what reaches this skill is not a decision someone made, it is a defect someone
*noticed*. Those arrive without end, because reading code always finds another inconsistency,
and each one is defensible on its own. A backlog that admits them all stops being pilotable, and
the objective recedes while every individual step looks correct.

So a noticed defect is not admitted on its merits. It is compared against **the unit being built
right now**, judged against the approved objective, and there are three outcomes and one
slot:

1. **It blocks the current unit** — it is fixed inside that unit. No ticket.
2. **It beats the current unit** — it becomes the next unit, and nothing else starts until it is
   disposed of.
3. **It loses** — it is dropped. Not filed, not deferred, not "kept for later".

Dropped means lost, and that is the point. A genuine defect is rediscoverable by construction:
a skill that lies will lie to the next reader, and a run will trip on it again. The only thing
ever written down is **evidence that cannot be reconstructed** — a failure observed once, a
measurement — as one line carrying the command that replays it. Never the opinion, never the
proposed fix, because describing the fix is how a finding smuggles in a design.

Two things are not admissible at all:

- **A reading nobody asked for.** What you noticed in a file you were not convened on does not
  become work. If it matters, it will be found again by someone who was asked.
- **An ambition claim.** "This would be tenfold better" belongs to `void-brainstorm`, on a named
  subject, deliberately. During execution it is an escape hatch, and it is the one that grows
  plans.

State the comparison out loud when you drop something: what you found, and what it lost to. One
line. An arbitration nobody can see did not happen.

**Prose incoherence is a first-class defect**, in four forms: inside one skill, between two
skills, between the user's stated demand and a skill, and between a skill and the code it
describes. The last is this repository's repeat offender. It still goes through the comparison
above like anything else.

See the decision on a finding entering only by beating the work in progress.

---

## Search the tracker before you write

The backlog already answered part of this. Query it on the **subject**, never on
the title you are about to write: DEV-591 was called "unstable test suite" and
DEV-561 "test contention" — no shared word, same question, three days apart.
Search several phrasings of the thing itself, and include **closed** tickets: one
closed because the approach was wrong is exactly the one not to reopen unchanged.

An overlap means reading that ticket **in full** before deciding, not its title.
What costs a day is not the duplicate, it is the reasoning that was in the first
one: DEV-561 had established that an intermittent test is a question nobody has
answered rather than noise to isolate, and DEV-591 recommended what it forbade.

Then exactly one of two things, and creating in silence is neither:

- **enrich the existing ticket**, when the subject is the same;
- **create, linked, naming the difference** in one sentence, when the scope is
  deliberately disjoint.

Never merge two tickets on your own: a resemblance is not an identity, and that
call is the human's. Say what you searched and what came back — a search nobody
can see did not happen. If the tracker is unreachable, say so and keep writing;
a handoff blocked on a lookup is worse than a duplicate.

Thirty results means the terms were too broad, not the backlog too large.

---

## A complete, proportionate ticket

Use the project's template when useful. State the goal, relevant context, observable acceptance
and Definition of Done, with constraints, known dependencies and useful references. Link existing
specifications instead of repeating them; state essential information directly when unavailable.
Include edge cases and technical detail that affect the result. Ordinary investigation and local
implementation choices stay with the writer. Do not require every generic subsection, predict
all implementation passes or repeat a TDD label to make a ticket ready.

### Close the link, both ways

A ticket that cites its spec is half a link. Do both, in the same change:

1. The ticket body opens with the paths of the spec and the plan it comes from.
2. The `ticket:` field in each of those two files' frontmatter is filled with the
   tracker id just created.

Neither direction is optional, because each answers a question the other cannot.
From the ticket, the reasoning: why this shape, what was rejected, which
trade-off was taken. From the spec, whether the thinking was ever executed and
where it landed. A spec with no ticket is a decision nobody carried out, and
nothing says so today.

The asymmetry is deliberate and worth keeping in mind: the spec and the plan
live in the repository because they belong to the project and must survive the
tracker, while the ticket is execution state and is mutable by nature. Copying
the reasoning into the tracker would put it where a workspace change can lose
it; copying the status into the repository would give it two owners. Only the
link crosses.

If the project has no tracker, say so and stop: there is no ticket to write, and
the spec plus the plan already hold what would have gone in it.

Native tracker metadata (use the real fields where available):

- **Estimate**: populate the existing native team T-shirt scale; do not change workspace configuration.
- **Type**: reuse useful existing type labels or equivalent native classification. Add labels only for actual filters/routing; preserve human holds and project taxonomy.
- **Parent epic / project and milestone** links where applicable; retain native milestone visibility.
- **Dependencies** (`blockedBy`) in the native field, not just text.
- **Priority**.

---

## Native milestone handoff

After an approved multi-ticket plan is materialized, keep its units and dependency relations in
the native project and milestone. That milestone carries the repository link to the approved
plan and decisions. Use existing native fields; no programme descriptor, extra index or service.
For a clear approved arrival, write its project and milestone membership and read it back.
Preserve human priorities and assignments. An ambiguous arrival remains visible and non-admitted;
independent authorized work continues. A provider failure stops only dependent operations.

Automatic selection additionally requires explicit config authority described in
`docs/AUTOPILOT-AUTHORITY.md`: `schemaVersion: 3`, boolean `enabled`, the existing
`progress.provider/scope/states` and all approved restrictions. Scope is the native project and
milestone locator, opaque to the kernel. Membership and checkpoint intent are not consent.
Do not create or migrate authority merely because tickets were created; old configurations and
historical programmes are preserved. No automatic priority rewrite or global reranking.

The orchestrator verifies complete ticket criteria, actual membership, blockers and holds through
native tools before passing observations to the kernel. Planned work in the checkpoint is a
modifiable intention, not remote state; removing it closes no ticket and deletes no worktree.

---

## Before saving and sizing

Check that the accepted goal, observable acceptance, material risks, dependencies and useful
references are clear. Apply technical and security detail proportionately to the affected surface.
Missing consequential decisions need resolution; an empty generic subsection does not prove a gap.

Populate the team's existing T-shirt estimate (XS/S/M/L/XL or its native mapping). It expresses
relative effort, complexity and uncertainty, not guaranteed duration. Split oversized work when
that makes execution and review clearer. Keep status, ownership, milestones and dependencies
truthful; avoid historical relabeling or a new taxonomy.

## Composition

Upstream: `void-brainstorm` and `void-plan` produced the thinking (or a `source: forge` spec did — see "Ingest first"); this skill captures it. Downstream: `void-implement` consumes the accepted task and evaluates applicable passes from the actual change. On a project, follow that project's tracker doctrine (team, project, label and estimate conventions) rather than re-deciding them here; this skill stays the harness-doctrine layer (ingest, clear acceptance, native metadata and execution handoff).
