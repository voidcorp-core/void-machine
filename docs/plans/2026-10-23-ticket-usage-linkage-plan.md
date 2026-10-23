# Prospective ticket usage linkage plan

Approved scope: [spec](../specs/2026-10-23-ticket-usage-linkage.md).

1. RED: explicit CLI arguments, scoped-event identity, advisory counts, source interval boundaries,
   concurrency, source-written/reference-failed retry, damaged journals and unchanged quality reducers.
2. Minimal CLI adapters over existing canonical parser, bounded readers and sequenced writer.
3. GREEN: focused unit/integration tests; expose built CLI for coordinator's prospective live binding.
4. Document semantics and bounded workflow use, regenerate assets, verify required gates.
5. Commit normally for one independent exact-candidate review; correct only concrete blockers.

No source hook installation, retrospective receipts, guessed identities, remote writes or merges
by the writer. Unknown native activation remains unknown, never a new completion gate.
