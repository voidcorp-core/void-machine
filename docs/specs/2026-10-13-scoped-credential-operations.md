---
title: Scoped secret operations without exposing values to the agent
date: 2026-10-13
status: approved
author: Folpe + Codex
ticket: DEV-1020
related: [docs/ARCHITECTURE.md]
---

# Scoped secret operations

## Intent and observed restriction

Users need an agent to create and store credentials through available CLI, API or MCP tools,
using Infisical or an equivalent secret manager. The session-start context currently says
`never edit secrets or keys`, forbidding even explicitly authorized external operations.
The user requested a bounded exception and included it in the current publication.

## Chosen contract

Replace the blanket prompt prohibition with a provider-neutral rule. An agent may orchestrate
secret creation, storage or rotation only under explicit user authorization that identifies the
operation, affected service/account/project/environment, credential names or bounded set, and
approved destination manager. Authorization lasts for that operation, not future unrelated work.
Existing precise consent is reused; a broad request to deploy or fix a project is not consent.
Revocation or deletion requires its own explicitly requested scope. Newly created credentials
receive only the required privileges and an appropriate bounded lifetime; unclear permissions or
lifetime require clarification, never an assumed administrator or unrestricted credential.

The secret value stays outside the model context. Prefer provider-side generation and storage,
opaque references, or a verified direct process-to-manager transfer. Use only documented tool
capabilities whose success AND error paths do not expose values. CLI, API and MCP are transports,
not blanket exemptions. A tool returning plaintext in its model-visible response is unsuitable;
redacting a final answer after the tool returned a secret does not satisfy this contract.

Do not put plaintext values in prompts, tool arguments visible to the model, command argv or
history, source, files in the repository, temporary plaintext files, logs, traces, screenshots,
reports or review evidence. Do not request a secret through chat. Authentication uses the
provider's established secure flow or existing permitted credentials, without printing them.

Verify success with non-sensitive metadata: destination, resource identifier, version and status.
Do not read a secret back to prove it was stored. If the destination is unavailable, the operation
is ambiguous or the safe transfer capability cannot be established, stop that operation and ask
for the missing scope or a secure user/provider action. Preserve existing credentials. After an
uncertain mutation, reconcile metadata before a retry; do not blindly regenerate or rotate.

Runtime permissions, sandboxing, hook refusals and higher-priority instructions remain binding.
The exception never permits bypassing them or changing policy during an operation to unblock it.
This implementation changes future shipped instructions; it does not authorize touching real
credentials during the current development session.

## Responsibility and scope

The session-start context states the short rule and points to `void-security-guidance` for its
operational conditions. That existing standard owns the detailed policy. No new skill, vault,
permission registry, CLI command or provider-specific integration is introduced.

Protected-file and secret-content enforcement remain active. This release makes no claim that
shell inspection or MCP hooks can mechanically prove a safe external transfer. Provider/runtime
access controls and the verified chosen tool own execution; instruction compliance owns the
selection and scope checks. Application runtime configuration and customer BYO-key storage keep
their existing separate rules.

## Alternatives considered

1. **Recommended: scoped orchestration using existing secure tools.** Meets the user need without
   routing values through the model or adding a provider maintenance burden.
2. **Full broker with opaque secret handles and adapters.** Stronger uniform execution controls,
   but a separate product and substantial integration/authentication surface; deferred.
3. **Human-only provisioning, agent handles references.** Useful fallback when a safe transport
   is unavailable; keeping it mandatory would retain the current blocker.

## Verification and release

Strict TDD for the emitted context change. Existing protected-file and secret-content behavioral
suites must still pass. Regenerate shipped assets through the repository's normal builders.
Review the source policy, emitted context and packaged skill for consistency and anti-bloat.

Run isolated read-only native policy scenarios with synthetic non-secret fixtures: scoped safe
operation; missing authorization; broad consent only; wrong destination/environment; MCP echoing
values; success/error output leakage; attempted file/hook bypass; uncertain write; metadata-only
verification; higher-priority refusal. Record actual decisions without claiming a live provider
integration or exposing credentials. Security review must distinguish instruction evidence from
mechanical enforcement. Local tests/builds run sequentially with one test worker.

Publication waits for this change and the existing release qualification gates. No secret manager
account or live credential is needed to qualify the policy change.

## Sources

- `packages/hook-runner/src/lifecycle/context.ts`: session instruction owner.
- `packages/hook-runner/src/rules/protected-file.ts`: protected local paths.
- `packages/core/skills/void-security-guidance/SKILL.md`: security policy owner.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html): least privilege, automation, lifecycle and audit without value leakage.
