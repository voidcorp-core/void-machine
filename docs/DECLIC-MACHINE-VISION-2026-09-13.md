# Void Machine : moteur de missions généraliste pour Déclic

Date : 2026-09-13.
Source : échange de vision avec Folpe, enregistré à sa demande.
Statut : direction produit à traduire en spécifications ; capacités non réputées livrées.

## Place dans l'ensemble

Déclic est l'expérience commerciale associant Cortex et Machine, sous la bannière
Void Corp et portée commercialement avec Brice auprès des entrepreneurs, TPE et PME.
Les noms techniques des projets peuvent rester distincts de la marque commerciale.

Cortex est la tête : conversation, mémoire personnelle, réflexion, conseil et direction.
Machine est le bras qui exécute : accès aux outils, conduite des missions et résultats.
Le dépôt actuel de Machine est `void-harness`. Son héritage est la conception et la
supervision de projets informatiques, notamment SaaS.

La nouvelle ambition est un moteur de missions généraliste, comparable à Hermes Agent
par l'étendue des usages, conservant une spécialité forte en ingénierie logicielle.
Cette référence ne prescrit ni une copie d'Hermes ni son adoption comme dépendance.

## Responsabilités et autonomie

Machine reçoit une intention exploitable, le contexte pertinent et les autorisations.
Elle conduit l'exécution, délègue aux runtimes, suit les ressources et les dépendances,
vérifie les résultats et rend un état explicite à son demandeur.

Cortex et Machine restent découplés. Machine doit pouvoir servir directement un
projet informatique sans Cortex. Cortex doit pouvoir continuer à dialoguer et à
mémoriser lorsque Machine n'est pas disponible.
Une frontière explicite ne commande pas, à elle seule, un nombre de services ou de dépôts.

Cortex possède la connaissance personnelle ; Machine reçoit le contexte nécessaire à
une mission, sans copier systématiquement toute la mémoire ou la conversation.
Machine possède le suivi de cette mission, ses effets et ses preuves. Cortex restitue
les résultats observés, sans annoncer une réussite à partir d'une simple intention.

## Noyau commun et spécialités

Le noyau commun vise l'identité et l'état des missions, les autorisations, les budgets,
la délégation, l'interruption, la reprise, la réconciliation des effets et les preuves.
Les outils et méthodes propres à un domaine restent dans les adaptateurs et spécialités.

La spécialité informatique conserve dépôts, worktrees, tests, CI, panels indépendants,
intégration et règles de livraison. Une spécialité documentaire porte la recherche de
sources, la préparation de documents et les vérifications adaptées à ces livrables.
Ajouter une ligne à une liste ne doit pas déclencher le cérémonial d'une livraison logicielle.

Réutiliser les capacités natives suffisantes des runtimes. La généralisation des missions
ne signifie pas reconstruire une boucle de raisonnement, une compaction ou une mémoire
conversationnelle déjà disponibles. Ne pas affaiblir la spécialité informatique pour généraliser.

## Exécution quand l'ordinateur est éteint

Exigence explicite : les usages hébergés continuent lorsque l'ordinateur de l'utilisateur
est éteint ou que l'application Cortex est fermée. Une capacité d'exécution indépendante
du poste doit donc être disponible, avec missions durables et résultats retrouvables.

Un VPS ou une infrastructure hébergée sont des possibilités, pas un fournisseur choisi.
Une architecture hybride a été proposée : exécution hébergée pour les services accessibles,
exécutant local optionnel pour les ressources qui doivent rester sur le poste. Les missions
dépendant d'un poste éteint attendent ; aucune disponibilité locale n'est inventée.

L'hébergement implique de concevoir l'isolation des utilisateurs, les accès aux comptes,
la planification et le suivi en arrière-plan. Les modalités techniques et de facturation
restent à spécifier ; aucun accès API payant ou contournement d'abonnement n'est implicite.

## Premier ensemble d'usages : Google et préparation de rendez-vous

Les premières connexions souhaitées sont Google Calendar et Drive / documents.
Les usages envisagés comprennent la recherche de documents, les comptes rendus,
les présentations, la prise de rendez-vous et la préparation de mails.
L'intégration CRM fait partie de la direction future ; aucun fournisseur n'est arrêté.

Scénario de référence :

1. Une routine d'ingestion ou de consultation détecte un rendez-vous le lendemain.
2. Machine retrouve les échanges et documents pertinents dans les sources autorisées.
3. Cortex reçoit les faits utiles, leur provenance et les éventuelles informations manquantes.
4. Cortex rappelle à la personne les demandes et engagements pertinents, puis propose :
   « Tu veux que je prépare un brouillon pour ce rendez-vous ? »
5. Après accord, Machine prépare le livrable et retourne son résultat à Cortex.

Une information non retrouvée reste non retrouvée ; elle n'est pas déclarée inexistante.
Collecte régulière et notification sont distinctes : éviter les rappels répétés et tenir
compte des événements annulés ou modifiés. La proposition proactive est permise dans
le service activé ; la première version ne prépare pas automatiquement les livrables proposés.

Plus tard, des réglages pourront autoriser la préparation automatique par usage, ou
maintenir une suggestion à chaque fois. Préparer, envoyer un mail, inviter quelqu'un et
publier sont des actions distinctes ; leurs autorisations ne se déduisent pas les unes des autres.
Une demande directe explicite reste une demande d'exécution dans son périmètre autorisé.

## Modèle ouvert et produit commercial

Folpe indique que Machine est public sous MIT et que Cortex est privé.
L'intention est que Machine apporte usage, visibilité et crédibilité technique, tandis
que Déclic commercialise le compagnon Cortex et l'intégration, l'hébergement et le service.

Un utilisateur de Machine n'obtient pas automatiquement Cortex. Un concurrent peut
cependant exploiter le moteur ouvert et construire sa propre interface ou son compagnon.
La difficulté d'installation ne constitue pas la protection commerciale recherchée.
La valeur distinctive doit venir de l'expérience personnelle et du service rendu.
Aucun changement de licence, transfert de propriété ou publication n'est réalisé par ce texte.

## Articulation avec le programme existant

Cette direction complète [la vision du 5 septembre](VOID-MACHINE-VISION.md).
Elle élargit explicitement le périmètre vers des missions générales et une exécution hébergée
proactive, alors que la fondation actuelle exclut un ordonnanceur hébergé et reste centrée
sur l'ingénierie logicielle. Ces écarts doivent être réconciliés dans de futures specs et ADRs.

Le texte ne remplace pas silencieusement les décisions acceptées, ne modifie pas les gates
actives et n'autorise ni réécriture immédiate ni nouveau service en production.
Linear reste propriétaire de l'avancement ; ne pas copier ici un curseur de tickets.

Approche discutée : préserver le parcours informatique et éprouver la généralisation avec
le scénario Google avant d'introduire une plateforme universelle. Il reste à préciser le
contrat Cortex/Machine, les accès, l'hébergement, les notifications, la conservation des
résultats et les critères de valeur : utilité, effort humain, qualité, coût et fiabilité.

## Document complémentaire

Le dépôt privé `void-cortex` conserve `docs/DECLIC-CORTEX-VISION-2026-09-13.md` pour
la relation utilisateur, la mémoire et le conseil. Ce chemin identifie le document compagnon ;
il n'implique pas un accès public et ne crée aucune dépendance de build entre les dépôts.

## Mise en service reproductible par client

Exigence ajoutée explicitement par Folpe le 2026-09-13 : pouvoir installer et mettre
en service facilement Machine pour chaque client de Déclic.

La cible est un parcours reproductible, sans intervention manuelle dans le code pour
chaque client : préparer son espace isolé, connecter ses comptes avec son autorisation,
appliquer ses paramètres et vérifier une première mission. Les erreurs doivent permettre
une reprise claire sans créer de comptes, connexions ou missions en double.

Le choix entre infrastructure partagée avec isolation et instance dédiée par client reste
ouvert. « Installer pour chaque client » exprime la simplicité de mise en service, sans
imposer un VPS distinct. La maintenance et les mises à jour doivent rester reproductibles
à mesure que le nombre de clients augmente. Le temps de mise en service et le nombre
d'interventions manuelles seront à mesurer ; aucun seuil n'est encore fixé.

## Appairage avec un Cortex

Exigence explicite de Folpe : pouvoir lier un Cortex à un Void Machine lors de la mise
en service. Le lien identifie le Cortex autorisé et son instance ou espace Machine cible,
y compris lorsque plusieurs clients partagent une infrastructure.

Le contrat devra permettre un appairage authentifié, une vérification de connexion et
une révocation. Les missions, résultats et notifications restent attachés au bon espace
client ; un identifiant fourni dans une demande ne suffit pas à autoriser cet accès.
La portée des autorisations est explicite. Un lien absent, révoqué ou indisponible produit
un état compréhensible. Le devenir des missions en cours lors d'une révocation devra être
spécifié sans perdre la trace des effets déjà réalisés ni les rejouer aveuglément.

La cardinalité (un ou plusieurs Cortex par Machine, et inversement), le mécanisme
technique d'appairage et les règles de changement de cible restent à concevoir.

## Direction confirmée : faire évoluer Machine dans le dépôt existant

La suite de l'échange confirme l'évolution de `void-harness` vers le moteur général
Void Machine, en conservant la spécialité informatique. Ne pas repartir sur un clone
complet d'Hermes ni créer par défaut un troisième moteur indépendant.

Motivation de Folpe : maîtriser les comportements d'action, les accès et les composants
exploités chez les clients, avec un périmètre compréhensible et adapté à Cortex. Une
implémentation maison n'est pas réputée plus sûre par nature ; ses garanties doivent
être testées et son coût de maintenance assumé.

Trois options ont été discutées : généraliser Machine, utiliser Hermes derrière Cortex,
ou créer un nouveau moteur. Hermes a été proposé pour accélérer un premier lancement ;
Folpe privilégie la maîtrise de l'exécution. L'évolution du dépôt actuel évite de dupliquer
les responsabilités déjà utiles. Réutiliser des modèles, runtimes et bibliothèques reste
compatible avec cette maîtrise. Le couplage fonctionnel à Cortex doit être simple, tout en
préservant une utilisation directe de Machine et une frontière technique explicite.

## Coordinateur LLM à l'entrée de Machine

Intention explicite : une demande en langage naturel, venue de Cortex ou directement
adressée à Machine, est comprise par un LLM coordinateur. Celui-ci propose les étapes,
les informations à rechercher, les capacités nécessaires, les agents éventuels et les
configurations d'exécution pertinentes. Il peut déléguer, rapprocher les résultats et
préparer une synthèse exploitable pour Cortex ou pour le demandeur direct.

Distinguer les responsabilités :

| Élément | Responsabilité |
| --- | --- |
| Coordinateur LLM | Interpréter l'objectif, proposer une décomposition et classer les stratégies admissibles |
| Noyau déterministe | Appliquer les politiques, autorisations, limites, transitions et conditions de preuve |
| Catalogue de capacités | Décrire les combinaisons accessibles avec version, provenance et état de vérification |
| Adaptateurs | Appliquer les choix via les interfaces réellement prises en charge et observer l'exécution |
| Spécialités | Apporter les méthodes et vérifications propres à un domaine |

Le coordinateur est un rôle agentique porté par une configuration admissible. Cela ne
prescrit pas de reconstruire une boucle de raisonnement ou une mémoire conversationnelle.
Le contrôle déterministe doit précéder l'exposition de données et l'exécution des actions.
Le classement sémantique ne peut pas ajouter une route refusée ni élargir une permission.

La possibilité d'une route directe pour une demande déjà structurée par Cortex a été
proposée afin d'éviter une nouvelle interprétation inutile. C'est une optimisation à
évaluer, pas un abandon du coordinateur souhaité pour les demandes en langage naturel.

## Modèles, runtimes et politique propre à chaque client

Folpe souhaite pouvoir activer ou désactiver certains modèles selon le client et router
selon la demande. Un coordinateur économique mais suffisamment capable est envisagé
pour absorber un volume important, avec recours à une configuration plus puissante
lorsque le travail le justifie. Le coordinateur peut aussi choisir une exécution avec
le même modèle si elle convient ; la délégation n'impose pas une escalade.

Les exemples cités oralement comprennent Kimi 3, DeepSeek V4, Opus 5 et GPT 6 Astra,
ainsi que Claude Code et Codex pour les runtimes. Ce sont des exemples d'intention,
pas un catalogue vérifié : disponibilité, noms exacts, prix, capacités, compatibilité et
conditions d'utilisation devront être vérifiés avant toute configuration. Les noms
incertains issus de la transcription ne doivent pas devenir des exigences techniques.

Séparer modèle, fournisseur, runtime, effort, outils, mode de facturation et stratégie.
Un runtime n'accepte pas nécessairement tous les modèles. Une préférence inscrite dans
un prompt n'atteste pas que le modèle ou l'effort demandé a été effectivement appliqué.

La politique par client devra décrire les routes et outils autorisés, les plafonds,
les restrictions de données et les possibilités de repli. Elle s'applique au coordinateur
lui-même : ne pas lui transmettre une donnée interdite pour lui demander où la router.
Filtrer les destinations avant d'exposer le contexte ; transmettre le minimum nécessaire.
Un refus, un quota épuisé ou une capacité inconnue reste explicite ; pas de bascule vers
un fournisseur, une API payante ou un modèle non autorisé.

Le choix économique doit mesurer le coût complet : coordination, contexte, appels,
latence, échecs, corrections et vérification. Un modèle moins cher par appel n'est pas
réputé moins coûteux par mission réussie. Conserver les mesures inconnues comme telles.
Les premiers seuils d'escalade et le modèle coordinateur restent à choisir par évaluation.

## Collecter, rapprocher et restituer

Exemple : préparer un rendez-vous peut nécessiter un événement d'agenda, des informations
CRM et plusieurs documents. Machine choisit les accès admissibles, collecte les éléments,
les rapproche et remonte une synthèse exploitable à Cortex. Le classement de documents
est un autre usage envisagé ; déplacer ou modifier une ressource reste une action autorisée
séparément de sa lecture.

Une connexion à Google ou au CRM n'est pas un agent par définition. Un appel d'outil
suffit pour une lecture simple ; un agent spécialisé peut être utile pour analyser des
sources contradictoires. Déléguer aux frontières de travail cohérentes, sans multiplier
les agents ni les changements de modèle pour chaque petite opération.

La synthèse conserve les références des sources, leur fraîcheur, les incertitudes,
les contradictions et les actions effectivement réalisées. Concaténer des réponses
ne suffit pas à les vérifier. Cortex peut demander un approfondissement et présenter
les résultats en fonction de la personne, sans inventer ce que Machine n'a pas observé.

## Travaux à spécifier ensuite

Cette liste est une séquence de conception proposée pour rendre la vision exploitable.
Elle n'est ni un plan d'exécution approuvé ni une mise à jour de l'avancement Linear.
Chaque tranche devra disposer de critères précis, d'une revue et d'une preuve observable.

1. **Inventorier le noyau actuel.** Classer les contrats réutilisables et les dépendances
   informatiques à déplacer. Lors de la lecture du 13 septembre, `MissionPlanInput`
   exige ticket, diff et stack ; les politiques nomment des passes informatiques ;
   les contrats natifs de cluster portent tickets et fichiers. Le routage manipule
   déjà capacités, permissions et budgets. Vérifier ces constats sur le SHA de travail.
2. **Définir une mission générale.** Entrée directe ou Cortex, objectif, client autorisé,
   contexte, résultat attendu, effets et preuves. Prouver une mission sans dépôt Git
   tout en préservant le parcours informatique existant.
3. **Définir le catalogue et la politique client.** Distinguer les dimensions de configuration,
   refuser les combinaisons indisponibles et protéger les données avant le premier appel LLM.
   Prouver qu'un modèle désactivé ne reçoit aucun contexte, coordinateur compris.
4. **Brancher le coordinateur.** Produire une stratégie structurée et bornée ; admettre et
   classer uniquement des routes autorisées. Tester sortie invalide, ambiguïté, timeout,
   route absente, quota épuisé et repli, sans effet externe non autorisé.
5. **Relier Cortex et Machine.** Authentifier l'appairage, attribuer les missions au bon client,
   exposer état, accord, résultat et révocation. Prouver l'absence de croisement entre clients.
6. **Livrer un parcours Google complet.** Lire agenda et documents autorisés, construire un
   rappel contextualisé, proposer une préparation, puis créer le livrable après accord.
   Conserver sources et inconnues ; aucune invitation ni aucun envoi implicite.
7. **Rendre le parcours durable et proactif.** Exécution indépendante du poste, routines,
   reprise après arrêt, absence de doublons, notifications pertinentes et accords persistants.
   Prouver le fonctionnement ordinateur éteint et le traitement d'un rendez-vous annulé.
8. **Industrialiser la mise en service.** Provisionnement, connexions, paramètres, diagnostic,
   première mission et mises à jour reproductibles sans modification de code par client.
   Comparer espace partagé isolé et instance dédiée avant de choisir le déploiement.
9. **Élargir sur preuves d'usage.** CRM, classement documentaire, autres livrables et réglages
   de préparation automatique. Mesurer le gain avant d'ajouter une nouvelle spécialité.

Restent à arbitrer : hébergement, topologie par client, stockage et rétention des missions,
protocole et cardinalité de l'appairage, catalogue initial, modèle coordinateur, plafonds,
seuils de routage, règles de notification et responsabilité de chaque validation.
Les protections contre les effets ambigus et les gates de livraison existantes restent
applicables jusqu'à une migration explicitement conçue ; la vision n'autorise aucun déploiement.
