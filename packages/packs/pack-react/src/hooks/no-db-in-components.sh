#!/usr/bin/env bash
# no-db-in-components — PreToolUse hook. Reads Claude Code JSON from stdin.
# https://code.claude.com/docs/en/hooks
#
# Blocks DB imports inside apps/<app>/src/components/ — components must
# call services, not query the DB directly. Composes with the
# harness-react conventions (components are pure UI).
#
# Exit codes: 0 allow, 2 block.

set -euo pipefail

INPUT=$(cat)
TOOL=$(printf "%s" "$INPUT" | jq -r '.tool_name // empty')
FILE=$(printf "%s" "$INPUT" | jq -r '.tool_input.file_path // empty')
NEW=$(printf "%s" "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

case "$TOOL" in Edit|Write) ;; *) exit 0 ;; esac
[[ -z "$FILE" || -z "$NEW" ]] && exit 0

# Only files under apps/<app>/src/components/
re_components='apps/[^/]+/src/components/'
[[ "$FILE" =~ $re_components ]] || exit 0

# Skip tests / stories / mdx
[[ "$FILE" =~ \.(test|spec|stories)\.(ts|tsx|js|jsx)$|\.mdx$ ]] && exit 0
[[ "$FILE" =~ \.(ts|tsx)$ ]] || exit 0

# Forbidden imports
re_db_import="from[[:space:]]+['\"](@repo/db|@/db|@/lib/db|drizzle-orm)([/'\"]|$)"

HITS=$(printf "%s" "$NEW" | grep -nE "$re_db_import" | grep -vE '// *allow-db:' || true)

if [[ -n "$HITS" ]]; then
  printf "no-db-in-components: DB import in component file %s\n%s\n\n" "$FILE" "$HITS" >&2
  printf "Components must call a service. Move the query into services/, then have\n" >&2
  printf "the component receive data via props or call a Server Action.\n" >&2
  printf "Override (rare, justified): tag the import line '// allow-db: <reason>'.\n" >&2
  exit 2
fi

exit 0
