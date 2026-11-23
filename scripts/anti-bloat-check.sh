#!/usr/bin/env bash
# anti-bloat-check — discovery, provenance, isolation and syntax contracts
# documented in CLAUDE.md / AGENTS.md.
#
# Run locally: `pnpm anti-bloat:check`
# Also wired into .github/workflows/ci.yml on every PR.
#
# Exit codes: 0 = all checks pass, 1 = at least one rule violated.

set -euo pipefail

FAILED=0
DESCRIPTION_TARGET=250
DESCRIPTION_CAP=500
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

echo "anti-bloat-check"

# Discover skill + hook files across core AND packs (the published surface),
# excluding node_modules, build output, and the cli core-assets mirror.
FIND_EXCL=(-not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/core-assets/*')
SKILL_FILES=$(find packages/core packages/packs -path '*/skills/*/SKILL.md' "${FIND_EXCL[@]}" 2>/dev/null || true)
HOOK_FILES=$(find packages/core packages/packs -path '*/hooks/*.sh' "${FIND_EXCL[@]}" 2>/dev/null || true)



# Manifest <-> disk: every hook command wired in the core plugin manifest must
# resolve to a file on disk. A dangling reference disables enforcement silently
# (the audited fail-open class). Parse the hooks/<name>.sh basenames out of the
# manifest and assert each exists under packages/core/hooks/.
echo "  manifest <-> disk: wired hooks exist"
PLUGIN_MANIFEST="packages/core/.claude-plugin/plugin.json"
if [[ -f "$PLUGIN_MANIFEST" ]] && command -v jq >/dev/null 2>&1; then
  WIRED=$(jq -r '.hooks // {} | to_entries[] | .value[]? | .hooks[]? | .command // empty' "$PLUGIN_MANIFEST" 2>/dev/null \
    | grep -oE 'hooks/[A-Za-z0-9_-]+\.sh' | sort -u || true)
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    if [[ ! -f "packages/core/$ref" ]]; then
      echo "    FAIL: manifest references packages/core/$ref which does not exist" >&2
      FAILED=1
    fi
  done <<<"$WIRED"
fi

# Hook syntax (core + packs)
echo "  shell syntax: all hooks"
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  if ! bash -n "$f" 2>/dev/null; then
    echo "    FAIL: syntax in $f" >&2
    FAILED=1
  fi
done <<<"$HOOK_FILES"

# Frontmatter discovery budget (rule 4): skills (core + packs) + agents.
# Above-target descriptions remain valid, but the note keeps their catalogue
# cost visible. Only the hard cap blocks the change.
echo "  rule 4: frontmatter description target $DESCRIPTION_TARGET chars, hard cap $DESCRIPTION_CAP chars"
SPECIALIST_FILES=$(find packages/core/specialists -maxdepth 1 -type f -name '*.yaml' 2>/dev/null || true)
DESC_FILES=$(printf "%s\n" "$SKILL_FILES"; ls packages/core/agents/*.md 2>/dev/null || true; printf "%s\n" "$SPECIALIST_FILES")
if ! printf "%s\n" "$DESC_FILES" \
  | node "$SCRIPT_DIR/check-description-budgets.mjs" "$DESCRIPTION_TARGET" "$DESCRIPTION_CAP"; then
  FAILED=1
fi

# Agent isolation: every shipped agent must declare an explicit, non-empty
# Claude tool allowlist. Without this field the runtime can inherit tools from
# its parent context, so a missing declaration is a fail-closed packaging bug.
echo "  agent frontmatter: every agent declares a non-empty tools allowlist"
for f in packages/core/agents/*.md; do
  [[ -e "$f" ]] || continue
  TOOLS=$(awk '
    /^---[[:space:]]*$/ { frontmatter = !frontmatter; next }
    frontmatter && /^tools:[[:space:]]*/ { sub(/^tools:[[:space:]]*/, ""); print; exit }
  ' "$f")
  if [[ -z "${TOOLS//[[:space:]]/}" ]]; then
    echo "    FAIL: $f must declare a non-empty frontmatter 'tools:' allowlist" >&2
    FAILED=1
  fi
done

# Skill name convention (Anthropic Agent Skills spec): the frontmatter `name`
# must equal the parent directory name and match ^[a-z0-9]+(-[a-z0-9]+)*$
# (lowercase, hyphen-separated, no leading/trailing/double hyphen). A mismatch
# breaks auto-discovery silently, so it is a hard gate.
echo "  skill name == folder + naming convention"
for f in packages/core/skills/*/SKILL.md packages/packs/*/skills/*/SKILL.md; do
  [[ -e "$f" ]] || continue
  DIR=$(basename "$(dirname "$f")")
  NAME=$(awk '/^name:/{ sub(/^name: */,""); print; exit }' "$f" 2>/dev/null || true)
  if [[ -z "$NAME" ]]; then
    echo "    FAIL: $f has no frontmatter 'name:'" >&2
    FAILED=1
    continue
  fi
  if [[ "$NAME" != "$DIR" ]]; then
    echo "    FAIL: $f name '$NAME' != folder '$DIR'" >&2
    FAILED=1
  fi
  if [[ ! "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "    FAIL: $f name '$NAME' violates ^[a-z0-9]+(-[a-z0-9]+)*\$" >&2
    FAILED=1
  fi
  # A skill is named by what someone would type looking for it without knowing
  # it exists. `kind` says which grammar applies, so the rule is checkable
  # instead of being an intention: an action takes its bare verb, a standard
  # takes the subject it governs.
  KIND=$(awk '/^kind:/{ sub(/^kind: */,""); print; exit }' "$(dirname "$f")/harness.yaml" 2>/dev/null || true)
  case "$KIND" in
    action|standard) ;;
    "") echo "    FAIL: $f has no frontmatter 'kind:' (action or standard)" >&2; FAILED=1 ;;
    *)  echo "    FAIL: $f kind '$KIND' is not action or standard" >&2; FAILED=1 ;;
  esac


  # The prefix, which rule 8 calls the durable invariant. A runtime resolves
  # skills from several providers and the level this harness installs into loses
  # every collision it enters, silently -- that is why the rule exists.
  #
  # It is also load-bearing somewhere it does not look like it: the managed
  # ignore block matches `.claude/skills/void-*/` rather than naming 82 owned
  # directories, so a shipped skill without the prefix would be committed into
  # every consumer's repository. That block cites this gate; until now the gate
  # was not here, and the citation was false.
  if [[ "$NAME" != void-* ]]; then
    echo "    FAIL: $f name '$NAME' ships without the void- prefix (rule 8)" >&2
    FAILED=1
  fi
done

# Provenance travels with each distributed skill.
echo "  sourcing: .source per skill"

while IFS= read -r f; do
  [[ -n "$f" && -e "$f" ]] || continue
  DIR=$(dirname "$f")
  NAME=$(basename "$DIR")
  if [[ ! -f "$DIR/.source" ]]; then
    echo "    FAIL: $f has no co-located .source" >&2
    FAILED=1
  fi
done <<<"$SKILL_FILES"



if [[ "$FAILED" -eq 0 ]]; then
  echo "anti-bloat-check: all checks passed."
else
  echo "anti-bloat-check: at least one rule violated." >&2
fi
exit "$FAILED"
