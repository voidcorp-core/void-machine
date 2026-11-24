#!/usr/bin/env bash
# _checks.sh — pure detection functions for Void Machine enforcement floor.
# SOURCED, never executed (leading underscore = library; exempt from the hook
# size cap, still syntax-checked — see scripts/anti-bloat-check.sh).
#
# WHY this file exists (DEV-393): the floor (never-edit files, leaked secrets,
# @repo/* import direction, catastrophic shell) must be enforced identically by
# the PreToolUse hooks (Claude runtime, per-edit) AND the CI diff driver
# (enforce/ci-enforce.sh, per-PR). Extracting the detection here makes it ONE
# body of logic — the local hook and the server-side Action can never diverge.
#
# Contract: every function returns 1 and prints a payload on STDOUT when it
# detects a violation; returns 0 and prints nothing when the input is clean.
# Functions never `exit` (they are sourced) and never depend on the caller's
# stdin plumbing (_hooklib.sh) — path comes as $1, edited content on stdin.
# Content checks emit `<n>:<line>` (grep -n numbering over the scanned content)
# so a caller can map a hit back to a real file line for an annotation.

# checks_sensitive_path <path>: 1 + reason if the path is a never-edit file
# (env/secret/key/credential/lockfile/.git), else 0. Case-insensitive: on a
# case-insensitive FS .ENV and .env are the same file.
checks_sensitive_path() {
  local path="$1" base lpath
  [[ -z "$path" ]] && return 0
  base=$(basename "$path" | tr '[:upper:]' '[:lower:]')
  lpath=$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')
  if [[ "$base" =~ ^\.env(\..+)?$ ]] && [[ ! "$base" =~ \.(example|sample|template|dist)$ ]]; then
    printf 'environment file with secrets\n'; return 1; fi
  if [[ "$base" =~ \.(pem|key|p12|pfx|keystore|jks|asc)$ || "$base" =~ ^id_(rsa|ed25519|ecdsa|dsa)$ ]]; then
    printf 'private key / certificate\n'; return 1; fi
  if [[ "$base" =~ (\.npmrc$|\.netrc$|\.pgpass$) ]]; then
    printf 'credential file\n'; return 1; fi
  # The loose secret|credential NAME match is a heuristic; exempt markdown docs.
  # A real credential file is never .md, and content secret-scanning still covers
  # .md, so this only removes false positives (e.g. a decision note whose slug
  # contains "…-byo-credentials.md" is documentation, not a credential file).
  if [[ ! "$base" =~ \.md$ ]] && [[ "$base" =~ (secret|credential) ]]; then
    printf 'credential file\n'; return 1; fi
  case "$base" in
    package-lock.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb|cargo.lock|poetry.lock|composer.lock)
      printf 'lockfile (regenerate via the package manager, do not hand-edit)\n'; return 1 ;;
  esac
  [[ "$lpath" =~ (^|/)\.git/ ]] && { printf 'internal git metadata\n'; return 1; }
  return 0
}

# checks_boundary_imports <path> (content on stdin): 1 + `<n>:<line>` for each
# forbidden @repo/* import from packages/<X>/ (X may only import @repo/core or
# itself). No-ops for apps/, packages/core/, test/generated files — those
# exemptions are check semantics, so they live here, not in each caller.
checks_boundary_imports() {
  local file="$1" content pkg re_import violations="" line import target
  content=$(cat)
  [[ "$file" =~ ^packages/[^/]+/ ]] || return 0
  [[ "$file" =~ ^packages/core/ ]] && return 0
  [[ "$file" =~ \.(test|spec)\.(ts|tsx)$|\.d\.ts$|/__generated__/ ]] && return 0
  # The @repo/* direction is a TypeScript-source rule. Docs (.md — e.g. skill
  # examples that show a forbidden `import ... from '@repo/db'` marked ✗) carry
  # such imports as illustrations, never as real edges — only .ts/.tsx count.
  [[ "$file" =~ \.(ts|tsx)$ ]] || return 0
  pkg=$(printf '%s' "$file" | sed -E 's|^packages/([^/]+)/.*|\1|')
  re_import="from[[:space:]]+['\"]@repo/([a-zA-Z0-9-]+)"
  while IFS= read -r line; do
    import=$(printf '%s' "$line" | grep -oE '@repo/[a-zA-Z0-9-]+' | head -1)
    target=$(printf '%s' "$import" | sed 's|@repo/||')
    if [[ -n "$target" && "$target" != "core" && "$target" != "$pkg" ]]; then
      violations="${violations}${line}"$'\n'
    fi
  done < <(printf '%s' "$content" | grep -nE "$re_import" | grep -vE '// *allow-boundary:' || true)
  [[ -n "$violations" ]] && { printf '%s' "$violations"; return 1; }
  return 0
}

# checks_secret_content <path> (content on stdin): 1 + `<n>:<line>` for each line
# leaking a HIGH-confidence secret. Test-fixture paths are exempt (fake secrets
# are legitimate there). POSIX ERE only (no grep -P, #64).
checks_secret_content() {
  local file="$1" content re_hi re_assign n=0 line val hits=""
  content=$(cat)
  [[ "$file" =~ \.(test|spec)\.|/__tests__/|/__fixtures__/|/fixtures/|/__generated__/ ]] && return 0

  re_hi='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}'                                  # AWS
  re_hi="$re_hi"'|gh[posru]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}'    # GitHub
  re_hi="$re_hi"'|sk_live_[A-Za-z0-9]{20,}|rk_live_[A-Za-z0-9]{20,}'         # Stripe
  re_hi="$re_hi"'|sk-ant-[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}'      # Anthropic/OpenAI
  re_hi="$re_hi"'|sk-[A-Za-z0-9]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}'          # OpenAI/Slack
  re_hi="$re_hi"'|AIza[0-9A-Za-z_-]{35}'                                     # Google API
  re_hi="$re_hi"'|-----BEGIN [A-Z ]*PRIVATE KEY-----'                        # PEM
  re_assign='(_KEY|_SECRET|_TOKEN|_PASSWORD|_PASSWD|_APIKEY)["'\'' ]*[:=][ ]*["'\'']([A-Za-z0-9+/=_-]{24,})["'\'']'

  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    printf '%s' "$line" | grep -qE 'allow-secret-pattern:' && continue
    if printf '%s' "$line" | grep -qE "$re_hi"; then hits="${hits}${n}:${line}"$'\n'; continue; fi
    printf '%s' "$line" | grep -qiE "$re_assign" || continue
    val=$(printf '%s' "$line" | sed -E "s/.*[:=][ ]*[\"']([A-Za-z0-9+/=_-]{24,})[\"'].*/\1/")
    printf '%s' "$line" | grep -qiE 'process\.env|import\.meta\.env|xxx|changeme|example|redacted|your[-_]|<[a-z]|placeholder|todo' && continue
    [[ "$val" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] && continue
    [[ "$val" =~ ^[0-9a-fA-F]+$ ]] && continue
    printf '%s' "$val" | grep -qE '[A-Za-z]' && printf '%s' "$val" | grep -qE '[0-9]' || continue
    hits="${hits}${n}:${line}"$'\n'
  done < <(printf '%s' "$content")

  [[ -n "$hits" ]] && { printf '%s' "$hits"; return 1; }
  return 0
}

# checks_dangerous_command (command text on stdin): 1 + a short label if the
# text contains a catastrophic shell pattern (recursive root delete, fork bomb,
# raw-device write, root chmod/chown, force-push, unsafe git flags, DROP/
# TRUNCATE). Best-effort blocklist, not a complete boundary.
checks_dangerous_command() {
  local cmd norm
  cmd=$(cat)
  [[ -z "$cmd" ]] && return 0
  norm=$(printf '%s' "$cmd" | tr -d "\"'")
  local HOME_ROOT='(/\*?|~/?\*?|\$HOME/?\*?|\$\{HOME\}/?\*?)'
  local RM_TARGET='('"$HOME_ROOT"'|\./?\*?|\*)'

  if printf '%s' "$norm" | grep -qE '(^|[;&|[:space:]])rm([[:space:]]+(-[a-zA-Z]+|--[a-z-]+))*[[:space:]]+(-[a-zA-Z]*[rR]|--recursive)' \
    && printf '%s' "$norm" | grep -qE "(^|[;&|[:space:]])rm([[:space:]]+[a-zA-Z-]+)*[[:space:]]+(--[[:space:]]+)?${RM_TARGET}([[:space:]]|$)"; then
    printf 'recursive delete of a root path\n'; return 1; fi

  printf '%s' "$cmd" | grep -qE ':\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:' \
    && { printf 'fork bomb\n'; return 1; }

  printf '%s' "$cmd" | grep -qE '\bmkfs(\.[a-z0-9]+)?\b|\bdd\b[^|]*\bof=/dev/|>[[:space:]]*/dev/(sd|nvme|hd|disk)' \
    && { printf 'filesystem / raw-device write\n'; return 1; }

  if printf '%s' "$norm" | grep -qE 'ch(mod|own)([[:space:]]+[a-zA-Z0-9-]+)*[[:space:]]+(-[a-zA-Z]*R|--recursive)' \
    && printf '%s' "$norm" | grep -qE "[[:space:]](--[[:space:]]+)?${HOME_ROOT}([[:space:]]|$)"; then
    printf 'recursive permission/ownership change on a root path\n'; return 1; fi

  printf '%s' "$cmd" | grep -qE 'git[[:space:]]+push\b[^&|;]*[[:space:]](--force([^-]|$)|-f([[:space:]]|$))' \
    && { printf 'git push --force (use --force-with-lease)\n'; return 1; }

  if printf '%s' "$cmd" | grep -qE '\bgit\b([[:space:]]+-[^[:space:]]+)*[[:space:]]+(rebase|am|apply|cherry-pick)\b' \
    && printf '%s' "$cmd" | grep -qE '(--exec([[:space:]=]|$)|--rebase-merges|--strategy-option|--unsafe-paths)'; then
    printf 'git command-execution / unsafe-path flag\n'; return 1; fi

  printf '%s' "$cmd" | grep -qiE '\b(drop[[:space:]]+(database|table|schema)|truncate[[:space:]]+table)\b' \
    && { printf 'destructive SQL (DROP / TRUNCATE)\n'; return 1; }

  return 0
}
