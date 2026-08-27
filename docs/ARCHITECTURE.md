# Architecture

## Topology

```
void-harness/
├── packages/
│   ├── cli/                       # voidharness
│   │   ├── src/commands/          # install, add, update, doctor, init
│   │   └── package.json
│   ├── core/                      # harness plugin (static assets, not an npm package)
│   │   ├── .claude-plugin/        # plugin.json — wires hooks, declares the plugin
│   │   ├── modules/               # 01-philosophy.md, 02-tdd.md, 03-tigerstyle.md...
│   │   ├── skills/                # craftsman skills (TDD, refactor, hexagonal, ...)
│   │   ├── agents/                # doctrine-critic and peers + generated specialist agents
│   │   ├── specialists/           # canonical, runtime-neutral specialist YAML
│   │   ├── profiles/              # versioned stack expertise and applicability selectors
│   │   └── hooks/                 # tdd-guard.sh, no-any-grep.sh, no-console-log-grep.sh
│   ├── mission-engine/            # pure event/evidence contracts and verdict reducers
│   ├── hook-runner/               # Node adapter compiled into the portable hook asset
│   ├── harness-graph/             # graph kernel + telemetry projections
│   └── packs/                     # one workspace + plugin per capability
│       ├── pack-monorepo/         # @voidcorp/pack-monorepo  (plugin harness-monorepo)
│       ├── pack-react/            # @voidcorp/pack-react      (plugin harness-react)
│       ├── pack-nextjs/           # @voidcorp/pack-nextjs     (plugin harness-nextjs)
│       ├── pack-server/           # @voidcorp/pack-server     (plugin harness-server)
│       ├── pack-pwa/              # @voidcorp/pack-pwa        (plugin harness-pwa)
│       └── pack-mobile/           # @voidcorp/pack-mobile     (plugin harness-mobile)
├── apps/                          # private, unpublished tooling
│   ├── graph-studio/              # the graph visualiser (Vite)
│   └── eval-harness/              # @voidcorp/eval-harness — behavioral skill evals
├── test/                          # automated skill tests (citypaul-style)
└── docs/                          # doctrine, architecture, release and decisions
    ├── specs/                     # approved designs
    ├── plans/                     # implementation plans
    │   └── skill-audits/          # one audit note per vendored skill
    └── decisions-log/             # one immutable, collision-free file per ADR
```

## The `.void/` layout — three levels, named for what deletion costs

Everything the harness owns or produces lives in `.void/`, so uninstalling or
migrating it is one directory. What the PROJECT owns and what outlives the
harness — decisions, specs, plans — stays in `docs/`.

Inside `.void/`, the question anyone actually asks is *can I delete this*, and it
has three answers:

| level | delete it and | committed |
|---|---|---|
| the top of `.void/` | the project loses a decision | yes |
| `installed/` | `void-harness install` restores it byte for byte | no |
| `machine/` | nothing is lost | no |

**Everything at the top of `.void/` is committed; the two subdirectories are
not.** That sentence is the whole rule, and it is checkable at a glance rather
than by looking anything up. It was false before: `PHILOSOPHY.md` and `hooks/`
sat at the top while being ignored.

`VOID_OWNERSHIP` in `packages/hook-runner/src/void-layout.ts` is the single
source of truth the ignore block, the migration and `doctor` all read. A second
copy would let `update` move a path the ignore rule does not cover, and the next
commit would ship telemetry.

Two properties are load-bearing and easy to break:

- **A retired entry stays classified.** Removing it from the table does not
  remove the file from anyone's disk; it makes it fall through to the `project`
  default, at which point `doctor` starts telling projects to commit their own
  telemetry. Retiring a READER is not retiring the data.
- **Readers fall back through every previous layout.** A project migrates on
  `update`, and until it does, a reader that only knew the current path would
  report months of history as none.

The migration merges rather than refuses: on a per-file collision the destination
wins and the legacy copy is parked beside it as `*.legacy`. Choosing a winner by
size or date was rejected on evidence — measured across the park, the legacy copy
held more data in one journal and far less in another, so no rule picks
correctly. It runs only inside `update`: writing to a project nobody asked to
have written to is the line this repo does not cross.

## Decision records

ADRs are an append-only data model, not a generated document:

- `void-harness decisions new` creates one exclusively-owned file with a UUID
  identity; concurrent workers never allocate a shared counter or index.
- `void-harness decisions check` validates the schema, unique identities,
  supersession links and cycles. In CI, `DECISIONS_BASE` also rejects edits,
  renames or deletions of accepted records. Its only edit exception is a
  repository-local path substitution with unchanged frontmatter, headings,
  structure and surrounding prose, and an existing root-confined target.
- Decision loading is root-confined, rejects symlinks and bounds each record to
  256 KiB before parsing.
- `void-harness decisions render --format markdown|json` produces a read-only
  projection on stdout. It computes effective supersession from inbound
  `supersedes` links, preserves the declared status, and names every replacing
  record. It never commits or rewrites a shared artifact.
- `docs/DECISIONS.md` is only the frozen pre-v3 landing page. Existing repos keep
  their detected ADR directory; new consumer projects default to
  `docs/decisions/`.

The public contract is plain Markdown plus YAML frontmatter, so it works without
an agent runtime. The CLI is deterministic validation and ergonomics, not a
storage dependency.

## Stack baseline

The harness assumes **TypeScript + web**. The core is not framework-agnostic across language families. See `docs/PHILOSOPHY.md` § "Stack assumption".

A future Rust/Go/Python flavor lives in a sibling repo, reusing mechanics not skills.

## Stack profile compilation

`packages/core/profiles/*.yaml` is the certified stack-knowledge catalog. Consumer extensions use
`.void/profiles/*.profile.yaml`; the explicit suffix lets policy overlays coexist in the same
directory. The CLI loads both through a bounded, alias-free, root-confined YAML adapter and the
mission engine validates and routes the resulting declarative contracts without filesystem I/O.

Routing is file-owner scoped. Each changed path belongs to its longest matching workspace package;
root technologies are inherited, while sibling technologies are not. A web TSX change can select
TypeScript, React, and Next.js without selecting Expo or SQL from neighboring packages. Every
decision is `applicable`, `not-applicable`, or `degraded`, carries the detector inputs and a stable
hash, and is compiled into the mission plan. Expired profiles and unknown or uncovered versions
degrade and require review against the profile's official sources. See `docs/PROFILES.md`.

## Agent runtime parity (Claude Code + Codex) — the adapter seam

The harness authors **one doctrine** and compiles it to each agent runtime through a **runtime adapter** (`packages/cli/src/lib/runtime-adapters.ts`). Today: **Claude Code** (via `CLAUDE.md` + native `.claude/skills`, `.claude/agents` and project hooks) and **Codex CLI** (via `AGENTS.md` + `.agents/skills`, native `.codex/agents` and a `.codex/` safety floor). The npm tarball is the default source; the Claude marketplace is an explicit secondary adapter. This is the *agent-runtime* axis; the orthogonal *model-provider* axis (Anthropic / OpenAI-compatible / Ollama / custom) is a separate seam and is deliberately not conflated.

The seam is the load-bearing rule: **core commands never branch on a runtime name.** `init`, `runtime add`, `doctor`, and `status` iterate the adapters. Adding a runtime (Codex exec, Hermes, a local agent) is a new adapter object registered in `ADAPTERS`, with zero edits to the commands. Each adapter owns exactly its runtime-specific surface: `detect`, `prerequisites`, `wire` (its active layer + **its own** doctrine doc), `inspect` (executable postconditions), and `doctorChecks`.

Rules:

- Doctrine in `CLAUDE.md` and `AGENTS.md` is identical. Only terminology adapts ("Claude Code" / "Skill tool" vs "Codex" / "tools / shell").
- `scripts/sync-agent-docs.sh` enforces parity on the harness repo itself: `--staged` (a commit touching one sister doc must touch the other) via `.githooks/pre-commit` (`git config core.hooksPath .githooks`), and section-heading parity in CI (`pnpm sync:docs`). This is a **harness-repo** rule; a consumer project only carries the doc(s) of the runtime(s) it wired.
- No file is auto-generated from the other. Auto-generation risks losing intentional adaptations. Manual authoring + mechanical gate is the safer trade-off.
- **Doc ownership is per-runtime.** Each adapter's `wire` writes only its own doctrine doc — a Claude-only project has just `CLAUDE.md`, a Codex-only project just `AGENTS.md`. `doctor` checks only the docs of *detected* runtimes, so a Codex-only project is never dinged for a missing `CLAUDE.md`. (`add` / `remove` still patch whichever docs exist, keeping active docs current.)
- **`init` wires each selected runtime's layer via its adapter**, gated by `--runtime <claude|codex|both>` (default: auto-detected footprint, else both). Claude receives native project-local skills, agents, commands and hooks; Codex receives `.agents/skills`, native `.codex/agents` and `.codex/hooks.json`. The package is bundled with all CLI runtime dependencies, so a tarball installs offline. `--source marketplace` is opt-in and is the only path that checks `gh`/marketplace access.
- **Publication is transactional.** `init` seeds only shared merge targets into an isolated stage, compiles and executes each selected adapter's doctor smoke there, then atomically publishes a finite mutation set. Every target is snapshotted before the first write; a failure restores bytes and modes and removes only transaction-created paths. `.void/machine/receipts/install-v1.json` hashes files the install created, already owned, or found already identical byte-for-byte to what it compiled — a managed asset matching our own output is ours, and letting it fall out of the receipt is what made a later version meet an asset it could not recognise. Unowned native conflicts fail unless `--force` (all of them named in one message, not the first alone), and even force never grants deletion ownership over a pre-existing file.
- **Runtimes are added a posteriori without friction**: `void-harness runtime add <runtime>` wires exactly that runtime's layer on an already-`init`-ed project, touching nothing the other runtime owns (verified byte-for-byte in tests). `runtime list` shows which are wired. This is the `void runtime add` command from the multi-runtime spec.
- **Pack and update lifecycle uses the same transaction.** Local `add`/`remove` compile the exact
  config pack set and prune only unchanged receipt-owned stale assets. Local `update` recompiles
  from the running CLI without a remote fetch. Legacy/explicit marketplace receipts retain their
  cache and remote-pin adapter.
- **The harness owns exactly the skills it ships; the project owns every other one.**
  `.claude/skills/` and its siblings are shared directories, and the manifest — not the path —
  answers which side a file is on. A skill the harness does not ship is never ignored and never
  written to; a skill it does ship is its alone to modify, so a locally altered copy is restored
  rather than defended. See the harness-owns-its-skills-project-keeps-its-own decision.
- **Ownership is the union of the two proofs, never a choice between them.** The receipt is
  machine-local and records what *this machine* wrote; the committed `.void/install-manifest.json`
  names the paths *this version* owns and travels with the repository. `update` completes the
  receipt with every manifest path it does not cover — the receipt staying authoritative on any
  path both name, since only its hashes tell a hand-edited file from an untouched one. An absent
  receipt (every fresh clone) is the degenerate case of the same mechanism, not a separate route.
  See the ownership-is-union-of-receipt-and-manifest decision.
- `doctor` iterates the *detected* adapters for each runtime's wiring + doc health; Claude marketplace checks (`gh`, plugin cache, remote versions) apply only to an explicit marketplace install. Adapter inspection distinguishes `installed`, `wired`, `fired`, and `observed`. The `fired` postcondition executes the installed Node runner against an isolated fixture and reads back its canonical event; a zero exit without that event stays red. In the source repository, `doctor` delegates to the self-host receipt and current-source checks instead of applying consumer assumptions. See `docs/CODEX.md`.

### Consumer programme and session handoff

Every generated `CLAUDE.md` or `AGENTS.md` carries the same conditional bootstrap: if
`.void/program.md` exists with `status: executing`, the runtime reads its plan and spec before
choosing implementation work. `ResumeBundle` composes that versioned global context with the local
checkpoint and Git. A plain continue/start/resume request uses the declared progress adapter to
recover exactly one started scoped unit, or selects the first ready unit from the stable order and
native blocker relations. More than one started unit is a competing-claim error.

The programme is opt-in and project-owned. `init`, `update`, and runtime adapters never create or
mutate it. `void-ticket` creates it only after a human-approved multi-unit plan has been fully
materialized in a capable progress provider. It stores durable context and routing only: programme,
plan/spec links, provider scope, ordered unit identifiers, lifecycle-state roles, human gates, and
the required `autopilot` consent block. Mutable status, assignee, blockers, comments, and review
evidence live only in the provider.

`packages/cli/src/lib/autopilot/program.ts` is the only parser of that contract. It
validates every field on read and refuses a file that is present but wrong, rather than falling
back to a default: a typo in `mergeGate` must never be what hands a merge to a machine. Paths
declared in the file stay repo-relative and non-escaping, so a program cannot point at `/etc` with
a YAML syntax.

Automatic continuity is capability-gated rather than Linear-specific: the declared provider
must support reading and updating status, relations, assignee, comments, and review evidence. If
that surface is unavailable, the runtime stops the remote action instead of inferring progress
from local files. The semantic sections of `.void/machine/checkpoint.md` are replaced at a
deliberate session close and stay readable offline; neither the checkpoint nor the programme stores
a current or next unit.
Human gates and merges remain human. A standalone ticket or sequential plan keeps using its normal
ticket or resume-point flow and does not need a programme descriptor.

### Mechanical context continuity

The checkpoint is also the single local continuity file. A uniquely delimited mechanical block
coexists with the semantic sections: `void-checkpoint` owns objective, position, proven state, open
loops, dead ends, assumptions, and the exact next action; the lifecycle handler owns only observed
usage, bounded read/modified paths, overflow, and revision/cycle facts. Every semantic rewrite must
preserve that block byte-for-byte. There is no sidecar or reconciliation daemon.

The dependency direction remains the normal one. `mission-engine` makes pure revision, recency,
threshold, merge, and complete/degraded decisions. `hook-runner` normalizes Claude Code and Codex
payloads, reads at most 1,048,576 transcript bytes, confines project paths, and replaces the block
under a no-wait lock through a same-directory temporary file and rename. Runtime manifests only
map `UserPromptSubmit`, `PostToolUse`, `PreCompact`, and `SessionStart` to that handler.
The lock covers the complete read-modify-write decision. Stale takeover is serialized by a
no-wait claim chain whose generations are created exclusively and never ranked by timestamps, and
checkpoint mutation stays anchored to an opened, verified machine directory while relative
no-follow files are read and renamed. Transcript reads use no-follow bounded descriptors. Codex
transcripts remain project-local; Claude may also use its
project-scoped transcript directory when the file name exactly matches a bounded session ID.
Configuration reads are regular-file-only and capped at 65,536 bytes. Direct runtime read/write
payloads contribute paths, while shell-mediated reads remain unobserved.

The latest complete `message.usage` record is an occupation observation, not accumulated session
cost. A nudge is possible only when `.void/config.json` supplies a positive `context.windowTokens`;
the 40–60% integer threshold defaults to 50. Unknown windows produce no percentage. The handler
never invokes `/clear`, `/compact`, or `void-checkpoint`, and never authors semantic residue.
`SessionStart:clear` is consequently degraded until a later semantic checkpoint reconciles the
revisions. A semantic rewrite invalidates the previous `sealed_work_revision`; only a successful
`PreCompact` can seal the current work revision, so a failed seal cannot be rendered complete on
the next compact resume. See the decision
[PreCompact may preserve mechanical checkpoint state](decisions-log/2026-08-27-precompact-preserves-mechanical-checkpoint-state--da9bb0a9-9c5a-46df-9459-27a583e92af2.md).

### Source self-host boundary

`void-harness self-host sync` is the only supported dogfood compiler for this
meta-repository. It hashes bounded, symlink-free current inputs, builds the hook
runner and a disposable runtime-adapter worker directly from TypeScript, then
wires `.void/machine/generated/.staging-*` through that current-source worker. The
source set is hashed again before publication; concurrent drift aborts.
Publication swaps the complete directory to `.void/machine/generated/current`; a
failed swap restores the last green artifact.

The deterministic receipt records the source hash, rollout mode and every owned
file's bytes + mode. An identical sync is a no-op. `self-host doctor` separately
reports source staleness, artifact drift, discovery, adapter hook smoke,
canonical event replay and native runtime availability. Missing runtime CLIs are
degraded, never certified or silently green.

Doctor probes receive a minimal portable child environment plus their explicit
`VOID_*` contract. Provider credentials, registry tokens, home paths and other
ambient configuration never cross that process boundary.

This boundary never writes `packages/core/`, root `CLAUDE.md`/`AGENTS.md`, or
root `.claude`/`.codex`/`.agents` surfaces. All generated files and runtime probe
metadata are gitignored. Modes `shadow` and `warn` are advisory; `enforce` and
`release-gate` fail on structural blockers.

## Agent model tiers

Authored legacy agents declare an explicit `model:` in their Claude frontmatter, chosen by the work's leverage, not by default. Canonical specialists deliberately omit a model: both compilers inherit the selected parent runtime model so the provider-neutral contract cannot pin a provider-specific tier. The tiering (distilled from `wshobson/agents`):

| Tier | Use for |
|---|---|
| **opus** | Architecture, security, critical review, production-coding — high-leverage work where a wrong call cascades |
| **sonnet** | Documentation, test authoring, debugging, codebase exploration — substantial but bounded reasoning |
| **haiku** | Mechanical, fast ops — formatting, simple lookups, deterministic transforms |
| **inherit** | Work whose complexity varies run to run; let the calling session's model carry through |

**Rule**: a new authored runtime-specific agent MUST declare an explicit `model:` per this tiering. A new cross-runtime specialist MUST instead inherit and put its hard limits in the canonical budget. The existing `doctrine-critic` is the authored-agent example; `solution-architect` is the canonical-specialist example.

## Native specialist contracts

The 16 canonical product, architecture, engineering, review, and conditional PDF roles live under
`packages/core/specialists/*.yaml`. The strict loader
bounds files, disables YAML aliases, rejects unknown keys and duplicate identities, then each
runtime compiler embeds the same instructions and structured result schema. Claude receives
`.claude/agents/*.md`; Codex receives `.codex/agents/*.toml`. The five older Markdown critics also
compile to native Codex TOML, so no agent is represented as an inline skill.

The Claude marketplace needs discoverable `agents/*.md` in the source tree. Those 16 files are
generated artifacts, not a second doctrine source: tests compare them byte-for-byte with the YAML
compiler. Runtime health derives the expected identities from that same catalog rather than a
parallel role list. Installed files are receipt-owned and updated transactionally.

The lightweight dispatch health probe checks native specialist assets without rerunning the hook
smoke on every controller step. Claude specialists are `available`: their explicit `tools`
allowlist excludes mutating built-ins and reaches no inherited MCP tool. Codex remains `degraded`:
its TOML declares `sandbox_mode = "read-only"`, disables web search and MCP servers, but the parent
turn can override the sandbox and Codex has no per-agent process allowlist. Discovery remains
useful; Codex orchestration may not claim enforced isolation until a runtime probe proves it.

## Boundary principles

### Core vs Packs

| Concern | Where |
|---|---|
| TypeScript + web craftsman discipline (universal within that stack) | `core/` |
| Process skills (brainstorm, planning, debugging) | `core/` |
| Hooks that enforce universals | `core/hooks/` |
| Framework-specific patterns (Next.js, React Native, etc.) | `packs/<pack>/` |
| Framework-specific extensions of core skills | `packs/<pack>/` (can extend, not override blindly) |
| Package-manager / monorepo-tool specifics (Bun, Turbo, pnpm) | `packs/pack-monorepo/` |

**Rule**: a file in `core/` may assume TypeScript, Zod, `tsc`, vitest-style discovery. It may NOT assume a specific framework (Next vs Remix vs SvelteKit), a specific runtime (Node vs Bun vs Deno), or specific monorepo tooling. Those decisions live in packs and are read from `.void/config.json` at runtime.

### Portable hook runtime

Inline enforcement rules live as pure TypeScript in
`packages/hook-runner/src/rules/`. Lifecycle policies and bounded imperative
adapters live under `packages/hook-runner/src/lifecycle/`. The generated
`_void-hook.mjs` normalizes Claude and Codex inputs, bounds invalid/binary
payloads, executes commands with `shell:false`, applies timeouts and maps common
verdicts to exit 0/2.

Native Claude and Codex manifests invoke that bundle directly. A local install
stages exactly one runtime asset, regardless of platform. The short shell files
under `core/hooks/` are compatibility adapters for older installs; v3 manifests,
receipts and health checks do not depend on them. `_hooklib.sh` and `_checks.sh`
remain characterization inputs only and are not part of the active runtime.
The local runtime therefore requires Node only, not `jq` or a POSIX shell.

Every active hook records a bounded, redacted `hook.completed` event. Lifecycle
states distinguish `ok`, `skipped` and `degraded`; enforcement additionally
records `blocked`. Formatting touches only files named by the tool call. Output
trimming spills the full result under `.void/outputs/`, and typecheck is scoped
to changed TypeScript plus the nearest tsconfig where the command supports it.

Two content-aware hooks sit beside the filename/path guards:

- **`secret-in-content.sh`** (PreToolUse Edit|Write, blocking) — the companion to
  `protect-sensitive-files.sh` (which only guards known secret *filenames*). It
  scans the edit's new content for high-confidence vendor tokens (AWS/GitHub/
  Stripe/OpenAI/Anthropic/Slack/Google keys, PEM headers) and one guarded generic
  rule (a `*_KEY|_SECRET|_TOKEN` var assigned a long, mixed, non-placeholder
  literal — excluding UUIDs, git shas, and env indirection). Bounded to the edit
  (never the repo; that is gitleaks/CI). Escape hatch: `// allow-secret-pattern:`;
  test/fixture paths are skipped.
- **`stop-typecheck.sh`** (Stop, **advisory**) — when a TS project has uncommitted
  `.ts` changes at end of turn, it runs a timeout-bounded `tsc --noEmit` scoped to
  the nearest tsconfig of the touched files and surfaces type errors on stderr, so
  the "typecheck clean" item of `void-verify` is answered from
  observation. It **never blocks** (a blocking Stop would trap the session) and
  no-ops with no TS project, no TS edit, or no `tsc`.

### Pack independence

A pack **may not carry a bundled runtime `dependencies` edge on another pack** — that hides a dependency graph and couples release cycles. If two packs share substantial logic, that logic belongs in `core/`.

One exception is allowed: an **explicit, documented `peerDependency` of composition** — a stack pack that deliberately presupposes another (e.g. `pack-nextjs` peer-depends on `pack-monorepo` for the `Result`/`ok`/`err` primitives, and `init` co-installs them). This is not a hidden edge: it is declared in `package.json` `peerDependencies`, documented in the pack README, and the consumer installs both. Extracting three functional primitives into their own package to avoid it would be premature (see `void-package-extraction`). Prefer this over a new shared package when the shared surface is small and the composition is intentional.

### CLI scope

The CLI is the only entry point. It:

1. Installs core into `~/.claude/voidcorp/`
2. Adds packs to the current project's `.claude/` (via symlink or copy)
3. Updates both
4. Runs `doctor` to detect drift / corruption / version mismatch
5. Runs `init` to create `.void/config.json` in a new project

The CLI does **not** edit the consumer's source code. The consumer's CLAUDE.md imports harness modules — the harness never writes business code.

## Inter-plugin contracts (the core-hub model)

The core plugin is **always installed** and acts as the hub between plugins. A sibling plugin (today: `forge`, the ideation pipeline) routes into the core's execution capabilities (`void-brainstorm`, `void-plan`, `void-ticket`, `void-tdd`, ...) rather than reimplementing them or dangling a pointer at a gstack skill. The nominal routing assumes the core is present; the coupling is nonetheless a **versioned artifact contract**, not a hard plugin dependency, so each plugin still makes sense alone — forge degrades to producing a standalone spec, core works with a hand-written spec.

Re-splitting core into `core` + `dev` (execution) sub-plugins is explicitly **deferred (YAGNI)**: one core-hub is enough until a second consumer of the "execution" half exists.

### The forge → harness spec contract

The interface is a markdown spec the harness **owns the format of**, dropped by forge (or a human) at `docs/specs/YYYY-MM-DD-<slug>.md`. Frontmatter marks provenance and the recon summary:

```yaml
---
source: forge # provenance; core skills ingest instead of re-asking
forge_version: "0.2.0" # contract version, for tolerance on older specs
slug: <kebab-slug> # disambiguates two specs in one repo
verdict: GO | GO_PRUDENT | NO_GO # forge:recon critique verdict
score: 0-100 # recon composite score
red_ocean_score: 1-10 # differentiation aggressiveness driver
---
```

The body carries the **18 load-bearing recon variables** (the interface's payload), the **winning design** (chosen `forge:design-prompt` variant), and the **critique verdict** (`forge:critique` findings). The 18 variables, named:

- **Business (10)**: `positioning_statement`, `primary_persona` (`.title` + `.context`), `pain_severity`, `current_solution`, `top_buying_objections`, `competitive_advantage`, `main_competitors`, `price_point` (+ `pricing_justification`), `primary_kpi`, `decision_timeline`.
- **Visual identity (8)**: `emotional_promise`, `brand_archetype`, `signature_moment`, `motion_personality`, `density_target`, `aesthetic_axes`, `inspiration_refs`, `vocab_pro` (+ `vocab_banned`).

**Ingestion rule** (core skills): when a `source: forge` spec exists, **verify and fill the gaps — never re-ask what it already answers**. A partial spec (recon without critique, or a missing field from an older `forge_version`) is ingested for what it has, with the missing pieces listed as the only open questions. Two specs in one repo are disambiguated by `slug` / date.

`void-brainstorm`, `void-plan`, and `void-ticket` each honor this rule (see their SKILL.md "Ingesting a forge spec" note). The forge side of the contract lives in `voidcorp-core/forge` (forge#4).

## Dependency direction

```
cli  →  core  ←  packs
```

- `cli` depends on `core` (for the install logic, version manifest)
- `packs` depend on `core` (for shared modules / skills they extend)
- `core` depends on nothing inside the repo

## apps/ (surfaces)

`apps/*` are private, unpublished surfaces that consume the packages. They may
depend on `packages/*` (e.g. `apps/graph-studio` devDepends on
`@voidcorp/harness-graph`), never the reverse. They are exempt from the 400-line
skill cap (they are apps, not skills) and from version lockstep (private, not
shipped). `apps/graph-studio` is the maintainer 3D view of the component graph
(spec §7): a Node prebuild runs the kernel's `analyze()` into static JSON, and the
browser bundle is a pure renderer of that JSON (functional core / imperative shell,
the same split the kernel uses).

`apps/eval-harness` (`@voidcorp/eval-harness`) is the **behavioral** skill eval. The
`test/` suite proves a skill's *form* (frontmatter, size, structure); this proves its
*effect*: it runs a fixture task with the skill's `SKILL.md` body (frontmatter
excluded) appended to the system prompt and without it, N times each, and scores
the delta. A skill "works" when the
with-skill mean beats the without-skill mean past a noise threshold. It makes every
prose change testable (and the gstack vendoring verifiable — is the distillate as good
as the source?). Same functional-core / imperative-shell split: pure `scorers.ts` +
`runner.ts` (unit-tested, no LLM) behind a `RunOnce` port, with the `claude -p` sandbox
adapter as the only impure edge. **Deterministic scoring first** — assertions over the
final files / git state (commit-discipline is scored with zero LLM judge); an LLM judge
is a last resort. Isolation: `--setting-sources ""` + a fresh sandbox dir keep global
plugins/skills/`CLAUDE.md` out of the baseline without relocating the config dir (so
OAuth still works); any constant bias cancels in the with-minus-without delta. Runs cost
tokens, so it is a **local command (`pnpm eval <skill>`), never a blocking CI gate** in
v1. See `apps/eval-harness/README.md` for the method.

## Consumer graph delivery (`/void-graph`)

The graph kernel uses a common node-link envelope at `schemaVersion: 3` for CatalogGraph,
MissionGraph, EvidenceGraph, and ProjectGraph. Every node, edge, and hyperedge has a
namespaced stable ID, typed origin, numeric confidence, and bounded provenance. The source carries
its producer version and a SHA-256 `rootHash`; validation rejects duplicate IDs, dangling
relations, invalid observation timestamps, path escapes, oversized payloads, and hash drift.
Graph deltas name their base and resulting root hashes and are applied only after both the delta and
the resulting snapshot validate.

ProjectGraph is extracted locally through replaceable root-identity, filesystem, workspace,
Git, cache, change-journal, and TypeScript Compiler API ports. The default Node adapters skip
project-entry symlinks, stream directory entries, revalidate canonical root, parent, and descriptor
identities at use, bound file/entry/directory/depth/aggregate/peak-heap/cache/process resources,
and execute a trusted absolute Git through argv without a shell, protocols, hooks, external diff,
textconv, repository clean/process filters, or ambient config. Git HEAD, changes, and ownership
report degradation separately. Validated `HEAD` reads bracket their complete collection; a mismatch
degrades the whole Git snapshot rather than combining evidence from different repository states.
Commands that depend on a commit use the initial object ID, which also closes `HEAD` ABA transitions.
SHA-256 extraction records plus an explicitly authoritative accepted change-journal generation make
unchanged builds perform zero traversal, extraction reads, hashing, and AST passes without trusting
mutable JSON. The default Node `fs.watch` journal is advisory, so default builds verify sources before
reuse; callers may inject an authoritative loss-detecting journal to unlock the fast path.
The builder's default is a bounded LRU memory cache scoped to the current process. The explicit Node
repository-cache adapter ignores all repository cache bytes and refuses publication because a
repository author can reseal a self-hash and portable Node cannot close path-based parent-swap races.
A complete build whose selected cache port cannot publish remains usable but reports `degraded`.
Trusted ports prepare and commit an invisible candidate. Finalize validates canonical
root identity and the same change-journal generation, then publishes with an immediate
compare-and-swap and no async interleaving; abort only releases pending state. It does not re-read or
re-hash the tree. The resulting `observed-content-v1` token commits to the canonical root key and
root/parent identity, root-entry journal generation, observed path/device/inode/size/mtime/ctime and
content-hash manifest, Git state, and extractor version. The ordinary file-change generation gates
acceptance and publication without becoming part of the content token. Later mutation is a new
observation rather than retroactive invalidation. Cached tokens are never accepted as freshness
evidence. The same memory adapter is injectable for isolated workflows and tests. `.void/cache/` is
gitignored.
A stable advisory Node watcher brackets Git with two complete bounded source observations. A watcher
unavailable before extraction forces a complete degraded rebuild; capability lost during
the build produces partial or degraded evidence according to the last validated phase. Neither path
reuses or publishes cache state.
Cached tombstones, bounded composed lineage with its original Git HEAD/ref proofs, and Git HEAD
preserve deleted/renamed identity across
unchanged builds and committed renames. A partial or concurrently-mutated build
keeps the last green cache and stays explicitly `partial`, so downstream context
selection falls back to source instead of trusting incomplete topology. Git
proof is the only authority for `previous-id` rename continuity.
Seven read-only queries answer the impact and targeted-context questions over an extracted
snapshot: `explain`, `path`, `impact`, `subgraph`, `owners`, `testsFor`, and `staleness`. Each is
deterministic, takes a node/depth budget, and reports `truncated` rather than returning a silently
short answer. `ownersOf` and `testsFor` answer an explicit `unknown` with a reason where nothing was
extracted, never an empty list, because "the graph does not know" and "nothing owns/tests this" are
different claims and only one is safe to act on. `impact` walks dependents and counts
`dynamic-imports` exactly like `imports`, since a dropped dynamic edge under-reports impact. A
Git-proven rename is followed forward from the retired path, so a caller holding a pre-rename path is
told what the file became rather than that nothing depends on it. The CLI surface
(`void-harness graph <query> <file>`, backed by `packages/cli/src/lib/project-graph-store.ts`) takes
and answers in repository-relative paths, refuses a target outside the project root, renders owners
by label because an owner id is hashed when the name is not id-safe, and prints an explicit source
fallback naming the count, codes, and paths extraction left out whenever the build is `partial` or
`degraded` or the observed root hash moved. Accuracy is proved against a graph the extractor actually
produced (`query-corpus.test.ts`: cycles, tsconfig aliases, dynamic imports, renames), and the seven
queries carry their own seeded benchmark and regression gates
(`benchmarks/project-graph-query/`, `pnpm benchmark:query`), separate from the extraction benchmark
so a query regression cannot hide behind extraction cost.

ProjectGraph is exposed from `@voidcorp/harness-graph/project`, keeping its
TypeScript runtime adapter out of the legacy single-file CatalogGraph bundle.
The extractor resolves bounded root-confined string or ordered-array `tsconfig` inheritance with
official Compiler API option origins, treats `pnpm-workspace.yaml` as authoritative over the package
workspace fallback, applies pnpm-compatible positive and `!`-excluded patterns before indexing child
manifests, recognizes a bounded Vitest call grammar, and preserves
volume-specific case behavior. ESM clauses, re-exports, wildcards, and
defaults are explicit export surfaces; CommonJS assignment exports are limited to JavaScript input.
An edge static analysis cannot determine — a non-literal dynamic import, a specifier that is not a
bounded printable string — is reported as `unresolved-import` on the file that holds it and does not
degrade the build state, because a whole project marked partial by one ordinary lazy import made the
source fallback fire unconditionally and therefore say nothing; the query surface reports that
uncertainty against the files in an answer instead. `invalid-source` is kept for a file that genuinely
does not parse, and declaration files are no longer transpiled for diagnostics (they have no output,
and asking for one threw). Stable per-path exclusions — oversized, binary, symlink, permission — never
abandon the advisory verification scan nor count as a path-set change, so one large generated artifact
can no longer switch off the check that catches a tree mutated during evidence collection; identical
issues observed by both passes are reported once. Invalid config chains remain explicit partial
evidence. CI runs
package tests/typecheck, a two-track ProjectGraph benchmark, and a packed
`@voidcorp/harness-graph/project` consumer import on Ubuntu, macOS, and Windows. The performance
track injects a deterministic authoritative journal port and explicitly emits every fixture mutation,
while a separate native track classifies the real watcher as advisory, unavailable, or mixed. The
native track never claims fast-path latency; unavailable and mixed are supported degraded capabilities,
never relabeled as performance.

The current source catalog is adapted to v3 first. `catalog.v3.json` is the canonical versioned
snapshot; `model.json` is its read-only v1 compatibility projection for Graph Studio, audit,
certification, status, and the existing consumer bundle. Those readers also pass v1 through the v3
validator before use. `graph live` serves both `/catalog.v3.json` and `/model.json`. Rollback can
restore direct v1 reads and remove the v3 artifact because the adapter never mutates its input.

The graph tooling also ships to consumers, not just the monorepo. A build step
(`packages/cli/scripts/build-void-graph.ts`) bundles the kernel + `graph` CLI into one
self-contained `packages/core/graph/void-graph.mjs`: `model.json` is baked in via the
`__VOID_BUNDLED_MODEL__` esbuild define, and the single-file vite studio is inlined via
`__VOID_BUNDLED_STUDIO__`. The marketplace ships `packages/core` directly, so the artifact
reaches consumers with zero npm publish. The `/void-graph` command runs it from
`${CLAUDE_PLUGIN_ROOT}/graph/void-graph.mjs`.

On a consumer the CLI runs in **bundled mode**: it loads the baked model instead of scanning a
source tree (no monorepo paths), filters it to the packs enabled in `.claude/settings.json`, and
correlates it with local mission journals (`.void/runs/*/events.jsonl`, plus
read-only v2 import, and transcripts). `graph live` serves the inlined studio
and a `/studio-data.json` endpoint on loopback - fully offline. Freshness
is gated by `graph check-bundle` (the artifact's embedded compatibility model must match
`model.json`); see
DECISIONS.md (2026-07-01). The artifact is excluded from the `core-assets` mirror.

## Mission event journal (`.void/machine/runs/<mission-id>/events.jsonl`)

### Deterministic mission planning

Before runtime orchestration, `@voidcorp/mission-engine` compiles bounded ticket, diff, stack,
policy, profile, and specialist-catalog values into an explained risk classification, complete pass
and specialist applicability matrices, and a canonical DAG. The package remains pure: YAML,
filesystem confinement, Git inspection, stack detection, and native agent materialization stay in
the `voidharness` CLI shell.

Policy precedence is `core < profile < organization < project`. Overrides are monotonic by default;
weakening requires a visible, approved, expiring waiver. The compiler rejects unresolved conflicts
and gives every quality-floor pass an initial state plus an input hash. `planHash` excludes only the
observation timestamp. The paths, schema, failure contract, and rollback are documented in
[`POLICIES.md`](POLICIES.md).

The public boundary is:

```text
strict YAML + root-confined files ──> CLI policy loader
                                      │
                                      v
                         pure policy/risk/mission compiler
                                      │
                                      v
              risk + pass/specialist applicability + canonical DAG
```

Every canonical specialist is evaluated. Mission signals and applicable profile/pattern signals
select roles; a complete non-match emits `not-applicable`, while unavailable diff/stack evidence or
a matching degraded profile emits `degraded`. Each decision records the predicate, examined inputs,
reason, canonical mission-input hash, contract version, and classifier version. Schema/SQL evidence
activates Data & Migration, Observability/SRE, and QA. Baseline policy rules activate their
accountable QA and Security specialists even for an otherwise narrow change. CSS activates
frontend/accessibility roles without fabricating data work. PDF is selected only for a PDF input or
deliverable. This specialist-bearing input is mission-plan `schemaVersion: 2`; legacy v1 callers
receive an explicit migration error before catalog access.

Applicable UI work adds a pure fail-closed quality gate after planning. An Experience Designer
attestation must match the current mission input before implementation. After implementation, QA
captures each applicable state at mobile and desktop sizes, and a Visual Craft Director reviews
that evidence in a distinct fresh context. Tests, captures, and the post-build review carry the
current diff hash; a later component or CSS change makes them stale. Six named craft dimensions
must each reach 8/10, and unavailable browser proof blocks instead of falling back to LLM-only
approval. The gate is exported by `@voidcorp/mission-engine`; browser I/O remains in runtime adapters.

All runtimes now emit one strict, versioned event contract. `@voidcorp/mission-engine`
validates bounded JSON and reduces it without I/O. `@voidcorp/hook-runner` adapts
Claude/Codex hook payloads, redacts content, derives an opaque mission ID and
assigns a continuous per-mission sequence under an exclusive cross-platform lock.

The canonical append-only line contains `schemaVersion`, `seq`, opaque `eventId`
and `missionId`, UTC time, source, dotted kind, subject, correlation and bounded
payload. Attempts, outcomes and Stop therefore share one writer and one ordering.
The writer rejects path escapes and symlinks, isolates a partial tail, uses
user-only modes where supported and never blocks the agent runtime on telemetry
failure. The same generated dependency-free Node bundle also owns the critical
inline/CI enforcement rules. It is rebuilt by `pnpm hooks:build` and gated for
drift before `core-assets` is mirrored.

Graph behavior, cost, audit, status and Studio consume the canonical journal.
Legacy `.void/activations.jsonl`, `.void/outcomes.jsonl` and `.void/usage.log`
remain read-only transition inputs; current hooks never append to them. Each
project self-registers an opaque pointer under `~/.void/projects/` for opt-in
cross-project aggregation.

`graph live` binds loopback only. A random launch token is exchanged once for a
process-local `HttpOnly; SameSite=Strict` cookie, foreign browser origins are
rejected, and every data/SSE route requires the session. SSE uses the stable
event ID, honors `Last-Event-ID` (or the first-connect `after` cursor), backfills
the bounded snapshot and reports discontinuity as `PARTIAL`, never as live truth.
Studio renders `LIVE`, `RECONNECTING`, `STALE`, `PARTIAL`, `REPLAY` and `OFFLINE`.

### Evidence, findings and verdicts

The journal is also the single source for mission quality. A run keeps immutable
metadata in `mission.json`, canonical events in `events.jsonl` and optional
redacted quarantine copies under `quarantine/`. Findings, resolutions,
exceptions and evidence are event kinds, not independently mutable ledgers.
Separate `findings.jsonl`, `evidence.jsonl` or UI summaries may exist only as
rebuildable projections.

Command evidence records redacted argv, exit code, start/end/duration, producer,
source, confidence, bounded output, affected file nodes, input hash, diff hash
and typed dependency hashes. `canonicalJson` sorts object keys recursively before
SHA-256 sealing. The checksum proves canonical integrity and detects corruption;
it is deliberately not described as a signature against a user who controls the
local machine.

The pure verdict reducer compares only declared dependency hashes. A changed Git
worktree invalidates diff-dependent evidence without invalidating an unrelated
proof. Open non-waivable blockers remain blocking; accepted waivers yield
`shipped-with-exception`, never `verified`. Missing/stale proof yields
`unverified`; malformed, duplicate, cross-mission or integrity-broken input
yields `degraded`. The projection carries no evaluation timestamp, so replay of
the same journal and dependency context is byte-for-byte deterministic.

### Team review controller

`packages/mission-engine/src/orchestration/` owns the provider-neutral ticket cycle. The controller
consumes the canonical mission plan and event stream; it never launches a process or writes a file.
One lead writer owns implementation and every correction. Every specialist whose canonical routing
decision is `applicable` runs through a runtime-native adapter in a separate fresh context and
returns the shared structured completion contract. The controller has no fixed role list: it
consumes specialist IDs and exact contract versions from the mission plan. Each receives a bounded
plan slice and one assigned lens; findings outside that lens belong to the specialist that owns it.
Each contract declares `pre-implementation`, `post-implementation`, or both. Applicable upstream
specialists must pass before the lead writer starts; post-implementation reviewers receive a new
context and completion identity, so an upstream approval cannot satisfy downstream review. Input
hashes are keyed by stage: the pre-build snapshot stays frozen while post-build and correction
hashes follow the implemented diff.

Interactive runs prefer the runtime's native subagent primitive. Headless certification launches a
fresh native role session directly when parent-to-child delegation cannot prove an attributable
completion: Claude selects the installed project agent; Codex compiles the installed TOML role into
an ephemeral session. Both remain read-only. Codex specialists may use sandboxed commands only to
locate, search, and read repository text; project scripts, builds, tests, package managers,
interpreters, and VCS mutations remain prohibited.

The controller also requires the adapter's effective specialist-runtime capability, independently
of the declared runtime name. Each CLI `RuntimeInspection` produces that capability from native
asset health plus the runtime's enforceable isolation limits. `unavailable` blocks before dispatch.
`degraded` may still run the reviews so their evidence and limitations are observable, but can
never produce `verified`; the controller stops degraded after the bounded cycle. A runtime can
therefore reach `verified` only after its actual adapter or probe reports the required fresh-context
specialist capability as available.

Direct and orchestrated invocation share the mission engine's one strict completion parser; unknown
fields or malformed nested evidence are rejected identically. The review reducer accepts each
completion ID and context ID once, checks the stage and planned contract version, deduplicates
findings by concrete evidence, and compares per-specialist input hashes. Completions must be
attributed to the runtime selected at mission start; upstream evidence must precede the first writer
completion and downstream evidence must follow the latest writer completion. A
correction therefore supersedes downstream reviews recorded after the initial implementation but
before the latest writer completion; they preserve the attempted-round history without becoming
malformed evidence, while the sequence-derived next round, fresh identities, and fresh hashes
remain mandatory for the next review. Inside one implementation boundary, a higher round can retry
only a missing or failed specialist; it cannot replace a completed review or erase its findings. The
loop is capped at two rounds. Missing input
hashes, missing or mismatched contract versions, malformed, wrong-role, duplicate, timed-out, stale,
or degraded specialist evidence cannot produce `verified`; persistent blockers end `blocked`.
`void-implement` is the human-readable conductor. It obtains the applicable IDs from
`void-harness mission dispatch`; it never owns a local role list. The CLI compiles a fresh canonical
plan at controller-owned mission start, persists an integrity-bound minimal routing snapshot, and
materializes only the controller's next action. Pre-implementation hashes stay bound to that
snapshot; post-implementation hashes follow the current diff. Codex consumes each envelope with
native `spawn_agent`; Claude Code with native `Agent`.

`void-harness mission` exposes the operator lifecycle:

- `start --title ... --ticket ... [--mode team|fortress]` creates the
  controller-owned run and binds its canonical ticket path, ticket-content hash and routing
  snapshot; it derives runtime identity from the native session environment, with Codex markers
  taking precedence over Claude's `CLAUDECODE=1`, and degrades an unattested shell. The shorter
  form remains available for evidence-only missions;
- `dispatch --id ...` reloads that bound ticket, refuses changed content, and returns the exact
  next controller action and, only for
  `invoke-specialists`, every deterministic envelope with its contract version and current input
  hash; callers cannot inject a stage, round, runtime, or role list;
- `specialist-event --id ... --status started|completed|failed --input ...` validates one bounded
  lifecycle transition against the prior request/start, rejects secret-bearing content, and
  records it idempotently without retaining prompts or raw model output;
- `writer-event --id ...` consumes the controller's pending writer-action receipt, deriving the
  single lead writer and round rather than accepting either from the caller;
- `close --id ... --reason interrupted|abandoned` records an explicit terminal boundary for
  unfinished work; controller `complete` and `stop` actions close automatically;
- `resume --id ... [--json]` replays the durable journal, records one resume
  checkpoint, and returns the next safe action without dispatching a proven
  side effect again;
- `verify --id ... -- <argv...>` executes with `shell:false`, captures a redacted
  bounded proof and returns the current verdict; `--shell` is explicit;
- `inspect --id ... [--json]` recomputes the current Git diff and exits non-zero
  unless the verdict is shippable;
- `archive --id ...` writes an explicit `.jsonl.gz` snapshot only for
  `verified` or `shipped-with-exception`;
- `prune --older-than ...` is a dry-run unless `--apply` is supplied and removes
  only runs that already have an archive.

### Harness learning loop

Hooks own measurement and certain enforcement, never orchestration. Skills conduct workflows,
canonical contracts decide applicability, and agents supply bounded independent judgment.
`void-graph` joins those declared relations to human-session activations, outcomes and cost;
`void-audit` reduces the joined evidence to one prioritized proposal per component. Telemetry repair
precedes behavioral conclusions. Failure repair precedes retirement. Retirement is reviewable only
after twenty human sessions, while self-host and smoke missions are excluded from adoption proof.
Every proposal flows to `void-learn` as HITL input; no graph or audit command edits, fuses or removes
a component. Missing `requested -> started` and `started -> completed|failed` transitions become
repair proposals only after the same mission has a canonical `mission.closed` event, so active work
is never diagnosed as a dead agent.

### Modes, budgets, and recovery

Mode selection is a pure contract over the canonical plan. `fast` is accepted only for explicit
low risk and retains the same evaluated and required passes as `team`; it removes only optional
redundancy. Unknown or medium risk promotes to `team`. Any high-risk predicate promotes to
`fortress`, which adds threat modeling, an independent adversarial security review,
rollback/recovery proof, safe DAST when executable, and a second proof for critical invariants.
These assurance requirements overlay the core pass policies; they do not weaken or duplicate the
bundled `policies/*.yaml` rules.

The budget reducer accepts cumulative, sourced observations. Crossing 70% drops unloaded context,
90% reduces optional redundancy and favors still-valid proof, and 100% pauses work. A jump emits
every crossed transition once. Unknown cost stays `unknown`, never zero, and the reducer carries
the mandatory pass set unchanged through every state.

Recovery is event-sourced and bounded. A transient failure gets one reduced-context retry, then a
same-tier replacement. Sequential fallback is legal only when independence is declared
non-essential; otherwise recovery blocks. Side-effect adapters receive a stable idempotency key and
current input hash, then must append `side-effect.completed` with both in its receipt. On resume, a
valid fresh receipt yields only a logical finalization action; stale, malformed, or conflicting
receipts and partial event streams fail closed. The
mission engine remains I/O-free, while `mission resume` is the filesystem adapter that appends at
most one `mission.resumed` event for the current non-resume checkpoint.

`mission resume` reports `active`, `complete`, `waiting`, `blocked`, or `degraded`. `active` and
`complete` exit 0; all other recovery states exit 1 because no safe forward action completed.
Invalid arguments exit 2. Filesystem, schema, and journal failures use the existing structured
`MISSION_*` error envelope and exit 1. `--json` returns the decision plus whether this checkpoint
created a new `mission.resumed` event.

Invalid journal lines are preserved for forensics and copied once, redacted and
bounded, into quarantine; they are never silently repaired. Runtime journals and
archives are local artifacts ignored by Git. There is no automatic retention or
network upload.

## Node frontmatter: `activation` (graph liveness)

A skill's SKILL.md frontmatter may declare `activation: always` or `activation: on-demand`
(absent = `on-demand`, the default). It tells the graph cost/behavior kernels how the node
earns its place:

- `always` — doctrine followed **passively**: its rule applies via `@.void/installed/PHILOSOPHY.md`
  and enforcing hooks, never invoked through the Skill tool, so `invocations: 0` is expected,
  not a death signal. Exempt from `dead` / `underused` / `low-yield`, marked with the positive
  `always` flag (still eligible for `expensive`). Granted only on **auditable backing**: the
  skill is the target of an `enforces` edge, or its principle is stated in `PHILOSOPHY.md`.
  16 skills qualify.
- `on-demand` — a workflow triggered **actively** (brainstorm, plan, ticket-*,
  autopilot, ...), or a conditional skill with no structural backing (async-safety,
  api-and-interface-design, ...). If never invoked, a low count is a real signal — historical
  behavior.

The predicate is "is `invocations: 0` a death signal for this node?" — answered by structural
proof, not taste. See DECISIONS.md (2026-07-04) for the 16/15 partition, the two accepted proofs
of backing, and why the mode is declared explicitly rather than inferred.

## Node frontmatter: `owner` (governance)

The capability contract (spec `2026-07-21-void-harness-public-multiruntime-os`, Phase A) is authored
as **SKILL.md frontmatter fields** — the same channel `activation`/`triggers` already use, so no new
file discovery is introduced. The first field is `owner:` — the accountable maintainer of the
capability. It is read in `read-frontmatter.ts` (`parseOwner`) and threaded onto `GraphNode.owner`.

Governance is **fail-closed**: the `missing-owner` detector (`analyze/missing-owner.ts`, wired into
`DETECTORS`) emits a blocking `error` for any **skill** node with no `owner`, so `graph check` (and
the CI "Graph integrity" gate) fails. No capacity ships without a proof of ownership. The rule is
scoped to skills — hooks, commands, packs, and agents are not capabilities.

Two more contract fields land through the same seam (`read-frontmatter.ts` → `GraphNode`):

- `runtimes:` — the runtimes a capability declares it supports (`[claude, codex]`). A second
  fail-closed detector, `missing-runtimes`, blocks any skill that declares none (the runtime matrix
  cannot place an undeclared capability).
- `enforcement:` — the **two-tier** enforcement contract (spec Fork 1). `floor: ci` is the
  runtime-agnostic CI floor (the void-enforce Action) every runtime inherits; `inline` is the
  per-runtime in-session tier (`pretooluse` where the runtime supports a blocking hook, `active`
  otherwise, `ci-only` for Hermes). The `inline.{claude,codex}` tier is **derived, not
  hand-classified**: a skill that is the target of an `enforces` edge gets `pretooluse`, else
  `active` — so the map cannot drift from the actual hook wiring. Enforcement is declared per runtime
  and never masked; Hermes' `ci-only` is a structural limit, scored on its own ceiling, not a failure.

Two more fields complete the authored contract (A3):

- `eval_targets:` — the `(runtime, provider, tier)` cells a capability is authored/certified for,
  **slug-encoded** `runtime/provider/tier` in a normal YAML list (`[claude/anthropic/opus]`). The slug
  form is parsed by the shared `parseList` helper (reused with `runtimes:`), not a fragile
  hand-rolled list-of-maps parser. It drives which cells the certification manifest (A4) may mark
  `effective`.
- `success_signal:` — an optional human-readable "what good looks like" sentence. Not
  mass-backfilled (a uniform placeholder would be dishonest, unlike `owner: folpe` which is
  uniformly true); authored per skill over time.

Two shared frontmatter helpers back these fields so the scalar and list parsers cannot diverge:
`parseScalar(block, key)` (quote-stripping, YAML-nil-aware — used by `owner` and `success_signal`)
and `parseList(block, key)` (flow or block YAML list — used by `runtimes` and `eval_targets`).

### The certification manifest (`certification.json`)

The capability contract is frozen, per release, into `packages/core/data/certification.json` (A4).
It is the input `ProjectState` (Phase B) reads for the repo-authored half of the five-state model —
never recomputed on a consumer machine. `buildCertification(model, reports, harnessVersion)`
(`src/certification/build.ts`, pure) joins the graph model's capability fields with the eval-harness
JSON reports:

- `proof.verified` is **structural** — the capability declares an owner and at least one runtime.
- `proof.effective` obeys an **honesty invariant**: it exists only when a real eval report for the
  skill exists, its verdict is `skill-helps`, and the capability declares an eval target cell to place
  the delta on. Never inferred, never faked. Today there are no eval JSON reports, so the manifest
  ships **64 capabilities, 0 effective** — the honest current state; `effective` populates in Phase E
  when the paid evals run and emit `apps/eval-harness/reports/<skill>.json`.

`certification.json` is a committed artifact regenerated by `pnpm certification:build`; `pnpm
certification:check` gates drift in CI (mirrors `decisions:check` / `graph:check`). Two things are
**deliberately deferred** (YAGNI): baking the manifest into the consumer `void-graph` bundle (nothing
reads it until Phase B's ProjectState) and the eval-harness JSON emission that populates `effective`
(that is Phase E's paid-eval work). See DECISIONS.md (2026-07-21).

## ProjectState and `void status` (Phase B)

`ProjectState` is the project's legible state: a **deterministic, offline, LLM-free** join of the
frozen `certification.json` (repo-authored proof) with **local signals** (which capabilities are
materially installed, which passed executable runtime postconditions, which fired in canonical
mission events, and the tri-state runtime evidence). The pure core
lives in `packages/harness-graph/src/state/` — `computeProjectState` derives each capability's
five-state (`available → installed → verified → used → effective`). Local `verified` now requires a
compatible runtime with `installed=yes`, `wired=yes` and `fired=yes`; the frozen structural proof is
reported separately as `certified`. `effective` requires both that local chain and certified
behavioral proof plus real local use. Each runtime carries independent `installed`, `wired`,
`fired`, `observed` and `certified` fields; `null` means `unknown`, never success.
`scoreProjectState` scores the eight dimensions (blocker/gauge,
cap-69 on a red failure-predicate, pending dimensions excluded, confidence band, impact-ranked next
actions — see DECISIONS.md 2026-07-21). Both are pure: no I/O, no clock, no model call.

`void-harness status` (`packages/cli/src/commands/status.ts`) is the imperative shell: it reads the
certification + model + telemetry, executes each detected adapter's bounded local postconditions,
calls the pure core, renders the terminal surface, and persists
`.void/machine/status.json` plus a `.void/machine/history/<ts>.json` snapshot (both git-ignored, per-project runtime
state). `generatedAt` is stamped by the shell so the core stays deterministic. Missing runtime,
cost, smoke or observation data stays `unknown`/pending and is excluded from scores instead of being
invented. Consumer-side bundled-certificate resolution and pack-aware filtering remain local and
offline.

## `.void/` ownership: declared, derived, observed

The three levels above answer what deleting a path costs. Ownership answers the
adjacent question, who wrote it and therefore what git does with it, and it
covers all four materialized directories rather than `.void/` alone.
`VOID_OWNERSHIP` stays the single source, as above.

Three decisions built this, in order, and the log is append-only so each records
what was true when it was taken: `void-layout-ownership-split` (observed state
moves off the top of `.void/` into a subdirectory of its own; it classified
`derived` and deliberately left it tracked), `exact-rehydration-manifest` (the
manifest and `hydrate`, which supplied the guarantee the next one needed), then
`derived-content-is-not-committed` (which took the alternative the first had
deferred). That subdirectory was later renamed `machine/`, and the derived half
was given its own `installed/`, so each level is named for whose the content is
instead of for where it happens to sit. **This page carries the current state;
the records carry the reasoning at each step.**

| class | what it means | examples | git |
| --- | --- | --- | --- |
| `project` | the project authors it; the harness never overwrites it | `.void/config.json`, `.void/PROJECT-DOCTRINE.md`, `.void/program.md`, `.claude/settings.json` | tracked |
| `derived` | `void-harness init` re-materializes it from the harness assets | `.claude/skills/`, `.claude/agents/`, `.agents/skills/`, `.codex/agents/`, `.void/installed/PHILOSOPHY.md` | ignored, per receipt |
| `observed` | this machine's history; meaningless in another checkout | `machine/runs/`, `machine/cache/`, `machine/receipts/`, `machine/status.json`, `machine/retired/*.jsonl` | never |

The map covers all four materialized directories (`.void/`, `.claude/`,
`.agents/`, `.codex/`), not just `.void/`: left unclassified they were tracked by
default, which is 126 files and roughly 1.2 MB of vendored prose per consumer
repository, rewritten whole on every version bump and in every review diff.

**Observed state lives under `.void/machine/`**, so the ignore rule is a single
line with no `!` exception and stops needing maintenance: a new runtime artifact
is born inside `machine/` and no ignore file has to learn about it. `init` writes
the marked block; `update` migrates a project off the previous layout, renaming
`state.json` to `status.json` and filing the streams nothing reads any more under
`machine/retired/`, and never overwrites a destination that already holds data;
`doctor` proves the result with git (`check-ignore` + `ls-files`) rather than
trusting that the block is present — an ignore rule has no effect on a path that
was already tracked.

Proving the *declared* path is not enough, which the `void observed` check exists
to close. A project can ignore `.void/machine/` and still leak, because the hook
bundle it actually runs may be an older one: the published bundle writes to
`.void/outputs/` on every session, and that path was covered by no rule at all
until 2026-08-17, when an untracked session log came one `git add .` away from
being committed in this very repository. So the check walks every path observed
state can land in — the current directories plus each observed entry of the
ownership table at its pre-split location — and asks git about each one that
exists on disk. A path absent from the project is never reported, or the check
would fire everywhere at once and teach its reader to skip it; a path the project
is supposed to commit (`.void/` itself, `.void/hooks/`, `.codex/hooks.json`) can
never be reported, because ignoring those breaks every fresh clone. What git
could not be asked about reports `unknown`, never `fail`.

An entry at the top of `.void/` that the map does not know answers `project`.
`machine/` is a **closed set** — every observed writer in the harness writes
inside it — so a stranger at the top cannot be harness telemetry, and the failure
of guessing wrong would be `doctor` telling a project to untrack its own data.

**Two derived paths stay tracked**, and the line between them is *what happens
when the file is absent from a fresh clone*:

- `.void/hooks/` is named from `.claude/settings.json`, which is `project` and
  therefore committed. Ignoring the runner while keeping the reference gives a
  clone a settings file pointing at a missing file, and every tool call fails.
  That is also why it stays at the top of `.void/` rather than moving into
  `installed/` with the rest of the derived half.
- `.codex/hooks.json` **is** the Codex safety floor. Absent, the floor is simply
  not there — a silently weaker clone, the worst of the three states.

Everything else in the class degrades gracefully: fewer capabilities until the
next `hydrate`, nothing broken. So: **what breaks stays, what degrades goes**
(`DERIVED_LOAD_BEARING`). What makes this safe rather than merely tidy is that
`hydrate` restores the ignored content from the manifest and **proves** it —
see "Exact rehydration" below.

An ignore rule has no effect on a path already in the index, so an existing
project needs an explicit untrack. `void-harness update --untrack-derived` does
it in one command — files stay on disk, the index forgets them. It is opt-in and
never implied: rewriting a project's index is the project's call, not a side
effect of updating. `doctor` reports the count as **advisory** (nothing is
broken) with that command as its fix.

## Exact rehydration: the manifest and `hydrate`

`.void/config.json` cannot answer "which bytes". `core` is a caret RANGE, and
`init` materializes whatever assets the running CLI carries, so two checkouts of
one commit can legitimately hold different harness content with nothing reporting
it. `.void/install-manifest.json` closes that gap.

| artifact | class | says |
| --- | --- | --- |
| `.void/machine/receipts/install-v1.json` | `observed` | what THIS MACHINE installed |
| `.void/install-manifest.json` | `project` | what THIS PROJECT expects |

Same shape, opposite lifecycles — the ownership axis applied one level up. The
manifest carries an **exact** version plus a sha256 per file, is written by `init`
into the same transaction as everything else, and is committed.

`void-harness hydrate` restores from it under two rules:

1. **It refuses to run unless the CLI is the version the manifest names**, and
   prints `npx voidharness@<version> hydrate`. It does not fetch that version:
   `npx` already selects versions, and doing it inside the CLI would buy a network
   surface and a class of partial failures for nothing. Silently hydrating with
   whatever is installed is the exact drift the command exists to prevent.
2. **It verifies every restored file against the manifest and exits non-zero on
   drift.** "Hydrated" is a proof, not a claim.

Materialization stays `init`'s job — `hydrate` calls it — so the restore can never
diverge from what an install produces. A harness asset edited by hand stops the
proof: the install transaction refuses to overwrite a file it no longer owns,
which is the right default, and `hydrate --force` is the deliberate override.

`doctor` reports the same fact without repairing: assets matching the manifest,
drift (a failure, with the pinned hydrate command), an unreadable manifest (a
failure), or no manifest at all (advisory — a project runs fine without one, it
just cannot prove another checkout got the same bytes).

## .void/config.json (consumer-side)

Generated by `void-harness init`. Lives at `.void/config.json` in the consumer project.

The `packs` field pins the **marketplace plugins** that were enabled, keyed
`@voidcorp/<plugin-name>` (the plugin name, e.g. `harness-nextjs`, scoped under
`@voidcorp/`), each mapped to the version it was pinned at. These are plugin
references, not npm package names: the npm packages are `@voidcorp/pack-<stack>`,
the plugins they pair with are `harness-<stack>`. `doctor` reads this field to
detect version drift against the marketplace HEAD.

```json
{
  "core": "^0.5.4",
  "packs": {
    "@voidcorp/harness-nextjs": "^0.5.4",
    "@voidcorp/harness-monorepo": "^0.5.4"
  },
  "stack": {
    "packageManager": "bun",
    "testRunner": "vitest",
    "e2eRunner": "playwright"
  },
  "paths": {
    "src": "apps/*/src/**",
    "tests": "apps/*/src/**/*.test.{ts,tsx}",
    "spikes": "apps/*/scripts/spike-*"
  },
  "modes": {
    "tdd": "auto"
  }
}
```

Skills and hooks read this file to adapt to the consumer's conventions without hardcoding.

## Versioning

Lockstep: one number governs the CLI, the runtime npm packages, and the
marketplace plugins. Bumped with `scripts/bump-version.mjs` (see RELEASING.md).
Changesets were removed in v0.5.4 because independent per-package versions
contradict the lockstep model.

- **patch**: bug fix in a skill / hook, documentation, attribution updates
- **minor**: new skill, new hook, new pack
- **major** (or any pre-1.0 minor): breaking change in a skill's contract (renamed front-matter, removed flag), CLI interface change, restructured `.void/config.json`

Every package shares the same number. The CLI displays the active version on `doctor`.

## CI gates

Implemented today in `.github/workflows/ci.yml` (all block the PR on failure):

| Gate | What it runs |
|---|---|
| Anti-bloat: SKILL.md size | fails if any `SKILL.md` exceeds 400 LOC |
| Anti-bloat: hook size | fails if any `hooks/*.sh` (excluding `_`-prefixed libs) exceeds 100 LOC |
| Shell syntax | `bash -n` on every hook |
| Manifest ↔ disk | fails if `plugin.json` wires a `hooks/<name>.sh` that does not exist on disk |
| core-assets sync | regenerates `core-assets` and fails if it drifted from `packages/core` |
| Publish safety | packs each npm package with pnpm and fails if a `workspace:` specifier survives into the tarball |
| Lint | `pnpm lint` (Biome) over first-party TypeScript |
| Build | `pnpm build` (packs must build before typecheck resolves their exports) |
| Self-host release gate | compiles current sources in isolation; rejects source/receipt/hook/replay drift |
| Graph integrity | `pnpm graph:check` — CatalogGraph v3 + model.json projection drift, broken routes, capability governance |
| Certification freshness | `pnpm certification:check` — committed `certification.json` matches the model + eval reports |
| Consumer bundle freshness | `pnpm graph:check-bundle` — the shipped `void-graph.mjs` embeds the current `model.json` |
| Skill tests | `pnpm vitest run` |
| Typecheck | `pnpm -r typecheck` |

Roadmap (documented intent, not yet wired): skill front-matter schema check,
per-hook smoke tests on a sample repo, CLI integration tests on a fresh fixture.
Releases are cut with `scripts/bump-version.mjs` (lockstep), not changesets; the
`.changeset/` directory is unused.

## Server-side floor (the void-enforce Action)

Local PreToolUse hooks only enforce the floor on the machine running them — a
cloud agent, a `--dangerously-skip-permissions` run, or any non-Claude author
never sees them. The **void-enforce Action** replays the same floor on every PR,
server-side, so the floor is incontournable regardless of author. It complements
(does not replace) the server-side branch protection `void-autopilot` already
requires.

- `core/enforce/ci-enforce.sh` — the diff driver. Given `--base <ref>`, it walks
  the PR diff (`git diff base...HEAD`), runs the ADDED lines / changed paths
  through the shared Node rules (protected path, secret content, TDD) plus the
  transitional `_checks.sh` boundary predicate, and emits GitHub
  `::error file=,line=::` annotations. It lives under `enforce/` (not `hooks/`)
  because it is a CI tool, not a Claude-runtime hook: that keeps the `hooks/ =
  runtime` boundary honest and keeps the driver out of the 100-LOC hook cap.
- `.github/actions/void-enforce/action.yml` — composite action wrapping the
  driver; resolves the base from the PR context and runs the bundled script.
- `.github/workflows/enforce.yml` — reusable workflow (`workflow_call`) a
  consumer adopts in ≤5 lines (`uses:
  voidcorp-core/void-harness/.github/workflows/enforce.yml@main`).
- `.github/workflows/void-enforce.yml` — void-harness's own dogfood, using the
  *local* composite so a check change is validated by the same PR that makes it.

**Fail-closed** is the invariant (the #62-64 class): a missing prerequisite, an
unresolvable base ref, a missing merge-base, or any git error is an explicit red
check, never a silent green. Escape hatch: `.github/void-enforce-allow` lists
path globs the driver skips (each skip logged) — the committed, reviewable
equivalent of the local `VOID_HARNESS_ALLOW_SECRET_EDIT` override, for files
legitimately named like a secret store.
An exact generated artifact may also be exempt only when its authored sources
remain scanned and a deterministic freshness gate verifies the artifact in the
same CI. This repository applies that rule to the single-file consumer graph
bundle, whose size exceeds the bounded hook protocol; `graph:check-bundle`
proves its source/model correspondence. Broad generated-directory globs remain
forbidden.
`void-harness doctor` reports (advisory, never blocking) whether a project has
adopted the workflow. v1 replays three checks: sensitive-path, secret-content,
boundary-direction. `boundary-direction` reads each package's own
`package.json`: an import of a workspace package the importer declares is
legitimate, an undeclared one is a phantom dependency and is refused. It does
not impose a topology of its own, and it allows whenever no manifest is
readable — a rule that blocks on what it could not determine turns every
unusual layout into a wall. Destructive-shell stays a local runtime guard only — a
committed pattern self-matches the detector/docs/fixtures, a net-negative false
positive for a floor check (see DECISIONS). The project test gate stays the
consumer's own CI (this Action enforces the doctrine floor, not general quality —
it must not double the existing CI).
