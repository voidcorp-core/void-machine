#!/usr/bin/env bash
# Non-blocking adapter to the generated, runtime-agnostic Node event writer.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
RUNNER="${BASH_SOURCE[0]%/*}/_void-hook.mjs"

if command -v node >/dev/null 2>&1 && [[ -f "$RUNNER" ]]; then
  VOID_PROJECT_ROOT="$ROOT" \
    node "$RUNNER" activation "${VOID_AGENT_RUNTIME:-unknown}" 2>/dev/null || true
fi

exit 0
