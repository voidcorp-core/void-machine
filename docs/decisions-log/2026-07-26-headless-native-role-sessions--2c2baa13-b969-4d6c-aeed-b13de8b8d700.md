---
schemaVersion: 1
id: "adr:2c2baa13-b969-4d6c-aeed-b13de8b8d700"
createdAt: "2026-07-26T18:27:35.751Z"
title: "Launch fresh native role sessions for headless certification"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Launch fresh native role sessions for headless certification

## Context

Certification must prove that each required specialist ran in an isolated native context. Claude's
headless CLI exposes direct project-agent selection. In the current Codex headless runtime, asking a
parent `codex exec` session to spawn a custom subagent does not yield an attributable child-session
completion reliably. Accepting parent prose or simulated agent names would turn a runtime defect
into a false-green certification.

## Decision

For headless certification, launch one fresh native CLI session per installed specialist definition:
Claude uses project `--agent`; Codex compiles the installed TOML agent's developer instructions into
an ephemeral, read-only `codex exec` role session. Disable unrelated tools, require the same JSON
Schema, and normalize only attributable native output into the canonical event stream. This is an
eval adapter boundary; interactive `ticket-runner` continues to prefer the runtime's native subagent
primitive when it can prove fresh context and role identity.

## Consequences

Positive:

- Both runtimes produce independently attributable specialist evidence without impersonation.
- Certification remains replayable through the provider-neutral event contract.
- The exact installed specialist instructions, sandbox, and output schema are exercised.

Negative:

- The Codex adapter must validate and compile an installed TOML definition into CLI arguments.
- Headless certification does not exercise Codex parent-to-child delegation until that primitive is
  reliable and emits attributable completion events.
- Runtime CLI changes can require adapter maintenance.

## Alternatives considered

- **Parse a parent session's prose as three reviews**: rejected because role labels are not evidence
  of independent contexts and can conceal missing work.
- **Require parent-spawned Codex subagents today**: rejected because the current headless path does
  not reliably emit an attributable child completion.
- **Skip Codex certification**: rejected because cross-runtime parity is an acceptance criterion.
- **Run one shared specialist session**: rejected because context reuse invalidates independence and
  makes cross-role contamination undetectable.

## Reversal cost

Low. Once Codex headless subagent delegation reliably exposes child identity and structured output,
the adapter can switch its invocation strategy without changing the event schema, scorer, or
controller.
