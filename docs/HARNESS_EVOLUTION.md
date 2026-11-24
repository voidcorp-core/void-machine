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

## Requested evaluation

Use `void-learn` when a human requests an evaluation or a concrete failure exposes
a harness gap. Inspect current sources and actual execution/review evidence;
propose a bounded change under the same human decision process. Usage aggregation,
scoring and automatic retirement proposals are retired, without a replacement
telemetry engine. Historical journals and reports remain available.

`projects` and the Projects UI retain bounded discovery of configured roots using
the versioned `.void/config.json` marker. That discovery does not aggregate usage
or infer whether a skill is useful.

## HITL is absolute

- No automatic write into doctrine, ever.
- Every harness change is a deliberate commit with a "why" line.
- `void-learn` handles the human ↔ AI conversation when a new rule is captured (project-rule branch) and when a harness gap is filed (harness-gap branch).

## See also

- `void-learn` skill — the in-Claude workflow for filing a friction as a void-machine issue during a coding session (and for capturing project rules).
- `docs/plans/frictions/` — historical frictions before the consumer-side convention shipped.
