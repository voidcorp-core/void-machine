---
schemaVersion: 1
id: "adr:5dd5306b-721f-4e9b-b592-c765c8eb823e"
createdAt: "2026-09-28T23:57:29.685Z"
title: "Codex runs are threads of the native Codex daemon"
status: proposed
deciders: []
supersedes: []
---

# Codex runs are threads of the native Codex daemon

## Context

The supervised delegation spec (`docs/specs/2026-09-28-supervised-agent-delegation.md`) routes
Codex runs through an app-server process the adapter owns, because a probe on 2026-09-28 found
the shared daemon unusable: its proxy answered nothing and it ran 0.153.4 beside a 0.155.1 CLI.
A first implementation (PR #441, closed without merge) followed that route and had to rebuild
process supervision: a detached server per run, its pid and start time checked through `ps`, a
socket directory of its own, cleanup when a run closes. That is the work Codex's daemon already
does natively, exactly as the Claude adapter leaves its sessions to `claude --bg`'s supervisor.

Probes on 2026-09-29 against Codex 0.158.0, with the daemon aligned on the CLI, removed the
original objection. The daemon listens on `$CODEX_HOME/app-server-control/app-server-control.sock`
and speaks JSON-RPC over a WebSocket on that Unix socket (`codex app-server proxy` only relays
bytes, which is why a line-oriented probe saw nothing). A full cycle works through it:
`initialize`, `thread/start` with `approvalPolicy: never` and a sandbox, `thread/name/set`,
`turn/start` with an `outputSchema`, and a final answer that conforms. A turn keeps running after
the client that started it disconnects; any later connection reads it with `thread/read`, finds it
by name with `thread/list`, steers it, starts its next turn or interrupts it.
`codex resume <thread> --remote unix://<socket>` shows the live thread in a herdr pane. A command
run by a `workspace-write` thread is refused `connect` on that socket (`EPERM`), so a delegated
agent cannot open a thread of its own outside its sandbox.

## Decision

A delegated Codex run is a thread of the Codex app-server daemon, named after the run: every
`agents` command connects to the daemon's control socket for one bounded exchange, and the kernel
starts, owns and ends no Codex process.

## Consequences

Positive:

- Codex supervises its own threads, symmetric with Claude: the adapter holds no state, no pid
  and no socket of its own, and the kernel port has no cleanup hook for an adapter's resources.
- A run is found again from its name alone, so a launch whose acknowledgement was lost is
  reconciled, and never launched twice.
- The same thread is visible to the person through `codex resume --remote` and `codex agents`,
  so the kernel can open it in a pane from the dispatch on.

Negative:

- A run depends on a daemon shared with the person's own Codex use: preflight starts it when it
  is not running, refuses a version different from the CLI's, and names the command that repairs
  it; an unreachable daemon makes runs unreadable, never absent.
- `turn/interrupt` leaves a turn's background commands running. Ending them needs
  `thread/backgroundTerminals/clean`, an experimental method: only the connection that stops a run
  asks for the experimental API, and a stop whose cleaning fails is reported, not assumed.
- Finding a thread by name relies on `thread/list`'s substring search; only an exact name counts,
  and two threads of one name are never guessed apart.
- The daemon unloads an idle thread; its next turn needs `thread/resume` first, which is given the
  role's approval policy and sandbox again.

## Alternatives considered

- **An app-server owned per run (PR #441):** works, but re-implements the daemon's process
  management, and its lifetime, ownership and cleanup become the kernel's bugs to have.
- **`codex exec` per turn:** no steering, no interruption of a live turn, no thread another
  command or a person can attach to.
- **A long-lived void-machine driver holding a stdio app-server:** every `agents` command is a
  short process; a resident driver is a supervisor the harness would have to write and keep alive.

## Reversal cost

Low. The choice lives in one adapter (`adapters/runtime/codex-daemon.ts`) behind the runtime port;
the protocol code (`codex-thread.ts`) is shared with any other transport to the same app-server.
