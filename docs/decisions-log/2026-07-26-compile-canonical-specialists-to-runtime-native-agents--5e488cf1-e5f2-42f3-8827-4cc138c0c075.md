---
schemaVersion: 1
id: "adr:5e488cf1-e5f2-42f3-8827-4cc138c0c075"
createdAt: "2026-07-26T14:59:08.444Z"
title: "Compile canonical specialists to runtime-native agents"
status: superseded
deciders: ["folpe"]
supersedes: []
---

# Compile canonical specialists to runtime-native agents

## Context

Team mode needs architecture, security, and QA judgments in fresh contexts on both supported
runtimes. Authoring Claude Markdown, Codex TOML, and orchestration prompts independently would
create three doctrine sources. The runtime permission models also differ: Claude agent frontmatter
cannot deny unknown inherited MCP tools, while Codex reapplies live parent sandbox overrides.

## Decision

Author each specialist once as strict, bounded YAML and compile that contract to native Claude
Markdown and Codex TOML, with one shared output parser and an explicit degraded safety state until
the active runtime proves complete read-only isolation.

## Consequences

Positive:

- Manual and orchestrated invocation use one identity, scope, budget, and JSON result contract.
- Claude and Codex discover real fresh-context agents; no skill pretends to be a subagent.
- Marketplace Claude files are committed generated artifacts and byte-checked against YAML.
- The existing Markdown critics compile to Codex TOML, preserving capability while deleting the
  former Codex-as-skill fallback.

Negative:

- Generated Claude marketplace files add repository bytes and require a drift test.
- Both runtimes report team mode as degraded until inherited tools and parent overrides are proven
  incapable of weakening isolation.
- Runtime-native wrappers may differ, but their embedded doctrinal instructions may not.

## Alternatives considered

- **Author per-runtime agents independently**: rejected because scopes and output schemas would
  drift silently.
- **Keep Codex agents as skills**: rejected because inline skills do not provide fresh context and
  would falsely claim team independence.
- **Call frontmatter read-only without qualification**: rejected because current vendor docs state
  that inherited MCP tools or parent runtime overrides can bypass that declaration.

References: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents),
[Claude Code plugin agents](https://code.claude.com/docs/en/plugins-reference), and
[Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Reversal cost

Medium. Reversal requires a migration of canonical contracts, both compilers, installed receipts,
and marketplace-derived files, but does not require changing specialist doctrine itself.
