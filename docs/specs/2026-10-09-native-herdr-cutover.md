---
title: Native Herdr session ownership guard and cutover preparation
date: 2026-10-09
status: approved-scope
ticket: DEV-1017
author: Folpe + Codex WORK-1
---

# Scope and authority

The 9 October mandate authorizes the already requested temporary session guard
and a reviewable migration proposal before DEV-1016 closes. It does not authorize
personal activation or completion of the full cockpit removal acceptance criteria.
WORK-1 is the sole writer; ORCH dispatches preparation specialists and the exact
commit reviewer. Preparation returns must precede tests and production changes.

## Existing ownership and sources

The hook runner owns bounded subprocess adapters in `src/lifecycle/`; its official
builder produces `packages/core/hooks/_void-hook.mjs`. Herdr owns session publication.
The guard must neither publish sessions itself nor clone daemon or session state.

- [Herdr v0.9.3 integration 8](https://github.com/herdrdev/herdr/blob/v0.9.3/src/integration/assets/codex/herdr-agent-state.sh)
  preserves inherited thread and transcript checks, but has no foreground ancestry check.
- [Upstream issue 4814](https://github.com/herdrdev/herdr/issues/4814) is already open;
  do not create a duplicate.
- `void-cockpit/plugin/bin/cockpit`, `cmd_codex_session`, lines 888–906, supplies
  the foreground ancestor contract. Its shell payload capture drops trailing newlines;
  the replacement instead preserves the original bounded bytes.
- `docs/ARCHITECTURE.md`, portable hook runtime and root ownership;
  `docs/ORCHESTRA.md`, central ownership; `packages/hook-runner/src/cli.ts`, lifecycle
  telemetry; `packages/hook-runner/src/lifecycle/herdr-metadata-executor.ts`, bounded
  existing Herdr subprocess pattern.

## Guard contract

1. Only explicit runtime `codex` and payload `hook_event_name: SessionStart` are
   actionable. Require Herdr environment, pane identity and native hook presence.
   Resolve the native script under `CODEX_HOME`, otherwise the user's `.codex`.
   Do not alter that Herdr-managed script or weaken its existing checks.
2. Query `herdr pane process-info --pane <claimed-id>` with structured argv and
   `shell: false`. Validate the bounded JSON and every foreground PID as a positive
   safe integer greater than one. Empty, partial, malformed or ambiguous evidence
   refuses relay. Never recover a PID from a diagnostic string.
3. Walk this hook process's parents using bounded `ps -o ppid= -p <pid>` calls.
   Allow only when this chain contains a validated foreground PID. Refuse unrelated
   panes, a shared daemon outside the pane tree, cycles, exhausted depth and errors.
   A pane variable alone grants no ownership. This is ancestry evidence, not a
   security boundary against a malicious local user controlling executables.
4. Proposed concrete bounds: existing 1 MiB input ceiling, 256 foreground entries,
   64 parent hops, 256 KiB subprocess output, one 2 s discovery/walk deadline and a
   separate 1 s native relay limit. Every call gets the remaining finite budget;
   no retries. The preparation panel checks these bounds before implementation.
5. After proof, invoke the native hook once with `session` and the untouched input
   Buffer. Preserve native stdout bytes; otherwise stdout stays empty. Operational
   refusal and failure diagnostics are fixed bounded reason codes, never payload,
   transcript, arbitrary subprocess error text or raw native stderr.
6. A native failure or timeout is observable and is never retried. Discovery and
   parent-walk failures never invoke the native script. Once invoked, a native hook
   may already have published before failing; do not claim rollback of that effect.

## Entrypoint and route proposal for preparation

Use `node <accepted-bundle> lifecycle herdr-session codex` as a narrow early branch
of the existing CLI before project discovery and ordinary lifecycle telemetry.
This globally invoked guard must not create home/project journals merely because
an unrelated working directory has no harness install. Keep normal lifecycle
telemetry and the separate `herdr-metadata` projection unchanged.

No project-manifest addition is planned: it would neither suppress an unguarded
global hook nor avoid duplicate invocation. The later personal diff replaces
`cockpit codex-session` with exactly one absolute accepted-bundle command and
removes any parallel direct native SessionStart call. Inventory all effective
global/project entries before activation. Native publication remains behind the
guard. An integration reinstall can restore an unguarded entry; check drift again.

The narrow telemetry exception has a credible alternative (ordinary lifecycle
telemetry). Before accepting that implementation choice, request ORCH's footprint
extension for one collision-free ADR created by `void-machine decisions new`.
No existing accepted decision is edited and no new doctrine is written silently.

## Verification and migration boundaries

Strict TDD uses safe fixture executables and controlled processes, plus the actual
built bundle. Cover allowed ancestry; shared daemon/unrelated pane; empty, malformed,
non-numeric, oversized and failed discovery; cycles/depth; process lookup and relay
timeouts/failures; absent hook; other runtime/event; unchanged whitespace and trailing
newlines; bounded input; quiet output; no state writes outside an installed project.
No test contacts the active Herdr server or personal configuration.

The migration packet contains a concrete hooks-only diff, source hashes, private
backup destinations, drift refusal and exact rollback instructions. It is prepared
under `.void/machine/dev1017/`, never activated by this worker. Preserve the current
cockpit guard until the replacement is accepted and explicitly activated by Folpe.
Sidebar/layout, plugin/collector retirement, personal rules/permissions, server
restart/update and live kill/clear/restart evidence remain separate human gates.
No Cortex changes, remote push, PR, merge, publication or permanent pane changes.
