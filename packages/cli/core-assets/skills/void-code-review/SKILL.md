---
name: void-code-review
description: Pre-PR critical pass. Six dimensions (correctness, tests, security, structure, readability, perf). Two modes (strict/souple). Composes the native /void-code-review and codex CLI. Use on a diff.
---

# code-review — voidcorp craftsman edition

A review examines the accepted behavior and the consequences of shipping the change. This skill provides the framework: six dimensions in order, blocker vs nit, evidence block in the PR body, two modes, explicit composition with Claude Code's native `/void-code-review` and specialized agents. The skill orchestrates; it does not duplicate the deep-pass agents.

**Attribution**: see `.source` in this directory.

---

## Six dimensions, in order

The order matters. A correctness issue blocks regardless of beautiful structure. A perf issue does not block if the first four dimensions are clean.

1. **Correctness** — does it do what it claims? edge cases? error paths? composes with `void-tdd` (cycle evidence) and `void-debug` (root cause for fixes).
2. **Tests** — failing test before the code? real code over mocks? names describe behavior? composes with `void-testing`.
3. **Security** — input validated at trust boundaries? secrets handled? SQL safe? LLM input untrusted? composes with `void-security-guidance` (which routes deep audits to `void-security-audit`).
4. **Structure** — boundaries respected (no domain importing infrastructure)? service/repository split? function lengths? composes with `void-hexagonal-architecture`, `void-domain-driven-design`, `void-refactor`, and the `doctrine-critic` agent.
5. **Readability** — names? exhaustive switches? `any` slips? `as` casts? composes with `void-typescript-strict`.
6. **Performance** — obvious O(n²) inside loops? leaky reactive subscriptions? unbounded queries? measured claims come from the project's perf tooling (Lighthouse CI, bundlesize), not guesses.

A11y, observability, LLM cost discipline ride inside dimensions 1-6 (e.g. missing a11y is a Correctness issue at the UI boundary; missing structured log is a Structure issue at the service layer).

### Leverage hierarchy in review

Spend attention where defects cost the most. An upstream design or contract flaw (Correctness, Structure) cascades through everything downstream; a code-detail nit (Readability) stays local. Surface the high-leverage defects first, and weight scrutiny toward them.

Do not over-engineer the review itself: report only what touches correctness or the stated requirements, not every possible finding. A reviewer who flags every theoretical improvement buries the one BLOCKER that matters. When in doubt, the bar is "would shipping this without the fix be wrong?" — if not, it is at most a `NIT:`.

---

## Blocker vs nit

Every comment is explicitly prefixed:

- **`BLOCKER:`** — must be fixed before merge. Block the PR.
- **`NIT:`** — suggestion. Author decides. Does NOT block.
- **`QUESTION:`** — clarification request. May escalate to BLOCKER if answer reveals a defect.
- **`PRAISE:`** — explicit acknowledgement of good code (rare, but valued).

Style, naming and optional refactoring are advisory. Correctness, security or a broken boundary blocks only with a concrete consequence. A missing test blocks when a demonstrated behavior or regression risk lacks an adequate proof, not because a checklist asks for another test.

Use these prefixes to make decisions legible; formatting alone never creates a blocking defect. The companion hook `blocker-prefix-grep` produces the BLOCKER/NIT count for the evidence block.

---

## PR body — review evidence

Every PR in strict mode includes a Review Evidence block:

```markdown
## Review Evidence

- **Mode**: strict
- **Reviewer runtime**: native independent reviewer or codex CLI (one general pass)
- **Dimensions covered**:
  - [x] Correctness — actual RED command/result before implementation, then GREEN on candidate
  - [x] Tests — 4/4 passing, mutation score 94%, no business mocks
  - [x] Security — trust boundary validated via Zod at /api/checkout
  - [x] Structure — services do not touch DB (repository pattern verified)
  - [x] Readability — typescript-strict clean (no any, no rogue as)
  - [x] Performance — no measured claim, no obvious smell
- **Blockers raised**: 0
- **Nits raised**: 2 (variable rename suggestion, helper extraction suggestion)
- **Claude vs Codex disagreement**: none
- **Skipped dimension**: none
```

If a dimension is skipped, the reason is explicit. If Claude and Codex disagree, the deltas are surfaced — not silently arbitrated.

The companion hook `pre-PR-review-evidence` warns if the PR body lacks this block (strict mode).

---

## CL Size discipline

PRs larger than ~400 LOC of diff should either:

- Be split into multiple PRs each focused on one concern
- Or include a `large-cl-justification: <reason>` marker in a commit message

Review quality decays after ~400 added LOC. The optional `large-cl-grep` adapter warns without blocking when a branch exceeds the threshold. It reads Git only: no forge, `gh`, or `jq` dependency.

---

## Modes

| Mode | Trigger | Posture |
|---|---|---|
| **strict** | PR targeting `main` / `develop` / release branches. Pre-PR final pass. | All six dimensions checked. Blockers fail. Evidence block REQUIRED. Default effort: native `/void-code-review medium`, escalate to `ultra` for high-stakes diffs. Select one independent reviewer runtime. |
| **souple** | In-progress feedback on a feature branch during work. WIP commits. | Dimensions checked at user discretion. No evidence block required. Default effort: native `/void-code-review low` or `medium`. |

---

## Composition with specialized agents and tools

| Dimension | Composed with |
|---|---|
| Correctness, Tests | `void-tdd` skill (verify cycle), `void-testing` skill (verify quality), `doctrine-critic` agent (doctrine conformance) |
| Security | `void-security-guidance` skill, `doctrine-critic` agent (flags boundaries), `void-security-audit` (only at user request for full audit) |
| Structure | `void-hexagonal-architecture` skill, `void-domain-driven-design` skill, `doctrine-critic` agent (boundary spirit) |
| Readability | `void-typescript-strict` skill, Biome (formatter) |
| Performance | the project's perf tooling (Lighthouse CI, bundlesize) for measured claims; this skill flags only obvious smells |
| Independent reviewer alternative | `codex review` (choose this or the native independent reviewer for the general pass) |
| Diff analysis at high effort | native `/void-code-review medium` / `high` / `ultra` |

The skill is the orchestration. Specialized agents and the native `/void-code-review` do the heavy work.

---

## Operating procedure

### Pre-condition (strict mode)

- The PR's HEAD has been built and tested locally / in CI. No build errors or failing required tests. Lint findings block only for a demonstrated consequence.
- Inspect output for leaked data and actionable errors; advisory diagnostics do not reopen review.
- Recover the accepted behavior and rationale from the task, request or PR; ask only if a missing decision changes correctness or scope.

A failing required proof or invalid subject prevents acceptance. Missing prose or advisory output does not prevent the reviewer from inspecting the candidate.

### Reviewer runtime

Prefer an available supported runtime different from the writer for the one independent general
review. Verify its real invocation and read-only permissions; never relabel a same-runtime session.
A canonical mission's authenticated envelope remains authoritative: current canonical dispatch
binds its runtime to the coordinator. This preference does not add cross-runtime routing or allow
foreign receipts into that journal. Use the supported independent path and state the limitation;
no repeated probe or extra general review is required merely to obtain a different brand.
Retain the actual reviewer for targeted corrections. Runtime diversity complements independence
and consequence-based findings; it is not proof of correctness by itself.

### Pass

1. Bind the task, acceptance criteria, exact commit and base before reading. Prefer a dedicated
   worktree pinned to the commit, with native read-only permissions. The reviewer never edits.
2. Perform one independent general review across the six dimensions. Report only demonstrated
   consequences in scope. Every blocker names its violated criterion, concrete consequence,
   evidence and resolution condition. Style and optional refactoring remain advisory.
3. Preserve the minimal review receipt and original result: reviewer, subject, conclusions,
   proofs and defect resolutions. Record missing or refused native identity as an exact
   provenance limitation; it alone cannot reject a traceable independent review. Do not invent
   independence or accept self-review as a substitute.
4. The author corrects blockers or records a reasoned disagreement. After each correction batch,
   verify only the corrections and affected behavior. Reuse unaffected conclusions and proofs;
   never restart the general review. Newly raised blockers must demonstrate a correction
   regression or a concrete defect within the original scope.
5. Follow `void-implement`'s maximum two correction batches. Under `void-autopilot`, its tighter two-total-review-round budget applies (initial plus one corrected head); see `docs/BOUNDED-REVIEWS.md`. Incomplete review, resumption and
   transport repair do not consume or reset that budget. Advisory findings never request a
   correction cycle. At the limit, report unresolved defects with cause and next action.
Advisory findings never start a correction cycle; stop after acceptance, required proofs and independent review hold.

6. The orchestrator may request one independent opinion on a disputed point and retain it
   as evidence for targeted verification, without reopening general review or resetting the
   budget. No separate automatic arbitration command is provided. Escalate beyond-mandate
   decisions to the human. Retain historical
   findings and their resolutions; never call an unresolved blocking defect conformant.


### Author response (Google practices)

- Address every BLOCKER (fix or reasoned pushback).
- Read NITs as optional advice. Once acceptance and proofs hold, leave them out; they never reopen the completed work or trigger another cycle.
- Treat QUESTION as a thinking prompt — answer or escalate.
- Push back when you disagree. Reviewer may hold ground with a clear "why."

---

## Banned

### "LGTM" reviews

A bare verdict with no examined subject or evidence is insufficient. State the dimensions actually checked and concrete findings briefly; repeated checklist prose adds no proof.

### File-by-file linear walk

Default to dimension-by-dimension across the whole diff. Linear walk misses cross-file issues (service change without its repository update, schema change without its consumer update).

### Style / naming bikeshedding marked as BLOCKER

Style is solved by Biome + `void-typescript-strict`, not by reviewer preference. Anything stylistic is `NIT:` at most.

### Architectural-rewrite suggestions inside the PR

If the diff reveals a structural problem larger than the diff, add a `QUESTION:` comment + suggest a follow-up issue. Do not block on "rewrite this PR." Scope creep at review time tanks velocity.

### Silent disagreement between Claude and Codex

Disagreements are surfaced. Not averaged. The user decides.

---

## Composition summary

- **Upstream**: `void-verify` (the author claims the code is ready before review starts).
- **Downstream**: `void-commit-discipline` (the merge commit follows conventional commit + always-say-why), then the ship step (`void-implement` pass 11 + `gh` lands the PR; release-please owns versions).
- **Side-by-side**: the `doctrine-critic` agent (doctrine conformance, read-only).

---

## Companion hooks

- **`pre-PR-review-evidence`** (pre-push) — warn if PR body lacks the Review Evidence block (strict mode)
- **`large-cl-grep`** (optional pre-push) — warn if the branch adds > 400 LOC without a commit-message `large-cl-justification:` marker
- **`blocker-prefix-grep`** (post-review) — informational: count BLOCKER vs NIT comments for the evidence block

See `../../hooks/`.

---

## Anti-rules

- MUST NOT decide whether to ship — user owns the merge decision.
- MUST NOT block on style / naming (Biome + `void-typescript-strict` jobs).
- MUST NOT suggest scope expansion inside the PR — escalate to follow-up.
- MUST NOT duplicate `doctrine-critic` or `void-security-audit` work — delegate.
- MUST NOT silently arbitrate Claude-vs-Codex disagreements — surface them.
- MUST NOT mark style nit as BLOCKER.
- MUST NOT pass a review when the test suite has not been observed passing on the PR's HEAD.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Review feels shallow | You skipped a dimension. Walk all six in order. |
| Cannot tell BLOCKER from NIT | A demonstrated defect or missing proof of a concrete risk blocks; optional improvement is advisory. |
| Diff is too large to review | Ask the author to split, or invoke `large-cl-justification:` if truly atomic. |
| Found a structural rot beyond the diff | `QUESTION:` + suggest follow-up issue. Do not block this PR on it. |
| Claude and Codex disagree | Surface the delta. Let the author/user decide. |
| Diagnostics remain | Resolve actionable defects; name unrelated warnings without restarting review. |

---

## Final rule

```
A review → six dimensions in order, blockers explicit, evidence in PR body (strict), delegated where deep.
Otherwise → it is not a voidcorp code-review.
```

The independent reviewer examines the committed result. The author owns all code changes.
