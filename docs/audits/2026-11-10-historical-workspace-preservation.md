# Conservation de la worktree historique

Le 10 novembre 2026, Folpe demande de sauvegarder le travail restant avant de reprendre la conception de Machine. Cette branche conserve son historique et les fichiers déjà présents ; elle n'est pas une candidate à fusionner telle quelle.

Les différences de configuration Claude, de bundle de hooks, de manifeste d'installation et de programme proviennent d'un état local ancien indiquant une installation 6.0.0. Leur sauvegarde ne réalise aucune installation, n'accorde aucune nouvelle permission et ne réinitialise aucun garde-fou. Cet ensemble n'a pas été requalifié comme installation cohérente et ne doit pas remplacer le harnais courant.

La note de vision du 23 octobre et l'audit de cohérence du 30 octobre sont conservés dans leur version locale originale. L'audit est déjà présent à l'identique sur main ; la vision y figure avec un avertissement d'archive ajouté. Les commits historiques de documentation Orchestra et Herdr restent accessibles ici.

Une archive privée vérifiée préserve également les fichiers avant cette sauvegarde Git. Les données de session et preuves ignorées ne sont pas publiées. La source de travail actuelle reste la branche d'intégration du dépôt ; les nouveaux documents de recherche sont sur `docs/mission-reliability-catalogue`.
