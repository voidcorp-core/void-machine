# Essential workflows

Start with the outcome you want in plain language. The agent uses the applicable
skills; invoke one explicitly when you want a particular workflow. Codex uses
`$void-implement`; Claude Code uses `/void-implement`.

| Need | Start here |
| --- | --- |
| Clarify an idea or consequential choice | `void-brainstorm` |
| Turn an approved design into steps | `void-plan` |
| Deliver one scoped change | `void-implement` |
| Investigate a bug | `void-debug` |
| Review a change or verify its acceptance | `void-code-review` or `void-verify` |
| Leave a resumable handoff | `void-checkpoint` |

Use the runtime's native skill discovery for available skills and their triggers.
Run `void-machine --help` for the current CLI, `void-machine list` for packs,
and `void-machine doctor --no-remote` to diagnose the local installation.
For a new project, follow the [installation guide](../README.md).

The generated catalogue and `void-machine cheatsheet` command have been retired,
including HTML, Markdown and JSON export. The former command now reports an
unknown command (exit 2). Existing user exports are preserved; this guide is
maintained by hand and does not reproduce the full catalogue.
