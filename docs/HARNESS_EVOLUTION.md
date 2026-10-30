# Harness evolution — feedback loop

The harness improves from real project usage, never auto-applied. Two directions.

## Inbound (consumer project → harness)

While coding in a consumer project, when you perceive "the harness should have X", file it **directly as a GitHub issue** on `voidcorp-core/void-machine`. There is no per-project `proposed/` queue and no `feedback push` step: the issue tracker is the native triage primitive — visible across all consumers, labelable, linkable, closeable — and a per-repo markdown queue was a strictly worse reimplementation of it.

### The filing bar

Going direct-to-issue moves the pre-filter from "before the note exists" to "triage by close on the tracker". For a single-maintainer repo that is cheap, but it makes the filing bar load-bearing. Open an issue ONLY when the gap clears BOTH tests:

- **Agnostic** — it helps any consumer of the harness, not just this project. A project-specific rule belongs in that project's `.void/PROJECT-DOCTRINE.md` (via `void-learn`), not on this tracker.
- **Harness-worthy** — it would change a skill, hook, pack, CLI, or doctrine line; not a one-off preference, not already covered by an existing skill.

Calibrate against the ADR sweep behind issue #34: a full audit that rejected everything except one narrow rule correction. When in doubt, do not file.

### How to file

Draft the issue, confirm it with the user, then open it with `gh`:

```bash
gh issue create --repo voidcorp-core/void-machine \
  --title "<area>: <concise gap>" \
  --label enhancement \
  --body "<5-15 lines: what happened, evidence, source context, what would unblock me>"
```

The body carries source-project context (repo, commit SHA, file path) for traceability. Opening the issue is the visible HITL step — an issue is a proposal, not a doctrine write. Taking the issue promotes it; closing it without action declines it. No `promoted/` / `discarded/` / `deferred/` bookkeeping.

## Outbound (harness → consumers)

Periodically the harness should audit the synergy of its parts:

- Hooks, skills, or agents with broken name joins → telemetry repair first
- Components that error → repair before tuning or retirement
- Structurally orphaned components → wiring review
- Expensive, low-yield components → trigger tuning or boundary fusion
- Components unobserved across at least twenty human sessions with observations in the same component family → retirement review
- Upstream tooling deprecations (e.g., a library a skill references getting deprecated)
- Repeated matrix conflicts in `docs/plans/skill-decision-matrix.md` → boundaries need reshaping

`void-machine audit` reports this from canonical `.void/machine/runs/*/events.jsonl` journals; legacy
activation and usage logs are merged as read-only history. It joins declared graph relations,
human-session activations, outcomes and cost across hooks, skills and agents. Self-host and smoke
missions are excluded. Three human sessions and twenty events permit repair/wiring/tuning proposals;
retirement review requires twenty human sessions with actual observations in the component family. Tool-only sessions do not demonstrate skill or agent coverage. Even family observations do not prove complete instrumentation: inspect runtime coverage before treating absence as non-use. It reports only; every modification, fusion or
retirement remains hand-authored through `void-learn` (HITL). Upstream-tooling deprecation and
decision-matrix-conflict detection are planned extensions.

### Cross-project rollup and opt-in push (#72)

A single repo's telemetry is too thin to trust a "never fired" verdict (a skill fires a handful
of times in one project). `projects`, `audit` and `graph` therefore share one bounded discovery:
configured roots are scanned for the versioned `.void/config.json` marker. A project appears
without a hook having run and disappears without mutable registry bookkeeping. `void-machine
update` retires at most 10,000 obsolete `~/.void/projects/*.path` files per invocation and never
recursively removes that directory.

- `void-machine audit --all-projects` and `void-graph cost|behavior --all-projects` aggregate canonical `.void/machine/runs/*/events.jsonl` journals and read-only legacy activation/usage history from discovered projects before applying the same evidence thresholds.
- `void-machine audit --push` files only evidence-eligible proposals as GitHub issues on `voidcorp-core/void-machine`, labelled `harness-feedback`. It is **dry-run by default** (prints the create/update plan and stops); a real push additionally requires an interactive confirmation, and a re-run **updates the same issue** (deterministic title per `type:component`) instead of duplicating. The issues carry component names and aggregate counts only — never a project path, file content, or session id. A missing or unauthenticated `gh` fails loud. HITL is absolute: no issue is ever filed without the explicit flag and the confirmation.

## HITL is absolute

- No automatic write into doctrine, ever.
- Every harness change is a deliberate commit with a "why" line.
- `void-learn` handles the human ↔ AI conversation when a new rule is captured (project-rule branch) and when a harness gap is filed (harness-gap branch).

## See also

- `void-learn` skill — the in-Claude workflow for filing a friction as a void-machine issue during a coding session (and for capturing project rules).
- `docs/plans/frictions/` — historical frictions before the consumer-side convention shipped.
