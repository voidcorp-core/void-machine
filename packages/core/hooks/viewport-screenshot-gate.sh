#!/usr/bin/env bash
# viewport-screenshot-gate — optional PR-text advisory (not installed in native manifests)
#
# Reports if PR text for UI changes lacks mobile and desktop capture references
# in the PR body. Composed with the `accessibility` and
# `frontend-design` skills (mobile-first dual-quality invariant).
#
# UI paths: read from .void/config.json .paths.ui, default to
# **/{components,app,pages}/** and **/*.{tsx,jsx}
#
# Heuristic: PR body must reference both "mobile" and "desktop" markdown
# images (e.g. ![mobile](...) and ![desktop](...)) or be tagged with
# "no-ui-change: <reason>" in the body for non-UI PRs that happen to
# touch tsx files.
#
# No image validation. Missing PR/base is skipped. Exit 0 no finding, 2 advisory finding.

set -euo pipefail

CONFIG="${VOIDCORP_CONFIG:-.void/config.json}"

BASE=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || echo "")
[[ -z "$BASE" ]] && exit 0

BASE_SHA=$(git merge-base "HEAD" "origin/$BASE" 2>/dev/null || echo "")
[[ -z "$BASE_SHA" ]] && exit 0

TOUCHED_UI=$(git diff --name-only "$BASE_SHA"..HEAD | grep -E '\.(tsx|jsx)$' | grep -vE '/__tests__/|\.(test|spec)\.' || true)
[[ -z "$TOUCHED_UI" ]] && exit 0

BODY=$(gh pr view --json body --jq .body 2>/dev/null || echo "")
[[ -z "$BODY" ]] && { printf "viewport-screenshot-gate: no open PR found, skipping.\n" >&2; exit 0; }

# Bypass marker for non-UI changes that happen to touch tsx files
if printf "%s" "$BODY" | grep -qiE 'no-ui-change:'; then
  exit 0
fi

HAS_MOBILE=$(printf "%s" "$BODY" | grep -qiE '!\[[^]]*mobile[^]]*\]|mobile[[:space:]]*screenshot|mobile[[:space:]]*viewport' && echo "1" || echo "0")
HAS_DESKTOP=$(printf "%s" "$BODY" | grep -qiE '!\[[^]]*desktop[^]]*\]|desktop[[:space:]]*screenshot|desktop[[:space:]]*viewport' && echo "1" || echo "0")

if [[ "$HAS_MOBILE" == "0" || "$HAS_DESKTOP" == "0" ]]; then
  printf "viewport-screenshot-gate (warn): PR touches UI but lacks both mobile and desktop screenshots.\n" >&2
  printf "  has_mobile=%s  has_desktop=%s\n" "$HAS_MOBILE" "$HAS_DESKTOP" >&2
  printf "\nAdd both viewports to the PR body. Mobile starts at 360–390px (iPhone 12 mini–15 Pro).\n" >&2
  printf "If this PR has no UI change despite touching tsx, add 'no-ui-change: <reason>' to the body.\n" >&2
  exit 2
fi
