# Bounded visual contract migration for the open WORK-3 mission

Status: bounded implementation within the authorized WORK-1/2/3 recovery scope. Tests precede production. Real installation activation and publication remain separately authorized. Decision: ../decisions-log/2026-09-19-open-missions-migrate-specialist-contracts--d8347b38-7f22-4239-b96b-7c0fa14463ad.md.

## Problem and decision

WORK-3's frozen ticket mentions the installed/source "visual v3" mismatch. The lexical ux-ui detector selected visual-craft-director v2 even though the reviewed changes identify no rendered frontend surface. Version 2 requires visual evidence; version 3 already defines a fresh, evidence-bound applicability assessment. Do not reinterpret v2, edit the frozen ticket/plan, manufacture a pass, close the open mission to recover it again, reset its budget, or introduce an exemption from visual review.

Add one explicit open-mission transition for future reviews: `mission migrate-specialist --id <missionId> --input <request.json> [--json]`. Reuse journal sequencing, locking, canonical hashing, event parsing, native specialist compilation/health, review budgets and evidence disposition APIs. No new runtime root, execution engine, or generic migration framework.

## Versioned migration declaration

One initial declaration in `packages/core/specialists/migrations.json`, distributed through existing asset generation:

```json
{
  "schemaVersion": 1,
  "migrations": [{
    "id": "visual-craft-director-v2-v3",
    "specialistId": "core:visual-craft-director",
    "fromVersion": 2,
    "toVersion": 3,
    "fromContractSha256": "<exact SHA-256 of canonical v2 YAML bytes>",
    "toContractSha256": "<exact SHA-256 of canonical v3 YAML bytes>",
    "policy": "fresh-review-required"
  }]
}
```

Placeholders above are documentation only: generated/accepted declarations require `sha256:` plus 64 lowercase hexadecimal digits and exact observed artifact bytes. The declaration explicitly permits a transition, never evidence equivalence. Initial implementation accepts this single declared edge, not arbitrary version changes or caller-supplied compatibility. The declaration also pins fromContractPath to contract-history/visual-craft-director/v2.yaml, containing the exact official released 3.8.0 contract bytes. This archive is distributed outside the active specialist catalog. The adapter verifies its bytes against fromContractSha256 after v3 activation; no caller-selected archive is accepted.

## Exact request and receipt boundary

Request JSON has exactly these fields; mission ID comes from the command, not a second JSON authority:

```json
{
  "schemaVersion": 1,
  "expectedJournalHash": "sha256:<64 hex>",
  "expectedEpisodeId": "<active episode event ID>",
  "migrationId": "visual-craft-director-v2-v3"
}
```

Unknown fields and caller-supplied roots, budgets, contract hashes, applicability, capability or observation data refuse. Request and receipt use the existing 16 KiB canonical payload bound and existing identifier/hash validators.

The adapter appends `specialist.contract-migrated`, source `void-harness:mission.migrate-specialist`, subject `core:visual-craft-director`, correlationId equal to the original mission ID. Receipt fields are exactly:

- `schemaVersion: 1`, `request`, `requestHash`;
- `observation`: bounded adapter-produced declaration, observedFromContractSha256, observedToContractSha256, nativeAgentSha256, nativeContractVersion, reviewSubjectHash, targetInputHash, plan, currentInputHashes, maxRounds and expectedSource. Readers cross-check the plan, budget and source against existing canonical authorities. Superseded IDs and remaining rounds are derived from the authenticated prefix, never accepted as caller observations;
- `episodeId`, `priorJournalHash`, `priorJournalLastSeq`;
- `migrationId`, `declarationHash`, `specialistId`, `fromVersion`, `toVersion`, `fromContractSha256`, `toContractSha256`;
- `reviewSubjectHash`, `targetInputHash`, `nativeAgentSha256`;
- `reviewRound` (the existing reducer's next admissible round), `remainingRounds` (unchanged observed budget);
- `supersededRequestEventIds` (queued old-version requests with no started event);
- `supersededCompletionEventIds` (old completions that cannot satisfy the new review);
- `pendingAuthorObligationIds` (exact current-review obligations from this specialist's prior completions);
- `nextAction: "review-migrated-specialist"`.

All observations are adapter-produced. No complete prompts, file contents, or journal copies are embedded. Deterministic event identity is derived from mission ID, episode ID and request hash. Identical retries return the existing receipt only after verifying its original prefix and current admissibility; conflicting repeats refuse. Append validates the same open episode and journal hash under the existing lock.

## Admission and projection

Admission requires a valid complete original journal, the active open episode, exact CAS values, the effective old contract matching the declared v2 hash, the observed target contract matching declared v3 bytes, and the native runtime actually exposing the corresponding v3 specialist. A started invocation of any specialist without a terminal result in the active episode refuses migration. The validated lifecycle projection defines the episode boundary: starts before an authenticated mission.recovered remain historical and do not block the new episode, because their old requests can no longer receive lifecycle responses. The original starts, requests and any existing results remain in the journal; no terminal event is fabricated. A queued request with no started event may be superseded explicitly; its event ID is recorded in supersededRequestEventIds and subsequent starts or results for that old request refuse. Missing/ambiguous review subject, invalid previous receipts/dispositions, actual review-budget exhaustion, unavailable runtime or mismatched assets refuse. Migration does not authorize or execute a writer action.

The immutable controller-plan stays unchanged. A validated event projection supplies the target version for future requests and checks; it does not relabel old events. The next review uses the existing admissible round, fresh input and a new native context. Old v2 completions remain visible and retain their findings, verdicts and evidence obligations, but cannot certify a v3 review. Existing genuine rounds, failure history, mission identity and writer ownership remain unchanged.

A later supported recovery preserves the migration. Its adapter observes the authenticated effective contracts and recalculates current inputs using the declared historical catalogue for unchanged peers and the effective catalogue for the migrated specialist. The recovery reducer validates the migration against its exact original prefix and applies the same review boundary as dispatch. Historical v2 results keep their budget and obligation effects but cannot certify v3. Earlier mission.closed events remain in the journal; the lifecycle projection, not the absence of closure history, establishes whether the current episode is open.

## Explicit recovery before the first post-implementation review

An installation transition can precede a legacy controller dispatch: the old controller
closes immediately after the completed writer because its v2 native specialist is now v3.
Ordinary recovery cannot name a post-review blocker when no post-review has run, while
ordinary migration requires an open episode. Do not fabricate a historical finding or
reuse a previously consumed recovery disposition.

For this bounded case only, the existing migration request accepts one optional field:
`"recovery": { "closureEventId": "evt_<exact stopped closure>" }`. Omitting it never
reopens a closed mission. The original episode ID and journal hash remain mandatory CAS
values. Admission requires a controller-produced `controller-stop` immediately following
completed implementation, no post-implementation specialist request or attempt anywhere
in the history, no unresolved writer/external effect, and no active specialist invocation.
The existing declared archive, target/native hashes, plan authority and budget checks
all still apply. This admits the observed contract transition; it does not claim that an
old closure recorded a diagnostic that its payload did not contain.

One `specialist.contract-migrated` event records both the validated migration and
`recovery: { closureEventId, previousEpisodeId }`. Its event ID becomes the new episode.
There is no intermediate open v2 episode, no synthetic writer result and no separate
recovery event. Readers authenticate the complete migration receipt against its exact
prefix before accepting the open lifecycle. Historical closures, preparation corrections,
writer rounds, evidence obligations and the immutable controller plan stay unchanged.
A post-review attempt already present makes this recovery mode unavailable, rather than
resetting its budget. Repeating the exact request is idempotent; stale or conflicting
requests refuse under the existing journal lock. Installation and release remain separate
operations and this command performs neither.

## Resolve the reviewed dispatch deadlock narrowly

Current-review evidence obligations from the old visual completion must not prevent the one fresh visual scope assessment needed to resolve them. After authenticating the migration receipt and checking fresh inputs/native version/budget, the controller may return only `invoke-specialists` for `["core:visual-craft-director"]`, at the receipt's admitted stage/round, while exactly its recorded `pendingAuthorObligationIds` remain outstanding.

This is a review-dispatch allowance, not a verdict or evidence exemption. Preparation already admitted through its correction and completed implementation is recognized under the existing preparation rule; an empty retrospective review window does not require replaying that panel. This still permits only the targeted migrated assessment and leaves degraded peer verdicts intact. The global obligation state and blocked/unverified verdict remain unchanged. It permits no writer action, general panel dispatch, acceptance, completion or closure. It ignores no malformed/stale proof disposition, unrelated obligation, runtime refusal or budget limit. An obligation not owned by the migrated specialist, or not bound to the verified receipt, remains blocking. Repeated dispatch observes the existing request instead of spawning duplicates. The allowance ends when that requested review has a terminal lifecycle result; failure follows existing refusal/budget rules, with no new retry credit.

After the fresh v3 review, the original visual author obligations still require explicit classification/discharge through the existing evidence request/started/completed protocol. A v3 PASS or a non-applicability statement is never implicitly a discharge. The isolated end-to-end proof must exercise actual supported canonical evidence recording and fresh author discharge against the original obligation IDs. It must not assume that specialist.completed alone is an admissible proof type: use the existing evidence recorder/validator and retain its freshness checks. If existing disposition APIs cannot express this evidence faithfully, report that precise blockage rather than fabricate a command result or waive the obligation.

## Owned boundaries to change after approval

- New pure `packages/mission-engine/src/orchestration/specialist-contract-migration.ts` and focused test: bounded admission, receipt validation, effective future contract projection.
- `packages/mission-engine/src/orchestration/controller.ts`: consume validated effective contract and the narrowly scoped dispatch allowance; retain global obligations and verdict gates.
- New `packages/cli/src/lib/runs/specialist-contract-migration.ts`: observe assets/native specialist/review subject, existing atomic append; no spawn or filesystem installation.
- `packages/cli/src/commands/mission.ts`: exact request parsing, command dispatch, use projected contract for subsequent native dispatch.
- `packages/cli/src/lib/runs/specialist-lifecycle.ts`: accept only the genuinely requested effective version/context and reject old envelopes. Touch only if existing request-bound validation does not already suffice.
- Versioned declaration, existing package exports, documentation and generated distribution assets. No changes to ProjectRoots, published floor, frozen ticket or stored plan.

## Three focused proofs, serialized through RUN

1. Isolated open-WORK-3 lifecycle: preserve original mission ID/journal/plan; install matching v3 only into the isolated fixture; append migration; pending visual obligations still exist but admit exactly the fresh v3 reviewer; observe its actual version/context binding; record its answer; prove no certification before the original-author explicit discharge; record supported fresh proof/discharge and only then permit ordinary progression. Original bytes, budget and unrelated obligations remain intact.
2. Admission refusal matrix: stale journal/episode, closed mission, started nonterminal specialist invocation, actual budget exhaustion, undeclared transition, wrong asset/native version, invalid receipt or malformed request. No event append or counter reset.
3. Dispatch/verdict guard: v2 replay, reused context, changed reviewed input, conflicting migration retry, invalid evidence disposition and unrelated pending obligation all refuse the allowance. Identical retry is idempotent; new v3 PASS cannot itself erase old obligations or close the mission.

## Activation boundary and cost

Current `ProjectRoots.installRoot` owns both the real journal and installed native agents. The native capability check reads that installation and compares its contracts against candidate assets. An isolated v3 fixture can demonstrate the full flow without modifying the real installation; it cannot activate v3 for the actual root mission while root still exposes v2.

After implementation, tests and the isolated proof, present the exact native-agent installation delta and provenance for separate user authorization. No release is inherently needed for a local explicit activation, but the real installation must not be silently changed. Do not split roots or use a capability override to avoid this boundary.

This adds one explicit version transition and one targeted review-dispatch allowance. Reinterpreting v2 would be superficially smaller but retroactively changes the protected contract and cannot be called a valid v2 review. No wider applicability mechanism, new orchestration kernel, or unrelated incident work belongs in this lot.

## Clarification of preparation obligations due after implementation

The existing `review-blocker` recovery may name an original preparation completion
only when the shared evidence reducer finds one of its obligations still blocking
at the current post-implementation phase. Author classifications, exact original
request bindings and canonical proof freshness govern eligibility. Future completion-only
obligations, absent requests, invalid dispositions and already discharged obligations
cannot justify this cross-stage clarification. The adapter observes Git dependencies;
the optional `evidenceDependencies` observation is preserved in new receipts, while
historical receipts without it retain their original schema and admission behavior.

Only blocker eligibility crosses the stage boundary. Review calculations, preserved
completion sets and consumed rounds still concern the current stage. Preparation
results are neither replayed nor relabeled as post-implementation results. Recovery
opens clarification; it does not discharge the obligation or certify the mission.
