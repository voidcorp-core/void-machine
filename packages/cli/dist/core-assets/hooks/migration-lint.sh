#!/usr/bin/env bash
# migration-lint — pre-commit hook
#
# Greps staged migration SQL files for banned patterns and warns the
# author. Composed with the `migrations` skill.
#
# Banned patterns:
#   - NOT NULL direct add: ALTER TABLE ... ADD COLUMN ... NOT NULL
#   - RENAME COLUMN direct
#   - Column type change direct: ALTER COLUMN ... TYPE
#   - DROP COLUMN
#   - CREATE INDEX without CONCURRENTLY (warned, not blocked — small tables OK)
#
# Allowlist:
#   - Lines tagged `-- migration-allow: <reason>`
#
# Path: read from .void/config.json .paths.migrations, defaults to
# **/{migrations,drizzle/migrations}/**
#
# Exit codes: 0 allow, 2 warn.

set -euo pipefail

CONFIG="${VOIDCORP_CONFIG:-.void/config.json}"
MIG_GLOB=$(jq -r '.paths.migrations // "**/{migrations,drizzle/migrations}/**"' "$CONFIG" 2>/dev/null)

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(sql|ts)$' || true)
[[ -z "$STAGED" ]] && exit 0

WARNINGS=""
for FILE in $STAGED; do
  case "$FILE" in $MIG_GLOB) ;; *) continue ;; esac
  ADDED=$(git diff --cached -- "$FILE" | grep -E '^\+' | grep -v '^+++' | grep -vE '-- *migration-allow:' || true)

  HIT_NN=$(printf "%s" "$ADDED" | grep -niE 'ADD COLUMN[^;]*NOT NULL' || true)
  HIT_RN=$(printf "%s" "$ADDED" | grep -niE 'RENAME COLUMN' || true)
  HIT_TY=$(printf "%s" "$ADDED" | grep -niE 'ALTER COLUMN[^;]*TYPE' || true)
  HIT_DR=$(printf "%s" "$ADDED" | grep -niE 'DROP COLUMN' || true)
  HIT_CI=$(printf "%s" "$ADDED" | grep -niE 'CREATE INDEX' | grep -v 'CONCURRENTLY' || true)

  for KIND_HIT in "ADD NOT NULL direct" "$HIT_NN" "RENAME COLUMN direct" "$HIT_RN" "ALTER COLUMN TYPE direct" "$HIT_TY" "DROP COLUMN" "$HIT_DR" "CREATE INDEX without CONCURRENTLY" "$HIT_CI"; do
    :
  done

  if [[ -n "$HIT_NN" ]]; then WARNINGS="${WARNINGS}\n  $FILE [ADD NOT NULL direct]:\n$HIT_NN"; fi
  if [[ -n "$HIT_RN" ]]; then WARNINGS="${WARNINGS}\n  $FILE [RENAME COLUMN direct]:\n$HIT_RN"; fi
  if [[ -n "$HIT_TY" ]]; then WARNINGS="${WARNINGS}\n  $FILE [ALTER COLUMN TYPE direct]:\n$HIT_TY"; fi
  if [[ -n "$HIT_DR" ]]; then WARNINGS="${WARNINGS}\n  $FILE [DROP COLUMN]:\n$HIT_DR"; fi
  if [[ -n "$HIT_CI" ]]; then WARNINGS="${WARNINGS}\n  $FILE [CREATE INDEX without CONCURRENTLY]:\n$HIT_CI"; fi
done

if [[ -n "$WARNINGS" ]]; then
  printf "migration-lint (warn): risky DDL patterns detected:" >&2
  printf "%b\n" "$WARNINGS" >&2
  printf "\nApply two-phase change pattern. See migrations skill.\n" >&2
  printf "Tag '-- migration-allow: <reason>' for surgical exceptions (small tables, etc.).\n" >&2
  exit 2
fi
