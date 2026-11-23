# Point de reprise : évolution de Void Machine

Base de travail consignée à la demande de Folpe le 10 novembre 2026.

## Documents à reprendre

1. [Vocation de Machine](../MACHINE-VOCATION.md) : frontière existante avec Cortex.
2. [Catalogue des 50 capacités IA](2026-11-10-agent-harness-capabilities.md) : sélection sourcée, priorités proposées et méthodes de mesure.
3. [Fiabilité des missions](2026-11-10-mission-reliability.md) : preuves, confiance, reprise et limites détaillées.

Ces recherches sont retenues comme base de discussion. Elles n'autorisent pas l'implémentation automatique de toutes les capacités ni l'adoption d'un framework.

## Intention de la prochaine passe

Reprendre Machine partie par partie avec Folpe pour construire un système plus simple, fiable et rapide. Machine reçoit une intention de Cortex ou d'un demandeur autorisé, rassemble le contexte utile et exécute les actions dans son environnement. Le développement est une spécialité parmi d'autres.

L'exploration d'une nouvelle organisation dans un dossier séparé a été demandée ; son emplacement et son périmètre restent à convenir. Préserver le harnais opérationnel et réutiliser les mécanismes qui ont démontré leur valeur. Cortex conserve sa responsabilité sur la mémoire personnelle durable, l'autorité et l'acceptation finale.

## Première discussion à reprendre

Choisir une mission représentative de bout en bout, son résultat observable et son périmètre d'action. Examiner ensuite chaque mécanisme nécessaire : le conserver, le simplifier ou le retirer, avec une preuve de son utilité.

Les cinq sujets proposés en premier sont les critères de réussite, le contexte sélectif, les outils contrôlés, la reprise sans doublon et les évaluations représentatives. L'ordre définitif sera choisi avec Folpe sur ce parcours concret.

## Chantier antérieur à ne pas relancer implicitement

La [PR #473, mise à jour unifiée du CLI](https://github.com/voidcorp-core/void-machine/pull/473), a été fermée sans fusion le 30 octobre 2026. Ses sources restent dans `feat/stable-cli-update`, commit `cdb29d562fff8c2c0ed730bdf81fd68576e8b514`. La qualification Windows n'est pas acquise. Réexaminer le besoin minimal de mise à jour après le contrat Cortex–Machine ; cette conservation ne valide pas son architecture ni sa reprise.
