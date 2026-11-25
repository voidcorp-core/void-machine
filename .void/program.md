---
schemaVersion: 1
status: executing
program: void-machine-simplification
plan: docs/plans/2026-11-23-void-machine-simplification-plan.md
spec: docs/plans/2026-11-23-void-machine-simplification-decisions.md
progress:
  provider: linear
  scope: voidcorp/DEV/void machine
  order: [DEV-1372, DEV-1373, DEV-1374, DEV-1375, DEV-1376]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: []
autopilot:
  schemaVersion: 2
  enabled: true
  clusterSize: 1
  base: develop
  deployBranch: main
  verifyCommands:
    - [pnpm, build]
    - [pnpm, test]
  ownership:
    sequential:
      - pnpm-lock.yaml
      - packages/cli/core-assets/**
      - packages/harness-graph/model.json
      - packages/harness-graph/catalog.v3.json
    reconcileOnly: []
  protectedPaths: []
---

# Épuration de Void Machine

Lancement explicitement autorisé par Folpe le 23 novembre 2026 : « ok go en autopilot ».
Le plan approuvé borne les neuf lots ; le relevé des décisions porte les choix acceptés.
Seuls les tickets complets inscrits dans cet ordre sont admissibles. Les lots suivants
seront préparés dans le même périmètre après la première tranche ; aucun ancien ticket
n'est repris implicitement. Les dépendances natives et l'état Linear font autorité.

Le programme release-4-stabilization précédent est terminé selon son jalon Linear,
clôturé le 15 octobre 2026. Son descripteur reste dans l'historique Git et une copie
locale intégrale est conservée sous .void/machine/autopilot/.

La reprise n'accorde aucune permission supplémentaire : holds, revue indépendante,
checks, empreinte Git et chemins protégés restent applicables. Les PR touchant le
plancher protégé vont à une personne ; aucune promotion vers main ni publication.
Le checkpoint conserve l'intention de reprise ; il n'accorde aucune autorisation.

Le programme `ci-economy-2026-11` présent sur develop est conservé dans Git, avec
ses plan et spec du 5 novembre inchangés. Au 23 novembre, DEV-1204, DEV-1139,
DEV-1140 et DEV-1141 sont terminés dans Linear ; DEV-1142 à DEV-1145 restent Todo.
La demande explicite d'épuration remplace la sélection de travail de cette session,
pas l'état ni l'acceptation de ces tickets. Ils ne sont ni repris automatiquement
ni déclarés terminés. Le lot L8 réconciliera leur périmètre avec les décisions
approuvées, notamment le build/pack de DEV-1143 et le retrait de ProjectGraph.
