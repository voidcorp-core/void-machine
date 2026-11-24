#!/usr/bin/env bash
# no-process-env-in-app — PreToolUse hook. Reads Claude Code JSON from stdin.
# Blocks `process.env.X` in apps/*/src/** files, forcing imports from
# @repo/core/env. Composes with env-validation.
# Exit codes: 0 allow, 2 block.

set -euo pipefail

INPUT=$(cat)
TOOL=$(printf "%s" "$INPUT" | jq -r '.tool_name // empty')
FILE=$(printf "%s" "$INPUT" | jq -r '.tool_input.file_path // empty')
NEW=$(printf "%s" "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

case "$TOOL" in Edit|Write) ;; *) exit 0 ;; esac
[[ -z "$FILE" || -z "$NEW" ]] && exit 0

# Only apps/<app>/src/
[[ "$FILE" =~ apps/[^/]+/src/ ]] || exit 0
[[ "$FILE" =~ \.(ts|tsx)$ ]] || exit 0
# Skip env modules, tests, scripts, generated, .d.ts
[[ "$FILE" =~ /env(-(client|server))?\.ts$|\.(test|spec)\.(ts|tsx)$|/__generated__/|\.d\.ts$|/scripts/ ]] && exit 0

re_proc='\bprocess\.env\.[A-Z_]'

HITS=$(printf "%s" "$NEW" | grep -nE "$re_proc" | grep -vE '// *allow-process-env:' || true)

if [[ -n "$HITS" ]]; then
  printf "no-process-env-in-app: process.env.X in %s\n%s\n\n" "$FILE" "$HITS" >&2
  printf "Import from @repo/core/env (validated, typed) instead.\n" >&2
  printf "See env-validation for the pattern.\n" >&2
  printf "Override (rare, justified): tag the line '// allow-process-env: <reason>'.\n" >&2
  exit 2
fi

exit 0
