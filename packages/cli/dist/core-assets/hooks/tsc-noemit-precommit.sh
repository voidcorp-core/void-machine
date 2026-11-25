#!/usr/bin/env bash
# tsc-noemit-precommit — pre-commit hook
#
# Runs `tsc --noEmit` (or pack-configured equivalent) and blocks the commit on
# any type error. Composed with the `typescript-strict` skill.
#
# Reads command from .void/config.json -> commands.typecheck, defaults to
# the local tsconfig via npx tsc --noEmit.
#
# Exit codes: 0 allow, 1 block (type errors printed).

set -euo pipefail

CONFIG="${VOIDCORP_CONFIG:-.void/config.json}"
CMD=$(jq -r '.commands.typecheck // empty' "$CONFIG" 2>/dev/null || true)
[[ -z "$CMD" ]] && CMD="npx tsc --noEmit"

if ! eval "$CMD" 2>&1; then
  printf "\ntsc-noemit-precommit: type errors detected. Commit blocked.\n" >&2
  printf "Fix the type errors above, or run '%s' manually to iterate.\n" "$CMD" >&2
  exit 1
fi
