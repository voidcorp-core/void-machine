---
schemaVersion: 1
id: "adr:c47c4f7a-8ae4-44b1-89e4-5636829feaa6"
createdAt: "2026-08-03T16:36:42.435Z"
title: "doctor distinguishes unprobed from unknown"
status: accepted
deciders: []
supersedes: []
---

# doctor distinguishes unprobed from unknown

## Context

`doctor` reported three outcomes: pass, fail, unknown. Two autopilot
preconditions — is the tracker reachable, is the base protected — are remote
facts that `doctor` deliberately never probes, because `--no-remote` promises a
fully offline run and autopilot proves both at its own preflight, before the
lease. Reported as `unknown`, each line carried a fix ("run the check again with
the connector configured", "grant the token repository read access") that no
configuration could ever satisfy, because the value is hardcoded at the call
site on every project, forever.

A consumer (voidcorp-core/void-music, issue #193) paid for that: several probing
commands plus a full read of `preflight.ts` and `runtime-adapters.ts` to
establish that one line was unactionable by design and the other misattributed.
The second suggested a token scope that was already correct; the real cause was
GitHub answering 403 "Upgrade to GitHub Pro or make this repository public" — a
private repo on a free plan cannot have a protected base at all, which is the
constraint that actually mattered and the one the message hid.

The same collapse existed one line up: a `.void/program.md` that exists but does
not parse was caught and reported as "no .void/program.md", sending the reader to
author a program already written, while the parser's own problem/cause/fix was
discarded.

## Decision

Add `unprobed` as a fourth check status, distinct from `unknown`: `unknown` is a
fact this run tried to read and could not (actionable), `unprobed` is a fact this
run never asks for by design (nothing to act on, so it carries no fix and prints
a dim `-` rather than a yellow `?`). Report the two remote-backed autopilot facts
as `unprobed`, name them separately in the summary, and carry the parse verdict
of a malformed `ACTIVE.md` through to the reader instead of collapsing it into
"absent".

## Consequences

Positive:

- A line that cannot be acted on no longer looks like one that can, which is the
  entire cost the issue reported.
- The offline contract of `doctor` becomes visible in its output rather than
  being knowledge held only in a source comment.
- The branch-protection message now names the plan constraint, so a free-org
  private repo learns the truth that matters: no server-side gate can exist, and
  the human merge gate is enforced by harness contract only.
- A malformed ACTIVE reports the parser's verdict, and the two checks that read
  its fields no longer assert things the file never said.

Negative:

- A fourth status in the vocabulary every reader of `doctor` must hold, and one
  more branch in the render rules.
- The status union is shared by `init`, so the addition is visible beyond the
  command that needed it.

## Alternatives considered

- **Keep three statuses and only reword the fix.** Cheapest, and it removes the
  wrong instruction, but the line still reads as a measurement that failed. The
  issue asked precisely for the legend to separate "unknown by design" from
  "unknown this run"; wording alone cannot carry that at a glance.
- **Make `doctor` probe both facts.** Would produce a real answer, and it breaks
  the `--no-remote` contract, makes the command depend on a network and a token,
  and duplicates a proof autopilot already performs at preflight, where failing
  closed actually protects something.
- **Drop the two checks from `doctor` entirely.** Removes the noise and also the
  signal: an operator reading the preflight wants the full list of preconditions,
  including the ones proven elsewhere.

## Reversal cost

Low. The status is additive: removing it means mapping `unprobed` back onto
`unknown` in `checkGlyph` and restoring two literals at the `doctor` call site.
No persisted data carries the value.
