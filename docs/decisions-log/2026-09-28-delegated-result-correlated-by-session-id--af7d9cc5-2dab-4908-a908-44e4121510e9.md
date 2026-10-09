---
schemaVersion: 1
id: "adr:af7d9cc5-2dab-4908-a908-44e4121510e9"
createdAt: "2026-09-28T11:29:18.777Z"
title: "A delegated run's result is correlated by native session id, not by environment"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# A delegated run's result is correlated by native session id, not by environment

## Context

The supervised delegation spec (`docs/specs/2026-09-28-supervised-agent-delegation.md`) collects
a delegated Claude session's final message with a Stop hook, and says the hook acts only when
`VOID_MACHINE_RUN_ID`, set in the environment of `claude --bg`, names its run. A probe on Claude
Code 2.1.283 on 2026-09-28 disproved that premise. Session A was dispatched with
`VOID_MACHINE_RUN_ID=hold-A` and kept the background supervisor alive; session B, dispatched
afterwards with `VOID_MACHINE_RUN_ID=probe-4`, read `hold-A`. A background session inherits the
environment of the supervisor that hosts it, not the environment of the command that dispatched
it. `--settings '{"env":{...}}'` did not reach the session either, and `--session-id` is ignored
with `--bg`. As soon as two delegated runs coexist, which is the normal case, the environment
would attribute one run's result to another.

The hooks documentation gives every hook a `session_id` and recommends `last_assistant_message`
on Stop for the final text. `claude agents --json --all` lists each background session with its
short id and full `sessionId`.

## Decision

The kernel correlates a delegated run's result through the native session id: once the runtime
lists the run's session, the registry writes a claim `<machine>/agents/sessions/<sessionId>.json`
that carries the result path, and the `lifecycle delegation-result` Stop hook, bundled into
`_void-hook.mjs`, writes `last_assistant_message` to that path, or parks it by session id while a
run still waits for its binding.

## Consequences

Positive:

- The correlation holds with any number of concurrent runs and across supervisor restarts,
  because the session id is the native identity the hook input already carries.
- The hook needs no environment variable and runs wherever the rest of the harness floor runs,
  Windows included, since it is TypeScript in the bundle rather than a shell script.
- A result recorded before the kernel binds its session is not lost: it is parked and adopted.

Negative:

- The kernel and the separately built hook bundle share one file contract (claim location and
  `{ resultPath }`); a test from both sides pins it.
- The claim and the result live in a directory a delegated work agent can write, so a result is
  untrusted data: `accept` takes it only when its session id is the bound one and it is newer
  than the turn start, and it never authorizes anything.

## Alternatives considered

- **Environment variable per dispatch (the spec's design):** disproved by the probe above.
- **`--settings` env or `--session-id` at dispatch:** neither reaches a background session.
- **Reading the transcript after the turn:** the hooks documentation says the transcript may lag
  the final message at Stop time; `last_assistant_message` is the supported channel.

## Reversal cost

Low. The claim is internal to the kernel and the bundled hook; replacing it changes two modules
and their shared test, and no consumer file format outside `.void/machine/` depends on it.
