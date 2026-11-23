---
name: void-merge
description: Vider la file des PR ouvertes sans casser le dépôt. Fusions séquentielles, ordre stable et dépendances explicites, CI verte ET à jour, artefacts générés régénérés, conflits de contenu rendus à leur auteur. Use when merging pull requests.
---

# merge — voidcorp craftsman edition

`void-implement` s'arrête à la PR ouverte. `void-autopilot` laisse à une personne les PR qu'il ne peut
pas fusionner dans son mandat. Personne ne dit comment vider la file. Ce geste a l'air trivial jusqu'au moment où il ne l'est pas.

**Attribution**: see `.source`.

---

## Ce que ce n'est pas

Ce n'est pas une revue. Une PR entrant dans la file est supposée revue par un humain : cette skill
décide de **mécanique**, jamais de qualité. Elle ne lit pas le diff pour juger le code.

Elle ne force rien : pas de `--admin`, pas de force-push, pas de merge d'une PR rouge.

---

## Étape 1 — Lire la file, et savoir ce qui n'y entre pas

Lister toutes les PR ouvertes vers la base visée, avec pour chacune : état de mergeabilité,
conclusion de chaque check, base, brouillon ou non, auteur.

Sortent de la file, sans discussion :

- **La PR qui existe pour rester ouverte.** Une promotion permanente vers la branche de release
  est verte et mergeable en continu ; la merger est la décision de contenu du cycle, et elle
  appartient à un humain. La nommer dans le rapport, ne jamais la merger.
- **Les brouillons.**
- **Ce que l'utilisateur n'a pas visé** quand il a nommé un périmètre.

Une file vide est un résultat, pas un échec : le dire et s'arrêter.

## Étape 2 — Garder un ordre stable, identifier les dépendances

Une seule fusion à la fois suffit, sans service de file ni abonnement particulier.
Une file native déjà configurée reste compatible ; ses protections restent applicables.

1. **Conserver le tour engagé.** Dans `void-autopilot`, le noyau choisit : une PR dont la
   fusion est déjà armée garde son tour ; sinon, la plus ancienne PR ouverte non brouillon
   parmi les tickets suivis passe d'abord. Utiliser ses actions, pas un script de fusion parallèle.
2. **Hors autopilot, garder l'ordre des PR admissibles.** À défaut d'ordre explicite, partir
   de la plus ancienne. Une PR dont la revue est acquise et dont seule la CI attendue tourne
   conserve son tour ; une PR plus récente ne la dépasse pas simplement parce qu'elle est verte.
3. **Un déblocage réel se traite explicitement.** Nommer la dépendance, le conflit ou le
   blocage durable et son propriétaire. Hors autopilot, une PR préalable peut passer d'abord
   avec cette raison. Sous autopilot, rendre ce blocage au coordinateur : ne pas contourner
   le tour choisi par le noyau. Une PR rouge ou en conflit ne justifie pas une attente indéfinie.

Remettre à jour seulement la PR dont le tour arrive, puis attendre ses preuves avant de
fusionner. Ne pas remettre toutes les branches à jour après chaque fusion : la suivante
ferait immédiatement vieillir ce travail. Le temps déjà dépensé ne rend jamais valide
une preuve liée à un ancien commit ou à une ancienne base.

## Étape 3 — Trois conditions pour merger, toutes nécessaires

| Condition | Ce qu'elle écarte |
|---|---|
| Tous les checks **verts** | Un merge qui casse la base |
| La branche **à jour** avec sa base | Des checks qui ont tourné sur une base disparue |
| Le merge **propre** | Une résolution faite dans le noir |

`BEHIND` n'est pas un feu vert. C'est le piège le plus courant : la CI est verte et la PR est
mergeable, mais les checks portent sur un état qui n'existe plus. Remettre la branche à jour,
**réattendre la CI**, puis merger.

Ne jamais contourner un refus de la protection de branche : c'est le garde-fou, au bon endroit,
et le seul qui connaisse l'état réel côté serveur.

## Étape 4 — Résoudre le mécanique, rendre le contenu

Deux natures de conflit, une seule automatisable.

**Mécanique — un artefact généré.** Bundles, catalogues, index dérivés. On **régénère depuis les
sources fusionnées**, jamais on ne choisit un côté. Un artefact choisi passe la CI et ment
ensuite : il ne correspond plus à ses sources.

**De contenu — deux intentions se croisent.** La boucle s'arrête sur cette PR et le dit. C'est un
travail d'auteur.

**Cas mixte** : un fichier généré qui porte aussi une décision, comme une version dans un
manifeste. C'est du **contenu**. Le sens de la valeur décide, pas l'emplacement du fichier. Une
version en particulier n'est jamais choisie à la main quand un outil de release la possède : la
question devient « quelle branche fait autorité sur cette valeur », et elle se pose à l'humain.

## Étape 5 — Boucler, puis rendre compte

Merger une PR rend les suivantes `BEHIND` : la file bouge à chaque tour. Reprendre à l'étape 1
tant qu'une PR **devient** mergeable.

S'arrêter quand plus rien ne progresse, et rendre alors, pour chaque PR restante, la raison exacte
du blocage — jamais « n'a pas pu être mergée ».

Après le dernier merge, vérifier que la base est saine : la suite, les gates du dépôt, et l'état
de la branche locale.

---

## Anti-rules

- MUST NOT merger une PR dont un check n'est pas vert.
- MUST NOT merger une PR `BEHIND` sans l'avoir remise à jour et avoir réattendu la CI.
- MUST NOT merger la promotion vers la branche de release.
- MUST NOT résoudre un conflit de contenu, ni choisir un côté d'un artefact généré.
- MUST NOT utiliser `--admin`, ni force-pusher une branche protégée.
- MUST NOT juger la qualité du code : la revue est un geste humain, déjà fait.

## Composition

- **Amont — `void-implement`** ouvre les PR que cette skill draine ; **`void-autopilot`** lui laisse celles qu'il
  rend à une personne (chemin protégé, verdict non prouvé, branche qui déploie).
- **Avec `void-verify`** : après le dernier merge, la base se prouve, elle ne se suppose pas.
- **Avec `void-commit-discipline`** : un commit de merge dit pourquoi il a lieu, comme les autres.
