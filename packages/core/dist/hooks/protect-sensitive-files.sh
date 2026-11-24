#!/usr/bin/env bash
# Compatibility adapter; native manifests invoke the same Node bundle directly.
set -uo pipefail
HOOK_DIR="${BASH_SOURCE[0]%/*}"
NODE_BIN=$(command -v node 2>/dev/null || true)
if [[ -z "$NODE_BIN" ]]; then
  printf 'HOOK_RUNNER_FAILED: Node.js is required for enforcement\n' >&2
  exit 2
fi
exec "$NODE_BIN" "$HOOK_DIR/_void-hook.mjs" enforce protected-file
