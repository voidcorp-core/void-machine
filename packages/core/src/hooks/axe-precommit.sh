#!/usr/bin/env bash
# axe-precommit — pre-commit hook
#
# Runs axe-core static analysis on staged UI changes. Blocks on WCAG AA
# violations. Composed with the `accessibility` skill.
#
# Requires axe-core CLI installed via pack-nextjs devDependencies.
# Reads the command from .void/config.json .commands.axeStatic
# (defaults to `npx axe-static --staged --rules wcag2a,wcag2aa`).
#
# If axe-core CLI is not available, the hook warns once and continues
# (does not block) so the harness install is not gated by axe.
#
# Exit codes: 0 allow, 1 block (axe-core reported violations).

set -euo pipefail

CONFIG="${VOIDCORP_CONFIG:-.void/config.json}"
CMD=$(jq -r '.commands.axeStatic // empty' "$CONFIG" 2>/dev/null || true)
[[ -z "$CMD" ]] && CMD="npx --yes axe-static --staged --rules wcag2a,wcag2aa"

# Bail-out if axe-static is not installed
if ! command -v npx >/dev/null 2>&1; then
  printf "axe-precommit (skipped): npx not found.\n" >&2
  exit 0
fi

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(tsx|jsx)$' | grep -vE '\.(test|spec)\.' || true)
[[ -z "$STAGED" ]] && exit 0

if ! eval "$CMD" 2>&1; then
  printf "\naxe-precommit: WCAG AA violations detected. Commit blocked.\n" >&2
  printf "Fix the accessibility issues above. See accessibility skill.\n" >&2
  exit 1
fi
