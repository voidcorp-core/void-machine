---
title: harden the backlog-loop git + allowlist gates (issue #17 cluster A)
date: 2026-06-18
status: approved
author: Florent Pellegrin + Claude
related:
  - https://github.com/voidcorp-core/void-harness/issues/17
  - packages/core/skills/autonomous-backlog-loop/
  - docs/specs/2026-06-18-backlog-loop-observability.md
  - docs/specs/2026-06-18-backlog-batch-parallel.md
---

> Archive du moteur backlog-loop retiré au cutover du 24 septembre 2026.
> Ce document conserve la décision et ses preuves historiques, pas une procédure active.
> Le script secondaire `block-protected-push` et son override `AUTO_MERGE` ont été retirés.
> Le contrat courant est `docs/specs/2026-09-22-autopilot-native-loop.md` et ses ADR.


## Problème

Issue #17, **Cluster A** : quatre runs réels de `autonomous-backlog-loop` (projet
consommateur `sesame`) ont tous heurté des gates git/allowlist conçus pour le happy-path.

- **A1 (sécurité)** — `git checkout -b <b> origin/main` règle l'upstream sur `origin/main` ;
  avec `push.default=upstream`, un `git push` (même `-u origin <b>`) vise `main`, contournant
  silencieusement la promesse `AUTO_MERGE=0`. Observé : clobber de `main`. La récupération
  exigeait un force-push (interdit) → escalade humaine dans un run « non surveillé ».
- **A2** — les workers partagent un seul working tree ; HEAD est process-global, donc des
  workers concurrents (ou des runs qui se chevauchent) interleavent leurs commits et
  corrompent l'historique.
- **A3** — `source-driven-development` (« lire les docs officielles avant d'écrire la config »)
  est insatisfiable sous le profil deny-by-default qui denie `WebFetch`/`curl`/egress.
- **A4** — toutes les ops git d'historique (`rebase`, `cherry-pick`, `merge`, `format-patch`)
  sont deniées ; un commit mal basé n'avait aucun chemin sanctionné pour être rejoué.

Racine commune : `AUTONOMOUS_SETTINGS` et les étapes git du worker ont été conçus contre le
happy-path. (Le merge PR #16 a déjà étendu cette surface pour le MCP Linear ; on continue.)

## Objectif

Durcir les gates pour que le loop tienne en conditions réelles : impossible de clobber une
branche protégée, isolation filesystem par ticket, `source-driven` redevenu satisfiable
hors-ligne, et un sous-ensemble git non-destructif sanctionné — **sans** affaiblir le
deny-by-default ni ouvrir l'egress d'un agent non surveillé.

## Décisions cadrées (brainstorming)

- **A1** : defense-in-depth — prompt (`git switch -c` + push refspec explicite) **+**
  allowlist (`push.default current` posé par l'orchestrateur au setup) **+** un **hook
  pre-push** qui bloque tout push résolvant vers une branche protégée sauf `AUTO_MERGE=1`.
- **A2** : **worktree par ticket, par défaut** — l'orchestrateur isole chaque worker dans
  son propre worktree ; converge avec `backlog-batch`.
- **A3** : **branche offline** dans `source-driven-development`, **sans** élargir l'egress.
- **A4** : **sous-ensemble non-destructif étroit** ajouté à l'allowlist ; le destructif
  (`reset --hard`, force-push, réécriture de refs partagées) reste denié.

Synergie : une branche créée par `git worktree add -b` **n'a pas d'upstream**, donc
`push.default=upstream` n'a plus `main` à viser — A2 désamorce structurellement A1 ; les
autres couches restent (defense-in-depth).

## Architecture

Quatre changements coordonnés sur `autonomous-backlog-loop`, autour de la racine commune :
`AUTONOMOUS_SETTINGS` (`packages/cli/src/lib/backlog/prompt.ts`), le prompt worker
(`renderPrompt`), l'orchestrateur (`backlog-loop.ts` / `orchestrator.ts`), un **nouveau hook
pre-push** (`packages/core/hooks/block-protected-push.sh`), et la skill
`source-driven-development`.

## Composants

### A1 — pas de clobber de branche protégée

- **Worker prompt** : créer la branche avec `git switch -c <prefix><ticket>` (jamais
  `git checkout -b … origin/main`) ; pousser avec un **refspec explicite**
  `git push -u origin HEAD:refs/heads/<prefix><ticket>`.
- **Orchestrateur** : après `git worktree add`, poser `git -C <wt> config push.default current`
  (ceinture).
- **Hook `block-protected-push.sh`** (PreToolUse, matcher Bash) : lit le tool-call JSON sur
  stdin ; si la commande est `git push` ET sa cible résolue est protégée (`main`/`master` —
  via refspec explicite `…:main`, OU push nu dont l'upstream est `origin/main`), bloque
  (exit 2) sauf si `AUTO_MERGE=1`. Précis : un push de feature-branch n'est jamais bloqué.
  ≤ 100 lignes, shell.
  **Câblage** : fichier réel `packages/core/hooks/block-protected-push.sh` (source de vérité,
  testé + linté par anti-bloat « shell syntax: all hooks »). Bundlé dans `core-assets/hooks/`
  par le `prepack` existant. L'orchestrateur écrit, dans le settings du run, une entrée
  `hooks.PreToolUse` (matcher Bash) dont la commande est le **chemin absolu** du hook résolu
  depuis les assets bundlés du CLI (`<cli>/core-assets/hooks/block-protected-push.sh`) —
  résolvable en install linkée comme en npm. Pas d'embedding string, pas de path fragile.

### A2 — isolation filesystem par ticket

- **Orchestrateur** : par itération, `git worktree add <runDir>/wt/<n>` (branche temp sans
  upstream), spawn `claude -p` avec **cwd = le worktree**. Le worker fait
  `git switch -c <prefix><ticket>` **dans** le worktree (l'id reste choisi par le worker via
  MCP). `git worktree remove` après ; la branche WIP d'un ticket bloqué **survit** (la ref
  persiste après le remove). HEAD du repo principal n'est jamais touché.

### A3 — `source-driven-development` satisfiable hors-ligne

- **SKILL.md** : section « Offline / no-network » — quand l'egress est denié : isoler l'appel
  externe derrière un **port injecté**, **Zod-valider** le contrat mirroré au bord (un écart
  de schéma est surfacé, jamais un `undefined` silencieux), et enregistrer une **source debt**
  (note de commit + ADR + corps de PR + label `source-debt` pour qu'un humain confirme le
  schéma contre la doc live). Aucun élargissement d'egress.

### A4 — sous-ensemble git non-destructif

- **`AUTONOMOUS_SETTINGS.allow`** += `Bash(git cherry-pick:*)`, `Bash(git rebase --onto:*)`,
  `Bash(git merge --no-ff:*)`, `Bash(git format-patch:*)`, `Bash(git apply:*)`.
- **`deny`** garde `reset --hard`, `push --force`/`-f` ; pas de réécriture de refs partagées.

## Flux (chemin worker durci)

```
orchestrateur (TS, confiance):
  git worktree add .void/autonomous-runs/wt/<n>          # branche sans upstream
  git -C <wt> config push.default current                # ceinture
  claude -p  (cwd = <wt>, --settings AUTONOMOUS_SETTINGS)
    worker: git switch -c <prefix><ticket>               # dans le worktree
            … tdd … commit …
            git push -u origin HEAD:refs/heads/<prefix><ticket>   # refspec explicite
              └─ hook block-protected-push: cible == main ? AUTO_MERGE!=1 → BLOCK
            gh pr create
  git worktree remove <wt>      # branche WIP préservée si le ticket a bloqué
```

## Gestion d'erreurs

- Hook pre-push **précis** : ne bloque que les cibles protégées ; un faux positif est un
  appel bloqué (récupérable), jamais un clobber silencieux. Ne lit jamais la config pour
  l'écrire ; se contente d'inspecter la commande + l'upstream courant.
- Échec `git worktree add` → l'orchestrateur die avec un message clair.
- Ticket bloqué : la branche WIP survit au `worktree remove` (ref committée).
- Le floor sécurité (deny-by-default + hooks `protect-sensitive-files`/`block-dangerous-bash`)
  reste intact ; les ajouts allow sont non-destructifs et le nouveau hook *resserre*.

## Approche de test (modes TDD)

- **`block-protected-push.sh`** → **souple** : test shell — stdin JSON `git push` vers `main`
  (nu avec upstream main, et refspec `…:main`) → exit 2 ; push de feature-branch → exit 0 ;
  `AUTO_MERGE=1` → exit 0.
- **Worktree dans l'orchestrateur** → **souple** : étendre le test faux-claude — cwd passé =
  un worktree, branche isolée, HEAD du repo principal intact, worktree nettoyé.
- **`AUTONOMOUS_SETTINGS`** → **strict** : assertions sur les nouvelles entrées allow + le
  destructif toujours denié (garde-fou de régression).
- Prompt worker (`renderPrompt`) → **souple** : assert que le prompt instruit `git switch -c`
  + le push refspec explicite.
- `source-driven-development` SKILL.md → doc (anti-bloat ≤ 400, audit note).

## Phases (→ plan)

1. Hook `block-protected-push.sh` + test (cœur sécurité A1).
2. Worktree dans l'orchestrateur + test faux-claude (A2).
3. `AUTONOMOUS_SETTINGS` : sous-ensemble git non-destructif + `push.default current` au setup
   + assertions (A4 + A1).
4. Prompt worker : `git switch -c` + push refspec explicite + assertion (A1).
5. `source-driven-development` : branche offline + label `source-debt` + audit note (A3).
6. Docs/sync : entrée `DECISIONS.md`, `CLAUDE.md`/`AGENTS.md` si une convention change,
   core-assets régénéré, commentaire de clôture partielle sur l'issue #17 (A1-A4 traités).

## Frontière & non-régression

- Le hook `block-protected-push.sh` est **opt-in pour le loop** (chargé via les settings du
  run), pas un hook du plugin core par défaut — il ne gêne pas les sessions interactives
  normales.
- Branchements existants inchangés : facturation abonnement, flux live, résumé, MCP Linear
  via `.mcp.json`.

## Hors scope (YAGNI)

- Pas d'allowlist WebFetch / egress (A3 décision : offline-only).
- Pas de `reset --hard` / force-push / réécriture de refs partagées (restent deniés).
- Pas de portage worktree vers `backlog-batch` (il l'a déjà) ni de refactor commun loop/batch
  du code worktree (extraction prématurée — à revisiter si un 3e usage apparaît).
- Cluster B et Cluster C de l'issue #17 : specs séparés, plus tard (un cluster à la fois).
