#!/usr/bin/env bash
# ci-enforce — replay the void-machine enforcement floor over a PR diff.
#
# Protected-path and secret-content rules execute through the SAME
# portable Node bundle as local PreToolUse hooks.
#
# FAIL-CLOSED (DEV-393, the #62-64 class): a missing prerequisite or an
# unresolvable base ref is an explicit RED check, never a silent green.
#
# Usage: ci-enforce.sh --base <ref>        # ref = the PR base, e.g. origin/main
# Exit:  0 = clean, 1 = violations found OR fail-closed error.

set -uo pipefail
RUNNER="${BASH_SOURCE[0]%/*}/../hooks/_void-hook.mjs"

BASE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    -h | --help) printf 'Usage: ci-enforce.sh --base <ref>\n'; exit 0 ;;
    *) printf '::error::void-enforce: unknown argument %s\n' "$1" >&2; exit 1 ;;
  esac
done

fail_closed() {
  printf '::error::void-enforce: %s\n' "$1"
  printf 'void-enforce (fail-closed): %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail_closed "git not found on runner (cannot compute the diff)"
NODE_BIN=$(command -v node 2>/dev/null) || fail_closed "Node.js not found on runner (cannot execute the shared floor)"
[[ -f "$RUNNER" ]] || fail_closed "shared Node enforcement bundle missing at '$RUNNER'"
[[ -n "$BASE" ]] || fail_closed "no base ref given (pass --base <ref>)"
git rev-parse --verify "${BASE}^{commit}" >/dev/null 2>&1 \
  || fail_closed "base ref '${BASE}' is unresolvable (checkout with fetch-depth: 0 and fetch the base)"
# A three-dot diff needs a merge-base. A shallow clone or a rewritten/disjoint
# base HAS the commit object but shares NO common ancestor: `git diff base...HEAD`
# then exits 128 and prints nothing — indistinguishable from a clean diff, which
# would fail OPEN. Verify the merge-base up front so this fails CLOSED instead.
git merge-base "${BASE}" HEAD >/dev/null 2>&1 \
  || fail_closed "no merge-base between '${BASE}' and HEAD (shallow clone or disjoint history — checkout with fetch-depth: 0)"

FAIL=0

# Committed, reviewable exemptions: `.github/void-enforce-allow` lists path globs
# (one per line, # comments) skipped entirely. This is the Action equivalent of
# the local VOID_MACHINE_ALLOW_SECRET_EDIT override — e.g. a file legitimately
# NAMED for secrets (the harness's own secret-in-content.sh) that sensitive-path
# would otherwise flag. A skip is LOGGED, never silent. Loaded once.
ALLOW_GLOBS=()
if [[ -f .github/void-enforce-allow ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"       # strip trailing comment
    read -r g <<<"$line" || true  # trim surrounding whitespace, take the glob
    [[ -n "${g:-}" ]] && ALLOW_GLOBS+=("$g")
  done <.github/void-enforce-allow
fi
_allowlisted() {
  local p="$1" g
  for g in "${ALLOW_GLOBS[@]:-}"; do
    [[ -n "$g" ]] || continue
    # shellcheck disable=SC2053 -- intentional glob match, $g is a pattern
    [[ "$p" == $g ]] && return 0
  done
  return 1
}

# Escape a workflow-command MESSAGE value: % -> %25, CR/LF -> %0D/%0A.
esc_msg() { printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'NR>1{printf "%%0A"} {printf "%s",$0} END{print ""}'; }
# Escape a PROPERTY value (file/title): also , -> %2C and : -> %3A.
esc_prop() { printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/:/%3A/g' -e 's/,/%2C/g'; }

annotate() { # <level> <file> <line> <message>
  printf '::%s file=%s,line=%s::%s\n' "$1" "$(esc_prop "$2")" "$3" "$(esc_msg "$4")"
  if [[ "$1" == error ]]; then FAIL=1; fi
}

# Added lines of <file> in base...HEAD as `<new-line-number>\t<text>`, one per
# added line, so a content match maps back to a real line for the annotation.
# Returns 2 (not empty output) if the per-file git diff itself fails, so the
# caller can fail CLOSED rather than mistake a git error for "no added lines".
added_lines() {
  local out
  out=$(git diff "${BASE}"...HEAD -- "$1") || return 2
  printf '%s' "$out" | awk '
    /^@@/       { if (match($0, /\+[0-9]+/)) n = substr($0, RSTART+1, RLENGTH-1) + 0; next }
    /^\+\+\+/   { next }
    /^\+/       { print n "\t" substr($0, 2); n++; next }
    /^-/        { next }
    /^ /        { n++; next }
  '
}

# Walk the changed files. Enumerate with -z (NUL-delimited) and
# core.quotepath=false so paths with non-ASCII bytes, spaces, tabs or newlines
# arrive RAW: under the default quotepath git octal-escapes and quotes such a
# path, and the escaped string then matches no file — silently skipping every
# content check (a leaked secret in `café.ts` would pass GREEN). Captured to a
# file (a bash variable cannot hold the NUL delimiters) with an exit check so a
# git error fails CLOSED, not silently clean.
NAMES=$(mktemp) || fail_closed "cannot create a temp file"
trap 'rm -f "$NAMES"' EXIT
git -c core.quotepath=false diff --name-status -z "${BASE}"...HEAD >"$NAMES" \
  || fail_closed "git diff --name-status failed for base '${BASE}'"

# -z records: `status\0path\0`, or `R###\0old\0new\0` for renames/copies.
while IFS= read -r -d '' status; do
  case "$status" in
    R* | C*) IFS= read -r -d '' _src || break; IFS= read -r -d '' path || break ;;
    D*) IFS= read -r -d '' _gone || break; continue ;;  # a deletion cannot leak
    *) IFS= read -r -d '' path || break ;;
  esac
  [[ -z "${path:-}" ]] && continue

  if _allowlisted "$path"; then
    printf 'void-enforce: %s skipped (allowlisted in .github/void-enforce-allow)\n' "$path"
    continue
  fi

  # 1) Never-edit file (path only): lockfile / key / secret filename / .git.
  if protected=$("$NODE_BIN" "$RUNNER" enforce-ci protected-file "$path" </dev/null 2>&1); then :; else
    # A committed diff cannot prove whether the package manager generated it.
    # Dependency refreshes may leave manifests unchanged; keep content scanning.
    if [[ "$protected" == *": lockfile (regenerate via the package manager, do not hand-edit)" ]]; then
      annotate warning "$path" 1 "lockfile diff requires dependency validation: frozen install, vulnerability audit, tests and review; generation is not verified by this check"
    else
      protected_reason="${protected##*: }"
      annotate error "$path" 1 "protected file: ${protected_reason//$'\n'/ }"
      continue
    fi
  fi

  # 2) Secret checks over the ADDED lines, with real line numbers.
  diff_added=$(added_lines "$path") || fail_closed "git diff failed for '${path}' (cannot scan its content)"
  [[ -z "$diff_added" ]] && continue
  LNOS=()
  while IFS= read -r line_number; do
    LNOS+=("$line_number")
  done < <(printf '%s\n' "$diff_added" | cut -f1)
  added_text=$(printf '%s\n' "$diff_added" | cut -f2-)

  if hits=$(printf '%s' "$added_text" | "$NODE_BIN" "$RUNNER" enforce-ci secret-content "$path" 2>&1); then :; else
    FOUND=0
    while IFS= read -r hit; do
      [[ "$hit" =~ ^-\ .+:([0-9]+)$ ]] || continue
      FOUND=1
      rel="${BASH_REMATCH[1]}"
      annotate error "$path" "${LNOS[rel - 1]:-1}" "leaked secret (see harness:security-guidance)"
    done <<<"$hits"
    [[ "$FOUND" -eq 1 ]] || annotate error "$path" 1 "secret scan failed closed: ${hits//$'\n'/ }"
  fi

  # NB: checks_dangerous_command (the local Bash runtime guard) is deliberately
  # NOT replayed over the diff. A destructive PATTERN committed into a file is a
  # weak signal that self-matches the harness's own detector, security docs, and
  # test fixtures — net-negative false positives for a floor check. Deferred to a
  # follow-up with a proper per-line allow tag (see docs/DECISIONS.md).
done <"$NAMES"

if [[ "$FAIL" -ne 0 ]]; then
  printf 'void-enforce: floor violations found (see annotations above).\n' >&2
  exit 1
fi
printf 'void-enforce: clean — no floor violations in the diff.\n'
exit 0
