---
schemaVersion: 1
id: "adr:31ca9a60-43aa-4dd1-800e-766030e3a15e"
createdAt: "2026-08-19T11:30:00.000Z"
title: "A skill file is agnostic; harness metadata travels beside it"
status: accepted
deciders: ["folpe"]
supersedes: []
---

# A skill file is agnostic; harness metadata travels beside it

## Context

Every `SKILL.md` carried seven fields this harness invented: `kind`, `owner`, `runtimes`,
`enforcement`, `eval_targets`, `activation`, `triggers`. The Agent Skills specification defines
six fields and the official validator refuses everything else:

```
$ npx skills-ref validate packages/core/skills/void-tdd
Unexpected fields in frontmatter: activation, enforcement, eval_targets, kind, owner, runtimes.
Only allowed-tools, compatibility, description, license, metadata, name are allowed.
```

None of the seven is read by a runtime. They feed this repository's graph, and `runtimes`
additionally tells the installer which skills reach Codex. So a skill exported anywhere else
carried our vocabulary for nothing, and failed validation because of it.

Two Claude Code fields were also in use, `disable-model-invocation` on three skills and
`when_to_use` on one. Both are documented by Anthropic and both are refused by the same
validator, which is what made full conformance look unreachable without giving up
functionality.

## Decision

A `SKILL.md` carries only what the specification defines. The seven harness fields move to a
co-located `harness.yaml`, excluded from what a consumer receives exactly as `.source` already
was. The two Claude Code fields are dropped rather than moved.

## Consequences

Positive:

- Every skill passes the official validator, so the corpus is exportable: claude.ai uploads, the
  Skills API, `package_skill.py`, or any agent that reads the format.
- The installed `SKILL.md` is byte for byte the source, on both runtimes. Verified with `diff`.
  There is no compiled frontmatter, so reading a skill on disk remains a way to read the skill.
- The graph parser reads a real YAML sidecar instead of parsing markdown frontmatter field by
  field with hand-written scanners. The migration removed code rather than adding it.
- Nothing a consumer receives mentions this repository.

Negative:

- A skill is two files where it was one. The pairing is enforced by a test rather than by the
  filesystem.
- `disable-model-invocation` is gone from `void-doctor`, `void-audit` and `void-graph`, so
  Claude Code may load them on a description match. The mitigation is what already carried the
  rule on the other two runtimes: the description says the gesture is on request, and each skill
  opens with "only when a human asks". Loading a skill is not running it.

## Alternatives considered

- **Move everything under `metadata`, which the spec provides for exactly this.** One file, and
  it validates. Rejected on the requirement itself: the skill would still carry the harness's
  vocabulary, so it is not agnostic, only tolerated. `metadata` is also specified as a string to
  string map, while `enforcement` is nested.
- **Keep the Claude Code fields and accept partial conformance.** Rejected once measured: with
  `when_to_use` folded into `description` — which the spec asks to state both what a skill does
  and when to use it — and `disable-model-invocation` dropped, no runtime-specific field
  remained. Partial conformance bought nothing that full conformance did not.
- **Inject the Claude Code fields at install time**, keeping the source clean and the installed
  file enriched. Rejected as unnecessary once the field count reached zero, and it would have
  made the installed file differ from its source for one field on three skills.

## Reversal cost

Low to medium. The split is mechanical in both directions and the readers are two functions, one
per package. What would be expensive is reintroducing a harness field into the skill file
silently: the corpus would fail validation again, and the failure only shows up when someone
tries to export a skill, which is exactly the moment nobody is looking for it. The test that
holds the six fields is what makes that loud.
