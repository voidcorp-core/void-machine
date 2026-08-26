---
name: void-ticket
description: Use when turning a finished brainstorm, plan, or design decision into a tracker ticket. Triggers on creating a ticket or issue, logging work, or breaking an approved spec into tickets.
---

# ticket

A ticket an implementation agent can execute with zero follow-up questions. It does NOT invent scope: it ingests what was already decided (the brainstorm, the plan, this conversation, the relevant ADR) and renders it as a complete, estimated, labeled work item in the tracker. Downstream, `void-implement` executes it.

**Core principle:** the ticket is the contract between the thinking and the building. Every required slot is filled or the ticket is not ready. Estimate and labels are not optional metadata, they are how the backlog stays pilotable.

**Attribution**: see `.source`.

---

## When to invoke

- After `void-brainstorm` or `void-plan` produced a decision or spec, to capture it as trackable work.
- When the user says create a ticket, log this, or break this into tickets.
- Always writes to the project's tracker (Linear / Jira / GitHub / ...). On a project with a fixed tracker, team, and label conventions, use them and do not re-ask.

Do NOT use this to execute a ticket (`void-implement`) or to sequence many steps (`void-plan`).

---

## Ingest first, do not invent

Pull from what already exists, in order: the approved spec/plan, the brainstorm decisions, this conversation's decisions, the applicable ADR(s), the code conventions. The ticket RECORDS decisions already made. If a load-bearing decision is missing, go get it or flag it. Do not guess scope into existence.

A `docs/specs/*.md` spec with `source: forge` in its frontmatter (the forge→harness artifact contract) is a first-class source: its 18 recon variables, winning design, and critique verdict already answer scope, persona, and constraints — ingest them, do not re-ask. A partial forge spec (missing critique, or an older `forge_version` field) is ingested for what it has, with the gaps listed as the ticket's open questions.

---

## The ticket: required slots

Render into the tracker description. Every slot is REQUIRED unless marked optional. A missing required slot means the ticket is not ready.

- **Title**: `[Verb] [Subject]`, imperative.
- **Context**: why it exists; link to the broader goal / spec / ADR.
- **Scope**: in scope / out of scope.
- **Technical specs**: files and packages touched, applicable ADR, conventions and patterns to follow, third-party docs to ground in. Exhaustive enough that no unknown remains.
- **Acceptance criteria**: objectively verifiable checkboxes.
- **Definition of Done**: tests written and green, 0 lint / type errors, 0 regressions, plus ticket-specific items.
- **Edge cases and gotchas**: boundary behaviors, error / empty / loading states, failure modes. This is the all-angles slot; an empty one means angles were missed.
- **TDD mode**: defer to `void-tdd`'s path-based auto-selection; note an explicit override to strict only for a business-critical surface (auth, payments, security, money).
- **Runner passes that apply**: which `void-implement` conditional passes you expect to fire (architecture? migration safety? async/idempotency? E2E? UX/UI? deep security?). This is an accelerator HINT, not authoritative: the runner still evaluates every predicate itself and may add passes you did not list.

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

Native tracker fields (REQUIRED, set the real field, not prose):

- **Estimate** (points / size). Never leave empty.
- **Labels** (at least one; reuse existing, create if genuinely new).
- **Parent epic / project** link.
- **Dependencies** (`blockedBy`) in the native field, not just text.
- **Priority**.

---

## Multi-ticket programme handoff

After creating a complete pool of two or more tickets intended to run across sessions, create
`.void/program.md` in the same change. Do this only after the plan and ticket pool are
human-approved and every native dependency is saved. A single standalone ticket does not need a
programme descriptor.

Use tracker-agnostic routing frontmatter:

```yaml
---
schemaVersion: 1
status: executing
program: <stable-program-slug>
plan: <repository-relative-plan-path>
spec: <repository-relative-spec-path>
progress:
  provider: <adapter capability id>
  scope: <native workspace/project/repository query>
  order: [<ordered immutable work-unit identifiers>]
  states:
    ready: [<native ready states>]
    started: [<native started states>]
    review: [<native review states>]
    done: [<native completed states>]
humanGates: [<ticket identifiers requiring explicit approval>]
autopilot:
  schemaVersion: 1
  enabled: <true | false>
  mergeGate: human
---
```

The body states that the plan supplies global intent, the complete provider-native record is the
executable unit, native blocker relations decide readiness, and `void-implement` owns the per-unit
lifecycle. `progress.order` is the deterministic tie-break among simultaneously ready units; it is
scope, not mutable progress. Never store a current or next unit, copied status, assignee, or
completion checklist in the program or checkpoint.

The `void-autopilot` block is required, because consent to autonomous execution is never inferred from silence: a program that does not want it declares `enabled: false`. `mergeGate: human` is the only accepted value. Add `clusterSize` (1..4), `base`, `verifyCommands` (argv arrays, run with `shell:false`) and `ownership.sequential` / `ownership.reconcileOnly` only when the program enables autopilot.

Do not replace an unrelated executing programme. Stop and surface the collision. When the same
programme already has a descriptor, preserve its routing unless the user explicitly changes
programme scope. Automatic selection requires a provider adapter that can read and update status,
relations, assignee, comments, and review evidence; if those capabilities are unavailable, do not
claim automatic continuity.

---

## All-angles sweep before saving

Run a quick expert sweep so nothing is missed, then fold what surfaces into Edge cases or the applicable-passes slot:

- **Architecture**: boundaries, data model, public types.
- **Data / migrations**: schema change, backfill, zero-downtime (flags the runner's migration-safety pass).
- **Security**: trust boundary, untrusted input, tenancy.
- **Async / idempotency**: email, webhook, job, single-use token, replay (flags the runner's async pass).
- **QA**: edge / error / empty states, the end-to-end path.
- **UX**: if a UI surface is involved.
- **Perf / observability / docs**: cost, logging, doc updates owed in the same change.

This is the cheap insurance an expert team would not skip. It is what makes a ticket cover the angles the author would not have thought of alone.

---

## Sizing

Map T-shirt to the tracker's native scale: XS (<1h, trivial), S (1-3h), M (3-8h, minor unknowns), L (1-2d, real complexity), XL (>2d, split unless truly indivisible).

---

## Red flags: STOP, the ticket is not ready

| Rationalization | Reality |
|-----------------|---------|
| "I will add the estimate later" | Estimate is a required field. An unestimated backlog cannot be planned. |
| "Labels do not matter for now" | At least one label, always. Filtering and routing depend on it. |
| "The agent will figure out the edges" | The edge-cases slot is where all-angles coverage lives. Empty = angles missed. |
| "Scope is obvious from the title" | The implementation agent has none of this conversation. Spell it out. |
| "No parent, it is standalone" | Orphan tickets rot. Link the epic or project. |

A ticket missing a required slot or field is not done, however clear it feels.

---

## Composition

Upstream: `void-brainstorm` and `void-plan` produced the thinking (or a `source: forge` spec did — see "Ingest first"); this skill captures it. Downstream: `void-implement` consumes the ticket and the passes it declares. On a project, follow that project's tracker doctrine (team, project, label and estimate conventions) rather than re-deciding them here; this skill stays the harness-doctrine layer (ingest, required slots, runner handoff).
