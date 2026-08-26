---
schemaVersion: 1
id: "adr:14b9f033-ceab-4738-a148-62c30220239c"
createdAt: "2026-07-27T09:54:17.140Z"
title: "Resume missions from receipts and stable idempotency keys"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# Resume missions from receipts and stable idempotency keys

## Context

An interrupted mission may have crossed an external side-effect boundary before its local journal
records the outcome. Replaying from the last local cursor can therefore duplicate an operation;
assuming it succeeded can silently skip required work. The provider-neutral mission engine must
also remain pure and cannot inspect or mutate an external system while reducing events.

## Decision

Resume from the append-only event journal and durable side-effect receipts. Every retry uses the
same stable idempotency key; a matching receipt advances to logical finalization without invoking
the effect again. Missing or conflicting proof fails closed. The pure engine returns the next
action, while runtime adapters own I/O and must honor the supplied idempotency key.

Resume checkpoint events use a deterministic event ID. The sequenced writer resolves concurrent
retries under its existing lock, returns the already-matching event, and rejects an ID reused for a
different draft.

Recovery is bounded: one transient retry with reduced context, then a same-tier replacement,
then sequential execution only where independence is explicitly non-essential. Otherwise the
mission becomes `blocked`. Fast mode is restricted to explicit low risk; unknown/medium work is
promoted to team and high-risk work to fortress.

## Consequences

Positive:

- Crash replay is deterministic and already-proven effects are not dispatched again.
- Runtime adapters share one provider-neutral recovery and escalation contract.
- The system does not mislabel an unrecorded side effect as exactly-once proof.
- Mandatory quality passes survive every budget and recovery transition.

Negative:

- External adapters must implement idempotency for the stable key and persist a receipt.
- A crash after an effect but before its receipt may retry the key, so a non-idempotent adapter is
  non-conformant and cannot claim safe recovery.
- Corrupt, conflicting, or discontinuous journals block progress until repaired or investigated.

## Alternatives considered

- **Replay the last local action with a new identifier**: rejected because it can duplicate an
  already-applied external mutation.
- **Assume an in-flight action succeeded after a crash**: rejected because required work could be
  silently skipped without proof.
- **Execute side effects inside the mission engine**: rejected because it couples the domain core
  to providers and makes deterministic replay impossible.
- **Call the contract exactly-once without an adapter receipt**: rejected because a local process
  cannot prove atomicity with an arbitrary remote system.

## Reversal cost

Medium. The event journal remains append-only, but replacement semantics must preserve the stable
idempotency key or migrate existing receipts before adapters can adopt another recovery protocol.
