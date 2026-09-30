---
schemaVersion: 1
id: "adr:ecc84977-68f4-4c97-9fa8-f6f9046329a7"
createdAt: "2026-09-25T16:13:14.467Z"
title: "Codex hook commands find the runner from the session directory with a shell-neutral Node bootstrap"
status: accepted
deciders: ["folpe"]
supersedes: ["adr:f8861a2b-b9d6-43d5-b6d1-ec02eb6856bb"]
---

# Codex hook commands find the runner from the session directory with a shell-neutral Node bootstrap

## Context

`.codex/hooks.json` is versioned. Since the portable Node floor
(`adr:f8861a2b-b9d6-43d5-b6d1-ec02eb6856bb`), `init` compiled each command with the absolute
path of the checkout that ran it. A clone, a worktree or a CI checkout then inherited a path
that was not its own, and every Codex hook failed with a non-blocking error: the whole Codex
floor went silent. It happened on `develop` with #428 (DEV-918). This decision supersedes that
one part of `adr:f8861a2b`; the portable Node floor itself stands.

Codex runs a hook command in the session cwd, through a shell. Its source (openai/codex
`55543d8`, `hooks/src/engine/command_runner.rs` and `core/src/shell.rs`) uses the session shell
(`sh`, `bash` or `zsh` with `-c`; PowerShell with `-NoProfile -Command`; `cmd /c`), and without
one `$SHELL -lc` on POSIX or `%COMSPEC% /C` on Windows. Codex exposes no project-root variable
to project hooks. The official hooks page recommends `"$(git rev-parse --show-toplevel)/..."`,
which `cmd.exe` does not expand, and a `command_windows` override that would still have to work
under both `cmd.exe` and PowerShell.

The Windows conformance then showed that the exit code is not portable either. PowerShell,
Codex's default session shell on Windows (`shell_detect.rs` `default_user_shell`), ends a
`-Command` run with 1 whenever its last native command exits non-zero, so the runner's exit 2
reached Codex as 1. Codex blocks a PreToolUse call on exit 2 or on a denial printed with exit 0,
and treats any other code as a failed hook that lets the call through
(`hooks/src/events/pre_tool_use.rs`). Under PowerShell the whole floor failed open.

## Decision

Each compiled command is `node -e "<bootstrap>" <args>`: a program that walks up from the cwd
to the nearest `.void/hooks/<asset>` and runs it.

A Codex refusal is exit 0 with the documented PreToolUse denial on stdout,
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
"permissionDecisionReason":"..."}}`, escaped to ASCII. The runner refuses that way on
`enforce <rule> codex`; the bootstrap does the same on `enforce` when no runner is found or it
cannot load, and exits 0 elsewhere. Claude Code keeps exit 2 with the reason on stderr.

## Consequences

Positive:

- The manifest depends on the template alone: byte-identical in every clone and worktree.
- One form for every launcher. The bootstrap uses no `$`, `%`, backtick, backslash, `!` or
  nested double quote, so no shell expands or splits it, and exit 0 is the one status no shell
  rewrites, so the refusal reaches Codex intact.
- No dependency on Git; a session started in a subdirectory finds the runner.
- A missing runner now blocks enforcement instead of letting every tool call through.
- The Codex floor refuses under PowerShell, which it never did before.

Negative:

- Each command is about 560 characters, repeated in the manifest; the source of truth is the
  one `codexHookBootstrap` function, not the generated file.
- Nested projects resolve to the nearest staged runner, not to the directory holding the
  `.codex/` layer that declared the hook.
- Two refusal channels, one per runtime. Any stray write on stdout during `enforce` would
  corrupt the Codex denial, and Codex fails open on invalid JSON; the conformance parses the
  denial exactly as Codex does to catch it.
- A runner older than this change still refuses with exit 2: correct on POSIX, open under
  PowerShell until the project runs `update`.

## Alternatives considered

- Git root substitution with a `command_windows` override: rejected, two forms to prove, a
  dependency on Git, and no single Windows form covers both `cmd.exe` and PowerShell.
- A `commandWindows` ending in `; exit $LASTEXITCODE`, which PowerShell documents to keep the
  native code: rejected, `cmd.exe` would pass those words to Node as arguments, a polyglot
  that holds by accident; and it leaves the decision on a channel shells are free to rewrite.
- A project-relative path: rejected, it breaks every session started in a subdirectory.
- The absolute path of the final project: rejected, it is the defect this decision removes.

## Reversal cost

Low. The template keeps `${VOID_HOOKS_DIR}`; only the compiler, the runner's Codex refusal and
their tests change.
