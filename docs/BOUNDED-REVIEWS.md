# Bounded reviews

## Contract

The orchestrator coordinates; the implementer owns and edits the worktree. Risk-relevant
specialists advise when a concrete question warrants their expertise. One independent read-only reviewer examines the
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

The autonomous `autopilot` loop has a deliberately tighter budget: two review rounds
in total (initial review plus at most one corrected head), as specified by
`docs/specs/2026-09-22-autopilot-native-loop.md` and enforced by its kernel.
It does not inherit two additional correction batches. Exhaustion routes unresolved
work to a human; neither mode resets the other's consumed budget.

## Preparation is advice

Normal `mission dispatch` starts the lead writer without a compulsory preparation panel.
An unchanged brief followed by unrelated test additions no longer causes an empty preparation
correction and another whole panel. Existing professional passes and native consultation remain
available for concrete risks. This is workflow advice, not an automatic CLI relevance gate.
Bind advice to its actual question and inputs; revisit it when the brief, artifacts, contract,
boundary or risk changes. Final review still binds the exact commit, base and acceptance criteria.

Existing requested-only preparation rounds remain in history and consume no new budget. Existing
PASS results are not relabelled as current approvals. A preparation invocation authentically
requested and started before implementation admission may finish later as advice; it never counts
as code review. The controller rejects preparation newly started or replayed after admission. Real findings and evidence requests
remain actionable, including late ones; current proof still returns `await-evidence`. Authentic
explicit legacy recovery receipts retain their original admission, targets and budgets.

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

## Recovering a retained native reviewer

The initial general review uses a fresh independent context. Targeted verification may retain
that same native reviewer: the reducer verifies the original and targeted invocation chains,
the authorized correction request and writer completion, exact subjects and scope, and fresh
proofs resolving the original findings. A changed product commit is not required for an
otherwise authorized proof correction. General-review reuse and artifact reuse stay refused.

Historical proof authenticity is separate from current freshness: an earlier targeted receipt
keeps its valid invocation and canonical proof references after the next correction changes
the diff. It does not keep a finding resolved today on a stale proof. The final review must
resolve every blocking finding against the currently observed proof set, including findings
partially resolved in an earlier correction. Missing, forged or out-of-window historical
proofs still invalidate native continuity; no historical Git observation is invented.

For a bounded mission stopped solely by the former `reused-context` false positive after a
valid targeted PASS, use this explicit disposition on the existing recovery command:

```json
{
  "schemaVersion": 1,
  "closureEventId": "evt_original_controller_stop",
  "expectedJournalHash": "sha256:<canonical full journal hash>",
  "disposition": {
    "kind": "controller-defect",
    "defect": "targeted-review-context"
  }
}
```

Generate the canonical journal hash using the helper below. Save the request under the
actual reviewed worktree, then run both commands there with the same explicitly selected
fixed CLI (`BOUNDED_CLI` points to its `bin/void-machine.mjs`):

```sh
node "$BOUNDED_CLI" mission recover --id "$MISSION_ID" --input .void/machine/recovery-request.json --json &&
node "$BOUNDED_CLI" mission dispatch --id "$MISSION_ID" --json
```

Recovery observes Git, the frozen ticket, durable input recipe, native runtime, catalog and
current proof dependencies itself. It accepts no caller-supplied subject or observation hash.
It appends one receipt, retains the entire journal prefix and both review results, and spends
no correction budget. A complete third review after the second correction can be admitted
with zero corrections remaining. Dispatch still applies normal proof, obligation and effect
checks; recovery does not authorize an external operation.

Wrong worktree, dirty or changed subject, stale evidence, incomplete invocation, unresolved
finding, forged receipt or uncertain external effect stay refused. Repeated recovery after
another closure without genuine progress stays refused. Inspect that cause before issuing
another dependent command; do not edit history or run another general review to mask it.

No automatic migration or installation is performed. Existing journals without this recovery
retain their formats and policy. After appending this new disposition, keep using its fixed
CLI for subsequent mission commands: older readers cannot validate the new receipt. Rollback
means reverting the code or installation before admission, or retaining the fixed reader for
an admitted mission; it never means removing its recovery event.

See the [bounded native continuity decision](decisions-log/2026-10-23-preserve-bounded-native-review-continuity--1411e10b-ff9f-4b92-8cbd-7ede876048e8.md).

## Replacing reused preparation invocations

A controller-stop caused solely by reused native contexts in a complete round-two
preparation panel admits one explicit replacement request:

```json
{
  "schemaVersion": 1,
  "closureEventId": "evt_original_controller_closure",
  "expectedJournalHash": "sha256:<canonical event-array hash>",
  "disposition": {
    "kind": "preparation-invocation",
    "completionEventIds": ["evt_exact_invalid_round_two_completion"]
  }
}
```

Use `mission recover --id <same-id> --input <request.json> --json`, then
`mission dispatch --id <same-id> --json` from the original bound worktree with the
verified candidate binary. `expectedJournalHash` hashes the canonical parsed event
array, not the JSONL bytes. Read the raw journal for diagnosis: `mission resume`
appends events, and inspection may quarantine invalid lines. A replay fixture must be
standalone with verified project roots; copying a linked checkout's `.git` pointer
can redirect writes to the original installation.

Admission requires every original request/start/completion binding, the same plan,
runtime and current contracts/inputs, one actual preparation correction, and exactly
the invalid reused-context completions. It refuses stale closures, input drift,
unrelated defects, unknown work, unresolved current evidence and any prior recovery.
It does not rehabilitate the invalid PASS results. Classified future evidence requests
and valid panel members remain authoritative.

The receipt keeps two consumed rounds, zero remaining rounds and the unchanged
correction budget. Dispatch creates new episode-bound requests for only the invalid
members in **round 2**. Launch new native read-only specialist sessions for each returned
envelope, preserving each actual identity and result, then submit their start/completion
through `mission specialist-event`. Never relabel or resume an old context as fresh:
all historically started identities remain forbidden. Implementation waits for every
replacement; another replacement failure cannot unlock another repair or a budget reset.
No harness installation or provider action is part of this recovery.

See the [preparation replacement decision](decisions-log/2026-10-17-replace-invalid-preparation-invocations--bbdbf42b-c286-43af-85a8-8e057b34274a.md).

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
obligation. It may be consumed once without writer progress: if the preceding recovery
already used that exception, another closure refuses with `no-recovery-progress`.
The authenticated journal determines this; no caller supplies an allowance or resets it.
Any intervening event, unknown effect, human closure, incompatible observation
or exhausted review budget still refuses. Identical concurrent requests append at most
one recovery receipt. The existing schema and original journal are retained; this is
neither review approval nor another correction round.

After recovery, obtain the author response through the evidence commands above. A fresh
candidate dispatch remains `await-evidence` until that response permits the next action.
To end unfinished work explicitly, use `mission close --id <same-id> --reason abandoned`
(or `interrupted`); these human closures are not eligible for `mission recover`.

Post-implementation obligations retain their existing gates. Pass command arguments
separately, for example `mission verify --id <id> -- pnpm typecheck`. A corrected argv
has a different input hash: its success does not implicitly supersede another command's
failed proof. An exit 127 is never treated as success or silently removed from history.

### Correct an already recorded malformed command invocation

If the stopped journal contains a mono-string invocation such as `["pnpm typecheck"]`
with spawn ENOENT/127 and a later successful `["pnpm", "typecheck"]` proof, use the
same `mission recover --id <same-id> --input <request.json> --json` boundary. Retain
`schemaVersion`, the current `closureEventId` and canonical `expectedJournalHash`;
use this disposition:

```json
{
  "kind": "command-correction",
  "pairs": [{
    "failedEventId": "evt_original_failed_proof",
    "replacementEventId": "evt_later_corrected_proof"
  }],
  "resolutionArtifact": {
    "path": ".void/machine/command-resolution.md",
    "sha256": "sha256:<actual-artifact-digest>"
  }
}
```

Explain the correction and identify the original proof pair in the resolution artifact.
The CLI reads and hashes this file under the original native runtime. Admission checks
both seals, source, mission, environment, diff and current dependencies; the replacement
must still be the latest proof of its input and have passed. Up to 64 disjoint pairs may
be named within the existing receipt size bound. No command runs during recovery.

The complete corrected argv, joined by single spaces, must equal the original string,
including the executable path. Arguments containing whitespace or shell syntax are not
eligible. `pnpm` and `/tools/pnpm`, or two paths sharing a basename, are not assumed
equivalent. The observed DEV-927 relative/absolute change remains refused without
executable provenance; its journal was still open when inspected.

Only the named original failure leaves the effective verdict; its event and hashes stay
in the journal. The latest proof per input is selected before applying the correction,
so an older superseded failure cannot reappear. A later failed rerun, security blocker, unknown effect, human closure or
exhausted budget remains effective. Identical concurrent requests append one recovery
receipt. Dispatch then observes the normal review and proof gates; recovery itself does
not approve the mission. If the corrected proof is absent or stale, reconcile the
missing evidence; this path does not authorize an unrecorded command or a new mission.

See the [command correction decision](decisions-log/2026-10-05-bind-command-corrections-to-recovery--ded6f423-1c89-4676-a6bb-60eb181e4db9.md)
for the authority boundary and rejected alternatives.

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
