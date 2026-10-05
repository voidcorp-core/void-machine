# Architecture

## Topology

```
void-machine/
├── packages/
│   ├── cli/                       # voidmachine
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
| `installed/` | `void-machine install` restores it byte for byte | no |
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

### Naming what the harness owns in a shared directory

`.claude/`, `.agents/` and `.codex/` are shared: the runtime reads the project's
own skills, agents and commands from the same directories the harness writes
into. Deciding which side a file belongs to is the ignore block's whole job, and
it uses whichever of two regimes is cheaper for that root.

- **By prefix**, for `.claude/skills` and `.agents/skills`. Every shipped skill is
  `void-`prefixed (rule 8), so two pattern lines cover 82 owned directories. A
  pattern also has no stale window: it stays right about a skill the project adds
  long after the last install, which no list can do. This is only sound because
  the prefix is checked — `scripts/anti-bloat-check.sh` fails the build on a
  shipped skill without it, and `test/skills/shipped-skill-carries-the-prefix.test.ts`
  holds the gate itself to that. A convention no build enforces would make the
  manifest the better discriminator, which is what the superseded 2026-08-20
  decision said.
- **By list**, for `.claude/agents`, `.codex/agents` and `.claude/commands`. An
  agent is named for a person you could hire, so no pattern separates ours from
  the project's; they are named individually from the install receipt.

`UNIT_ROOTS` must stay exactly the union of `PREFIXED_UNIT_ROOTS` and
`LISTED_UNIT_ROOTS`, asserted in `void-layout.test.ts`: a root in neither is
covered by nothing and listed by nothing, so its content is committed on the next
`git add .` without anyone deciding that.

Both regimes fail the same way round on purpose. Absent a readable receipt, or on
a project still holding pre-prefix skill directories, harness content becomes
*visible* rather than the project's content becoming *hidden* — derived content
committed is a diff in a review, reversible with `update --untrack-derived`;
a project's own skill hidden is work that leaves at the next clone with nothing
to see. See the decision on naming owned content by prefix then by list.

The migration merges rather than refuses: on a per-file collision the destination
wins and the legacy copy is parked beside it as `*.legacy`. Choosing a winner by
size or date was rejected on evidence — measured across the park, the legacy copy
held more data in one journal and far less in another, so no rule picks
correctly. It runs only inside `update`: writing to a project nobody asked to
have written to is the line this repo does not cross.

The managed ignore block retains both historical journal locations, `.void/runs/`
and `.void/local/`, alongside `.void/machine/`. Refreshing an installation keeps
old observed data out of future staging without hiding declared project files.
Ignore rules do not remove already-tracked journals; history and tracked-file
cleanup remain explicit project decisions.

### Two roots: the work tree and the installation

A command reads and writes code in the **work tree**, the directory it ran in. It also reads what
`init` installed: `.claude/agents`, `.claude/skills`, `.void/installed`, the hook bundle, the
manifest. That install is a property of the **repository**, exactly like the `.git/info/exclude`
file that hides it from git, and it lives in the main checkout. In the main checkout the two roots
are one directory. In a linked worktree they are not, because `git worktree add` restores tracked
files only. The CLI used to have one root and look for both there, which is how an autopilot
worker was told no specialist was installed while twenty-one were (DEV-732).

`resolveProjectRoots` (`packages/cli/src/lib/project-roots.ts`) is computed once per command and
gives `workRoot` and `installRoot`. It asks git for the trees: `rev-parse --show-toplevel` for
the tree at hand, `worktree list --porcelain` for the main working tree, listed first by
contract. That first path is built by git from the common directory, so under a submodule or
`--separate-git-dir` it is the git directory itself; it is resolved back to a tree by asking
`rev-parse --show-toplevel` in it, which names a submodule's checkout and refuses where no tree
exists. One filesystem question then decides between two trees: the install receipt under
`.void/machine/`, which `init` writes and git never carries, marks the tree that was installed
into; without it the main working tree is the installation. Outside git, in the main checkout,
in a submodule or `--separate-git-dir` checkout, in a bare repository or with a git older than
the listing, `installRoot` is `workRoot`, so nothing changes there. Paths are canonical, so
macOS's `/var` and `/private/var` never read as two roots. A worktree's `.git` is a file; nothing
here tests it as a directory.

What follows from it, per the decision on runtime state from a worktree: the installed panel,
agents and manifest are read from `installRoot`, as are `status`, `check` and `mission`; `doctor`
judges that root and names both when they differ. Every reader of `installRoot` names that root
in what it prints about it when the two roots differ, and nothing otherwise: a remedy runs where
it is typed, so `doctor`, `check` and `status` (its freshness notice) put `remedyPrefix` in front
of each command; a printed path is read where it is typed, so `status` names its snapshot through
`installedPath`. Both helpers live in `project-roots.ts`; a new reader uses them rather than
restating the rule. `.void/machine/` is per-repository state, so the mission journal, controller
plan, evidence and the status snapshot are written there, while the ticket, the diff and the
verified command stay in `workRoot`. The session checkpoint stays with its tree.

### Working checkout ownership

Working Git checkouts live outside the repository at the durable location in
[WORKTREES.md](WORKTREES.md). The autopilot orchestrator creates or reuses the
worktree of each ticket it assigns before its worker starts, and the worker's
commits are the record. Checkout lifetime follows the ticket and observed merge,
independently of run/session/presentation lifetime. Useful ignored evidence must be preserved
before removal even when Git reports clean. This does not change repository-owned
runtime state or installation-root resolution above.

## Decision records

ADRs are an append-only data model, not a generated document:

- `void-machine decisions new` creates one exclusively-owned file with a UUID
  identity; concurrent workers never allocate a shared counter or index.
- `void-machine decisions check` validates the schema, unique identities,
  supersession links and cycles. In CI, `DECISIONS_BASE` also rejects edits,
  renames or deletions of accepted records. Its only edit exception is a
  repository-local path substitution with unchanged frontmatter, headings,
  structure and surrounding prose, and an existing root-confined target.
- Decision loading is root-confined, rejects symlinks and bounds each record to
  256 KiB before parsing.
- `void-machine decisions render --format markdown|json` produces a read-only
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

The Void Machine has no native track. Its Rust workspace was removed without a port, for lack of
a caller ([decision](decisions-log/2026-09-21-void-machine-rust-removal-without-port--ec77d2de-4719-4fe6-8d21-c0dbe403d6ac.md)).
The private TypeScript package `packages/void-machine/` is the Machine foundation. Only its
delegation capability reaches users, embedded in the published CLI as `void-machine agents`
([decision](decisions-log/2026-09-28-kernel-delegation-ships-in-published-cli--0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7.md));
the package itself is never published. The autopilot loop's kernel (state rebuilt from the tracker, GitHub and git, the slot
and collision rules, the shared-state fingerprint and the merge refusals) lives in
`packages/cli/src/lib/autopilot/`. A future independent Rust/Go/Python product could still live in
a sibling repo, reusing mechanics not skills.

## Delegated agent runs

`void-machine agents` (`packages/cli/src/commands/agents.ts`) is the one path by which a
coordinator launches, follows and closes a delegated agent. The CLI only parses and prints; the
kernel owns the rest, in its layers: `core/delegation.ts` (run states, admission, transitions,
pure), `runtime/delegation.ts` (ports and the observation loop, pure), `adapters/runtime/claude-session.ts`
(Claude Code background sessions), `adapters/store/run-registry.ts` (files) and
`application/agents.ts` (composition). A run is a `claude --bg` session named `vm-<runId>`; its
live state is read from `claude agents --json --all` every five seconds, one observation at a
time per mission. The brief travels in a file the session is pointed at, never on argv, and the
role fixes the permissions (`work`: `auto`; `review`: the native `--agent` type with `dontAsk`).

Runs are recorded under `<main checkout>/.void/machine/runs/<mission-id>/agents/<runId>/`,
resolved from the common Git directory so a run dispatched from a worktree lands where the
coordinator reads it. Each transition is linked under its sequence number, so it is recorded
once even when two processes observe. The final message comes from the `lifecycle
delegation-result` Stop hook, which follows a claim keyed by the native session id
([decision](decisions-log/2026-09-28-delegated-result-correlated-by-session-id--af7d9cc5-2dab-4908-a908-44e4121510e9.md)).
`dispatch` refuses, with the repairing command, when Claude Code is missing or older than
2.1.257, the workspace is not trusted, or that hook is not installed. Under a multiplexer, the
`lifecycle delegation-capture` PreToolUse hook on `Agent` turns the coordinator's native delegation
into a `dispatch` and refuses the native call with the runId and the `wait` command; it passes
without a surface, for a `fork`, for a session the kernel launched (same session-id rule), and on
any failure, which it reports instead of blocking. How a run is shown in a multiplexer is described
in `NATIVE-SUPERVISION.md`.

Three callers launch agents, and all three go through `agents dispatch`: the coordinator (that
capture hook, or the CLI directly), `void-autopilot` (one `work` run per ticket in its worktree;
its reviewers through `autopilot review`) and `void-implement` (one `review` run per
`invoke-specialists` envelope, with the envelope's `agentName`, `runtime` and `missionId`). No
skill chooses a launch path from what the terminal can display. The specialist lifecycle events
of the [dispatch closure](specs/2026-08-21-agent-dispatch-closure.md) keep their shape; their
`contextId` is the run's id. A specialist launched this way is a CLI call, not a native `Agent`
or `spawn_agent` tool call, so the `runtime.tool.*` agent signal no longer sees it: the run
record under `agents/<runId>/` is the proof that it ran.

Each run keeps the runtime it was dispatched to (`--runtime claude|codex`), and every command
reaches it through that runtime's port; one runtime that cannot be read never holds another's
runs. A Codex run (`adapters/runtime/codex-daemon.ts`, `adapters/runtime/codex-thread.ts`) is a
thread of Codex's own app-server daemon, named after the run and reached on the daemon's control
socket for one bounded exchange per command
([proposed decision](decisions-log/2026-09-28-codex-runs-are-threads-of-native-daemon--5dd5306b-721f-4e9b-b592-c765c8eb823e.md)): the
daemon supervises the thread, and the kernel owns no Codex process. The role fixes the thread's
sandbox (`work`: `workspace-write`; `review`: `read-only`) with `approvalPolicy: never`; an
approval asked anyway is surfaced as `waiting-human`, never answered. The runtime reports the
final message itself: the kernel records it once per turn and checks it against the output schema
the run was dispatched with (`--output-schema`), keeping an answer that does not conform, marked
so. A launch acknowledgement may carry the whole native session id, so the run's view exists from
the dispatch on. Each adapter declares its view, capture and structured-output capabilities with
their provenance, and `status` says why a run has no view.

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
- **Layout repair survives install failure.** `update` migrates legacy layout before invoking
  `init`. That idempotent repair is outside the install transaction and remains applied if
  installation fails. The failure message preserves the underlying error and names this boundary;
  it does not claim that every failure rolled back or that publication never happened.
- **Failed installs clean before exiting.** The owned compilation stage is removed before the
  failure exit, as well as after success. A test observes staging paths at the exit boundary:
  throwing from a mocked `process.exit` would otherwise run `finally` and hide a real-process leak.
- **Consumer conformance has one artifact identity.** A clean exact-SHA checkout packs the npm CLI
  once and records package identity, source SHA and tarball SHA-256 in a canonical manifest. One
  orchestrator makes install, hook and Autopilot suites consume that same verified tarball through
  a minimal environment and fixture-local state. CI fans the immutable pair out to Linux, macOS and
  Windows; elapsed time is an observation, never a correctness threshold. ProjectGraph stays in a
  separate path-filtered matrix because it is a distinct published package and portability
  boundary. Repeated seeded stress runs in the scheduled test-certification workflow on an
  ephemeral Linux runner and emits exact-SHA reports; it is deliberately outside the laptop edit
  loop and ordinary pull-request critical path.
- **Runtimes are added a posteriori without friction**: `void-machine runtime add <runtime>` wires exactly that runtime's layer on an already-`init`-ed project, touching nothing the other runtime owns (verified byte-for-byte in tests). `runtime list` shows which are wired. This is the `void runtime add` command from the multi-runtime spec.
- **Pack and update lifecycle uses the same transaction.** Local `add`/`remove` compile the exact
  config pack set and prune only unchanged receipt-owned stale assets. Local `update` recompiles
  from the running CLI without a remote fetch. Legacy/explicit marketplace receipts retain their
  cache and remote-pin adapter.
- **The harness owns exactly the skills it ships; the project owns every other one.**
  `.claude/skills/` and its siblings are shared directories, and the manifest — not the path —
  answers which side a file is on. A skill the harness does not ship is never ignored and never
  written to; a skill it does ship is its alone to modify, so a locally altered copy is restored
  rather than defended. See the harness-owns-its-skills-project-keeps-its-own decision.
  Install preparation restores changed regular managed files when the previous receipt or
  committed manifest claims their path, renews their receipt ownership, and names each locally
  altered file after the transaction succeeds. Unclaimed collisions stay with the project and
  are reported; symlinks and non-files refuse publication. `--force` remains for explicit recovery
  of ambiguous legacy ownership/configuration, but is unnecessary for these restorations and
  does not override collision withholding, non-regular targets, or grant stale-file deletion.
- **Ownership is the union of the two proofs, never a choice between them.** The receipt is
  machine-local and records what *this machine* wrote; the committed `.void/install-manifest.json`
  names the paths *this version* owns and travels with the repository. `update` completes the
  receipt with every manifest path it does not cover — the receipt staying authoritative on any
  path both name, since only its hashes tell a hand-edited file from an untouched one. An absent
  receipt (every fresh clone) is the degenerate case of the same mechanism, not a separate route.
  See the ownership-is-union-of-receipt-and-manifest decision.
- `doctor` iterates the *detected* adapters for each runtime's wiring + doc health; Claude marketplace checks (`gh`, plugin cache, remote versions) apply only to an explicit marketplace install. Adapter inspection distinguishes `installed`, `wired`, `fired`, and `observed`. The `fired` postcondition executes the installed Node runner against an isolated fixture and reads back its canonical event; a zero exit without that event stays red. In the source repository, `doctor` delegates to the self-host receipt and current-source checks instead of applying consumer assumptions. See `docs/CODEX.md`.

### Capability, not lowest common denominator

Parity settles *what* is installed. It does not settle *how* a pass runs when the
runtimes differ in what they can do, and they do. Measured against the official
documentation of each:

| | Claude Code | Codex |
|---|---|---|
| parallel subagents | 20 concurrent | 6 (`agents.max_concurrent_threads_per_session`) |
| agent to agent | `SendMessage` + sibling roster; agent teams add a shared task list | none — "subagents don't directly communicate with each other" |
| availability | teams are experimental, off unless `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | native |

**A pass declares the capability it wants; each adapter takes the maximum its
runtime offers; a runtime that lacks it degrades rather than blocks.** A review
wanting N independent adversarial lenses becomes a debate between teammates on
Claude, successive arbitrated fan-out rounds on Codex, and one lens at a time on
a runtime nobody has written an adapter for yet — slower, still correct.

Levelling every pass to the intersection would be the tempting mistake: it caps
quality at the weakest supported runtime forever, and each new runtime can only
lower the ceiling. Designing to the strongest makes the harness single-runtime in
practice while claiming otherwise. Both are rejected in the
adapters-take-each-runtime-maximum decision.

Three rules keep the degradation honest:

- **The output contract does not vary with the runtime.** Only the execution
  does. Without that, certification could no longer tell a degraded run from a
  failed one, and two projects on two runtimes could not be compared.
- **The result names the execution that actually ran.** A fan-out reported as a
  debate is a claim about evidence that does not exist. Same rule as everywhere
  here: the proof, not the memory.
- **Capability is detected, never inferred from the runtime name.** Agent teams
  are off by default, so a Claude session may legitimately have to fall back, and
  branching on the name would report a capability the session does not have.

The declaration lives in the mission plan, so no core command learns a runtime
name — the same seam that already holds for `init`, `doctor` and `status`.

### Consumer programme and session handoff

Every generated `CLAUDE.md` or `AGENTS.md` carries the same conditional bootstrap: if
`.void/program.md` exists with `status: executing`, the runtime reads its plan and spec before
choosing implementation work. `ResumeBundle` composes that versioned global context with the local
checkpoint and Git. A plain continue/start/resume request uses the declared progress adapter to
recover exactly one started scoped unit, or selects the first ready unit from the stable order and
native blocker relations. More than one started unit is a competing-claim error.

`.void/program.md` is the only location, and `LEGACY_PROGRAM_PATHS` is the only place the names it
carried before (`.void/active.md`, `plans/ACTIVE.md`) still appear — read on the way in, never
written, so a project that has not run `update` is not reported as having no programme at all.
Two things hold that to one path. A test greps the living surface, everything the harness ships or
tells an agent to read, for a legacy name; `docs/` is out of scope, since the specs that decided
this are the record of why. And `doctor` **names the paths it looked at** when it finds nothing,
because the same programme at one name printed eight autopilot lines and at another printed none,
and a silent report is indistinguishable from not having looked.

The programme is opt-in and project-owned. `init`, `update`, and runtime adapters never create or
mutate it. A declaration never migrates into a directory the harness ignores: one project's
programme was moved from `plans/ACTIVE.md` to `.void/machine/ACTIVE.md` by an `update`, taking its
running order, its human gates and the `autopilot` block that IS the consent to autonomous
execution out of the repository with it, where nobody could audit or revise them in a PR. `void-ticket` creates it only after a human-approved multi-unit plan has been fully
materialized in a capable progress provider. It stores durable context and routing only: programme,
plan/spec links, provider scope, ordered unit identifiers, lifecycle-state roles, human gates, and
the required `autopilot` consent block. Mutable status, assignee, blockers, comments, and review
evidence live only in the provider.

`packages/cli/src/lib/autopilot/program.ts` is the only parser of that contract. It
validates every field on read and refuses a file that is present but wrong, rather than falling
back to a default: a typo in `base` or `deployBranch` must never be what puts a merge in the wrong
place, and a 4.0 programme still declaring `mergeGate` (autopilot schema 1) is read but refused by
the loop with its migration, so a former human gate never becomes consent to merge. Paths
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

### Session update proposal

For a local installation behind the cached published version, `freshnessRelay` supplies
SessionStart model context asking the agent to offer `void-machine update` once near its
first reply. The offer explains that update writes project files and links the public
[release notes](https://github.com/voidcorp-core/void-machine/releases) for possible breaking
changes. Execution requires explicit human permission, including during autonomous work.
Refusal or silence leaves the task proceeding without updating or repeating the offer in
that session. This is agent guidance, not a technical authorization barrier. Current,
ahead, unknown, marketplace and unknown-source cases remain silent; the terminal notice,
cached detection and background refresh keep their existing behavior and startup budget.

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
no-wait claim chain whose generations are created exclusively and never ranked by timestamps.
After acquiring the recovery claim, takeover checks the current lock's age again as well as its
identity: Linux can reuse an unlinked inode immediately for a fresh owner's lock, so matching
device and inode numbers alone do not authorize removal. Checkpoint mutation stays anchored to
an opened, verified machine directory while relative
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

The continuity benchmark executes the exact delivered hook bundle in 25 fresh processes and keeps
bare Node, same-bundle no-op, and representative-event measurements separate. DEV-651 gates only
the hot wall path and incremental feature-versus-no-op CPU cost. It still publishes raw wall
latencies, but external scheduler contention cannot make the causal feature gate flaky. The
existing global cold-start and no-op-versus-Node wall budgets remain owned by
[DEV-662](https://linear.app/voidcorp/issue/DEV-662/reduire-le-cold-start-du-hook-runner-livre).

### Installed capability discovery

`void-machine cheatsheet` owns the consumer discovery projection in the CLI's
`lib/cheatsheet/` boundary. The shipped graph and specialist contracts provide
canonical identities; `lib/command-catalog.ts` supplies the same metadata to
dispatch, help and discovery. The handler map is exhaustive over its keys.
The source-only Markdown generator and Linear index are not imported.

Pure catalogue/availability projection feeds JSON schema version 1, Markdown
and self-contained HTML. The I/O adapter resolves linked installation roots,
validates local receipts/configuration and performs bounded, contained reads.
It never calls status, runtime smoke probes, registries or journals. Local
assets are checked against receipt hashes; configuration is not execution proof.
Hook events/matchers come from shipped manifests, associated through their
owner wrapper's declared runner invocation. Unknown wrapper shapes remain
undeclared. No handwritten hook-name mapping is introduced.

Project Claude skill overrides can establish explicit disabled evidence.
Home settings and marketplace caches are outside this bounded read, so effective
runtime visibility stays unverified. The HTML embeds fixed enhancement code;
metadata is escaped as text and never interpolated into executable JavaScript.
See [the discovery projection decision](decisions-log/2026-09-13-installed-discovery-projection--00d39aef-2cb8-4809-9545-128295b1c012.md).

### Source self-host boundary

`void-machine self-host sync` is the only supported dogfood compiler for this
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

Context-sensitive focused-test checks reconstruct the complete proposed file
before inspecting syntax. They use the official harness-owned TypeScript 6 API in a
bounded child process. The hook invokes a companion `_syntax-worker.cjs` whose
size and SHA-256 identity it verifies before execution. Only the worker loads
TypeScript. No consumer compiler, configuration, plugin
or import is resolved or executed, and no compiler is downloaded. Ordinary tests
without suspicious tokens and an unambiguous prohibited call at the start of a
file retain their inexpensive paths. Missing context or parser failure is
`TEST_SYNTAX_UNVERIFIED`, a refusal rather than an assertion that code was
checked. See [hook test evidence](HOOK-TEST-EVIDENCE.md) for
limits, supported edits and the structural E2E declaration contract.

The boundary has five responsibilities: the rule reconstructs proposed source;
the process adapter enforces isolation and validates the versioned protocol;
the worker validates requests; the TypeScript adapter returns syntax facts;
the pure policy maps those facts to existing verdicts. Both runtime installers
and source self-host use the same paired-asset builder. Installation health
refuses missing or incompatible workers. No extraction cache, dynamic evaluation
or persistent compiler process is involved.

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

### Product identity: one source

Which repository hosts the product, which npm package ships it and which commands start it are
written once, in `packages/core/data/identity.json`, with the names it carried before (a former
repository slug, a former package and its last major). Nothing else spells them in code:

- TypeScript reads `PRODUCT_IDENTITY` from `@voidcorp/hook-runner` (`src/identity.ts`, which
  validates the document). The import is bundled, so the CLI and the hook runtime carry the
  identity of the release that built them and read no file at run time.
- Plain-ESM scripts read `scripts/product-identity.mjs`, which resolves the JSON relative to its
  own file: a guard running from a trusted checkout reads that checkout's identity, never one a
  pull request brought. A job that sparse-checks-out a script must list both files;
  `test/workflows/sparse-checkout-closure.test.ts` proves it does.
- Files that cannot import (package and plugin manifests, workflows) repeat the values, and
  `test/identity/product-identity.test.ts` fails when one disagrees, when code spells a slug or
  package name, or when a former name survives outside the historical record.

Workflow guards keep their literal (`EXPECTED_REPOSITORY`, `EXPECTED_PACKAGE`): the guard runs
before any checkout, from the workflow file of the protected branch, and a fork that copies the
file compares its own `github.repository` against a slug it does not have. Each installed command
is a bin file named after it; a deprecated one runs the same CLI with one line on stderr.

The same source names what the product writes into a consumer's files and reads from their
environment, because a release cannot rewrite what an older one left there. `markers` derives the
begin and end of each managed block (CLAUDE.md and AGENTS.md, `.gitignore` and
`.git/info/exclude`, the mechanical block of `.void/machine/checkpoint.md`) for the current
namespace and every former one; `environment` names the current settings prefix and the former
ones. Every write uses the current name, every read accepts any of them:

- `managed-block.ts` (hook-runner) is the only finder of a managed block. It puts the new block
  where the first recognized one stands and drops any other, so an update from a release that used
  a former name converges on one block, never two.
- The mission engine parses the checkpoint without owning a brand: `checkpointCodec(markers)` is
  bound once to the identity in `lifecycle/checkpoint-codec.ts`, and the CLI reads through it.
- `productSetting(env, name)` is the only reader of a product setting. `VOID_MACHINE_<NAME>` wins
  whenever it is set; `VOID_HARNESS_<NAME>` is read only when it is absent.

Mission event sources (`void-harness:mission.*`) are a wire format written into every run journal
and compared on read, not a name a person reads; they keep their value (see the brand dual-read
decision).

## Inter-plugin contracts (the core-hub model)

The core plugin is **always installed** and acts as the hub between plugins. A sibling plugin (today: `forge`, the ideation pipeline) routes into the core's execution capabilities (`void-brainstorm`, `void-plan`, `void-ticket`, `void-tdd`, ...) rather than reimplementing them or dangling a pointer at an external runtime skill. The nominal routing assumes the core is present; the coupling is nonetheless a **versioned artifact contract**, not a hard plugin dependency, so each plugin still makes sense alone — forge degrades to producing a standalone spec, core works with a hand-written spec.

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
Declared intent is compiled into the same ProjectGraph: direct ADR Markdown files under
`docs/decisions-log/` produce `decision` nodes, and direct YAML files under
`.void/knowledge/invariants/` produce `invariant` nodes. The scanner admits only that
specific hidden directory in addition to its existing public configuration paths. The
existing descriptor, root, file and aggregate bounds still apply. Modern ADRs declare
`id`, `title`, `status`, optional `supersedes` and `affects`; historical date/title ADRs
retain the existing `legacy:<basename>` identity and accepted status. An invariant
requires `id`, `scope`, `severity`, `statement`, `enforced_by`, `verified_by` and
`decided_by`; references are explicit file paths or decision IDs, never inferred.

Implementation files point to decisions through `decided_by` and to invariants through
`constrained_by`; invariants point to verification files through `verified_by` and to
decisions through `decided_by`. These three spellings extend only binary relation kind
validation. New intent nodes and relations carry `origin: declared`, confidence 1 and
the declaring source's exact SHA-256. Supersession is preserved as readable data, with no
arbitration of contradictory decisions. Duplicate identities, malformed declarations
and unresolved references produce source diagnostics without inventing entities.

The declarative YAML adapter uses the existing yaml dependency and explicit bounded
validators inside the graph package, never CLI parsing code. Declaration extraction is
stored in the existing cache and its new extraction version invalidates older entries.
`void-machine why <file>` always observes that incremental builder, preserving current
diagnostics even when `.void/knowledge.json` already exists; it never writes that artifact.
It renders decisions, invariants and declared verification evidence with provenance,
explicit absence and partial/degraded caveats. Traversal uses the existing 500-node,
12-level default; terminal output and diagnostics are bounded with announced truncation.

Seven read-only queries answer the impact and targeted-context questions over an extracted
snapshot: `explain`, `path`, `impact`, `subgraph`, `owners`, `testsFor`, and `staleness`. Each is
deterministic, takes a node/depth budget, and reports `truncated` rather than returning a silently
short answer. `ownersOf` and `testsFor` answer an explicit `unknown` with a reason where nothing was
extracted, never an empty list, because "the graph does not know" and "nothing owns/tests this" are
different claims and only one is safe to act on. `impact` walks dependents and counts
`dynamic-imports` exactly like `imports`, since a dropped dynamic edge under-reports impact. A
Git-proven rename is followed forward from the retired path, so a caller holding a pre-rename path is
told what the file became rather than that nothing depends on it. The CLI surface
(`void-machine graph <query> <file>`, backed by `packages/cli/src/lib/project-graph-store.ts`) takes
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
The project snapshot can also be materialized as the versioned `.void/knowledge.json` artifact
with `void-machine graph project-build` and checked against a fresh build with
`void-machine graph project-check`. The artifact is a validated projection carrying the snapshot
root hash and build state; project graph queries read it when valid, while missing, corrupt, or
unknown artifacts trigger a rebuild. It is distinct from `.void/machine/`, whose observation cache
is disposable and never becomes an authority. The freshness check measures the generated file so
CI can reject a hand-edited or stale projection.
Diagnostic counts remain in build reports and do not enter the graph identity:
an unavailable watcher must not change the hash of otherwise identical partial
content. Observation state remains part of the graph and artifact. A state
difference is explicitly refused before content comparison; this does not turn
degraded observation into a fresh proof or relax cache publication. Existing
artifacts containing the former root diagnostic count require one regeneration.
Native file identities use an additive `identity: { device, inode }` pair of
canonical uint64 decimal strings read through Node's BigInt stats API. Existing
optional numeric device/inode fields keep their types and are emitted only when
exact. Valid numeric v1 cache entries remain readable without rewriting their
checksum. Both representations must agree when present; malformed exact pairs
cannot fall back to legacy evidence. Snapshot identity includes the exact pair.
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
the `voidmachine` CLI shell.

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
remain read-only transition inputs; current hooks never append to them. Every
cross-project reader uses the same bounded scan of configured roots for the
versioned `.void/config.json` marker. Event capture writes only inside its project.

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

Preparation corrections travel in an existing plan/spec directly cited by a backticked
repository-relative path in the frozen ticket. Dispatch rereads that artifact for the next
preparatory round. The writer resolves findings there before recording completion; it neither
edits the frozen ticket nor starts implementation until `run-lead-writer`. A missing citation
requires an explicit interrupted mission and corrected start inputs, preserving the old evidence.
The context pack must contain the correction: a writer receipt alone proves no content change.

Controller records created with a ticket bind the initial Git commit into their version 2
integrity envelope. Post-implementation review compares that fixed baseline with the working
tree, so staging or committing unchanged content preserves review identity. A bounded raw patch
digest participates in review hashes independently of routing; editing an already changed path
invalidates its reviews. The same captured patch supplies the specialist context, after redaction.
Only controller-owned `.void/machine/**` evidence is excluded: tracked project rules and hooks
remain review inputs. New files must be staged before review, and encoded binary patches are
refused before dispatch because text redaction cannot protect their payloads. Missing or unrelated
baselines and unavailable bounded Git output refuse review explicitly. Legacy version 1 records
remain readable for history and preparation, but cannot pass post-implementation dispatch without
an anchored subject; preserve that history and start a new mission instead of rebinding old proofs.
This is a Git reference in the existing execution register, not a second session checkpoint.
Git semantics: [diff against a commit](https://git-scm.com/docs/git-diff/2.50.0),
[ancestry validation](https://git-scm.com/docs/git-merge-base/2.50.0).

Interactive runs prefer the runtime's native subagent primitive. Headless certification launches a
fresh native role session directly when parent-to-child delegation cannot prove an attributable
completion: Claude selects the installed project agent; Codex compiles the installed TOML role into
an ephemeral session. Both remain read-only. Codex specialists may use sandboxed commands only to
locate, search, and read repository text; project scripts, builds, tests, package managers,
interpreters, and VCS mutations remain prohibited.

The controller also requires the adapter's effective specialist-runtime capability, independently
of the declared runtime name. Each CLI `RuntimeInspection` produces that capability from native
asset health plus the runtime's enforceable isolation limits. `unavailable` blocks before dispatch.
`degraded` may still run the reviews so their evidence and limitations are observable, and can
finish a valid ticket after the bounded cycle with an explicit degraded controller verdict. It
does not claim the missing runtime guarantee, but it does not discard otherwise valid ticket,
review, and verification evidence. Only `unavailable` is a hard runtime gate; a release or a
high-risk route may still require an available capability explicitly.

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
`void-machine mission dispatch`; it never owns a local role list. The CLI compiles a fresh canonical
plan at controller-owned mission start, persists an integrity-bound minimal routing snapshot, and
materializes only the controller's next action. Pre-implementation hashes stay bound to that
snapshot; post-implementation hashes follow the current diff. Codex consumes each envelope with
native `spawn_agent`; Claude Code with native `Agent`.

`void-machine mission` exposes the operator lifecycle:

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
  unfinished work; controller `complete` and `stop` actions close automatically. A preparation
  `await-evidence` action remains blocked and open for its authorized author response; see
  [preparation recovery](BOUNDED-REVIEWS.md#preparation-waiting-for-evidence);
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

Autopilot progress and CI effects use the same boundary. The core classifies an effect as provider
deduplicated, machine-reconciled, or non-idempotent; adapters report observations without exposing
provider vocabulary to the core. An exact integration SHA is required for every required check,
while missing, stale, pending, or failed observations stop the proof rather than becoming green by
default.

Unanswered human waits use a persisted virtual-time policy. The recovery reducer fixes a 15- or
20-minute deadline before waiting, accepts at most three distinct reversible hypotheses, and makes
rollback evidence mandatory for completion. Clock rollback, unsafe permissions, repeated
hypotheses, and failed rollback are terminal blocked states.

Autopilot specialist panels belong to the orchestrator. The CLI plan marks
`panelProvider: "orchestrator"` and supplies the selected envelopes; the runtime fans them out in
fresh contexts before the ticket writer starts. Verdicts retain their `inputHash`, correction
rounds are bounded at three, and a worker must return the panel record without dispatching one from
its worktree. Claude's Workflow adapter and Codex's native-subagent adapter consume this same
contract.

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

`void-machine status` (`packages/cli/src/commands/status.ts`) is the imperative shell: it reads the
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
| `project` | the project authors it; the harness never overwrites what the project wrote | `.void/config.json`, `.void/PROJECT-DOCTRINE.md`, `.void/program.md`, `.claude/settings.json` | tracked |
| `derived` | `void-machine init` re-materializes it from the harness assets | `.claude/skills/`, `.claude/agents/`, `.agents/skills/`, `.codex/agents/`, `.void/installed/PHILOSOPHY.md` | ignored, per receipt |
| `observed` | this machine's history; meaningless in another checkout | `machine/runs/`, `machine/cache/`, `machine/receipts/`, `machine/status.json`, `machine/retired/*.jsonl` | never |

`.void/PROJECT-DOCTRINE.md` is the one `project` file `init` may rewrite, and only
in the single state where rewriting takes nothing from anybody: its bytes still
match the install manifest's record of what a previous install wrote, which
proves the project has never written in it. Every other state preserves the file,
including a missing or unparseable manifest — silence is not proof that nobody
edited it. The installed file is a stub on purpose, because `CLAUDE.md` imports
it with `@` into every session; the long form it points at lives in
[`docs/PROJECT-DOCTRINE-FORMAT.md`](PROJECT-DOCTRINE-FORMAT.md), which nothing
loads. See the update-refreshes-an-untouched-project-doctrine decision.

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

Staying tracked is a declaration, and a declaration is not a proof either. The
`void kept` check is the mirror of `void ignore`: it asks git about each path the
harness declares a clone cannot start without — the project-owned half of
`.void/`, the install manifest, `.claude/settings.json`, and
`DERIVED_LOAD_BEARING` — and names the rule that wins when one is hidden. A
project carried, years older than the harness and higher in its `.gitignore`,

```
.void/*
!.void/PROJECT-DOCTRINE.md
```

and git does not descend into an excluded directory, so that rule beat everything
the managed block declared below it. That clone had no `config.json`, no
`install-manifest.json` and no `.void/hooks/_void-hook.mjs`, while a committed
`.claude/settings.json` named seven hooks pointing at the last of them: the
enforcement floor had stopped applying, and the check that should have said so
was reading the lines of an ignore file rather than asking git whether they won.
`init` reports the same finding at install time, where the paths have just been
written; it reports rather than refuses, because `.gitignore` beating
`info/exclude` is the correct precedence and a project rule is not an error.

Two measured properties hold the check up. `check-ignore -q` answers *ignored*,
where `-v` answers *a pattern matched* and exits 0 on a **negation** — reading
`-v`'s exit code would report every rescued path as hidden, so `-v` is asked only
afterwards, to name the rule. And a **tracked** file is never reported as
ignored, so "ignored" here already means "ignored and not in the index", which is
the only harmful state.

An ignore rule has no effect on a path already in the index, so an existing
project needs an explicit untrack. `void-machine update --untrack-derived` does
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

`void-machine hydrate` restores from it under two rules:

1. **It refuses to run unless the CLI is the version the manifest names**, and
   prints `npx <package>@<version> hydrate`, where `<package>` is the name that version
   was published under (`packageFor` in `packages/core/data/identity.json`: a rename
   does not move old releases). It does not fetch that version:
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

Generated by `void-machine init`. Lives at `.void/config.json` in the consumer project.

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
| Live skill references | `pnpm skills:check-references`, including plugin descriptions |
| Typecheck | `pnpm -r typecheck` |

Maintainer reference checks also inspect descriptions in core, mirrored and pack
`plugin.json` manifests. Explicit `void-` skill names resolve against the live
catalogue; ordinary English prose, pack names and the exact product name
`void-machine` are not skill references. Historical decisions and plans remain
outside this live-description check.

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
  voidcorp-core/void-machine/.github/workflows/enforce.yml@main`). GitHub does not
  redirect `uses:` after a repository rename, so `doctor` reports a call to a
  former slug as broken rather than adopted.
- `.github/workflows/void-enforce.yml` — void-machine's own dogfood, using the
  *local* composite so a check change is validated by the same PR that makes it.

**Fail-closed** is the invariant (the #62-64 class): a missing prerequisite, an
unresolvable base ref, a missing merge-base, or any git error is an explicit red
check, never a silent green. Escape hatch: `.github/void-enforce-allow` lists
path globs the driver skips (each skip logged) — the committed, reviewable
equivalent of the local `VOID_MACHINE_ALLOW_SECRET_EDIT` override, for files
legitimately named like a secret store.
An exact generated artifact may also be exempt only when its authored sources
remain scanned and a deterministic freshness gate verifies the artifact in the
same CI. This repository applies that rule to the single-file consumer graph
bundle, whose size exceeds the bounded hook protocol; `graph:check-bundle`
proves its source/model correspondence. Broad generated-directory globs remain
forbidden.
`void-machine doctor` reports (advisory, never blocking) whether a project has
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

## Isolated consumer browser verification

The source-only `test/browser/` suite tests regenerated synthetic cheatsheets on
a GitHub-hosted runner. It consumes the same immutable archive as install
conformance, verified against the checkout SHA and tarball digest. Playwright
and axe are pinned QA tooling outside the shipped CLI and pnpm workspace; they
do not add a consumer runtime dependency. The runner installs the archive
offline, and browser contexts disable network access. No personal browser,
developer export or home directory is an input.

`browser conformance` retains SHA-bound reports, document digests, screenshots,
print output and failure traces for fourteen days. Zero retries and finite
execution limits keep a failure red. Visual review and real assistive testing
remain separate from automated assertions; see [the suite contract](../test/browser/README.md)
and [the decision](decisions-log/2026-09-13-isolated-consumer-browser-ci--392e4254-fb63-4743-af1f-4c99a035170d.md).

## Bounded independent review

The existing Mission Engine owns the review state and correction budget; the CLI owns
Git subject observation, receipt ingestion and append-only persistence. Skills describe
the same procedure rather than defining a separate review engine. See
[the bounded review decision](decisions-log/2026-09-19-bounded-independent-review--eb08fcc8-d50a-4574-89da-d5a174f4035d.md).

Risk-specific preparation advice precedes implementation. One read-only independent
review examines a commit, comparison base and acceptance criteria. Corrections receive
targeted verification, at most two batches, retaining unaffected conclusions and proofs.
Advisories, incomplete responses and transport retries never consume correction budget.
Native context identity is provenance metadata; absent identity alone is not a delivery
refusal when actual independent execution and the review subject remain evidenced.
Unresolved concrete blockers, invalid evidence and missing required isolation still refuse.
