# Audit architectural stratégique de Void Machine

Date de l’audit : 1 octobre 2026.

Statut : recommandations d’audit, sans modification de la doctrine ni décision d’architecture adoptée.

Version en ligne : [audit complet](https://chatgpt.com/space/page_98b1d62633488191b508eb2dd2d47a1e).

Complément du même jour : [réconciliation avec les visions, le code intégré et Linear](audits/2026-10-01-reconciliation-strategique-et-backlog.md). Elle précise trois limites de ce premier audit : la délégation native et la verticale développement étaient déjà prévues ; le harnais de code n'est pas déclaré inutile ; une exécution hébergée maîtrisée peut aussi justifier Machine. La séparation des responsabilités est recommandée avant toute extraction de dépôt. Les recommandations ci-dessous ne remplacent pas les décisions ni les gates existantes.

## A Verdict

**Void Machine ne doit pas devenir un runtime agentique généraliste.**
Le dépôt actuel est surtout un harnais d’ingénierie ; son noyau d’exécution reste secondaire.
La séparation avec Cortex est pertinente, mais « runtime interchangeable » lui attribue encore trop de responsabilités.
Sa cible défendable est **un exécuteur local optionnel, avec autorisations bornées, quelques drivers et des reçus d’exécution**.
La sélection des fournisseurs appartient à Cortex, derrière un petit port.
L’orchestration cognitive, les sous-agents, les navigateurs et les sessions doivent rester chez les fournisseurs.
Le harnais de développement peut subsister séparément, si son utilité est mesurée.
**Si les fournisseurs couvrent aussi les garanties locales nécessaires, Machine doit pouvoir disparaître.**

## B Architecture actuelle reconstruite

### Périmètre et limites

Audit statique réalisé sur :

- **Void Machine :** checkout `ae47db4c`, complété par les changements accessibles dans la référence locale `origin/develop`, `f55c4bda`.
- **Void Cortex :** inspection ciblée des frontières d’intégration au commit `34fdc594`.
- **Documentation officielle OpenAI :** Dots, accès local et architecture d’exécution.

Le checkout Machine est volontairement en retard de 59 commits. Aucune branche n’a été avancée. Les travaux non intégrés de DEV-929 ne sont pas inclus.

La cartographie couvre les familles de modules et les chemins d’exécution pertinents. Elle ne constitue pas une revue exhaustive de chaque ligne.

### Le produit publié est un harnais d’ingénierie

Le [README](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/README.md#L1) décrit un produit qui installe :

- doctrine et standards ;
- skills ;
- agents spécialisés ;
- hooks ;
- configuration native Claude/Codex ;
- preuves d’installation et outils de diagnostic.

Ce produit répond à : **« Comment faire respecter notre pratique de développement à des agents ? »**

Il ne répond pas encore à : **« Comment exécuter une action métier autorisée par Cortex ? »**

```text
Sources du harnais
  core / skills / agents / hooks / packs
                 |
                 v
          CLI d’installation
                 |
       +---------+---------+
       v                   v
 Configuration Claude   Configuration Codex
       |                   |
       +------ hooks ------+
                 |
          hook-runner
                 |
      événements et preuves
                 |
        mission-engine
                 |
   CLI mission / autopilot / revue
                 |
       Git, tracker, GitHub
```

### Une seconde architecture existe dans packages/void-machine

Au checkout :

```text
application
   |
   +--> doctor
   |
   +--> sourced-note : extraction puis synthèse
             |
        runtime/execution
        runtime/mission
             |
       adaptateur Claude
       journal de fichiers
```

Le contrat [ExecutionRequest](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/void-machine/src/runtime/execution.ts#L4) contient seulement :

```text
executionId
instruction
input
timeoutMs
signal
```

C’est une frontière d’exécution bornée, pas un contrat d’action métier.

Les ajouts dans `f55c4bda` introduisent :

```text
CLI agents
   |
application/agents
   |
états de délégation + registre des runs
   |
AgentRuntimePort
   +--> sessions Claude en arrière-plan
   +--> threads du daemon natif Codex
   |
présentation facultative
   +--> none / herdr / tmux / cmux
```

Deux choix sont sains :

- le daemon appartient à Codex ;
- la présentation est distincte de l’exécution.

Mais le contrat reste centré sur **un agent de développement** : rôle `work|review`, `cwd`, ticket, brief, modèle et agent spécialisé. Voir le [contrat de délégation à f55c4bda](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/runtime/delegation.ts#L116).

### Plusieurs mécanismes pilotent déjà l’exécution

Le dépôt comporte :

1. le contrôleur de missions d’ingénierie ;
2. les règles de reprise et de remplacement de spécialistes ;
3. la boucle autopilot ;
4. le runtime de missions privées ;
5. le suivi des sessions déléguées ;
6. les boucles internes des fournisseurs.

Ces mécanismes n’ont pas tous la même responsabilité. Leur coexistence devient néanmoins dangereuse si plusieurs décident **quoi relancer, quand conclure et quelle preuve accepter**.

Le [contrôleur de mission](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/mission-engine/src/orchestration/controller.ts#L39) choisit déjà entre lancement du rédacteur, spécialistes, correction, vérification et arrêt. Machine dépasse donc largement un simple adaptateur.

### Le poids du dépôt confirme cette orientation

Comptage indicatif à `f55c4bda`, fichiers TS/TSX/MJS/shell, hors tests, fixtures, copies `core-assets` et certains artefacts générés ; commentaires inclus :

| Ensemble | Lignes |
|---|---:|
| CLI | 32 455 |
| Harness graph | 13 542 |
| Mission engine | 9 709 |
| Hook runner | 8 426 |
| Fondation void-machine | 5 669 |
| Graph studio | 2 111 |

Ce comptage ne mesure pas la qualité. Il montre que **la majorité du système administre le harnais et le développement**, plutôt qu’une frontière d’action Cortex.

### Cortex n’est pas actuellement branché sur ce runtime

Dans les sources de production inspectées de Cortex, je n’ai trouvé :

- ni `ActionContract` partagé ;
- ni `ExecutionResult` partagé ;
- ni appel direct à Void Machine.

Cortex possède déjà :

- un port d’inférence [ExplorationStep](https://github.com/voidcorp-core/void-cortex/blob/34fdc5947399f39dd1822aebd8d643c1f4e6ab55/apps/web/src/cortex/runtime/conversation.types.ts#L52) ;
- un port documentaire [WorkspaceStore](https://github.com/voidcorp-core/void-cortex/blob/34fdc5947399f39dd1822aebd8d643c1f4e6ab55/apps/web/src/cortex/runtime/conversation.types.ts#L61) ;
- une [boucle d’exploration](https://github.com/voidcorp-core/void-cortex/blob/34fdc5947399f39dd1822aebd8d643c1f4e6ab55/apps/web/src/cortex/application/exploration.service.ts#L780) qui traite les outils, les budgets et les politiques documentaires.

**La frontière demandée est donc à créer. Ce n’est pas une interface existante à nettoyer.**

## C Responsabilités actuelles

| Module | Responsabilité observée |
|---|---|
| packages/core | Doctrine, skills, profils, spécialistes, hooks et catalogue du harnais |
| packages/packs | Conventions et outils spécialisés par stack |
| packages/cli | Installation, migration, diagnostic, inspection, missions, revue, autopilot, sécurité et présentation |
| packages/hook-runner | Normalisation des appels natifs, règles sur les écritures/commandes, lifecycle et télémétrie |
| packages/mission-engine | Politiques d’ingénierie, classification des changements, DAG de passes, spécialistes, preuves, corrections et reprise |
| packages/harness-graph | Catalogue, graphe du projet, projections d’usage/coût, cohérence et certification |
| packages/void-machine/core | États et invariants de missions ; états de délégation dans la référence avancée |
| packages/void-machine/runtime | Exécution bornée, journalisation, progression et observation des délégations |
| packages/void-machine/application | Composition concrète des adaptateurs et cas d’usage |
| packages/void-machine/adapters | Processus Claude, daemon Codex, fichiers, Git, stockage et présentation |
| packages/void-machine/verticals | Diagnostic de développement et cas d’usage de note sourcée |
| apps/graph-studio | Visualisation du harnais |
| apps/eval-harness | Évaluation de l’effet des skills sur les agents |
| apps/make-pdf | Outillage documentaire |
| scripts, .github, test | Construction, génération, contrôles, publication et preuves |
| .void, configurations natives | Doctrine consommée, installation et état local ; ce ne sont pas tous des sources du produit |

**Je n’ai pas identifié dans ces chemins un Personal Model, un RAG personnel, un scheduler généraliste ou un navigateur maison.** Il faut empêcher leur apparition dans Machine, sans lui attribuer aujourd’hui des dérives absentes.

Le graphe existant est un graphe de harnais et de projet logiciel. Il n’est pas la mémoire personnelle de Cortex.

## D Responsabilités cibles

### Répartition recommandée

| Propriétaire | Responsabilités |
|---|---|
| CORTEX | Objectifs, Personal Model, mémoire sémantique, contexte, décisions métier, politiques globales, consentement, critères de réussite |
| RUNTIME ROUTER | Sélection parmi les exécutants admissibles, suivi des tentatives, prévention des doubles déclenchements entre fournisseurs |
| VOID MACHINE | Admission locale, restrictions locales, accès aux ressources non exportables, exécution bornée et reçus |
| DRIVER | Traduction vers un outil concret, préconditions techniques, credentials nécessaires, effets observables et réconciliation |
| EXTERNAL PROVIDER | Raisonnement, planification technique, sous-agents, browser/computer use, sessions, recherche, exécution distante et scheduling |

**Le Runtime Router doit commencer comme un module de Cortex.** Aucun microservice supplémentaire n’est justifié.

### La séparation proposée doit être corrigée sur quatre points

#### Cortex peut déléguer la réflexion sans céder l’autorité

Cortex n’a pas besoin d’effectuer lui-même chaque planification. Il peut demander à un fournisseur de proposer une méthode.

Il conserve :

- la décision faisant autorité ;
- les contraintes ;
- l’autorisation ;
- les critères de réussite.

Un runtime peut choisir une séquence technique dans cette enveloppe. Il ne peut pas agrandir la mission.

#### Machine doit conserver de l’état opérationnel

« Pas de mémoire utilisateur » ne signifie pas « aucun état ».

Machine doit pouvoir retrouver :

- un effet déjà engagé ;
- une exécution encore incertaine ;
- une autorisation expirée ;
- un reçu déjà produit.

C’est de l’état d’exécution, avec une durée de conservation définie.

#### Machine peut refuser une décision de Cortex

L’autorisation effective est l’intersection de :

```text
autorisation Cortex
∩ restrictions de la machine
∩ restrictions du fournisseur
∩ droits du compte utilisé
```

La machine possède un droit de refus local. Elle n’obtient pas une seconde politique métier concurrente.

#### Les données métier doivent rester hors du runtime

Cortex envoie les informations nécessaires à l’action.

Exemple pour un email :

- compte expéditeur autorisé ;
- destinataire exact ;
- contenu approuvé ;
- pièces jointes désignées ;
- contraintes et reçu attendu.

Il n’envoie pas par défaut le Personal Model, l’historique de conversation ou les raisons personnelles qui ont conduit à cet email.

## E Commoditization matrix

**Lecture des classes :** `CORE` désigne une responsabilité durable, pas nécessairement du code à réécrire soi-même. `LEGACY` signifie extérieur à la cible d’exécution Cortex ; cela n’implique pas une suppression immédiate du produit publié.

Les actions ci-dessous sont des recommandations, aucune suppression n’a été effectuée.

| Composant | Rôle / classe | Commoditisable ? | Action |
|---|---|---|---|
| Doctrine spécifique au projet | Standards choisis, CORE du harnais | Le contenu décidé par le propriétaire demeure | MOVE hors du runtime Cortex |
| Skills génériques de planification/recherche | Instructions d’exécution, COMMODITY | Oui, fortement | SIMPLIFY, retirer ceux sans bénéfice mesuré |
| Skills de conventions propres au projet | Configuration, ADAPTER | Partiellement | KEEP dans le harnais optionnel |
| Agents spécialisés et leurs compilateurs natifs | Configuration de fournisseurs, ADAPTER | Oui pour l’exécution | ADAPT aux mécanismes natifs |
| Packs Next/React/PWA/mobile/monorepo | Expertise de stack, LEGACY pour Machine local | Oui | MOVE dans l’offre de développement |
| Installation, receipts, hydrate, update | Distribution, ADAPTER | Largement | SIMPLIFY, conserver ownership et rollback |
| cli/lib/runtime-adapters.ts | Installation par runtime, ADAPTER | Oui | KEEP, sans le réutiliser comme contrat d’action |
| Règles de style/TDD des hooks | Contrôle de développement, LEGACY | Largement | MOVE hors de l’exécuteur |
| Garde-fous sur ressources sensibles | Restrictions, CORE | Implémentation remplaçable | ADAPT vers contrôles natifs vérifiables |
| Capture des événements natifs | Traduction, ADAPTER | Oui | SIMPLIFY |
| Continuité et compaction de contexte | Gestion de session, COMMODITY | Oui | ADAPT ; préserver seulement les faits opérationnels nécessaires |
| mission-engine/policy, risk, mission | Politique de développement, LEGACY | Partiellement | MOVE dans une verticale de développement |
| mission-engine/orchestration | Coordination de spécialistes, COMMODITY | Oui | SIMPLIFY, retirer la coordination doublonnée |
| Boucle autopilot | Livraison logicielle, LEGACY pour l’exécuteur local | Exécution oui ; politique propre non | MOVE hors du cœur Machine |
| Contrôles de merge, fraîcheur des preuves | Autorité de publication, CORE de la verticale dev | Pas entièrement | KEEP près de GitHub et du propriétaire de cette politique |
| Preuves liées à un SHA et des entrées | Vérification, CORE | Implémentation remplaçable | ADAPT à chaque opération |
| Graphe du catalogue | Outillage de maintenance, LEGACY | Oui | MOVE hors du runtime distribué |
| Graphe et index du code projet | Contexte technique, COMMODITY | Oui | ADAPT aux outils existants |
| Graph studio 3D | Présentation, DELETE de la cible d’exécution | Oui | DELETE de la distribution Machine minimale |
| Évaluateur de skills | Mesure de valeur, CORE de maintenance | Partiellement | KEEP tant que des skills sont livrés |
| runtime/execution.ts | Corrélation, limites, arrêt, CORE | La mécanique oui | SIMPLIFY, garder les distinctions sur l’incertitude |
| core/mission, runtime/mission | Progression générique, COMMODITY | Oui | SIMPLIFY, geler l’extension en moteur de workflows |
| sourced-note | Extraction/synthèse à deux étapes, DELETE de la cible produit | Oui | MOVE vers exemple/test de contrat |
| core/delegation, runtime/delegation | Suivi de sessions, ADAPTER | Oui | SIMPLIFY autour des handles natifs |
| Adaptateur Claude | Protocole fournisseur, ADAPTER | Oui | KEEP uniquement pour des cas réels |
| Adaptateur du daemon Codex | Protocole fournisseur, ADAPTER | Oui | KEEP, sans créer un daemon concurrent |
| Registre des runs | État d’exécution, CORE partiel | Stockage oui | ADAPT : effets/reçus, identité indépendante de Git |
| Herdr/tmux/cmux | Présentation, COMMODITY | Oui | MOVE en intégration facultative |
| Lecture/écriture locale, applications, appareils | Accès concret, DRIVER | Selon le périphérique | KEEP seulement si besoin local démontré |
| PDF, navigateur, terminal, shell générique | Outils, COMMODITY | Oui | ADAPT, réutiliser l’existant |
| Compatibilité des anciens formats/noms | Migration, LEGACY | Sans objet | KEEP jusqu’à fin de support, puis DELETE |
| Builds, tests de contrat, publication | Assurance de livraison, CORE de maintenance | Outils oui | KEEP, proportionné au périmètre restant |
| Bus distribué, scheduler, navigateur ou framework d’intégrations maison | Extensions non justifiées, DELETE | Oui | DELETE du périmètre envisagé |

**Aucun module ne mérite de rester dans le chemin d’exécution de Cortex parce qu’il aide à maintenir le harnais.**

## F Architecture cible

```text
                         VOID CORTEX
       Personal Model / objectifs / décisions / policies
                              |
              contrat borné + autorisation
                              |
                Runtime Router dans Cortex
            sélection + registre des tentatives
                  /           |           \
                 v            v            v
        Adaptateur cloud   API / MCP    Void Machine
         Dots* / Claude /    direct     local optionnel
             autre                         |
                 |                  admission locale
                 |                  restrictions natives
                 |                  reçus d’exécution
                 |                         |
                 |                    drivers utiles
                 |                   /      |       \
                 |                 FS     Apps    LAN/device
                 |
                 +------ accès local facultatif --------+
                        via la même frontière autorisée

        Chaque exécutant retourne résultat + effets + preuves

 * Sous réserve d’une interface d’intégration officiellement supportée.
```

L’accès local doit être utilisable par un exécutant externe sans imposer que Machine reprenne toute la tâche.

### Rôle retenu pour Machine

- **Runtime :** oui, au sens étroit d’exécuteur de contrats.
- **Adaptateur :** oui, vers les capacités locales et natives.
- **Drivers :** oui, en petit nombre, justifiés par des usages.
- **Daemon :** uniquement si réception distante ou observation continue l’exigent.
- **Execution engine généraliste :** non.

Pas besoin d’un daemon pour lancer une commande locale ponctuelle. Si un service résident devient nécessaire, utiliser les mécanismes de service de l’OS et une infrastructure de connexion éprouvée.

### Le local n’est pas seul une barrière durable

La documentation officielle décrit déjà l’accès de Work et Dots aux fichiers et outils d’un ordinateur connecté. La coordination peut rester dans le cloud. [Accès local officiel](https://learn.chatgpt.com/docs/enterprise/cloud-local-access).

De même, l’architecture Agents API distingue explicitement le harnais, l’environnement d’exécution et l’application cliente. [Architecture officielle](https://developers.openai.com/api/docs/guides/agents-api/architecture).

La justification locale restante doit donc être concrète :

| Besoin | Justifie Machine ? |
|---|---|
| Accéder à un fichier local | Seulement si l’accès natif existant ne convient pas |
| Utiliser une clé non exportable | Oui, pour une opération bornée de signature ou d’authentification |
| Commander un appareil ou un service LAN | Oui, si aucun adaptateur approprié n’existe |
| Fonctionner hors ligne | Oui, avec une chaîne réellement locale |
| Garantir que certaines données ne quittent pas la machine | Oui, si les sorties et l’inférence respectent aussi cette contrainte |
| Lancer un shell | Non, à lui seul |
| Ajouter une interface autour de Claude/Codex | Non, à elle seule |
| Héberger ses propres modèles | Éventuellement, via un runtime existant |

**Exécution locale et confidentialité locale sont deux propriétés distinctes.** Lire localement puis envoyer le contenu à un modèle cloud ne fournit pas une confidentialité locale.

## G Contrats essentiels

### Challenger chaque propriété d’ActionContract

| Propriété proposée | Décision |
|---|---|
| id | Garder. Identifie l’action logique ; ajouter un identifiant distinct par tentative |
| intent | Résumé facultatif. Ne fait jamais autorité pour les permissions |
| capability | Remplacer par une opération explicite et versionnée |
| inputs | Garder, schéma fermé propre à l’opération |
| resources | Garder : références bornées, versions et usages autorisés |
| constraints | Garder seulement des contraintes interprétables et vérifiables |
| authorization | Indispensable : référence à un grant vérifiable, pas un booléen |
| risk | Évaluation Cortex ; Machine peut constater un risque supérieur et refuser |
| reversibility | Ne pas accepter une déclaration optimiste du demandeur ; capacité technique à vérifier |
| timeout | Séparer échéance de la demande et durée d’exécution ; un timeout ne prouve pas l’arrêt |
| idempotency | Définir portée, empreinte, durée et mécanisme réel de déduplication |
| expected_output | Schéma de résultat, complété par des postconditions |
| evidence_required | Garder, avec types de preuve précis par opération |
| audit_context | Réduire à des références : décision, grant, corrélation et version de politique |

À ajouter : **version du contrat**, identité du demandeur authentifié, préconditions de concurrence, limites de coût lorsque réellement imposables.

#### Qui détermine quoi

| Cortex | Machine | Driver |
|---|---|---|
| But et effet demandé | Recevabilité locale | Support concret |
| Données nécessaires | Restrictions de ressources | Compte et session réellement utilisés |
| Consentement et scope | Validité du grant | Possibilité de déduplication |
| Budget et échéance | Budget encore disponible | Préconditions techniques |
| Critères de réussite | Admission du résultat | Preuves et effets observables |
| Politique de confidentialité | Respect des contraintes locales | Possibilité de réconciliation/compensation |

### Une enveloppe courte

Schéma conceptuel, pas une implémentation ajoutée au dépôt :

```text
ActionContract
  version
  action_id
  operation                 # ex. email.send@1
  inputs                    # schéma de l’opération
  resources                 # références + versions + usages
  authorization_ref
  constraints               # destination, divulgation, limites, échéance
  preconditions
  completion                # postconditions + preuves exigées
  decision_ref
```

La tentative porte séparément :

```text
ExecutionAttempt
  attempt_id
  action_id
  contract_digest
  executor_id
  dispatch_state
  native_handle
```

Cela évite de modifier le contrat métier à chaque changement de fournisseur.

**La clé d’effet métier reste stable entre les tentatives.** Changer le contenu approuvé exige de vérifier l’autorisation et l’empreinte, pas de recycler silencieusement la même clé.

### Autorisation et quatre notions distinctes

```text
Policy
  règle générale décidant ce qui peut être autorisé

Authorization
  permission concrète, bornée, attribuée à une identité

Credential
  moyen technique d’accéder à un compte ou service

Execution
  tentative d’exercer cette permission
```

Une autorisation doit être liée au minimum à :

- l’identité et au compte concernés ;
- l’opération et aux ressources ;
- l’empreinte des arguments significatifs ;
- une durée de validité ;
- ses limites ;
- l’exécutant ou à la catégorie d’exécutants admise.

Pas nécessairement un JWT ni un nouveau serveur : une référence opaque peut suffire dans un même processus. À distance, utiliser une identité authentifiée et un mécanisme de grant éprouvé.

Les credentials restent dans le composant qui exécute l’accès. **Ils ne deviennent pas des inputs du modèle.**

### Un résultat doit séparer progression et effets

L’exemple proposé mélange plusieurs dimensions. `status: failed` ne dit pas si l’email est parti.

Je retiendrais :

```text
ExecutionObservation
  action_id
  attempt_id
  contract_digest
  sequence
  state
  output?
  effects[]
  evidence[]
  artifacts[]
  issues[]
  decision_required?
  observed_at
  started_at?
  completed_at?
  runtime_identity
```

États :

```text
rejected
running
waiting_decision
succeeded
partial
failed
cancelled
unknown
```

Chaque effet :

```text
effect_id
operation
target_ref
state: not_started | applied | not_applied | unknown
external_receipt?
before_version?
after_version?
compensation_available?
evidence_refs[]
```

Règles :

- un accusé de réception n’est pas un succès ;
- un arrêt confirmé ne remet pas à zéro les effets précédents ;
- une demande d’annulation n’est pas un arrêt confirmé ;
- une absence de preuve n’est pas une preuve d’absence ;
- une sortie JSON conforme n’est pas une preuve que l’action a eu lieu ;
- un retour tronqué ne peut pas satisfaire une exigence de preuve complète ;
- les effets non observables doivent être signalés explicitement.

`errors` et `warnings` peuvent devenir une liste `issues` avec code, portée et caractère bloquant. Les messages bruts du fournisseur ne doivent pas être exposés sans filtrage.

Le résultat indique les décisions nécessaires ; **Cortex décide qui peut les prendre**.

### Capabilities explicites et peu nombreuses

Je déconseille une taxonomie centrale de dix verbes.

`execute` n’apporte presque aucune information. `communicate` et `send` se recouvrent. `browse` désigne un moyen ; `write` désigne un effet trop large.

Préférer :

```text
document.read@1
document.write@1
email.send@1
calendar.event.create@1
process.run@1
device.command@1
```

`email.send` est plus simple que :

```text
communication.send
  channel=email
  account_type=...
  transport=...
  delivery_semantics=...
```

Les regroupements `read`, `communication`, `local` peuvent rester des tags d’interface. Ils ne servent pas à autoriser une action.

Pour une tâche ouverte, une opération comme `task.perform@1` peut exister, mais elle déclare un ensemble d’outils et d’effets autorisés. Elle n’accorde jamais implicitement tous les moyens disponibles.

### Interface commune des exécutants

Quatre opérations suffisent au départ :

```text
assess(requirements) -> compatible | incompatible | unknown

start(contract, attempt_id) -> receipt | rejection | dispatch_unknown

observe(receipt) -> ExecutionObservation

cancel(receipt) -> CancellationObservation
```

`assess` reçoit les exigences minimales ; les données personnelles complètes ne partent qu’après sélection.

Les sessions interactives, streaming, notifications et demandes d’approbation sont des extensions explicites. Une API directe ne doit pas simuler une conversation ou une session persistante pour entrer dans cette interface.

À ne pas uniformiser artificiellement :

- plans de raisonnement ;
- arbres de sous-agents ;
- formats de conversation ;
- mécanismes de mémoire ;
- sémantique de cancellation ;
- garanties de sandbox ;
- coût estimé contre coût plafonné ;
- qualité des preuves.

### Discovery et compatibilité vérifiable

`browser: true` ne répond pas aux questions importantes :

- avec quel compte ?
- dans quel environnement ?
- quels sites ?
- quelles écritures ?
- quelle preuve ?
- quelle isolation ?

Chaque adaptateur devrait décrire :

```text
opération + version
environnement d’exécution
ressources accessibles
contraintes imposables
modes d’approbation
sémantique d’annulation
déduplication et réconciliation
preuves disponibles
limites
provenance + fraîcheur de la déclaration
```

Le code récent possède déjà une bonne distinction `documented | observed | verified | unknown`. À conserver.

Il faut ensuite distinguer :

```text
supporté
configuré
disponible maintenant
autorisé pour cette action
```

Une description déclarée par un fournisseur ne devient pas automatiquement une garantie testée.

## H Couplings problématiques

### H1 Trois sens différents du mot runtime

- [cli/lib/runtime-adapters.ts](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/cli/src/lib/runtime-adapters.ts#L144) installe et inspecte une configuration.
- [runtime/execution.ts](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/void-machine/src/runtime/execution.ts#L4) appelle un exécuteur.
- [AgentRuntimePort](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/runtime/delegation.ts#L153) pilote une session native.

**Conséquence :** réutiliser le premier pour Cortex serait une fausse abstraction. Nommer les frontières par leur responsabilité.

### H2 Le noyau de délégation connaît les fournisseurs

[core/delegation.ts](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/core/delegation.ts#L11) définit `['claude', 'codex']`. `RuntimePorts` impose une entrée pour chacun.

Le [contrôleur de missions](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/mission-engine/src/orchestration/controller.ts#L126) valide aussi ces identités.

**Conséquence :** l’extension ne se limite pas à brancher un adaptateur. Les protocoles fournisseurs ont pénétré les types et les validations centrales.

Pour Cortex, utiliser une identité d’exécutant opaque, résolue à la composition. Garder les détails du protocole dans l’adaptateur.

### H3 Déléguer suppose un dépôt Git

[resolveMachineRoot](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/adapters/store/run-registry.ts#L46) refuse un répertoire sans dépôt Git et dépend du checkout principal.

**Conséquence :** envoyer un email ou commander un appareil nécessiterait artificiellement un dépôt.

Injecter un emplacement de stockage ; laisser Git à la verticale de développement.

### H4 Le contrat suppose un travailleur logiciel

`ticket`, `cwd`, `agentType`, `work|review` et `brief` structurent la délégation.

Ils sont légitimes pour le harnais. Ils ne doivent pas devenir les champs obligatoires d’une action Cortex.

### H5 Le résultat est surtout le dernier message de l’agent

[RunResult](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/runtime/delegation.ts#L39) contient texte, session, date et éventuelle conformité.

**Conséquence :** il manque une description structurée des effets, des opérations non réalisées et de l’incertitude résiduelle.

La corrélation prouve à quelle session le message appartient. Elle ne prouve pas la réalité de ses affirmations.

### H6 Les preuves sont fortement orientées commandes et Git

[EvidenceDraft](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/mission-engine/src/evidence/types.ts#L27) exige notamment `type: command`, commande, code retour et `diffHash`.

Très utile pour une vérification de code ; inadapté à un reçu d’email ou à une observation d’appareil.

Conserver ce type dans la verticale développement. Ne pas le gonfler en schéma universel.

### H7 Plusieurs politiques de reprise coexistent

Le [runtime privé](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/void-machine/src/core/mission.ts#L125) refuse de rejouer une étape dont l’issue manque.

Le [recovery du mission-engine](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/mission-engine/src/orchestration/recovery.ts#L349) produit des actions de reprise et transporte une éventuelle clé d’idempotence.

Ce sont des garanties différentes. **Ne pas réutiliser le second comme moteur de fallback métier sans preuve du mécanisme de déduplication externe.**

### H8 La note sourcée impose une stratégie cognitive

[sourced-note](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/void-machine/src/verticals/sourced-note/note.ts#L11) impose deux sources ; [runtime-note](https://github.com/voidcorp-core/void-machine/blob/ae47db4c77a7ebce6070d7230a099a1a5d99cb46/packages/void-machine/src/application/runtime-note.ts#L86) compose extraction et synthèse.

C’est un bon exercice de conformité. Ce n’est pas une responsabilité durable de Machine si le fournisseur sait mieux produire la note.

### H9 Cortex possède une boucle cognitive mais pas encore un port d’actions externes

[exploration.service.ts](https://github.com/voidcorp-core/void-cortex/blob/34fdc5947399f39dd1822aebd8d643c1f4e6ab55/apps/web/src/cortex/application/exploration.service.ts#L430) traite directement les outils documentaires. `ExplorationStep` attend des messages, appels d’outils et continuations.

Un runtime de tâches complet n’est pas substituable à ce port d’inférence.

**Il faut ajouter une frontière d’action, sans essayer de faire passer Dots pour un modèle de complétion.**

### H10 Le registre local n’est pas une autorité indépendante

Le [registre](https://github.com/voidcorp-core/void-machine/blob/f55c4bda116724e126b53fb762651e947c1e61c2/packages/void-machine/src/adapters/store/run-registry.ts#L15) explique lui-même que les agents peuvent modifier ses fichiers.

Conserver ces fichiers comme observations. Ne pas en tirer seul une autorisation sensible ou une preuve indépendante.

## I Sécurité idempotence et auditabilité

### Ce qui est déjà solide

Dans les chemins inspectés :

- contrats parsés et résultats corrélés ;
- lectures et sorties bornées ;
- exécution de processus avec `shell: false` ;
- journalisation avec contrôles de concurrence ;
- permissions restrictives sur plusieurs fichiers de registre ;
- distinction entre annulation demandée et arrêt confirmé ;
- refus de rejouer certains résultats inconnus ;
- restrictions natives Codex par rôle ;
- contrôles de fraîcheur des preuves de développement.

Ces propriétés doivent survivre à la réduction du système.

### Ce qui manque pour la cible Cortex

Ce sont des **écarts au futur modèle de confiance**, pas des vulnérabilités actuellement démontrées.

| Priorité | Écart | Modification nécessaire |
|---|---|---|
| P0 | Aucun grant d’action métier dans le contrat de délégation | Autoriser identité + compte + opération + ressources + arguments |
| P0 | Permissions surtout exprimées par rôle de session | Vérifier les permissions effectives correspondant au contrat |
| P0 | Pas de garantie générale sur les effets externes | Journal d’effets, réconciliation et règles de répétition |
| P0 | Un agent peut accéder à certaines preuves locales | Séparer l’autorité d’admission des sorties modifiables |
| P1 | Environnement et sessions peuvent porter des credentials ambiants | Réduire explicitement les droits transmis ; isoler les comptes |
| P1 | Briefs et réponses conservés dans le registre | Minimisation, rétention, suppression et contrôle d’accès |
| P1 | Pas de frontière démontrée entre utilisateurs Cortex | Isolation par identité et domaine de confiance |
| P1 | Shell et navigateur peuvent agir au-delà d’une opération fine | Les refuser quand leurs droits ne peuvent pas être suffisamment bornés |

#### Secrets et permissions natives

L’adaptateur Claude reçoit l’environnement fourni par l’appelant. L’adaptateur Codex filtre certaines variables lors de ses propres lancements, mais ne nettoie pas rétroactivement un daemon démarré par l’utilisateur.

Cela ne démontre pas une fuite. Cela interdit de promettre une isolation générale des credentials.

De même :

- `dontAsk` n’est pas, à lui seul, une preuve de lecture seule ;
- `approvalPolicy: never` ne signifie pas absence de sandbox ;
- une frontière TypeScript n’est pas une isolation d’exécution.

La vérification indépendante n’a pas établi de faille exploitable dans le modèle actuel de CLI mono-utilisateur.

Pour la cible, conserver les secrets hors des environnements agentiques lorsque possible et les injecter au niveau du service ou du proxy autorisé. Cette séparation est également recommandée par la [documentation officielle de sécurité des environnements](https://developers.openai.com/api/docs/guides/agents-api/environments/security).

### Les quatre catégories d’effets ne suffisent pas seules

| Catégorie | Condition utile |
|---|---|
| READ | Vérifier aussi la destination des données lues |
| WRITE_REVERSIBLE | Avant-image et version disponibles ; restauration encore valide |
| WRITE_COMPENSATABLE | Compensation concrète connue ; elle peut nécessiter une autre autorisation |
| WRITE_IRREVERSIBLE | Effet explicitement autorisé et stratégie d’incertitude définie |

Une lecture peut divulguer un secret. Une suppression « réversible » cesse de l’être si la sauvegarde n’existe plus. Une compensation n’efface pas les conséquences humaines d’un email.

**La réversibilité est une propriété vérifiée dans un contexte, pas une permission.**

### Stratégie d’idempotence nécessaire

Le code possède des identifiants, des journaux et des clés. Il ne prouve pas une déduplication universelle des services externes.

Pour une écriture :

1. Créer une identité stable de l’effet métier.
2. Lier cette identité au compte, à l’opération et à l’empreinte des arguments.
3. Enregistrer durablement l’intention avant l’appel.
4. Réutiliser la clé native du service, lorsqu’elle existe.
5. Conserver le reçu externe.
6. Après une réponse perdue, interroger l’état avant toute nouvelle tentative.
7. Sans preuve suffisante, conserver `unknown`.

**Une clé générée localement n’empêche rien si le service destinataire ne la comprend pas.**

Le cas difficile reste :

```text
service externe applique l’effet
          |
          X réponse perdue
          |
journal local sans reçu
```

Aucune transaction locale ne résout seule ce problème.

Pour un email sans déduplication fiable : pas de nouvel envoi automatique après un timeout ambigu. Pour une modification documentaire : utiliser une précondition de version. Pour un paiement : utiliser les garanties du prestataire, pas une convention de prompt.

### Fallback

| Situation | Fallback automatique |
|---|---|
| Exécutant indisponible avant lancement | Oui, si le remplaçant satisfait le même contrat |
| Lecture échouée, divulgation toujours autorisée | Généralement oui |
| Écriture explicitement refusée avant tout effet | Possible |
| Timeout après soumission d’une écriture | Non, avant réconciliation |
| Effets partiels | Reprendre seulement les effets manquants et identifiés |
| Refus de policy ou d’autorisation | Jamais pour contourner le refus |
| Isolation, résidence ou preuve insuffisante | Non |
| Changement de compte ou élargissement de scope | Nouvelle décision nécessaire |

Une clé d’idempotence chez le fournisseur A ne protège pas contre une exécution chez B.

Le Router doit donc empêcher les tentatives concurrentes d’un même effet. Si une ancienne tentative peut encore agir et qu’aucun mécanisme ne permet de l’invalider sûrement, le remplacement attend.

### Audit minimal

```text
decision_ref
   -> contract_digest
   -> authorization_ref + policy_version
   -> route_decision
   -> attempt_id + native_handle
   -> appels significatifs + effets observés
   -> preuves
   -> résultat admis
```

Conserver :

- références et versions ;
- raisons opérationnelles courtes ;
- observations et leur provenance ;
- reçus ;
- inconnues ;
- décision humaine éventuelle.

Éviter :

- copie intégrale des conversations ;
- Personal Model ;
- tokens ;
- cookies ;
- environnement complet ;
- prompts et captures d’écran systématiques.

Les artefacts sensibles doivent avoir leurs propres droits et leur durée de conservation.

Un hash seul n’est pas une preuve d’origine. Un journal modifiable par l’exécutant ne constitue pas une autorité indépendante.

*Ce volet est un audit statique assisté, limité aux frontières d’exécution ; il ne remplace pas un audit de sécurité exhaustif ou un test d’intrusion.*

## J Migration incrémentale

### P0 Fixer la frontière avant d’élargir Machine

1. **Séparer explicitement les deux produits :**
   - harnais de développement ;
   - exécuteur optionnel pour Cortex.

   Aucun changement de dépôt nécessaire à ce stade.

2. **Geler les extensions généralistes :**
   - scheduler ;
   - navigateur ;
   - framework de sous-agents ;
   - mémoire ;
   - moteur de workflows.

3. **Choisir une seule action réelle pour prouver la frontière.**
   Bon candidat : écrire un document local à une version attendue, avec reçu et restauration possible.

4. **Définir pour cette action le grant, les préconditions, les preuves et le traitement d’une réponse perdue.**

5. **Ne pas exposer la commande agents comme API d’action Cortex.**

Critère de sortie : Cortex distingue effectivement « refusé », « fait », « partiellement fait » et « issue inconnue ».

### P1 Prouver la substitution

1. Ajouter le port d’action dans Cortex.
2. Ajouter un adaptateur local et un second exécutant réel.
3. Injecter le Router à la composition.
4. Découpler le stockage opérationnel de Git.
5. Garder les handles natifs opaques.
6. Tester les interruptions, doublons et résultats tardifs.
7. Documenter les garanties absentes de chaque exécutant.

Critère de sortie : changer l’exécutant ne modifie ni la mémoire personnelle, ni les politiques métier, ni la logique de conversation.

### P2 Réduire le périmètre

1. Sortir graphe, studio, packs et politiques de développement de la distribution d’exécution minimale.
2. Déplacer `sourced-note` vers les exemples/tests.
3. Retirer les boucles de coordination doublonnant le fournisseur.
4. Garder une seule autorité sur les tentatives d’une action.
5. Mesurer les skills : bénéfice, coût de contexte, maintenance, défauts évités.
6. Supprimer ceux qui ne justifient plus leur coût.
7. Retirer les compatibilités après une période de migration explicite.

**Ne pas fusionner tous les moteurs existants dans un nouveau super-moteur.** Réduire leurs responsabilités et supprimer les chemins devenus inutiles.

### LATER Seulement avec un besoin démontré

- service local résident ;
- accès distant sécurisé ;
- observation continue d’appareils ;
- exécution hors ligne ;
- nouveaux drivers ;
- exigences d’audit renforcées.

Pas de bus distribué ni de catalogue universel de capabilities avant des besoins qui les imposent.

## K Test de remplacement

### Ajouter OpenAIDotRuntime

#### Réserve factuelle

Les pages officielles consultées décrivent Dots, ses tâches, ses contrôles et son accès local. Elles n’établissent pas, dans cet audit, un contrat public d’API permettant d’implémenter exactement cet adaptateur.

**Je ne considère donc pas OpenAIDotRuntime comme immédiatement implémentable.** Ne pas inventer un endpoint ni automatiser son interface pour simuler une API.

Si une API supportée est disponible, l’intégration cible est :

```text
adapters/openai-dot
  traduction du contrat
  déclaration des garanties
  lancement et suivi
  correspondance des états
  réception des demandes de décision
  normalisation des preuves

composition
  enregistrement de l’adaptateur

tests
  conformité au contrat d’opération
```

Aucun changement dans :

- Personal Model ;
- mémoire ;
- politiques documentaires ;
- décisions métier ;
- schéma des objectifs ;
- logique de dialogue.

Une modification du point de composition est normale. Une modification des règles métier pour accommoder le fournisseur révèle un couplage.

#### Ce qui bloque aujourd’hui

| Obstacle | Pourquoi |
|---|---|
| Aucun port d’actions externes dans Cortex | Le point d’injection est à créer |
| ExplorationStep est un port d’inférence | Un agent autonome complet ne respecte pas cette sémantique |
| Liste Claude/Codex dans le noyau Machine | Un nouveau fournisseur implique plusieurs modifications |
| Contrat work ou review, ticket et cwd | Il suppose un travail logiciel local |
| Registre attaché à Git | Il ne couvre pas les actions métier indépendantes d’un dépôt |
| Résultat textuel de session | Il ne suffit pas pour admettre les effets métier |
| Autorisation par session | Elle n’exprime pas le consentement sur une action précise |

La première extraction demande donc du travail. Après elle, un nouveau fournisseur doit rester une affaire d’adaptateur et de composition.

#### Tests d’acceptation du remplacement

À exécuter lors de l’implémentation :

- même contrat et mêmes postconditions sur deux exécutants ;
- aucune réception de données interdites ;
- refus d’une exigence non supportée ;
- deux soumissions concurrentes du même effet ;
- réponse perdue après effet appliqué ;
- résultat tardif après cancellation ;
- preuve insuffisante malgré un texte affirmant le succès ;
- révocation ou expiration avant l’effet ;
- fallback qui conserve le compte, le scope et les préconditions.

Ce sont des tests de comportement. Une interface TypeScript compilée ne prouve pas la substituabilité.

### Les quatre scénarios

| Scénario | Résultat attendu |
|---|---|
| A — Dots reçoit 80 % des actions | Machine ne traite que les accès locaux ou garanties que les autres exécutants ne satisfont pas. Elle peut servir d’accès local à Dots |
| B — Une action nécessite une ressource locale | Même contrat côté Cortex ; différences explicites d’environnement, disponibilité et preuve. La machine éteinte reste indisponible |
| C — OpenAI disparaît ou devient trop cher | Les nouvelles actions sont routées ailleurs. Les exécutions en cours sont réconciliées ; aucune migration magique de leur état interne |
| D — Machine est supprimée | Disparaissent seulement les opérations dont elle est l’unique exécutant admissible. Le cœur de Cortex reste utilisable |

Pour C, la qualité peut baisser même si l’interface reste stable. La portabilité protège la structure du produit, pas l’équivalence des modèles.

#### Scénario D aujourd’hui

Dans les chemins Cortex inspectés, supprimer Machine ne devrait pas interrompre les fonctions de production par appel direct : cette dépendance n’existe pas.

Cela retire en revanche du confort et des contrôles au **processus de développement** de Cortex.

Dépendances futures légitimes :

- périphérique accessible uniquement par Machine ;
- clé locale non exportable ;
- opération hors ligne ;
- driver local sans remplaçant.

Couplings accidentels à interdire :

- mémoire de Cortex stockée dans les journaux Machine ;
- objectifs identifiés par un `missionId` Machine ;
- politique métier définie dans les skills Machine ;
- statut d’action confondu avec le statut d’une session Claude/Codex ;
- obligation d’avoir Git, Herdr ou le CLI pour utiliser Cortex.

## L Conclusion

> **Si OpenAI Dots devient dix fois meilleur dans un an, quelle est encore la raison d’exister de Void Machine ?**

**Donner accès, sous une autorisation vérifiable, aux quelques ressources et effets locaux que Cortex veut contrôler indépendamment du fournisseur, puis rendre compte de ce qui s’est réellement passé.**

Cela peut se réduire à :

```text
local execution
+ authorization enforcement
+ quelques drivers
+ effect receipts
```

Même cette responsabilité ne justifie pas de tout construire : réutiliser les sandboxes, services, protocoles et gestionnaires de secrets existants.

Le harnais d’ingénierie peut continuer à vivre comme produit distinct si ses standards et contrôles apportent une valeur mesurée. Son existence ne justifie pas de le placer au cœur de Cortex.

**Le bon test n’est pas que Machine sache tout remplacer. C’est que Cortex puisse cesser de l’utiliser sans perdre son identité, sa mémoire, ses décisions ni ses politiques.**

## Vérification

Arbres Git inchangés ; inspection des références précisée ci-dessus ; contre-vérification sécurité indépendante. Le doctor exécuté via le CLI local a validé l’artefact self-host en mode `shadow`, pas les sources avancées. Tests, lint et typecheck non relancés : aucun code modifié, audit statique uniquement. Aucune recommandation n’a été inscrite silencieusement dans la doctrine.
