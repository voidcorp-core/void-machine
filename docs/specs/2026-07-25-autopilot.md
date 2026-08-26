---
title: Autopilot - clusters de tickets autonomes, une PR de réconciliation
date: 2026-07-25
status: approved
author: Folpe + Codex
supersedes:
  - docs/specs/2026-06-21-backlog-autopilot.md
  - docs/specs/2026-07-01-backlog-autopilot-auto-merge-mvp.md
related:
  - plans/2026-06-21-backlog-autopilot-plan.md
  - docs/decisions-log/2026-07-25-autopilot-autonomous-clusters-human-pr-merge--077c5419-ffe2-454f-a50e-9c147cf15ce9.md
---

# Autopilot

## Résumé

`autopilot` est le drainer de tickets autonome du harness. Une activation
explicite dans le projet vaut consentement durable : à chaque nouvelle session,
il retrouve le programme actif, relit les tickets dans Linear, reprend un cluster
interrompu ou sélectionne jusqu'à quatre tickets prêts, puis conduit le travail
jusqu'à une PR de réconciliation verte.

Chaque ticket est développé dans son propre worktree par le skill canonique
`ticket-runner`. Il conserve sa propre plage de commits. Autopilot réconcilie
lui-même les branches, exécute la suite locale complète, ouvre une seule PR et
gère les corrections de CI. La fusion de cette PR est l'unique gate humain.

Le premier incrément livre un cluster à la fois, plafonné à quatre tickets. Le
nom et le contrat restent valides lorsque l'orchestrateur saura enchaîner
plusieurs clusters ou utiliser un backend headless.

## Problème

Le comportement actuel laisse quatre coûts :

1. `backlog-autopilot` décrit un lot attended qui redemande une confirmation,
   alors que l'utilisateur a déjà activé un programme autonome.
2. Le contexte global, la sélection Linear et la reprise sont faciles à oublier
   entre deux sessions.
3. Une PR ou un push par ticket multiplie les exécutions de CI coûteuses alors
   que les tickets peuvent être vérifiés localement puis réconciliés ensemble.
4. Les responsabilités entre l'orchestrateur, le worker mono-ticket et le
   réconciliateur ne sont pas assez contraignantes pour garantir une reprise
   propre.

La cible mesurable du premier incrément est : une activation par projet, zéro
question de routine pendant l'exécution, jusqu'à quatre plages de commits
traçables, une PR de réconciliation et nominalement une exécution distante de la
suite complète par cluster.

## Nommage et migration

La surface publique canonique devient :

- skill : `autopilot`
- commande agent : `/harness:autopilot`
- CLI : `void-harness autopilot plan|start|status|resume|abort`

`ticket-runner` reste l'unique moteur mono-ticket. Il n'existe ni
`ticket-worker`, ni second cycle qualité caché dans Autopilot.

`backlog-autopilot` ne reste pas comme alias fonctionnel. Pendant une fenêtre de
migration, l'ancien skill et l'ancienne commande échouent avec un message
actionnable vers `autopilot`. Il n'y a qu'une implémentation et un seul état.

Les noms internes décrivent leur responsabilité, par exemple `clusterPlanner`,
`ticketExecution` et `reconciler`. Ils ne deviennent pas des capacités publiques.

## Activation durable

L'autonomie est opt-in par projet. Le pointeur de programme
`.void/program.md` porte une configuration stable équivalente à :

```yaml
autopilot:
  schemaVersion: 1
  enabled: true
  tracker:
    workspace: voidcorp
    team: DEV
    project: void harness
  base: auto
  clusterSize: 4
  mergeGate: human
```

Cette activation est l'autorisation de sélectionner, développer, réconcilier,
committer, pousser la branche d'intégration, ouvrir ou mettre à jour la PR et
mettre à jour Linear dans le périmètre déclaré. Elle évite toute confirmation
par session ou par cluster.

`program.md` garde le contexte global et les références stables. Il ne duplique
pas l'état mutable des tickets. Linear reste la source de vérité pour le
workflow, GitHub pour les branches, PR et checks, Git pour les commits, et
`.void/autopilot/` pour le curseur technique local.

Au démarrage d'une session, le bootstrap du harness :

1. lit le programme actif ;
2. si `autopilot.enabled` est vrai, exécute l'équivalent de `autopilot status` ;
3. reprend le cluster distant/local cohérent avant de sélectionner du travail ;
4. relit chaque ticket Linear juste avant son exécution.

Changer de tracker, de base, de politique de merge ou désactiver Autopilot exige
une modification explicite du pointeur actif. La désactivation arrête les
nouvelles sélections mais ne détruit aucun travail en cours.

## Modèle d'autorité

Autopilot prend seul la meilleure décision compatible avec le projet. Pour
résoudre une ambiguïté, il applique cet ordre :

1. ticket Linear courant, critères d'acceptation et commentaires ;
2. spec et plan référencés par le programme ;
3. décisions acceptées, doctrine et règles du repo ;
4. conventions déjà présentes dans le code et les tests ;
5. solution la plus sûre, réversible, simple et étroite.

Une décision non évidente est consignée avec
`void-harness decisions new`. Autopilot ne sollicite pas l'humain pour une
décision locale au ticket.

Une décision qui exige d'élargir matériellement le périmètre, d'affaiblir une
protection de sécurité, de manipuler un secret absent ou d'effectuer une action
de production irréversible bloque seulement le ticket concerné. Les tickets
restants continuent s'ils sont indépendants. Le blocage et les options sont
exposés dans Linear et dans la PR de réconciliation.

## Architecture

```text
program.md + Linear + GitHub
          |
          v
  Autopilot L0 (skill en session)
          |
          +-- CLI déterministe : sélection, footprint, partition, plan, état
          |
          +-- ticket-runner(ticket A) -> worktree A -> plage de commits A
          +-- ticket-runner(ticket B) -> worktree B -> plage de commits B
          +-- ticket-runner(ticket C) -> worktree C -> plage de commits C
          +-- ticket-runner(ticket D) -> worktree D -> plage de commits D
          |
          v
  reconciler -> branche d'intégration -> suite locale complète
          |
          v
  une PR -> CI distante -> corrections autonomes -> ready for merge
          |
          v
  fusion humaine -> Linear Done -> cluster suivant
```

Le skill L0 orchestre les outils en session et garde un contexte mince. Le CLI
calcule les décisions reproductibles sans accès implicite au réseau et émet un
`OrchestrationPlan` commun. Un adapter Claude l'exécute avec Workflow ; un
adapter Codex l'exécute avec les subagents natifs. Dans les deux cas, le
contrôleur crée les worktrees et transmet à chaque worker un checkout explicite.
`ticket-runner` possède tout le cycle qualité d'un ticket. Le reconciler possède
tout ce qui est partagé ou transversal.

Un capability preflight prouve l'adapter runtime, les connectors, les
permissions Git, les worktrees et la protection de la base avant toute mutation
Linear. Un runtime qui ne peut pas honorer le contrat échoue fermé ; il ne prend
aucun ticket.

## Sélection et réservation du cluster

Le premier incrément sélectionne entre un et quatre tickets :

- dans le tracker configuré ;
- dans un statut natif prêt à être pris ;
- sans bloqueur Linear non terminé ;
- suffisamment définis pour que `ticket-runner` puisse démarrer ;
- compatibles avec la base et le programme actifs.

La priorité suit d'abord le graphe du programme, puis la priorité Linear, puis
l'ancienneté. Un estimateur de footprint conservateur prédit les fichiers et
ressources partagés. Les tickets à faible risque de collision peuvent avancer en
parallèle. Les tickets qui touchent un lockfile, une migration, un registre
partagé ou des fichiers qui se recouvrent sont ordonnés séquentiellement, sans
perdre leur worktree.

Les tickets du premier incrément sont indépendants dans le graphe Linear. Le
support de composants dépendants dans un même cluster reste compatible avec
l'architecture, mais n'est pas requis pour activer l'autonomie.

Après planification, Autopilot réserve le cluster avec une atomicité logique,
sans prétendre à une transaction multi-issue fournie par Linear :

- identifiants opaques `programId`, `runId` et `clusterId` ;
- passage des tickets en cours ;
- commentaire machine-readable versionné sur chaque ticket avec les trois
  identifiants, base SHA, branche d'intégration et expiration de lease ;
- écriture atomique du curseur local.

Plusieurs tickets peuvent être en cours simultanément seulement s'ils portent le
même `clusterId`. Une réservation partielle est réparée ou annulée avant de
lancer un worker. Le protocole observe tous les candidats, émet une intention,
applique des mutations idempotentes, réobserve l'ensemble, puis active le run
seulement si tous les marqueurs convergent. Erreur GraphQL partielle, rate limit
ou résultat réseau inconnu suspendent la réservation et déclenchent reprise ou
compensation, jamais un worker.

## Exécution mono-ticket

Chaque worker :

1. recharge le ticket Linear et ses relations ;
2. exécute intégralement `ticket-runner` ;
3. applique les gates ciblés localement ;
4. produit une plage de commits Conventional Commits attribuable au ticket ;
5. retourne un résultat machine-readable avec commits, fichiers, preuves,
   décisions et blocages ;
6. ne crée ni PR ni merge.

Une plage peut contenir plusieurs commits. Ce choix préserve les paires
`test:`/`fix:`, les décisions et un historique utile. Le contrat n'impose pas
artificiellement un commit unique par ticket.

Les branches de workers restent locales par défaut afin de ne pas déclencher de
CI distante. Un backup distant n'est autorisé que si le repo prouve qu'il ne
déclenche aucun workflow coûteux sur cet espace de branches.

Une migration sûre est générée, revue et appliquée automatiquement en
dev/local avant les tests qui en dépendent. Les tickets de migration sont
toujours séquentiels. Une migration de production n'est jamais lancée par
Autopilot : elle reste exécutée par la CI après la fusion humaine.

## Réconciliation autonome

Autopilot possède la réconciliation de bout en bout :

1. crée ou reprend la branche d'intégration depuis la base prouvée ;
2. intègre chaque plage de commits dans l'ordre du plan ;
3. résout les conflits selon le modèle d'autorité ;
4. réexécute les preuves invalidées par l'intégration ou un rebase ;
5. lance la suite locale qui reflète la CI ;
6. corrige les échecs de réconciliation ;
7. inspecte les triggers CI du repo ;
8. pousse la branche et ouvre une seule PR ;
9. surveille et corrige les checks distants jusqu'à `ready for merge`.

Les fichiers partagés à allocation globale, comme un index généré, appartiennent
au reconciler. Les workers produisent des fragments ou intentions, jamais des
allocations concurrentes.

Un rebase sur une base avancée et ses conflits font partie de la responsabilité
normale d'Autopilot. Toute preuve dépendante du SHA ou des fichiers réconciliés
est invalidée puis rejouée.

## Politique CI

Le budget visé est une exécution distante complète par cluster. Avant le premier
push, la branche d'intégration doit avoir passé la suite locale miroir de CI.

Autopilot inspecte les événements des workflows avant de publier :

- CI sur `pull_request` seulement : push puis ouverture de la PR ;
- CI sur branches de travail seulement : un unique push final ;
- triggers `push` et `pull_request` redondants : utilise le mécanisme documenté
  du repo pour supprimer le doublon, ou signale que la garantie d'une seule
  exécution n'est pas disponible.

Autopilot ne désactive jamais un required check pour économiser de la CI. Une
seconde exécution distante est acceptable lorsqu'elle apporte une information
indisponible localement ou lorsqu'un correctif est nécessaire. La métrique est
donc « une exécution nominale », pas une promesse qui masquerait un échec.

## Échecs et succès partiel

Un ticket qui ne converge pas après les boucles bornées de `ticket-runner` est
exclu de la branche d'intégration avec sa branche et ses preuves préservées. Ses
dépendants éventuels sont exclus. Les tickets indépendants verts continuent.

Le ticket exclu reçoit dans Linear la cause, le dernier SHA utile et l'action de
reprise. Il reste lié au `clusterId` tant qu'il est récupérable ; s'il est
réellement bloqué, Autopilot utilise le statut natif bloqué du tracker ou le
statut prêt accompagné d'un commentaire explicite.

Le lifecycle tracker est fermé et réobservé :

- lease convergé : `In Progress` ;
- plage incluse dans une PR ouverte : `In Review`, lien PR et commits ;
- PR fermée sans merge : reprise ou blocage explicite, jamais `Done` ;
- PR fusionnée et checks requis verts : `Done` pour les tickets inclus ;
- abort : lease libéré de façon idempotente, commentaire et refs préservées.

Une write Linear partielle garde le run en `tracker-reconciliation`.

Si aucun ticket n'est vert, aucune PR vide n'est ouverte. Si au moins un ticket
est vert, la PR précise les tickets inclus, exclus et les conséquences. Une
erreur de réseau ou de connector suspend l'étape concernée sans fabriquer
d'état local contradictoire.

## Reprise et sources de vérité

`.void/autopilot/` contient au minimum l'identifiant de run, le `clusterId`, les
SHAs, les résultats worker, la branche d'intégration et l'URL de PR. Les écritures
sont atomiques et le répertoire ne contient ni secret ni doctrine.

Au resume, l'ordre de réconciliation est :

1. Linear pour la réservation et l'état des tickets ;
2. GitHub pour la PR, la base et les checks ;
3. Git pour l'existence et l'ascendance des commits ;
4. curseur local pour accélérer, jamais pour contredire les trois précédents.

`resume` est idempotent. Il n'exécute pas deux fois un ticket dont la plage de
commits et les preuves sont encore valides. `abort` libère la réservation et
arrête l'automatisme, mais préserve les branches et commits non fusionnés.

Le chemin nominal ne demande jamais de `runId`. Le bootstrap hydrate Linear et
GitHub, reprend l'unique lease non terminal du programme, crée un run si aucun
lease n'existe, et bloque avec `competing-runs` si plusieurs leases
incompatibles sont observés. Un `--run` explicite reste disponible uniquement
pour le diagnostic opérateur.

Le premier incrément promet une reprise après crash, compaction ou nouvelle
session dans le même clone. Il ne prétend pas récupérer des branches worker
locales après perte du clone ou de la machine. Un curseur absent est reconstruit
uniquement depuis les marqueurs distants et les refs Git réellement présentes ;
un worker n'est jamais déclaré terminé sans sa plage de commits.

## Gate humain et cycle de vie

La fusion de la PR de réconciliation est l'unique gate humain. Avant ce point,
Autopilot choisit, développe, réconcilie et corrige seul. Il ne merge jamais la
PR dans ce premier contrat.

Pour un checkpoint de plan, fusionner la PR vaut approbation du checkpoint. Il
n'existe pas un second bouton ou ticket Linear à valider.

Après détection de la fusion :

1. Autopilot vérifie le SHA fusionné et les checks requis ;
2. passe les tickets inclus à Done et ajoute le lien de PR ;
3. laisse les tickets exclus dans leur état explicite ;
4. clôt le `clusterId` et nettoie seulement les worktrees récupérables ;
5. rend le programme éligible au cluster suivant, mais le premier incrément
   s'arrête ici ; l'enchaînement multi-cluster vient plus tard.

Le nettoyage refuse tout worktree sale, commit non intégré ou branche non
archivée. Aucune suppression forcée n'appartient au chemin nominal.

## Sécurité et limites

Les protections de branche serveur sont obligatoires sur la base. Autopilot ne
contourne ni required reviews, ni checks, ni hooks de sécurité. Il n'invente pas
de credentials et ne journalise pas les secrets.

Ne font pas partie du premier incrément :

- auto-merge, même pour un cluster faible risque ;
- exécution hors session ou cron ;
- plusieurs PR empilées avant un gate humain ;
- édition automatique de la doctrine ;
- déploiement ou migration de production ;
- garantie d'un seul run CI dans un repo dont les triggers imposent un doublon.

## Tests

Les helpers de sélection, réservation, transitions d'état, reprise,
invalidations de preuves et plan de triggers CI sont testés en TDD strict. La
composition CLI et les erreurs opérateur sont testées avec de vrais dépôts Git
éphémères quand l'ascendance compte.

Les deux adapters d'orchestration ont des fixtures de conformance communes pour :

- quatre tickets disjoints en parallèle ;
- overlap et migration en séquentiel ;
- succès partiel ;
- crash puis reprise idempotente ;
- base avancée avant réconciliation ;
- conflit résolu puis preuves rejouées ;
- aucune PR avant suite locale verte ;
- une seule branche publiée et une seule PR ;
- fusion détectée puis mise à jour Linear.

Un dogfood sur un projet consommateur valide les connectors, les worktrees, la
PR réelle et le coût CI. Aucun test automatisé ne fusionne une PR de production.

La matrice de fautes couvre aussi : Linear absent, auth refusée, rate limit,
GraphQL partiel, timeout avant/après write ; GitHub absent, PR fermée, checks
annulés, head réécrit et base avancée ; ref Git absente, plage non linéaire,
worktree sale, disque plein et interruption aux frontières d'écriture. Nil, vide,
erreur amont et état contradictoire sont des résultats distincts.

## Cutover atomique

Le plan-only, le fan-out, la réconciliation et la reprise sont des checkpoints
internes d'une seule branche d'intégration, pas des releases intermédiaires.
L'ancien moteur reste celui de la branche principale jusqu'à ce que quatre
plages de tickets verticales soient réunies dans une PR de cutover :

1. bounded context, activation, preview, lease et reprise zéro-argument ;
2. exécution `ticket-runner` dans les adapters Claude et Codex ;
3. réconciliation, suite locale, une PR et lifecycle Linear complet ;
4. bascule publique, suppression du legacy, conformance et dogfood.

La suppression de l'ancien moteur et l'activation du nouveau nom arrivent dans
la dernière plage. Les quatre plages gardent leurs commits attribuables, mais
une seule PR est fusionnée. Multi-cluster et backend headless restent des
incréments ultérieurs ; `ticket-runner` et la fusion humaine restent les mêmes
frontières.

## Parcours opérateur mesuré

Le chemin nominal est `/harness:autopilot` sans argument. Le CLI expose une
sortie humaine lisible et un `--json` versionné pour le skill. Le dogfood mesure :

- activation initiale, harness installé et connectors autorisés : ACTIVE valide
  et preview en moins de cinq minutes ;
- session suivante : statut cohérent ou erreur actionnable en moins de trente
  secondes hors latence exceptionnelle du provider ;
- cluster prêt : premier worker lancé en moins de deux minutes.

Le temps jusqu'à la PR dépend des tickets et n'est pas présenté comme une
constante. La preuve de run inclut durées, appels providers, suite locale,
triggers CI et attente du gate humain.

## Critères de succès

1. Une activation unique dans le projet suffit aux sessions suivantes.
2. Chaque worker relit son ticket Linear et exécute le vrai `ticket-runner`.
3. Jusqu'à quatre tickets possèdent des plages de commits distinctes et
   traçables dans une unique PR.
4. Aucun worker n'ouvre de PR ou ne déclenche volontairement la CI distante.
5. La branche d'intégration passe la suite locale complète avant publication.
6. Autopilot corrige seul réconciliation et CI jusqu'à `ready for merge`.
7. Linear, GitHub, Git et le curseur convergent après crash ou compaction.
8. La seule action humaine du cycle nominal est de fusionner la PR.
9. Claude et Codex exécutent le même `OrchestrationPlan` et produisent le même
   schéma `WorkerResult`.
10. Une nouvelle session reprend sans demander tracker, programme, ticket ou
    `runId`.
