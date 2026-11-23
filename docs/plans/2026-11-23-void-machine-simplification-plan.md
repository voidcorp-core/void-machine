---
title: Épurer Void Machine sans réduire la fiabilité du code produit
date: 2026-11-23
status: in-progress
ticket: DEV-1372
authority: décisions utilisateur du 20 au 23 novembre 2026, consolidation autorisée le 23 novembre
decisions: ./2026-11-23-void-machine-simplification-decisions.md
author: Folpe + Codex
high_risk: true
tickets: [DEV-1372, DEV-1373, DEV-1374, DEV-1375, DEV-1376, DEV-1393]
---

# Épuration de Void Machine

## Résultat attendu et autorité

Produire un harnais plus simple, rapide et maintenable, qui aide à livrer du code
fiable. Retirer le formalisme, les moteurs de suivi inutilisés et les validations
redondantes ; conserver les protections qui évitent un défaut concret. Aucun
nouveau moteur de scoring, orchestrateur, service de cache ou framework de contrôle.

Les décisions ont été approuvées une par une dans la conversation. Le
[relevé détaillé](2026-11-23-void-machine-simplification-decisions.md) conserve leur
périmètre, leurs réserves et leurs remplacements. Le présent plan fixe l'ordre
d'exécution ; il ne redemande pas ces approbations. Ces deux documents ne sont ni
une configuration runtime ni du contenu à injecter au démarrage des consommateurs.
La capture des règles suit toujours `void-learn`, dans le périmètre déjà autorisé.

Ce plan ne lance pas Autopilot, ne crée pas de tickets distants et n'autorise ni
publication npm, ni promotion vers `main`, ni modification de paramètres GitHub,
ni déploiement de télémétrie. Les arbitrages utilisateur et l'acceptation finale
restent conformes à [la vocation de Machine](../MACHINE-VOCATION.md).

## État de départ observé le 23 novembre

- Branche locale : `chore/installed-floor-7`, HEAD `b5140f286f0b818aa57323811404d9561b7c9077`.
- **Herdr corrigé** dans ce commit : découverte facultative, diagnostic bref,
  aucun interdit général sur le dépôt et vérification des cibles conservée.
  Les régressions sources/installées et les bundles ont été vérifiés auparavant ;
  la revue indépendante a conclu sans bloqueur. Le branchement SessionStart est
  rétabli. Ces tests n'ont pas été rejoués pour la seule rédaction du plan.
- **Premier retrait lexical en cours**, non commité : règles `test-name` et
  `design-slop`, copies livrées et tests associés. Préserver ce travail et le retrait
  local préexistant de `context-continuity` dans `.codex/hooks.json`.
- Les autres décisions restent majoritairement **à implémenter**. Leur approbation
  ne prouve ni leur activation locale, ni leur distribution aux consommateurs.
- Aucun export Grafana/Alloy ni service sur le NAS n'a été activé par cet exercice.

Avant chaque lot, relire le diff réel et les commits intervenus depuis ce relevé.
Ne pas synchroniser une branche sale par reset, stash partagé ou écrasement.

## Protections qui restent

| Risque concret | Protection conservée | Coût accepté et périmètre |
| --- | --- | --- |
| Secrets écrits ou divulgués | Détection avant écriture ; fichiers sensibles ; injection Infisical pour les projets concernés, compatibilité des anciens `.env` | Contrôle ciblé, tests positifs et faux positifs ; aucune migration forcée pour une tâche sans rapport |
| Destruction, dérive du socle installé | Commandes dangereuses ciblées, protection des actifs installés, métadonnées Git et lockfiles, contrôle NUL | Refus des actions concernées ; corrections du socle à la source via `void-learn`, aucun mode de contournement |
| Mauvaise cible ou délégation dupliquée | Cible Herdr vérifiée, identité native réelle, worktree attribuée et réconciliation avant relance | Diagnostic en cas d'incertitude ; seul le travail dépendant attend |
| Fusion incorrecte ou non autorisée | Revue indépendante sur le candidat exact, permissions/holds, chemins protégés, empreinte Git partagée et checks applicables | Coût de revue et validation assumé ; aucune fusion autonome vers la branche de déploiement |
| Régression fonctionnelle ou contractuelle | Tests pertinents, types/lint, invariants et frontières de confiance ; validation complète utile avant `main` | Vérifications pendant le travail, puis intégration ; pas de score global de confiance ni de promesse « zéro bug » |
| Installation qui détruit le travail utilisateur | Propriété par reçus/manifestes, conflits préservés, migrations et rollback éprouvés | Tests d'installation et de mise à jour ; ne pas assimiler tout `.void/` à des données jetables |

Les règles de qualité demeurent : responsabilités claires, peu d'abstractions,
logger dans le code applicatif, assertions TypeScript justifiées, commits cohérents,
dépendances maintenues et compatibles. Les plafonds physiques retirés ne permettent
pas d'augmenter sans limite le contexte de démarrage. Les contrôles propres à un
consommateur ne sont pas supprimés par une décision universelle de simplification.

## Ordre et limites des lots

Chaque lot livre ensemble sources, documentation active et copies encore distribuées.
Il peut contenir plusieurs changements cohérents vérifiés progressivement. La suppression
future d'un générateur ne justifie pas de laisser ses sorties actuelles incohérentes.

| Lot | Résultat | Dépendances et limite |
| --- | --- | --- |
| L1 | Terminer les deux retraits lexicaux préparés | Première tranche, sans migration générale |
| L2 | Réduire les hooks et garder les contrôles syntaxiques utiles dans le linter | L1 ; préserver la reprise explicite et Herdr |
| L3 | Alléger doctrine, skills et documentation des décisions | L1 ; peut avancer indépendamment de L2 |
| L4 | Reprise par checkpoint et Autopilot proportionné | L3 ; consentement migré avant retrait du programme |
| L5 | Workers natifs réellement visibles dans Herdr | Contrat de reprise L4 ; vérifier les capacités dès le début |
| L6 | Retirer graphes, scores, audit et autres moteurs devenus inutiles | Préserver les consommateurs nécessaires de L4/L5 avant suppression partagée |
| L7 | Unifier sources, builds, installation et doctor | Après L6 pour ne pas déplacer des composants à supprimer |
| L8 | Achever la simplification tests/CI/release | Inventaire stabilisé par L6/L7 ; économies indépendantes possibles plus tôt |
| L9 | Préparer la télémétrie native Grafana + Alloy | Préparation indépendante ; activation après validation des capacités et de la destination |

Un seul auteur par zone partagée. Les lockfiles, manifestes et générateurs communs
se traitent séquentiellement ; déléguer la recherche et les écritures réellement
indépendantes. L'orchestrateur reste l'interlocuteur utilisateur et collecte les résultats.

### L1 — Finaliser le retrait lexical préparé

Reprendre le diff existant de `packages/hook-runner/src/{rules,enforcement}/`,
`packages/core/hooks/`, manifestes core/Codex et `packages/cli/core-assets/`.
Retirer seulement les règles et tests propres aux noms de tests et au « design slop ».
Conserver les conseils de tests, la revue visuelle et l'accessibilité.

**Preuve de sortie :** régression `packages/core/hooks/style-retirement.test.ts`
sur installation neuve/mise à jour, Claude/Codex, hooks utilisateur conservés,
refus des secrets/commandes dangereuses/règles inconnues ; tests `quality-rules`
et des adaptateurs affectés, types puis bundles cohérents. Les assertions actuelles
sur les tests focalisés seront adaptées en L2 à leur nouvelle validation, pas effacées
sans remplacement. Faire relire ce diff avant de le déclarer terminé.

### L2 — Alléger les hooks sans déplacer tout le travail à la fin

Points d'entrée : `packages/hook-runner/src/{rules,enforcement,lifecycle}/`,
`packages/core/hooks/`, manifestes et configuration Biome existante.
Retirer les interdits lexicaux approuvés, le contrôle d'ordre TDD, le formatage
après chaque édition, le typecheck à chaque arrêt, les rappels/traqueurs continus,
le trim maison et les avertissements sans valeur démontrée.

Configurer dans le linter existant les règles conservées sur `any`, console et
imports non déclarés ; garder les sorties CLI légitimes. Refuser les tests focalisés
ou exclus lorsque leurs résultats servent de preuve, au bon niveau de validation.
Garder le checkpoint manuel et la mesure partagée réellement nécessaire à Herdr.

**Preuve de sortie :** actions légitimes permises et risques conservés refusés dans
les deux runtimes installés ; `ownership-unproven` n'interdit pas le dépôt et
n'émet aucune commande Herdr non autorisée. Typecheck/lint après changements
cohérents, sans nouveau watcher. Ne supprimer une bibliothèque partagée qu'après
vérification de ses derniers appelants.

### L3 — Simplifier les procédures et garder une doctrine exploitable

Sources : `packages/core/PHILOSOPHY.md`, skills de préparation, implémentation,
tests, revue, tickets, commits et agents concernés ; `scripts/anti-bloat-check.sh`,
scripts de références/ADR et documentation active.
Appliquer les décisions sur consultations proportionnées, critères concrets de revue,
absence d'expansion automatique du périmètre, tests sans conventions arbitraires,
commits cohérents, noms Fowler facultatifs et contrôles lexicaux retirés.
Conserver des tickets complets, les tailles t-shirt et les jalons natifs utiles.

Remplacer le moteur ADR et ses verrous par des Markdown à frontmatter léger,
préserver l'historique ; supprimer index/registre/contrôles éditoriaux devenus exclusifs.
Garder résolution réelle des références et préfixes techniques. Les plafonds de
skills/hooks/fonctions cessent d'être absolus ; les descriptions restent sobres.
La validation cible frontières/invariants, sans taux de confiance LLM.

**Preuve de sortie :** références et formats effectivement consommés valides,
scénarios utiles conservés, aucune doctrine contradictoire dans les actifs livrés.
Aligner la phrase sur le round 2 d'Autopilot avec son brief existant : corrections,
comportement affecté et régressions démontrées ; aucun nouveau tour de revue.
Ne pas remplacer les tests éditoriaux par un moteur d'évaluation LLM.

### L4 — Reprendre le travail sans programme parallèle

Sources : `packages/cli/src/lib/session/{checkpoint,resume-bundle}.ts`, commande
`resume`, `lib/autopilot/{program,loop,loop-observe,merge-hold,judgments,native-review}.ts`,
commande `autopilot-review`, skills checkpoint/autopilot/ticket.
Le checkpoint explicite porte objectif/jalon, tickets engagés, références exactes
PR/worktrees/workers, preuves utiles, prochaine action et liste prévue modifiable.
Les tickets/GitHub/Git et sessions réconciliées restent l'état réel ; le checkpoint
n'est ni une autorisation ni une preuve fraîche d'achèvement.

Migrer le consentement explicite et les cibles dans `.void/config.json`, avec un bloc
déclaré dans `lib/config-schema.ts` et la lecture stricte Autopilot existante adaptée.
Ce fichier est déjà protégé contre la fusion autonome. Conserver
`.void/machine/autopilot/merge-hold.json` et son interprétation prudente des erreurs.
Le schéma actuel retire les clés inconnues : déclarer les champs avant de consommer
son résultat ; un simple diagnostic doctor ne vaut pas admission. Aucun consentement
activé par défaut lors d'init ou de réparation. Tester absent/désactivé/illisible,
préservation par init/update/pins et contradiction avec l'ancien programme avant de
retirer ce dernier lecteur. Conserver exactement cibles et restrictions, sans
choisir la source la plus permissive. Préserver les fichiers historiques/personnalisés.

L'orchestrateur prend le ticket une fois et transmet le contrat complet ; il peut
examiner le code utile à la coordination. Rafraîchir de façon ciblée, sans réécrire
les priorités humaines. Retirer l'arrêt global après trois attentes ; une panne
commune bloque les actions dépendantes. Autoriser la revue d'un candidat terminé
en brouillon sans autoriser sa fusion. Garder les plafonds de correction existants
et les arbitrages humains pour les intentions incompatibles.

**Preuve de sortie :** tests session/autopilot/commandes concernés, reprises avec
plusieurs tickets, ticket déjà terminé, queue modifiée, worker incertain, provider
absent, tête/base déplacée, brouillon relu non fusionnable et hold préservé.
Exercer une reprise dans un contexte neuf sur chaque runtime avant de retirer
le programme. Aucune promesse de récupération des décisions non sauvegardées.

### L5 — Conserver la visibilité des vrais workers dans Herdr

Points d'entrée : `lib/runtime-adapters.ts`, `lib/runs/{workers,legacy-workers}.ts`,
commande `agents`, `packages/mission-engine/src/events/worker.ts`, hooks `herdr-*`,
`docs/NATIVE-SUPERVISION.md` et `docs/WORKER-LIFECYCLE.md`.
Séparer les capacités natives Claude/Codex derrière la petite adaptation nécessaire ;
Herdr présente les sessions réelles, le runtime les exécute. L'adaptateur actuel
d'installation ne prouve pas l'ouverture ou l'attachement à un onglet.

Vérifier d'abord les interfaces disponibles et une cible autorisée. Supprimer la
cérémonie de JSON/`agents record` seulement après preuve que l'intégration conserve
la visibilité demandée. Aucun worker dupliqué pour l'affichage, aucune commande
vers une cible non vérifiée, aucun second moteur d'orchestration. Une capacité
manquante est signalée ; le travail local et la délégation native restent disponibles.

**Preuve de sortie :** tests Herdr et `agents-workers`/adaptateurs, puis sessions
réelles sur les deux runtimes : ticket visible, identité correcte, lancement unique,
correction au même worker, retour collecté, interruption/reprise et cible refusée.
Ne pas qualifier ce lot d'activé si une simple simulation est la seule preuve.

### L6 — Retirer les moteurs et leurs dépendances exclusives

Retirer `packages/harness-graph`, studio, `apps/eval-harness`, graph/audit/why,
ProjectGraph, santé/certification/cheatsheet générée, backlog local et campagnes
exclusives. Garder les scénarios réellement utiles, rapports historiques et un
guide court. Adapter status/doctor à l'installation réelle ; pas de score de remplacement.

Deux couplages doivent disparaître avant le paquet : `harness-manifest.ts` importe
`EnforcementTier` du graphe ; `runtime-adapters.ts` atteint la lecture d'événements
via `graph-io.ts`. Relocaliser seulement ces responsabilités nécessaires dans leurs
propriétaires existants. Ne pas supprimer `mission-engine/events`, les journaux de
mission, les reçus de revue ou les preuves de fusion avec la télémétrie d'usage.
Retirer les API publiques abandonnées de façon explicite avec migration documentée.

**Preuve de sortie :** aucun import/build/export résiduel des surfaces retirées ;
installation, protection, reprise et revue indépendantes fonctionnelles sans le graphe.
Auditer `test/browser` : la suite actuelle teste la cheatsheet HTML. Si aucun usage
conservé ne subsiste, retirer ensemble suite, dépendances/lockfile exclusifs, job et
entrée Dependabot. Préserver tout autre usage réel de Playwright.

### L7 — Unifier les sources et migrer les installations proprement

Entrées produit rédigées sous `packages/<paquet>/src`, sorties sous `dist` via les
builds existants ; `docs` explique le produit. Source unique de philosophie :
`packages/core/src/PHILOSOPHY.md`. Installation : `.void/PHILOSOPHY.md` à côté de
`.void/PROJECT-DOCTRINE.md`, propriété/protection conservées. Garder `.void/hooks`,
`.void/machine` et les chemins natifs. Aucun `packages/core` imposé aux consommateurs.

Sources actuelles : `packages/cli/scripts/copy-core-assets.mjs`, runtime-assets/adapters,
install-manifest/receipts, init/update/doctor, `lib/self-host/`, modules de doctrine.
Une source rédigée pour AGENTS, import natif mince côté CLAUDE après preuve du
chargement ; retirer alors la parité manuelle. Doctor reste local, les checks distants
explicites. Self-host reste isolé ; les builds ne lisent ni `.void/`, ni HOME, ni horloge.

**Preuve de sortie :** init/update/rollback/offline, fichiers utilisateur modifiés,
anciennes installations, npm et marketplace, doctrines chargées une fois par runtime,
protection effective et `test/builders/inputs-are-versioned.test.ts`. Retirer
`.void/installed` seulement si vide après migration conservatrice. Le socle publié
installé ici reste protégé jusqu'à un remplacement corrigé, testé et relu.

### L8 — Réutiliser les builds et réduire la CI à son rôle utile

Sources : scripts racine, Vitest/catalogue de tests, `.githooks`,
`scripts/{derive,verify,render-ci-gates}.mjs`, workflows CI/release/back-merge/enforce,
scripts conformance/publication et `packages/cli/package.json` (`prepack`).
Utiliser les projets Vitest et YAML natifs ; retirer classifieur, générateur de CI,
rapports JSON par gate, campagnes systématiques et pre-commit maison approuvés.
Ne pas effacer une configuration de hooks utilisateur étrangère.

Construire une fois pour des entrées identiques et réutiliser l'archive vérifiée.
Sélectionner tests et dépendants affectés avec Git/workspaces/outils existants ;
élargir pour lockfiles, fondations partagées, installateur, CI ou impact incertain.
Linux par défaut, petites preuves réelles multi-OS pour les risques portables,
merge-group combiné sur l'intégration. Avant `main`, tous les checks utiles requis
sur le candidat à jour ; promotion brouillon avant préparation, sans fusion implicite.

Garder version lockstep, taille légère, provenance, archive effectivement publiée,
back-merge natif et attente bornée de convergence du registre après publication unique.
Supprimer bump/release manuels et re-packagings redondants. Le socle CI consommateur
reste protégé et extensible sans être affaibli ; vérifier invocation et checks requis
avant de prétendre que cette garantie est effective sur un dépôt distant.

**Preuve de sortie :** sélection docs/local/shared/lockfile/unknown, échec réel transmis,
archive réutilisée de même identité, installation multi-OS ciblée, contrats release
conservés. Une régression doit prouver qu'un actif livré obsolète est détecté : la
régénération préalable ne doit pas réparer silencieusement le candidat puis faire
passer son contrôle de fraîcheur. Comparer aux actifs versionnés d'origine avant
toute réécriture, en réutilisant la construction isolée et les contrôles existants.
Mesurer temps/jobs/CPU-minutes comparables quand disponibles, sans confondre
un job sauté avec un test exécuté ni la concurrence avec une économie de calcul.

### L9 — Préparer Grafana + Alloy sans recréer le suivi maison

Réutiliser les exports natifs et un petit mapping réellement consommé Claude/Codex,
préférentiellement configuration Alloy standard. Préserver unités, runtime/version,
provenance et données absentes. Aucun SDK ajouté aux projets, aucune parité inventée.
Tokens/coûts et activité/durée/erreurs seulement lorsqu'ils sont réellement émis.
Pas de prompts, réponses ou arguments/résultats d'outils exportés par défaut ; réduire
aux métriques si les réglages natifs ne permettent pas d'exclure ces contenus.

Grafana Cloud **Free uniquement**, après vérification du volume et de la rétention ;
sinon examiner le Synology DS923+ 16 Go avec Grafana existant et Alloy, puis seulement
les stockages nécessaires. Pas de LangGraph/LangSmith/Langfuse, ni abonnement payant
implicite. Configurer secrets via le gestionnaire prévu, files/retries/rétention bornés.

**Preuve de sortie :** échantillons réels et petites fixtures des deux versions de
runtime, champs/unités/absences, contenu exclu et panne d'export sans blocage du travail.
Prérequis d'activation à établir : endpoint/compte, versions, secrets, connectivité,
volumes et capacité NAS si choisi. Ne pas inventer ces accès. La préparation locale
peut avancer ; déploiement/export restent distincts et explicitement signalés.

## Vérification continue et clôture

Réutiliser `pnpm exec vitest run <fichiers concernés>`, typechecks des paquets touchés,
`pnpm hooks:build`, `pnpm build:cli` et `pnpm --filter ./packages/cli build:assets`
tant que ces commandes existent. Adapter leurs dépendances avec les retraits.
Les corrections de logique gardent des preuves RED/GREEN pertinentes ; les edits
documentaires ne déclenchent pas de suites sans rapport. La validation de fin comble
les lacunes et couvre l'intégration, sans rejouer des preuves inchangées par réflexe.

Chaque lot reçoit une revue indépendante du diff réel avant achèvement. Les preuves
de runtime, packaging et CI ne sont pas remplacées par cette revue. Les limites
de correction restent celles décidées ; les remarques facultatives ne relancent pas
le cycle. Un défaut concret ou une autorisation manquante bloque l'action concernée.

À la clôture, distinguer **décidé / implémenté / testé / installé / publié / activé**.
Le tableau de gains couvrira toutes les décisions, regroupées sans double comptage :

| Groupe | Suppressions nettes observées | Temps/contexte mesurés | Gain estimé et hypothèses | Coût conservé / limite | État |
| --- | --- | --- | --- | --- | --- |
| Hooks, procédures, moteurs, CI, installation, reprise, télémétrie | À relever sur les diffs finaux | Même périmètre avant/après, sinon non mesuré | Aucun pourcentage inventé | Protections et couverture réellement restantes | Statut constaté |

Mesurer séparément source/test/dépendance supprimés, travail de migration ajouté,
contenu de démarrage contrôlé par le harnais et coût total de vérification. Les caractères
ou tokens estimés ne valent pas mesure du contexte natif complet. Ne pas compter deux
fois une suite retirée avec son moteur puis avec son job CI.

## Vérification de ce plan

Le 23 novembre, la vérification ponctuelle a retrouvé les 124 décisions une seule
fois dans le relevé, avec leurs portées, accords, états et limites de gains conservés ;
les liens locaux sont valides. La revue indépendante `/root/simplification_plan_review`
a demandé deux corrections (chemin du miroir npm et preuve de fraîcheur des actifs),
puis confirmé leur résolution. Il s'agit d'une revue du plan et d'une inspection
ciblée du code, pas d'une validation du diff d'implémentation. Aucun test produit
n'a été lancé pour ces seuls documents.

## Reprise immédiate et PR indépendante

Prochaine unité d'implémentation : **L1**, reprendre le diff préparé et établir sa
preuve actuelle. Ce plan n'est pas une nouvelle queue d'exécution ; lors d'un
checkpoint explicite, conserver l'état de session et réconcilier Git avant reprise.
Le relevé des décisions et le plan restent accessibles sans le registre local ignoré.

La [PR Playwright #558](https://github.com/voidcorp-core/void-machine/pull/558) est
indépendante. Au relevé du 23 novembre, son head `8c3eeb32f96587bcafa38fceba10d00edbba9b19`
met `@playwright/test` à 1.65.0 en laissant `playwright-core` à 1.64.1 ; la CI échoue
à la résolution de la version navigateur et la suite navigateur n'est pas exécutée.
Recommandation : la laisser en attente pendant l'audit d'usage L6, sans la fusionner
ni la fermer. Si son unique consommateur disparaît, constater qu'elle est devenue
inutile ; sinon corriger l'alignement et vérifier la suite avant une fusion autorisée.
Cette lecture ne vaut pas revue complète de la PR ni autorisation d'action distante.
