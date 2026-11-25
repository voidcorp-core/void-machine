#!/usr/bin/env bash
# migration-pr-template — pre-push hook
#
# Warns if a PR touching migrations lacks the required body sections.
# Composed with the `migrations` skill.
#
# Required sections (case-insensitive substring match):
#   - Table affected
#   - Approximate row count
#   - Locking impact
#   - Backfill strategy
#   - Rollback plan
#   - Tested on dev branch
#
# Exit codes: 0 allow, 2 warn.

set -euo pipefail

CONFIG="${VOIDCORP_CONFIG:-.void/config.json}"
MIG_GLOB=$(jq -r '.paths.migrations // "**/{migrations,drizzle/migrations}/**"' "$CONFIG" 2>/dev/null)

# Detect if migrations were touched in the branch
BASE=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || echo "")
[[ -z "$BASE" ]] && exit 0

BASE_SHA=$(git merge-base "HEAD" "origin/$BASE" 2>/dev/null || echo "")
[[ -z "$BASE_SHA" ]] && exit 0

TOUCHED_MIGRATIONS=""
for FILE in $(git diff --name-only "$BASE_SHA"..HEAD); do
  case "$FILE" in $MIG_GLOB) TOUCHED_MIGRATIONS="$FILE"; break ;; esac
done

[[ -z "$TOUCHED_MIGRATIONS" ]] && exit 0

# Inspect PR body
BODY=$(gh pr view --json body --jq .body 2>/dev/null || echo "")
if [[ -z "$BODY" ]]; then
  printf "migration-pr-template: no open PR found, skipping.\n" >&2
  exit 0
fi

MISSING=()
for SECTION in "Table affected" "row count" "Locking impact" "Backfill" "Rollback" "Tested on dev"; do
  if ! printf "%s" "$BODY" | grep -qi "$SECTION"; then
    MISSING+=("$SECTION")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  printf "migration-pr-template (warn): PR touches migrations but lacks required sections:\n" >&2
  for s in "${MISSING[@]}"; do printf "  - %s\n" "$s" >&2; done
  printf "\nSee void-migrations skill for the template.\n" >&2
  exit 2
fi
