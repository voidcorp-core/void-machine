# Void Machine : direction cible

Cadrage fourni par Folpe le 2026-09-05. Ce fichier conserve la vision de référence ;
l'avancement appartient au tracker, pas à ce document.

Complément de vision du 13 septembre :
[Machine généraliste, Cortex et Déclic](DECLIC-MACHINE-VISION-2026-09-13.md).
Ce complément conserve le coordinateur LLM, le routage par client, les spécialités,
l'exécution hébergée et les parcours à spécifier ; il ne remplace pas les gates actives.

Plan de réalisation proposé le 20 septembre :
[portage, preuves et stabilisation du socle TypeScript](plans/2026-09-20-void-machine-typescript-foundation-plan.md).
Il rassemble les sources, les frontières de couches et les critères empêchant de
reproduire les blocages du harnais ; il ne déclare aucune implémentation réalisée.

Ce document fixe la direction cible. Commencer par la confronter au dépôt
et aux décisions applicables, puis proposer une spec et une migration.
Ne pas interpréter ce cadrage comme une autorisation de réécriture immédiate.

Les orientations antérieures incompatibles doivent être réconciliées avec cette
cible. Les décisions historiques acceptées restent conservées ; leur éventuel
remplacement doit être explicite. Le socle existant sera porté vers TypeScript strict sur Node.js, selon la décision ci-dessous.
Le brainstorm avec Folpe est suivi dans
[DEV-833](https://linear.app/voidcorp/issue/DEV-833), dans la chaîne portée par
[DEV-807](https://linear.app/voidcorp/issue/DEV-807).

## Décision du 19 septembre : un noyau neuf

Décision explicite de Folpe, consignée dans
[l’ADR de référence](decisions-log/2026-09-19-void-machine-new-core-demonstrated-needs--873d1c5a-ef12-44c7-84dd-2fcd853b7ab8.md) et traduite dans la
[spec du noyau](specs/2026-09-19-supervised-design-orchestration.md#new-core-decision-2026-09-19).
La décision ultérieure de Folpe porte le socle Rust existant vers TypeScript strict
sur Node.js, avec correction des frontières architecturales. La maintenabilité par
Folpe prime ; aucun besoin mesuré ne justifie deux langages. Voir
[la nouvelle ADR](decisions-log/2026-09-19-void-machine-typescript-layer-ownership--e492e50e-86b0-4427-9fdf-2435750ce60d.md) et
[le périmètre fermé du portage](specs/2026-09-19-void-machine-typescript-port.md).
Terminer WORK-1/2/3, puis porter les capacités existantes, puis construire le parcours
complet du moteur. Le portage ne certifie pas ce futur parcours. Ni release ni
remplacement de l’installation active ne sont autorisés par cette décision.

Nous voulons un noyau neuf, construit à partir de la vision et des enseignements
des incidents du harnais. L’architecture et les mécanismes de contrôle du harnais ne
sont pas reconduits par défaut. Chaque mécanisme repris doit répondre à un besoin
concret et justifier son coût de fonctionnement, de maintenance et de vérification.
La réutilisation de capacités natives suffisantes reste possible ; elle ne vaut pas
reconduction du contrôleur du harnais.

L’après-midi consacré à débloquer WORK-1/2/3 est un contre-exemple : le dispositif de
contrôle ne doit pas devenir plus complexe à faire fonctionner que le travail encadré.

- L’orchestrateur distribue le travail, transmet les questions et collecte les
  résultats. Le runtime de mission gère transitions, attentes, reprise et clôture
  de façon déterministe ; les runtimes d’agents gardent leur raisonnement natif.
  Les opérations décidables mécaniquement sont procédurales ; les instructions
  spécialisées pour les modèles restent dans des fichiers Markdown versionnés.
  La supervision des agents appartient au runtime : événements et réconciliation
  périodique bornée repèrent les attentes oubliées, sans LLM de surveillance
  permanent. Un signal idle ne suffit jamais à fermer ou relancer un agent.
- Chaque attente expose une cause, un responsable et une action de résolution.
  Aucune attente silencieuse.
- Un complément de contexte conserve la mission et son historique, réutilise les
  résultats encore valides et ne consomme pas artificiellement un tour.
- Les contrôles bloquent pour une conséquence concrète : sécurité, permissions,
  intégrité des données ou critère d’acceptation non satisfait. Les remarques sans
  incidence démontrée ne bloquent pas.
- Les revues sont bornées. Après correction, vérifier les points concernés sans
  rouvrir systématiquement un audit général. Une preuve future ne bloque pas
  prématurément.
- Les exigences de développement logiciel appartiennent à cette verticale. Le
  noyau reste indépendant des langages, frameworks, modèles, éditeurs et affichages.
- Décisions et état utile sont durables ; la continuité ne dépend pas de la mémoire
  conversationnelle de l’orchestrateur.
- Un agent terminé a son résultat collecté et son panneau possédé fermé. Ses preuves
  et sa worktree suivent un cycle de vie distinct ; les panneaux permanents restent.

Le premier parcours d’acceptation doit aller de l’intention au résultat livré avec
une clarification, une interruption et une correction, sans perte de travail,
effet rejoué, validation humaine redondante ni boucle de revue indéfinie. Mesurer
le temps, le coût et les interventions humaines nécessaires, sans inventer les
mesures indisponibles. Une architecture reproduisant les blocages de cet après-midi
est un échec, même si ses composants sont individuellement bien conçus.

Terminer d’abord WORK-1/2/3 dans son périmètre borné, puis construire le noyau en
référence à cette décision. Elle n’ajoute aucun contrôle au harnais actuel.

## 1. Vision et objectif

Void Machine est le point d’entrée des missions que l’utilisateur lui confie.

L’utilisateur exprime un objectif et, si nécessaire, un projet, un périmètre,
un budget, une durée maximale et des limites d’autorisation.

La machine :

- comprend et clarifie la demande ;
- prépare des unités de travail cohérentes ;
- choisit les configurations d’exécution adaptées ;
- délègue aux runtimes existants ;
- suit les résultats, ressources et blocages ;
- vérifie les conditions de livraison ;
- apprend quelles stratégies fonctionnent dans quelles situations.

L’objectif est de réduire l’effort humain nécessaire pour obtenir un travail
utile et vérifié, en respectant les contraintes du projet.

Ne pas optimiser le nombre d’agents, le volume de code ou la durée d’activité.

## 2. Principe central : exploiter les runtimes existants

Utiliser en priorité les capacités natives de chaque runtime :

- raisonnement et utilisation des outils ;
- exploration et modification du code ;
- sous-agents et spécialistes ;
- planification ;
- sessions, mémoire, compaction et reprise ;
- permissions et isolation ;
- événements, consommation et résultats structurés.

Ne pas construire par défaut :

- un nouveau runtime agentique ;
- une boucle de raisonnement concurrente de celle du runtime ;
- une mémoire conversationnelle parallèle ;
- un système de compaction maison ;
- un checkpoint textuel reproduisant ce que le runtime conserve déjà ;
- un ordonnanceur de sous-agents reproduisant une capacité native suffisante.

Toute nouvelle mécanique doit répondre à un manque démontré, avec un
périmètre minimal, une preuve de valeur et une possibilité de remplacement.

## 3. Responsabilité du noyau

Le noyau est le propriétaire du contrat d’exécution des missions supervisées.

Il assure :

- identité des missions et rattachement aux projets ;
- transitions d’état ;
- admissibilité des routes ;
- permissions et limites d’autorisation ;
- budgets et réservations de ressources ;
- suivi des exécutions déléguées ;
- gestion des dépendances ;
- validité des preuves ;
- reprise, réconciliation et nettoyage ;
- explication des arrêts.

Le noyau peut demander à un modèle de proposer une décomposition ou une
décision. Il valide les transitions et autorisations de façon déterministe.

Ne pas imposer au noyau de reproduire les décisions internes du runtime.
Laisser celui-ci accomplir une unité de travail avec ses propres capacités.

## 4. Responsabilité des adaptateurs

Chaque adaptateur traduit une intention Void Machine vers les mécanismes
officiels du runtime concerné.

La traduction doit porter sur le sens :
objectif, contraintes, contexte, résultat attendu et preuves nécessaires.

Elle ne doit pas se limiter à reformuler une commande ou à injecter un
long prompt générique identique dans tous les runtimes.

Selon les possibilités du runtime, l’adaptateur :

- découvre les capacités et configurations accessibles ;
- prépare le contexte projet et l’environnement ;
- ouvre ou reprend une session native ;
- sélectionne le modèle et les réglages disponibles ;
- configure les outils et permissions autorisés ;
- délègue le travail ;
- observe les événements et collecte les artefacts ;
- interrompt ou annule ;
- réconcilie le résultat ;
- utilise la continuité native ;
- nettoie les ressources dont il est propriétaire.

Distinguer installation du runtime, configuration du projet et exécution
d’une mission. Ne pas mélanger ces responsabilités dans un adaptateur
monolithique.

## 5. Agnosticisme par capacités

Séparer explicitement :

- runtime ;
- fournisseur ;
- modèle ;
- effort de raisonnement ;
- stratégie d’exécution ;
- mode de facturation ;
- capacités disponibles ;
- permissions accordées.

Ne pas supposer que toutes les combinaisons existent.

Un adaptateur expose des capacités versionnées avec leur provenance :
documentées, configurées, observées, vérifiées ou inconnues.

Une capacité absente n’est pas simulée silencieusement.
Une préférence transmise dans un prompt n’est pas une garantie d’exécution.

Ajouter un runtime doit principalement demander un adaptateur et ses tests
de conformité, sans modifier les règles métier du noyau.

Préserver les avantages particuliers de chaque runtime grâce à des
capacités optionnelles. Ne pas réduire tous les runtimes au plus petit
dénominateur commun.

## 6. Routage à l’intérieur d’une mission

Une mission peut utiliser plusieurs runtimes, modèles et niveaux d’effort.

Exemples :

- extraction simple avec une configuration économique ;
- résolution complexe avec une configuration plus capable ;
- vérification indépendante avec une autre configuration admissible.

Router à des frontières de travail cohérentes.
Éviter les changements de modèle à chaque petite action.

Le routage suit cet ordre :

1. identifier résultat attendu, contexte, risque et contraintes ;
2. éliminer les routes inadmissibles ;
3. comparer les routes restantes ;
4. réserver le budget nécessaire ;
5. déléguer ;
6. observer et vérifier ;
7. poursuivre, changer de stratégie ou arrêter.

Prendre en compte le coût total : préparation du contexte, latence,
consommation, échecs, corrections, vérification et effort humain.

Ne pas assimiler tâche courte et tâche sans risque.
Ne pas assimiler modèle moins cher et travail globalement moins coûteux.

Commencer avec une politique explicite et simple.
Introduire l’adaptation seulement lorsque les observations la justifient.

## 7. Mémoire native et continuité

La session, l’historique conversationnel, la compaction et les mécanismes
de mémoire propres au runtime restent sous sa responsabilité.

Pour une demande comme « fais un checkpoint », l’adaptateur doit :

- déterminer le besoin de continuité concerné ;
- utiliser le mécanisme natif approprié lorsqu’il existe ;
- vérifier ce qui a effectivement été conservé ;
- enregistrer seulement les références nécessaires à la reprise.

Ne pas confondre sauvegarde de session, résumé, mémoire persistante,
snapshot du code et état d’une mission. Ces mécanismes ne garantissent
pas tous la même chose.

Ne pas générer systématiquement un checkpoint Markdown si la reprise
native suffit.

Si la continuité native ne couvre pas le besoin, produire uniquement
l’artefact complémentaire nécessaire et expliciter cette limite.

Une mention de checkpoint dans une discussion d’architecture ne constitue
pas une demande réelle de clôture de session.

## 8. Minimum d’état portable

Void Machine conserve le minimum nécessaire à son rôle d’orchestrateur :

- identités du projet, de la mission et des unités ;
- références des sessions natives ;
- état des unités et dépendances ;
- versions des contrats et politiques ;
- budgets et ressources ;
- actions externes et résultats ambigus ;
- références des artefacts et preuves ;
- décisions humaines nécessaires.

Cet état est un registre d’exécution, pas une seconde mémoire
conversationnelle.

La vision, les décisions et contraintes du projet restent dans leurs
sources versionnées. Les adaptateurs les rendent accessibles selon
les conventions natives du runtime, avec des références ou des vues
générées dont la source est claire.

Une même information ne doit pas avoir plusieurs propriétaires éditables.

## 9. Transmission entre runtimes

Ne pas supposer qu’une session native ou un état interne de raisonnement
est transférable à un autre fournisseur.

À un changement de runtime :

- utiliser les artefacts et observations disponibles ;
- préparer une transmission minimale ;
- inclure objectif, contraintes, état du travail, questions ouvertes,
  effets déjà réalisés et preuves restantes ;

- contrôler la fraîcheur des informations ;
- déclarer les pertes éventuelles de contexte.

Ne pas exporter automatiquement tout l’historique conversationnel.
Respecter les politiques de confidentialité du projet.

Le nouveau runtime reprend le travail à partir d’un état observable,
sans prétendre poursuivre exactement le raisonnement interne précédent.

## 10. Apprentissage opérationnel

La machine doit apprendre à mieux orchestrer, sans devoir entraîner
elle-même un modèle.

Elle peut améliorer :

- choix des configurations par catégorie de tâche ;
- allocation du contexte ;
- concurrence ;
- stratégies de reprise ;
- recours à des vérifications supplémentaires.

La boucle est :
observation → hypothèse → politique candidate → évaluation → adoption
bornée → surveillance → maintien ou retour en arrière.

Conserver une politique de référence et des versions identifiables.

Distinguer les échecs du modèle de ceux des outils, de l’environnement,
du contexte ou des tests.

Tenir compte des différences de difficulté des tâches et des changements
de versions. Ne pas tirer une règle générale de quelques succès.

Les adaptations automatiques restent réversibles et dans une enveloppe
autorisée. Elles ne peuvent pas modifier les permissions, la doctrine,
la vision ou les garanties obligatoires.

L’auto-évaluation doit être confrontée à des résultats observables.
Le modèle ne peut pas être l’unique juge de son amélioration.

## 11. Projets et installation globale

Privilégier une installation utilisateur du moteur.

Réutiliser la découverte de projets existante.
Distinguer découverte, sélection et autorisation d’intervention.

Chaque projet conserve ses règles et ses références de connaissance.
L’adaptateur applique le contexte du projet concerné à la session native.

Gérer globalement la concurrence, les quotas partagés et les ressources
du Mac, y compris les sous-agents créés par les runtimes.

Une installation globale ne donne pas de privilèges administrateur et
ne doit pas transformer le dossier utilisateur en dépôt de travail.

Les sessions lancées directement hors de Void Machine restent possibles.
Le niveau de contrôle et de preuve y est déclaré comme différent.

## 12. Abonnements et budgets

Utiliser les abonnements existants lorsque les interfaces officielles
et les conditions du fournisseur permettent l’usage demandé.

Ne pas considérer un abonnement comme illimité.
Séparer dépense monétaire, quotas, durée et ressources locales.

Ne pas inventer une mesure de consommation indisponible.
Ne pas basculer silencieusement sur une API payante.
Un budget API nul exclut ce chemin.

Les limites portent sur toute la mission et sa délégation.
Prévoir une marge pour l’arrêt, la vérification et le nettoyage.

## 13. Qualité, reprise et nettoyage

Conserver les preuves adaptées au risque et leur liaison aux entrées
réellement vérifiées.

Utiliser les protections natives lorsqu’elles répondent au besoin.
Ajouter un contrôle externe seulement pour une garantie manquante.

Ne pas annoncer qu’une action est contrôlée si elle peut contourner
la frontière d’autorisation par un autre outil accessible.

Une interruption doit conduire à une reprise ou à un arrêt explicite.
Un effet externe au résultat inconnu doit être réconcilié avant répétition.
Un délai écoulé ne vaut pas approbation.

Identifier le propriétaire des worktrees, processus, environnements,
fichiers temporaires et caches.

Nettoyer après succès, erreur, annulation et redémarrage.
Préserver le travail utilisateur et l’état nécessaire à la reprise.

Les tests doivent isoler l’état utilisateur, les registres de projets
et les configurations globales.

## 14. Traitement du projet existant

Conserver le dépôt et l’historique Git.

Porter les capacités existantes de Void Machine vers TypeScript strict sur Node.js. Distinguer ce noyau des contrôles hérités du harnais. Évaluer ces
derniers comme candidats à réutilisation, sans obligation de reprise :

- contrats de mission et preuves utiles ;
- expertise des skills et spécialistes ;
- installation et migration ;
- découverte des projets ;
- évaluations comparatives ;
- régressions protégeant des comportements réels.

Examiner et modifier :

- contrats limités explicitement à Claude/Codex ;
- valeurs de capacités supposées plutôt qu’observées ;
- choix de modèles inscrits comme règles universelles ;
- duplication entre contrôleur, CLI, prose et fonctions natives ;
- mémoire et checkpoints reproduisant une continuité déjà disponible ;
- classification confondant caches et état durable.

La suppression d’un checkpoint ou d’un mécanisme maison exige une preuve
que son rôle est couvert par le runtime et les références conservées.

Préserver notamment ce qui relève des décisions projet, des effets
externes et de la validité des preuves : une mémoire native ne couvre
pas automatiquement ces responsabilités.

Supprimer les chemins supersédés après bascule vérifiée.
Retirer les tests devenus sans objet tout en conservant les garanties.

Maintenir la cohérence des documents, des références de skills et des
décisions remplacées. Ne pas effacer les décisions historiques acceptées.

## 15. Ordre de mise en œuvre

A. Partir du parcours accepté et justifier chaque mécanisme retenu ;
   cartographier ensuite les responsabilités actuelles et les capacités natives
   de chaque runtime pris en charge.

B. Produire une matrice :
   besoin → capacité native → adaptateur → manque réel → traitement.

C. Définir le contrat minimal du noyau et des adaptateurs d’exécution.

D. Démontrer une mission sur un runtime avec sa mémoire native,
   sans checkpoint redondant.

E. Démontrer une mission mixte avec transmission entre deux runtimes.

F. Prouver interruption, budgets, permissions, effets et nettoyage.

G. Introduire l’apprentissage des politiques en observation, puis
   l’adaptation automatique bornée.

H. Étendre aux missions concurrentes entre projets.

Les mécanismes avancés de contexte ou de recherche spéculative restent
optionnels et doivent démontrer un gain supplémentaire.

Poursuivre le moteur TypeScript après le portage borné,
en réconciliant les décisions applicables. Faire évoluer les capacités avec un seul propriétaire
autoritaire de chaque responsabilité.

## 16. Acceptation et livrables

Produire :

- un inventaire sourcé de l’existant et des capacités natives ;
- une liste conserver / adapter / supprimer / différer, avec raisons ;
- une architecture et des contrats minimaux ;
- une stratégie de migration et de retour arrière ;
- des scénarios de conformité communs aux adaptateurs ;
- des preuves sur des projets consommateurs réels.

Démontrer notamment :

- reprise native sans duplication inutile de mémoire ;
- transmission honnête entre runtimes ;
- choix de modèle et d’effort réellement appliqués lorsqu’ils existent ;
- refus des capacités ou routes non admissibles ;
- respect des budgets et absence de facturation implicite ;
- invalidation des preuves périmées ;
- nettoyage sans perte du travail ;
- retour à une politique de routage précédente.

Comparer les résultats à l’utilisation directe des runtimes.

La règle de conception finale est :
réutiliser une capacité native suffisante, adapter les différences,
et ne construire que les garanties ou coordinations réellement absentes.
