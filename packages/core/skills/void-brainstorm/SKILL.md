---
name: void-brainstorm
description: "Resolve a raw idea or consequential design ambiguity: inspect context, compare alternatives and record approved choices. Clear authorized implementation requests go directly to void-implement."
---

# brainstorm — voidcorp craftsman edition

Use this skill when intent, behavior or a consequential boundary remains undecided. Inspect the existing context, resolve the decisions that change the outcome, and record the approved design. `void-implement` owns applicability: a clear implementation request does not need a design interview.

**Attribution**: see `.source`. Primary source: superpowers/brainstorm; the upstream idea-pressure-test mode is the distilled `gstack:/office-hours` diagnostic, vendored for void-machine.

---

## Delegated investigation

For substantial independent research or codebase exploration, invoke `void-orchestrate`
to delegate bounded questions before synthesizing the options. The coordinator keeps
the user conversation, source evaluation, design decisions and the approval gate.
Research results do not authorize implementation.

## Step 0 — Notice that the exchange has become design

This skill was only ever reached when someone asked for it, which is the half of
the problem nobody was solving. Design does not usually announce itself: it
arrives in the middle of a conversation about something else, and by the time
anyone would think to invoke a skill the decisions have already been made and
lost. Three of the structural decisions in this repository on 2026-08-17 were
taken that way, written up afterwards from memory rather than from the exchange.

Engage the moment the conversation starts fixing any of these, without being
asked:

- **A behaviour is being settled.** What the system does in a case nobody had
  described yet, and the answer will outlive the conversation.
- **A boundary is being drawn.** What owns what, what may depend on what, where
  a responsibility stops.
- **A trade-off is being taken.** Two credible options are compared and one is
  chosen, especially when the losing one has real merit.
- **A name is being fixed** for a concept the codebase will carry, or a
  convention is being set that future work must follow.
- **The same design question comes back a third time** in one session. Returning
  to it means it was never actually settled.

Say what you noticed, in one sentence, and start the process at Step 1. Do not
ask for permission to think, and do not stop the work in flight: an exchange can
carry on while its design is being written down.

**Do NOT engage for**: a bug with one correct answer, a mechanical refactor, a
naming choice local to one function, or a preference with no consequence beyond
the file being edited. The bar is whether someone six months out would need to
know *why*. If they would not, this is not design, and invoking here would teach
everyone to skip Step 0 when it matters.

---

## Decision gate

Do not implement an unresolved choice that materially changes scope, safety, external effects
or a lasting contract. Present the decision and its trade-offs together, then obtain the needed
approval. Work that does not depend on it may continue.

For already authorized scope, do not request approval again merely because it has been written
into a spec or plan. The user's explicit request and accepted decisions are valid inputs.
A durable spec is useful for a structural or multi-step change; a mechanical fix or bounded
request may go directly to `void-implement` with its acceptance criteria.

---

## Ingesting a forge spec

If `docs/specs/` holds a spec with `source: forge` in its frontmatter (the forge→harness artifact contract), the up-front thinking is already done. **Verify and fill the gaps — do not re-ask what the spec already answers.** The 18 recon variables cover persona, pain, positioning, competition, pricing, and the visual identity; the winning design and critique verdict are attached. Read them, confirm they still hold, and ask only about what is missing (a partial spec — recon without critique, or a field absent in an older `forge_version` — is ingested for what it has, with the holes listed as the only open questions). Record the accepted scope and resolve only remaining choices. Do not restart the interview or approval from scratch.

## Pressure-testing a raw idea (upstream mode)

Runs ONLY when the input is a raw *product idea* ("I want to build X"), not an already-scoped feature or a `source: forge` spec (that thinking is done). Before designing the right solution, make sure it is the right *problem*. This is the distilled `gstack:/office-hours` diagnostic, vendored here. Ambition is pushed for every subject in Step 4b, not here. Once premises hold, resume the normal design process (Step 1 onward) in the collaborative voice; this adversarial posture is scoped to this mode only.

**Posture: diagnose, don't cheerlead.** Take a position on every answer and say what evidence would change your mind. No "interesting approach", no "that could work", no "you might consider" — say why it works or why it doesn't, and challenge the strongest version of the idea, never a strawman. The first answer is the polished one; push once, then again — the real answer comes on the second or third push. **Pre-empt the easy outs before they're used**: a waitlist signup is not "upset", interest is free, "people would love it" costs nothing. End every turn with one concrete assignment — a thing to go do or find out — not a question left dangling; and when the honest answer is "I haven't watched a real person struggle with this", name *that* as the finding, it is the most valuable output of the session.

**The six forcing questions.** Ask one at a time; push until the answer is specific, evidence-based, and a little uncomfortable. Route by stage — you rarely need all six: pre-product → Q1,Q2,Q3 · has users → Q2,Q4,Q5 · paying → Q4,Q5,Q6 · pure infra → Q2,Q4.

1. **Demand reality.** Strongest evidence someone would be genuinely upset if this vanished tomorrow — not "interested", not a waitlist signup. Push for a paying / expanding / workflow-dependent behavior. Red flag: "people say it's interesting", "500 signups".
2. **Status quo.** What are users doing to solve this today, even badly, and what does that workaround cost them? Red flag: "nothing exists" — usually the pain isn't sharp enough.
3. **Desperate specificity.** Name the actual human who needs this most — title, what gets them promoted or fired. Red flag: category answers ("healthcare enterprises"); you can't email a category.
4. **Narrowest wedge.** Smallest version someone would pay for *this week*, before the platform exists. Red flag: "we need the full platform first" — attachment to architecture over value.
5. **Observation & surprise.** Have you watched someone use it without helping — what did they do that surprised you? Red flag: surveys and demo calls (surveys lie, demos are theater).
6. **Future-fit.** If the world looks meaningfully different in 3 years, does this become more essential or less? Red flag: "the market grows 20%/yr" — every competitor cites the same tailwind.

**Respect the mandate.** If the user says to proceed, reuse known answers and make routine
reversible implementation choices. Ask only about a missing decision that materially changes
the outcome or requires separate authority; do not make the user repeat the instruction.

## Process

### Step 1 — Explore project context

Check the current state: existing files, `docs/`, recent commits, related specs in `docs/specs/`. If a similar spec exists, reference it. A `source: forge` spec is the strongest such reference (see "Ingesting a forge spec" above).

### Step 2 — Scope check (multi-subsystem decomposition)

If the request describes multiple independent subsystems ("build a platform with chat, file storage, billing, analytics"), flag this immediately. Help the user decompose into sub-projects:

- What are the independent pieces?
- How do they relate?
- What order should they be built?

Each sub-project gets its own spec → plan → implementation cycle. Brainstorm the first sub-project through the normal flow.

### Step 3 — Visual companion offer (optional, opt-in)

If upcoming questions will involve visual content (mockups, layouts, diagrams), offer the browser-based companion ONCE for consent. The offer is its OWN message — do not combine with clarifying questions.

```
"Some of what we are working on might be easier to explain if I can show it
to you in a web browser. I can put together mockups, diagrams, comparisons.
This feature is new and can be token-intensive. Want to try it? (Requires
opening a local URL.)"
```

Wait for the user's response. If they decline, proceed in text-only.

### Step 4 — Ask clarifying questions

- Ask only unresolved consequential questions; group closely related questions when it reduces interruptions.
- Multi-choice preferred when applicable (2–4 distinct mutually-exclusive options with brief descriptions and a recommended option labeled).
- Open-ended fine when no obvious options exist.
- Focus on: purpose, constraints, success criteria.

**Precision & grounding** (vendored from gstack `/spec`) — ambiguity is a bug; find it:

- **Read the code before asking.** Do not ask what you can read. Grep/read at least one real piece of evidence and cite `path:line` in the question. "Don't ask what you can read" beats an interview that ignores the repo.
- **Quantify.** "Several files" is not an answer — find the exact count. "Improves performance" is not a goal — state the metric and target.
- **Five "why" questions must be answered without hand-waving** before design: **who** is affected, the **verified current** behavior, the **desired** behavior, **why now**, and the **observable/measurable** done-signal.
- **Think in failure modes** as a first-class axis: empty / null / enormous / duplicated / wrong-role / called-twice.

### Step 4b — Push the ambition (the 10x move)

Runs on **every brainstorm, whatever the subject** — a product idea, a guard, a contract, a migration. Demand pressure-testing above belongs to a raw product idea, because a merge gate has no market to interrogate; ambition is not scoped that way, since timidity is not a property of product ideas. This pass lived inside the product-idea mode and therefore never fired on a technical subject, which is most of what gets designed here.

Before settling an unresolved design, consider whether a simpler or materially better approach
changes the outcome. Include an ambitious or lateral option only when it answers that question.
Do not expand an already accepted scope or reopen a completed decision to manufacture alternatives.
YAGNI prunes the options before asking the user to evaluate them.

### Step 5 — Propose 2–3 approaches

Present alternatives conversationally with trade-offs. Lead with the recommendation and the reason. Let the user redirect.

### Step 6 — Present the design

Once the intent is clear, present the design in sections:

- Architecture
- Components
- Data flow
- Error handling
- Testing approach
- Rollout / phases (if non-trivial)
- TDD mode per implementation phase (strict / souple / exploratory — composes with `void-tdd` skill)

Present related decisions together and obtain approval for the unresolved consequential choices. Do not request approval section by section for explanatory prose.

### Step 7 — Write the spec

Write to `docs/specs/YYYY-MM-DD-<topic>.md` and commit. Frontmatter:

```yaml
---
title: <topic>
date: YYYY-MM-DD
status: in-design  # → approved
author: <user> + Claude/Codex
ticket: <tracker id, once `void-ticket` has created it; leave empty until then>
related: [...]
---
```

`void-ticket` is half of a link that must exist in both directions. The spec is where
the reasoning lives and it belongs to the project, so it survives the tracker;
the ticket is execution state and is mutable by nature. Someone reading the
ticket has to be able to reach the reasoning, and someone reading the spec has
to be able to see whether it was ever executed. `void-ticket` fills this
field when it creates the ticket and puts the reverse link in the ticket body.

### Step 8 — Spec self-review pass

Read the spec with fresh eyes:

1. **Placeholder scan** — any "TBD", "TODO", incomplete sections, vague requirements? Fix.
2. **Internal consistency** — do sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check** — is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check** — could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix issues inline. No need to re-review — just fix and move on.

### Step 9 — Confirm unresolved choices

Link the written spec and identify any decision not yet authorized. Ask only about those
remaining choices. If it records decisions already approved in this conversation, proceed.

### Step 10 — Transition to execution

Use `void-plan` when dependencies, multiple units or later-session continuity need a durable
sequence. A bounded single unit with clear acceptance criteria goes to `void-implement`.

---

## Design principles

### Design for isolation and clarity

- Break the system into smaller units, each with one clear purpose.
- Communicate through well-defined interfaces.
- Each unit can be understood and tested independently.
- For each unit, answer: what does it do, how do you use it, what does it depend on?

Smaller, well-bounded units are easier to work with — easier for the agent to hold in context, more reliable edits.

### Existing codebases

- Explore current structure before proposing changes.
- Follow existing patterns.
- Improve adjacent code only where it serves the current goal (no unrelated refactor).

---

## Key principles

- Read the actual contract before asking what it says.
- Resolve a material ambiguity once; retain the answer through implementation.
- Keep KISS, useful boundaries and the smallest sufficient scope.
- Compare credible alternatives when they change the result, not for a fixed option count.
- Document lasting structural decisions through `void-decide`.
- Optional improvements do not reopen accepted scope or cause another review cycle.

---

## Composition with other skills

- **Raw product idea** ("I have an idea..."): pressure-test it first via the upstream mode above (the vendored `/office-hours` diagnostic), then design. Broader product *roadmap / strategy* routes to `void-plan-review` (CEO lens — challenges a written plan's premise and ambition).
- **Downstream**: `void-plan` for dependent work; `void-implement` for a bounded approved unit.
- **With `void-tdd`**: the spec declares the TDD mode for each major implementation step. Plans then uses this.
- **With `void-hexagonal-architecture` + `void-domain-driven-design`**: these skills inform the design's structure (bounded contexts, ports, aggregates). Brainstorming consumes their vocabulary; does not duplicate their decisions.
- **With `void-code-review`**: review against the accepted behavior and constraints; an absent spec alone is not a defect.

---

## Anti-rules

- Do not implement a consequential unresolved decision or infer external authorization.
- Do not restart discovery or approvals already resolved by the user's request.
- Do not widen product scope during implementation under the guise of ambition.
- Do not hide material uncertainty behind a complete-looking template.

## Final rule

Unresolved design → inspect → compare useful options → resolve consequential decisions →
record → plan only as needed → implement the accepted scope.
