---
name: void-source-driven-development
description: Ground every third-party config or API usage in the official docs for the installed version, not training memory. Verify the version; cite the reference when it helps. Use before writing any tool config.
---

# source-driven-development

Training memory drifts. It blends three minor versions of a framework into one plausible-looking config that compiles, runs, and is subtly wrong: a renamed option, a removed flag, a default that flipped between majors. This skill makes the official documentation of the **installed version** the source of truth for any third-party tool. The read is mandatory; the citation is not. Where a choice is not obvious, a brief reference in the commit lets the "why" outlive the session.

This encodes the repo hard rule: *read the official documentation of any third-party tool before writing its config.*

**Attribution**: see `.source` in this directory.

---

## The rule

When you configure or call a third-party tool (framework, library, CLI, API, build tool):

1. **Find the installed version.** Read the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`) or the resolved entry, not just the `^x` range in `package.json`. Options change between majors; the range lies about what is actually resolved.
2. **Read the docs for that version.** Pin the docs to the resolved major/minor. Latest-docs for an older installed version is a silent mismatch.
3. **Prefer a clean read.** Use the `defuddle` skill (or WebFetch) on the official docs. Strip nav and ads to the load-bearing prose. Distrust third-party tutorials, blog posts, and Stack Overflow answers: they are dated by construction and rarely say which version they target.
4. **Cite when it helps.** For a non-obvious choice, put the URL + section (or doc path) in the commit body, the PR, or a comment next to the config, so the next reader can re-derive it. A missing citation never blocks on its own.

Memory proposes; docs dispose.

---

## Conflict resolution

| Conflict | Winner | Why |
|---|---|---|
| Memory vs official docs | Docs | Memory is a lossy average of many versions; docs describe one. |
| Two sources disagree | Official + version-matched | Vendor docs for the installed version beat any third party. |
| Docs vs a stale tutorial | Docs | Tutorials freeze a moment; the tool moved on. |
| Latest docs vs installed-version docs | Installed-version docs | You ship what is installed, not what is newest. |

When the docs and a working example genuinely conflict and you cannot resolve it, that uncertainty is a finding: surface it, do not paper over it with a guess.

---

## What "cite the reference" looks like

In a commit (composes with `void-commit-discipline` — the "why" carries the source):

```
chore(build): set vite `build.target` to es2022

Vite 7 dropped the old `esbuild.target` shorthand; the documented field
is now build.target. Ref: vitejs.dev/config/build-options#build-target
(v7 docs, matches pnpm-lock resolved 7.0.x).
```

Next to non-obvious config:

```ts
// retries default changed to 0 in playwright 1.45; opt back in explicitly.
// ref: playwright.dev/docs/test-retries (v1.45 docs)
retries: 2,
```

What verifies a config line is the read of the version-matched docs, not the presence of a citation. A reviewer who doubts an option checks it against those docs; a concrete mismatch is a defect, a missing reference is not.

---

## When this applies

- Writing or changing any tool config (bundler, test runner, linter, ORM, CI, framework).
- Calling a third-party API or SDK where parameter names, defaults, or auth flow matter.
- Choosing options that differ across major versions.
- Upgrading a dependency across a major (re-read; do not assume the old config carries).

## When this does NOT apply

- First-party code in this repo (you own it; read the source, not "docs").
- Stable, well-internalized language built-ins where no version ambiguity exists.
- Throwaway exploration you will delete (but the moment it lands, the rule applies).

---

## Offline / no-network

Some runs have no egress: a sandboxed autonomous worker, an air-gapped CI step. You still must not write config from memory. Two moves keep the rule intact without opening the network:

1. **Inject the doc, do not fetch it.** Treat the version-matched reference as an *input*, not a side effect: pass the doc text (or a curated, version-pinned excerpt committed to the repo) into the decision as a parameter — a port — and validate its shape at the boundary with Zod before you trust it (e.g. assert the option you are about to set actually appears in the supplied reference). This is functional core / imperative shell: fetching is an adapter concern, the choice logic takes the doc as data. It composes with `void-hexagonal-architecture` and `void-security-guidance` (untrusted input is validated at the edge).

2. **If no version-matched doc is reachable and the semantics you are writing are genuinely uncertain, incur a `source-debt`.** A missing citation is not a source-debt. A `source-debt` is a short, honest note, in the commit body or the PR, naming exactly which `tool@version` option was authored offline and what remains uncertain about it. It is the alternative to guessing silently, not a mandatory field: a label or checkbox may carry it if the project uses one, but neither is the authority.

What matters is the verification itself: the real uncertainty is resolved against the version-matched official docs before the change ships. Once that read is done, a note, label or checkbox not yet updated never blocks on its own. The offline bypass is for *authoring* without egress, never for *shipping* config whose semantics remain unverified.

This widens egress by **zero** (decision A3): offline work defers the verification behind an explicit, reviewable IOU; it never reaches for the network it was denied.

---

## Composition

- **Upstream of `void-plan`** — stack decisions in a plan must be grounded in current official docs, not remembered defaults. A plan step that pins a library cites the doc that justifies the choice.
- **With `void-commit-discipline`** — the mandatory "why" in the commit body is where the source citation lives. The git log becomes the audit trail of *why this config*, traceable to a versioned doc.
- **With `void-decide`** (pack-monorepo) — a structural tool choice becomes an ADR whose "Alternatives considered" cites the official docs of each option, not folklore.
- **Contrast with memory-driven work** — the failure mode this skill replaces is writing config from training recall and only checking docs when it breaks. Invert that order.

---

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I know this API, I've used it many times" | You know an average of several versions. The installed one has its own truths. |
| "The docs will just say what I already think" | Then the read costs seconds and confirms it. When they don't, you just dodged a bug. |
| "It compiled / it ran, so it's right" | Wrong defaults compile fine. Deprecated-but-still-working options run fine. Until they don't. |
| "This tutorial does exactly this" | Tutorials rarely state their version and rot silently. Match the vendor docs to your lockfile. |
| "Checking the version is overkill for a config tweak" | The tweak that broke prod was a flag renamed between minors. The check is cheap. |
| "I'll read the docs later" | Later never comes. The read happens before the line; a citation, when useful, lands in the same commit. |
| "Latest docs are close enough" | "Close enough" between majors is how a removed option ships to prod. |

---

## Verification

The work is not done until the source check is done. Before marking any third-party config or usage complete:

- [ ] Installed version identified from the lockfile (not the `package.json` range).
- [ ] Official docs for **that** version read (via `/defuddle` / WebFetch, not memory or a tutorial).
- [ ] Every non-obvious option checked against that doc; cited briefly where it helps the next reader (never blocking on its own).
- [ ] Any memory-vs-docs conflict resolved in favor of the docs, or surfaced as an open question if irresolvable.

If the version check or the read is missing, the config is written from memory. That is the state this skill exists to prevent.

---

## Anti-rules

- MUST NOT write tool config from training memory alone — read the version-matched docs first.
- MUST NOT skip the installed-version check — the `^` range is not the resolved version.
- MUST NOT cite a third-party tutorial as authoritative — the official, versioned doc is the source.
- MUST NOT land config whose semantics were not checked against the version-matched docs. A missing citation alone is not that failure.
- MUST NOT silently pick a side when sources genuinely conflict — surface the divergence.

---

## When you are stuck

| Problem | Solution |
|---|---|
| Cannot find the official docs | Start from the package homepage / repo README, follow to the versioned docs site. Avoid SEO tutorials. |
| Docs only cover "latest" | Check the changelog / migration guide for your installed major; or read the versioned docs branch / tag. |
| Docs and a working snippet conflict | Trust the versioned official docs. If still unresolved, surface it as an open question, do not guess. |
| The option I remember doesn't exist | It was renamed or removed. Read the migration guide for your major. |
| No time to read everything | Read the one section governing the option you are setting. Targeted, not exhaustive. |

---

## Final rule

```
Third-party config → installed version found, version-matched official docs read, source cited when it helps.
Otherwise → it was written from memory, and memory is not a source.
```
