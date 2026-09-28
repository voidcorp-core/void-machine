---
schemaVersion: 1
id: "adr:35ca0269-ba56-45da-8621-898d9e3a0fca"
createdAt: "2026-09-28T22:18:56.487Z"
title: "A delegated Codex run owns a detached app-server reached over a Unix-socket WebSocket"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# A delegated Codex run owns a detached app-server reached over a Unix-socket WebSocket

## Context

The supervised delegation spec (`docs/specs/2026-09-28-supervised-agent-delegation.md`) runs a
delegated Codex agent as a thread of a `codex app-server` owned by the kernel, with its socket in
the run's directory, and forbids the shared app-server daemon, whose proxy did not answer on this
machine (daemon 0.153.4 against CLI 0.155.1). The earlier probe drove the app-server over stdio.

Every `void-machine agents` command is a short process: `dispatch` must answer at once, and
`wait`, `status`, `send`, `stop` and `accept` come later from other processes. A stdio pipe dies
with the process that holds it, so no command can own a stdio app-server for the whole run.

Probes on Codex CLI 0.155.1 on 2026-09-28 established:

- `codex app-server --listen unix://PATH` serves the same JSON-RPC as WebSocket text frames over
  the Unix socket (HTTP Upgrade). A client that disconnects right after `turn/start` leaves the
  turn running; a new connection's `thread/read` with `includeTurns` sees it progress and end, with
  the final `agentMessage` (phase `final_answer`) conforming to the turn's `outputSchema`.
  `turn/steer` and `turn/interrupt` work from a later connection.
- A Unix socket address holds 104 bytes on macOS: a socket under
  `<checkout>/.void/machine/runs/<mission>/agents/<run>/` is refused (`EINVAL`).
- The Codex `workspace-write` sandbox makes the temporary directories writable, so a socket there
  is within reach of a delegated worker, and the app-server authenticates no Unix-socket client.
- Node's built-in WebSocket cannot open a Unix socket; `ws` 8.21.0 documents the
  `ws+unix:<path>` address, and is already in the lockfile.

## Decision

Each delegated Codex run starts its own `codex app-server --listen unix://<socket>`, detached so
it outlives the dispatching command; every later command connects for one bounded exchange
through `ws`, and the process ends with the run (stopped, released when the run closes, never
claimed once it is gone). The socket lives in `~/.void-machine/s/`, a 0700 directory of the user,
named from the run by a hash, and the run's process record (pid, start time, phase, thread, turn)
lives in `<machine>/agents/codex/`.

## Consequences

Positive:

- One owned process per run: no shared daemon, no version skew between a daemon and the CLI.
- The driver is the process itself. When it is gone, or its pid now names another process (start
  time and command line are checked), the adapter reports the run absent and the kernel moves it
  through `reconciling` to `failed`: `status` never claims to supervise it.
- The record is written before each launch step that can fail, so a crash mid-dispatch leaves a
  thread the kernel finds by reference rather than an untracked process.
- The socket path is derived from the run name and never read from a file an agent could edit.

Negative:

- The spec's socket location is not held: the socket sits in the home directory, the record in
  the machine directory.
- `ws` becomes a runtime dependency of the adapters layer, bundled into the published CLI.
- A run whose coordinator never accepts nor stops keeps an idle app-server until it does.
- Codex delegation does not run on Windows yet: the adapter refuses there with the cause.

## Alternatives considered

- **A stdio app-server under a detached Node driver that relays requests:** a second
  long-lived process and a protocol of our own between commands and the driver, to reach what
  the app-server's own Unix transport already offers.
- **The shared app-server daemon:** its proxy did not answer here, and its version lagged the CLI.
- **A socket in the run directory, or in the temporary directory:** the first exceeds the socket
  address limit; the second is writable by a delegated Codex worker.
- **A hand-written WebSocket client on `node:net`:** re-derives framing, masking and the upgrade
  handshake that `ws` already implements and tests.

## Reversal cost

Low. The choice is confined to one adapter behind the runtime port; replacing the transport or
the ownership model changes `codex-app-server.ts` and its contract test, not the kernel.
