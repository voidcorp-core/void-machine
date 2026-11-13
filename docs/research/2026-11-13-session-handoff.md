# Remise du 13 novembre 2026

Remise demandée par Folpe pour changer d’ordinateur. Ce document conserve le
contexte de discussion ; GitHub reste la source des statuts des PR et de la CI.
Il ne constitue ni un nouveau programme ni une autorisation d’implémentation.

## Livraison vérifiée

La [release 7.0.2](https://github.com/voidcorp-core/void-machine/releases/tag/v7.0.2)
est publiée. Le [workflow de publication](https://github.com/voidcorp-core/void-machine/actions/runs/43415874507)
a réussi, y compris la vérification du paquet npm et de sa provenance.
La [promotion #547](https://github.com/voidcorp-core/void-machine/pull/547),
la [release #555](https://github.com/voidcorp-core/void-machine/pull/555) et le
[retour vers develop #557](https://github.com/voidcorp-core/void-machine/pull/557)
sont fusionnés après leurs contrôles.

Sujet vérifié : `main` à `b2f8757c81c47b93d0a8a95952cca975b038d534` et
`develop` à `d5fbda246e9ce0664f0294621d3cd4e11438f767`, arbres identiques.
La CI de main [43415874576](https://github.com/voidcorp-core/void-machine/actions/runs/43415874576)
et celle du groupe de fusion [43417900691](https://github.com/voidcorp-core/void-machine/actions/runs/43417900691)
ont réussi. Aucun projet consommateur ni CLI global n’a été mis à jour ici.

Les limites des corrections restent importantes : les configurations explicites
existantes sont préservées, les diagnostics de configuration ne réparent pas
silencieusement les projets, et le contrôle de lecture des secrets a une portée
bornée. La proposition générale de CI « affected » ne doit pas être présentée
comme un moteur entièrement livré.

## Discussion à reprendre

Lire le [point d’entrée de la recherche](README.md), qui référence la vocation,
le catalogue des capacités IA et les principes de fiabilité. Cette recherche
sert à choisir avec Folpe un parcours intention → résultat observable, puis à
simplifier chaque mécanisme utile. Elle ne commande pas d’implémenter les
50 capacités ni d’adopter un framework. Le périmètre et l’emplacement d’un
éventuel dossier séparé restent à décider.

La PR #473 et `feat/stable-cli-update` restent conservées, sans validation de
leur architecture ni reprise implicite ; voir les limites dans le README.
Ne rejouer aucun ancien script de récupération de mission et ne réinitialiser
aucune preuve, identité, baseline ou consommation de revue. Le changement
d’ordinateur ne demande aucune mutation des projets consommateurs.

## Sauvegarde et limites

Les worktrees étaient propres avant cette remise. Deux anciens commits encore
uniquement locaux ont été conservés sur des branches distantes d’archive :

- `archive/20261113/postmerge-dev-733-0911` :
  `e74e9277a7c1d093eacb328e8d8f6a744d244ad1`.
- `archive/20261113/postmerge-dev-815-0911` :
  `dcf63ae4d3934e740aa94fe7a60d8c43990db145`.

Ce sont des sauvegardes historiques, pas des changements à fusionner.
Les journaux privés, stashes sauvegardés et preuves ignorées par Git restent
sur le poste d’origine. Ils n’ont pas été publiés dans ce dépôt public ; cette
remise ne prétend pas être une sauvegarde intégrale du disque.

## Première action sur l’autre ordinateur

Lire `docs/research/README.md` depuis cette branche de remise :

```sh
git fetch origin docs/handoff-20261113
git show FETCH_HEAD:docs/research/README.md
```

Puis reprendre la discussion de simplification avec Folpe, sans sélectionner
implicitement un ticket de l’ancien programme de stabilisation.
