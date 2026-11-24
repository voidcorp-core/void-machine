---
name: void-claude-md
description: Author a lean, runnable CLAUDE.md (or AGENTS.md). Only universal instructions; defer detail to docs; push style to linters and certainties to hooks. Use when writing or auditing a project CLAUDE.md.
---

# claude-md

A CLAUDE.md is not free documentation. Claude Code injects it wrapped in a system-reminder that says it "may or may not be relevant," and the system prompt already spends on the order of fifty instructions before yours arrive. Every line you add competes for the model's attention with every other line, so a bloated CLAUDE.md does not make the agent more careful — it dilutes the few instructions that actually matter and quietly buries them. This skill governs how the harness writes the CLAUDE.md files it ships into consumer projects: minimal, universal, runnable, with detail deferred and certainties mechanized.

**Attribution**: see `.source` in this directory.

---

## The load-bearing insight

The CLAUDE.md is appended to the system prompt with a "may or may not be relevant" framing. That framing is the whole game:

- It is **not** a contract the model must obey. It is context the model weighs.
- Attention is finite and shared. A 400-line CLAUDE.md does not give you 400 enforced rules; it gives you 400 things competing to be the one the model attends to this turn.
- So the question for every line is never "is this true?" but **"does this earn a slot against everything else here?"**

Target ~60 lines. Hard ceiling well under 150 instructions. If you are past that, you are not documenting — you are hoping.

---

## What belongs in CLAUDE.md

Only the **universal** and the **load-bearing**:

- How to run the project: build, test, dev server, the one command that proves the agent's change works.
- Repo-wide architecture in one or two sentences (where domain lives, where infra lives) — enough to orient, not a tour.
- Project-wide invariants that have no mechanical enforcer yet (a boundary no linter checks, a domain rule).
- Pointers to the docs that hold the detail (progressive disclosure, below).

That is most of it. A good CLAUDE.md is short because almost everything else has a better home.

---

## What does NOT belong (and where it goes)

| Tempting to inline | Why it does not earn its slot | Where it belongs |
|---|---|---|
| Code style, formatting, naming, import order | An LLM is a probabilistic stylist; a linter is deterministic. Never send an LLM to do a linter's job. | hooks / formatter / linter config |
| Code snippets / example implementations | They rot the moment the referenced code changes, and lie silently after. | a `file:line` reference to the real code |
| Anything that must happen 100% of the time | An instruction is obeyed *probabilistically*; a hook fires *always*. | a hook |
| Deterministic config: permissions, tool attribution, env | CLAUDE.md is read by a fallible reader; settings is read by the runtime. | `settings.json` |
| Long process docs, runbooks, deep architecture | Burns the budget for content needed only occasionally. | `agent_docs/…` or `.void/…`, referenced on demand |
| Per-feature or per-subdir specifics | Not universal; pollutes every unrelated task. | a nested `CLAUDE.md` in that subdir, or a doc |

The pattern is one rule: **route each instruction to its strongest enforcer.** The strongest enforcer is almost never the CLAUDE.md.

---

## Progressive disclosure

Do not inline detail you need only sometimes. State the pointer, not the payload:

```markdown
Database migrations follow a strict expand/contract protocol.
Read `agent_docs/migrations.md` before touching any migration.
```

The agent reads the doc when the task calls for it and pays zero budget when it does not. This is how a 60-line CLAUDE.md governs a large codebase: it is an index into deeper docs, not the docs themselves.

For genuinely conditional guidance, scope it tightly:

```markdown
<important if="editing files under packages/billing/">
Money is integer cents, never floats. See `agent_docs/money.md`.
</important>
```

A narrow `if` condition keeps the instruction out of attention for every task it does not apply to. A wide or vague condition is just an always-on instruction wearing a costume.

---

## Runnable, not aspirational

A CLAUDE.md is correct only if it is **runnable**: an agent that reads "run the tests with `pnpm test`" and runs it must succeed on the first try, in a clean checkout. The same goes for build and dev commands.

- A command that needs an undocumented setup step is a broken instruction, not a terse one.
- Test the CLAUDE.md the way you would test code: fresh clone, follow it literally, see if it works.
- An aspirational CLAUDE.md ("we lint with X" — but the lint script is missing) teaches the agent to distrust the whole file.

---

## Auditing an existing CLAUDE.md

The harness must be able to prune its own and its consumers' files. Walk every line with one question:

**"Would removing this line cause the agent to make an error?"** If not, cut it.

Pruning checklist:

- [ ] **Style/format rules** → move to linter/formatter, delete from CLAUDE.md.
- [ ] **Certainties** ("always run X after Y") → convert to a hook, delete the instruction.
- [ ] **Code snippets** → replace with a `file:line` reference.
- [ ] **Deep/occasional detail** → extract to `agent_docs/…` or `.void/…`, leave a pointer.
- [ ] **Non-universal specifics** → move to a nested `CLAUDE.md` or a doc.
- [ ] **Deterministic config** → move to `settings.json`.
- [ ] **Vague/decorative lines** ("write clean code", "be careful") → delete; they cost a slot and enforce nothing.
- [ ] **Unconditional lines that apply only sometimes** → wrap in a narrow `<important if="…">` or move out.
- [ ] **Stale commands** → verify each is runnable from a clean checkout; fix or remove.

A CLAUDE.md gets *shorter* over a healthy project's life, not longer. Growth without pruning is the default failure.

---

## Composition with other skills

- **`void-context`**: the foundation. Context is the constraint; CLAUDE.md spends from the same budget every task pays. This skill is that principle applied to the always-on prompt.
- **`void-source-driven-development`**: when CLAUDE.md points at a deferred doc, that doc grounds tool config in version-matched official sources rather than inlining remembered config into the prompt.
- **`void-learn`**: the harness *produces* CLAUDE.md files for consumer projects; this skill is the doctrine those generated files must obey. A "the harness should add X to CLAUDE.md" gap (Branch B) is judged against this skill before it lands. When a user states a *project-specific* rule, learn (Branch A) routes it; this skill answers *where it lands* — universal certainty → hook; deterministic → settings; project invariant with no enforcer → a lean CLAUDE.md line; deep detail → a deferred doc.

---

## Rationalizations

| Rationalization | Reality |
|---|---|
| "More instructions make the agent more careful." | More instructions dilute attention; the rule that mattered is now buried among forty that did not. Fewer, sharper lines win. |
| "I'll inline the style rules so it always formats right." | It will *not* always format right — instructions are probabilistic. A formatter is deterministic. Send the linter, not the LLM. |
| "A short code example makes it concrete." | The example rots when the code moves and then lies. A `file:line` pointer stays true. |
| "This is important, so it has to live in CLAUDE.md." | If it must happen every time, it is a hook, not an instruction. CLAUDE.md cannot guarantee 'every time.' |
| "Better to over-document than miss something." | Over-documenting is how you miss something: the signal drowns. Pruning is documentation. |
| "I'll just let `/init` generate it." | Auto-generated CLAUDE.md is bloated by default — it inlines style, snippets, and obvious facts. Generate, then prune hard against the audit checklist. |
| "It's only a few extra lines." | Every line evicts attention from the others. There is no free line in an always-on prompt. |

---

## Verification

Before shipping or approving a CLAUDE.md:

- [ ] Length near the ~60-line target; well under the ~150-instruction ceiling.
- [ ] No code-style/format/naming rules (those live in linter/formatter config).
- [ ] No code snippets that can rot — references are `file:line`.
- [ ] Every "must happen every time" certainty is a hook, not an instruction.
- [ ] Deterministic config (permissions, attribution, env) is in `settings.json`, not here.
- [ ] Deep/occasional detail is deferred to `agent_docs/…` or `.void/…` with an explicit "read it when…" pointer.
- [ ] Conditional guidance uses a narrowly-scoped `<important if="…">`, not an always-on line.
- [ ] Every line survives "would removing it cause an error?" — no decorative or vague filler.
- [ ] Runnable: build/test/dev commands succeed from a clean checkout on the first try.

If any box is unchecked, the file is spending attention budget it has not earned.

---

## Anti-rules

- MUST NOT put code-style, formatting, or naming rules in CLAUDE.md — those are a linter's job.
- MUST NOT inline code snippets — reference `file:line` so they cannot rot.
- MUST NOT encode an every-time certainty as an instruction — make it a hook.
- MUST NOT inline deterministic config (permissions, attribution, env) — put it in `settings.json`.
- MUST NOT add non-universal or decorative lines — every line must earn its attention slot.
- MUST NOT ship an auto-generated CLAUDE.md unpruned — generate, then audit it down.
- MUST NOT leave an unrunnable command in the file — verify from a clean checkout.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Unsure if a line belongs | Ask "would removing it cause an error?" No → cut it. |
| The file keeps growing | You are adding without pruning. Run the audit checklist; route each line to its strongest enforcer. |
| Want a rule enforced 100% of the time | That is a hook, not a CLAUDE.md line. |
| Need a lot of detail somewhere | Defer it to `agent_docs/…` / `.void/…` and leave a one-line pointer. |
| A rule applies only to one area | Nested `CLAUDE.md` in that subdir, or a narrow `<important if="…">`. |
| `/init` produced something huge | Treat it as a draft; prune hard against the audit checklist before shipping. |

---

## Final rule

```
CLAUDE.md → only universal, load-bearing, runnable lines; style to linters,
certainties to hooks, config to settings, detail to deferred docs.
Otherwise → it spends attention budget it never earned, and buries the rules that mattered.
```
