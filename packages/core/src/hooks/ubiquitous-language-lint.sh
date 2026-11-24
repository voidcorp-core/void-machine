#!/usr/bin/env bash
# ubiquitous-language-lint — informational pre-commit hook
#
# Composed with the `domain-driven-design` skill. Maintains a per-context
# glossary at docs/DOMAIN.md (or per-context docs/<context>/DOMAIN.md).
# Flags drift between code identifiers and glossary terms.
#
# This hook is INFORMATIONAL. It never blocks. The user decides whether
# to update the glossary or rename the code.
#
# Output: a summary report of terms present in code but missing from
# DOMAIN.md, and vice versa.
#
# Exit codes: always 0 (informational only).

set -euo pipefail

GLOSSARY_PATHS=()
[[ -f docs/DOMAIN.md ]] && GLOSSARY_PATHS+=(docs/DOMAIN.md)
while IFS= read -r f; do
  [[ -n "$f" ]] && GLOSSARY_PATHS+=("$f")
done < <(find docs -path 'docs/*/DOMAIN.md' -type f 2>/dev/null || true)

[[ ${#GLOSSARY_PATHS[@]} -eq 0 ]] && exit 0   # no glossary, skip silently

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' || true)
[[ -z "$STAGED" ]] && exit 0

# Extract glossary terms (lines starting with `- ` or `## ` followed by a noun)
GLOSSARY_TERMS=$(cat "${GLOSSARY_PATHS[@]}" 2>/dev/null \
  | grep -oE '^(- |## )[A-Z][A-Za-z]+' \
  | sed -E 's/^(- |## )//' \
  | sort -u || true)

# Extract identifier terms from staged TS files
CODE_TERMS=""
for FILE in $STAGED; do
  CODE_TERMS+=$'\n'$(git show ":$FILE" 2>/dev/null \
    | grep -oE '\b[A-Z][A-Za-z]{3,}\b' \
    | sort -u || true)
done
CODE_TERMS=$(printf "%s" "$CODE_TERMS" | sort -u)

# Set diff: terms in glossary but not in code, and vice versa
MISSING_IN_CODE=$(comm -23 <(printf "%s\n" "$GLOSSARY_TERMS") <(printf "%s\n" "$CODE_TERMS"))
MISSING_IN_GLOSSARY=$(comm -13 <(printf "%s\n" "$GLOSSARY_TERMS") <(printf "%s\n" "$CODE_TERMS") | head -20)

if [[ -n "$MISSING_IN_CODE" || -n "$MISSING_IN_GLOSSARY" ]]; then
  printf "ubiquitous-language-lint (informational):\n" >&2
  [[ -n "$MISSING_IN_GLOSSARY" ]] && {
    printf "  Code identifiers not in DOMAIN.md (top 20):\n%s\n" "$MISSING_IN_GLOSSARY" >&2
  }
  [[ -n "$MISSING_IN_CODE" ]] && {
    printf "  DOMAIN.md terms not used in code:\n%s\n" "$MISSING_IN_CODE" >&2
  }
fi

exit 0
