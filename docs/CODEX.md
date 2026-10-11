# Codex parity

void-machine targets two runtimes from one doctrine. This page states honestly
what is parity-real today and what is opt-in or pending.

## One doctrine, per-runtime docs

`CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex) carry identical doctrine,
terminology adapted (Skill tool ↔ tools, Claude ↔ Codex): `CLAUDE.md` uses
`@imports`, `AGENTS.md` uses explicit "read at session start" pointers (Codex has
no `@import`). In the **harness repo itself** the `scripts/sync-agent-docs.sh`
gate keeps both in lockstep (section-heading parity in CI + a both-or-neither
pre-commit check).

The shared agent-doc generator gives both runtimes the same bounded merge-consent
rule: an authorized merge includes the coordinator's routine local synchronization
without another confirmation. Verify the branch, remote and merged commit; fetch
and advance the clean local target branch with `git merge --ff-only` to that
verified commit. Local changes, divergence or an unexpected remote tip stop this
follow-through. This grants no additional remote merge, deployment, history rewrite
or shared Git mutations by commit-only workers. Runtime sandbox and approval
controls still apply. Installed documents receive the rule through the normal
harness installation/update path, not direct edits to protected installed assets.

In a **consumer project** the doc is **per-runtime**: each runtime adapter writes
only its own doc. `void-machine init --runtime claude` emits just `CLAUDE.md`,
`--runtime codex` just `AGENTS.md`, `--runtime both` (the default when neither is
detected) emits both. A runtime added later with `void-machine runtime add
<runtime>` brings its doc with it. `doctor` only checks the doc of a *detected*
runtime, so a Codex-only project is never flagged for a missing `CLAUDE.md`.

## The skills

Skill content is runtime-agnostic prose and applies to both. The default local
install materializes Claude skills under `.claude/skills` and Codex skills under
`.agents/skills`; both are native project-local discovery surfaces. Codex discovers
skills two ways: by **directory convention** — scanning `.agents/skills` from the
cwd up to the repo root — and, more recently, through a **native plugin channel**
(`.codex-plugin/plugin.json` + `codex plugin marketplace add owner/repo`, bundling
skills and hooks). See the official docs: [build-skills] and [build-plugins].

We use the **directory-convention** path: `init` **materializes** the skills
into `.agents/skills`. Every skill that declares `codex` in its `runtimes`
frontmatter is staged as `.agents/skills/<name>/` — the whole skill folder
(SKILL.md + scripts/references), core **and** the skills of every activated pack
(the pack skills ship bundled in the CLI tarball). A Codex user thus gets both the
doctrine (via `AGENTS.md` + `.void/`) **and** the invocable skills. `doctor`
reports how many are discoverable; `update` re-stages them to the running CLI's
version. This is chosen because it is universal, reproducible, and account-free
(no marketplace fetch). The native Codex plugin channel was evaluated as a
**complementary** path and **declined** on 2026-08-04 (decision log,
`codex-plugin-channel-declined`): it would invert, for one runtime, the call
already made for the other — npx primary, marketplace optional, precisely to drop
the account and marketplace dependency — and would add a second manifest to keep
in lockstep with artifacts that are identical by construction, unlocking no
capability. Reopen if directory-convention discovery is degraded, or if something
becomes reachable only through a plugin. Claude's own project configuration
supports `.claude/skills`, `.claude/agents` and `.claude/settings.json`; its
plugin marketplace remains available only through explicit opt-in.

[build-skills]: https://learn.chatgpt.com/docs/build-skills
[build-plugins]: https://learn.chatgpt.com/docs/build-plugins

### Usage measurement (a Codex platform limit)

`status`/`void-graph` count skill **usage** from observable invocations — on
Claude, a skill runs through the `Skill` tool, which the activation-meter hook
records. Codex loads skills as context and fires **no hook event** for them (its
hooks cover `Bash`, `apply_patch`, MCP and other function tools, not skill use).
So on a Codex-only project the usage counts reflect Claude usage only — a low
count means "not observed", not "not useful". This is a Codex limitation, not a
gap in the harness; nothing to instrument until Codex surfaces skill use.

The invocation-health check preserves the event's runtime source. Only
`runtime:claude` tool calls enter its three-working-mission silence window.
Codex and missing/unknown sources remain explicitly **not observable**, with
collected tool-call counts and an unknown activation count. `doctor` reports
`unknown`, never a passing zero; the session banner states the same limitation.
The banner and doctor inspect the same bounded journal corpus (64 MiB, at most
10,000 mission directories per location); runtime filtering precedes the
three-mission window, so newer Codex missions cannot evict Claude evidence. Recorded retired
skill names still fail independently of runtime. Reading `SKILL.md` or declaring
that a skill was applied never synthesizes a skill activation.

The verdict cache is versioned so an unchanged journal cannot preserve a verdict
computed under the old, runtime-blind rule. Collection and enforcement hooks are
unchanged. This follows the [Codex skill-loading contract][build-skills] and
[documented hook coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage).


## The hooks (a full mirror, not a floor)

The safety *floor* for an unattended run is the deny-by-default permission scope
(`.codex/hooks.json` allow/deny + a sandbox), not the blocklist hooks. The hooks
are enforcement on top. Codex and Claude share the lifecycle events used here:
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `PreCompact`, `SessionStart`,
`SessionEnd`, and `Stop`. Both manifests route them to the same portable Node
runner. The continuity path depends only on observing `PreCompact`; it never
depends on Codex's ability to block that event.

Codex used to receive only two guardrails where Claude received eighteen. It now
receives the **same enforcement surface**: the blocking greps (`no-any`,
`no-console-log`, `secret-in-content`, `boundary-direction-check`, `tdd-guard`,
…), plus `auto-format` on `PostToolUse`, `sessionstart-context`, and the
`stop-typecheck` gate on `Stop`.

### The one real difference: `apply_patch`

Claude edits **one file** per call (`Edit`/`Write`, carrying `file_path` +
`new_string`). Codex edits through **`apply_patch`, a multi-file diff**. Wiring
the content-scanning hooks without accounting for that would have fired them
against an empty payload — they would have passed everything while reading green.
A wired-but-dead hook is worse than an honest absence.

The generated `_void-hook.mjs` runner normalizes both forms before applying
every active content rule. Two
properties matter:

- only **added (`+`) lines** are collected, so removing or merely surrounding an
  offending line never trips a scan;
- **every file in the patch is scanned**, not just the first — a secret added in
  the second file of a multi-file patch is blocked and names the right file.

Enforcement, formatting, session context, context continuity, advisory typecheck and telemetry are
dependency-free beyond the Node runtime required by the CLI. No native Codex
hook requires `jq`, Bash or an executable file bit.

Context continuity has no Codex degradation for the events and direct tool payloads both runtimes
report. The runner records the latest complete usage counters and a bounded working set, seals
their delimited checkpoint block at `PreCompact`, and composes the same complete/degraded
`ResumeBundle` at `SessionStart`. Shell-mediated reads are not inferred, and Codex transcript
measurement is limited to project-local paths because its external session directory has no
trusted project binding. Because neither runtime documents a reliable window size, a threshold
nudge requires explicit `context.windowTokens` configuration; model names are never mapped to
guessed windows. The handler does not invoke `/clear`, `/compact`, or a semantic checkpoint.

### Wiring the Codex hooks (auto-wired by `init`)

`void-machine init` wires the hooks automatically whenever Codex is a selected
runtime (auto-detected from a `.codex/` dir or `AGENTS.md`, or forced with
`--runtime codex` / `--runtime both`). It:

1. Stages one asset into `<project>/.void/hooks/`: `_void-hook.mjs`.
   `CODEX_FLOOR_SCRIPTS` is explicit and a drift guard proves every manifest
   command resolves to that asset.
2. Compiles `<project>/.codex/hooks.json` from `packages/core/codex/hooks.json`,
   turning each `node "${VOID_HOOKS_DIR}/<asset>"` into `node -e "<bootstrap>"`.
   The file is versioned, so it holds no machine path: the bootstrap walks up
   from the session directory to the nearest `.void/hooks/<asset>` and runs it.
   Codex launches a hook through the session shell (`sh`, `bash`, `zsh`,
   PowerShell, `cmd.exe`); the bootstrap uses none of their expansion
   characters, so one form holds on every OS and from any subdirectory.
   A Codex refusal is exit 0 with the documented PreToolUse denial on stdout
   (`hookSpecificOutput.permissionDecision: "deny"`), never exit 2:
   PowerShell, Codex's default shell on Windows, turns any non-zero native exit
   into 1, which Codex reads as a failed hook and lets the call through. The
   runner refuses that way for `enforce ... codex`, and so does the bootstrap
   when no runner is found (fail closed); elsewhere a missing runner exits 0.
   Claude Code keeps exit 2. The hook conformance runs the installed commands
   through each of these launchers, from the root and a subdirectory, on Linux,
   macOS and Windows, and reads the refusal the way Codex parses it. See the
   decision `codex-hooks-shell-neutral-bootstrap`.

The one remaining human step is to **trust the project-local `.codex/` layer**
per Codex's config. `void-machine doctor` verifies the floor by executing the
staged runner and requiring its canonical event. After
a CLI upgrade, `void-machine update` re-stages the floor to the running CLI's
version (only on real drift), so a Codex project catches floor-script updates the
same way the Claude side catches marketplace bumps.

The former manual copy is no longer needed. `packages/core/codex/hooks.json`
remains the single source `init` compiles from. Its top level uses only the
Codex-supported `description` and `hooks` fields; a live `--strict-config` smoke
guards that boundary in addition to the compiler regression test.

## Native agents and specialists

Codex now discovers project-scoped custom agents from `.codex/agents/*.toml`.
`init` compiles the five authored Markdown critics to that native format, so the
former `.agents/skills/<critic>/SKILL.md` fallback is gone. Skills remain inline
teaching contracts; agents provide fresh context.

The v3 specialists, `solution-architect`, `security-engineer`, `test-qa-engineer`,
`experience-designer`, and `visual-craft-director`, are authored once under
`packages/core/specialists/*.yaml`.
The Claude and Codex compilers embed the exact same scope, applicability, budget,
failure policy, and JSON result contract in their native files. Manual and
orchestrated invocation therefore parse through one identity/version-aware output
boundary.

Codex agents declare `sandbox_mode = "read-only"`, disable web search, and clear
inherited MCP servers. This is not called enforced isolation: Codex reapplies the
parent turn's live sandbox overrides, including `--yolo`, and exposes no per-agent
process allowlist. `doctor` reports native discovery but keeps team mode degraded
until an equivalent runtime isolation proof exists. See the official [Codex
subagent configuration].

[Codex subagent configuration]: https://learn.chatgpt.com/docs/agent-configuration/subagents

## The commands

Claude gets `/void-graph`, `/void-doctor`, `/void-audit`, `/void-feedback` and
`/void-autopilot` as plugin commands. Nothing is missing on Codex:

- `void-autopilot` **is already a skill**, so it is staged like any other.
- The `void-*` commands are thin wrappers around the CLI, which is
  runtime-agnostic. Under Codex, invoke it directly: `void-machine doctor`,
  `void-machine audit`, `void-graph`. Codex custom prompts are not an option
  regardless — they are deprecated and live only in `~/.codex`, never in a repo.

## Parallel fan-out

Codex has no `Workflow` tool, and the autopilot loop does not need one. Its
kernel, `void-machine autopilot next`, decides every slot from the tracker,
GitHub and git, and the skill acts on those actions with whatever the runtime
offers: Codex spawns a worker per `assign` through its **native subagents**,
Claude through its own delegation. Neither runtime decides anything the kernel
did not, so the two cannot drift into deciding different things.

A coordinator on either runtime can also delegate one agent to Codex with
`void-machine agents dispatch --runtime codex`: the run is a thread of Codex's
own app-server daemon (`codex app-server daemon`), with an optional
`--output-schema` its final answer is held to, shown live in a pane by
`codex resume <thread> --remote unix://<socket>` (see `ARCHITECTURE.md`,
"Delegated agent runs"). Codex's own `spawn_agent` is not captured into the
kernel: a refusal on it holds, but the hook receives the sub-agent's brief
encrypted, so a Codex coordinator dispatches through the CLI itself.

What is still open is BEHAVIOURAL parity of a real Codex run, which needs an
execution conformance gate and belongs to the certification range. The loop was
proved on Claude; runtime equivalence on Codex is asserted, not measured.

## Global Herdr session ownership guard

The distributed hook bundle exposes `lifecycle herdr-session codex` for an explicitly
configured global SessionStart route. It validates the event and Herdr context,
then proves that the hook process descends from a foreground PID of the claimed
pane before invoking the unchanged `herdr-agent-state.sh session`. The native
script resolves under `CODEX_HOME`, otherwise `HOME/.codex`, and retains its own
thread/transcript checks and ownership of session publication.

The relay preserves the original stdin bytes (up to 1 MiB). Discovery accepts at
most 256 numeric safe-integer PIDs and verifies the returned pane identity. A
64-hop parent walk shares a two-second deadline with discovery; native execution
has a separate one-second limit. Subprocess output is bounded to 256 KiB, argv is
literal, and no retries run. Missing or invalid evidence prevents relay. Fixed
`herdr-session:` stderr codes distinguish invalid discovery, unproven ownership,
parent lookup failure and native relay failure without exposing payloads or raw
child diagnostics. Successful native stdout passes through unchanged. A failed
native invocation may already have published; no rollback is claimed.

This global route does not discover a project or record project telemetry. Other
lifecycle handlers keep their existing journals. No project manifest adds the
route by default: a project hook cannot suppress an unguarded personal hook.
Personal migration must replace the existing guard with one absolute accepted
bundle command, remove any parallel direct native SessionStart route, and verify
all effective global/project entries. An integration reinstall can reintroduce
an unguarded entry, so recheck drift before activation.

The temporary guard addresses stale inherited pane context, not malicious control
of same-user executables or atomic process identity. Tests use controlled processes
and fixture scripts; they do not prove live personal activation or server restart.
See the [cutover specification](specs/2026-10-09-native-herdr-cutover.md) and
[entrypoint decision](decisions-log/2026-10-09-global-herdr-session-guard-without-project-telemetry--914e4727-b71c-41c2-9272-d038b0a73bd8.md).

## The irreducible residual

Everything above was closed by filling the gap. These cannot be, and saying so
plainly is the point — this is the only place where "prerequisite" keeps meaning:

| Not available on Codex | Why | Affects |
| --- | --- | --- |
| claude-in-chrome MCP | a Claude-bound browser extension | `void-qa`, `void-ui-review` live browser passes |
| `@voidcorp/make-pdf` | package not published | the `void-make-pdf` skill |
| `trim-large-output` hook | its `PostToolUse` output rewriting (`updatedToolOutput`) is unconfirmed on Codex, and a sibling field is documented as failing there | token-frugality trimming only; deliberately not wired rather than shipped dead |
| enforced specialist read-only isolation | parent sandbox overrides and no per-agent process allowlist | native agents work, but team mode stays degraded |

## Status (verified vs pending)

- **Verified**: sister-doc gate; `init` emits `AGENTS.md` and auto-wires
  `.codex/hooks.json` (one staged runner + compiled manifest, unit-tested); `doctor`
  checks the wiring; the hooks parse both runtimes' payload shapes, including
  multi-file `apply_patch` (unit-tested); all ten agents compile from the real
  `packages/core` tree to native TOML (integration-tested); a real `init --runtime codex` stages
  one runner plus the discoverable skills and agents; live trusted-project Codex sessions discover
  and launch the architecture/security/QA specialists, accept the hooks manifest under
  `--strict-config`, and return
  outputs accepted by the shared parser. The staged hooks also block a violation added in the
  second file of a multi-file patch when invoked directly.
- **Pending a real-Codex run**: live invocation of the two UI specialists; end-to-end firing of `.codex/hooks.json` by Codex
  itself (the hooks are verified by direct invocation, not yet by a live Codex
  session), and a `RUNTIME=codex` backend for the backlog orchestrator (it
  currently invokes `claude -p`; `codex exec` is the intended swap). Tracked in
  `docs/DECISIONS.md` (2026-06-04, 2026-07-22) and the skill audit.
