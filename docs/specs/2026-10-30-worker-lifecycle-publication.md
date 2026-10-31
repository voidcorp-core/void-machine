---
title: Publication agnostique du cycle de vie des workers
date: 2026-10-30
status: approved
related:
  - 2026-09-28-supervised-agent-delegation.md
  - 2026-10-13-adaptive-delegation.md
  - ../NATIVE-SUPERVISION.md
---

# Publication agnostique du cycle de vie des workers

Amendement approuvé explicitement par Folpe le 30 octobre 2026 (DEV-1137).
Il remplace la responsabilité Surface de la spec du 28 septembre. Le contrat
public est décrit dans [WORKER-LIFECYCLE.md](../WORKER-LIFECYCLE.md). Aucun plugin
externe n'est développé ou modifié dans cette mission.

## Responsabilité de présentation

Void Machine publie des faits d'exécution, indépendants de l'outil d'affichage.
Le noyau et ses workflows ne détectent pas de multiplexeur et ne lui demandent
ni ouverture, ni fermeture, ni métadonnées. L'interface Surface est remplacée
par le contrat de publication ci-dessous. Les plugins externes décident de leur
présentation, par exemple un onglet par ticket, et en possèdent les ressources.

La délégation reste native. Un plugin absent ou défaillant ne change ni le lancement,
ni les permissions, ni la collecte des résultats. Fermer une vue ne termine pas
un worker. La publication ne confère aucune autorisation de commande ou de merge.

Le journal canonique reste `.void/machine/runs/<missionId>/events.jsonl`, résolu
au niveau commun du projet Git pour toutes ses worktrees. Pas de second journal,
de bus, de serveur d'affichage ou de nouveau démon.

### Événements et compatibilité

Réutiliser l'enveloppe canonique existante : `schemaVersion`, `eventId`, `seq`,
`missionId`, `ts`, `source`, `kind`, `subject`, `correlationId` et `payload`.
`subject` désigne le `runId`. L'ordre est celui de `seq` dans chaque mission ;
`eventId` permet la déduplication. Il n'y a pas d'ordre global entre missions.

Le payload worker porte `schemaVersion: 1`, version du contrat worker distincte
de celle de l'enveloppe du journal. Les champs supplémentaires dans le payload
sont compatibles et doivent être ignorés par les lecteurs qui ne les connaissent
pas. Retrait, changement de type ou de sens exige une nouvelle version du contrat.
Une version non supportée est signalée ; elle n'est pas interprétée comme la v1.

| `kind` | Champs du payload, outre `schemaVersion` | Moment d'émission |
| --- | --- | --- |
| `worker.dispatched` | `runId`, `missionId`, `ticket`, `role`, `runtime`, `worktree`, `branch`, `attachCommand` | Après accusé réel du runtime et association à la mission |
| `worker.state` | `runId`, `state`, `observedAt`, motif facultatif `reason` | À chaque changement d'état réellement observé, dont le premier `running` |
| `worker.finished` | `runId`, `outcome` | Une fois, après collecte de la fin de l'affectation ou constat terminal d'échec/arrêt |

- `role` vaut `work` ou `review`, `runtime` vaut `claude` ou `codex`.
- `worktree` est un chemin absolu vérifié. `ticket` est l'identifiant du ticket ;
  le champ reste présent avec `"unknown"` pour une tâche sans ticket connu.
- `branch` est le nom vérifié, ou `"detached"` pour une revue sur HEAD détachée ;
  dans ce dernier cas, le SHA vérifié figure dans `headSha`.
- `attachCommand` est un tableau d'arguments, jamais une commande shell concaténée,
  ou `"unknown"` si la capacité n'est pas établie pour cette session, notamment Codex.
  Aucun consommateur n'est obligé de l'exécuter ; aucune recette n'est inventée.
- `runId` identifie une affectation de worker. Reprise et corrections avant clôture
  conservent cet identifiant. Une nouvelle affectation après clôture en reçoit un autre.
  Deux workers ou tentatives simultanées ne sont jamais fusionnés par leur ticket.
- `state` vaut `running`, `blocked`, `done` ou `failed`. Une fin de tour seule ne vaut
  pas `done` : l'attente d'une décision du coordinateur est `blocked`, avec sa cause.
  `done` signifie que le résultat de l'affectation est collecté ; il ne certifie pas
  les tests, la review, le merge ou l'acceptation finale du résultat par Cortex.
- `outcome` vaut `succeeded`, `failed` ou `stopped`. L'arrêt est distingué d'un échec
  dans l'issue finale. Un timeout d'observation ne suffit pas à clôturer un worker.
- Les publications rejouées sont idempotentes. Un échec d'écriture est explicite,
  conserve l'identité du worker et ne provoque jamais son relancement automatique.
  Les événements terminaux précèdent la fermeture de la mission.
- Aucun brief, transcript, secret ou contenu de résultat n'est publié dans ce contrat.

### Lecture pour les consommateurs

`void-machine agents status --json` fournit une projection en lecture seule des
journaux de toutes les missions du projet commun. Il retourne une enveloppe
versionnée avec `workers`, `complete` et `issues`, sans inspection de multiplexeur,
commande runtime, réparation ou écriture. Les champs supplémentaires sont compatibles.
Le comportement historique sans `--json` reste distinct pendant la transition.

Un worker actif est une affectation publiée sans `worker.finished`, y compris si
elle est bloquée. Chaque entrée reprend ses métadonnées, son dernier état observé
et `observedAt`. Ce snapshot ne promet pas qu'un processus est vivant à cet instant.
Une absence d'observation reste explicite ; elle n'est ni un succès ni un échec.
Un journal illisible, tronqué ou de version inconnue rend `complete: false` avec
une cause et un code de sortie non nul, tout en conservant les entrées lisibles.
Une lecture partielle ne peut donc jamais être présentée comme zéro worker actif.

La v1 livre le snapshot. `--watch` est différé : les consommateurs peuvent relire
le snapshot ou suivre les JSONL avec leurs identifiants et séquences. Un flux continu
avec sa propre gestion des reprises n'est pas nécessaire à cette première livraison.

## Raccordement au chemin réellement utilisé

Autopilot utilise aujourd'hui `void-orchestrate` et les primitives natives, pas
l'ancien `agents dispatch`. La seule instrumentation de ce dernier ne satisfait
pas cette mission. Le journal canonique et son writer séquencé sont réutilisés ;
une entrée d'enregistrement d'observations, sur le modèle des reçus natifs existants,
permet au coordinateur de publier après accusé, observation et collecte réels.

Les workflows `void-orchestrate`, `void-autopilot` et les délégations de
`void-implement` doivent appeler cette frontière. Il ne s'agit pas d'affirmer une
capture automatique de tous les sous-agents Codex : seules les invocations réellement
raccordées au contrat sont couvertes. Les limites de capture restent documentées.
Le transport historique encore appelable publie le même contrat sans devenir le
transport obligatoire ; ses preuves existantes restent lisibles et collectables.
Ses appels automatiques à Surface sont retirés, sans agir sur les surfaces déjà
ouvertes. La compatibilité de lecture ne réintroduit pas un appel de multiplexeur.

Les clauses liées à Surface dans rôles, états, capture, appelants, erreurs, tests
et tranches de la spec initiale sont alignées, ainsi que les instructions actives
et `docs/NATIVE-SUPERVISION.md`. Les décisions acceptées historiques restent immuables ;
un ADR de remplacement consigne le changement approuvé. Aucune migration
forcée, fermeture de surface ou reprise de session en cours n'est effectuée.

Exception transitoire explicite : le hook `herdr-metadata` reste hors périmètre,
suivi par DEV-1134. Sa présence empêche de prétendre que tout le dépôt est déjà
sans dépendance Herdr. Le plugin externe reste sous la responsabilité de Folpe.

## Vérification et livraison

- `void-implement` et TDD : schéma, trois moments d'émission sur faux runtime,
  refus et reprises, idempotence, fin de tour distincte de clôture, absence d'attach,
  missions multiples, worktrees communes et diagnostics de lecture partielle.
- Une preuve réelle de la phase worker d'Autopilot : unité bornée autorisée,
  runtime natif réel et nouvelle worktree, événements observés puis snapshot avec
  ticket et worktree pendant l'exécution. Une fixture ou un lancement uniquement
  par l'ancien `agents dispatch` ne satisfait pas cette preuve.
- L'essai s'arrête à la remise locale du worker, avant push et PR. Ce n'est pas une
  preuve du cycle complet de livraison Autopilot. Les sessions préexistantes restent
  intactes : aucun arrêt, redémarrage ou changement de leurs permissions.
- Doc courte définitive dans `docs/`, commit local après vérification. Push et PR
  attendent une autorisation distincte. L’accord sur cet amendement ne vaut pas autorisation de push ou de PR.
