#!/usr/bin/env bash
# PostToolUse outcomes and repeated-read advice share this non-blocking process.
# PostToolUseFailure resets advice only; Stop retains its canonical event.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUNNER="${BASH_SOURCE[0]%/*}/_void-hook.mjs"

if command -v node >/dev/null 2>&1 && [[ -f "$RUNNER" ]]; then
  VOID_PROJECT_ROOT="$ROOT" \
    node "$RUNNER" outcome "${VOID_AGENT_RUNTIME:-unknown}" 2>/dev/null || true
fi

exit 0
