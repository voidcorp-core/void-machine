---
title: Autopilot - plan d'implémentation sur une base saine
date: 2026-07-25
status: in-progress
spec: docs/specs/2026-07-25-autopilot.md
author: Folpe + Codex
high_risk: true
---

# Autopilot - plan d'implémentation

## Goal

Remplacer le mélange actuel de batch attended, ancien loop et auto-merge par un
bounded context `autopilot` unique. Une activation durable dans
`.void/program.md` permet aux sessions suivantes de reprendre le programme sans
nouvelle consigne. Autopilot sélectionne au plus quatre tickets Linear prêts et
indépendants, exécute le vrai `ticket-runner` dans un worktree par ticket,
conserve une plage de commits par ticket, réconcilie localement, publie une seule
PR après la suite complète et s'arrête à la fusion humaine.

Le cutover est atomique : quatre plages de tickets verticales sont développées
séquentiellement sur une branche d'intégration, puis fusionnées par une seule PR.
Le moteur historique reste intact sur la branche principale jusqu'à cette
fusion. Le plan-only, les workers et la reprise sont des checkpoints internes,
jamais des releases temporairement moins capables.

## Architecture cible

### Une seule frontière

Le code actif vit sous :

```text
packages/cli/src/lib/autopilot/     domaine déterministe + état versionné
packages/cli/src/commands/autopilot.ts
packages/core/skills/autopilot/
packages/core/commands/autopilot.md
```

`packages/cli/src/lib/backlog/` n'est pas conservé comme couche legacy. Les
algorithmes purs utiles sont déplacés, renommés et retestés dans le nouveau
bounded context. Les chemins auto-merge, headless, stream et configuration
autonome qui ne servent plus sont supprimés. Le stub
`backlog-autopilot` ne contient aucune logique métier : il retourne seulement le
code d'erreur et la commande de migration.

### Functional core, imperative shells

- Le CLI calcule, valide et persiste un état local. Il ne contacte ni Linear ni
  GitHub et ne lance aucun agent.
- Le skill L0 lit les connectors, fournit au CLI des observations bornées,
  applique les actions calculées, puis réobserve le résultat.
- Le CLI émet un `OrchestrationPlan` runtime-neutral.
- L'adapter Claude exécute ce plan avec Workflow ; l'adapter Codex utilise les
  subagents natifs. Le contrôleur crée les worktrees avant tout spawn. Les
  adapters retournent le même `WorkerResult` et ne décident ni de la sélection,
  ni du lifecycle.
- `ticket-runner` reste l'unique cycle mono-ticket.
- Le reconciler est l'unique propriétaire de la branche d'intégration, des
  conflits, des artefacts partagés, du push et de la PR.

Les frontières externes utilisent des objets observation/action validés. Il n'y
a ni conteneur de dependency injection, ni faux client Linear dans le domaine.

### Contrat CLI machine-readable

Toutes les entrées/sorties JSON portent `schemaVersion: 1`. Les commandes sont :

```text
autopilot plan   [--active .void/program.md] < CandidateObservation
autopilot start  [--active .void/program.md] < ReservationReceipt
autopilot status [--run <runId>] < RemoteObservation
autopilot resume [--run <runId>] < RemoteObservation
autopilot abort  [--run <runId>] < RemoteObservation
```

- `CandidateObservation` contient les tickets Linear hydratés, relations,
  états, commentaires et footprints.
- `ReservationReceipt` contient le plan choisi et la réobservation prouvant que
  chaque claim Linear a réussi avec le même `clusterId`.
- `RemoteObservation` contient les états Linear et GitHub explicitement lus par
  le skill L0. Le CLI ne les fabrique pas.
- chaque sortie mutante est un `ActionPlan` avec préconditions et clés
  d'idempotence ; le skill applique, réobserve, puis rappelle le CLI ;
- une erreur d'usage ou de schéma sort `2` avec problème/cause/correction ;
  un état métier bloqué reste un JSON valide typé, pas une exception.

Le chemin nominal agent est `/harness:autopilot` sans argument. Le skill hydrate
les observations et utilise le mode JSON ; le CLI rend une vue humaine par
défaut et `--json` expose le contrat stable. Sans `--run`, un lease non terminal
unique est repris. Plusieurs leases retournent `competing-runs` sans mutation.
`resume` et `abort` n'agissent jamais à partir du seul curseur local.

### Un seul modèle d'état

`.void/program.md` porte le consentement et le routage stables.
`.void/autopilot/<runId>/state.json` porte le curseur technique local. Linear,
GitHub et Git restent les sources de vérité distantes.

L'état local est versionné, validé à la lecture, écrit atomiquement et borné. Un
état legacy est préservé mais refusé avec une erreur actionnable ; il n'est pas
silencieusement converti par une heuristique.

Le marqueur Linear v1 porte `programId`, `runId`, `clusterId`, base SHA, branche
d'intégration, expiration de lease et version de protocole. Il permet au
bootstrap de retrouver un run sans repointage. La reprise garantie par ce cut
concerne le même clone : une perte de machine ne peut pas reconstituer des refs
worker jamais poussées.

Les noms Git sont fixes :

- worker local : `autopilot-worker/<clusterId>/<ticketId>` ;
- intégration distante : `autopilot/<clusterId>` ;
- worktrees :
  `.void/autopilot/<runId>/worktrees/<ticketId|reconcile>`.

Ils sont dérivés d'identifiants slug-validés, jamais d'un titre libre.

### Configuration exécutable sans shell implicite

Le bloc `autopilot` de `program.md` utilise des commandes argv :

```yaml
autopilot:
  schemaVersion: 1
  enabled: true
  clusterSize: 4
  base: auto
  mergeGate: human
  verifyCommands:
    - [pnpm, build]
    - [pnpm, test]
  ownership:
    sequential:
      - pnpm-lock.yaml
      - "**/migrations/**"
    reconcileOnly: []
```

`clusterSize` est borné à `1..4` dans le premier incrément.
`mergeGate: human` est la seule valeur acceptée. Une commande est exécutée avec
`shell:false`. Les projets peuvent déclarer des artefacts `reconcileOnly` et
leur commande de rebuild sans encoder les chemins de void-harness dans le core.

### Compatibilité avec le programme v3

La plage A attend le Checkpoint A v3 `DEV-433`. La plage B attend le
`ticket-runner` canonique et sa reprise, `DEV-441` puis `DEV-442`, fusionnés ou
exposant leur contrat final. Elle consomme aussi le contrat subagents Codex
réel ; elle ne copie ni le cycle qualité ni une API runtime supposée.

Un `.void/program.md` déjà `executing` n'est jamais remplacé. Lors du ticketing,
les unités de ce plan sont soit ajoutées explicitement au programme v3 par le
mainteneur, soit gardées en attente jusqu'à sa clôture. `ticket-writer` doit
échouer sur une collision, pas repointer le fichier.

`session-close`, déjà suivi dans DEV-442, reste un consommateur futur de l'état
et du commentaire de reprise. Il n'est pas fusionné dans Autopilot.

### Feature sœur : cheat sheet du harness

Une cheat sheet exhaustive est conservée comme feature sœur, hors du bounded
context Autopilot. Elle passe par son propre brainstorming/spec avant ticketing.
La direction recommandée est :

- `void-harness cheatsheet --format html|markdown|json`, HTML par défaut ;
- artefact statique, autonome, offline, ouvrable sans serveur ;
- recherche instantanée, filtres runtime/pack/type et commandes copiables ;
- vues « tout le catalogue », « installé/actif ici » et « je veux faire X » ;
- données dérivées de `model.json`, `certification.json`, des frontmatters et
  métadonnées CLI, jamais une deuxième liste maintenue à la main ;
- HTML accessible, imprimable et utilisable au clavier ; Markdown/JSON servent
  le terminal, les agents et les tests de parité.

Cette feature ne modifie ni l'état Autopilot ni son ordre de livraison. Son
critère architectural principal sera : aucune entrée de catalogue ne peut
diverger entre le CLI, le graph et la cheat sheet.

## Steps

### Ticket A - Fonder Autopilot et reprendre sans repointage

Cette première plage livre le domaine déterministe, l'activation, le lease
Linear et la reprise locale. Elle reste interne à la branche de cutover : aucune
surface legacy n'est supprimée et aucun changement n'est fusionné séparément.

#### A1 - Construire le planner canonique sans basculer la surface publique

- **Goal**: rendre le planner `autopilot` testable sur une frontière propre, sans
  retirer ni repointer le moteur public actuel avant le cutover final.
- **Depends on**: none
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/commands/autopilot.ts`
  - créer `packages/cli/src/commands/autopilot.test.ts`
  - créer `packages/cli/src/lib/autopilot/cluster-plan.ts`
  - créer `packages/cli/src/lib/autopilot/cluster-plan.test.ts`
  - déplacer et renommer dans `packages/cli/src/lib/autopilot/` les seules
    fonctions pures utiles de `batch-select.ts` et `batch-partition.ts`, sans
    supprimer leur source legacy dans cette plage
  - créer `packages/cli/src/lib/autopilot/review-budget.ts`
  - créer `packages/cli/src/lib/autopilot/review-budget.test.ts`
- **Behavior**:
  - `plan` accepte uniquement des tickets hydratés et des footprints validés ;
  - le résultat contient au plus un cluster de quatre tickets indépendants,
    partitionné `parallel`/`sequential`, avec raisons et exclusions ;
  - le plafond peut descendre sous quatre si footprint, faible confiance ou zone
    à risque ne permettent pas un cluster revuable ;
  - les estimations Linear sont totalisées dans la preuve de revue mais ne
    constituent pas seules un veto ;
  - une dépendance ouverte, un état non prêt ou une entrée mal formée est
    exclue avec une cause typée ;
  - aucun chemin nouveau n'accepte `--auto-merge` ;
  - `main.ts`, le help public, `backlog-autopilot` et les assets installés restent
    inchangés jusqu'à D1.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/commands/autopilot.test.ts packages/cli/src/lib/autopilot/cluster-plan.test.ts packages/cli/src/lib/autopilot/review-budget.test.ts`
  - `pnpm --filter voidharness typecheck`
  - tests couvrant vide, 1 ticket, 4 tickets, 5e exclu, bloqueur ouvert,
    overlap, faible confiance, migration, risque et budget de revue
  - test de cutover prouvant que la commande legacy reste encore la surface
    publique de cette plage
- **Expected commits**:
  - `test(autopilot): define bounded cluster planning because four is a ceiling not a quota`
  - `feat(autopilot): add the isolated planning core because cutover needs a tested destination`
- **Notes**: ce code n'est pas publié seul. Le legacy temporairement présent sur
  la branche est supprimé dans D1 avant la PR ; aucune release contient deux
  moteurs publics.

#### A2 - Installer la configuration durable du programme actif

- **Goal**: valider un seul modèle de configuration Autopilot, partagé par le
  CLI et le bootstrap des runtimes.
- **Depends on**: A1
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/active-program.ts`
  - créer `packages/cli/src/lib/autopilot/active-program.test.ts`
  - créer `packages/cli/src/lib/autopilot/errors.ts`
  - supprimer `.void/autonomous.json` du contrat et toute référence vivante
  - mettre à jour `packages/cli/src/lib/claude-md.ts` et son test de bootstrap
  - mettre à jour `packages/core/skills/ticket-writer/SKILL.md`
  - mettre à jour `packages/core/skills/writing-plans/SKILL.md`
  - mettre à jour `docs/ARCHITECTURE.md` et `docs/CONTRIBUTING.md`
- **Behavior**:
  - `active-program.ts` lit un frontmatter YAML borné et root-confined ;
  - le schéma versionné exige `status`, programme, plan, spec, tracker et bloc
    `autopilot` ;
  - `autopilot.schemaVersion` vaut `1`; une version absente ou inconnue est
    refusée avec migration actionnable ;
  - `enabled:false` est valide et interdit toute nouvelle sélection ;
  - `mergeGate` autre que `human`, `clusterSize > 4`, commande vide, chemin
    absolu ou chemin sortant du repo échoue avec problème, cause et correction ;
  - provider `linear` est supporté au premier incrément ; un autre provider est
    déclaré non supporté sans prétendre à une continuité automatique.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/active-program.test.ts`
  - fixtures : fichier absent, désactivé, Linear valide, YAML invalide, path
    escape, tableau argv invalide, cluster 0/5, merge gate non humain
  - `pnpm decisions:check`
  - `pnpm vitest run packages/cli/src/lib/claude-md.test.ts`
- **Expected commits**:
  - `test(autopilot): reject ambiguous activation because durable consent must be explicit`
  - `feat(autopilot): load the active program contract because sessions need durable authority`
- **Notes**: si le bootstrap active-program d'un autre ticket a déjà atterri,
  l'adapter à ce schéma sous tests. Ne jamais conserver deux formes de
  `program.md` ou deux règles de sélection.

#### A3 - Acquérir un lease Linear logiquement atomique

- **Goal**: calculer une reprise ou un lease de cluster sans double claim et sans
  promettre une transaction multi-issue que Linear ne garantit pas.
- **Depends on**: A2
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/tracker-observation.ts`
  - créer `packages/cli/src/lib/autopilot/cluster-reservation.ts`
  - créer `packages/cli/src/lib/autopilot/cluster-reservation.test.ts`
  - créer `packages/cli/src/lib/autopilot/linear-marker.ts`
  - créer `packages/cli/src/lib/autopilot/linear-marker.test.ts`
  - créer `packages/cli/src/lib/autopilot/base-selection.ts`
  - créer `packages/cli/src/lib/autopilot/base-selection.test.ts`
  - créer `packages/cli/src/lib/autopilot/branch-protection.ts`
  - créer `packages/cli/src/lib/autopilot/branch-protection.test.ts`
- **Behavior**:
  - l'entrée est une observation complète des issues, états, assignees,
    relations et commentaires machine-readable ;
  - exactement un lease en cours retourne `resume` ;
  - plusieurs tickets en cours sont valides seulement avec le même
    `clusterId` et le même programme ;
  - des claims concurrents incompatibles retournent `competing-claims` sans
    action ;
  - sinon le planner retourne `ReservationIntent`, puis une liste ordonnée
    d'actions Linear : re-fetch, transition, assignation, commentaire de lease ;
  - chaque action porte une précondition sur l'état observé ;
  - après application, toutes les issues sont réobservées avant `active` ;
  - une application partielle, une erreur GraphQL partielle, `RATELIMITED`, un
    timeout ou un résultat inconnu produisent reprise/compensation explicite ;
  - le marqueur commentaire est borné, versionné, sans secret, et contient
    `programId`, `runId`, `clusterId`, base SHA, branche et expiration ;
  - `base:auto` choisit `develop` s'il existe, sinon `main` ; une base explicite
    doit exister ;
  - le base SHA est résolu avant claim et une protection absente ou inconnue
    bloque le démarrage avant tout worker.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/cluster-reservation.test.ts packages/cli/src/lib/autopilot/linear-marker.test.ts packages/cli/src/lib/autopilot/base-selection.test.ts packages/cli/src/lib/autopilot/branch-protection.test.ts`
  - mutation score manuel ou Stryker >= 90 % sur les branches de réservation
  - cas : aucune issue, reprise, lease frais, lease concurrent, write partiel,
    GraphQL partiel, rate limit, timeout avant/après write, retry idempotent,
    commentaire malformé, ticket sorti du scope,
    develop/default/explicite et protection unknown/unprotected/protected
- **Expected commits**:
  - `test(autopilot): model lease races because Linear offers no multi-issue transaction`
  - `feat(autopilot): plan a reobserved lease because workers need converged ownership`
- **Notes**: le CLI retourne des actions ; le skill Linear les applique puis
  réobserve toutes les issues avant de considérer le lease acquis. Aucun polling
  par ticket en boucle.

#### A4 - Persister l'état et reprendre sans `runId` manuel

- **Goal**: rendre `start`, `status`, `resume` et `abort` déterministes,
  idempotents et honnêtes avant tout fan-out.
- **Depends on**: A3
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/run-state.ts`
  - créer `packages/cli/src/lib/autopilot/run-state.test.ts`
  - créer `packages/cli/src/lib/autopilot/state-store.ts`
  - créer `packages/cli/src/lib/autopilot/state-store.test.ts`
  - créer `packages/cli/src/lib/autopilot/transition-oracle.ts`
  - créer `packages/cli/src/lib/autopilot/transition-oracle.test.ts`
  - étendre `packages/cli/src/commands/autopilot.ts`
  - étendre `packages/cli/src/commands/autopilot.test.ts`
- **Behavior**:
  - l'état v1 contient `runId`, `clusterId`, programme, base + base SHA,
    tickets, worker commit ranges/proofs, intégration, PR et synchro tracker ;
  - chaque collection et chaîne est bornée par schéma ;
  - le store utilise temp + fsync + rename et permissions utilisateur ;
  - `start` écrit seulement après preuve de réservation réobservée ;
  - `status` est read-only et distingue local, remote-required, waiting-merge,
    tracker-reconciliation, blocked et complete ;
  - sans `--run`, un lease non terminal cohérent est repris ; zéro lease permet
    une nouvelle sélection, plusieurs retournent `competing-runs` ;
  - `resume` retourne la prochaine action sûre, sans l'exécuter deux fois ;
  - `abort` produit le plan de libération et préserve branches/commits ;
  - un état legacy, tronqué, symlinké ou hors root échoue fermé et reste intact ;
  - un curseur absent est reconstruit uniquement depuis marqueurs et refs
    prouvés ; une ref worker absente ne devient jamais un succès ;
  - l'oracle distingue nil, vide, erreur amont, résultat partiel et contradiction
    pour chaque frontière, avec une unique prochaine action autorisée.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/run-state.test.ts packages/cli/src/lib/autopilot/state-store.test.ts packages/cli/src/lib/autopilot/transition-oracle.test.ts packages/cli/src/commands/autopilot.test.ts`
  - fault injection avant write, avant fsync, avant rename, disque plein et
    interruption après action distante
  - `pnpm --filter voidharness typecheck`
  - smoke dans un dépôt temporaire avec chemin contenant des espaces
- **Expected commits**:
  - `test(autopilot): reproduce torn and stale run state because resume must fail closed`
  - `feat(autopilot): persist one versioned run state because sessions need idempotent recovery`
  - `feat(cli): expose autopilot operator commands because recovery must be observable`
- **Notes**: la garantie de recovery couvre crash, compaction et nouvelle session
  dans le même clone. Une perte de machine avec branches locales non poussées est
  explicitement hors contrat. L'absence de PR ne signifie jamais « merged ».

#### Gate A - Foundation interne de Ticket A

Vérifier le bounded context, le schéma `program.md`, le lease simulé et la reprise
zéro-argument avant le fan-out. Lancer
`harness:verification-before-completion`. Le moteur historique est encore
intact ; Ticket A n'est ni poussé ni fusionné séparément.

### Ticket B - Exécuter `ticket-runner` sur Claude et Codex

Cette plage consomme le contrat canonique du programme v3. Elle ajoute le même
fan-out worktree sur les deux runtimes sans dupliquer le cycle mono-ticket.

#### B1 - Définir le worker comme exécution canonique de `ticket-runner`

- **Goal**: produire un résultat worker vérifiable sans dupliquer une seule
  passe de `ticket-runner`.
- **Depends on**: Ticket A, `DEV-441`, `DEV-442`
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/worker-result.ts`
  - créer `packages/cli/src/lib/autopilot/worker-result.test.ts`
  - créer `packages/cli/src/lib/autopilot/orchestration-plan.ts`
  - créer `packages/cli/src/lib/autopilot/orchestration-plan.test.ts`
  - mettre à jour `packages/core/skills/ticket-runner/SKILL.md`
  - mettre à jour `packages/core/skills/autopilot/SKILL.md`
  - mettre à jour leurs `.source` et audits
  - créer `test/autopilot/autopilot-skill.test.ts`
- **Behavior**:
  - le worker re-fetch le ticket Linear complet au démarrage ;
  - il exécute le vrai `ticket-runner` avec le plan/spec global en contexte ;
  - il lance les gates ciblés du ticket, pas la suite complète du cluster ;
  - il peut appliquer une migration uniquement en dev/local et les tickets de
    migration sont routés séquentiellement ;
  - il crée une plage de 1..N commits avec `baseSha`, `headSha` et liste ordonnée
    des commits ;
  - il retourne fichiers, preuves hashées, décisions et statut
    `completed|blocked` ;
  - il ne push pas, n'ouvre pas de PR, ne merge pas et ne passe pas le ticket en
    review/done ;
  - les décisions suivent ticket, plan/spec, ADR/doctrine, conventions puis
    solution sûre/réversible/simple.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/worker-result.test.ts packages/cli/src/lib/autopilot/orchestration-plan.test.ts test/autopilot/autopilot-skill.test.ts`
  - le test skill prouve la délégation à `ticket-runner`, l'absence de cycle
    qualité copié et l'interdiction push/PR/merge
  - `pnpm anti-bloat:check`
  - `packages/core/skills/autopilot/SKILL.md <= 400` lignes et description
    `<= 200` caractères
- **Expected commits**:
  - `test(autopilot): define worker commit-range evidence because reconciliation needs exact provenance`
  - `feat(autopilot): delegate workers to ticket-runner because ticket quality must have one owner`
- **Notes**: les modifications déjà préparées sur le lifecycle tracker de
  `ticket-runner` sont reprises si elles sont encore pertinentes, puis
  consolidées dans un seul contrat final.

#### B2 - Exécuter le même plan dans les adapters Claude et Codex

- **Goal**: fan-out parallèle ou séquentiel selon le plan, avec succès partiel et
  aucun effet distant des workers.
- **Depends on**: A4, B1
- **TDD mode**: souple
- **Files**:
  - implémenter
    `packages/core/skills/autopilot/workflows/autopilot.workflow.js`
  - créer les instructions runtime minces sous
    `packages/core/skills/autopilot/references/`
  - créer `test/autopilot/autopilot-workflow.test.ts`
  - créer `test/autopilot/autopilot-codex-subagents.test.ts`
  - créer `packages/cli/src/lib/autopilot/worker-order.ts`
  - créer `packages/cli/src/lib/autopilot/worker-order.test.ts`
  - créer `packages/cli/src/lib/autopilot/worktree-lifecycle.ts`
  - créer `packages/cli/src/lib/autopilot/worktree-lifecycle.test.ts`
  - créer `packages/cli/src/lib/autopilot/partial-success.ts`
  - créer `packages/cli/src/lib/autopilot/partial-success.test.ts`
- **Behavior**:
  - un capability preflight vérifie runtime, connector, permissions, base
    protégée et worktrees avant tout lease ;
  - le contrôleur crée un worktree et une branche par ticket avant tout spawn, y
    compris en séquentiel ;
  - Claude utilise Workflow ; Codex utilise les subagents natifs activés par le
    skill ou `AGENTS.md` ;
  - chaque adapter reçoit le même `OrchestrationPlan`, le même prompt
    `ticket-runner` et retourne le même `WorkerResult` ;
  - largeur parallèle bornée par `clusterSize` ;
  - overlap, faible confiance, lockfile, migration et ownership partagé passent
    en séquentiel ;
  - chaque sortie est validée avant d'entrer dans l'état ;
  - un worker rouge et ses dépendants sont exclus, branches préservées ;
  - les workers verts indépendants continuent ;
  - aucun worker n'obtient une commande de push, PR ou merge.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/worker-order.test.ts packages/cli/src/lib/autopilot/worktree-lifecycle.test.ts packages/cli/src/lib/autopilot/partial-success.test.ts test/autopilot/autopilot-workflow.test.ts test/autopilot/autopilot-codex-subagents.test.ts`
  - le harness `node:vm` injecte de faux `agent`, `parallel`, `phase` et `log`
    dans le vrai workflow
  - fixtures identiques Claude/Codex : 4 parallèles, 2+2 séquentiels, migration,
    résultat invalide, worker rouge, aucun vert, ordre stable et concurrency cap
  - `node --check packages/core/skills/autopilot/workflows/autopilot.workflow.js`
- **Expected commits**:
  - `test(autopilot): simulate worktree fan-out because workflow behavior must be executable`
  - `feat(autopilot): run one bounded ticket cluster because parallelism must stay isolated`
- **Notes**: l'adapter retourne les résultats ; le skill L0 est le seul à
  persister l'état et à commenter Linear. Adapter absent retourne
  `unsupported-runtime` avant toute mutation distante.

### Ticket C - Réconcilier, publier et tenir Linear jusqu'au merge

Cette plage possède la branche d'intégration, les preuves locales, la PR, les
checks et le lifecycle tracker. Les workers restent commit-only.

#### C1 - Réconcilier les plages de commits sur une branche propre

- **Goal**: intégrer exactement les commits verts, résoudre les conflits et
  reconstruire les artefacts partagés avant toute publication.
- **Depends on**: Ticket B
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/reconcile-plan.ts`
  - créer `packages/cli/src/lib/autopilot/reconcile-plan.test.ts`
  - créer `packages/cli/src/lib/autopilot/git-observation.ts`
  - créer `packages/cli/src/lib/autopilot/git-observation.test.ts`
  - créer `packages/cli/src/lib/autopilot/git-run.ts`
  - étendre le prompt reconciler du vrai workflow
- **Behavior**:
  - vérifier que chaque `baseSha..headSha` est une plage linéaire, bornée et
    issue de la base déclarée ;
  - créer `autopilot/<clusterId>` depuis le base SHA prouvé ;
  - intégrer les plages en ordre déterministe sans absorber de commit étranger ;
  - résoudre un conflit selon le modèle d'autorité et journaliser le choix ;
  - rejouer toute preuve invalidée par les fichiers ou le SHA ;
  - retirer des workers les artefacts `reconcileOnly`, les reconstruire une
    seule fois et committer le résultat sur la branche d'intégration ;
  - un conflit non résoluble sans nouvelle autorité exclut le ticket concerné
    si le reste reste cohérent, sinon bloque la réconciliation.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/reconcile-plan.test.ts packages/cli/src/lib/autopilot/git-observation.test.ts`
  - tests d'intégration sur dépôt Git éphémère : deux plages disjointes, conflit
    résolu, commit étranger refusé, base avancée, artefact rebuild unique et
    succès partiel
  - aucun test ne dépend de snapshots d'argv comme unique preuve
- **Expected commits**:
  - `test(autopilot): exercise commit-range reconciliation because clean merges can hide foreign history`
  - `feat(autopilot): reconcile exact ticket ranges because one PR must retain per-ticket provenance`
- **Notes**: la résolution ordinaire de conflit appartient à Autopilot. Elle ne
  devient un gate humain que si elle exige une expansion de scope, une baisse de
  sécurité ou une action de production irréversible.

#### C2 - Prouver la suite locale et budgéter les triggers CI

- **Goal**: interdire le premier push tant que la suite miroir CI n'est pas verte
  et expliquer si une seule exécution distante est réellement garantie.
- **Depends on**: C1
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/verification-plan.ts`
  - créer `packages/cli/src/lib/autopilot/verification-plan.test.ts`
  - créer `packages/cli/src/lib/autopilot/ci-trigger-plan.ts`
  - créer `packages/cli/src/lib/autopilot/ci-trigger-plan.test.ts`
  - créer `packages/cli/src/lib/autopilot/proof-invalidation.ts`
  - créer `packages/cli/src/lib/autopilot/proof-invalidation.test.ts`
- **Behavior**:
  - exécuter chaque argv avec `shell:false`, timeout et sortie bornés ;
  - lier chaque preuve à l'intégration SHA, au diff hash et aux commandes ;
  - invalider une preuve sur rebase ou modification d'une dépendance déclarée ;
  - parser les workflows GitHub bornés et classer `pull-request-only`,
    `push-only`, `redundant`, `manual` ou `unknown` ;
  - pour `redundant|unknown`, ne jamais désactiver un required check : signaler
    que la garantie d'un run n'est pas disponible ;
  - refuser toute publication si une commande locale est rouge ou stale.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/verification-plan.test.ts packages/cli/src/lib/autopilot/ci-trigger-plan.test.ts packages/cli/src/lib/autopilot/proof-invalidation.test.ts`
  - fixtures CI : `pull_request`, `push`, les deux, `workflow_call`, YAML invalide,
    ancre YAML et expression non interprétable
  - test process réel : argv avec espaces, timeout, sortie volumineuse et aucun
    shell expansion
- **Expected commits**:
  - `test(autopilot): model CI trigger budgets because one remote run cannot be assumed`
  - `feat(autopilot): seal local verification because publication must start from a green integration SHA`
- **Notes**: lire la documentation GitHub Actions officielle avant
  d'implémenter le parseur et consigner les syntaxes volontairement classées
  `unknown`.

#### C3 - Publier une seule branche et conduire la PR jusqu'à ready

- **Goal**: pousser uniquement la branche d'intégration, créer une PR et corriger
  les checks sans armer de merge.
- **Depends on**: C2
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/publish-plan.ts`
  - créer `packages/cli/src/lib/autopilot/publish-plan.test.ts`
  - créer `packages/cli/src/lib/autopilot/pr-body.ts`
  - créer `packages/cli/src/lib/autopilot/pr-body.test.ts`
  - mettre à jour `packages/core/skills/autopilot/SKILL.md`
  - mettre à jour
    `packages/core/skills/autopilot/workflows/autopilot.workflow.js`
- **Behavior**:
  - un refspec explicite non-force publie uniquement
    `autopilot/<clusterId>` ;
  - aucune branche worker n'est poussée ;
  - une seule PR cible la base configurée ;
  - le corps liste tickets inclus/exclus, plages de commits, décisions,
    vérifications locales, budget CI et blockers ;
  - le skill observe les checks, diagnostique et corrige les échecs qui lui
    appartiennent, puis repousse la même branche ;
  - après PR ouverte et inclusion prouvée, les tickets concernés passent
    `In Review` avec lien PR et plage de commits ;
  - une correction distante peut déclencher un run supplémentaire, comptabilisé
    honnêtement ;
  - aucun chemin n'appelle `gh pr merge`, `--auto` ou une API de merge.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/publish-plan.test.ts packages/cli/src/lib/autopilot/pr-body.test.ts test/autopilot/autopilot-workflow.test.ts`
  - faux runner `git`/`gh` : push échoué donc pas de PR, PR déjà existante,
    retry idempotent, check pending, check rouge corrigé, check rouge externe
  - test de source interdisant `pr merge`, `--auto-merge` et push d'une branche
    worker dans le code actif
- **Expected commits**:
  - `test(autopilot): constrain integration publication because worker branches must stay local`
  - `feat(autopilot): publish one reconciliation PR because CI cost belongs at the cluster boundary`
- **Notes**: la PR reste ouverte en `ready for merge`. La fusion est hors des
  actions autorisées, même si GitHub indique `MERGEABLE`.

#### C4 - Réconcilier GitHub, Linear et la fusion humaine

- **Goal**: reprendre après crash ou nouvelle session, puis clôturer les tickets
  uniquement sur preuve de fusion.
- **Depends on**: C3
- **TDD mode**: strict
- **Files**:
  - créer `packages/cli/src/lib/autopilot/remote-recovery.ts`
  - créer `packages/cli/src/lib/autopilot/remote-recovery.test.ts`
  - créer `packages/cli/src/lib/autopilot/tracker-lifecycle.ts`
  - créer `packages/cli/src/lib/autopilot/tracker-lifecycle.test.ts`
  - étendre `packages/cli/src/commands/autopilot.ts`
  - étendre `packages/cli/src/commands/autopilot.test.ts`
  - finaliser les sections reprise/merge de
    `packages/core/skills/autopilot/SKILL.md`
- **Behavior**:
  - l'observation GitHub distingue explicitement OPEN, CLOSED et MERGED, avec
    head SHA, base, checks et merge SHA ;
  - une PR absente ou fermée non mergée ne devient jamais `merged` ;
  - base drift invalide les preuves et déclenche rebase, réconciliation et suite
    complète avant une nouvelle publication ;
  - après MERGED + checks requis verts, les tickets inclus passent Done avec le
    lien PR ; les exclus gardent leur statut et cause ;
  - PR fermée sans merge ne passe jamais Done et retourne reprise ou blocage ;
  - write Linear partielle garde `tracker-reconciliation` ;
  - pour un checkpoint, la fusion de la PR vaut approbation et aucune seconde
    gate Linear n'est créée ;
  - `abort` libère les leases Linear applicables, commente la reprise et préserve
    les branches ;
  - le cleanup refuse tout worktree sale, commit non intégré ou branche non
    archivée ; aucune suppression forcée ;
  - toutes les actions externes ont une clé d'idempotence dérivée du run et sont
    réobservées avant validation.
- **Verification gate**:
  - `pnpm vitest run packages/cli/src/lib/autopilot/remote-recovery.test.ts packages/cli/src/lib/autopilot/tracker-lifecycle.test.ts packages/cli/src/commands/autopilot.test.ts`
  - table exhaustive : PR open/pending/green/red/cancelled, closed, merged,
    missing, head divergent, base avancée, Linear write partiel, retry, ticket
    exclu, worktree sale et ref absente
  - `pnpm --filter voidharness typecheck`
- **Expected commits**:
  - `test(autopilot): reject inferred merges because remote absence is not completion proof`
  - `feat(autopilot): reconcile remote and tracker state because session resume must be idempotent`
- **Notes**: après clôture du cluster, le multi-cluster peut sélectionner le
  suivant dans une phase ultérieure. Le premier incrément s'arrête après un
  cluster fusionné.

#### Gate B - Cycle complet interne de Ticket C

Le mainteneur inspecte une exécution simulée complète : ACTIVE, réservation,
quatre workers, succès partiel, réconciliation, suite locale, une PR, checks,
fusion observée et Linear Done. Lancer
`harness:verification-before-completion`. Le seul geste humain dans le scénario
nominal est la fusion de la PR.

### Ticket D - Basculer atomiquement et certifier les consommateurs

Cette dernière plage supprime l'ancien moteur, branche les surfaces publiques,
compile les deux runtimes et dogfoode le tarball. Elle est la seule plage qui
rend le nouveau nom public ; A–D partent dans une unique PR.

#### D1 - Compiler, cutover et dogfooder sans faux vert

- **Goal**: livrer le même contrat à Claude et Codex, prouver l'installation
  consommateur et recueillir une preuve réelle avant de déclarer Autopilot done.
- **Depends on**: Tickets A, B, C, Gate B
- **TDD mode**: souple
- **Files**:
  - réduire `packages/cli/src/commands/backlog-autopilot.ts` au stub de migration
  - mettre à jour `packages/cli/src/main.ts`
  - mettre à jour `packages/cli/src/commands/help.ts` et son test
  - créer `packages/cli/src/lib/autopilot/legacy-boundary.test.ts`
  - supprimer tout `packages/cli/src/lib/backlog/`, tests compris, après reprise
    explicite des seuls helpers purs utiles
  - finaliser `packages/core/skills/autopilot/SKILL.md`, `.source`, références et
    `packages/core/commands/autopilot.md`
  - réduire les anciennes surfaces skill/command à un stub de migration sans
    logique métier
  - renommer `plans/skill-audits/backlog-autopilot.md` en
    `plans/skill-audits/autopilot.md`
  - créer `packages/cli/scripts/conformance-autopilot.mjs`
  - créer les fixtures sous
    `packages/cli/test-fixtures/autopilot-consumer/`
  - mettre à jour `package.json` avec `conformance:autopilot`
  - mettre à jour `README.md`, `docs/ARCHITECTURE.md`, `docs/CODEX.md`,
    `docs/CONTRIBUTING.md`, `AGENTS.md` et `CLAUDE.md`
  - étendre `void-harness doctor` avec un preflight Autopilot non mutant
  - régénérer `packages/cli/core-assets/`, graph model, certification et bundle
    par leurs commandes canoniques
- **Behavior**:
  - le runtime généré lit `program.md` et reprend automatiquement quand
    `autopilot.enabled:true` ;
  - aucune question de repointage ou confirmation par cluster n'est demandée ;
  - `/harness:autopilot` fonctionne sans argument ; le CLI rend une vue humaine
    par défaut et `--json` pour le skill ;
  - `backlog-autopilot` échoue code `2` vers `autopilot` pendant un cycle de
    migration documenté, sans alias fonctionnel ;
  - `legacy-boundary.test.ts` prouve qu'aucune logique métier ne reste sous
    `lib/backlog/` ou les stubs ;
  - doctor valide ACTIVE, adapter runtime, connectors, worktrees, base protégée
    et commandes de vérification sans claim ;
  - `ticket-writer` crée le pointeur seulement après plan/pool approuvés et
    refuse une collision ;
  - Claude et Codex nomment leur skill natif correctement ;
  - le tarball installé dans une fixture expose `autopilot`, le stub legacy et
    le bootstrap, sans source monorepo ;
  - la conformance utilise de faux ports Linear/GitHub et un bare remote Git
    local, puis un dogfood réel sur un projet consommateur valide les connectors
    et le coût CI ;
  - le dogfood réel s'arrête sur une PR non mergée pour le gate humain.
- **Verification gate**:
  - `pnpm conformance:install`
  - `pnpm conformance:autopilot`
  - `pnpm test`
  - `pnpm build`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm anti-bloat:check`
  - `pnpm sync:docs`
  - `pnpm decisions:check`
  - `pnpm graph:check`
  - `pnpm certification:check`
  - `pnpm graph:check-bundle`
  - `pnpm version:check`
  - `pnpm check:publish`
  - `pnpm --filter voidharness build:assets` puis worktree propre sur
    `packages/cli/core-assets`
- **Expected commits**:
  - `refactor(autopilot): cut over the canonical surface because the replacement is complete`
  - `test(autopilot): add consumer conformance because source-only success would be a false green`
  - `docs(autopilot): align both runtimes because durable resume is a consumer contract`
  - `build(autopilot): regenerate shipped assets because npm must match the authored core`
- **Notes**: mesurer activation initiale `< 5 min`, reprise `< 30 s` et premier
  worker `< 2 min`, hors latence provider exceptionnelle. Versions et changelog
  restent sous release-please. Ne jamais modifier un manifeste de version à la
  main. Le dogfood distant requiert une autorisation explicite du projet
  consommateur et ne contourne aucun required check.

## Review checkpoints

- **Gate A dans Ticket A** : planner, ACTIVE, lease logique et reprise
  zéro-argument verts, sans cutover public.
- **Gate B dans Ticket C** : cycle simulé complet jusqu'à la fusion observée et
  la clôture Linear, sur les deux adapters.
- **Gate C dans Ticket D** : tarball consommateur, dogfood, full suite et diff
  legacy propre avant le premier push.

Ces gates sont des preuves internes aux quatre plages de commits. Elles ne
créent ni PR ni demande humaine séparée. La revue et la fusion de l'unique PR de
cutover constituent le gate humain.

## Plan review

Ce plan est `high_risk: true` à cause des mutations autonomes Linear/GitHub, de
la gestion de worktrees et de la reprise cross-system.
`harness:plan-review all` a été exécuté. Folpe a choisi le cutover atomique en
quatre plages ; les findings correctness, safety et DevEx sont repliés dans la
spec et les tickets A–D. Toute modification de la frontière d'autorité exige un
ADR qui supersède celui du 2026-07-25.

## Linear execution handoff

Le découpage cible exactement quatre tickets d'implémentation dans une seule PR.
`ticket-writer` recherche les doublons, reprend les conventions natives du
projet et crée les vraies relations `blockedBy`. Il ne crée ni ne remplace
`.void/program.md` tant qu'un autre programme y est `executing`.

| Ref | Linear | Ticket impératif | Taille | Priorité | `blockedBy` | Plage |
|---|---|---|---:|---|---|---|
| APA | DEV-462 | Fonder Autopilot et reprendre sans repointage | L | high | DEV-433 | A1–A4 |
| APB | DEV-463 | Exécuter ticket-runner sur Claude et Codex | L | high | DEV-462, DEV-441, DEV-442 | B1–B2 |
| APC | DEV-464 | Réconcilier, publier et tenir Linear jusqu'au merge | L | high | DEV-463 | C1–C4 |
| APD | DEV-465 | Basculer atomiquement vers Autopilot et certifier les consommateurs | L | high | DEV-464 | D1 |

Les quatre tickets sont volontairement dépendants et s'exécutent
séquentiellement sur la même branche d'intégration, avec une plage de commits
distincte par ticket. Aucun n'ouvre de PR. Après APD, la full suite locale passe
une dernière fois, puis une seule PR de réconciliation référence les quatre
tickets. Forcer leur parallélisme créerait précisément le Frankenstein que ce
plan retire.

## Resume point

**Next step**: attendre que DEV-433 soit débloqué et terminé, puis lancer
`harness:ticket-runner` sur DEV-462 depuis la branche d'intégration unique.
Chaque reprise relit ce ticket dans Linear et le plan global ; aucun repointage
manuel de `program.md` n'est requis.

**Completed**:

- spec approuvée : `docs/specs/2026-07-25-autopilot.md` ;
- ADR accepté : Autopilot autonome, fusion PR humaine ;
- plan-review CEO/Design/Engineering/DevEx terminé ;
- cutover atomique en quatre plages approuvé et replié ;
- adapters Claude/Codex, lease logique, reprise zéro-argument, recovery même
  clone, lifecycle Linear et parcours DevEx repliés ;
- tickets créés dans `voidcorp / DEV / void harness` :
  DEV-462, DEV-463, DEV-464 et DEV-465, avec relations `blockedBy` vérifiées.

**Pending**:

- clôture de DEV-433, actuellement bloqué par DEV-461 ;
- disponibilité de DEV-441 puis DEV-442 avant DEV-463 ;
- exécution séquentielle DEV-462→DEV-465 sur une branche, une PR au terme ;
- brainstorming/spec séparée de `void-harness cheatsheet`, sans l'inclure dans
  APA–APD.

Après création des tickets, Linear devient la source de vérité mutable. Ce
resume point ne doit pas être utilisé comme un second pointeur de ticket.

## Plan-review report (terminé)

### Scope gate

- **Mode** : REDUCTION. Le plan touche plus de huit fichiers et trois systèmes
  externes ou frontières d'exécution : Linear, GitHub/Git et les runtimes
  Claude/Codex.
- **Scope conservé** : activation durable, sélection Linear, `ticket-runner`,
  worktrees, réconciliation, une PR, reprise et clôture post-merge.
- **Scope exclu** : cheat sheet, headless/cron et auto-merge. Ces sujets gardent
  leur propre discovery et ne doivent pas élargir ce cut.

### CEO lens

#### [P1] Le découpage actuel peut publier une régression entre AP01 et AP10

**Finding** : Step 1 supprime la frontière `backlog` active et réduit l'ancien
nom à un stub, tandis que le premier worker n'arrive qu'en Step 5 et que la PR
complète n'arrive qu'en Step 9. Le handoff propose pourtant onze tickets
d'implémentation distincts. Si AP01 à AP09 sont fusionnés séparément, la branche
principale expose temporairement un Autopilot plan-only à la place du batch
attended fonctionnel. C'est un cut horizontal et non une tranche saine.

**Decision class** : Taste / user-challenge. Le choix modifie la forme des
tickets, la taille de la PR et la stratégie de cutover ; il ne doit pas être
auto-décidé silencieusement.

**Options** :

1. **Cutover atomique en quatre plages de tickets dans une PR de
   réconciliation** (recommandé) : regrouper AP01–AP10 en quatre unités
   verticales, développées séquentiellement sur une branche d'intégration. Le
   moteur historique reste intact sur `main` jusqu'à la fusion ; sa suppression
   est le dernier changement fonctionnel du cutover. Les plages de commits et
   checkpoints restent séparés pour la revue.
2. **Strangler incrémental** : conserver l'ancien moteur derrière une façade,
   fusionner le nouveau en plusieurs PR, puis supprimer le legacy. Les diffs sont
   plus petits, mais deux moteurs et leur migration coexistent temporairement.
3. **Garder AP01–AP10 comme PR potentiellement séparées** : coût de planification
   nul, mais régression intermédiaire et risque de divergence. Option rejetée au
   regard du principe de base saine.

**Recommendation** : option 1. Elle respecte le cluster de quatre tickets, une
seule PR et un seul passage CI distant nominal, sans livrer de système hybride.
La revue doit ajouter un budget de taille/risque permettant de réduire le
cluster sous quatre avant exécution si la PR estimée devient déraisonnable.

**Décision** : option 1 approuvée par Folpe le 2026-07-25. Le plan doit être
replié en quatre plages verticales dans une seule PR de cutover. Aucun état
plan-only moins capable ne doit être publié sur la branche principale.

#### [P1] Quatre tickets est un plafond, pas un objectif aveugle

**Finding** : le projet Linear utilise `XS=1`, `S=2`, `M=3`, `L=5`, mais 24 des
35 tickets actifs observés sont déjà `L`. Interdire plusieurs `L` rendrait donc
Autopilot presque mono-ticket sans mesurer le risque réel. À l'inverse, remplir
systématiquement quatre places peut produire une PR pénible à revoir.

**Decision class** : Mechanical après l'approbation du cutover. Conserver
`clusterSize: 4` comme plafond, sélectionner uniquement des tickets indépendants
et utiliser footprint, faible confiance et zones à risque pour réduire le
cluster. L'estimation Linear est affichée et totalisée dans le budget de revue,
mais ne constitue pas à elle seule une exclusion. Le reconciler publie les
métriques réelles de diff par ticket et pour la PR ; le dogfood calibre ensuite
un éventuel seuil project-relative au lieu d'inventer un nombre universel.

**Decision** : auto-décidée, compatible avec le contrat approuvé et réversible.

### Design lens

**SKIPPED** : aucun écran ni flux utilisateur graphique n'est dans le scope. Les
surfaces CLI, skill, erreurs et documentation sont auditées sous la lentille
DevEx. La cheat sheet HTML reste une feature sœur séparée.

### Engineering lens

#### [P1] La parité runtime n'a qu'un adapter Claude dans le plan

**Finding** : Step 6 ne prévoit que
`autopilot.workflow.js`, alors que Step 11 promet le même contrat à Claude et
Codex. `docs/CODEX.md` dit encore que les subagents Codex sont expérimentaux et
que le fan-out parallèle n'est pas disponible. La documentation Codex actuelle
indique au contraire que les releases locales activent les subagents par défaut
et qu'un skill ou `AGENTS.md` peut demander leur utilisation.

**Decision** : le CLI produit un `OrchestrationPlan` runtime-neutral. Deux shells
minces l'exécutent :

- Claude utilise le Workflow natif ;
- Codex utilise les subagents natifs. Le contrôleur crée d'abord chaque worktree,
  puis donne à chaque subagent un chemin et une branche explicites ; aucun agent
  ne choisit ou ne partage son checkout.

Les deux adapters consomment le même prompt `ticket-runner`, retournent le même
`WorkerResult` et n'ont aucune logique de sélection ou de lifecycle. Un
capability preflight prouve l'adapter, les permissions et les worktrees avant
toute réservation Linear. Adapter absent signifie `unsupported-runtime`, sans
claim. `docs/CODEX.md`, les agents compilés et les tests de conformance doivent
être corrigés dans le cutover.

**Decision class** : correctness mécanique, auto-décidée.

#### [P1] La réservation Linear n'est pas transactionnelle au sens transport

**Finding** : la spec dit « réserve atomiquement », mais l'API/connector met à
jour plusieurs issues par mutations distinctes. La documentation Linear expose
`issueUpdate`, les erreurs GraphQL partielles et les rate limits ; elle ne promet
ni transaction multi-issue ni compare-and-swap. Une compensation après write
partiel est prévue, mais le vocabulaire actuel laisse croire à une garantie
impossible.

**Decision** : modéliser une atomicité logique par protocole de lease :

1. observation bornée de tous les candidats ;
2. `ReservationIntent` versionnée avec `programId`, `runId`, `clusterId`, base et
   expiration de lease ;
3. writes idempotents avec préconditions observées ;
4. réobservation complète ;
5. activation du run seulement si tous les marqueurs convergent ;
6. compensation explicite sinon.

Aucun worker ne démarre sur une réservation partielle. Les erreurs GraphQL
partielles, `RATELIMITED`, timeout et retry avec résultat inconnu ont leurs
propres transitions. Le skill ne poll pas chaque ticket en boucle ; il réobserve
aux frontières d'état.

**Decision class** : correctness mécanique, auto-décidée.

#### [P1] `--run <runId>` réintroduit le repointage manuel rejeté

**Finding** : le bootstrap doit reprendre automatiquement, mais le contrat CLI
exige un `runId` pour `status`, `resume` et `abort`, tandis que le marqueur Linear
décrit seulement `clusterId`. Après compaction ou nouvelle session, le launcher
ne peut donc pas retrouver le bon curseur sans une information que l'utilisateur
ne doit pas mémoriser.

**Decision** : le marqueur v1 contient au minimum `programId`, `runId`,
`clusterId`, base SHA, branche d'intégration et version de protocole. Le skill
zéro-argument hydrate Linear et GitHub, puis appelle :

```text
autopilot status [--run <runId>] < RemoteObservation
autopilot resume [--run <runId>] < RemoteObservation
autopilot abort  [--run <runId>] < RemoteObservation
```

Sans `--run`, exactement un lease non terminal cohérent est repris. Zéro lease
permet une nouvelle sélection ; plusieurs leases retournent
`competing-runs` sans mutation. `--run` reste un outil opérateur explicite, pas
le chemin nominal. Un connector indisponible suspend le bootstrap et interdit
une nouvelle sélection.

**Decision class** : correctness et DevEx mécaniques, auto-décidées.

#### [P1] Le curseur local ne peut pas promettre une reprise après perte machine

**Finding** : les branches worker restent locales pour économiser la CI. Un
crash de processus, une compaction ou une nouvelle session dans le même clone
sont récupérables ; la perte du clone ou de la machine ne l'est pas si les
commits n'ont jamais été poussés. Le plan ne distingue pas ces cas et ne précise
pas la sécurité du nettoyage.

**Decision** :

- annoncer la frontière honnête « reprise même clone » pour le premier
  incrément ;
- reconstruire l'état seulement depuis Linear, GitHub et les refs Git
  explicitement présentes ; ne jamais inventer un worker terminé ;
- si le curseur a disparu mais que les refs existent, recalculer les plages et
  preuves ; si les refs ont disparu, libérer ou réexécuter le ticket après
  réconciliation distante explicite ;
- ne jamais utiliser de suppression forcée sur un worktree sale, un commit non
  intégré ou une branche non archivée ;
- nettoyer seulement après merge/abort observé, checkout propre et preuve que
  la branche est fusionnée ou volontairement conservée.

Un backup distant sans trigger CI reste une évolution ultérieure, après preuve
du repo ; ce plan ne le suppose pas.

**Decision class** : safety mécanique, auto-décidée.

#### [P1] Le lifecycle Linear intermédiaire et les tickets exclus sont ambigus

**Finding** : Step 10 définit `Done` après merge, mais le passage à `In Review`,
la fermeture du lease et le devenir exact des tickets exclus ne sont pas
entièrement spécifiés. Une session qui oublie ces transitions rend Linear
rapidement incohérent, ce que l'utilisateur a explicitement rejeté.

**Decision** :

- claim convergé : ticket en `In Progress` avec marqueur de lease ;
- plage incluse dans une PR ouverte : ticket en `In Review`, lien PR et plage de
  commits ;
- ticket exclu : `Blocked` si le tracker le permet, sinon état prêt + commentaire
  typé ; le marqueur indique `excluded` et l'action de reprise ;
- PR fermée sans merge : jamais `Done` ; reprendre ou bloquer avec cause ;
- PR fusionnée + checks requis verts : tickets inclus `Done`, lease clos ;
- abort : libération idempotente des tickets non fusionnés, commentaire et refs
  préservées.

Toute action est réobservée. Une write Linear partielle garde le run en
`tracker-reconciliation`, pas en `complete`.

**Decision class** : correctness mécanique, auto-décidée.

#### [P2] Les chemins d'erreur doivent être une matrice, pas des cas dispersés

**Finding** : les étapes couvrent beaucoup de cas unitaires, mais il manque un
oracle commun pour distinguer nil, vide, erreur amont, résultat partiel et état
contradictoire à chaque frontière.

**Decision** : ajouter une table de transitions testée pour :

- Linear absent, auth refusée, rate limit, GraphQL partiel, timeout avant/après
  write ;
- GitHub absent, permissions insuffisantes, PR missing/closed/merged, checks
  pending/red/cancelled, head réécrit et base avancée ;
- Git ref absente, plage non linéaire, worktree sale, disque plein, interruption
  avant/après commit ou rename d'état ;
- zéro candidat, zéro worker vert, succès partiel et quatre workers verts ;
- répétition exacte de chaque action après crash.

Chaque transition possède un invariant, une action idempotente autorisée et un
résultat terminal ou reprenable. Les schémas `program.md`, marqueur, observation,
action et cursor portent tous une version explicite et des limites de taille.

**Decision class** : verification mécanique, auto-décidée.

### DevEx lens

#### [P1] Le plan ne mesure pas le temps jusqu'au premier progrès utile

**Finding** : GitHub documente un parcours Copilot agent end-to-end d'environ dix
minutes et son intégration Linear transforme une assignation en PR WIP. Ce n'est
pas un benchmark strictement équivalent, mais cela fixe une attente forte :
l'activation et la reprise ne doivent pas devenir un mini-projet opérateur.

**Decision** : le dogfood mesure séparément :

- activation initiale, harness déjà installé et connectors autorisés :
  `program.md` valide + preview en moins de cinq minutes ;
- session suivante : statut cohérent ou erreur actionnable en moins de trente
  secondes hors latence exceptionnelle du provider ;
- cluster prêt : premier worker lancé en moins de deux minutes ;
- aucune revendication sur le temps jusqu'à la PR, qui dépend du contenu des
  tickets.

Le chemin nominal agent est `/harness:autopilot` sans argument. Le CLI garde un
mode humain lisible et `--json` stable ; les pipes JSON restent internes au
skill. Les mesures, appels Linear/GitHub, durée locale, triggers CI et temps
d'attente humain sont inclus dans la preuve de run.

**Decision class** : DX mécanique, auto-décidée.

#### [P2] Quickstart, erreurs et fenêtre de migration ne sont pas assez précis

**Finding** : les erreurs problème/cause/correction sont prévues, mais le plan ne
garantit ni quickstart testable, ni doctor, ni durée du stub legacy. La commande
risque donc d'être découvrable seulement par les auteurs du plan.

**Decision** :

- README et help montrent « activer une fois », « reprendre automatiquement »,
  « diagnostiquer » et « abort sans perte » ;
- `void-harness doctor` vérifie ACTIVE, connectors/capabilities, worktrees,
  branche protégée et commandes de vérification sans muter ;
- chaque erreur nomme la prochaine commande ou le fichier à corriger ;
- le stub `backlog-autopilot` reste pendant un cycle de migration documenté et
  sa suppression future est une rupture release-please, jamais une disparition
  silencieuse ;
- l'installation consommateur prouve que Claude et Codex découvrent `autopilot`
  sans chemin source monorepo.

**Decision class** : DX mécanique, auto-décidée.

### DevEx scorecard après décisions

| Dimension | Avant replis | Cible après replis |
|---|---:|---:|
| Getting started / TTHW | 5/10 | 8/10 |
| Interface et affordances | 6/10 | 8/10 |
| Erreurs et récupération | 7/10 | 9/10 |
| Documentation et découverte | 6/10 | 8/10 |
| Upgrade / migration | 6/10 | 8/10 |
| Environnement et parité runtime | 4/10 | 8/10 |

### Auto-decision audit

| Finding | Classe | Décision | Réversible |
|---|---|---|---|
| Cutover sans régression | Taste | humain : quatre plages, une PR | oui |
| Taille du cluster | Mechanical | plafond 4, réduction par risque réel | oui |
| Adapters Claude/Codex | Correctness | plan commun, deux shells natifs | oui |
| Lease Linear | Correctness | atomicité logique réobservée | oui |
| Discovery du run | Correctness/DX | marker avec runId, `--run` optionnel | oui |
| Reprise et cleanup | Safety | même clone, aucune force destructive | oui |
| Lifecycle tracker | Correctness | In Progress → In Review → Done | oui |
| Matrice d'échecs | Verification | oracle commun exhaustif | oui |
| TTHW et quickstart | DX | cibles mesurées, zéro argument | oui |

### Implementation Tasks

1. **[x][P1] Replier AP01–AP10 en quatre unités verticales et une PR de cutover** :
   conserver l'ancien moteur sur la branche principale jusqu'à ce que sélection,
   exécution, réconciliation, publication et reprise soient verts ensemble.
2. **[x][P1] Introduire `OrchestrationPlan` et les adapters Claude/Codex** :
   capability preflight avant claim, worktrees créés par le contrôleur,
   `WorkerResult` commun et conformance réelle des deux runtimes.
3. **[x][P1] Remplacer « transaction Linear » par le protocole de lease logique** :
   intent versionnée, writes idempotents, réobservation, compensation et cas
   GraphQL partiel/rate limit.
4. **[x][P1] Rendre la reprise zéro-argument** : marker avec `programId`, `runId`,
   `clusterId`, résolution automatique d'un run unique et conflit explicite entre
   plusieurs runs.
5. **[x][P1] Spécifier la frontière de recovery et le cleanup sûr** : reprise même
   clone, reconstruction par preuves, aucune suppression forcée d'un worktree ou
   d'une ref récupérable.
6. **[x][P1] Fermer le lifecycle Linear complet** : In Progress, In Review,
   excluded/blocked, closed-unmerged, Done post-merge et abort idempotent.
7. **[x][P2] Ajouter l'oracle de transitions et les fault injections** à chaque
   frontière Linear, GitHub, Git, filesystem et runtime.
8. **[x][P2] Versionner tous les contrats**, y compris `program.md` et le marqueur,
   puis documenter la compatibilité/refus des versions inconnues.
9. **[x][P2] Livrer le parcours DevEx testable** : invocation sans argument, sortie
   humaine + `--json`, doctor non mutant, quickstart, erreurs actionnables,
   fenêtre du stub legacy et mesures TTHW.
10. **[x][P2] Mettre à jour la documentation runtime devenue fausse** :
    `docs/CODEX.md`, AGENTS/CLAUDE, architecture, audits et assets compilés dans
    le même cutover.

### Evidence consulted

- [Codex manual, subagents](https://developers.openai.com/codex/codex-manual#execution-model-and-workflows)
- [GitHub Copilot agent quickstart](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)
- [GitHub Copilot avec Linear](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/integrate-coding-agent-with-linear)
- [Linear GraphQL et erreurs partielles](https://linear.app/developers/graphql)
- [Linear rate limiting](https://linear.app/developers/rate-limiting)

### Verdict

**CLEARED FOR TICKETING.** Les Implementation Tasks 1–10 sont repliées dans la
spec et les tickets A–D. Aucun arbitrage utilisateur n'est ouvert. Le second
pass high-risk doit uniquement vérifier absence de contradiction, placeholders,
gate manquant ou régression de scope avant `ticket-writer`.
