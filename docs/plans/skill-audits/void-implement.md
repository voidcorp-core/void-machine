# Skill audit: implement

## Why this skill exists

The harness had no single definition of "take one ticket and ship it at expert-team
quality." The behavior was implied (compose tdd, security, review by hand) and
partially duplicated inside `backlog-autopilot`'s inline per-ticket cycle. Result:
agents executing a ticket interactively skipped passes (E2E, UX, security, review)
under speed pressure, and the autopilot cycle drifted from what a careful human
would do.

## Baseline failure observed

In real use (DECLIK, 2026-06-26), tickets were implemented without an explicit
security or review pass, and "go fast" was read as "skip the expensive passes."
The failure is omission-under-pressure, not ignorance.

## Form chosen (per writing-skills "Match the Form to the Failure")

- **Recipe** for the pipeline: the cycle IS the output, a numbered ordered list of
  passes, each naming the skill it composes. Recipe beats prohibition for
  shape/omission failures.
- **Conditional keyed to an observable predicate** for triage: each pass fires on
  a checkable condition (touches a boundary / a UI / a trust edge), so "fast" is
  principled, not a loophole. This is the load-bearing design choice.
- **Discipline guard** (red-flags + rationalization table) only for the ALWAYS
  passes, because skipping those is a knows-better-skips-anyway failure.

## Deliberate decisions

1. Single source of truth: backlog-autopilot delegates here rather than keeping its
   own cycle (DRY, anti-overlap rule of the repo).
2. Composes existing skills/agents; reimplements none (anti-bloat).
3. `impeccable` preferred for the UX/UI pass when installed, with a graceful
   fallback to harness:frontend-design + accessibility + gstack design-review.
4. ALWAYS passes: ingest gate, TDD, security (quick scan minimum), review,
   verification, ship. Conditional: architecture, E2E, UX/UI.

## Open follow-ups

- Full writing-skills pressure-test suite (multi-pressure scenarios per pass) not
  yet run; the skill is grounded in an observed baseline failure plus a subagent
  application check. Schedule a dedicated RED-GREEN pass.
- Consider a companion hook that warns when a PR touches a trust-boundary file but
  no security-pass marker is present.

## 2026-07-01 — UX/UI pass strengthened around `impeccable`

The UX/UI pass (step 7) previously "preferred `impeccable` when installed" as one
option among a compose-fallback. It now **leads with `impeccable`** as the
interface-quality standard (browser-verified craft: hierarchy, density, typography,
motion, responsive, anti-slop) on top of the functional baseline (BACK+FRONT parity,
mobile/desktop, loading/error/empty states); the `frontend-design + accessibility
+ /design-review + /qa` compose is the fallback when `impeccable` is not installed. A
red-flag row ("It renders, ship the UI") was added. Rationale: "it works" was being
read as "it's done" for UI tickets; the pass now holds the interface to production
craft, not just rendering. No new dependency — `impeccable` was already referenced;
this elevates it from a preference to the default. Still one pass, one subject.

## 2026-07-10 — migration apply ordering + prod-via-CI boundary (Migration safety pass)

Step 3 (Migration safety) previously stopped at the *design* review of a schema
change (two-phase, batched backfill, locking). It said nothing about *applying* the
migration, so the downstream TDD/E2E passes could run against a stale dev schema and
either fail spuriously or pass against the wrong shape. Added the ordering principle:
once generated and safety-reviewed, the migration is applied to **dev/local before
the test passes run**, and — the load-bearing safety boundary — this cycle only ever
applies to dev/local; **production migrations run through CI / GitHub Actions on
merge, never from a worker or session**. The credible alternative (agent applies to
prod too, or never applies even to dev) was rejected: prod DDL is a human-gated deploy
decision (mirrors the `migrations` anti-rule "MUST NOT auto-apply on push to
main"), while a dev apply that a human must run defeats the point of a ticket cycle
whose tests need the real schema. The concrete Drizzle/Neon commands live in the
`harness-server:drizzle-migration-safe` pack, not here — this stays generic ordering.
See `docs/DECISIONS.md` 2026-07-10.

## gstack /ship vendoring (DEV-388, de-gstackification Vague 2)

/ship's pre-PR checklist is mostly ALREADY covered here (review, tests, commit, PR) + by verify + commit-discipline. **Integrated** (the genuine cycle-level deltas): Test-Failure-Ownership triage (adjudicate a red suite in-branch vs pre-existing before proceeding — this skill assumed green), the independent fresh-context adversarial review pass (attacker/chaos lens, FIXABLE/INVESTIGATE, name the single most exploitable finding), and bisectable commit ordering (infra→domain→edge, each independently valid). **Rejected**: the Review-Army roster (7 named specialists + adaptive gating) as an over-engineered release-gate apparatus for a single ticket — kept only its *idea* (scope-gated fresh-context lenses); and the VERSION/CHANGELOG/release-please steps (release-please owns versioning here). The plan-completion-audit half of /ship went to verify, not here.

## 2026-07-24 — tracker lifecycle becomes part of execution

The runner previously moved a ticket to `In Progress` without assigning it, then
marked it `Done` as soon as a PR opened. That made interrupted cross-session work
ambiguous and overstated completion. The cycle now fetches native relations, claims
and assigns before edits, leaves a bounded resume comment when unfinished, moves to
`In Review` with PR/evidence, and reaches `Done` only after merge plus final
verification. Human gates remain human, and an active program fails closed when its
tracker cannot be updated.

Rejected: a local current-ticket file or plan resume pointer for tracker-backed
work. Either would duplicate mutable tracker state and create a drift path.

## 2026-07-26 — native team orchestration (DEV-441)

The former review pass named several skills and critics but could still be satisfied by one parent
context composing prose. That is not an independent team and allowed a command proof to produce a
false green while Architecture, Security, or QA never completed.

The skill now loads the canonical mission plan and delegates execution truth to the pure,
event-sourced controller. One lead writer owns implementation and correction; native read-only
specialists run in fresh contexts and emit structured completions. The correction loop is capped at
two rounds, invalidates only changed input hashes, and blocks on missing, malformed, duplicate,
wrong-role, timed-out, stale, or degraded review evidence. Linear moves to In Review when the PR
opens and to Done only after merge.

Sources consulted: official Claude Code subagent and headless-mode docs; official Codex subagent and
non-interactive-mode docs. Adapted rather than copied. Rejected: sequential self-review, reviewer
writes, majority voting, all-proof invalidation, unbounded retries, and timeout-as-success.

## 2026-08-21 — canonical dispatch replaces the local reviewer roster

The skill still named a three-role Architecture/Security/QA minimum after the canonical specialist
catalog had grown to sixteen roles. That prose was executable and therefore became a second routing
table: applicable specialists outside the trio could be installed and tested without ever running.

The orchestration section now starts one controller-owned mission and loops on `void-harness
mission dispatch`, iterating envelopes only when the returned action is `invoke-specialists`.
The Mission Engine owns applicability, stage, round, contract version and input hash; the skill owns
native runtime handoff and records the same lead writer after implementation/correction. Codex maps
`agentName` to `spawn_agent`'s `agent_type`, Claude Code to `Agent`'s `subagent_type`. The nonexistent
workflow-file reference was removed. Rejected: adding all sixteen names to prose, or letting the
caller pass stage/round, because either would recreate a second routing authority.

The hardened handoff also binds the ticket content at mission start, derives writer identity and
round from a controller-issued receipt, and records an explicit closure on completion, stop,
interruption, or abandonment. This prevents ticket substitution and forged writer progress while
giving the audit an honest boundary for distinguishing unfinished work from an agent that never
launched. Runtime identity is derived from native session markers rather than a caller option;
unknown shells are degraded and Codex markers take precedence over a coincident Claude marker.

## Specialists through the delegation kernel (DEV-929, 2026-09-30)

Each `invoke-specialists` envelope is launched as one `void-machine agents dispatch --role review`
run, with `agentName`, `runtime` and `missionId` copied from the envelope and the `contextPack`
as its brief file, instead of the coordinator's native `Agent` or `spawn_agent` call. The
specialist lifecycle events keep their shape; `contextId` is the run's id. The kernel's bound of
four open runs per mission is met by dispatching in waves, never by dropping a specialist, and a
refused dispatch stops the cycle: a native subagent in its place would be the silent subset the
dispatch contract forbids.
