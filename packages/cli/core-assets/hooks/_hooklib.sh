#!/usr/bin/env bash
# _hooklib.sh — shared helpers for the PreToolUse Edit|Write enforcement hooks.
# SOURCED, never executed (leading underscore = library; excluded from the
# hook-size anti-bloat rule, see scripts/anti-bloat-check.sh). Goals (#63):
#   - parse the Claude Code stdin JSON exactly once per hook;
#   - never fail OPEN when jq is missing: scalar fields fall back to pure-bash
#     extraction, and content-scanning hooks fail CLOSED with one explicit
#     message rather than silently skipping enforcement (the audited bug: an
#     unguarded jq call exited 127 under `set -e`, which Claude treats as a
#     non-blocking error, so the whole hook layer went dark without jq);
#   - share the physical-path root normalization introduced for #62.
# Every symbol is prefixed hooklib_ / _hooklib_.

# hooklib_read: consume stdin once. Sets HOOK_INPUT and HOOK_JQ (1 iff jq usable).
hooklib_read() {
  HOOK_INPUT=$(cat)
  if command -v jq >/dev/null 2>&1; then HOOK_JQ=1; else HOOK_JQ=0; fi
}

# hooklib_str <jq-filter> <bash-key>: extract a JSON scalar string from
# HOOK_INPUT. jq when available; else a pure-bash regex on the (unescaped)
# "<bash-key>": "<value>" pair — exact for the flat scalar fields we read.
hooklib_str() {
  if [[ "${HOOK_JQ:-0}" == 1 ]]; then
    printf '%s' "$HOOK_INPUT" | jq -r "$1 // empty" 2>/dev/null || true
  else
    local re="\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]*)\""
    [[ "$HOOK_INPUT" =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
}

hooklib_tool() { hooklib_str '.tool_name' 'tool_name'; }
hooklib_file() { hooklib_str '.tool_input.file_path' 'file_path'; }

# hooklib_content: the edited text (.content for Write, .new_string for Edit).
# jq gives the exact, unescaped text. Returns 1 (prints nothing) when jq is
# absent — a pure-bash JSON string-unescape is not reliable enough to scan for
# forbidden patterns, so the caller must gate on hooklib_require_jq first.
hooklib_content() {
  [[ "${HOOK_JQ:-0}" == 1 ]] || return 1
  printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || true
}

# hooklib_command: shell command (.command string, or Codex argv array joined).
hooklib_command() {
  if [[ "${HOOK_JQ:-0}" == 1 ]]; then
    printf '%s' "$HOOK_INPUT" \
      | jq -r 'if (.tool_input.command? | type) == "array" then (.tool_input.command | join(" ")) else (.tool_input.command // empty) end' 2>/dev/null || true
  else
    hooklib_str '.tool_input.command' 'command'
  fi
}

# Framing for the hooklib_edits stream (ASCII RS/US). Edited content routinely
# contains newlines and tabs, so neither can frame the records.
_HOOKLIB_RS=$'\036'
_HOOKLIB_US=$'\037'

# _hooklib_patch_text: the raw apply_patch envelope, whichever field a given
# Codex build carries it in. Same candidate list as the floor's
# protect-sensitive-files, so the two can never disagree on where a patch lives.
_hooklib_patch_text() {
  printf '%s' "$HOOK_INPUT" \
    | jq -r '[.tool_input.input, .tool_input.patch, .tool_input.content, .tool_input.command]
             | map(select(. != null))
             | map(if type == "array" then join("\n") else . end)
             | .[]' 2>/dev/null || true
}

# _hooklib_parse_patch: stdin = an apply_patch envelope; stdout = one
# <path>US<added-content>RS record per Add/Update section. Only ADDED (`+`)
# lines are collected, so a REMOVED or untouched context line can never trip a
# forbidden-pattern scan — the Codex equivalent of Claude's `.new_string`. A
# Delete section yields no record: there is nothing left to scan.
_hooklib_parse_patch() {
  awk -v USEP="$_HOOKLIB_US" -v RSEP="$_HOOKLIB_RS" '
    function emit() { if (path != "") printf "%s%s%s%s", path, USEP, buf, RSEP }
    /^\*\*\* (Add|Update) File: / { emit(); path = substr($0, index($0, "File: ") + 6); buf = ""; next }
    /^\*\*\* Delete File: /       { emit(); path = ""; buf = ""; next }
    /^\*\*\* (Begin|End) Patch/   { next }
    { if (path != "" && substr($0, 1, 1) == "+" && substr($0, 1, 3) != "+++") buf = buf substr($0, 2) "\n" }
    END { emit() }
  '
}

# hooklib_edits: the edits of THIS tool call as a NORMALIZED, runtime-agnostic
# stream of <path>US<new-content>RS records — one per edited file. It exists so a
# content-scanning hook iterates instead of assuming Claude's single-file shape:
#   - Claude: Edit|Write  -> one record (.tool_input.file_path + .content/.new_string)
#   - Codex:  apply_patch -> one record per patched file, carrying its added lines
# Wiring those hooks for Codex WITHOUT this would fire them against an empty
# payload: a wired-but-dead hook, which is a silent enforcement hole rather than
# an honest absence. Requires jq (exact content extraction) — callers gate on
# hooklib_require_jq first. Read it with:
#   while IFS= read -r -d "$_HOOKLIB_RS" rec; do
#     file="${rec%%"$_HOOKLIB_US"*}"; new="${rec#*"$_HOOKLIB_US"}"
#   done < <(hooklib_edits)
hooklib_edits() {
  # Without jq: degrade to the pure-bash file_path, emitting one CONTENTLESS
  # record. That keeps the PATH-ONLY hooks (auto-format) enforcing on
  # the Claude shape exactly as they did before this stream existed. It does not
  # weaken the content-scanning hooks: those call hooklib_require_jq BEFORE the
  # loop and have already exited 2 by the time they would read a record (#63).
  # A Codex patch simply cannot be parsed without jq, so it yields nothing.
  if [[ "${HOOK_JQ:-0}" != 1 ]]; then
    local bash_file
    bash_file=$(hooklib_file)
    [[ -n "$bash_file" ]] && printf '%s%s%s' "$bash_file" "$_HOOKLIB_US" "$_HOOKLIB_RS"
    return 0
  fi
  # A file_path means the single-file runtime shape. The patch parse is then
  # deliberately skipped: file CONTENT that happens to document the apply_patch
  # format (this repo's own docs do) would otherwise forge phantom records.
  if [[ -n "$(hooklib_file)" ]]; then
    printf '%s' "$HOOK_INPUT" \
      | jq -j --arg us "$_HOOKLIB_US" --arg rs "$_HOOKLIB_RS" \
          '.tool_input.file_path + $us + ((.tool_input.content // .tool_input.new_string) // "") + $rs' \
          2>/dev/null || true
    return 0
  fi
  _hooklib_patch_text | _hooklib_parse_patch
  return 0
}

# hooklib_require_jq [name]: a content-scanning hook cannot verify an edit
# without jq. Rather than fail OPEN (the #63 bug), block once with an explicit,
# actionable message. jq is a documented prerequisite (void-machine doctor).
hooklib_require_jq() {
  [[ "${HOOK_JQ:-0}" == 1 ]] && return 0
  printf '%s: jq is required to inspect edit content but is not installed.\n' "${1:-hook}" >&2
  printf 'Blocking rather than silently skipping enforcement. Install jq\n' >&2
  printf '(e.g. brew install jq) or run: void-machine doctor.\n' >&2
  exit 2
}

# hooklib_root: the project root in physical form (CLAUDE_PROJECT_DIR, else the
# git toplevel, else pwd). Trailing slash stripped.
hooklib_root() {
  local r
  r=$(_hooklib_phys "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}")
  printf '%s' "${r%/}"
}

# hooklib_relpath <path>: strip the project-root prefix so root-anchored globs
# match the ABSOLUTE paths Claude Code passes (#62). Physical-path compare
# (logical/physical roots differ under symlinks, e.g. macOS /var -> /private/var).
hooklib_relpath() {
  local file="$1" root
  [[ "$file" == /* ]] || { printf '%s' "$file"; return 0; }
  root=$(hooklib_root)
  file=$(_hooklib_phys "$file")
  case "$file" in "$root"/*) file="${file#"$root"/}" ;; esac
  printf '%s' "$file"
}

# _hooklib_phys: resolve the longest existing directory prefix to its physical
# path, then re-append the trailing (possibly non-existent) components.
_hooklib_phys() {
  local p="$1" t=""
  while [[ ! -d "$p" && "$p" == */* ]]; do t="/${p##*/}$t"; p="${p%/*}"; done
  if [[ -d "$p" ]]; then printf '%s%s' "$(cd "$p" && pwd -P)" "$t"; else printf '%s' "$1"; fi
}
