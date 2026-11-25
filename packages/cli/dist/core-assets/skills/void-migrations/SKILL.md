---
name: void-migrations
description: Zero-downtime Postgres migrations. Two-phase changes, batched backfills, locking analysis, banned DDL patterns, CONCURRENTLY indexes, dev branch test, immutable after merge. Use on DB schema changes.
---

# migrations — voidcorp craftsman edition

A "simple" `ALTER TABLE ADD COLUMN NOT NULL DEFAULT 'x'` on a 10M-row Postgres table locks writes for minutes. A "harmless" `RENAME COLUMN` breaks active requests. This skill encodes the lessons so the first migration in a new project gets them too.

**Attribution**: see `.source`. Foundation: GoCardless "Zero-Downtime Postgres Migrations" + Strong Migrations (Ruby) + Drizzle docs + Neon branching.

---

## The two-phase change pattern

Risky DDL goes through TWO migrations + a deploy step in between:

```
1. Migration A — backwards-compatible schema change
   (add nullable column / add new column / drop NOT NULL constraint)
2. Deploy code that handles both shapes (old AND new)
3. Backfill (batched, with progress logs)
4. Migration B — tighten the constraint
   (add NOT NULL / drop legacy column / rename / type swap)
5. Deploy code that uses only the new shape
```

Doing it in one migration = lock contention + downtime.

---

## Migration PR body — mandatory template

Every migration PR includes:

```markdown
## Migration safety

- **Table affected**: <name>
- **Approximate row count**: <number or "< 1k" / "10k–100k" / "100k–1M" / "1M+">
- **Locking impact**: <AccessExclusiveLock / ShareLock / RowExclusiveLock>
  - Estimated lock duration: <seconds / minutes — be conservative>
  - Acceptable during business hours: <yes / no — if no, schedule>
- **Backfill strategy**: <none / batched 10k per tx / online via pgroll>
- **Rollback plan**: <how to back this out if it fails in prod>
- **Tested on dev branch**: <Neon branch SHA / "pglite — table tiny" / N/A>
```

If any section is missing, the PR is incomplete. The companion hook `migration-pr-template` warns; `void-code-review` blocks.

---

## Banned DDL patterns

### `NOT NULL` direct add — banned

```sql
-- banned
ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
```

Two-phase:

```sql
-- migration A
ALTER TABLE orders ADD COLUMN status TEXT;
-- backfill (batched)
UPDATE orders SET status = 'pending' WHERE status IS NULL AND id BETWEEN $1 AND $2;
-- migration B
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
```

### `RENAME COLUMN` direct — banned

```sql
-- banned
ALTER TABLE users RENAME COLUMN email TO email_address;
```

Two-phase:

```sql
-- migration A
ALTER TABLE users ADD COLUMN email_address TEXT;
-- deploy code that dual-writes both columns
-- backfill
UPDATE users SET email_address = email WHERE email_address IS NULL AND id BETWEEN $1 AND $2;
-- deploy code that reads from email_address
-- migration B
ALTER TABLE users DROP COLUMN email;
```

### Column type change on a large table — banned

Forces a full table rewrite + AccessExclusiveLock. Two-phase via new column + backfill + swap + drop.

### `DROP COLUMN` referenced by active code — banned

Deploy code that ignores the column FIRST. Then DROP in a separate migration.

### `CREATE INDEX` (blocking) on large table — banned

```sql
-- banned
CREATE INDEX orders_status_idx ON orders (status);
-- allowed
CREATE INDEX CONCURRENTLY orders_status_idx ON orders (status);
```

`CONCURRENTLY` does not block reads/writes. Slower; safer.

### Modifying a merged migration — banned

Fix forward via a new migration. Existing environments have already applied the original; mutating it would diverge state.

The companion hook `migration-lint` blocks edits to migration files whose SHA is in the merged history.

---

## Backfill discipline

```typescript
// pseudo-code — actual: in a Drizzle migration script
async function backfillOrderStatus(db: Database) {
  const batchSize = 10_000;
  let lastId = 0;
  while (true) {
    const rows = await db.execute(sql`
      UPDATE orders
      SET status = 'pending'
      WHERE status IS NULL AND id > ${lastId}
      ORDER BY id ASC
      LIMIT ${batchSize}
      RETURNING id
    `);
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;
    logger.info({ lastId, batchCount: rows.length }, 'backfill_progress');
  }
}
```

- Each batch is its own transaction.
- Batch size: 10k by default (tune per table).
- Progress logged via structured logger (composes with `void-observability`).
- Idempotent: rerunning resumes from `lastId`.

---

## Drizzle workflow

```bash
# generate from schema change
drizzle-kit generate

# HAND-REVIEW the produced SQL — drizzle-kit does not encode locking-aware patterns
# adjust to two-phase where needed, add CONCURRENTLY for indexes, etc.

# apply to dev branch
bunx drizzle-kit migrate --config drizzle.dev.config.ts

# integration test the migration (composes with void-tdd)
bunx vitest run tests/migrations/

# PR with the template
```

Auto-generated migrations are starting points, not deliverables.

---

## Testing migrations

### Integration tests (composes with `void-tdd`)

```typescript
test('migration 0042 preserves existing order data', async () => {
  const db = await createTestDb({ seed: 'pre-0042-snapshot.sql' });
  await applyMigration('0042');
  const order = await db.select().from(orders).where(eq(orders.id, knownId)).get();
  expect(order.status).toBe('pending');
  // ... assertions on preserved fields ...
});
```

Tests run on pglite for small tables, on Neon dev branch for large ones.

### Lock-impact dry run

For migrations on tables > 100k rows, run on the dev branch with `pg_stat_activity` snapshot during the migration. Verify the actual lock acquired matches the predicted one.

---

## Rollback

Forward-only is the default — but every migration PR states a rollback plan, even if it is "create a new migration that reverses the change."

Some changes cannot be cleanly reversed (data loss on `DROP COLUMN`). Document that explicitly: "Rollback: only via point-in-time restore; this migration is one-way."

---

## When to escalate to online schema change tooling

For tables > 100M rows or critical 24/7 surface, even two-phase may have a window of concern. Options:

- **pgroll** (Xata) — multi-version schema, allows reading old shape while new shape exists
- **pg_repack** — for table rewrites without lock
- **pt-osc** — Percona, MySQL-flavor (we are Postgres, so less relevant)

These are escape hatches. Default discipline (two-phase + batched backfill + CONCURRENTLY) covers > 95% of cases.

---

## Composition with other skills

- **With `void-tdd`**: integration tests on pglite or Neon dev branch BEFORE merge.
- **With `void-observability`**: structured logs at backfill progress; capture `pg_stat_activity` for long migrations.
- **With `void-security-guidance`**: migration logs MUST NOT include PII.
- **With `void-code-review`**: dimension `correctness` includes "lock analysis present, banned patterns absent, two-phase where required."
- **With `void-commit-discipline`**: migration commits' "why" mentions the linked plan + the two-phase decomposition if applicable.
- **With `void-plan`**: multi-migration schema changes flow through brainstorm + plans.
- **With `void-domain-driven-design`**: schema changes are downstream of aggregate / value object decisions.

---

## Companion hooks

- `migration-lint` (pre-commit on `<config.paths.migrations>`) — greps SQL for banned patterns; tags `// migration-allow: <reason>` for surgical exceptions. See `../../hooks/`.
- `migration-pr-template` (pre-push when touching migrations) — warns if PR body lacks required sections.

---

## Anti-rules

- MUST NOT auto-apply migrations on push to main (manual deploy approval).
- MUST NOT amend a merged migration.
- MUST NOT decide schema design (DDD's call).
- MUST NOT skip the PR body template, even for "tiny" migrations.
- MUST NOT silently allow banned DDL patterns.
- MUST NOT skip the dev-branch test step.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Migration too risky for two-phase | Consider pgroll for multi-version schema. |
| Backfill takes hours | Smaller batch size, run during off-peak, or pgroll. |
| Cannot test on dev branch (no snapshot) | Use anonymized prod snapshot via Neon branching, or pglite for small tables. |
| Need to fix a merged migration | Forward only — new migration that fixes. |
| Locking analysis unclear | Run on dev branch with `pg_stat_activity` snapshot. |

---

## Final rule

```
Every migration → two-phase if risky, batched backfill, CONCURRENTLY for index, banned patterns absent,
                  dev branch tested, PR template complete, immutable after merge.
Otherwise → it is not voidcorp migrations.
```

The cheapest place to catch a downtime-inducing migration is before merge.
