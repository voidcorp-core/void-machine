---
name: void-commit-discipline
description: Conventional Commits + mandatory "why" in body + scope + breaking-change marking. ASCII-only (no em dash, no emoji). Co-author trailer for AI pair. The git log is documentation. Use at every commit.
---

# commit-discipline — voidcorp craftsman edition

The git log is the project's living narrative. "fix stuff" / "wip" / "asdf" destroy that narrative. Conventional Commits give shape; the mandatory "why" in the body gives substance. This skill enforces both.

**Attribution**: see `.source`. Foundation: Conventional Commits spec + Folpe "always say why" + citypaul commit guidance.

---

## Format

```
<type>(<scope>): <subject>
<blank line>
<body explaining WHY — the rationale, the constraint, the spec link>
<blank line>
<footers — BREAKING CHANGE, Co-Authored-By, Closes #N>
```

### Types (allowed list)

| Type | When |
|---|---|
| `feat` | New observable behavior (new feature, new endpoint, new component visible to users / consumers) |
| `fix` | Bug fix. Composes with `void-debug` (the why = the root cause) |
| `void-refactor` | Structural change without behavior change. Composes with `void-refactor` (named Fowler move) |
| `test` | Add / modify tests without changing production code. Includes `test: reproduce <bug>` from `void-debug` |
| `docs` | Documentation only |
| `chore` | Repo maintenance (config, scripts, tooling) without user-visible effect |
| `build` | Build system / dependencies |
| `ci` | CI configuration / workflows |
| `perf` | Performance improvement with measurement |
| `style` | Formatting only (Biome auto-fix, etc.) |

No invented types (`improve:`, `tweak:`, `cleanup:`). Reach for one of the above or split the commit.

### Subject rules

- Imperative mood: "add", "fix", "refactor" — NOT "added", "adds", "adding"
- Lowercase
- No period at the end
- ≤ 72 characters
- Specific: "fix race in webhook handler" > "fix bug"

### Body rules

- Always present for `feat`, `fix`, `void-refactor`, `perf` commits. Optional for trivial `chore` / `style`.
- Wrapped at ≤ 72 columns
- Explains the WHY: rationale, constraint, spec link, root cause
- Multi-line bullets fine
- ASCII only — no em dash, no emoji (the harness invariant)

### Footers

- `BREAKING CHANGE: <description>` for breaking changes (forces a major version bump under SemVer)
- `Closes #<issue>` / `Refs #<issue>` for issue references
- `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` for AI pair commits

---

## Examples

### feat with spec link

```
feat(checkout): add discount code application to cart

Why: spec docs/specs/2026-05-29-discount-codes.md approved 2026-05-30.
The cart accepts a `discountCode` field; valid codes apply percentage
or fixed-amount discounts at checkout time. Composes with the existing
Money value object for precision.

Closes #142

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### fix with root cause

```
fix(orders): handle null customer email in receipt generation

Why: a small fraction of legacy orders have a null customer email
(pre-validation rollout, see migration 0042). The receipt generator
threw on null, surfaced as 500s on /api/orders/{id}/receipt.

Root cause: the receipt builder assumed Email is always present.
Fix: receipt builder falls back to "unknown@example.invalid" with
a structured log entry tagged orphan_email_receipt for auditing.
Prevention: a backfill migration is queued (see plan
plans/2026-06-02-email-backfill-plan.md) to set valid emails on
legacy rows.

Closes #248
```

### refactor (named Fowler)

```
refactor(checkout): extract calculateDiscount helper

Why: the inline calculation in CheckoutService grew to ~40 lines
with three branches. Extracted to a pure helper to enable unit
tests at the calculation level (composes with the new discount
strategy tests in PR #142).

Named refactor: Extract Function (Fowler 2018).
```

### BREAKING CHANGE

```
feat(api)!: rename /orders/:id/items endpoint to /orders/:id/line-items

Why: ubiquitous-language alignment. The team uses "line item"
consistently in the domain (per docs/DOMAIN.md). The API path
matched. BREAKING CHANGE for any external consumer.

BREAKING CHANGE: the path /orders/:id/items no longer exists.
Consumers MUST migrate to /orders/:id/line-items. The legacy
path will return 410 Gone for 30 days, then be removed.

Closes #157
```

---

## Banned

### Vacuous subjects

- "wip", "asdf", "stuff", "fix bug", "update", "tweak", "cleanup"

The author cannot tell, the reviewer cannot tell, future maintainers cannot tell. Reject at commit time.

### Mixed-intent commits

- `feat: add discount + fix unrelated bug` — split.
- `refactor: extract helper and add validation` — split (composes with `void-refactor` Two-Hat).
- `fix: bug A and bug B` — split.

The companion hook `tidying-commit-prefix` (already shipped) flags `refactor:` with behavior-change keywords in body.

### Em dash, emoji, non-ASCII

The harness invariant: English ASCII commit messages. Hyphens (`-`) for ranges, hyphens for parenthetical, not em dash. The companion hook `no-emdash-no-emoji-in-commit-msg` blocks.

### Missing "why" for substantive commits

`feat:` / `fix:` / `refactor:` / `perf:` without a body explaining why = rejected. The commit message is documentation.

### AI authorship without trailer

Commits produced in pair with an AI agent include `Co-Authored-By`. Authorship transparency.

---

## Bug fix evidence (composes with void-debug)

Separate `test:` and `fix:` commits are optional. A regression test and its fix may share one
logical, bisectable commit; unrelated changes still belong in separate commits.
The proof is the observed RED result before the production fix, followed by GREEN on the
candidate, as required by `void-tdd` and `void-debug`. A pair of commit messages alone cannot
prove that chronology. Retain the actual test commands/results and explain the root cause.

---

## Companion hooks

- `commitlint-precommit` (commit-msg, in `pack-monorepo`) — already in void-starter. Enforces conventional commits.
- `tidying-commit-prefix` (commit-msg, already shipped in core/hooks) — warns on mixed-intent `refactor:` commits.
- `refactor-named-grep` (commit-msg, already shipped) — warns on `refactor:` without a Fowler name.
- `no-emdash-no-emoji-in-commit-msg` (commit-msg, in `pack-monorepo`) — blocks em dash and emoji.

---

## Composition with other skills

- **Runs AFTER `void-verify`** — the completion handoff produces the "what done"; this skill frames it for git.
- **With `void-debug`** — observed RED/GREEN proof and root cause; phase commits are optional.
- **With `void-refactor`** — Two-Hat principle, named Fowler refactors in subjects.
- **With `void-brainstorm` + `void-plan`** — substantive commits link to their spec / plan in the body.
- **With `void-code-review`** — review comments respect the commit boundaries (do not request mixing intent).

---

## Anti-rules

- MUST NOT decide whether the change itself is correct (that is the upstream skills' job).
- MUST NOT permit vacuous subjects.
- MUST NOT permit em dash / emoji / non-ASCII.
- MUST NOT permit `feat:` / `fix:` / `refactor:` without a body why.
- MUST NOT substitute phase commit messages for observed RED/GREEN evidence.
- MUST NOT silently allow invented commit types.

---

## Final rule

```
Every commit → conventional format + imperative subject ≤ 72 + body explains WHY + ASCII + AI co-author trailer.
Substantive (feat/fix/refactor/perf) → body mandatory.
Otherwise → it is not voidcorp commit-discipline.
```

The git log is the project's narrative. Write it as if a future debugger will thank you — because one will.
