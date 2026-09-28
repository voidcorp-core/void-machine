---
title: 4.1.0 - délégation supervisée et merge autonome sans infrastructure
date: 2026-09-28
status: in-progress
spec: docs/specs/2026-09-28-supervised-agent-delegation.md
specs:
  - docs/specs/2026-09-28-supervised-agent-delegation.md
  - docs/specs/2026-09-28-autopilot-merge-without-consumer-setup.md
ticket: DEV-902, DEV-920
author: Folpe + Claude
high_risk: true
---

# 4.1.0 : délégation supervisée et merge autonome

## Goal

Livrer dans la 4.1.0 deux capacités liées. D'abord un socle unique de délégation : le noyau
lance des agents Claude ou Codex, les suit, relaie leurs questions et collecte leurs résultats,
et un multiplexeur (herdr, tmux, cmux) n'en est qu'une vue. Ensuite une boucle autopilot qui
merge seule dans la branche d'intégration d'un projet consommateur, sans App GitHub ni autre
préparation, grâce à un relecteur indépendant que ce socle lance. `high_risk: true` parce que le
plan déplace l'autorité de merge.

## Conventions communes

- Vérifications : `pnpm typecheck && pnpm lint && pnpm test:fast`, puis `pnpm test` avant chaque
  PR ; `pnpm derive:check`, `pnpm skills:check-references`, `pnpm decisions:check` et
  `pnpm sync:docs` dès qu'un skill, une décision ou `CLAUDE.md`/`AGENTS.md` change.
- Hooks : scripts sous `packages/core/hooks/`, câblés par sous-commande de `_void-hook.mjs` dans
  `packages/core/.claude-plugin/plugin.json` et `packages/core/codex/hooks.json` ; 100 lignes
  au plus ; parité Codex testée par `packages/core/hooks/codex-parity-hooks.test.ts`.
- Noyau : `packages/void-machine/src/{core,runtime,adapters,application}` ; `core` reste pur
  (`packages/void-machine/test/pure-layer-types.test.ts`, `layer-boundaries.test.ts`).
- Sorties réelles capturées pour les tests de conformité : sous
  `packages/void-machine/test/fixtures/`, jamais inventées.
- Une unité = une PR vers `develop`, auto-merge armée à l'ouverture sauf chemins protégés.

## Steps

### Step 1 - `mergeGate: human` n'attend plus aucun check de revue

- **Goal**: une PR en merge humain passe à l'humain dès que ses checks ne sont plus en échec, sans
  attendre `independent-review`.
- **Depends on**: none
- **TDD mode**: strict
- **Verification gate**: `pnpm test:fast` avec, dans `packages/cli/src/lib/autopilot/loop.test.ts`,
  les cas « `mergeGate: human`, revue absente » et « revue en attente » qui rendent
  `human-merge-gate` ; les cas `union-reviewed` inchangés.
- **Expected commits**:
  - `test(autopilot): a human merge gate never waits on the review check`
  - `fix(autopilot): hand a human-gated pull request over without the review check`
- **Notes**: dans `openPullOutcome` (`loop.ts:767`), évaluer le merge humain avant la ligne 797.
  Publiable seul.

### Step 2 - Deux décisions structurantes

- **Goal**: enregistrer (a) la livraison de la capacité de délégation du noyau dans le CLI
  publié, en remplacement ciblé de la clause « ni release » du 19 septembre ; (b) le mode de merge
  unique, en remplacement de `03e82acc`, avec le risque résiduel écrit tel quel.
- **Depends on**: none
- **TDD mode**: exploratory (documentation)
- **Verification gate**: `pnpm decisions:check` vert ; chaque ADR cite sa spec et l'ADR qu'elle
  remplace.
- **Expected commits**:
  - `docs(decisions): ship the kernel's delegation capability in the published CLI`
  - `docs(decisions): merge autonomously on a local verdict bound to the head SHA`
- **Notes**: créer par `void-machine decisions new` ; ne jamais modifier une ADR acceptée.

### Step 3 - Socle de délégation, adaptateur Claude, présentation `none` (MVP)

- **Goal**: `void-machine agents dispatch|wait|status|send|accept|stop|attach` fait tourner un
  agent Claude de bout en bout, sans multiplexeur, et le coordinateur récupère son résultat.
- **Depends on**: step-2
- **TDD mode**: strict (core, analyse, construction de commandes) ; souple (câblage CLI)
- **Verification gate**: `pnpm test` ; tests purs de la machine d'états (toutes les transitions
  de la spec, dont `reconciling` et `waiting-human`) ; test de conformité avec un exécutable
  `claude` factice qui rejoue des sorties réelles capturées de `claude --bg` et
  `claude agents --json --all` ; preuve manuelle : `dispatch` d'un relecteur
  `independent-code-reviewer` dans ce dépôt, `wait`, résultat lu, `accept`, session arrêtée.
- **Expected commits**:
  - `test(void-machine): specify the delegated run lifecycle`
  - `feat(void-machine): admit, track and reconcile delegated agent runs`
  - `test(void-machine): replay the Claude background session contract`
  - `feat(void-machine): run delegated agents as Claude background sessions`
  - `feat(hooks): record a delegated run's final message on Stop`
  - `feat(cli): expose agents dispatch, wait, status, send, accept, stop and attach`
- **Notes**:
  - Fichiers : `src/core/delegation.ts` (types, transitions, pur), `src/runtime/delegation.ts`
    (driver : relevé borné toutes les 5 s, une observation en cours par mission),
    `src/adapters/runtime/claude-session.ts`, `src/application/agents.ts`,
    `packages/cli/src/commands/agents.ts` et le routage dans `packages/cli/src/main.ts`.
  - Dépendance `@voidcorp/void-machine` ajoutée à `packages/cli`, embarquée par `tsup` comme
    `mission-engine`.
  - Hook Stop `delegation-result` : n'agit que si `VOID_MACHINE_RUN_ID` est présent ; écrit
    `session_id` et `last_assistant_message` dans le dossier du run ; aucune décision.
  - Rôles : `work` donne `--permission-mode auto`, `review` donne `--agent <type>` et
    `--permission-mode dontAsk`.
  - Registre : liens et transitions acceptées dans `.void/machine/runs/<mission-id>/` ; l'état
    vivant vient toujours de `claude agents --json`.
  - Preuve à faire ici : démarrage dans une worktree neuve, jamais ouverte, sans dialogue de
    confiance ; sinon, erreur explicite avec la commande qui répare.

### Checkpoint A - après Step 3

Le socle tourne de bout en bout sans affichage. Lancer `void-verify`, montrer à Folpe une
délégation réelle (dispatch, wait, résultat). Attendre son signal.

### Step 4 - Verdict local lié au SHA, relecteur délégué

- **Goal**: la boucle autopilot n'attend plus de check GitHub de revue : sans verdict pour le SHA
  de tête, elle délègue un relecteur ; son verdict, enregistré localement, décide.
- **Depends on**: step-1, step-3
- **TDD mode**: strict
- **Verification gate**: `pnpm test` ; table de `loop.test.ts` : verdict absent (action
  `review`), bloquant (retour au worker), sain ; verdict d'un autre SHA ignoré ; tête déplacée ;
  un commentaire GitHub portant un bloc de verdict n'a aucun effet.
- **Expected commits**:
  - `test(autopilot): decide on a local verdict bound to the head SHA`
  - `feat(autopilot): delegate the independent review and record its verdict locally`
- **Notes**: `openPullOutcome` lit le verdict local au lieu de `pr.review`
  (`loop-observe.ts:167` ne sert plus à la décision) ; l'action `review` appelle
  `agents dispatch --role review --type independent-code-reviewer`, brief lié au SHA ; le verdict
  suit le format déjà lu par `judgments.ts`. Le commentaire publié n'est qu'une copie.

### Step 5 - Merge unique, commande `autopilot merges`, retrait de `mergeGate`

- **Goal**: merge automatique par défaut avec `gh pr merge --match-head-commit`, merge humain sur
  demande enregistré dans le programme, plus aucune clé `mergeGate` ni `trust`.
- **Depends on**: step-2, step-4
- **TDD mode**: strict
- **Verification gate**: `pnpm test` ; `program.test.ts` : programme sans clé (automatique),
  `merges: human`, ancien `mergeGate` lu avec message de migration ; branche qui déploie absente
  = branche par défaut du dépôt, jamais cible ; checks en attente = attente, en échec = retour ;
  base avec merge queue ou checks requis = chemin auto-merge existant ; `pnpm derive:check`.
- **Expected commits**:
  - `test(autopilot): merge on the reviewed head unless a person asked to merge`
  - `feat(autopilot)!: replace mergeGate with one merge mode and an explicit human hold`
  - `feat(cli): record a human merge hold with autopilot merges`
  - `docs(autopilot): describe the local verdict and the human merge hold`
- **Notes**: `packages/cli/src/lib/autopilot/program.ts`, `loop.ts`, `commands/autopilot.ts` ;
  skill `packages/core/skills/void-autopilot/SKILL.md` (sous 400 lignes) ; `.void/program.md` de
  ce dépôt migré. `BREAKING CHANGE` dans le commit. Ce dépôt garde son App de revue comme check
  requis, arbitré par GitHub.

### Step 6 - Port `Surface` et adaptateurs herdr, tmux, cmux

- **Goal**: quand un multiplexeur est détecté, chaque run délégué s'affiche dans une surface
  possédée qui exécute la commande d'affichage de son runtime.
- **Depends on**: step-3
- **TDD mode**: strict (détection, construction des commandes) ; souple (appels multiplexeur)
- **Verification gate**: `pnpm test` ; conformité par exécutables `herdr`, `tmux`, `cmux`
  factices ; preuve réelle sous herdr et Ghostty : pane ouvert, libellé, ticket en métadonnée,
  fermeture du pane sans effet sur le run.
- **Expected commits**:
  - `test(void-machine): choose the display surface from the environment`
  - `feat(void-machine): show delegated runs in herdr, tmux or cmux surfaces`
  - `refactor(presentation): replace the mission presentation script with the surface port`
- **Notes**: `src/adapters/presentation/{herdr,tmux,cmux,none}.ts` ; supprimer
  `scripts/mission-presentation.mjs` dans le même commit que son remplaçant cmux.

### Step 7 - Capture de l'outil `Agent` côté Claude

- **Goal**: une délégation native du coordinateur passe par le socle dès qu'une surface existe.
- **Depends on**: step-6
- **TDD mode**: strict
- **Verification gate**: `pnpm test` ; tests du hook : pas de surface (passe), `fork` (passe),
  appelant délégué (passe), cas nominal (refus avec `runId` et commande `wait`) ; hook sous 100
  lignes ; preuve réelle : un appel `Agent` sous herdr ouvre un pane rattaché au ticket et le
  coordinateur récupère le retour sans action humaine ; hors multiplexeur, sous-agent natif.
- **Expected commits**:
  - `test(hooks): route a coordinator's delegation through the kernel when it can be shown`
  - `feat(hooks): capture the Agent tool into a supervised run`
  - `docs: tell the coordinator to delegate through void-machine agents`
- **Notes**: consigne d'une ligne dans `CLAUDE.md` et `AGENTS.md` dans le même commit
  (`pnpm sync:docs`).

### Checkpoint B - après Step 7

Le besoin d'origine de DEV-902 est couvert. Folpe voit une délégation réelle en pane dans son
cockpit. `void-verify`, puis signal.

### Step 8 - Adaptateur Codex

- **Goal**: un run `--runtime codex` va jusqu'au résultat structuré ; ses capacités de vue et de
  capture sont déclarées selon leur preuve.
- **Depends on**: step-3
- **TDD mode**: strict (protocole) ; exploratory (sondes)
- **Verification gate**: `pnpm test` ; conformité par un `codex app-server` factice rejouant un
  flux réel capturé (`thread/start`, `turn/start` avec `outputSchema`, `turn/completed`) ; sondes
  documentées : `codex resume <thread> --remote unix://` dans un pane, refus d'un hook sur
  `spawn_agent`.
- **Expected commits**:
  - `test(void-machine): replay the Codex app-server delegation contract`
  - `feat(void-machine): run delegated agents as Codex app-server threads`
  - `feat(hooks): capture spawn_agent when the runtime honours the refusal` (seulement si prouvé)
- **Notes**: processus app-server possédé par le driver, socket dans le dossier du run ; le daemon
  partagé n'est pas utilisé. Une capacité non prouvée reste `inconnue` et `status` le dit.

### Step 9 - Appelants sur le socle

- **Goal**: autopilot (workers et relecteurs) et implement (spécialistes) lancent leurs agents par
  `agents dispatch` ; plus aucune prose conditionnelle sur le multiplexeur.
- **Depends on**: step-5, step-7, step-8
- **TDD mode**: souple
- **Verification gate**: `pnpm test` ; `pnpm skills:check-references` ; `pnpm derive:check` ;
  une mission `void-implement` réelle dont les spécialistes s'ouvrent en panes ; contrat
  d'événements de `2026-08-21-agent-dispatch-closure.md` inchangé.
- **Expected commits**:
  - `refactor(autopilot): spawn workers and reviewers through the delegation kernel`
  - `refactor(implement): dispatch specialists through the delegation kernel`
  - `docs(supervision): describe delegation as one kernel path with optional views`
- **Notes**: `void-autopilot` (« Spawning ») et `void-implement` ; `docs/NATIVE-SUPERVISION.md`
  réécrit, l'étape 4 ne dépend plus d'une décision de l'agent ; `docs/ARCHITECTURE.md` mis à jour.

### Step 10 - Preuves de livraison et 4.1.0

- **Goal**: la version publiée tient chez un consommateur réel.
- **Depends on**: step-9
- **TDD mode**: exploratory (preuves)
- **Verification gate**: `pnpm pack` puis install réelle sur une copie jetable d'un consommateur
  (init, commit, clone) ; sur ce consommateur sans App ni protection : un ticket va jusqu'au
  merge dans la branche d'intégration ; `merges: human` arrête la PR prête ; délégation visible
  sous herdr et native sans multiplexeur ; `pnpm version:check`.
- **Expected commits**: aucun code attendu ; correctifs éventuels en `fix:`.
- **Notes**: **gate humain** : promotion develop vers main et merge de la PR release-please par
  Folpe ; puis `npx voidmachine update` dans ce dépôt, puis migration DECLIK.

## Review checkpoints

- Checkpoint A après Step 3 : socle de bout en bout sans affichage.
- Checkpoint B après Step 7 : délégation visible en pane sous herdr.
- `high_risk: true` : `void-plan-review all` recommandé avant l'exécution.

## Execution handoff

| Clé | Unité | Dépend de | Estimation | Gate humain |
|---|---|---|---|---|
| 01 | `mergeGate: human` sans check de revue | - | 0,5 j | non |
| 02 | Deux ADR (livraison du noyau, merge unique) | - | 0,5 j | non |
| 03 | Socle de délégation, adaptateur Claude | 02 | 2 j | Checkpoint A |
| 04 | Verdict local lié au SHA | 01, 03 | 1,5 j | non |
| 05 | Merge unique, `autopilot merges` | 02, 04 | 1 j | non (chemins protégés : humain) |
| 06 | Port `Surface`, herdr, tmux, cmux | 03 | 1,5 j | non |
| 07 | Capture de l'outil `Agent` | 06 | 0,5 j | Checkpoint B |
| 08 | Adaptateur Codex | 03 | 1,5 j | non |
| 09 | Appelants sur le socle | 05, 07, 08 | 1 j | non |
| 10 | Preuves et 4.1.0 | 09 | 1 j | oui (promotion, release) |

Parallélisable après 03 : {04 → 05}, {06 → 07} et 08. Total estimé : environ 11 jours-agent.
`void-ticket` crée ces unités comme sous-tickets de DEV-902 et DEV-920, avec leurs relations de
blocage, puis installe le programme ; le fournisseur de progression détient ensuite l'état.
