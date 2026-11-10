# Vision Cortex et Machine : un socle d’action commun, des spécialités dont le développement

Date : 23 octobre 2026.

Statut : note d’orientation issue de l’échange avec le porteur du projet. Elle
consigne l’objectif produit et une proposition de découpage ; elle ne constitue
ni une spécification d’implémentation approuvée, ni une preuve de capacités déjà
disponibles. Les choix techniques restent à valider lors du travail concerné.

## Objectif exprimé

Void Machine a vocation à vivre aux côtés de Void Cortex dans l’instance
déployée pour chaque client. Cortex porte la compréhension de la demande et son
contexte ; Machine est la capacité d’action, les « bras ».

Machine doit pouvoir créer des fichiers, produire et relire des documents,
mobiliser des modèles spécialisés et agir dans les services connectés, notamment
Google et les agendas. Le développement logiciel sera une spécialité parmi
d’autres, même s’il concentre aujourd’hui le travail sur le harnais et apporte
déjà une aide quotidienne à son auteur.

L’objectif reste de gagner du temps avec un résultat de grande qualité. La loi
de Pareto, KISS et l’économie de moyens guident cette évolution : chaque règle,
contrôle ou composant doit justifier son coût par une aide concrète. Éviter les
boucles d’amélioration qui ne changent pas le résultat attendu.

## Répartition proposée des responsabilités

| Élément | Responsabilité cible | Limite |
|---|---|---|
| Void Cortex | Comprendre l’intention, retrouver le contexte, identifier le projet et le résultat attendu, transmettre la mission et restituer son résultat | Ne pas embarquer les procédures détaillées de chaque métier |
| Socle d’action Void Machine | Exécuter une mission, appliquer les autorisations, isoler les accès, suivre les actions et restituer résultats et erreurs | Ne pas imposer les règles du développement à toutes les missions |
| Spécialité développement | Explorer le projet, consulter les spécialistes pertinents, appliquer le TDD, coder, vérifier et faire relire | Ne pas gouverner une tâche bureautique ou d’agenda sans rapport avec le code |
| Autres spécialités | Produire et relire des documents, manipuler des fichiers ou agir dans les services connectés | Porter leurs propres critères de qualité et contrôles adaptés |

La proposition est de séparer les responsabilités avant de séparer les dépôts,
les produits ou les services. Leur séparation physique devra répondre à un
besoin observé, par exemple une contrainte d’isolation ou de déploiement.

## Place du harnais de développement existant

L’investissement actuel reste utile : le développement peut être le premier
domaine éprouvé de Machine. Le risque serait de confondre ce domaine avec
l’ensemble du socle d’action.

L’[architecture actuelle](ARCHITECTURE.md) décrit un harnais avec `core` et des
packs. La [philosophie actuelle](PHILOSOPHY.md) précise que ce core suppose
TypeScript et le web : les packs existants spécialisent des stacks de
développement. Ce découpage ne prouve donc pas qu’un socle métier généraliste
est déjà disponible.

Dans la cible, TDD, conventions TypeScript, architecture du code et discipline
de commit relèvent de la spécialité développement. Autorisations, isolation
entre clients et traçabilité concernent toutes les spécialités. Le classement
et le déplacement éventuel des éléments existants demandent un examen ciblé,
sans grande réécriture anticipée.

## Une même capacité de développement depuis plusieurs points d’entrée

Un client doit pouvoir demander du code via Cortex. L’auteur doit également
pouvoir conserver son usage direct dans ses outils de développement.

Ces entrées devraient réutiliser une seule source de règles et de compétences
de développement, avec les conventions et autorisations du projet concerné.
Cela n’impose ni un agent unique, ni le même modèle pour toutes les tâches.

Les mécanismes concrets peuvent varier selon le runtime. Installer les mêmes
skills et hooks ne prouve pas qu’ils sont exécutés partout : les capacités et
garanties réellement disponibles doivent être vérifiées. Un contrôle absent
ou une activation non observable doit être signalé comme tel.

Les spécialistes sont consultés selon le domaine touché. Leurs avis restent
réutilisables tant que leur périmètre et leurs hypothèses ne changent pas.
TDD, qualité du code et sécurité restent essentiels ; ils ne justifient pas
des panels systématiques ni des cycles de revue sans défaut concret à résoudre.

## Parcours cible : demander à Cortex de développer sur le bon projet

Exemple : « Cortex, ajoute l’export PDF dans le projet X. »

1. Cortex retrouve le projet, le contexte utile et le résultat attendu.
2. Machine reçoit une mission délimitée et les actions autorisées.
3. Machine prépare un espace de travail isolé et charge les règles du projet.
4. La spécialité développement consulte les experts utiles, teste, implémente
   et fait relire le changement, avec une revue indépendante lorsque pertinente.
5. Le résultat revient à l’utilisateur avec les preuves disponibles et les
   éventuelles étapes qui nécessitent encore une décision.

Une transmission simple contient l’objectif, le projet cible, le contexte
utile, les autorisations et le résultat attendu. Son format technique reste à
définir à partir des contrats existants, sans ajouter un second orchestrateur.

Préparer un changement, ouvrir une PR, fusionner et déployer sont des actions
distinctes. Une demande de développement ne vaut pas automatiquement
autorisation de mise en production. Les autorisations peuvent être définies à
l’avance et réutilisées dans leur périmètre pour éviter les confirmations
répétitives. Une ambiguïté sur le projet ou les droits se résout avant l’action.

## Priorités proposées selon Pareto

1. Délimiter le socle commun et la spécialité développement, en conservant ce
   qui fonctionne et sans multiplier les services.
2. Définir la transmission minimale entre Cortex et Machine en réutilisant
   les contrats de mission existants lorsque leur périmètre convient.
3. Garder une seule source de règles de développement pour l’usage direct et
   l’usage depuis Cortex, afin d’éviter deux versions qui divergent.

Le suivi doit rester simple : quelles compétences et quels contrôles ont été
utilisés, avec quel résultat et quelles limites d’observation. Les nombres de
hits aident à comprendre l’exécution ; ils ne prouvent pas, seuls, la qualité
ou le temps gagné.

Le critère de réussite est un résultat correct obtenu plus vite, avec moins
d’interventions et de reprises. Ce document ne lance aucune migration et ne
change ni la doctrine active ni les autorisations d’exécution.
