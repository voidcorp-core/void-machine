---
schemaVersion: 1
id: "adr:a8bc006f-7264-4788-b804-62ae23e2214a"
createdAt: "2026-10-13T11:39:19.711Z"
title: "Authorize scoped external credential orchestration without model-visible values"
status: accepted
deciders: ["Folpe"]
supersedes: []
---

# Authorize scoped external credential orchestration without model-visible values

## Context

The session-start floor prohibits even user-authorized external credential operations.
Folpe approved DEV-1020 and its implementation in this release on 13 October 2026:
[spec](../specs/2026-10-13-scoped-credential-operations.md),
[plan](../plans/2026-10-13-scoped-credential-operations-plan.md).
Local secret-file protection and keeping values outside model context remain mandatory.

## Decision

Permit explicitly scoped external creation, storage or rotation through verified secure tools,
with the detailed contract owned by `void-security-guidance` and referenced by session context.

Consent identifies the operation, service/account/project/environment, bounded credential names
and destination manager; broad delivery or autopilot consent is insufficient. New credentials
have least privilege and an appropriate bounded lifetime. Revocation and deletion require their
own explicit scope. The value never enters model-visible input/output, command arguments,
plaintext files, logs or evidence. Verify success through metadata and reconcile uncertain
mutations before retrying. Stop when scope or confidential transfer cannot be established.

Runtime permissions, sandboxing, role restrictions, hook refusals and higher-priority rules
remain binding. This is a future shipped instruction change, not authorization for a real
credential operation in this development session.

## Consequences

Positive:

- Users can authorize useful provider-neutral operations without sharing credential values.
- Existing local guards remain unchanged; the daily security standard stays the policy owner.

Negative:

- Instructions do not mechanically prove remote transport confidentiality. The selected
  provider/runtime tools must establish confidential success and error paths before execution.
- Native synthetic scenarios qualify instruction behavior, not a live provider integration.

## Alternatives considered

- A credential broker with opaque handles could enforce a uniform transport, but would add a
  separate product, authentication surface and provider maintenance beyond this policy change.
- Human-only provisioning remains the fallback for unsuitable tools; requiring it universally
  preserves the blocker even when authorized safe orchestration is available.

## Reversal cost

Low for the shipped instructions: supersede this decision and regenerate assets. This change
introduces no provider state, dependency or credential migration to unwind.
