---
schemaVersion: 1
id: "adr:914e4727-b71c-41c2-9272-d038b0a73bd8"
createdAt: "2026-10-09T15:28:25.271Z"
title: "Guard global Herdr session relay without project telemetry writes"
status: proposed
deciders: []
supersedes: []
---

# Guard global Herdr session relay without project telemetry writes

## Context

DEV-1017 replaces the temporary cockpit guard around Herdr's native Codex session
hook. The global SessionStart route also runs outside installed projects. Ordinary
hook-runner lifecycle handling resolves a project and records an event; this route
must not create project or home journals merely to prove process ownership.

The [bounded specification](../specs/2026-10-09-native-herdr-cutover.md) preserves
Herdr's ownership of session publication and the original payload bytes. ORCH
authorized this single documentary extension on 9 October, after mission admission.
The frozen ticket and plan remain unchanged. This proposed record awaits actual
preparation advice and does not authorize personal activation.

## Decision

Propose a narrow `lifecycle herdr-session codex` branch in the existing portable
hook runner, before project discovery and event recording, that proves foreground
ancestry then invokes the unchanged native Herdr hook once with the original bytes.

The command emits only bounded fixed diagnostics and any native stdout. It writes
no harness telemetry, registry or session state. Existing lifecycle telemetry and
the separate Herdr metadata projection retain their behavior. No project hook is
added by default. At deliberate personal activation, exactly one global guarded
route replaces cockpit's guard and any parallel unguarded native SessionStart call.

## Consequences

Positive:

- One existing distribution boundary ships the guard; no separate installer,
  personal wrapper or daemon is introduced.
- Outside an installed project the guard has no harness state-write effect.
- Native session checks and publication stay with the Herdr-managed script.

Negative:

- This narrow global route has no `hook.completed` project event. Its bounded
  diagnostic codes and fixture-based relay evidence are the observable contract.
- Reinstalling a native integration can restore an unguarded hook entry. The
  migration must inventory effective entries and refuse drift before activation.
- The ancestry check relies on local process observations, not an atomic OS
  authorization primitive. It protects against inherited stale pane context,
  not a malicious same-user process controlling the local executables.

## Alternatives considered

- Ordinary lifecycle handling with unconditional telemetry: creates unrelated
  project state when the hook is invoked globally, violating this mandate.
- Add only a project hook: cannot suppress an existing unguarded global native
  call, and risks duplicate publication in an installed project.
- Ship a second standalone wrapper: duplicates byte handling, subprocess limits
  and the distribution boundary without a separate owner or current requirement.
- Wait for the upstream fix only: keeps cockpit as a dependency despite the
  explicitly requested temporary harness guard. Reassess when the native fix is
  available and proves the same behavior.

## Reversal cost

Low for the code: the isolated branch can be removed once an upstream integration
proves ownership itself. Personal route changes still require an exact diff,
private backup, content-hash drift check and rollback; no active configuration is
changed by this proposal. Accepted records remain immutable under repository rules.
