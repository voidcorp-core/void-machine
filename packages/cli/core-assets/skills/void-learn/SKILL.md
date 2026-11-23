---
name: void-learn
description: Capture a lesson when it appears — a stated project rule, a recurring/deja-vu fix, an end-of-cycle pattern, or a harness gap. Routes to PROJECT-DOCTRINE, a GitHub issue, or nothing. HITL strict. Also the single door for harness feedback. Fires on "the harness should have X", "this hook is a false positive", "that skill is missing", a DX papercut worth filing, or any explicit request to send feedback about the harness itself.
---

# learn — voidcorp craftsman edition

One intent — *capture a lesson before its context evaporates* — with three destinations. This skill replaces the former `compounding` + `capture-rule` + `harness-evolution` trio, which were three doors to the same action separated by ~200 lines of mutual boundary-policing. Here the first step is the routing decision; the three behaviors follow unchanged, each keeping its own strict Human-In-The-Loop gate.

It writes nothing on its own. It names the lesson, decides where it belongs, and runs the matching capture — proposing every write and waiting for an explicit yes.

**Attribution**: see `.source` (inherits compounding, capture-rule, harness-evolution).

---

## Step 0 — Recognize the signal (auto-trigger)

Engage the moment any of these appears — you should not need to be asked:

- **A stated rule** — imperative future ("always X", "never Y", "from now on Z"), a preference ("we don't do Y here", "I prefer X"), an anti-pattern callout ("stop doing Y"), or a memory request ("remember that Z", "n'oublie pas que").
- **A recurring / deja-vu fix** — mid-work you catch yourself solving something *already seen*. That recognition means a pattern exists and was never captured.
- **An end-of-cycle pattern** — a feature, bugfix, or refactor just merged; before the next task, spend two minutes extracting the reusable lesson.
- **A harness gap** — "the harness should have caught this", a skill is missing, a rule is wrong, a hook false-positives, two skills overlap.

Do NOT engage for: one-off task instructions ("fix this bug"), questions ("how do I X?"), information without imperative ("the API returns Z"), or vague future intent ("we might want X someday"). When unsure whether a signal is persistent, ask before capturing — better to skip than to spam the doctrine.

---

## Step 1 — Route (the one decision that matters)

Name the lesson as a **generalization**, not the instance. Instance: "I fixed the null deref in `CheckoutSummary`." Pattern: "X always fails when Y." If you cannot state it in one sentence, it is an instance — drop it (see *When to drop*).

Then decide the scope with one question: **"If I started a new unrelated project tomorrow, would this lesson still apply?"**

| Answer | Scope | Destination | Branch |
|---|---|---|---|
| No — only this codebase | Project rule | `.void/PROJECT-DOCTRINE.md` | **A** |
| Yes — every voidcorp project | Harness gap | GitHub issue on `voidcorp-core/void-machine` | **B** |
| True but trivial / one-off | Disposable | nowhere | drop |

**When the scope is genuinely ambiguous, ASK — never guess:**

```
This could go two places:
  1. .void/PROJECT-DOCTRINE.md (this project only)
  2. the harness itself (universal — a GitHub issue on void-machine)
Which scope did you mean?
```

Wait for the answer. A universal rule must never land in a project doctrine, and a project quirk must never reach the tracker.

---

## Branch A — Project rule → `.void/PROJECT-DOCTRINE.md` (HITL strict)

`PROJECT-DOCTRINE.md` is imported into every session via `@.void/PROJECT-DOCTRINE.md` in `CLAUDE.md`, so a captured rule takes effect on the next message. **Never write the file before confirmation.**

### 1. Propose the wording in chat

```
Proposed rule capture:
  Target file: .void/PROJECT-DOCTRINE.md
  Section:     <the heading it goes under, verbatim; "new: <table name>" if created>
  Wording:     <verbatim rule, imperative present>
  Why:         <the user's reason, quoted; skip if none given>
  Enforced by: <skill / hook that materializes it, or "manual review / code-review">
Confirm? (yes / change wording / change section / skip)
```

### 2. Wait for an explicit yes

Accept `yes / ok / go / vas-y / confirme / c'est ça`. Anything else — a question, silence, "maybe" — STOP and ask again. Silence is not consent.

### 3. Write

Append to the correct section of `.void/PROJECT-DOCTRINE.md`:

```markdown
- **<rule subject>**: <verbatim wording>.
  - **Why**: <reason>.
  - **Enforced by**: <skill / hook / manual review>.
```

Choose the section by meaning, then place it by what the file already holds (see *Section routing*).

### 4. Confirm in chat

State the file path and section, and note it is active from the next message via the import; remind the user to `git add .void/PROJECT-DOCTRINE.md` when ready. Commit as `docs(doctrine):` (never automatically).

### Section routing

This table is the only list of section kinds a project doctrine has. `docs/PROJECT-DOCTRINE-FORMAT.md` illustrates the shape of each one and uses the same names; it does not own a list of its own.

| Section | Use for |
|---|---|
| **Project context** | Domain facts (users are TPE/PME French dirigeants; prod on Vercel + Neon). |
| **Domain language** | A term this team uses with one precise meaning, so the agent uses the same word. |
| **Quality bar** | What "done"/"shipped" means (anti-rustine, ASCII-only, no half-built features). |
| **Hard rules** | Concrete, enforceable rules (@repo/core/logger not console.log, Zod at every boundary). |
| **Forbidden patterns** | What this codebase paid for and will not reintroduce; reference the incident/ADR. |
| **Trade-offs already decided** | Pointers to the project's decision records the agent must not re-litigate. |
| **Open questions** | What the team has not decided yet, so the agent asks instead of guessing. |
| **Project-specific skill routing** | "On THIS project, skill X triggers under Y" (apps/checkout/ → tdd strict). |

Pick the kind from the rule's meaning first. If it fits several kinds, ask rather than guess.

Then place it by the file's own level-2 headings, which the project owns and may word differently: the installed file is a stub, so its sections appear as they are used, and a hand-written one may predate this table.

- **One heading names that kind**, whatever its wording (`Project-specific hard rules` is Hard rules, `Trade-offs already decided (link to ADRs)` is Trade-offs), so append under it. Never create a second heading for a kind the file already has.
- **No heading names it**: create the table's name as a new level-2 heading.
- **Two headings could hold it, or a heading matches no row plainly**: ask. Never pick the closest string.

The mapping is explicit, never inferred silently: the proposal names the target heading verbatim, so the human confirms where the rule lands along with its wording.

### Conflict handling

Before writing, scan for a duplicate or contradiction. On a **duplicate**, offer skip / replace / keep-both. On a **direct conflict**, present existing vs new and ask replace / refine-both / skip; if replace, show the removal+addition diff before editing. Never silently merge or overwrite.

---

## Branch B — Harness gap → a GitHub issue (HITL strict)

This branch is also where harness **feedback** lands, whatever words it arrives in: a skill that
is missing, a hook that fired on something legitimate, a rule nobody wrote down, a papercut in
the CLI or the docs. Infer the gap from the recent conversation, and ask one short clarifying
question only when it is genuinely unclear — the friction is fresh, and re-interviewing the user
about something they just lived is how a capture becomes more expensive than the gap.

The gap goes **straight to a `voidcorp-core/void-machine` issue** — there is no per-project `proposed/` queue; the pre-filter is your judgment before you open it. File ONLY when it clears BOTH tests:

- **Agnostic** — helps any consumer, not just this project. A project quirk belongs in `PROJECT-DOCTRINE.md` (Branch A), never on the tracker.
- **Harness-worthy** — it would change a skill, hook, pack, CLI, or doctrine line; not a one-off preference, not already covered by an existing skill.

Calibrate against the ADR sweep behind issue #34 (a full audit that rejected everything but one narrow correction). When in doubt, do NOT file — a quiet, closeable tracker beats one buried in project-flavored noise.

Draft the issue, show it to the user, and on confirmation:

```bash
gh issue create --repo voidcorp-core/void-machine \
  --title "<area>: <concise gap>" \
  --label enhancement \
  --body "<what happened, evidence, source-project context (repo, SHA, path), shape of the fix>"
```

The tracker **is** the triage zone: taking the issue promotes it, closing it declines it. No `promoted/` / `discarded/` bookkeeping, no `feedback push` step. A promoted issue becomes a normal PR (usually an audit note + SKILL.md + matrix row) citing the originating project. Nothing merges without human review. If `gh` is missing or unauthenticated, say so and stop — do not silently swallow the failure.

### Outbound audit (obsolescence detection)

The obsolescence side runs from the CLI, not from prose here: `void-machine audit` (and `--all-projects` / `--push`, #72) reads canonical `.void/runs/*/events.jsonl` journals plus legacy history and reports skills that are active / stale / never-fired, plus expensive/should-have-fired via `void-graph`. This skill's job in audit mode is to **interpret** that report and, per proposal, draft a deprecation/fusion PR — hand-authored, HITL. The audit never removes a skill, edits a SKILL.md, or touches doctrine automatically.

---

## Branch C — the end-of-cycle ritual (feeds A, B, or drop)

At a cycle close or a deja-vu recurrence, run the two-minute extraction, then route:

1. **Name the pattern, not the instance** (Step 1's generalization test).
2. **Decide scope** — project rule (→ A), harness gap (→ B), or disposable (→ drop).
3. **Route to the matching branch** and stop. This ritual adds the *occasion* and the *triage*; the write happens in A or B under their gates.

Do not run it on an unfinished cycle — wait until the work is verified done (`void-verify`). The merge that closes the cycle is the natural trigger.

---

## When to drop (anti-capitalization)

Capitalizing trivial instances is worse than capturing nothing: it bloats the doctrine, dilutes the signal, and trains everyone to skim past it. Drop when the lesson:

- is a one-off that will not recur (a typo, a one-time migration quirk);
- is already covered by an existing skill, rule, or hook (re-check first);
- cannot be stated as a generalization;
- is "nice to know" but changes no future behavior.

A clean doctrine is the asset. Every entry earns its place by changing what happens next time.

---

## HITL is absolute

- Nothing is written to `PROJECT-DOCTRINE.md` or filed as an issue without an explicit human yes.
- This skill OPENS issues/PRs; it never merges them.
- Usage telemetry is LOCAL only (`.void/runs/*/events.jsonl`); no network call sends it anywhere.

---

## Anti-rules

- MUST NOT write to `PROJECT-DOCTRINE.md` before confirmation, or capture a one-off instruction as a persistent rule.
- MUST NOT add a project rule that contradicts `PHILOSOPHY.md` (that is an ADR, written through the `void-decide` skill, not a doctrine entry).
- MUST NOT open or promote a harness PR without confirmation, or auto-merge one.
- MUST NOT capitalize a trivial/one-off instance, or run the ritual on an unfinished cycle.
- MUST NOT send usage data anywhere outside the machine.

---

## Composition with other skills

- **`void-verify`** — upstream: a cycle is not "closed" until the work is verified.
- **`void-commit-discipline`** — a captured project rule commits as `docs(doctrine):`; a recurring review finding is a strong deja-vu signal.
- **`void-code-review`** — a finding that recurs across PRs wants capturing; the reviewer flags PRs violating a fresh rule.
- **`void-claude-md`** — governs the doc a rule lands in.
- **`void-decide`** — a structural decision with a rejected alternative is a short Markdown ADR with light frontmatter. Ordinary record corrections use normal Git commits; a material change links a new decision to its predecessor. Neither replaces the human agreement required here for doctrine updates.

---

## Verification

- [ ] The signal was recognized and the lesson stated as a generalization, not an instance.
- [ ] Scope decided explicitly (project rule / harness gap / disposable); ambiguity surfaced to the user.
- [ ] Branch A: explicit confirmation, right section under the heading the file already has for that kind, `Why` present, no unhandled conflict, only `PROJECT-DOCTRINE.md` edited.
- [ ] Branch B: cleared the agnostic + harness-worthy bar, issue confirmed before `gh issue create`, source context included.
- [ ] Nothing auto-written to doctrine; nothing merged without review.

---

## Final rule

```
Signal appears → name the lesson as a pattern → decide scope →
  project rule  → propose → wait for yes → write PROJECT-DOCTRINE.md → confirm
  harness gap   → clears the bar → draft → confirm → gh issue create
  disposable    → drop it
Otherwise → it is not learn.
```

The doctrine evolves deliberately, one explicit step at a time — and the harness compounds because each cycle's *pattern* is routed, never the raw instance dumped in.
