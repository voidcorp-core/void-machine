#!/usr/bin/env bash
# require-img-alt — PreToolUse hook. Reads Claude Code JSON from stdin.
# Blocks <img> and <Image> tags without an alt= attribute in tsx component
# files. Composes with accessibility-check (manual gate).
# Exit codes: 0 allow, 2 block.

set -euo pipefail

INPUT=$(cat)
TOOL=$(printf "%s" "$INPUT" | jq -r '.tool_name // empty')
FILE=$(printf "%s" "$INPUT" | jq -r '.tool_input.file_path // empty')
NEW=$(printf "%s" "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

case "$TOOL" in Edit|Write) ;; *) exit 0 ;; esac
[[ -z "$FILE" || -z "$NEW" ]] && exit 0

# Only tsx/jsx in component paths
re_path='apps/[^/]+/src/components/|packages/[^/]+/src/'
[[ "$FILE" =~ $re_path ]] || exit 0
[[ "$FILE" =~ \.(tsx|jsx)$ ]] || exit 0
[[ "$FILE" =~ \.(test|spec|stories)\.(tsx|jsx)$|\.mdx$ ]] && exit 0

# Match `<img ...` or `<Image ...` (self-closing or block — any closing)
re_tag='<(img|Image)\b'

# Hits = lines with the tag but without alt= attribute
HITS=$(printf "%s" "$NEW" | grep -nE "$re_tag" | grep -vE 'alt[[:space:]]*=' | grep -vE '// *allow-no-alt:' || true)

if [[ -n "$HITS" ]]; then
  printf "require-img-alt: <img>/<Image> without alt in %s\n%s\n\n" "$FILE" "$HITS" >&2
  printf "Every image needs an alt — descriptive for content, alt=\"\" for decorative.\n" >&2
  printf "Override (decorative + aria-hidden): tag the line '// allow-no-alt: <reason>'.\n" >&2
  exit 2
fi

exit 0
