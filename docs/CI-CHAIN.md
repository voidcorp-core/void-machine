# CI chain

Source snapshot: `08e75a8c`, 5 November 2026. The diagrams describe checked-in
workflow behavior, not live protection settings. The [CI economy programme](plans/2026-11-05-ci-economy-plan.md)
changes this chain incrementally; update this page with each relevant change.

## From local work to publication

```mermaid
flowchart TD
  Edit[Local focused tests and implementation] --> Review[Local independent review of exact candidate]
  Review --> PR[Ready PR targeting develop]
  PR --> Checks[ci and void-enforce]
  Checks --> Authority{Clean review, required checks, up-to-date head}
  Authority -->|Protected paths or human hold| Person[Human merge decision]
  Authority -->|Autopilot admissible| Queue[develop merge queue]
  Person --> Queue
  Queue --> Group[merge_group: ci and void-enforce]
  Group --> Develop[Merge into develop]
  Develop --> Promotion[promotion workflow maintains develop-to-main PR]
  Promotion --> PromotionCI[Promotion PR: ci and void-enforce]
  PromotionCI --> Human[Human promotion merge]
  Human --> Main[Push main]
  Main --> MainCI[ci on main]
  Main --> ReleasePlease[release: release-please job]
  Main --> Backmerge[back-merge workflow opens or updates return PR]
  Backmerge --> PR
  ReleasePlease --> ReleasePR[Release PR: version and changelog]
  ReleasePR --> ReleaseCI[ci and void-enforce]
  ReleaseCI --> HumanRelease[Human release PR merge]
  HumanRelease --> ReleasePush[Push main; release-please creates release]
  ReleasePush --> ValidateRelease[validate-release: validate source and pack once]
  ValidateRelease --> Publish[publish: verify exact bytes and publish]
  Publish --> VerifyPublication[verify-publication: registry integrity and provenance]
```

The local reviewer and protection decisions are not GitHub Actions jobs. There is
no GitHub model-review workflow. Both promotion and release PR merges remain human
actions; this optimisation programme authorizes neither. A release PR opened with
the Release App token triggers normal PR checks. Back-merges return through the
protected integration path; they are not direct unverified writes to `develop`.

## Current `ci.yml` job DAG

```mermaid
flowchart LR
  Event[Ready PR / merge group / main push / dispatch] --> Validate[validate]
  Event --> Artifact[consumer-artifact]
  Event --> Graph[project-graph-conformance: Ubuntu, macOS, Windows]
  Artifact --> Browser[browser-conformance]
  Artifact --> Install[install-conformance: Ubuntu, macOS, Windows]
  Validate --> Gates[Sequential verification gates and exact-SHA aggregation]
  Graph --> Classify[Classify inside each allocated runner]
  Classify -->|Relevant or uncertain| GraphProof[Build, tests, types and packed graph conformance]
  Classify -->|Unrelated PR paths| GraphSkip[Skip graph steps]
```

Only artifact-to-browser and artifact-to-install edges are job dependencies in
this workflow. The other arrows inside `validate` and graph jobs show sequential
steps. There are nine jobs after matrix expansion. `void-enforce` runs separately;
`validate` aggregates its own gate reports, not the conformance or enforcement
jobs. GitHub protection and the local merge decision consume required results.

For draft PRs, `consumer-artifact` and graph jobs are skipped; downstream consumer
jobs cannot run. `validate` and `void-enforce` stop at their early admission guard
with non-success before installing dependencies. Marking the PR ready triggers
complete checks without needing another commit. A conversion back to draft
invalidates obsolete PR work. Distinct merge groups, dispatches and release runs
have isolated concurrency keys. Unknown graph relevance currently runs tests.

The PR proof subject is its head SHA; merge-group checks prove the group SHA.
The immutable consumer tarball and source manifest are produced once, then used
by browser and three OS installation jobs. Graph conformance is a separate path.
Current graph classification considers package paths but needs the wider input
and rename coverage in DEV-1144 before allocation can safely be optimized.

## Certification and release job dependencies

```mermaid
flowchart LR
  Schedule[Sunday 03:23 UTC or manual dispatch] --> Stress[stress: install, twenty fast, ten complete attempts]
  Stress --> Reports[Exact-SHA reports retained even after failure]
  RP[release-please] --> VR[validate-release]
  RP --> P[publish]
  VR --> P
  RP --> VP[verify-publication]
  VR --> VP
  P --> VP
```

Certification is an independent reliability workflow, not a PR status dependency.
At the audited source it installs dependencies but omits compiled prerequisite
preparation; DEV-1141 repairs that before interpreting stress results. The release
DAG additionally has event/result conditions: a normal promotion push proposes a
release PR, while a created release (or supported manual recovery) admits release
validation. See [release policy](RELEASING.md) for the full authority contract.

## Approved changes and measurement order

```mermaid
flowchart LR
  A[1139: promotion drafts] --> B[1140: consumer CI examples]
  B --> C[1141: repair certification]
  C --> D[1142: profile subprocess]
  D --> E[1143: deduplicate preparation]
  E --> F[1144: repair graph classifier, then allocation]
  F --> G[1145: bounded local proof applicability]
```

These arrows show the requested execution order. Linear owns real blockers;
DEV-1142 depends on DEV-1141's reliability prerequisite. One worker preserves
ordering across shared files. Protected PRs wait for a person's merge after
review; other admissible PRs use the existing autopilot path. New promotion PRs
will be drafts, while an existing ready promotion keeps its human-selected state.
The full [baseline and limits](specs/2026-11-05-ci-economy.md) distinguish total
job-minutes from latency and potential avoidance from demonstrated savings.

## Open the real graph

Open a run from [CI](https://github.com/voidcorp-core/void-machine/actions/workflows/ci.yml),
[enforcement](https://github.com/voidcorp-core/void-machine/actions/workflows/void-enforce.yml),
[promotion](https://github.com/voidcorp-core/void-machine/actions/workflows/promotion.yml),
[certification](https://github.com/voidcorp-core/void-machine/actions/workflows/test-certification.yml)
or [release](https://github.com/voidcorp-core/void-machine/actions/workflows/release.yml).
Each run summary shows GitHub's actual job graph and links each node to its logs.
The graph belongs to that run, so it also shows skipped and failed jobs; this
static page supplies the cross-workflow context. See GitHub's
[visualization graph guide](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph),
[event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
and [job-condition semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).
