---
name: void-llm-cost-discipline
description: Sonnet default (Opus needs comment), prompt caching for >1024-token prompts, batch API for non-interactive, max_tokens declared, bounded retries, no full prompts in logs. Use on LLM API calls.
---

# llm-cost-discipline — voidcorp craftsman edition

LLM costs scale with usage. A 1k-token system prompt re-billed on every call is 90% waste with caching. Opus everywhere is 5× Sonnet for marginal gains. Unbounded retries on a refusal burn tokens. This skill makes cost a first-class design concern at every LLM call site.

This skill governs application LLM API call sites, not coding-agent runtime selection;
`void-orchestrate` owns native agent model choices.

**Attribution**: see `.source`. Composed with the `claude-api` skill (SDK mechanics). Foundation: Anthropic prompt caching docs + batch API + model card pricing.

---

## Model selection — Sonnet default

| Model | When |
|---|---|
| **Sonnet 4.6** | DEFAULT. Everyday agentic work, code generation, chat, multi-step reasoning. Cost-effective and capable. |
| **Haiku 4.5** | High-volume classification, extraction, retrieval-grade Q&A. ~3× cheaper than Sonnet. |
| **Opus 4.7** | Only when justified at the call site with a comment. High-stakes reasoning, hard QA, complex code generation where Sonnet is insufficient. ~5× Sonnet cost. |

```typescript
// allowed
await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  ...
});

// allowed (with justification)
// using Opus because legal-document drafting needs the reasoning depth
await anthropic.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 4096,
  ...
});

// banned (Opus without comment)
await anthropic.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  ...
});
```

The companion hook `llm-cost-precommit` warns on `model: 'opus'` without `// using Opus because` in the diff.

### When to escalate

If you cannot decide which model fits without testing, benchmark the candidate models on the actual prompts — run the same prompt through each and compare cost + quality before committing.

---

## Prompt caching — ENABLED for >1024 tokens at >1/hour rate

```typescript
await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [
    {
      type: 'text',
      text: longSystemPrompt,                  // 5k tokens of system prompt
      cache_control: { type: 'ephemeral' },    // CACHE THIS
    },
  ],
  messages: [...],
});
```

The cache hit reduces per-call cost by ~90% for cached blocks. Default TTL is 5 minutes; opt into 1-hour caching for stable system prompts.

### What to cache

- System prompt (especially if > 1024 tokens)
- Tool definitions
- RAG context that is shared across requests in a session
- Few-shot examples

### What NOT to cache

- User-specific content unless the cache key is also user-specific
- Content containing user PII without explicit per-user scoping (composes with `void-security-guidance`)

The companion hook `llm-cost-precommit` warns on `system` / `tools` arrays > 1024 tokens without `cache_control`.

Composes with the `claude-api` skill for cache mechanics.

---

## Batch API for non-interactive workloads

```typescript
// banned (1000 individual real-time calls for overnight processing)
for (const doc of largeBatch) {
  await anthropic.messages.create({ model: 'claude-sonnet-4-6', ... });
}

// allowed (50% discount via batch)
const batch = await anthropic.messages.batches.create({
  requests: largeBatch.map(doc => ({
    custom_id: doc.id,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: docPrompt(doc) }],
    },
  })),
});
// poll until complete (24h SLA, usually faster)
```

50% discount when latency budget allows. No excuse not to use it for overnight processing, bulk analysis, async classification, periodic reports.

### Heuristic

- User-facing interactive (chat, agent UI) → real-time, streaming
- Background, batch-processable, latency budget > 1 hour → batch API
- Mixed → batch the background portion; real-time the user-facing portion

---

## Token budgets — declared per call site

```typescript
// banned (max_tokens unset)
await anthropic.messages.create({ model: '...', messages: [...] });

// allowed (explicit budget)
await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,                                  // explicit cap
  // estimated input: ~3000 tokens system + ~500 user → ~3500 in
  messages: [...],
});
```

Default budgets per task class:

| Task | `max_tokens` default |
|---|---|
| Chat reply | 1024 |
| Classification / structured extraction | 256 |
| Code generation | 4096 |
| Long-form generation | 4096 |
| Tool-use orchestration | 1024 |

Override per call site with rationale.

---

## Retries — bounded with backoff + jitter

```typescript
// banned (unbounded)
while (true) {
  try { return await anthropic.messages.create(...); }
  catch { /* retry */ }
}

// allowed (composed with async-safety)
await withRetry(
  () => anthropic.messages.create(...),
  {
    maxAttempts: 3,
    backoff: 'exponential-with-jitter',
    // do NOT retry on these:
    skipRetryOn: (err) => err.type === 'invalid_request_error' || err.type === 'prompt_injection_refusal',
  },
);
```

### Banned

- Unbounded retries
- Retrying on `invalid_request_error` (the request is malformed; retrying does nothing)
- Retrying on prompt-injection refusal (different failure mode; treat as expected failure)

---

## Fallback model for critical paths

```typescript
async function generateInvoiceDraft(input: InvoiceInput): Promise<Result<Draft, ...>> {
  const primary = 'claude-opus-4-7';
  const fallback = 'claude-sonnet-4-6';
  try {
    return await callLlm(primary, input);
  } catch (err) {
    if (isQuotaOrOutage(err)) {
      logger.warn({ primary, fallback, err }, 'llm_fallback');
      return await callLlm(fallback, input);
    }
    throw err;
  }
}
```

Document the fallback at the call site. If no fallback is justified, document why ("acceptable to fail; user retries manually").

---

## Streaming — for user-facing interactive only

```typescript
// chat / agent UI → stream
const stream = await anthropic.messages.stream(...);
for await (const event of stream) { /* send to UI */ }

// batch / programmatic → no stream
const response = await anthropic.messages.create(...);
return parseStructured(response.content);
```

Streaming overhead is wasted on machine consumers.

---

## Structured logging per LLM call

```typescript
// composes with void-observability
logger.info({
  model: 'claude-sonnet-4-6',
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
  cacheReadInputTokens: response.usage.cache_read_input_tokens,
  latencyMs: Date.now() - startMs,
  endpoint: 'checkout_classifier',
}, 'llm_call');
```

NEVER log the full prompt content (PII / secret risk, composes with `void-security-guidance`).

The Sentry / Vercel Analytics integration in `pack-nextjs` aggregates cache hit rate, model mix, cost-per-endpoint into a cost dashboard.

---

## LLM I/O is untrusted (composes with void-security-guidance)

- Prompt injection: user-controlled text is data, not instructions. Separate system from user clearly. Defense in depth: tool invocations re-validate at the tool boundary.
- Output hallucination: validate with Zod if parsing structured. Never `eval()`, never `innerHTML`, never SQL / shell with LLM output.

See `void-security-guidance` skill for full LLM trust-boundary patterns.

---

## Composition with other skills

- **With the `claude-api` skill**: SDK mechanics live there; this skill = the discipline.
- **With `void-observability`**: cost-per-call structured logs feed the dashboard.
- **With `void-security-guidance`**: prompt content NEVER in plain logs. LLM I/O untrusted.
- **With `void-async-safety`**: retries with backoff + jitter. LLM call failures handled with idempotency discipline.
- **With `void-hexagonal-architecture`**: LLM SDK at an adapter behind `LlmPort`. In-memory adapter for tests.
- **With `void-code-review`**: dimension `performance` includes LLM cost surface.
- **Model comparison**: escalation for "which model is best for this surface?" — benchmark the candidates on real prompts (cost + quality).

---

## Companion hooks

- `llm-cost-precommit` (pre-commit on files matching `<config.paths.ai>` or importing `@anthropic-ai/sdk`) — warns on Opus without justifying comment, missing `max_tokens`, missing `cache_control` on qualifying prompts. See `../../hooks/`.

---

## Anti-rules

- MUST NOT decide which provider (Anthropic vs OpenAI vs Gemini) — that is a project-level ADR.
- MUST NOT impose a model-router abstraction by default.
- MUST NOT silently allow Opus without justifying comment.
- MUST NOT permit unbounded retries.
- MUST NOT permit `max_tokens` unset.
- MUST NOT log full prompt content.
- MUST NOT cache prompts containing user-specific PII without per-user cache keys.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Sonnet seems insufficient | Quantify it: benchmark Sonnet vs Opus on the actual prompts (cost + quality) before upgrading. |
| Cache hit rate low | Prompt structure problem — variable content interleaved with stable. Restructure to put stable blocks first with `cache_control`. |
| Cost budget exceeded | Audit via cost dashboard. Top 3 endpoints. Apply caching, batching, model downgrade where quality allows. |
| Token budget too small | Validate via void-observability — what's the actual output size? Adjust budget OR truncate the input intelligently. |
| Latency too high | Streaming for user-facing. Batch for background. |

---

## Final rule

```
Every LLM call → Sonnet by default, cache >1024 tokens, batch non-interactive, max_tokens set, retries bounded,
                 fallback declared, structured cost logs, no prompt content in logs.
Otherwise → it is not voidcorp llm-cost-discipline.
```

The discipline is small. The savings compound. A single agentic feature can save 70%+ via caching + Sonnet default + batch.
