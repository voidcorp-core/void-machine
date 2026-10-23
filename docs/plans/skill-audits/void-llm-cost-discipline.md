---
skill: llm-cost-discipline
status: reviewed
strategy: original
target_loc: 350
phase: D
depends_on: []
composes_with: [security-guidance, observability, code-review]
matrix_row: plans/skill-decision-matrix.md#llm-cost-discipline
audit_date: 2026-05-29
auditor: Folpe + Claude Opus 4.7
---

# Skill audit: `llm-cost-discipline`

## Need

Without `llm-cost-discipline`, LLM-heavy apps burn 10× the necessary cost: no prompt caching (1k+ tokens of system prompt re-billed on every call), Opus everywhere when Sonnet would suffice, batch API ignored when half the workload is non-interactive, token budgets unstated (`max_tokens` left to default), retries unbounded. The cost surface grows quietly until a monthly bill shocks the team. This skill makes cost a first-class design concern from line one.

## Decision matrix anchor

- **Wins**: any code calling an LLM API. Prompt caching, batch, model selection, token budgets, fallback strategy
- **Loses to**: `security-guidance` on prompt-injection-aware design (data plane vs control plane)
- **Cannot decide**: model choice when quality is uncertain (escalates to `gstack:/benchmark-models`)
- **Composes with**: existing `claude-api` skill (gstack), `observability` (cost-per-call metric), `security-guidance` (prompt logging redaction)

## Sources audited

| Source | URL | Status | Verdict |
|---|---|---|---|
| Anthropic prompt caching docs | https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching | foundation | kept (cache control blocks, hit rate signals, 5-min default TTL, 1h opt-in) |
| Anthropic batch API | https://docs.anthropic.com/en/docs/build-with-claude/batch-processing | foundation | kept (50% discount for non-interactive workloads) |
| Anthropic model card pricing | https://docs.anthropic.com/en/docs/about-claude/pricing | reference | kept (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 cost ratios) |
| gstack /claude-api skill | gstack/skills | composed | composed (we extend, not replace) |
| gstack /benchmark-models | gstack/skills | composed | composed (escalation for quality-uncertain model choice) |
| OpenAI batch API docs | https://platform.openai.com/docs/api-reference/batch | reference | tactical (consumer OpenAI projects) |
| LangChain model-router patterns | various | reviewed | partially kept (model selection logic) |

## Adaptation strategy

`original` + adapt. Compose existing `claude-api` skill (already excellent on caching mechanics) + add the discipline layer (when to use which model, batch by default for non-interactive, token budgets, fallback strategies, anti-Opus-by-default rule).

## What we keep (verbatim or near-verbatim)

- **Prompt caching for any prompt > 1024 tokens that is invoked > 1×/hour** (Anthropic best practice): the cache hit reduces per-call cost by ~90%. Default to caching the system prompt + tool definitions + RAG context. Composes with `claude-api`.
- **Batch API for non-interactive workloads** (Anthropic batch): overnight analysis, bulk processing, async classification — all get 50% off. No excuse not to use it when the latency budget allows.
- **Model selection by task class** (Anthropic model card):
  - **Sonnet** — default for everyday agentic work. Cost-effective, capable, fast.
  - **Opus** — only when justified in writing (high-stakes reasoning, complex code generation, hard QA). Inline comment: `// using Opus because <reason>`.
  - **Haiku** — high-volume classification, extraction, retrieval-grade Q&A.
- **Token budgets per call site**: `max_tokens` declared, estimated input budget documented in the SKILL.md of the calling module. No "let the model decide."

## What we adapt

- **Sonnet is the DEFAULT, not a downgrade**: textbook advice + Folpe rule. Reaching for Opus is a deliberate choice that earns its place with a comment. Why: agentic systems run 1000s of calls per user-session; the model-tier discipline is the single biggest cost lever.
- **Streaming for user-facing interactive; non-streaming for batch / programmatic** (textbook + adapted): streaming reduces perceived latency for chat / agent UIs. For background processing, parse the complete response. Why: streaming overhead is wasted on machine consumers.
- **Retries with exponential backoff + jitter, max 3 attempts**: composes with `async-safety`. Do NOT retry on prompt injection / refusal — those are different failure modes that retry will not fix.
- **Fallback model declared for critical paths**: Opus → Sonnet on quota / outage. Document in the call site.
- **Every LLM call logs structured metadata** (composes with `observability`): model, input tokens, output tokens, cache hit, latency. Never the full prompt content (composes with `security-guidance` — PII / secret risk).
- **Provider abstraction = NO** for the default void-harness consumer: we use Anthropic. Wrapping every call site in a "model-agnostic" abstraction is over-engineering at the cost of features (cache controls, tool use, etc.). Direct Anthropic SDK usage is the default. Why: per Wing Chun.

## What we reject

- **Opus as default**: rejected. Cost is 5× Sonnet for marginal gains on most agentic tasks.
- **`max_tokens` unset**: rejected. Declared per call site.
- **Unbounded retries**: rejected. Max 3 with backoff.
- **Caching disabled "for now"**: rejected. Caching is opt-in per Anthropic SDK but should be on for any prompt > 1024 tokens at > 1×/hour rate.
- **Logging full prompts in plain logs**: rejected. PII / secret risk. Log token counts + structural metadata only.
- **Retrying prompt-injection / refusal failures**: rejected. Different failure mode.
- **Model-router abstraction layer that hides the model choice**: rejected per Wing Chun. Choose explicitly per call site.
- **No fallback for critical paths**: rejected. Document the fallback or document why none is needed.

## Hard rules surfaced by this skill

- **Sonnet is the default model**. Opus requires a justifying comment at the call site. Enforced by: SKILL.md + `llm-cost-precommit` hook (warns on `model: 'opus'` without `// using Opus because`).
- **Prompt caching ENABLED for any prompt > 1024 tokens at > 1×/hour rate**. Enforced by: SKILL.md + `code-review` flags missing cache_control on qualifying prompts.
- **Batch API for non-interactive workloads**. Enforced by: SKILL.md + `code-review` flags large-volume LLM loops without batch consideration.
- **Token budget declared per call site** (`max_tokens` + estimated input). Enforced by: SKILL.md + `code-review`.
- **Retries: max 3 with exponential backoff + jitter**. Enforced by: SKILL.md.
- **Fallback model declared for critical paths**. Enforced by: SKILL.md.
- **Structured logging per LLM call** (model, tokens, cache hit, latency). Enforced by: SKILL.md + composes with `observability`.
- **No full prompt content in logs**. Enforced by: SKILL.md + composes with `security-guidance`.

## Modes — none

Discipline is uniform. Volume scales the importance of caching / batching; the rules apply at any scale.

## Companion hooks

- `llm-cost-precommit` (pre-commit on files matching `<config.paths.ai>` or importing from `@anthropic-ai/sdk`) — warns on `model: 'opus'` without justifying comment, warns on missing `max_tokens`, warns on missing `cache_control` on qualifying prompts (best-effort static check). ≤ 70 LOC.

## Composition with other skills

- **With `claude-api` (gstack)**: this skill = the discipline layer; `claude-api` = the SDK mechanics. Co-evolved.
- **With `observability`**: cost-per-call structured logs feed observability dashboards (cache hit rate, token consumption per endpoint, model mix).
- **With `security-guidance`**: prompt content NEVER in plain logs. LLM input untrusted (prompt injection). LLM output untrusted (no eval, no innerHTML, schema-validated parsing).
- **With `async-safety`**: retries with backoff + jitter. LLM call failures handled with the same idempotency discipline as other external calls.
- **With `hexagonal-architecture`**: LLM SDK at an adapter behind a port. `LlmPort.complete(...)`. Testable in unit tests with an in-memory adapter (composes with `testing` nullable infrastructure).
- **With `code-review`**: dimension `performance` includes LLM cost surface — flags missing cache, missing batch consideration, unjustified Opus, missing `max_tokens`.
- **With `commit-discipline`**: LLM-call-adding commits' "why" includes the cost-discipline decisions (model tier, caching, batch).
- **With `gstack:/benchmark-models`**: escalation for "which model is best for this surface?" — runs the same prompt through Claude / GPT / Gemini and reports cost + quality.

## Anti-rules

- MUST NOT decide which provider (Anthropic vs OpenAI vs Gemini) — that is a project-level decision documented in `docs/DECISIONS.md`.
- MUST NOT impose a model-router abstraction by default.
- MUST NOT silently allow Opus without justifying comment.
- MUST NOT permit unbounded retries.
- MUST NOT permit `max_tokens` unset.
- MUST NOT log full prompt content.
- MUST NOT cache prompts containing user-specific PII without explicit per-user cache keys.

## Verification checklist for shipping this skill

- [ ] SKILL.md drafted at target ≤ 350 LOC
- [ ] Frontmatter `description` ≤ 200 chars, mentions Sonnet default + prompt caching + batch for non-interactive + token budgets + structured logs as headline
- [ ] `.source` file lists Anthropic caching + batch + model card + gstack/claude-api + LangChain router patterns
- [ ] `llm-cost-precommit` hook drafted at ≤ 100 LOC, smoke-tested
- [ ] Matrix row in `plans/skill-decision-matrix.md` matches this audit note
- [ ] Skill tests in `test/llm-cost-discipline/` cover: Opus-without-comment detection, missing-max-tokens detection, missing-cache-control detection on qualifying prompts
- [ ] No overlap > 30% with `claude-api` (this skill = discipline / when; claude-api = SDK mechanics / how)
- [ ] No overlap > 30% with `security-guidance` (this skill = cost / models; security-guidance = trust boundaries / PII)
- [ ] Sister-doc parity: AGENTS.md flavor matches CLAUDE.md flavor
- [ ] Audit status moved from `reviewed` → `shipped` after first project consumes the skill

## Open questions

- **Default token budget heuristic per task class**: chat (max_tokens 1024), classification (256), generation (4096). Document defaults in SKILL.md; per-call override.
- **Multi-provider support (Anthropic + OpenAI + Gemini)**: abstract behind a thin shim? Lean: NO for default. Per-project decision via ADR if a project picks multi-provider.
- **Cache TTL default**: 5 minutes (Anthropic default) vs 1 hour (opt-in). Lean 5 minutes for most cases; 1 hour for stable system prompts that rarely change.
- **Cache key per-user vs shared**: shared system prompt + per-user RAG context is the typical split. Document in SKILL.md.
- **Cost dashboard surface**: Sentry custom metric vs OTel attribute on traces. Lean: structured log line per call + Sentry custom metric for aggregates. Defer dashboard mechanics to `observability` pack.
- **Switching default from Sonnet to Haiku as Haiku improves**: monitor Anthropic model card per release. Update SKILL.md as defaults shift. Process: pin model version in code, periodic review.


## Native model choice (DEV-1110, 2026-10-23)

Clarify that API call-site budgets remain here while native coding-agent model choice belongs to void-orchestrate. Existing application API policy and hooks are unchanged; no pricing refresh or provider router is part of DEV-1110.
