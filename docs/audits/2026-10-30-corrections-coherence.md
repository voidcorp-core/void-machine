# Correction de la cohérence des instructions

Date : 30 octobre 2026. Mission autorisée : corrections locales, sans push, merge,
modification de protections GitHub ou action sensible externe.

## Autorité et périmètre

Le [rapport initial](2026-10-30-coherence-des-instructions.md) est conservé sans
modification. Il observait `2a8994f1792bff5e66cb4cdecdfc040d0ae5fb46`, branche
`docs/2026-10-01-strategic-audits`, sources 4.0.0 et installation locale 6.0.0.
La correction part de `5309dda97a1f38283a12fae3f3f2a2ed704f1c97` sur `develop`,
descendant du tag 6.0.0, dans un worktree isolé. Les changements locaux du checkout
historique restent préservés. La date ou le numéro le plus élevé ne décide pas seul.

Les ADR acceptés font autorité sur les choix, et le code invoqué sur les garanties
réelles. En particulier, ADR `6660e476` adopte le verdict local lié à la tête exacte;
ADR `b75aa91f` supprime l'ancienne exception App du dépôt. Aucun mécanisme App
historique n'est réintroduit. ADR `f8861a2b` désigne le runner Node partagé.
ADR `5992e7d8` protège la doctrine source canonique contre un paquet plus ancien,
pas une copie installée devenue obsolète.

La version 6.0.0 du manifeste local ne prouvait pas que chaque fichier provenait du
paquet 6.0.0 : le mode source préservait puis réattestait l'ancienne copie installée
de PHILOSOPHY. L'installation publiée et la compilation self-host des sources
restent deux responsabilités distinctes. Aucun hook publié de la racine n'a été
remplacé par un bundle de développement.

## Qualification des 25 constats

« Contradiction » désigne deux règles actives incompatibles; « décalage » distingue
sources, installation et exécution. « Intentionnel » et « historique » ne justifient
pas une fausse promesse dans les surfaces chargées.

| Constat | Qualification sur la base de correction et règle propriétaire | Disposition |
|---|---|---|
| C01 | Décalage de routage réel. ADR `f8861a2b`, manifestes natifs et runner `protected-file`. | Ajouter Bash au matcher Claude. Tester le routage compilé et le runner pour lockfile, `.env` et cible autorisée. Documenter les limites de l'extracteur, de confiance et d'invocation native. |
| C02 | Contradiction réelle dans l'exemple et défaut de traitement du Result `markCompleted`. Le propriétaire est `withWebhookSafety`. | Supprimer le handler concurrent du skill serveur, composer l'exemple canonique testé; refuser le succès si la persistance d'achèvement échoue. Échec et livraison en cours restent réessayables; seuls les événements achevés sont doublons. |
| C03 | Décalage de contrat : le wrapper délègue déjà correctement à `verify`; l'option documentée `replayWindowMs` n'existe pas. | Corriger l'exemple contre l'API réelle. Le vérificateur fournisseur possède signature et fraîcheur de la tentative signée, pas l'âge métier de l'événement. Pas de nouveau moteur cryptographique ni fenêtre universelle. |
| C04 | Divergence de versions/histoire, pas conflit à résoudre en réappliquant les règles 4.0.0. ADR `6660e476`, puis `b75aa91f`. | Le candidat suit les décisions intégrées. Le checkout 4.0.0 est conservé comme contexte historique, pas présenté comme synchronisé avec les sources 6.0.0. |
| C05 | Décalage installation/source réel. ADR `5992e7d8`; propriétaire `installDoctrineFiles`. | En mode source, dériver l'installation de `docs/PHILOSOPHY.md` sans modifier cette source. Si elle manque, conserver la copie précédente, sinon utiliser le paquet. Réconciliation locale bornée séparée du développement. |
| C06 | Contradiction réelle de formulation. ADR `6660e476`, contrat autopilot schema 2. | Clarifier les blocs AGENTS/CLAUDE, leur générateur et ARCHITECTURE : holds humains, chemins protégés et promotion restent humains; intégration autonome uniquement avec consentement et tête admissible. |
| C07 | Ancienne formulation encore opérationnelle dans le plan de release. ADR `3a1219d9`, commande `arm`. | Corriger le plan : admission de la tête exacte avant armement, pas à l'ouverture. RELEASING était déjà corrigé sur la base intégrée. |
| C08 | Divergence intentionnelle de budget devenue ambiguë. Spec autopilot du 22 septembre et kernel `loop.ts`. | Expliciter l'exception : deux revues au total en autonome, contre revue initiale plus deux lots de corrections dans le cycle normal. Ne pas augmenter le budget du kernel. |
| C09 | Documentation/mécanisme historique non applicable. Le script secondaire de l'ancien backlog-loop n'est câblé dans aucun manifeste natif. | Retirer ce script, son override AUTO_MERGE, ses tests dédiés et sa fausse relation d'enforcement. Marquer spec/plan anciens comme archives. ADR historiques conservés. |
| C10 | Contradiction réelle avec le propriétaire `boundary-direction.ts` : dépendances déclarées au manifeste, pas topologie universelle en étoile. | Une procédure dans dependency-direction; service-package et module monorepo y renvoient. La revue possède les couches internes; tsconfig et hook ne les prouvent pas. |
| C11 | Contradiction réelle dans hexagonal. Security-guidance et la frontière de confiance font autorité. | Valider l'entrée externe dans l'adapter avant use-case; garder les invariants métier dans le domaine. |
| C12 | Ambiguïté réelle de sens. Security-guidance interdit les secrets. | Distinguer identifiant de corrélation non secret et identifiant/cookie de session d'authentification, jamais journalisé. |
| C13 | Contradiction réelle. Le contrat d'erreur et le reviewer silent-failure font autorité. | Un log seul n'est pas une récupération : propager l'échec typé, lever ou effectuer une récupération explicite valide. |
| C14 | Corruption de grammaires techniques. Conventional Commits et niveaux logger. | `refactor` comme type de commit et `debug` comme niveau; conserver les préfixes uniquement pour les noms de skills. |
| C15 | Historique déjà résolu sur la base intégrée. QA, debug et commit-discipline exigent RED observé avant correction, commits séparés optionnels. | Pas de nouvelle règle ni de changement de comportement. |
| C16 | Historique déjà résolu sur la base intégrée. TDD lit `.void/config.json`. | Pas de correction additionnelle; le hook conserve sa configuration propriétaire. |
| C17 | Décalage documentaire réel avec `tdd-order` et l'adapter natif. | Remplacer la vieille pseudo-spécification shell par le contrat effectif : existence d'un test, modes, reconstruction, pas exécution ni RED attesté. Distinguer suppression de fichier et édition supprimant des lignes. |
| C18 | Décalage réel du prédicat et exception documentaire fictive. | Ajouter fit/fdescribe et describe.skip aux chemins réellement invoqués, avec tests AST positifs et prose autorisée. Supprimer la whitelist fictive; conserver todo. |
| C19 | Décalage réel de sévérité et portée lexicale. Le propriétaire `test-name.ts` bloque déjà. | Documenter le blocage existant et ses motifs réels; ne pas affaiblir la règle ni ajouter une analyse sémantique. |
| C20 | Fausse garantie d'enforcement. Script PR-text facultatif, absent des manifestes natifs et de CI. | Corriger skills, métadonnées et relation : la revue inspecte les captures; le script heuristique ne les valide pas. Aucun nouveau gate visuel. |
| C21 | Principal conflit déjà résolu; précision de périmètre utile. Le provider possède le progrès du programme. | Réserver le resume point au plan séquentiel autonome; aucun current/next dans le plan d'un programme. |
| C22 | Décalage documentaire réel. Journaux propriétaires `.void/machine/runs/*/events.jsonl`. | Corriger CLI, ARCHITECTURE et HARNESS_EVOLUTION; anciennes activations/usage restent de l'historique lu seulement. |
| C23 | Historique déjà résolu : ARCHITECTURE indique la perte possible d'exécution, reçus et preuves de reprise. | Conserver le contrat de rétention explicite; ne pas déclarer `.void/machine` supprimable sans perte. |
| C24 | Décalage réel entre observations partielles et suggestion d'absence. `analyzeSynergy` possède l'éligibilité. | Compter pour la retraite seulement les sessions avec observations dans la même famille; exclure les inconnues. Dire « aucune invocation observée ». Même ce seuil ne prouve pas une instrumentation exhaustive; décision humaine. |
| C25 | Contradiction réelle avec l'ADR du 1er juin et la philosophie : assouplissement pour code, docs et commits, sans gate. | Supprimer l'interdit ASCII absolu et le hook fictif du skill de commit; suivre la règle de prose canonique. |

## Preuves comportementales et portée

Les commandes ciblées utilisent `pnpm exec vitest run <fichiers> --maxWorkers=1`.
Les journaux bruts de cette mission restent sous `.void/machine/coherence-instructions-20261030/`;
ils sont locaux et ne remplacent pas le présent bilan versionné ni les tests reproductibles.

- P1 RED avant modification des propriétaires : trois échecs réels, dix succès.
  `runtime-assets.test.ts` : aucun hook protected-file sélectionné pour Claude/Bash.
  `withWebhookSafety.test.ts` : persistance d'achèvement échouée mais status 200.
  `webhook-example.test.ts` : exemple canonique refusé par TypeScript (`replayWindowMs`).
- P1 GREEN initial : trois fichiers, treize tests. Matrice étendue ensuite : trois
  fichiers, vingt tests. La commande effectivement sélectionnée dans chaque manifeste
  est exécutée contre le bundle, sans exécuter la commande shell contenue dans le payload.
- Webhook : échec puis retry réussi, doublon achevé sans second effet, concurrent
  pending non acquitté, échec de marquage non acquitté, signature/fraîcheur invalides
  refusées avant claim/handler, événement métier ancien accepté si `verify` l'autorise.
  Le magasin de test est en mémoire; son exclusivité ne certifie aucun adapter de base
  de données. Les effets externes nécessitent leur propre clé idempotente ou transaction/outbox.
- Anti-rejeu : le RED concernait la promesse/documentation, pas un refus déjà défectueux
  du wrapper. Les callbacks de test prouvent l'ordre et la propagation du contrat;
  ils ne certifient ni cryptographie fournisseur ni précision d'une horloge distante.
- Lot 2 RED : copie dérivée obsolète préservée, variantes de test focalisé acceptées,
  sessions tool-only comptées comme absence d'agent. GREEN : quatre fichiers,
  121 tests (`init`, quality-rules, syntax-analysis, synergy/analyze).
- Codex CLI 0.166.0 installé : sonde native réelle, hook trusted existant, lockfile
  synthétique refusé par PreToolUse/PROTECTED_FILE et cible absente. Cette preuve
  porte sur l'installation publiée du checkout original, pas sur tout le candidat.
- Claude CLI 2.1.314 : première sonde arrêtée avant outil par budget; seconde
  commande refusée par le hook du runtime parent. Aucune invocation native Claude
  du candidat n'est revendiquée. Le routage compilé et la décision runner sont prouvés.

Les docs officielles distinguent elles aussi branchement, confiance et couverture :
[Codex hooks](https://learn.chatgpt.com/docs/hooks#tool-coverage),
[Claude PreToolUse](https://code.claude.com/docs/en/hooks#exit-code-2).
La fraîcheur fournisseur porte sur la livraison signée et ses retries :
[Stripe replay prevention](https://docs.stripe.com/webhooks#preventing-replay-attacks).

## Installation et limites de livraison

Le coordinateur a réconcilié la racine historique avec sa propre source canonique,
par la transaction d'installation existante : seule la copie installée PHILOSOPHY,
son hash dans install-manifest et son reçu ont changé. Le bundle de protection publié
et les autres fichiers inventoriés sont conservés. Cela ne transforme pas le checkout
historique 4.0.0 en sources 6.0.0. Le candidat reste isolé et ses assets sont régénérés
par `pnpm derive`; le self-host vérifie la compilation des sources sans remplacer le
plancher publié actif. Une future installation de ce candidat reste distincte d'une
protection effectivement invoquée et vérifiée dans chaque runtime.

Les 25 dispositions ne constituent pas une preuve d'absence de toute contradiction
historique ou de tout comportement shell contournant un extracteur lexical. Les
protections GitHub, fournisseurs distants et adaptateurs de persistance consommateurs
n'ont pas été modifiés ni recertifiés. Aucun nouveau framework de gouvernance,
moteur sémantique générique ou dépendance cryptographique n'a été ajouté.

## Validation finale

Le catalogue local a été exécuté une fois avec
`pnpm verify --changed-from 5309dda97a1f38283a12fae3f3f2a2ed704f1c97` :

- CPU : 249 fichiers, 2 560 tests réussis.
- Filesystem : 166 fichiers, 2 217 tests; un échec initial du compteur README
  après retrait du hook historique. Compteur propriétaire corrigé; suite ciblée 13/13 réussie.
- Subprocess : 126 fichiers, 1 802 tests; quatre échecs initiaux ENOENT du garde
  d'identité lisant le hook retiré encore présent dans l'index Git. Suppressions
  enregistrées; garde inchangé, suite ciblée 16/16 réussie.
- Réseau/navigateur : cinq fichiers, 103 tests réussis, sonde loopback disponible.
- Tous les autres gates du catalogue passent : build, typecheck, lint (49 warnings,
  aucune erreur), parités, versions, anti-bloat, décisions, sécurité de publication,
  taille, graphe, assets, références et compilation self-host.

Le journal global conserve son exit 1 et ses cinq échecs initiaux; il n'est pas
réécrit en « tout vert ». Les 6 682 tests observés sont complétés par leurs preuves
ciblées de résolution. Aucun test/gate n'a été désactivé ni seuil abaissé.
Après la dernière consolidation des sources et leur dérivation, les neuf suites
affectées passent ensemble : **170/170 tests**. Les validations non affectées sont réutilisées.

`pnpm derive` a régénéré les projections et le miroir depuis leurs propriétaires.
Le self-host final compile **141 fichiers**, source **72b7513e27ef**, et son doctor
est sain. Ses champs `fired=true` proviennent du smoke qui invoque le runner installé
et vérifie l'événement canonique; les smokes de version/adapter ne constituent pas
la preuve d'un appel outil réel émis par chaque CLI natif. La limite Claude ci-dessus
reste donc explicite. Cette compilation est isolée sous `.void/machine/generated/`.

Les journaux `verify.log`, `candidate-green.log`, `selfhost-sync.log` et
`selfhost-doctor.log` sont conservés avec les RED/GREEN sous le dossier local de mission.
La revue indépendante du commit candidat reste une étape distincte. La CI serveur
sur la tête exacte sera requise avant toute intégration future; aucun push ou merge
n'est effectué dans cette mission locale.
