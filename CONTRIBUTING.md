# Contributing

Contributions are welcome. This repo enforces more of its conventions in CI than most, so read this first — it is short, and it will save you a red build.

## Setup

```bash
pnpm install
pnpm test          # 1100+ tests, ~30s
```

Use the exact Node version in `.node-version` (26.12.1) for local development and primary CI/release jobs. Every package still supports Node `>=24.15.0`; `tests (node 24)` repeats build, type check and tests at that minimum. Select the declared version with your Node manager; no tool here changes your global Node installation. pnpm is pinned via `packageManager`; do not pass a `--version` to `pnpm/action-setup`.

## The rules CI actually enforces

These are not style preferences. A PR violating them fails `validate`:

| Rule | Gate |
| --- | --- |
| Skills ≤ 400 lines, hooks ≤ 100 lines, discovery `description` target ≤250 and hard cap 500 across core, packs, agents, and canonical specialists | `pnpm anti-bloat:check` |
| `CLAUDE.md` and `AGENTS.md` stay in section parity | `pnpm sync:docs` |
| Every version-carrying manifest at the same version | `pnpm version:check` |
| Decision schemas, links, cycles and accepted-record immutability | `pnpm decisions:check` |
| `packages/cli/core-assets` mirrors `packages/core` | rebuild with `pnpm --filter ./packages/cli build:assets` |
| `model.json` and the embedded consumer bundle current | `pnpm graph:check`, `pnpm graph:check-bundle` |

If you edit anything under `packages/core/`, run:

```bash
pnpm --filter ./packages/cli build:assets
```

and commit the result. Editing a hook also changes its line count, which the graph model records — rebuild it too.

## Conventions that bite

- **Conventional Commits, and the PR title matters.** PRs are squash-merged, so the *PR title* becomes the commit release-please reads. A non-conventional title is silently ignored and your change vanishes from the changelog. This has happened twice; do not make it three.
- **Every commit message ends with *why*, not just *what*.** The git log is documentation.
- **Any non-obvious decision** gets its own collision-free file through `void-machine decisions new`. Never edit an accepted record or `docs/DECISIONS.md`; supersede the record instead.
- **Any new convention** must land in `docs/*.md` in the same commit.
- **TDD is not optional** for logic. Write the failing test first; `tdd-guard` blocks production files without a sibling test.

## Adding a skill

Read `CLAUDE.md` ("Anti-bloat discipline" and "Sourcing discipline") before writing one. In short: one skill, one subject; no more than 30% responsibility overlap with an existing skill; distilled and adapted from its sources, never vendored verbatim; a `.source` sidecar next to it and an audit note in `docs/plans/skill-audits/`.

Name it `void-<what someone would type looking for it without knowing it exists>`,
and declare which grammar applies to the part after the prefix in the frontmatter.
`kind: action` is a thing you run and takes the bare verb (`void-plan`,
`void-verify`, `void-implement`); `kind: standard` governs how code is written and
takes the subject it governs (`void-tdd`, `void-observability`). No gerund on an
action, no agent-noun for a mechanism, no filler suffix. The prefix is not
decoration: a runtime resolves skills from several providers, and the level this
harness installs into loses every collision it enters, silently.

`pnpm anti-bloat:check` refuses all four shapes. `pnpm skills:check-references`
proves that nothing points at a name that stopped existing, and
`pnpm skills:register-check` refuses any `void-` token or any
`skills/<name>/SKILL.md` path that resolves to nothing — read
`docs/SKILL-REFERENCES.md` before renaming one, it lists every place code names a
skill. The reasoning, and the alternatives that were rejected, are in
`docs/decisions-log/2026-08-18-skill-naming-rule-three-families--c109429b-480e-48a9-baba-93f644f9e9e1.md`
and in the decision on prefixing every shipped skill.

## Multi-runtime

The harness targets Claude Code **and** Codex through a runtime-adapter seam (`packages/cli/src/lib/runtime-adapters.ts`). Author doctrine once and compile it per runtime; do not add a Claude-only path with a Codex apology. What genuinely cannot cross over is tabled in `docs/CODEX.md` — add to that table rather than letting a capability silently degrade.

## Reporting

Bugs and harness gaps go to [issues](https://github.com/voidcorp-core/void-machine/issues). Security findings go through a [private advisory](https://github.com/voidcorp-core/void-machine/security/advisories/new) instead — see `SECURITY.md`.
