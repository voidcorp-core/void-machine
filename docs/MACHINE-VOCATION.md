# Vocation de Void Machine

Orientation architecturale autorisée par Folpe le 29 octobre 2026.
[Décision et alternatives](decisions-log/2026-10-29-machine-execution-system-of-cortex--21424ca9-48ce-4b9e-a559-3d23d44481b4.md).
Ce document porte la doctrine cible ; le diagnostic ci-dessous distingue les
capacités présentes des adaptations encore nécessaires. Il ne crée pas d'API.

## Finalité et frontières

Void Machine est le système d'action et d'exécution de Void Cortex. Le harnais
de développement logiciel est son premier domaine d'application, pas sa finalité.
Machine reçoit une mission structurée, détermine les étapes, sélectionne capacités
et outils, mobilise les spécialistes utiles, exécute les actions autorisées,
vérifie leurs résultats, gère les erreurs et reprises, puis retourne les preuves
et résultats à Cortex. Son autonomie de raisonnement reste dans le mandat reçu.

| Responsabilité | Propriétaire | Frontière |
|---|---|---|
| Intention, objectifs et priorités | Cortex | Machine peut proposer une clarification ou un changement de plan, pas redéfinir l'objectif global. |
| Contexte personnel et métier durable, mémoire persistante | Cortex | Machine reçoit le contexte nécessaire et propose des connaissances ; Cortex décide de leur mémorisation. |
| Autorisations | Cortex, sous contrôle utilisateur | Machine vérifie et applique le mandat, les permissions des outils et du runtime ; elle ne s'accorde jamais un droit manquant. |
| Plan d'exécution, orchestration opérationnelle, outils et spécialistes | Machine | Liberté de choix dans le périmètre autorisé ; pas de second orchestrateur global concurrent. |
| Vérifications techniques et preuves | Machine | Un succès technique n'est pas l'acceptation finale du résultat. |
| Acceptation finale et arbitrages hors mandat | Cortex | Un résultat ou une proposition ne vaut pas consentement à l'action suivante. |
| État de mission, reprise et journal des effets | Machine | État limité à l'exécution ; il peut persister pour la reprise sans devenir une mémoire personnelle. |

En usage direct, l'humain reste l'autorité du mandat et de l'acceptation ; Cortex
n'est pas un prérequis pour utiliser le harnais. Les deux entrées doivent partager
les mêmes capacités et garanties, sans créer deux versions de la spécialité dev.
Une autorisation déjà accordée reste valable dans son périmètre : ne pas la
redemander à chaque étape. Un dépassement ou une ambiguïté exige une clarification
ou une autorisation supplémentaire avant l'action concernée.

## Spécialités et économie d'exécution

Développement, juridique, finance, gestion commerciale, recherche, gestion
documentaire, administration et automatisation métier sont des spécialités
possibles. Cette liste n'affirme pas qu'elles sont livrées. Leurs procédures,
critères de qualité et contraintes métier doivent rester dans leur périmètre.
Une spécialité simple peut être exécutée par l'agent principal. Un spécialiste
peut être une compétence, un outil déterministe ou un avis délégué ; il n'est pas
nécessairement un agent autonome.

1. Choisir le chemin d'exécution le plus simple qui satisfait le mandat.
2. Déléguer seulement pour un bénéfice identifiable : expertise, indépendance ou parallélisme utile.
3. Éviter les coordinations et validations redondantes ; réutiliser les preuves encore valides.
4. Préférer les contrôles déterministes pour les propriétés qu'ils peuvent réellement établir.
5. Adapter les vérifications au risque réel et à la spécialité, sans confondre conformité de forme et justesse du fond.
6. Préserver les garanties de sécurité et les contrôles de confiance aux frontières.
7. Respecter strictement les permissions reçues et les restrictions effectives des outils.
8. Demander l'autorisation manquante avant un effet hors mandat, sans bloquer les travaux indépendants déjà autorisés.
9. Préserver l'idempotence des effets : identifier l'opération, réconcilier un résultat ambigu avant toute répétition ; une clé seule ne prouve pas l'absence de doublon chez le fournisseur.
10. Arrêter les boucles sans amélioration significative ; exposer le blocage, son responsable et la prochaine action utile au lieu de déclarer un faux succès.

La vitesse, la fiabilité et la sécurité doivent progresser ensemble. La loi de
Pareto réduit le travail sans valeur, pas les permissions ni les preuves requises.
Pour du code, TDD, séparation des responsabilités, qualité et sécurité restent
applicables. Une mission documentaire ne doit pas hériter automatiquement d'un
workflow de PR, de Git, de TDD ou d'un panel de développeurs.

## Mandat et retour vers Cortex

Le mandat doit rendre explicites le résultat attendu, le périmètre et les cibles,
le contexte utile, les actions autorisées et interdites, les contraintes et
budgets pertinents, ainsi que les critères d'acceptation. Un projet Git n'est
pas une cible obligatoire. Ce sont des exigences sémantiques : le format de
transport, sa version et son exposition publique restent à définir avec un
premier appelant Cortex réel, en réutilisant les contrats existants pertinents.

Chaque mission doit pouvoir retourner :

| Élément | Sens attendu |
|---|---|
| Statut | `succès`, `échec`, `partiel` ou `incertain`, avec une raison. Succès signifie critères de mission vérifiés, pas acceptation humaine ni mémorisation. |
| Résultat | Livrable ou référence accessible et limites de validité. |
| Actions réellement exécutées | Distinguer prévu, tenté, confirmé et effet inconnu ; ne pas transformer une intention d'outil en action prouvée. |
| Preuves et sources | Références pertinentes, origine, date et périmètre de vérification ; éviter de transférer inutilement secrets ou données personnelles. |
| Erreurs et limites | Échecs, vérifications absentes, restrictions et incertitudes ; une absence de preuve n'est pas un succès. |
| Propositions de connaissances | Faits vérifiés avec preuves, hypothèses identifiées, décisions avec leur auteur/autorité, informations potentiellement périmées avec date et besoin de revalidation. |
| Travail restant | Actions non faites, effets à réconcilier, dépendances et autorisations requises. |

`partiel` signifie qu'une portion déterminée est accomplie ; `incertain` signifie
qu'un résultat ou effet important ne peut pas être établi. En cas de mélange,
retourner `incertain` et préciser la partie vérifiée. Ne pas réduire les états
techniques existants (`blocked`, `completed`, etc.) à ces statuts par un simple
renommage : la spécialité doit fournir les preuves et la traduction pertinente.
Machine propose les connaissances ; elle ne décide pas de leur mémorisation.

Les journaux et reçus nécessaires à la reprise ou à la preuve peuvent survivre
au processus. « Temporaire » décrit leur responsabilité, pas une permission de
les effacer. Durée de conservation, accès et suppression doivent respecter le
mandat et les obligations applicables. Ils ne constituent ni une base de mémoire
personnelle ni un historique global que Machine exploiterait pour choisir des
objectifs à la place de Cortex.

## Diagnostic de l'existant

Lecture du code et des contrats au commit `7e58f5b67ec4f6df8826c24e6baf3175ae22890b`
(develop observé le 29 octobre 2026). Analyse statique, pas certification de
l'intégration Cortex ni nouveau benchmark. Les anciens plans et ADR conservent
leur portée historique ; leurs étapes projetées ne prouvent pas une livraison.

| Élément existant | Réutilisation et limite | Écart / évolution minimale |
|---|---|---|
| [Fondation Machine](../packages/void-machine/README.md), couches core/runtime/verticals/adapters | Séparation déjà présente, avec verticale `sourced-note` hors dev. La délégation est exposée par la CLI ; les missions de note restent privées. | Faire de cette séparation le point de départ ; aucune deuxième fondation. |
| [Réducteur de mission](../packages/void-machine/src/core/mission.ts) et [driver](../packages/void-machine/src/runtime/mission.ts) | États, transitions, journal, reprise et annulation indépendants de Git. Pipeline linéaire de huit étapes et trente-deux événements au plus, pas moteur arbitraire de branches, boucles ou attentes de clarification. | Réutiliser dans sa capacité réelle ; étendre une transition seulement si une mission réelle le nécessite. |
| [Note sourcée](../packages/void-machine/src/verticals/sourced-note/note.ts) | Admission de résultats et preuves de sources spécifiques à une spécialité. La présence exacte d'une citation ne garantit pas sa pertinence. | Premier candidat de parcours Cortex simple ; garder la validation sémantique distincte des contrôles de format. |
| [Mission Engine du harnais](../packages/mission-engine/src) et [autopilot](../packages/cli/src/lib/autopilot) | Pureté, preuves liées aux entrées, budgets et refus utiles ; planification et livraison fortement liées au ticket, diff, stack, Git et PR. | Les conserver dans le dev ; ne pas faire de leurs schémas le contrat général Cortex. |
| [Core de discipline](../packages/core/PHILOSOPHY.md), skills, profils et packs | Règles de code utiles ; « core » et « universel » signifiaient surtout TypeScript/web. Packs actuels = stacks dev, pas catalogue métier général. | Clarifier le périmètre maintenant ; déplacer une règle seulement quand une seconde spécialité en a réellement besoin. |
| [Spécialistes](../packages/core/specialists) | Contrats natifs et sélection réutilisables en principe ; catalogue et politiques actuels surtout ingénierie. Une définition de rôle ne prouve pas son invocation ni son isolation. | Charger la compétence utile, déléguer proportionnellement ; aucun panel dev universel. |
| [Journal et reprise](ARCHITECTURE.md#mission-event-journal-voidmachinerunsmission-ideventsjsonl) | Événements, résultats et preuves bornés utiles. Les journaux du harnais et de la note n'ont pas le même contrat. | Traduire les preuves au retour Cortex ; ne pas fusionner les journaux ni recopier la mémoire personnelle. |
| [CLI](../packages/cli/src/commands) et installation native | Harnais réellement utilisable directement, isolation et contrôles propres aux runtimes. | Préserver ce parcours ; un futur appel Cortex doit utiliser un point d'entrée explicite, pas une nouvelle boucle globale. |
| Mandat Cortex | Les entrées génériques peuvent transporter une configuration, mais les interfaces `MissionDescription` / `MissionRunner` inspectées ne valident pas un périmètre d’autorisation Cortex commun. | Définir et vérifier ce périmètre sur le premier raccord concret ; conserver les restrictions effectives des adaptateurs. |
| Contrat de retour ci-dessus | Plusieurs reçus et formats locaux existent. | Aucun contrat complet Cortex de statut + actions + preuves + connaissances n'est démontré par cet audit ; le prouver sur un parcours réel avant de l'annoncer. |

Contradictions documentaires corrigées dans cette mission : la vocation ne se
réduit plus à TypeScript/web ; la CLI d'installation n'est pas assimilée à tout
le système d'action ; l'état sous `.void/machine/` n'est plus présenté comme
sans valeur à supprimer. Les contrôles déterministes existants ne changent pas.

## Évolution progressive proposée

| Étape | Travail borné | Preuve de sortie |
|---|---|---|
| 0. Aligner les responsabilités | Cette doctrine, ADR, README, architecture et instructions des contributeurs. Aucun déplacement de code. | Documents cohérents, périmètres actuel/cible explicites, historique préservé. |
| 1. Un parcours Cortex réel | Mission de recherche documentaire / note sourcée sur sources autorisées, avec résultat attendu et budget ; réutiliser le parcours privé s'il suffit. D'abord sans effet externe d'écriture. | Cortex transmet le mandat, Machine renvoie résultat sourcé et limites ; Cortex décide de l'acceptation et de la mémoire. Comparer durée, coût et interventions à l'exécution directe. |
| 2. Éprouver un effet autorisé | Une seule action utile, par exemple créer un document, via l'outil existant. | Refus hors mandat, interruption/reprise, résultat ambigu réconcilié, aucune répétition aveugle ; retour `partiel`/`incertain` fidèle. |
| 3. Ajouter une seconde spécialité réelle | Ses entrées, outils et vérifications, sans reprendre la politique dev. | Même chemin de mission utile ; extraction commune uniquement d'une responsabilité réellement partagée. |
| 4. Consolider à l'usage | Ajuster uniquement les points qui ont causé échec, doublon, temps perdu ou intervention inutile. | Gain mesuré sans recul de qualité ou de sécurité ; arrêt dès les critères atteints. |

Les étapes 1 à 4 sont des propositions, pas une autorisation d'implémentation ou
d'accès à des services. Pas de framework de plugins, nouvelle base de mémoire,
planificateur global, DSL, séparation de services ou moteur parallèle anticipé.
La généralisation doit suivre les usages ; aucun nouveau package n'est requis
pour formaliser ces responsabilités.
