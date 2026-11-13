---
title: Capacités avancées pour un harnais IA utile et fiable
date: 2026-11-10
status: catalogue-propose
---

# Capacités avancées pour un harnais IA utile et fiable

Recherche élargie demandée par Folpe : les premiers exemples de RAG, confiance et retries ne constituaient pas un inventaire exhaustif. Ce catalogue couvre 50 capacités, regroupées en dix familles. Il complète le [document de fiabilité](2026-11-10-mission-reliability.md), qui approfondit les limites et les preuves de ces mécanismes.

Il s'agit d'une sélection argumentée, pas d'un état de l'art exhaustif, d'une certification du produit ni d'une feuille de route approuvée. Aucun mécanisme n'est déclaré livré par sa présence ici. Aucune dépendance, doctrine, permission ou architecture nouvelle n'est adoptée. Les recommandations et mesures proposées sont notre synthèse ; les sources décrivent leurs propres systèmes, pas les performances de Machine. Recherche documentaire au 10 novembre 2026, sans benchmark de Machine ni mesure sur le matériel du client.

## Diagnostic et choix prioritaires

Un harnais performant améliore surtout la qualité du contexte, la justesse des actions et la capacité à constater ce qui s'est réellement passé. Le raisonnement plus long, les agents supplémentaires et les index sophistiqués ne valent que leur gain net sur des missions représentatives.

Les premiers investissements que je recommande d'examiner ensemble sont :

1. **Des critères de réussite et des vérificateurs métier**, avec un petit corpus de missions représentatives. Sinon, impossible de distinguer progrès réel et réponse convaincante.
2. **Un contexte sélectif et traçable**, avec outils et compétences chargés à la demande. Réduire le bruit avant d'augmenter les modèles.
3. **Une exécution sous mandat**, avec préconditions, effets confirmés et reprise conservant les budgets. Une déconnexion ne doit ni doubler une action ni effacer une protection.
4. **Des tests de panne, d'injection et de correction humaine**, en plus des scénarios heureux. Mesurer la qualité de l'assistance, pas seulement l'autonomie.
5. **Un budget de ressources et une trace lisible**, pour identifier les appels, recherches et contrôles qui peuvent être supprimés. Optimiser le coût par mission réussie, pas seulement le prix d'un appel.

Ce sont des responsabilités à éprouver sur un petit parcours, pas cinq nouveaux sous-systèmes à construire. La [vocation existante](../MACHINE-VOCATION.md) et ses primitives restent le point de départ.

## Comment lire le catalogue

- **S — Socle** : à couvrir lorsque le pilote utilise la frontière concernée. Ne signifie pas créer une couche supplémentaire.
- **C — Conditionnel** : à ajouter seulement face à un besoin observé, après comparaison avec le parcours simple.
- **E — Expérimentation** : hypothèse ou technique à fort coût de validation ; conserver hors du chemin critique jusqu'à preuve de valeur.

La priorité n'est pas la maturité : une fonction d'inférence bien documentée peut rester inutile sur notre matériel. Une publication scientifique prouve des résultats dans son protocole, pas dans tous les domaines. Les numéros servent à discuter les capacités une par une, pas à créer automatiquement des tickets.

## 1. Comprendre l'intention et choisir l'effort

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 01 | Mandat structuré et critères observables | S | Expliciter résultat, cible, périmètre, budget et autorité. Une extraction JSON ne vaut pas consentement. Réutiliser le contrat de mission. | Ambiguïtés détectées, actions hors mandat refusées, vrais résultats correctement reconnus. |
| 02 | Clarification sélective | S | Chercher une information autorisée ou poser la question qui débloque réellement l'action. Ne pas inventer une cible et ne pas faire confirmer chaque détail réversible. | Réussite, nombre et durée des interventions ; décisions erronées faute de question. |
| 03 | Routage entre fonction, workflow et agent | C | Calcul déterministe pour un calcul ; chemin connu pour une tâche stable ; agent lorsque le chemin dépend des observations. Éviter un LLM pour chaque transition. | Même résultat, appels et latence évités ; qualité sur demandes ambiguës. |
| 04 | Planification à horizon court et dépendances | C | Définir le livrable, détailler la prochaine étape, replanifier si les faits changent. Un plan révisé n'élargit jamais le mandat. | Travail abandonné, dépendances manquées et réussite après changement de préconditions. |
| 05 | Calcul et délégation adaptatifs | C | Dépenser plus sur une difficulté identifiable ; déléguer des recherches indépendantes ou une vérification utile. La comparaison de plusieurs candidats reste bornée, sans dupliquer les effets externes. | Gain contre un agent simple, coût total et délai ; erreurs corrélées et travail en double. |

Appuis : [Building effective agents](https://www.anthropic.com/research/building-effective-agents), [retour d'expérience multi-agent](https://www.anthropic.com/research/multi-agent-research-system), [τ²-Bench sur la coordination agent-utilisateur](https://arxiv.org/abs/2506.07982). L'allocation d'effort et les mesures ci-dessus sont des propositions pour Machine, pas une promesse des benchmarks.

## 2. Construire le bon contexte

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 06 | Contexte chargé juste à temps | S | Donner au modèle les informations utiles à l'étape, puis récupérer les détails nécessaires. Éviter de verser tout le dossier dans chaque prompt. | Réussite à budget égal, omissions critiques, tokens et latence. |
| 07 | Découverte progressive des outils et compétences | C | Charger les descriptions pertinentes au besoin. Le catalogue expose des capacités autorisées ; sa recherche ne donne pas de permission supplémentaire. | Bon outil trouvé, erreurs de sélection, taille du contexte. |
| 08 | Compaction avec état structuré et références | C | Résumer la conversation en gardant objectifs, contraintes, décisions et références aux pièces. L'état de mission et les événements restent séparés d'un résumé potentiellement inexact. | Reprise longue sans perte d'obligation, de budget ni de résultat déjà acquis. |
| 09 | Contextes de travail isolés | C | Donner à chaque spécialiste le sous-ensemble utile, puis intégrer un retour sourcé. Ne pas recopier toute la conversation ni traiter son avis comme une autorisation. | Fuites entre tâches, conflits de conclusions, qualité et coût de synthèse. |
| 10 | Artefacts référencés et traitement hors contexte | C | Conserver les gros résultats dans des objets contrôlés ; filtrer, agréger ou calculer avant leur lecture par le modèle. Références soumises aux mêmes droits que les données. | Volume transmis, exactitude des calculs, possibilité de retrouver la preuve. |

Appuis : [context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [advanced tool use](https://www.anthropic.com/research/advanced-tool-use), [traitement programmatique des résultats](https://www.anthropic.com/research/code-execution-with-mcp). Les principes sont transférables ; les fonctionnalités d'API présentées par Anthropic ne sont pas supposées disponibles dans tous les modèles locaux. Aucun choix de transport n'en découle.

## 3. Trouver et comprendre les preuves

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 11 | Recherche fédérée et routage de requête | C | Choisir entre index, recherche exacte, données structurées et connecteur vivant. Une donnée d'agenda actuelle peut demander une lecture directe plutôt qu'un ancien embedding. | Fraîcheur, source pertinente choisie, appels et erreurs de cible. |
| 12 | Pipeline hybride, réécriture et reranking | C | Combiner exact et sémantique, préserver la demande originale, puis classer les résultats. Tester chaque composant séparément avant de les empiler. | Recall@k, NDCG, qualité finale, latence ; références exactes perdues par réécriture. |
| 13 | Découpage tenant compte du document | C | Garder titres, sections et contexte parent ; éventuellement contextualiser les fragments. Le texte ajouté par un modèle reste dérivé, distinct de la source. | Extraits retrouvés et correctement attribués ; erreurs introduites à l'indexation. |
| 14 | Ingestion multimodale et structurelle | C | Lire tableaux, scans et figures avec leur provenance ; préserver unités, cellules et ordre de lecture. L'OCR ou la vision peuvent se tromper. | Exactitude sur documents représentatifs, citations jusqu'à la page ou zone source. |
| 15 | Recherche relationnelle et synthèse globale | E | Un graphe peut aider aux questions transversales sur des entités liées ou un corpus entier. Ne pas imposer GraphRAG à la recherche d'un document précis. | Gain face à la recherche simple, coût de construction et mise à jour, erreurs de relations. |

Appuis : [recherche hybride Azure](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview), [Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval), [modèle documentaire Docling](https://docling-project.github.io/docling/concepts/docling_document/), [modes de recherche GraphRAG](https://microsoft.github.io/graphrag/query/overview/). Microsoft décrit la recherche globale GraphRAG comme intensive en ressources. Ces exemples n'imposent ni fournisseur cloud ni base vectorielle. Les évaluations et limites de réécriture sont détaillées dans le document de fiabilité.

## 4. Donner au modèle des outils utilisables et contrôlables

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 16 | Outils conçus pour une tâche utile | S | Noms précis, arguments sans ambiguïté, erreurs exploitables et sorties compactes. Ne pas exposer une API métier entière sous forme de centaines de petits appels. | Mauvais outils/arguments, nombre d'appels et réussite réelle. |
| 17 | Sorties contraintes et protocole de tool calling | S | Schéma ou grammaire pour les données ; adaptateur compatible avec le modèle. Valider ensuite sens, références et permissions. Un JSON valide peut être faux. | Format, exactitude des champs, appels tronqués ou doublés, refus correctement traités. |
| 18 | Préconditions et contrôle de concurrence | S | Vérifier identité, version et état avant mutation ; détecter une modification depuis la lecture ou l'accord humain. Comparaison atomique lorsque l'API le permet. | Écriture sur mauvaise version refusée ; course entre deux missions ; accord devenu périmé. |
| 19 | Prévisualisation et résultat vérifiable | S | Présenter l'effet exact lorsqu'un accord est nécessaire, puis vérifier l'état obtenu. Un bouton « OK » ou un HTTP 200 ne suffit pas à prouver la mission. | Écart prévu/réalisé, mauvais destinataire, échec métier malgré transport réussi. |
| 20 | Exécution programmatique bornée | C | Regrouper des lectures et transformations en calcul isolé pour éviter des tours de modèle. Toute action reste médiée ; aucun accès libre aux secrets, fichiers ou réseau. | Appels et tokens économisés, limites CPU/temps, mêmes refus que les outils directs. |

Appuis : [Writing effective tools](https://www.anthropic.com/research/writing-tools-for-agents), [sorties structurées vLLM](https://docs.vllm.ai/en/latest/features/structured_outputs/), [serveur et templates llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). Préconditions, prévisualisation et contrôle atomique sont ici des recommandations d'ingénierie adaptées aux effets métier, pas des garanties procurées par le décodage contraint.

## 5. Exécuter longtemps sans perdre le contrôle

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 21 | Reprise durable et versionnée | S | Retrouver mission, effets, preuves et budgets après redémarrage. Prévoir compatibilité de l'état avec le code qui reprend ; réutiliser les journaux existants. | Pannes à chaque frontière, même mission et historique, aucune remise à zéro. |
| 22 | Idempotence et réconciliation d'effet inconnu | S | Dédupliquer quand c'est possible ; vérifier une opération dont la réponse s'est perdue avant de réessayer. Sinon conserver l'incertitude. | Coupure après écriture, zéro doublon induit, effet inconnu correctement signalé. |
| 23 | Retry technique borné et coupe-circuit | S | Réessayer les erreurs transitoires avec délais, jitter et budget ; arrêter d'insister sur un service indisponible. Pas de retry d'une permission refusée ou d'un verdict défavorable. | Amplification des appels, respect des limites, temps de retour à un service sain. |
| 24 | Attente durable et annulation | S | Attendre un utilisateur ou un événement sans faire tourner le LLM ; reprendre au bon endroit. Une réponse tardive ne réactive pas une mission annulée. | Redémarrage pendant attente, réponse répétée, ressources libérées après annulation. |
| 25 | Effets partiels et compensation | C | Distinguer ce qui est fait, restant et irréversible. Une compensation est une nouvelle action soumise au mandat, pas un rollback universel magique. | Panne après une étape, absence de dommage supplémentaire, retour partiel fidèle. |

Appuis : [timeouts, retries et jitter, AWS](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/), [exécution durable, Temporal](https://docs.temporal.io/ai), et limites de checkpoint/replay dans le document de fiabilité. Temporal et LangGraph sont des exemples de primitives à comparer à l'existant, pas des dépendances choisies. La persistance seule ne garantit jamais un effet externe « exactement une fois ».

## 6. Sécuriser les données et les actions

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 26 | Capacités limitées et contrôle avant chaque effet | S | Accès par mission, objet et opération ; délégation sans amplification des droits. Les propositions du modèle passent par une décision déterministe de Machine. | Refus d'accès croisés, extension de périmètre et délégation malveillante. |
| 27 | Isolation effective et contrôle des sorties | S | Cloisonner exécution, fichiers, réseau, connecteurs et ressources. Garder les credentials dans les adaptateurs ; ne pas les inclure dans les prompts. | Exfiltration, accès hors cible, secrets dans les traces ; droits réellement appliqués. |
| 28 | Données non fiables séparées des instructions | S | Un mail, PDF ou résultat d'outil peut contenir une injection. Il ne doit pas modifier le mandat ou acquérir l'autorité d'une instruction système. | Attaques dans les contenus avec maintien des tâches légitimes autorisées. |
| 29 | Contrôle des flux et provenance de type CaMeL | E | Étudier le suivi des données et des capacités pour bloquer des flux interdits. Défense structurelle prometteuse, avec coût et restrictions de fonctionnement à évaluer. | Utilité conservée, attaque empêchée, contraintes de politique explicites ; pas de garantie universelle. |
| 30 | Intégrité des modèles, outils et index | S | Versions identifiables, origine vérifiée, configuration maîtrisée, ingestion et index soumis aux droits. Un modèle local ou un plugin installé n'est pas automatiquement digne de confiance. | Mise à jour malveillante, index empoisonné, permissions révoquées, logs et caches exposés. |

Appuis : [OWASP, excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/), [AgentDojo](https://arxiv.org/abs/2406.13352), [CaMeL](https://arxiv.org/abs/2503.18813). CaMeL décrit des garanties sous son modèle de contrôle et mesure un compromis d'utilité ; cela ne certifie ni une intégration future ni tous les scénarios d'agents. Les restrictions opérationnelles proposées ici restent à éprouver sur les adaptateurs réels.

## 7. Mesurer la qualité au lieu de la déclarer

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 31 | Vérificateurs de résultat par spécialité | S | Contrôler un document, un état d'agenda ou un comportement logiciel avec des critères métier. Préférer un contrôle déterministe lorsqu'il suffit. | Faux succès détectés, vrais résultats acceptés ; qualité du vérificateur lui-même. |
| 32 | Confiance calibrée et abstention | C | Estimer la fiabilité sur tâches comparables, avec jeu tenu à l'écart. Séparer confiance de réponse, qualité des preuves et effet observé. Pas de pourcentage inventé par le modèle. | Calibration, risque selon couverture, erreurs acceptées ; revalidation après changement de modèle. |
| 33 | Vérification croisée réellement informative | C | Source primaire, calcul indépendant ou relecteur sur un point précis. Diversifier la preuve, pas seulement le nom du modèle ; désaccord conservé et expliqué. | Erreurs supplémentaires détectées contre coût ; corrélation des erreurs. |
| 34 | Évaluation des trajectoires et de l'aide humaine | S | Vérifier permissions, ordre nécessaire des effets et interventions utiles ; accepter plusieurs chemins valides. Aucun besoin de stocker le raisonnement interne détaillé. | Actions superflues/interdites, demandes inutiles ; succès autonome séparé du succès assisté. |
| 35 | Campagnes de panne et d'attaque | S | Injecter coupures, réponses périmées, doublons, documents hostiles et corrections en cours de mission, dans un environnement isolé. | Réussite légitime, taux d'attaque, duplications, récupération ; comparer aux cas non perturbés. |

Appuis : [évaluations d'agents, Anthropic](https://www.anthropic.com/research/demystifying-evals-for-ai-agents), [scorers personnalisés Inspect](https://inspect.aisi.org.uk/custom-scorers.html), [interventions Inspect](https://inspect.aisi.org.uk/intervention.html), τ²-Bench et AgentDojo. Pour la calibration, les biais des juges et les erreurs corrélées, voir les publications citées dans le document de fiabilité. Les campagnes de panne sont une proposition d'ingénierie, pas une preuve déjà obtenue.

## 8. Gérer la mémoire sans accumuler de fausses certitudes

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 36 | Séparation état d'exécution / mémoire personnelle | S | Machine conserve le nécessaire à la mission et à sa preuve ; Cortex décide de la mémoire durable. Pas de second cerveau personnel implicite dans les logs. | Reprise possible sans exploitation hors mandat des anciennes missions. |
| 37 | Provenance, temps et contradictions | S | Dater les faits, distinguer auteur/source/inférence et conserver les désaccords. Une information remplacée ne doit pas redevenir actuelle via un résumé. | Scénarios avant/après changement, bonne version utilisée, contradictions signalées. |
| 38 | Oubli et invalidation propagés | S | Révoquer un fait ou un accès dans les caches, résumés et index concernés, avec politique explicite de conservation des preuves. Effacement physique et non-utilisation sont distincts. | Requête après révocation, données dérivées contrôlées, absence de réapparition. |
| 39 | Rappel d'expériences et de procédures validées | C | Retrouver une procédure approuvée pertinente, via son propriétaire, plutôt que réinventer. Vérifier qu'elle convient encore ; aucun recyclage d'ancienne permission. | Transfert réussi à une nouvelle tâche, erreurs dues aux précédents obsolètes. |
| 40 | Réutilisation de preuves et cache de résultats | C | Réutiliser si entrées, versions, droits et fraîcheur restent valides. Une similarité sémantique seule ne justifie ni une réponse métier ni une mutation. | Taux de réutilisation sûre, cas invalidés ; distinguer économie du cache et du routage. |

Appuis : frontière Cortex/Machine déjà décidée et [Memora, From Recall to Forgetting](https://arxiv.org/abs/2604.20006). Ce benchmark étudie notamment la réutilisation de souvenirs périmés ; il ne certifie pas l'effacement physique. Les contrats d'invalidation et de conservation ci-dessus sont des propositions propres à notre architecture.

## 9. Exploiter efficacement les modèles locaux

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 41 | Routage de modèles et petits spécialistes | C | Utiliser classification, embeddings, reranking ou petit modèle pour les tâches où ils suffisent ; escalader vers un modèle plus capable sur critères évalués. Aucun cloud de secours non autorisé. | Qualité/coût/délai par mission, faux cas acceptés, coût des deux appels lors d'escalade. |
| 42 | Réutilisation de préfixes et KV cache | C | Le moteur réutilise le calcul de préfixes identiques ; Machine peut stabiliser les instructions utiles. Améliore le prefill, pas la génération de nouveaux tokens. | Latence premier token à froid/chaud, taux de cache et isolation entre utilisateurs. |
| 43 | Batching et admission selon les ressources | C | Le moteur batch les requêtes et peut fractionner le prefill ; Machine borne sa file et privilégie l'interactif. Limites effectives sur RAM/GPU/CPU au niveau de l'hôte. | p95 de réponse sous charge, attente, saturation, réactivité du poste et annulation. |
| 44 | Quantification et profils mémoire | C | Poids quantifiés pour tenir sur le matériel ; cache KV et tailles de chunks adaptés. Moins de mémoire ne garantit ni vitesse ni qualité identique ; une fenêtre KV réduite peut perdre de l'information. | Mémoire/swap, vitesse et exactitude métier contre un profil de référence. |
| 45 | Décodage spéculatif vérifié | E | Un petit modèle ou mécanisme de draft propose des tokens vérifiés par le moteur cible. Technique d'inférence, pas une seconde opinion métier. | Latence totale, taux d'acceptation, RAM supplémentaire et qualité ; régression sous charge. |

Appuis : [RouteLLM](https://arxiv.org/abs/2406.18665), [modèles de pooling vLLM](https://docs.vllm.ai/en/latest/models/pooling_models/), [prefix caching vLLM](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/), [réglages vLLM](https://docs.vllm.ai/en/latest/configuration/optimization/), [MLX LM](https://github.com/ml-explore/mlx-lm), [speculative decoding vLLM](https://docs.vllm.ai/en/latest/features/speculative_decoding/), et llama.cpp cité plus haut. Fonctionnalités documentées, gains dépendants du modèle, du moteur et du matériel. Les variantes spéculatives explicitement avec perte n'ont pas les garanties des algorithmes vérifiés usuels.

Machine ne réimplémente pas les kernels d'inférence. Elle choisit les politiques et vérifie les résultats. Un modèle local ne reçoit que le contexte autorisé et propose des actions ; Machine contrôle leur exécution. Endpoint, télémétrie, logs, caches et chargement de code distant restent à examiner même sur une machine chez le client.

## 10. Observer, apprendre et simplifier

| ID | Capacité | Rang | Apport et limite | Vérification proposée |
| --- | --- | --- | --- | --- |
| 46 | Trace causale et vue visuelle de la mission | S | Montrer étapes réelles, recherches, outils, attentes, échecs, preuves et coût. Un graphe d'événements aide à comprendre le délai sans inventer une explication du raisonnement interne. | Une panne et un appel coûteux localisés ; liens vers résultats réels ; données sensibles masquées. |
| 47 | Jeu d'évaluation versionné et déploiement comparé | S | Cas ordinaires, difficiles et adversariaux ; versions de modèle/prompts/outils traçables. Comparer une candidate sur environnement isolé ou en observation sans effets doublés, puis pouvoir revenir à une version connue. | Régressions par famille, faux succès, coût par réussite et compatibilité des missions en cours. |
| 48 | Optimisation hors production des prompts | C | Comparer prompts, exemples et composants avec feedback ; DSPy/GEPA est un candidat. Garder un jeu final indépendant et faire approuver la modification. | Gain hors données d'optimisation, coût de recherche, absence de régression sécurité. |
| 49 | Spécialisation de modèles par fine-tuning ou distillation | E | À envisager pour une tâche fréquente et stable si contexte, outils et prompts plafonnent. PEFT/LoRA réduit la partie entraînée ; le transfert d'un enseignant reste à évaluer séparément. | Exactitude hors apprentissage, coût complet, dérive et facilité de mise à jour ; droits sur les données. |
| 50 | Ablation du harnais et suppression de complexité | S | Retirer expérimentalement un composant pour mesurer son apport, notamment après changement de modèle. Ne pas retirer une frontière de permission pour gagner un benchmark. | Baseline / ajout / retrait sur mêmes tâches : réussite, latence, coût et maintenance. |

Appuis : [conventions OpenTelemetry pour agents](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md), [GEPA dans DSPy](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/optimizers/GEPA/overview.md), [PEFT](https://huggingface.co/docs/peft/quicktour), [retour d'expérience sur la conception de harnais longs](https://www.anthropic.com/research/harness-design-long-running-apps). Les conventions GenAI consultées sont en statut Development : ne pas figer un contrat interne sur leur stabilité supposée. L'observation comparative et la distillation sont ici des pistes proposées, pas des résultats démontrés pour Machine.

## Répartition des responsabilités

| Propriétaire | Responsabilité | À ne pas lui faire porter |
| --- | --- | --- |
| Cortex ou demandeur autorisé | Intention, priorités, autorité, acceptation finale ; Cortex possède la mémoire personnelle durable. | Les détails de scheduling GPU ou de retry de chaque outil. |
| Machine | Exécution de la mission, contexte autorisé, budgets, propositions du modèle contrôlées, effets vérifiés, reprise et compte rendu. | Un cerveau personnel concurrent ou des permissions déduites d'un texte retrouvé. |
| Spécialité et adaptateurs | Contrats d'outils, erreurs métier, préconditions et vérificateurs adaptés au domaine. | Une suite de tests de développement imposée à une mission d'agenda. |
| Moteur d'inférence | Modèle, décodage, batching, cache KV et usage des accélérateurs. | L'autorité d'exécuter directement une action métier sur la seule proposition du modèle. |

Cette répartition n'impose ni nouveaux services ni multiplication des packages. Une fonction suffit tant que sa responsabilité et sa frontière sont claires. Une utilisation sans Cortex reçoit le mandat d'un demandeur autorisé ; elle ne supprime pas ces contrôles.

## Ordre de travail proposé

1. **Choisir deux ou trois missions représentatives**, dont une avec un effet réversible et une nécessitant de retrouver des preuves. Établir l'exécution la plus simple et les critères de réussite. Le parcours reste à choisir avec Folpe.
2. **Éprouver le socle traversé par ces missions** : contexte, permissions, vérification, reprise, trace et ressources. Réutiliser les propriétaires existants ; noter ce qu'on peut supprimer ou fusionner.
3. **Traiter les échecs et coûts dominants un à un**. Par exemple, mauvais extrait → amélioration du retrieval ; mauvais outil → contrat d'outil ; saturation → admission ; fausse réussite → vérificateur. Un modèle plus gros n'est pas le remède par défaut.
4. **Comparer les techniques conditionnelles** sur les mêmes missions, puis garder uniquement celles qui apportent un gain. Aucun chiffre de gain n'est promis ici.
5. **Réserver les expérimentations** à un plafond concret : GraphRAG, contrôle de flux avancé, calcul multi-candidat, décodage spéculatif ou entraînement de modèles. Un framework s'adopte pour une primitive manquante et prouvée, pas pour sa popularité.

Mesures communes : réussite vérifiée par catégorie, faux succès, violations d'autorisation, effets dupliqués, interventions humaines, temps médian/p95, temps d'attente, appels/tokens et coût total par mission réussie. Ajouter RAM/GPU/énergie si l'instrumentation locale le permet. Une tâche différée ou refusée n'est pas comptée comme réussie ; un résultat assisté est identifié.

Comparer sur les mêmes cas, avec versions et limites explicites. Mesurer la variabilité des modèles sur un nombre de répétitions adapté ; ne pas répéter une exécution en production jusqu'à obtenir le résultat désiré. Ne pas additionner deux économies qui portent sur les mêmes appels, par exemple cache et routage. Les évaluations lourdes sont déclenchées selon les changements concernés et lors de campagnes bornées ; ce catalogue ne demande pas une batterie IA coûteuse à chaque modification documentaire.

## Ce que je déconseille par défaut

- Un essaim de modèles ou une réunion de critiques pour chaque intention.
- Un seuil de « confiance » autodéclaré qui autorise des tours illimités.
- Une mémoire qui conserve tout, sans provenance, révocation ni propriétaire.
- Un graphe de connaissances avant d'avoir démontré les limites de la recherche simple.
- Une similarité de prompt traitée comme permission de réutiliser une action ou un fait périmé.
- Du fine-tuning pour corriger une information qui devrait être retrouvée dans une source à jour.
- Des prompts, outils ou règles qui s'auto-modifient en production sans évaluation et décision explicite.
- Un second orchestrateur global, ou l'adoption simultanée de plusieurs frameworks d'agents.

Le critère de sélection reste : quelle erreur ou perte de temps cette capacité corrige-t-elle, et quelle preuve permet de conserver ou de retirer sa complexité ?
