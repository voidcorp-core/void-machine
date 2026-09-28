---
title: Merge autonome d'autopilot sans infrastructure chez le consommateur
date: 2026-09-28
status: approved
author: Folpe + Claude
ticket: DEV-920
related:
  - 2026-09-22-autopilot-native-loop.md
  - 2026-09-28-supervised-agent-delegation.md
  - ../decisions-log/2026-09-24-review-check-from-its-own-app--03e82acc-0f4b-4718-9b88-3d1b2acd4903.md
---

# Merge autonome sans infrastructure chez le consommateur

## Constat

Un projet consommateur ne peut pas faire tourner la boucle autopilot 4.0. `openPullOutcome`
attend le check `independent-review` avant de lire `mergeGate`
(`packages/cli/src/lib/autopilot/loop.ts:797`), et ce check exige une App GitHub, un
environnement, deux secrets, deux variables et une branch protection, qu'aucun fichier publié
n'installe. Observé sur `voidcorp-core/void-cortex` en `voidmachine@4.0.0`. Même en merge humain,
chaque PR attend indéfiniment.

## Décision

Principe de Folpe : un consommateur a un fonctionnement simple en apparence, fiable et sûr ; la
sécurité ne se paie jamais en fonctionnement ; il ne crée jamais d'App GitHub.

- **Un seul mode.** Les clés `mergeGate` et `trust` n'existent pas. Par défaut, la boucle merge
  seule dans la branche d'intégration. Jamais dans la branche qui déploie ; un chemin protégé
  part toujours chez un humain.
- **Merge humain sur demande.** Quand l'humain dit qu'il merge lui-même, le coordinateur lance
  `void-machine autopilot merges --by-human`, qui écrit `merges: human` dans le bloc
  `autopilot` de `.void/program.md` ; `--automatic` retire la valeur. Versionné, lu à chaque
  tick, indépendant de la mémoire d'un agent. Une instruction réduit l'autorité, jamais ne
  l'augmente.
- **Conditions du merge**, toutes observées sur le même SHA de tête :
  1. un verdict sans bloquant, rendu par un relecteur à contexte neuf et en lecture seule que le
     noyau lance lui-même (délégation de rôle `review`, spec
     `2026-09-28-supervised-agent-delegation.md`) et enregistré dans le journal local ;
  2. aucun check GitHub en échec ni en attente sur ce SHA ;
  3. aucun chemin protégé touché ;
  4. branche à jour avec la base.

  Merge par `gh pr merge --match-head-commit <sha>` : GitHub refuse si la tête a bougé.
- **Aucun verdict lu sur GitHub.** Sur un dépôt public, n'importe qui peut commenter. Le verdict
  local fait foi ; un commentaire en est la copie pour les humains.
- **Couche GitHub native et optionnelle.** Un dépôt qui veut davantage ajoute des checks requis
  par branch protection ; GitHub les applique seul au moment du merge. void-machine garde ainsi
  son App de revue, configuration propre à ce dépôt. Le produit ne livre ni App, ni workflow de
  revue, ni prérequis `doctor` associé.
- **Sans CI**, un projet reste autonome : les vérifications locales du worker et le relecteur
  indépendant couvrent la PR. `doctor` continue de recommander `enforce` sans l'imposer.

## Risque résiduel accepté

Un worker désobéissant, sur la machine du propriétaire, pourrait écrire un faux verdict local.
Bornes : le lien au SHA, les chemins protégés (la machinerie ne change pas sans humain),
l'empreinte d'état Git partagé autour de chaque unité, et la promotion humaine vers la branche
qui déploie. Un dépôt qui ne peut pas accepter ce risque ajoute des checks requis côté GitHub.
L'ADR qui remplace `03e82acc` l'écrit tel quel.

## Transitions touchées

- `openPullOutcome` ne lit plus `pr.review` (check GitHub) : il lit le verdict local du SHA. Pas
  de verdict pour ce SHA : action `review`, qui délègue un relecteur ; verdict bloquant : retour
  au worker, comme aujourd'hui.
- `mergeOutcome` : `merges: human` rend la PR à l'humain après la revue, jamais avant ; sinon
  merge direct `--match-head-commit`. Une base avec merge queue ou checks requis garde le chemin
  auto-merge existant, que GitHub arbitre.

## Tests et preuves

- **Strict** : table des transitions de `loop.ts` (verdict absent, bloquant, sain ; checks en
  échec, en attente, absents ; `merges: human` ; tête déplacée), écriture et lecture de
  `merges` dans le programme.
- **Preuve réelle** : sur un dépôt consommateur sans App ni protection, `update` puis un ticket
  va jusqu'au merge dans la branche d'intégration ; avec `merges: human`, la PR s'arrête prête.

## Tranches

1. `merges: human` ne dépend plus d'aucun check de revue (correctif isolé, publiable seul).
2. Verdict local lié au SHA, action `review` via la délégation, merge `--match-head-commit`,
   commande `autopilot merges`, ADR remplaçant `03e82acc`, mise à jour du skill `void-autopilot`.
