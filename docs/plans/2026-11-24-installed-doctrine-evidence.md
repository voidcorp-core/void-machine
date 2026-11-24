# DEV-1404 installed doctrine and shared native instructions

Implements the approved L7 ownership migration and common-document decision.
The active root installation remains on its published floor; candidate self-host stays isolated.
Authored repository AGENTS directs an explicit read of exactly one published philosophy:
new path when present, otherwise the legacy path. It never imports both and never reads
working source as a fallback. This keeps preserved source documents usable before and
after a separately authorized root migration. Generated consumer AGENTS directly imports
the new destination for Claude; this source-only fallback is not a new runtime loader.

## Ownership and migration

`.void/PHILOSOPHY.md` is delivered and manifest-owned. The adjacent project doctrine
keeps its existing project ownership and untouched-template refresh policy. The legacy
layout pass no longer removes philosophy before the installation transaction. Existing
receipts authorize removing an unchanged old copy; modified, unknown and symbolic-link
copies survive. Unclaimed differing destinations and symlinks refuse publication.
The existing transaction restores bytes and modes on failure. Empty legacy directories
are retired only after successful publication; nonempty directories survive.

Actual candidate CLI updates and second updates succeeded for intact, modified, unknown,
cloned-manifest-without-receipt, cloned-modified and nonempty cases. Occupied new-path
and symbolic-link cases refused without overwriting user data. Focused behavioral tests
cover preparation failure, rollback, mode changes, repeat updates and native document
symlinks. The symlink check lives in the existing document writer, before any write.

## Native observations, 2026-11-24

Claude Code 2.1.331 and already-installed Codex 0.172.0 were invoked in fresh task-owned
consumer contexts. No runtime upgrade, global trust change, context-cap increase or
permission bypass was used. Initial sandbox-limited authentication/EPERM results were
kept separately from the subsequently approved successful invocations.

Claude's actual `InstructionsLoaded` events show one load per session for CLAUDE,
AGENTS, philosophy and project doctrine, with native include-parent relationships.
Observed scenarios: Claude-only, both runtimes, marketplace, and Claude after adding
Codex. The corrected project-template reference was subsequently observed too.

Codex native rollout instruction items contain the exact AGENTS content once, and
zero copies of CLAUDE or either doctrine, for both and later-added Codex. No tool calls
occurred in these initial-loading probes. A separate invocation then read the two
doctrines under AGENTS' startup instruction; those are file reads, not native imports.
Automatic Codex SessionStart delivery is not claimed by these observations.

Official contracts consulted: [Claude memory](https://code.claude.com/docs/en/memory),
[InstructionsLoaded](https://code.claude.com/docs/en/hooks#instructionsloaded), and
[Codex AGENTS discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Native invocations, sanitized task-file counts, event observations and artifact snapshots
are retained under `.void/machine/dev-1404-evidence/native/` in the author worktree.

## Gains and retained costs

| Change | Directly counted result | Retained protection or cost |
| --- | --- | --- |
| Common authored instructions | Repository CLAUDE shrinks from 21,136 bytes / 165 lines to an 11-byte import | AGENTS remains authored; native import/discovery and user-block tests remain |
| Exclusive parity controls | 96-line script and 115-line exclusive test removed; one CI catalogue entry and staging call removed | Existing build, ownership, runtime and independent review gates remain |
| Installed directory writer | Dedicated installed-directory helpers/exports and blanket ignore retired | Legacy path classification and active-floor fallback remain readable |
| Migration | Existing transaction and receipt owners reused | Compatibility code and conservative preservation remain necessary |
| Delivery copies | No claim of deleting necessary npm/marketplace copies | Existing builders assemble tracked distributions from src |
| Initial native artifacts | Local Claude: 25,234 bytes across four files; Codex: 3,669-byte AGENTS initially | Full runtime context and token usage differ; no token-saving claim |

The byte counts describe the actual fixture artifacts, not the entire provider context.
The earlier 759-byte template became 749 bytes after correcting its legacy path;
the final Claude observation includes that correction. Native behavior was observed
before retiring the exclusive parity controls. Versioned tests remain the repeatable
behavioral checks; the native observations are evidence, not a new CI job or framework.

## Local verification

The complete candidate collection passed: 5,202 tests and one pre-existing Semgrep
skip across 345 files (CPU 1,905; filesystem 1,692; subprocess 1,519 plus the skip;
network 86). DEV-1403's baseline was 5,204 passing plus the same skip. The exclusive
parity file was removed, common-owner assertions replaced duplicated document assertions,
and ownership/migration/loading cases were added. No suite disappeared through path filtering.
Types, lint, anti-bloat, version lockstep, skill references and delivery freshness passed.
Lint retains the existing 68 warnings and 1,012 informational diagnostics. Package size
remains within the unchanged ceilings; no version or dependency change was made.

## Independent-review correction: partial legacy commands

Runtime additions and marketplace pack changes refresh instructions without publishing
philosophy. They now retain the existing managed reference to either known published
path; only init/update switches that reference with the doctrine transaction. Modified
legacy doctrine and an unclaimed new destination remain untouched. Adding Codex also
refreshes an existing legacy CLAUDE document to import the common owner, preserving
project text outside its managed block.

The reported four command paths failed before the correction. Focused command tests
cover both runtime directions, marketplace add/remove, absent and conflicting new
locations, edited legacy doctrine, and a refused runtime preparation that leaves the
previous instructions intact. The common fresh-install output is unchanged, so the
native-loading observations above remain applicable; no new native-loading claim is made.
