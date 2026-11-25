#!/usr/bin/env bash
# llm-cost-precommit — pre-commit hook
#
# Warns on LLM cost-discipline violations in staged code:
#   - model: 'opus' without `// using Opus because` comment in nearby line
#   - missing max_tokens
#   - missing cache_control on large system arrays (best-effort static check)
#
# Composed with the `llm-cost-discipline` skill.
#
# Files: TS files importing @anthropic-ai/sdk OR matching .paths.ai
#
# Exit codes: 0 allow, 2 warn.

set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' || true)
[[ -z "$STAGED" ]] && exit 0

WARNINGS=""
for FILE in $STAGED; do
  if ! grep -q 'anthropic-ai/sdk' "$FILE" 2>/dev/null; then continue; fi

  ADDED=$(git diff --cached -- "$FILE" | grep -E '^\+' | grep -v '^+++' || true)

  # Opus without justifying comment
  OPUS=$(printf "%s" "$ADDED" | grep -nE "model:\s*['\"](claude-)?opus" || true)
  if [[ -n "$OPUS" ]]; then
    # check if a `using Opus because` comment appears in the file near the call
    if ! grep -qE 'using Opus because|// allow-opus' "$FILE" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  $FILE [Opus without justifying comment]:\n$OPUS"
    fi
  fi

  # Missing max_tokens in messages.create call (best-effort: scan for messages.create blocks lacking max_tokens)
  if printf "%s" "$ADDED" | grep -qE 'messages\.create\('; then
    if ! grep -qE 'max_tokens' "$FILE" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  $FILE [missing max_tokens in messages.create]"
    fi
  fi

  # Missing cache_control on long system prompt (best-effort: scan for system: with a > 100-line string ref)
  if printf "%s" "$ADDED" | grep -qE 'system:'; then
    if ! grep -qE 'cache_control|// allow-no-cache' "$FILE" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  $FILE [system: present but no cache_control in file — verify >1024-token threshold]"
    fi
  fi
done

if [[ -n "$WARNINGS" ]]; then
  printf "llm-cost-precommit (warn): cost-discipline checks:" >&2
  printf "%b\n" "$WARNINGS" >&2
  printf "\nSee llm-cost-discipline skill. Tag '// allow-opus: <reason>' or '// allow-no-cache: <reason>' for exceptions.\n" >&2
  exit 2
fi
