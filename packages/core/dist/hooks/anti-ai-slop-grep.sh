#!/usr/bin/env bash
# anti-ai-slop-grep — pre-commit hook
#
# Warns on banned copy patterns that signal "vibe coded" AI output.
# Composed with the `frontend-design` skill. WARN ONLY — false positives
# expected, writer is final.
#
# Allowlist:
#   - Lines tagged `// allow-slop: <reason>` (rare, brand-justified)
#
# Exit codes: 0 allow, 2 warn.

set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(tsx|jsx|ts|md|mdx)$' || true)
[[ -z "$STAGED" ]] && exit 0

WARNINGS=""
for FILE in $STAGED; do
  [[ "$FILE" =~ \.(test|spec)\.(ts|tsx|js|jsx)$ ]] && continue
  [[ "$FILE" =~ /__fixtures__/ ]] && continue

  ADDED=$(git diff --cached -- "$FILE" | grep -E '^\+' | grep -v '^+++' | grep -vE '// *allow-slop:' || true)
  HITS=$(printf "%s" "$ADDED" | grep -niE \
    'Build faster.{0,20}(ship smarter|ship faster)|Ship.{0,5}(10|five|three|five).{0,3}x faster|Unlock your potential|Empower your team|Transform your workflow|Get Started Free Forever|Take your.{0,20}to the next level|Supercharge your' \
    || true)
  if [[ -n "$HITS" ]]; then
    WARNINGS="${WARNINGS}\n  $FILE:\n$HITS"
  fi
done

if [[ -n "$WARNINGS" ]]; then
  printf "anti-ai-slop-grep (warn): generic AI copy patterns detected:" >&2
  printf "%b\n" "$WARNINGS" >&2
  printf "\nRewrite with specific, brand-aligned copy. See frontend-design skill.\n" >&2
  printf "If brand justifies the pattern, tag the line '// allow-slop: <reason>'.\n" >&2
  exit 2
fi
