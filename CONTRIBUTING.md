# Contributing

Contributions are welcome. This repo enforces more of its conventions in CI than most, so read this first — it is short, and it will save you a red build.

## Setup

```bash
pnpm install
pnpm test          # 1100+ tests, ~30s
```

Use the exact Node version in `.node-version` (26.12.1) for local development and primary CI/release jobs. Every first-party package declares Node `>=26.12.1`; CI and publication use this single current runtime, with no older-runtime compatibility lane. Select the declared version with your Node manager; no tool here changes your global Node installation. pnpm is pinned via `packageManager`; do not pass a `--version` to `pnpm/action-setup`.

## The rules CI actually enforces

These are not style preferences. A PR violating them fails `validate`:

| Rule | Gate |
| --- | --- |
| Discovery `description` target ≤250 and hard cap 500; valid skill identity, agent tool isolation and hook syntax | `pnpm anti-bloat:check` |
| Every version-carrying manifest at the same version | `pnpm version:check` |
| `packages/cli/dist/core-assets` mirrors `packages/core` | rebuild with `pnpm --filter ./packages/cli build:assets` |

If you edit anything under `packages/core/`, run:

```bash
pnpm --filter ./packages/cli build:assets
```

and commit the result.

## Conventions that bite

- **Conventional Commits, and the PR title matters.** PRs are squash-merged, so the *PR title* becomes the commit release-please reads. A non-conventional title is silently ignored and your change vanishes from the changelog. This has happened twice; do not make it three.
- **Every commit message ends with *why*, not just *what*.** The git log is documentation.
- **Lasting structural decisions** use short Markdown records with light frontmatter through `void-decide`. Preserve existing files, IDs and links. Ordinary corrections use Git commits; material changes create a new decision linked to its predecessor. Doctrine changes retain human agreement through `void-learn`.
- **Any new convention** must land in `docs/*.md` in the same commit.
- **TDD is not optional** for logic. Write the failing test first; `tdd-guard` blocks production files without a sibling test.

## Adding a skill

Read `CLAUDE.md` ("Anti-bloat discipline" and "Sourcing discipline") before writing one. In short: one skill, one subject; no more than 30% responsibility overlap with an existing skill; distilled and adapted from its sources, never vendored verbatim; a `.source` sidecar with useful adaptation rationale. Historical audit notes remain available; no second document is required for every skill.

Name it `void-<what someone would type looking for it without knowing it exists>`,
and declare which grammar applies to the part after the prefix in the frontmatter.
`kind: action` is a thing you run and takes the bare verb (`void-plan`,
`void-verify`, `void-implement`); `kind: standard` governs how code is written and
takes the subject it governs (`void-tdd`, `void-observability`). Prefer clear
action verbs and meaningful subjects; assess ambiguous names in context. The prefix is not
decoration: a runtime resolves skills from several providers, and the level this
harness installs into loses every collision it enters, silently.

`pnpm anti-bloat:check` enforces technical names, prefix, kind and directory
identity. `pnpm skills:check-references` validates namespaces and plugin references
on shipped surfaces, plus skill names and directory paths in code. Use repository
search to find call sites before a rename; there is no generated reference register.
Paths mentioned only in prose have no dedicated gate. If one is wrong during work,
report it, find the real target and propose the correction; an ambiguous target
never permits a fabricated path or a relaxed permission.

The reasoning, and the alternatives that were rejected, are in
`docs/decisions-log/2026-08-18-skill-naming-rule-three-families--c109429b-480e-48a9-baba-93f644f9e9e1.md`
and in the decision on prefixing every shipped skill.

## Multi-runtime

The harness targets Claude Code **and** Codex through a runtime-adapter seam (`packages/cli/src/lib/runtime-adapters.ts`). Author doctrine once and compile it per runtime; do not add a Claude-only path with a Codex apology. What genuinely cannot cross over is tabled in `docs/CODEX.md` — add to that table rather than letting a capability silently degrade.

## Reporting

Bugs and harness gaps go to [issues](https://github.com/voidcorp-core/void-machine/issues). Security findings go through a [private advisory](https://github.com/voidcorp-core/void-machine/security/advisories/new) instead — see `SECURITY.md`.
