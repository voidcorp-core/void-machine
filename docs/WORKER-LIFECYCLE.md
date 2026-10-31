# Worker lifecycle contract v1

Void Machine publishes execution observations for external display tools. It does
not discover or call a multiplexer. A plugin owns its tabs/panes; closing a view
never stops a worker. The contract conveys no execution or merge permission.

## Journal

Read `.void/machine/runs/<missionId>/events.jsonl` at the common Git project root,
including when a worker runs in a linked worktree. Each line uses the existing
canonical envelope: `schemaVersion: 1`, `eventId`, mission-local `seq`, `missionId`,
UTC `ts`, `source`, `kind`, `subject` (runId), `correlationId` and `payload`.
Filter by `kind`; unrelated mission events remain in the same journal.

The **payload** also has `schemaVersion: 1`: this versions the worker contract
independently of the journal envelope. Additive payload/output fields are compatible;
readers ignore unknown fields. Removing a field or changing its type/meaning requires
a new contract version. Unsupported versions are diagnosed, never interpreted as v1.

| Kind | Payload fields besides schemaVersion | Meaning |
| --- | --- | --- |
| `worker.dispatched` | runId, missionId, ticket, role, runtime, worktree, branch, attachCommand; optional headSha | Native dispatch acknowledged and assignment bound |
| `worker.state` | runId, state, observedAt; optional reason | Actual observed state change |
| `worker.finished` | runId, outcome | Assignment collected or confirmed terminal |

`runId` is an opaque `run_` identifier, stable across corrections and resume until
closure. A later assignment gets another ID, even for the same ticket/session.
`role` is work/review; `runtime` is claude/codex. `ticket` is the identifier or
`unknown`. `worktree` is a verified absolute path in the same Git project. `branch`
is verified; a detached HEAD uses `detached` and its verified `headSha`.
`attachCommand` is a verified argument array or `unknown`, including when Codex
attachment cannot be established. It is data, never a shell expression or an
authorization. Consumers decide whether executing it is appropriate and permitted.
No brief, transcript, secret or result body belongs in this contract.

`state` is running/blocked/done/failed. A finished turn awaiting the coordinator is
blocked, not done. `done` means final collection, not tests passed, a clean review,
a merge or Cortex's acceptance. `outcome` is succeeded/failed/stopped: succeeded
requires done; the other outcomes require failed. No transition follows finished.
Lost observation stays uncertain; a timeout alone never proves failure or closure.

## Native publication

Reuse the unit's open mission (or obtain one with `mission start`). After real
acknowledgement, observation and collection, the coordinator records each fact:

```sh
void-machine agents record --mission mis_example1234 --event-file observation.json
```

For example, a state observation file is:

```json
{
  "observationId": "native-turn-1-running",
  "kind": "worker.state",
  "payload": {
    "schemaVersion": 1,
    "runId": "run_example1234",
    "state": "running",
    "observedAt": "2026-10-30T10:00:00.000Z"
  }
}
```

A dispatch must precede this state. Keep the same observationId, timestamp and
content when retrying; distinct real transitions get distinct IDs, including
running → blocked → running. Dispatch and finish are unique per assignment.
Conflicting repeats are refused. Finish workers before closing their mission.
Publication failure reports an error; preserve the real run identity and reconcile,
never relaunch to repair telemetry. Native calls outside the instructed publication
path are not automatically captured. These events do not replace review receipts.

Legacy mutating `agents` commands publish saved transitions through the same writer.
`void-machine agents publish <runId>` retries that publication without observing,
launching or stopping the runtime. Existing sessions are not migrated or duplicated.

## Consumer snapshot

```sh
void-machine agents status --json
```

Returns `{ "schemaVersion": 1, "complete": true, "workers": [], "issues": [] }`
when all discovered journals are readable and no published assignment remains open.
Each active entry contains its dispatch metadata, last `state` and `observedAt`.
Before the first state, state is `unknown` and observedAt is dispatch publication time.
Active means dispatched without finished, not a guarantee that a process is alive.
`complete` concerns journal coverage, not native calls outside the publication path.

The command only reads files and resolves the Git project. It never polls a runtime,
inspects a surface, repairs data or writes a journal. Malformed/truncated histories,
unsupported versions, unsafe paths and exceeded bounds return `complete: false`,
nonempty `issues` and exit 1 while preserving readable workers. Consumers must not
interpret a partial empty list as proof there are no active workers, or remove
known views solely because an entry is missing from a partial snapshot. Usage errors
exit 2. The historical `status [runId]` output remains a separate compatibility API.

There is no --watch in v1. A consumer can repeat the snapshot or follow complete
JSONL records, deduplicating eventId and checking seq separately for each mission.
There is no ordering guarantee across missions and no exactly-once transport claim.

The installed herdr-metadata hook is an explicit migration exception (DEV-1134).
Its later removal and the external plugin are separate work; no existing agent or
surface is interrupted by this contract.
