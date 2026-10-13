---
title: Livrer l'orchestration native Herdr sans cockpit
date: 2026-10-08
status: executing
spec: docs/specs/2026-10-08-native-herdr-orchestration.md
ticket: DEV-1016
author: Folpe + Codex
high_risk: true
---

# DEV-1016 : plan d'exécution

## Goal

Appliquer la conception approuvée avec les amendements A à E : identité label +
worktree, documents de mission centraux, sous-agents courts natifs, workers Herdr,
métadonnées projet et maintien des preuves de revue. Florent a explicitement demandé
« intègre-les dans la spec, puis planifie et implémente » ; le présent plan exécute
ce mandat sans nouvelle porte d'approbation documentaire. DEV-1017 suit dans Linear.

## Préconditions observées

Herdr 0.9.0 ne possède pas resume_argv : disponibilité à partir de 0.9.2 prouvée par
le schéma/changelog officiel. Pas de mise à jour, de redémarrage ni de modification
des quatre surfaces globales interdites. La preuve de restart réel reste non exécutée.
Les tokens ont un TTL par clé et une priorité de dernière écriture, sans namespace
par source. Collision ctx/ticket avec cockpit documentée dans la spec et signalée.

## Steps

### Step 1 — Reprendre une mission depuis ses fichiers et la liste Herdr

- **Goal** : première tranche utilisable : lire/valider mission et rapport, retrouver
  un worker par label + worktree, refuser les ambiguïtés et rendre les indices à ORCH.
- **Depends on** : aucune.
- **TDD mode** : strict.
- **Fichiers** : petit contrat orchestra dans packages/hook-runner/src/lifecycle/
  (codec strict, lecture bornée, résolution pure séparée de l'I/O), tests colocalisés,
  recette du nouveau skill dans packages/core/skills/, source et note d'adaptation.
- **Verification gate** : tests de YAML invalide/inconnu, alias, symlink, traversal,
  taille, mission étrangère, homonymes, ID changé après restart, pair ambiguë,
  rapport périmé/étranger ; typecheck hook-runner. Aucune écriture de mission par le hook.
- **Expected commits** : test(orchestration) puis feat(orchestration).
- **Notes** : réutiliser yaml via dépendance déclarée/version résolue si nécessaire,
  jamais un parseur YAML maison. Pas de nouveau service résident. ORCH est seul
  auteur de mission.md et brief.md, le worker de son report.md ; écritures atomiques.

### Step 2 — Publier les tokens depuis les événements réels

- **Goal** : publier source void-machine sur la cible revérifiée, sans inventer ctx.
- **Depends on** : Step 1.
- **TDD mode** : strict.
- **Fichiers** : packages/hook-runner/src/lifecycle/herdr-metadata.ts et tests,
  cli.ts/cli.test.ts ; manifests packages/core/codex/hooks.json et
  packages/core/.claude-plugin/plugin.json ; tests lifecycle et parité correspondants.
- **Verification gate** : source/events exacts, clear retire ctx avant nouvelle mesure,
  Stop relit le rapport, clôture/SessionEnd retirent les clés ; TTL par clé 86400000
  ou 7200000 ms ; seq BigInt exact et croissant ; absence de mission, transport
  absent, timeout, cible étrangère/ambiguë et état terminal ; pas d'écriture globale.
- **Expected commits** : test(hooks) puis feat(hooks).
- **Notes** : réutiliser la continuité existante pour une mesure fraîche attestée,
  sans élargir la lecture de transcriptions arbitraires. Diagnostic explicite pour
  les données indisponibles. Commandes shell:false, sorties bornées, délai total borné.

### Step 3 — Migrer les appelants et préserver l'admission des revues

- **Goal** : aucun spécialiste court capturé ; un chemin documenté pour les workers
  Herdr et leurs fichiers, sans rendre un rapport auto-déclaré suffisant au merge.
- **Depends on** : Steps 1 et 2.
- **TDD mode** : strict pour logique, souple pour wiring couvert par contrat.
- **Fichiers** : skills implement/autopilot et nouveau skill d'orchestration ;
  packages/cli/src/lib/claude-md.ts ; AGENTS.md et CLAUDE.md ;
  docs/NATIVE-SUPERVISION.md, docs/ARCHITECTURE.md ; retirer le câblage et la capture
  dans hook-runner/lifecycle/delegation-capture.ts et ses preuves devenues exclusives.
  Adapter packages/cli/src/commands/autopilot-review.ts et ses tests si la collecte
  indépendante native l'exige ; réutiliser review-receipt et specialist-lifecycle.
- **Verification gate** : tests des skills, native short delegation sans interception,
  provenance de revue native/artifact liée au commit/base/critères, rejet de résultat
  auto-proclamé ou périmé ; autopilot-review/loop/judgments et bounded-review verts.
- **Expected commits** : test(delegation) puis feat(delegation).
- **Notes** : ne pas supprimer la collecte des runs legacy en cours ni leurs journaux.
  Pas de réécriture du contrôleur de mission. Retirer seulement les composants sans
  appelant réel. L'artefact de revue reste dans la frontière projet existante ; le
  rapport central ne remplace pas cette preuve. Aucun changement de politique de merge.

### Step 4 — Éprouver le livrable et préparer la PR

- **Goal** : artefact construit, preuves locales et réelles traçables, limites honnêtes.
- **Depends on** : Step 3.
- **TDD mode** : souple pour les contrats de distribution, strict si correction.
- **Fichiers** : tests de distribution/conformité existants, documentation des preuves
  et limites ; assets régénérés via pnpm derive et builds propriétaires.
- **Verification gate** : pnpm build, pnpm typecheck, pnpm lint, pnpm test et gates
  générés applicables ; source/mirror, skill references, décisions, doctrine sœur ;
  exécution réelle de lecture/projection sur mission contrôlée et revue indépendante
  du commit final, avec maximum deux lots de correction ciblés.
- **Expected commits** : test(conformance), build(assets), corrections ciblées si requises.
- **Notes** : ne pas activer de nouveaux hooks dans les configurations personnelles.
  Ne pas toucher d'autres workspaces ni arrêter de serveur. Les scénarios qui
  demandent restart, /clear d'un ORCH actif ou manipulation de Cortex demeurent
  explicitement non exécutés sous ces limites ; ne pas annoncer ces AC acquis.
  Publication/release et fusion de cette PR restent humaines.

## Review checkpoints

Les spécialistes relisent le plan avant la première ligne de logique ; une revue
indépendante juge le commit final avant PR prête. Seuls défauts bloquants concrets
requièrent correction ; deux lots maximum, puis arbitrage humain si non résolu.
Aucun checkpoint documentaire additionnel ne suspend le mandat d'implémentation.

## Execution handoff

Unité unique DEV-1016 : Step 1 → Step 2 → Step 3 → Step 4. Linear porte l'état.
Un seul auteur pour code et corrections ; coordinateur pour intégration, preuves,
revue et suivi. DEV-1017 conserve son blocage jusqu'au résultat de cette tranche.

## Self-review

Chaque tranche possède ses fichiers, modes, dépendances et échecs attendus. Les
capacités Herdr absentes sont nommées ; les preuves non autorisées ne sont pas
remplacées par des tests factices annoncés réels. Aucun nouveau parseur, démon ou
registre d'identité concurrent n'est prévu. Les garanties de merge sont conservées.

## Préparation observée

Huit spécialistes natifs ont rendu un avis le 8 octobre : sécurité, API, QA,
architecture, exploitation, données, expérience, produit. Aucun bloqueur concret
avant code ; exploitation demande les bornes désormais précisées dans la spec.
Architecture déclare une limite sur les preuves de code absentes avant implémentation.
Les résultats réels sont conservés localement dans /private/tmp/dev1016-panel/ et
leur synthèse dans /private/tmp/dev1016-panel-report.md. L'ancien parseur de reçus
refuse les noms de contexte natifs et son alternative artifact exige déjà un sujet
commité pour la préparation : aucun identifiant ou événement n'a été inventé.
Cette limite n'annule pas les avis ; la revue finale portera un commit exact.

## Preuves d’implémentation et point de reprise

Les étapes 1 à 3 sont implémentées dans le candidat 6b42cc7a, corrigé par
f8ea02fc. L’étape 4 reste partielle tant que les scénarios opérationnels ci-dessous
ne sont pas prouvés. Le passage indépendant a trouvé un défaut de conservation
des bloqueurs dans la collecte native ; la correction réutilise la réconciliation
canonique et exige des preuves valides et fraîches pour effacer un défaut antérieur.
La relecture ciblée du même reviewer est consignée dans la PR, sans second passage
général. La spec reste le jeu de critères approuvés, sans changement de son contenu.

| Contrôle | Observation sur le candidat |
| --- | --- |
| Tests CPU | 2 234 réussis |
| Tests filesystem | 2 092 réussis |
| Tests subprocess | 1 558 réussis, un ignoré, relance complète sur sources figées |
| Tests réseau | 103 réussis ; serveur loopback autorisé après refus initial du sandbox |
| Build / types / lint | Réussis ; 48 avertissements lint existants |
| Distribution | Dérivation, miroir, skills, versions, bundle, tarballs et taille vérifiés |
| Décisions | 244 valides ; immutabilité vérifiée contre bc1722cb |
| Paquet après correction | 2 128,5 kB, plafond 2 173 kB selon politique du script de mesure |
| Hook | Chaud 1,75 ms ; CPU ajoutée 8,48 ms ; ancien seuil froid dépassé, DEV-662 |

Le premier passage subprocess avait échoué dans init/doctor. Le test isolé et la
relance complète réussissent sans changement de code ; la cause n’est pas prouvée.
Les modifications de sources pendant le premier passage constituent une hypothèse,
pas une conclusion. Les quatre lanes finales réussissent sur le code figé.

Lecture réelle de la mission centrale et appariement ORCH/WORK-1 réussis. Le hook
livré a publié les statuts du rapport sur le seul pane WORK-1 : un premier succès
Herdr à stdout vide a révélé une erreur de parsing, reproduite puis corrigée. Le
rejeu final a produit `wstatus=done` et l’événement
`evt_e7b369bc-8e17-4da6-aa6f-2014b955129f` avec `status=ok`, `published=1`, contexte
non mesurable. Aucun token workspace n’a été modifié par cette vérification.

Les scénarios réels dans Cortex, deux runtimes, clear ORCH, kill/resume et restart
Herdr restent non exécutés. Le serveur 0.9.0 ne peut pas conserver resume_argv,
introduit en 0.9.2. Aucun serveur n’a été modifié et aucun nouveau hook personnel
n’a été activé. Le garde cockpit codex-session reste en place.

L’empreinte du fichier personnel Claude settings.json a changé pendant la session,
sans écriture attribuée à cette mission. Le fichier a été conservé ; il serait
incorrect de déclarer toutes les empreintes personnelles inchangées. Les autres
surfaces protégées vérifiées correspondent à leur empreinte initiale.

L’avancement Linear demeure dans le fournisseur : DEV-1016 In Progress, DEV-1017
bloqué par DEV-1016. Le connecteur MCP est absent de cette session ; aucune réussite
d’une mise à jour distante n’est déduite des fichiers locaux.

### Correction bornée et preuves de revue

Reviewer réel : `/root/dev1016_final_review`, distinct de WORK-1. Sujet initial :
6b42cc7a987ec62eb4c43bc89f9704ddeee41f69, base
bc1722cb1dc5cf3487b26804b9117b966620eea2, critères
sha256:505fd61149172348707b8a4f7fd0caf52301c47a620ef653e4eb6871afadaf1a.
Les six dimensions ont été parcourues ; un seul bloqueur, aucun autre finding.

Lot correctif 1/2, f8ea02fc : huit cas reproduisaient avant correction l’admission
indue de résolutions omises, non résolues ou de preuves absentes, altérées, échouées,
périmées, étrangères ou postérieures au reçu. Les 137 tests ciblés de collecte,
admission et boucle de revue, puis les 25 tests de commande avec Git réel, réussissent.
Le succès avec une preuve fraîche est aussi couvert. Les tests intermédiaires en
échec restent dans les logs, notamment un dépassement de délai de dix secondes ;
le test final passe sans relever ce délai. Types globaux, lint ciblé, build et
dérivation sont vérifiés après correction. Les suites non affectées sont réutilisées.

Aucun taux de couverture instrumentée n’est affirmé : aucun provider n’est déclaré
dans le package racine ou la configuration Vitest. Le projet déclare
mutationRunner:none. Les preuves de comportement RED/GREEN sont conservées.

La préparation avait utilisé un bundle différent et une spec comme identité de
ticket dans la mission canonique. Aucun reçu canonique n’a été fabriqué pour
compenser cette limite. La provenance de la vraie revue native et ses conclusions
sont conservées comme preuves de cette PR ; elles ne constituent pas une admission
autopilot ni une autorisation de merge.

Point de reprise : achever la relecture ciblée et ouvrir une PR brouillon avec son
bloc Review Evidence ; conserver les scénarios réels non exécutés comme limites.
DEV-1017 peut être préparé, mais aucune configuration personnelle ni aucun serveur
ne change sans la validation explicite demandée par Florent.
