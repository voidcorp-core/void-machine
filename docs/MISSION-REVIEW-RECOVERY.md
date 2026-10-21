# Review, stop and recovery continuity

The CLI owns observation and append-only persistence. The Mission Engine owns
independent invocation admission, evidence freshness and correction budgets.
Dispatch, recovery and specialist migration must observe the same subject recipe.

## Identity and compatibility

| Input | Owner | Compatibility rule |
| --- | --- | --- |
| Mission, base, reviewed commit, criteria | Review receipt | Exact identity; a provenance correction requires a clean committed subject |
| Diff, paths, routing and contract | CLI observation | Recompute from current inputs; never copy an old inputHash |
| Requested/started/completed | Engine | Exact invocation, independent writer/reviewer and unique native context |
| Progress after recovery | Engine | Writer correction or a fully valid fresh independent triplet for provenance recovery |
| Correction budget | Engine | Initial independent review plus at most two correction batches |
| Journal and artifact digest | CLI and engine | Compare-and-append under lock; authenticated historical replay |

Schema 1/2 controller plans retain the historical runtime-v1 input recipe. Schema
3 binds project-v1 into the immutable routing hash. New missions use project
Node declarations instead of process.versions.node. Non-exact constraints remain
unknown and are retained as input, not converted into a fabricated exact version.
The original review policy owns the subject hash format. Strengthening provenance
admission does not silently convert an existing legacy subject hash.

Historical recovery observations without a review-policy marker retain their
original budget interpretation. New bounded observations share the controller's
three-review/two-correction policy. Budgets are never reset by resumption.

## Observed historical divergence

The preserved 2026-10-21 incident was reconstructed with the same Git subject,
source and catalogs under two real Node executables. Node 26.8.2 produced input
c8f8de0b235b3790c734a3319050e577dbf80902f81125b838f04f22a6d6aaac;
Node 24.15.0 produced
3c339b2c591966650dc914021b62420ced5e4f003e5416989a1930410ca63447.
The latter exactly matches the final independent invocation. The committed
subject hash remained f60af541c0d0a39286be6ce60213514f9f06b3107ed08cb1e35903ae9f7d320b.

The journal does not retain the executable path for each specialist request.
These observations demonstrate the hash preimages, not an unavailable historical
process trace. Neither a packaging difference nor a changed code subject explains
this discrepancy. Legacy recovery separately omitted reviewedCommit and produced
a third, incompatible hash. Both causes must be addressed.

## Existing mission recovery procedure

1. Preserve the original journal, plan, review artifacts and their byte digests.
   Read the exact committed implementation, bound base and criteria. Do not edit
   events, fabricate progress or create a replacement mission.
2. Identify the stored recipe. For a runtime-v1 mission, reconstruct the reviewed
   hash with the evidenced compatible executable and unchanged current inputs.
   Refuse if it cannot be reproduced. Never automatically try runtimes until one
   passes, and never copy a historical hash into the observation.
3. Validate the author's retained metadata correction against the original PASS,
   independent invocation and exact completion hash. A metadata correction cannot
   change findings, scope, evidence or verdict. No general review is rerun for it.
4. First run the production recovery adapter with the original worktree as a
   read-only observation source and an isolated byte-for-byte copy of the run as
   installation root. Use the retained request and binding artifacts unchanged.
   Check recovery, subsequent dispatch and final verification, plus idempotence.
5. Verify that original digests are unchanged, the copied log retains its original
   byte prefix, and the appended transition preserves reviews and spent budgets.
   A synthetic green fixture alone is insufficient evidence of incident repair.
6. Only then use the same supported recover command on the original mission when
   consumer activation is explicitly authorized. Continue verification from the
   resulting controller action; never relaunch general review to repair metadata.

## Limits and rollback

No global installation, publication, consumer activation or remote effect is part
of the isolated proof. Missing baselines, changed subjects or contracts, self-review,
incomplete invocations, reused contexts, exhausted budgets, tampered journals and
uncertain external effects remain refusals.

Before activation, rollback means retaining the old installation and discarding
only task-owned isolated proof copies when their evidence is retained. After a
new-format plan or recovery receipt is written, use a reader that supports it;
never truncate a journal or downgrade to an incompatible mutating CLI. A defect
in a published recipe needs a further supported transition, not a history edit.

See the [observation-recipe decision](decisions-log/2026-10-21-stable-review-observation-recipes--129ef8ef-77b5-4c51-a1de-7c5a711e3510.md).


## Pending author evidence and existing stopped episodes

A valid outstanding proof now returns `await-evidence` in preparation, after
implementation and at completion. The verdict stays unverified. Invalid dispositions,
failed reviews, exhausted review attempts and uncertain effects remain refusals.
A caller must inspect every command result and stop dependent commands after a refusal.

For an existing `controller-stop`, an already requested and started discharge may
finish through `mission evidence-event --status completed`. This does not reopen the
mission or authorize a new author invocation. The same request/context and unchanged
author response must pass all original proof, contract and freshness checks. A forged,
unstarted or stale response is refused without an appended event. Repeating an already
accepted identical response is idempotent; it provides no additional recovery progress.

Then create an exact recovery request from the newly observed journal:

```json
{
  "schemaVersion": 1,
  "closureEventId": "evt_current_controller_stop",
  "expectedJournalHash": "sha256:<current canonical journal hash>",
  "disposition": {
    "kind": "evidence-disposition",
    "responseEventIds": ["evt_new_author_discharge"]
  }
}
```

The canonical journal hash is SHA-256 of canonical JSON for the parsed event array,
not SHA-256 of JSONL bytes. Keep both digests in the operational evidence. Never alter
an event or copy an old subject hash into a current observation. The CLI recomputes
Git dependencies from its working directory; an error names the observed worktree and
Git hash. Run from the exact proof worktree with its unchanged committed candidate.
An author reason over 1000 characters reports the actual length and limit; obtain a
corrected author response instead of truncating it locally.

Use an explicit fail-fast command sequence, after rehearsing it on a faithful copy:

```sh
set -eu
cd "$mission_worktree"
"$verified_node" "$verified_cli" mission evidence-event --id "$mission_id" \
  --status completed --input "$author_response" --json
# Inspect the accepted response and construct the closure/hash-bound request here.
"$verified_node" "$verified_cli" mission recover --id "$mission_id" \
  --input "$recovery_request" --json
"$verified_node" "$verified_cli" mission dispatch --id "$mission_id" --json
```

Execute each distinct author's retained response before preparing the recovery
request. Do not run dispatch if any response or recovery is refused. The next action
may be the first independent review, a remaining evidence wait, or final verification;
none is a claim that a missing review has happened. Reusing these responses for a later
closure is refused. Existing round and correction budgets are preserved.

Compatibility is additive: old requests and histories are unchanged. Once a new
`evidence-disposition` recovery is recorded, 5.0.4 reports the recovery receipt as
unreproducible and the mission as degraded. Keep a compatible CLI after this boundary;
rollback never means deleting journal events. Before the transition, retain the old
installation and original proofs; after it, fix forward through supported commands.

See the [pending evidence decision](decisions-log/2026-10-21-pending-evidence-recovery--26c166d3-ffce-4896-b5f5-14b62e06512b.md).
