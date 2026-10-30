---
title: harden the backlog-loop git + allowlist gates (issue #17 cluster A)
date: 2026-06-18
status: done
spec: docs/specs/2026-06-18-loop-git-allowlist-hardening.md
author: Florent Pellegrin + Claude
high_risk: true
---

> Archive du moteur backlog-loop retiré au cutover du 24 septembre 2026.
> Ce document conserve la décision et ses preuves historiques, pas une procédure active.
> Le script secondaire `block-protected-push` et son override `AUTO_MERGE` ont été retirés.
> Le contrat courant est `docs/specs/2026-09-22-autopilot-native-loop.md` et ses ADR.


## Goal

Durcir les gates git/allowlist de `autonomous-backlog-loop` face aux conditions réelles
(issue #17 cluster A) : **A1** rendre impossible le clobber d'une branche protégée (hook
pre-push + `git switch -c` + push refspec explicite + `push.default current`), **A2**
isoler chaque worker dans son worktree, **A3** rendre `source-driven-development` satisfiable
hors-ligne sans ouvrir l'egress, **A4** autoriser un sous-ensemble git non-destructif. Sans
affaiblir le deny-by-default.

**Architecture A1 révisée par l'autoplan** (Codex + gate utilisateur) : la frontière n'est PAS
le hook (contournable via `node→git push`). Elle est : (1) **branch protection serveur** sur
`main`/`master`, exigée au pré-flight ; (2) **le push + la PR appartiennent à l'orchestrateur**
(de confiance) — `Bash(git push:*)` et `Bash(gh pr:*)` **retirés** de l'allowlist worker ; le
worker commit seulement. Le hook reste comme **filet secondaire**, pas comme boundary.

## Revised steps (post-autoplan — authoritative)

> Remplacent les "Original steps" plus bas. Tranches par valeur de sécurité.

1. **Pré-flight branch protection** : l'orchestrateur vérifie (via `gh api`) que la base
   (`main`) est protégée ; refuse/avertit sinon. *strict* sur le parse de la réponse, *souple*
   sur le câblage. Gate : test + refus clair si non protégée.
2. **Push + PR par l'orchestrateur** : retirer `git push`/`gh pr` de l'allowlist worker ; le
   worker reporte branche + titre/corps de PR (via `VOID_EVENT`) ; à `COMPLETED`, l'orchestrateur
   `git push origin <branch>:refs/heads/<branch>` (refspec explicite, sans force) + `gh pr create`
   + déplace le ticket Linear. *souple* (faux-claude). Gate : le worker n'a plus de push autorisé ;
   l'orchestrateur pousse la branche worktree + ouvre la PR ; assertion allowlist.
3. **Worktree par ticket** : `git worktree add --detach` (pas de branche temp qui fuit) ; `prune`
   au démarrage ; cleanup en `finally`/exit (pas que succès) ; dirs run-scoped (`wt/${sha}-${pid}`) ;
   `push.default current` (portée = pushes nus seulement, documentée) ; vérifier `.void/` gitignore
   vs pré-flight arbre-propre. *souple*. **Checkpoint A** après ce step.
4. **Hook `block-protected-push.sh` (filet secondaire)** : garde le hook + tests **adverses**
   (`--mirror`, `--all`, `-c push.default`, delete-refspec `:main`, `sha:main`, chaînage `&&`),
   message stderr exact (template `block()`), résolution `@{u}` dans le cwd worktree, câblé via
   `findCoreSource()`. `AUTO_MERGE` **dérivé** de `cfg.autoMerge` (pas lu de l'env ambiant) ;
   pré-flight échoue si l'env hérité diverge. *souple/strict*. Gate : red tests adverses verts.
5. **Allowlist A4 (trim) + deny hardening** : allow += `git cherry-pick`, `git rebase --onto`
   **seulement** (drop `apply`/`format-patch`/`merge --no-ff`) ; bannir `--exec`/`--rebase-merges`/
   `--strategy-option`/`--unsafe-paths` ; deny += `git push --mirror`/`--all`/`-c`/delete-refspec.
   *strict* (assertions allow/deny). Gate : `pnpm test` vert.
6. **Worker prompt** : commit-only (plus de push/PR) ; `git switch -c` ; un blocage protégé est
   **terminal-pour-le-ticket** (`VOID_AUTONOMOUS_RESULT: BLOCKED`, pas de retry) ; reporte
   branche+PR-body. *souple*.
7. **A3 source-driven offline + source-debt bloquant** : branche offline (port + Zod) ; label
   `source-debt` défini + checkbox PR obligatoire + **refus `--auto-merge` tant que non levée** ;
   pas d'ADR (artefact léger). Audit note. *souple/doc*.
8. **Docs/sync** : SKILL.md (modèle worktree+guard, override `--auto-merge`, lignes stuck) ;
   framing « réduit les faux blocages, pas le blast-radius » + tripwire rollback ; DECISIONS ;
   CLAUDE/AGENTS ; core-assets ; **logger à part le trou pré-existant** (`cat>.env`, `node -e` qui
   contournent `protect-sensitive-files` câblé sur Edit|Write seulement → issue #17 / nouveau) ;
   commentaire #17 cluster A.

Séquencement (UC4) : après le Cluster A, **C1 avant le Cluster B**.

---

## Original steps (superseded by the Revised steps above — kept for trace)

### Step 1 — Hook `block-protected-push.sh` + test (A1, cœur sécurité)

- **Goal**: un hook PreToolUse qui bloque tout `git push` dont la cible résolue est `main`/`master`, sauf `AUTO_MERGE=1`.
- **Depends on**: none
- **TDD mode**: souple (shell)
- **Verification gate**: test shell — stdin JSON `git push origin HEAD:refs/heads/main` → exit 2 ; `git push` nu avec upstream `origin/main` → exit 2 ; push de feature-branch → exit 0 ; `AUTO_MERGE=1` → exit 0. `node --check`/`bash -n` OK ; anti-bloat « shell syntax: all hooks » passe.
- **Expected commits**:
  - `test: block-protected-push hook refuses pushes resolving to a protected branch`
  - `feat: block-protected-push PreToolUse hook`
- **Notes**: ≤ 100 lignes. Parse le tool-call JSON (jq) ; résout la cible via la commande + `git rev-parse @{u}` ; précis (jamais bloquer une feature-branch). Fichier `packages/core/hooks/block-protected-push.sh`.

### Step 2 — Worktree par ticket dans l'orchestrateur (A2) + `push.default` (A1)

- **Goal**: chaque itération s'exécute dans un worktree dédié ; le worker (cwd = worktree) crée sa branche dedans ; HEAD du repo principal jamais touché.
- **Depends on**: none (parallélisable avec Step 1)
- **TDD mode**: souple
- **Verification gate**: test faux-claude étendu — l'orchestrateur crée un worktree, passe son chemin en cwd, pose `push.default current` dedans, nettoie après, et le HEAD du repo principal est intact ; une branche committée par le faux worker survit au `worktree remove`.
- **Expected commits**:
  - `test: orchestrator isolates each iteration in its own worktree`
  - `feat: per-ticket git worktree isolation for the loop`
- **Notes**: branche temp sans upstream (désamorce A1). Échec `worktree add` → die clair. Compose avec le pattern worktree de `backlog-batch` (pas d'extraction commune — YAGNI).

### Step 3 — Câbler le hook pre-push dans les settings du run (A1)

- **Goal**: l'orchestrateur ajoute une entrée `hooks.PreToolUse` (matcher Bash) au settings du run, pointant le hook bundlé.
- **Depends on**: [step-1, step-2]
- **TDD mode**: souple
- **Verification gate**: test — le settings écrit par l'orchestrateur contient l'entrée `hooks.PreToolUse` avec le chemin du hook ; le chemin résolu (`<cli>/core-assets/hooks/block-protected-push.sh`) existe après `build:assets`. Smoke : un faux `git push origin HEAD:main` dans le run est bloqué.
- **Expected commits**:
  - `feat: wire block-protected-push into the autonomous run settings`
- **Notes**: chemin résolu depuis les assets bundlés du CLI (linké comme npm). `AUTO_MERGE=1` propagé en env au worker pour le bypass.

### Checkpoint A — après Step 3

Le chemin worker durci (worktree isolé + branche sans upstream + push refspec + hook qui bloque un push vers `main`) est complet et testé. Stop, `harness:verification-before-completion`, attendre le signal.

### Step 4 — `AUTONOMOUS_SETTINGS` : sous-ensemble git non-destructif (A4)

- **Goal**: autoriser `cherry-pick`, `rebase --onto`, `merge --no-ff`, `format-patch`, `apply` ; garder le destructif denié.
- **Depends on**: none
- **TDD mode**: strict
- **Verification gate**: `pnpm test` vert — assertions : les 5 nouvelles entrées sont dans `allow` ; `reset --hard`, `push --force`/`-f` toujours dans `deny` ; pas de `git config`/`git rebase` nu/`git reset` ajoutés.
- **Expected commits**:
  - `test: autonomous allowlist grants the non-destructive git subset only`
  - `feat: allow narrow non-destructive git ops in the autonomous profile`
- **Notes**: étend la surface déjà touchée par le merge MCP (`mcp__linear__*`). Patterns scopés (`Bash(git rebase --onto:*)`, pas `git rebase:*`).

### Step 5 — Prompt worker : création de branche + push sûrs (A1)

- **Goal**: le prompt instruit `git switch -c <prefix><ticket>` (jamais `checkout -b … origin/main`) et `git push -u origin HEAD:refs/heads/<prefix><ticket>`.
- **Depends on**: none
- **TDD mode**: souple
- **Verification gate**: `pnpm test` vert — `renderPrompt` contient `git switch -c` et le push refspec explicite ; pas de `checkout -b` vers un remote.
- **Expected commits**:
  - `test: worker prompt instructs safe branch creation + explicit push refspec`
  - `feat: worker prompt uses git switch -c and explicit push refspec`
- **Notes**: dernière couche A1 (avec hook + worktree). Garde les marqueurs `VOID_EVENT` intacts.

### Step 6 — `source-driven-development` : branche offline (A3)

- **Goal**: section « Offline / no-network » — port injecté, Zod au bord, source-debt (commit + ADR + PR + label `source-debt`).
- **Depends on**: none
- **TDD mode**: souple (doc)
- **Verification gate**: anti-bloat (SKILL ≤ 400, description ≤ 200) ; la section existe et nomme le label `source-debt` ; audit note `plans/skill-audits/source-driven-development.md` mise à jour (ou créée).
- **Expected commits**:
  - `docs(source-driven-development): offline/no-network branch + source-debt label`
- **Notes**: zéro élargissement d'egress (décision A3). Cohérent avec `security-guidance`/`hexagonal`.

### Step 7 — Docs, sync, clôture partielle #17

- **Goal**: entrée `DECISIONS.md` ; `CLAUDE.md`/`AGENTS.md` si une convention change ; core-assets régénéré ; commentaire sur l'issue #17 (cluster A traité, B/C à suivre).
- **Depends on**: [step-1, step-2, step-3, step-4, step-5, step-6]
- **TDD mode**: souple
- **Verification gate**: `pnpm test` vert ; `pnpm version:check` ; `sync:docs` (parité) ; `anti-bloat:check` ; `void-harness doctor` ; aucun marqueur de conflit ; le hook bundlé présent dans core-assets.
- **Expected commits**:
  - `docs: DECISIONS + core-assets + issue #17 cluster A follow-up`
- **Notes**: ne pas fermer l'issue (B/C restent). Commenter le mapping A1-A4 → commits.

---

## Review checkpoints

- **Checkpoint A — après Step 3** : chemin worker durci (worktree + hook pre-push) complet.

## Autoplan

`high_risk: true` (sécurité du loop autonome + frontière git). Lancer `gstack:/autoplan` sur ce
plan **avant** d'exécuter, à la demande de l'utilisateur.

---

## GSTACK REVIEW REPORT (autoplan, 2026-06-18)

Dual-voice: 3 independent Claude reviewers (CEO/strategy, Eng/architecture, DX). Codex
re-running after a stdin glitch (degraded → subagent-only if it does not return).

### Consensus

| Dimension | Verdict |
|---|---|
| Hook reliably blocks protected-branch push | **NO** — blind to `--mirror`, `--all`, `git -c push.default=upstream`, delete-refspec `:main`, `sha:main`, `&&`-chaining; the allowlist's `Bash(git push:*)` permits them too. CRITICAL. |
| Worktree-per-ticket flow sound | **YES** (Eng verified add → `switch -c` → survives `remove`) — but orphan cleanup on crash is missing. |
| A4 allowlist safe for an unattended agent | **NO** — `git apply` is an arbitrary-file write that bypasses the Edit/Write + protect-sensitive-files gates; `merge` can leave a half-merged tree. |
| Blocked push visible to operator/agent | **NO** — guard prints to stderr → only the run log; the worker gets a bare denial and will retry/work around. |
| A3 offline branch | **PARTIAL** — risks shipping guessed contracts unattended; `source-debt` label undefined, ADR requirement fails adr-workflow's own test. |
| SKILL.md teaches the new safety model | **NO** — not in any step's edit list. |

### Auto-decided revisions to fold into the plan (mechanical — completeness/security)

1. **Step 1 hook**: enumerate + red-test the adversarial forms (`--mirror`, `--all`, `-c push.default`, delete-refspec, `sha:main`, command-chaining); pin the exact stderr block message (match `block()` 3-line template); confirm PreToolUse fires per compound command; resolve `@{u}` in the worker's worktree cwd.
2. **Step 4 deny-list**: add `Bash(git push --mirror:*)`, `--all`, `-c` push variants, delete-refspec to `deny` so two layers cover the hole (hook + deny), not zero. **Drop `git apply`** from `allow` (arbitrary write). Reconsider `format-patch`/`merge --no-ff` (Eng: weakest justification).
3. **New step — blocked-push visibility**: orchestrator greps worker stderr for `block-protected-push:` → emits `VOID_EVENT: BLOCKED`; worker prompt: a protected-branch block is terminal-for-ticket (emit `VOID_AUTONOMOUS_RESULT: BLOCKED`, do not retry).
4. **Step 2 worktree**: `git worktree add --detach` (no leaked temp branch); `git worktree prune` at run start; cleanup in a `finally`/exit path not just success; run-scoped dirs (`wt/${sha}-${pid}`); verify `.void/` gitignore vs the dirty-tree preflight.
5. **Step 3 wiring**: reuse `findCoreSource()` (`paths.ts:15-39`), not a new resolver; downgrade the "smoke blocks a real push" claim to "settings contains the hook entry" unless a hook-invoking integration test is built.
6. **AUTO_MERGE**: derive the `AUTO_MERGE=1` env (the hook's lever) from the `--auto-merge` flag — single source of truth.
7. **Step 2 note**: `push.default current` only governs *bare* pushes; the explicit refspec ignores it. Document its real (narrow) scope; don't claim redundant cover.
8. **Step 7 → SKILL.md edits**: Safety bullet for the worktree+guard model + AUTO_MERGE override; "When you are stuck" rows for blocked-push and stale-worktree.
9. **Safety framing (CEO)**: state these changes reduce *false blocks*, not *blast radius*; add a rollback tripwire (another protected-branch incident → unattended requires sandbox).
10. **A3 source-debt**: define the label + what it obligates a reviewer to do (PR-body checkbox); drop the ADR requirement (it fails adr-workflow's rejected-alternative test).

### User challenge resolutions (gate, 2026-06-18)

- **UC1 — A4 scope**: TRIM to `cherry-pick` + `rebase --onto` only. Drop `git apply`,
  `format-patch`, `merge --no-ff` (arbitrary write / tree reconstruction / half-merge).
- **UC2 — packaging**: keep Cluster A as ONE PR; the plan already front-loads A1+A2
  (Steps 1-3 = Checkpoint A), so A1 is reviewed/merged first within the cluster.
- **UC3 — A3 egress**: keep **offline-only** (no egress widening); make the `source-debt`
  flow **blocking** — define the label, mandatory PR checkbox, and refuse `--auto-merge`
  while a source-debt is unresolved.
- **UC4 — sequencing**: after Cluster A, do **C1 (feedback tooling) before Cluster B** —
  build the self-evolution channel before more polish. (Tracked in issue-17 memory.)

Gate outcome (first gate): **APPROVED with revisions** (10 auto-decided + 4 challenge resolutions).

### Codex addendum (landed after the gate — architectural challenge, NOT auto-decided)

Codex (gpt-5.5, xhigh) goes deeper than the Claude voices and challenges A1's *layer*:

- **[CRITICAL] The push guard is at the wrong layer.** The worker also has `Bash(node:*)`,
  `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(npx:*)`. A package script or `node -e "execSync('git
  push origin HEAD:main')"` makes PreToolUse see `node`/`pnpm`, **not** `git push` — the hook
  never fires. A string-matching hook guarding an agent with arbitrary code execution is
  bypassable by construction.
- **[CRITICAL] `git apply` (A4) + the existing Bash allowlist already bypass
  `protect-sensitive-files`** (which is wired to `Edit|Write` only, not Bash). `git apply
  --unsafe-paths /tmp/p.patch`, `cat > .env`, `node -e "fs.writeFileSync('.env',…)"` all write
  protected files unseen. (The cat/node vector is pre-existing — bigger than cluster A.)
- **[HIGH] `git rebase --onto … --exec <cmd>`** = command execution if the allow pattern is
  `Bash(git rebase --onto:*)`. Ban `--exec`/`--rebase-merges`/`--strategy-option`/etc.
- **[HIGH] AUTO_MERGE must be derived from `cfg.autoMerge`, not read as an ambient env var**
  by the hook (inherited env passes through; config also reads `env.AUTO_MERGE`). Fail
  preflight on mismatch.

**Codex's highest-risk gap + fix**: keep enforcement out of a string-matching hook. The
durable boundary is **server-side branch protection** on `main`/`master` (the remote refuses
non-PR pushes regardless of what the agent runs) PLUS **moving push + PR creation into the
trusted orchestrator** (remove `Bash(git push:*)` and `gh pr` from the worker allowlist so the
worker physically cannot push). The hook is then cheap secondary defense, not the boundary.

This reframes A1. Surfaced to the user as a second gate before execution.

## Resume point

**Next step**: cluster A **complet et mergé-ready** sur `feat/loop-git-allowlist-hardening`.
Per UC4 : faire **C1 (feedback tooling) avant le Cluster B**. Aussi : promouvoir la note
`.void/harness-feedback/proposed/2026-06-19-1.md` (trou Bash-write de `protect-sensitive-files`)
en issue à part, et poster le commentaire de clôture cluster A sur l'issue #17 (à la main /
après merge de la PR).

**État**: **Revised steps 1-8 tous livrés** (TDD, paires test→feat). Checkpoint A validé par
l'utilisateur. Gate final vert (test/typecheck/lint/version:check/sync:docs/anti-bloat/doctor).
Bonus hors-plan : fix issue #21 (backlog-batch `args` JSON string).

**Completed**:
- ✅ Step 1: pré-flight branch protection serveur (refus si base non-protégée)
- ✅ Step 2: push + PR par l'orchestrateur (worker commit-only, allowlist trim push/gh pr)
- ✅ Step 3: worktree par ticket (détaché, prune+cleanup, push.default, .gitignore) — Checkpoint A
- ✅ Step 4: hook block-protected-push (filet secondaire) + tests adverses + AUTO_MERGE dérivé
- ✅ Step 5: allowlist A4 (cherry-pick + rebase --onto) + deny push variants + ban exec flags
- ✅ Step 6: prompt worker commit-only (switch -c, BRANCH, blocage terminal)
- ✅ Step 7: source-driven offline + source-debt bloquant l'auto-merge
- ✅ Step 8: docs/DECISIONS/CLAUDE+AGENTS/core-assets + note feedback trou pré-existant

**Pending**: —
