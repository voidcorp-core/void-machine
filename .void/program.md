---
schemaVersion: 1
status: executing
program: void-machine-simplification
plan: docs/plans/2026-11-23-void-machine-simplification-plan.md
spec: docs/plans/2026-11-23-void-machine-simplification-decisions.md
progress:
  provider: linear
  scope: voidcorp/DEV/void machine
  order: [DEV-1372]
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
