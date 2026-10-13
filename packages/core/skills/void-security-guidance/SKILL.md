---
name: void-security-guidance
description: Secure defaults at trust boundaries and scoped credential operations. Zod input, app secrets via env, confidential external provisioning, SQL parameterized, Better-Auth, untrusted LLM I/O. Deep audits use void-security-audit.
---

# security-guidance — voidcorp craftsman edition

Security is not "I will think about it later." It is the defaults applied at every trust boundary. This skill codifies the everyday discipline: validate at the boundary, never log secrets, never hand-roll auth, treat LLM I/O as untrusted. Full audit work is delegated to `void-security-audit`. This skill is the daily floor; `void-security-audit` is the periodic ceiling.

**Attribution**: see `.source`. Distilled from citypaul + OWASP cheat sheets; the deep-audit ceiling lives in `void-security-audit`.

---

## Trust boundaries — the unit of discipline

A trust boundary is a place where data crosses from untrusted to trusted (or vice versa). Examples:

- HTTP request → Server Action (untrusted body → typed command)
- Webhook → handler (untrusted signed payload → typed event)
- Form input → service (untrusted form → typed input)
- Third-party SDK response → adapter (untrusted external data → domain type)
- LLM response → consumer (untrusted text → typed output)
- File upload → storage (untrusted bytes → validated content)

At every trust boundary, validate. With Zod. Without exception.

---

## Input validation — Zod at every boundary

```typescript
const CheckoutInputSchema = z.object({
  cartId: CartIdSchema,
  paymentMethod: z.enum(['card', 'bank_transfer']),
});

export async function checkoutAction(formData: FormData) {
  const raw = Object.fromEntries(formData);
  const parsed = CheckoutInputSchema.safeParse(raw);
  if (!parsed.success) return err({ kind: 'invalid_input', issues: parsed.error.issues });
  return checkoutCart(deps, parsed.data);
}
```

### Banned

- `JSON.parse(req.body)` without schema validation
- `req.body as MyType` type assertions
- "Validation happens later in the service" — by the time the service runs, the boundary was crossed

### Composes with `void-typescript-strict`

The validated output is a typed value (often a branded type). No `as` cast required after `safeParse`.

---

## Application secrets — env vars, validated, never logged

### Allowed

```typescript
// in @repo/core/env (or pack-monorepo provided env module)
const env = createEnv({
  server: {
    STRIPE_SECRET_KEY: z.string().min(1),
    DATABASE_URL: z.string().url(),
  },
  // ...
});
```

### Banned

- `process.env.STRIPE_SECRET_KEY` directly in business code (use `env.STRIPE_SECRET_KEY` instead)
- Hardcoded secrets, even in fixtures
- Secrets in commit messages, in logs, in error messages, in Sentry breadcrumbs
- Secrets in `.env.local` files committed to git

### Exception — customer-provided credentials (BYO key)

"Secrets via env" governs the application's OWN secrets (its Anthropic key, its master encryption key, its data-source keys). A credential supplied by a customer (a BYO API key, e.g. a per-tenant data-source key) is application **data**, not the app's infra secret. Env does not fit: it holds one value, not one-per-tenant, and a multi-tenant app cannot scale a customer key into env.

Store a customer-provided credential as data:

- **Encrypted at rest in the DB, scoped per tenant** (AES-256-GCM), never plaintext — a DB dump must not leak every customer's credential.
- **The master encryption key stays in env** (validated `@repo/core/env`). The per-tenant ciphertext lives in the DB.
- **Never returned to a client surface** — expose a masked last-four only, never the full value.

This narrows the rule; it does not weaken it. The app's own secrets still go in env, never the DB.

### Composes with

- `void-observability` — secrets MUST NOT appear in logs. The logger config redacts known-secret keys.
- `pack-monorepo` — provides the `env` module + `gitleaks` pre-commit hook.

Companion hooks (in `pack-monorepo`):

- `gitleaks-precommit` — already in void-starter
- `no-process-env-grep` — fails if `process.env.` appears outside `env.mjs`

---

## Agent-orchestrated external credential operations

This governs creation, storage and rotation through an external secret manager. It is separate
from application runtime configuration and customer BYO-key storage above.

1. **Establish scope before acting.** Require explicit user authorization naming the operation,
   affected service/account/project/environment, credential names or bounded set, and approved
   destination manager. Reuse existing precise consent for that operation only. A broad request
   to deploy, fix a project or run autopilot is not consent. Revocation or deletion needs its own
   explicitly requested scope. New credentials get only required privileges and an appropriate
   bounded lifetime; unclear permissions or lifetime require clarification, never administrator
   privileges or an unrestricted credential by assumption.
2. **Keep values outside model context.** Prefer provider-side generation and storage, opaque
   references, or verified direct process-to-manager transfer. Before invocation, establish from
   documented capabilities that both success and error paths keep values confidential. CLI, API
   and MCP are transports, not exemptions. A tool that returns plaintext to the model is
   unsuitable; redacting the final response after receiving it is too late.
3. **Keep plaintext out of intermediate surfaces.** Never put values in prompts, model-visible
   tool arguments, command argv/history, source, repository files, temporary plaintext files,
   logs, traces, screenshots, reports or review evidence. Never request a secret through chat.
   Authenticate through the provider's established secure flow or existing permitted credentials,
   without printing them.
4. **Verify by non-sensitive metadata.** Check destination, resource identifier, version and
   status. Never read the secret back to prove storage. After an uncertain mutation, reconcile
   metadata before retrying; never blindly regenerate or rotate.
5. **Stop when the conditions cannot be established.** An unavailable destination, ambiguous
   scope or unverified safe transfer stops that operation. Preserve existing credentials and
   request the missing scope or a secure user/provider action.

Runtime permissions, sandboxing, hook refusals, role restrictions (including read-only reviewers)
and higher-priority instructions remain binding. Never bypass them or change policy during an
operation to unblock it. Local protected-file and secret-content guards remain active. These
instructions do not mechanically certify an external transfer: provider/runtime access controls
and the verified tool own execution; the agent owns checking scope and selecting a suitable tool.

---

## SQL / DB — parameterized via Drizzle, no string concat

```typescript
// allowed
const user = await db.select().from(users).where(eq(users.id, userId)).get();

// banned
const user = await db.execute(sql.raw(`SELECT * FROM users WHERE id = '${userId}'`));
```

Composes with `void-migrations` for schema changes.

### Raw queries

Allowed only with explicit boundary review (a `BLOCKER:` review comment must be addressed). When unavoidable, parameterize:

```typescript
const result = await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);  // sql template literal — parameterized
```

---

## Auth — Better-Auth (or Clerk opt-in), never hand-rolled

Better-Auth is the default in `void-starter`. Clerk is the alternative (opt-in). Both handle:

- Password hashing (argon2 / bcrypt)
- Session token generation
- CSRF protection
- Cookie security (`HttpOnly`, `Secure`, `SameSite`)
- Account lockout / rate limiting

### Banned

- Hand-rolled password hashing
- Custom session token generation
- Custom CSRF handling
- "I just need a quick login for the demo" — use the real auth even for demos

If a feature requires auth-related behavior that Better-Auth does not provide, that is a `void-brainstorm` discussion + an ADR — not a workaround.

---

## Cookies — defaults from pack-nextjs

`HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` for sensitive cookies). Never set a cookie directly without these defaults — the helper in `pack-nextjs` enforces.

---

## LLM input is untrusted. LLM output is untrusted.

### Input — prompt injection

User-controlled text inside an LLM prompt is an attack vector. Treat it as data, not instructions.

- Separate the system prompt from user input clearly.
- Sanitize where appropriate (markdown stripping, URL blocking).
- Defense in depth: if the LLM has tools, every tool invocation re-validates inputs at its boundary (do NOT trust because "the LLM checked").

### Output — LLM hallucination as untrusted

LLM responses are untrusted output. Validate with Zod if you parse structured data. Never `eval()` LLM output. Never pass LLM output directly into `dangerouslySetInnerHTML`, `innerHTML`, SQL, shell commands.

### Composes with

- `void-llm-cost-discipline` — cost rules and security rules co-evolve at LLM call sites
- `pack-nextjs` — Server Actions wrapping LLM responses validate before returning

---

## Banned constructs

- `eval()`, `new Function(...)`, `setTimeout(string, ...)`, `setInterval(string, ...)`
- `dangerouslySetInnerHTML` (with allowlist for sanitized markdown rendering — explicit review)
- `child_process.exec` with user-controlled input (use `execFile` with arg array)
- `fs.readFileSync(userPath)` without path validation
- `fetch(userUrl)` from server-side without URL allowlist (SSRF)

The companion hook `no-eval-fn-grep` blocks `eval(`, `new Function(` in staged code.

---

## Logs — no PII, no secrets, ever

```typescript
// banned
logger.info(`user ${user.email} signed in with password ${password}`);

// allowed
logger.info({ userId: user.id, event: 'sign_in_success' });
```

Composes with `void-observability` (structured logs only, never string interpolation).

Logger config (in `pack-monorepo`) redacts known-secret keys (`password`, `apiKey`, `secret`, `token`) at the serialization layer as defense in depth.

---

## When to escalate to `void-security-audit`

This skill is the daily floor. Escalate to `void-security-audit` for:

- Periodic deep audit (monthly): OWASP Top 10 walkthrough, dependency supply chain scan, threat model review, CI/CD pipeline security
- High-stakes feature: payment surface, auth changes, PII handling
- Pre-launch security gate
- Incident response

The `doctrine-critic` agent (in void-machine) flags trust-boundary code in a diff and routes the security pass to `void-security-audit`; `void-security-audit` runs the phase-driven deep audit.

---

## Composition with other skills

- **With `void-hexagonal-architecture`**: trust boundary = adapter ingress. Zod validation happens at the adapter.
- **With `void-typescript-strict`**: validated input is a typed value (branded type for primitives). No `as` cast.
- **With `void-observability`**: structured logs, no PII / secrets, breadcrumbs scoped with anonymized user ID.
- **With `void-async-safety`**: webhook signature verification, replay protection.
- **With `void-llm-cost-discipline`**: cost rules and security rules co-evolve at LLM call sites.
- **With `void-code-review`**: dimension `security` is delegated. `doctrine-critic` flags boundaries and `void-security-audit` does the deep pass.
- **With `void-security-audit`**: full audit on demand. This skill is the daily floor; `void-security-audit` is the periodic ceiling.

---

## Companion hooks (in `pack-monorepo` per-stack)

- `gitleaks-precommit` — secrets in staged diff
- `no-process-env-grep` — `process.env.*` outside `env.mjs`
- `no-eval-fn-grep` — `eval(`, `new Function(` in staged code

(These live in `pack-monorepo` rather than `core/claude/hooks/` because they depend on the consumer having gitleaks installed and a specific `env.mjs` convention.)

---

## Anti-rules

- MUST NOT replace `void-security-audit` full-audit mode (different scope).
- MUST NOT decide threat model boundaries (escalates to `void-security-audit`).
- MUST NOT pretend LLM input/output is trusted.
- MUST NOT hand-roll auth, sessions, password hashing.
- MUST NOT bypass Zod validation at trust boundaries "for performance."
- MUST NOT log PII or secrets, ever.

---

## Final rule

```
Trust boundary → Zod validation. App secrets → env; BYO keys → encrypted tenant data.
External credential operations → scoped consent, confidential transfer, metadata verification.
SQL → parameterized. Auth → Better-Auth.
LLM I/O → untrusted. Logs → no PII no secrets.
Otherwise → it is not voidcorp security-guidance.
```

Security defaults are like seat belts: uncomfortable at first, unimaginable to drive without.
