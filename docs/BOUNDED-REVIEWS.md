# Bounded reviews

## Contract

The orchestrator coordinates; the implementer owns and edits the worktree. Risk-relevant
specialists advise before implementation. One independent read-only reviewer examines the
committed result against an explicit base and acceptance criteria. Prefer a dedicated
worktree pinned to the reviewed commit with native read-only permissions.

The review receipt records task, reviewer, writer, reviewed commit, comparison base,
acceptance-criteria binding, conclusions, proof references and defect resolutions. Retain
actual invocation and result provenance. Missing or refused native context identity is a
named limitation, not by itself a delivery refusal. A hash of caller-authored assertions
alone does not establish independent review. Never fabricate an invocation or independence.

A blocking defect states the violated behavior or criterion, concrete consequence,
evidence and resolution condition. Style, optional refactoring and scope expansion are
advisory. Advisory findings never block, spend correction budget or cause another review.

After the initial general review, the implementer may submit at most two correction
batches. Each batch receives targeted verification of the corrections and affected behavior.
Do not reopen the general panel. Preserve unaffected conclusions and proofs, invalidate
affected evidence, and carry every unresolved blocker until its evidenced resolution.
A newly raised targeted blocker must demonstrate a correction regression or a defect in
the original scope. The orchestrator may obtain one independent reading of a disputed point and retain it
as evidence, without resetting the correction budget or triggering general review.
There is no separate automatic arbitration command: the existing targeted verification
still requires an evidenced resolution and never treats this opinion as a permission override.

At the limit, automatic correction dispatch stops with a cause, responsible party and
resolution action. Unresolved blocking defects never become a successful completion.
Incomplete panels, transport repair, agent restarts and task resumption do not spend or
reset correction budget. A turn ending does not end a task.

## Compatibility and recovery

New controller missions select the bounded policy durably. Existing journal records remain
readable under their recorded policy. Recovery is explicit and append-only, preserving
mission identity, events, results, budgets and completed effects. It validates the original
review's version, subject, available provenance and result; it never automatically promotes
a degraded historical verdict. Fresh valid evidence is retained; affected or stale evidence
is invalidated. Worktrees, branches and useful proofs are not removed by recovery.

Installation activation is separate from source verification. The active published harness
is not silently replaced by this candidate. The verified delivery must include the exact
candidate command and recovery request demonstrated against an isolated existing mission.
No claim of consumer activation is implied by this source document.

## Preparation waiting for evidence

Before implementation, `dispatch` returns `await-evidence` when a valid specialist
obligation is still due. The verdict remains blocked. This action leaves the mission
open and dispatches neither a writer nor another panel. Repeating it without new events
has no journal effect. A PASS carrying an evidence request still needs its author response.

Use `mission evidence-request --id <same-id> --input <request.json> --json`. For an
unclassified request, the input identifies the original completion and a fresh actual
native author context:

```json
{
  "operation": "classification",
  "completionEventId": "evt_original_completion",
  "contextId": "actual-fresh-author-context"
}
```

The original specialist determines the deadline; the writer must not infer it from
prose. Record the actual `started` and `completed` responses with `mission evidence-event`.
For proof already due, request `operation: "discharge"` with its `obligationIds` and
submit the author's response referencing fresh canonical proof event IDs. The request
alone discharges nothing. Dispatch again only after the response. Original findings,
proofs and consumed rounds remain authoritative; a writer receipt cannot erase them.

A legacy binary may already have closed the mission while prescribing this response.
Use `mission recover` on the same mission with the existing `review-blocker` request:
`schemaVersion: 1`, the active `closureEventId`, the canonical `expectedJournalHash`,
and a disposition containing `kind: "review-blocker"`, the original
`completionEventIds` and a `resolutionArtifact` with repository-relative `path` and
`sha256`. The CLI re-observes the bound ticket, runtime, contracts and artifact. The
journal hash uses `canonicalJsonHash(events)`, not a hash of JSONL bytes. A source
helper for obtaining canonical hashes appears below.

If a previous clarification was immediately reclosed by `dispatch`, the same recovery
may be admitted without a writer completion that the closed mission could not accept.
This exception requires preparation, the same completion IDs and a still-blocking valid
obligation. Any intervening event, unknown effect, human closure, incompatible observation
or exhausted review budget still refuses. Identical concurrent requests append at most
one recovery receipt. The existing schema and original journal are retained; this is
neither review approval nor another correction round.

After recovery, obtain the author response through the evidence commands above. A fresh
candidate dispatch remains `await-evidence` until that response permits the next action.
To end unfinished work explicitly, use `mission close --id <same-id> --reason abandoned`
(or `interrupted`); these human closures are not eligible for `mission recover`.

This repair is limited to preparation obligations. Failed verification commands and
post-implementation obligations retain their existing gates. Pass command arguments
separately, for example `mission verify --id <id> -- pnpm typecheck`. A corrected argv
has a different input hash: its success does not implicitly supersede another command's
failed proof. An exit 127 is never treated as success or silently removed from history.

## Run the candidate without changing the installation

Use a checkout whose CLI and bundled assets have been built and verified together.
From the consumer worktree, select that executable explicitly:

```sh
export BOUNDED_CANDIDATE=/absolute/path/to/verified/void-machine
export BOUNDED_CLI="$BOUNDED_CANDIDATE/packages/cli/bin/void-machine.mjs"
node "$BOUNDED_CLI" mission start --title "Implement the approved task" --ticket task.md --mode team --json
```

A ticket-bound controller mission started by this candidate records
`reviewPolicy: "bounded-corrections-v1"`. Save the returned mission ID, then use
`node "$BOUNDED_CLI" mission dispatch --id "$MISSION_ID" --json` for its next action.
Follow that action: record the real preparation specialists, let the sole writer implement
and commit, then dispatch the independent review on that committed HEAD. Uncommitted
changes cannot supply the bounded post-implementation review subject.

These commands select the candidate CLI for this operation. They do not run `init`,
replace the installed hooks or specialists, or activate a published release. Updating a
consumer installation remains a separate deployment step. Native dispatch still needs its
actual runtime capabilities; selecting a binary does not create an independent reviewer.

## Recover an eligible stopped mission

This path applies to an existing controller-stop with an actual independent review already
recorded as `pass`, matching the original contract version and unchanged subject. It does
not create a missing review, promote `degraded`, resolve an outstanding blocker, or convert
an arbitrary stopped mission. Keep the original mission ID and journal. Use the candidate
executable above from the original worktree, with its original ticket and clean committed
HEAD. The recovery records an explicit binding to the preserved result.

First inspect the original events and obtain the hashes through the existing source
interfaces. This candidate-checkout helper requires the checkout's existing `tsx` dependency;
it is not an extra installed CLI subcommand. It handles the separate journal root of a
linked worktree and only reads state:

```sh
export MISSION_ID=mis_original_id
node --import "$BOUNDED_CANDIDATE/packages/cli/node_modules/tsx/dist/loader.mjs" --input-type=module <<'JS'
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const load = path => import(pathToFileURL(join(process.env.BOUNDED_CANDIDATE, path)).href);
const { resolveProjectRoots } = await load('packages/cli/src/lib/project-roots.ts');
const { inspectMission, loadMissionControllerPlan } = await load('packages/cli/src/lib/runs/store.ts');
const { canonicalJsonHash } = await load('packages/mission-engine/src/evidence/canonical-json.ts');
const { installRoot } = resolveProjectRoots();
const id = process.env.MISSION_ID;
const { stream } = await inspectMission(installRoot, id, { dependencies: {} });
const stored = await loadMissionControllerPlan(installRoot, id);
process.stdout.write(JSON.stringify({
  missionId: id, baseCommit: stored.baseCommit,
  ticket: stored.ticket,
  expectedJournalHash: canonicalJsonHash(stream.events),
  events: stream.events.filter(event => ['mission.started', 'mission.closed',
    'specialist.requested', 'specialist.started', 'specialist.completed'].includes(event.kind))
    .map(event => ({ ...event, ...(event.kind === 'specialist.completed'
      ? { completionHash: canonicalJsonHash(event.payload.completion) } : {}) })),
}, undefined, 2) + '\n');
JS
git rev-parse HEAD
```

Identify the original post-implementation `core:independent-code-reviewer` completion,
its matching requested/started invocation, and the controller-stop closure event. Copy the
actual reviewer identity and provenance from the preserved review record. `writerId` is
the original `mission.started.payload.leadWriterId`; `acceptanceCriteriaHash` is the stored
`ticket.contentHash`. `baseCommit` is the stored base; `reviewedCommit` must be the commit
actually reviewed and still match HEAD. Do not infer an old reviewed commit merely from
today's HEAD, or invent a context ID when the original invocation has none.

Retain a binding artifact under the worktree, for example
`.void/machine/reviews/recovery-bindings.json`. The demonstrated legacy recovery uses the
original recorded native context ID. Its shape is:

```json
{
  "bindings": [{
    "completionEventId": "evt_original_completion",
    "completionHash": "sha256:<canonical completion hash from the helper>",
    "review": {
      "taskId": "mis_original_id",
      "reviewerId": "<actual independent reviewer identity>",
      "writerId": "<original lead writer identity>",
      "baseCommit": "<original full base commit>",
      "reviewedCommit": "<full commit actually reviewed>",
      "acceptanceCriteriaHash": "sha256:<stored ticket content hash>",
      "readOnly": true,
      "scope": { "kind": "general" },
      "proofIds": [],
      "resolutions": [],
      "provenance": {
        "kind": "native-context",
        "contextId": "<original recorded reviewer context ID>"
      }
    }
  }]
}
```

Replace the placeholders with observed values and retain actual proof references and
resolutions when present. The empty arrays above describe the demonstrated finding-free
review, not permission to erase historical results. The result itself stays in the journal;
`completionHash` binds its exact original contents. New bounded reviews have a separate
artifact-backed provenance path for missing/refused context IDs; this legacy example does
not claim to recover a historical invocation that lacks the required provenance.

Hash the artifact's exact saved bytes, including any final newline:

```sh
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; process.stdout.write("sha256:" + createHash("sha256").update(readFileSync(process.argv[1])).digest("hex") + "\n")' .void/machine/reviews/recovery-bindings.json
```

Write `.void/machine/reviews/recovery-request.json` with this request schema:

```json
{
  "schemaVersion": 1,
  "closureEventId": "evt_original_controller_stop",
  "expectedJournalHash": "sha256:<canonical full journal hash from the helper>",
  "disposition": {
    "kind": "review-provenance",
    "completionEventIds": ["evt_original_completion"],
    "resolutionArtifact": {
      "path": ".void/machine/reviews/recovery-bindings.json",
      "sha256": "sha256:<artifact byte hash>"
    }
  }
}
```

The journal and completion hashes use `canonicalJsonHash`, not a raw file checksum.
The artifact hash uses its raw bytes. If the journal advances before admission, inspect
again and rebuild the request against the observed history; never edit the journal to make
an old hash match. Paths in the request are worktree-relative.

```sh
node "$BOUNDED_CLI" mission recover --id "$MISSION_ID" --input .void/machine/reviews/recovery-request.json --json
node "$BOUNDED_CLI" mission dispatch --id "$MISSION_ID" --json
```

An admitted recovery appends `mission.recovered` and reports `recorded` plus its event ID.
It preserves the original event prefix and correction budget. Follow the returned dispatch
action. For the isolated addition fixture, it was `run-verification`, followed by:

```sh
node "$BOUNDED_CLI" mission verify --id "$MISSION_ID" --json -- node --test add.test.mjs
node "$BOUNDED_CLI" mission dispatch --id "$MISSION_ID" --json
```

Use the original task's actual verification command in a consumer project. Completion
requires passed current evidence and no unresolved blocker; `recover` alone is not closure.

## Acceptance evidence

Behavioral tests cover advisory-only results, targeted correction, incomplete-panel resume,
two-batch exhaustion, unresolved blockers, subject changes and affected proofs, missing
runtime identity with actual review provenance, and recovery preserving history and budget.
The isolated CLI journey passed on 2026-09-19: mission
`mis_d11b7094d0bca9b9030d86aab77726fc` retained its original 40 events and finished
with 43. Recovery reused the historical review, dispatch returned `run-verification`,
`node --test add.test.mjs` produced verified evidence with exit code 0, and the final
dispatch returned `complete` without another specialist request or correction. Specialist
inputs and the legacy stop were explicitly simulated; recovery, dispatch, verification and
closure used the real candidate CLI. This proves the CLI contract, not an independent
review of the delivery candidate. Package and installed skill instructions must agree
with dispatch and validation.

See [the decision](decisions-log/2026-09-19-bounded-independent-review--eb08fcc8-d50a-4574-89da-d5a174f4035d.md).
