---
title: Void Command Center - une projection locale du Project Knowledge System, jamais une seconde source
date: 2026-08-17
status: proposed
author: Folpe + Claude
related:
  - docs/specs/2026-08-17-project-knowledge-system.md
  - docs/specs/2026-07-21-void-harness-public-multiruntime-os.md
  - docs/ARCHITECTURE.md
---

# Void Command Center

## Résumé

Une surface unique pour observer plusieurs projets assistés par le harness, comprendre où
chacun en est, et reprendre le travail sans reconstruction mentale.

Elle ne stocke rien. Elle projette `.void/` à travers les primitives du harness. Toute la
conception tient dans une seule contrainte : **l'interface n'affiche jamais une valeur qu'elle
a calculée elle-même**. Elle affiche un artefact et sa fraîcheur.

Trois livrables séquentiels, dont le premier n'a pas d'interface du tout.

## Problème

Avec cinq projets, ouvrir un dépôt et retrouver le fil coûte de dix à vingt minutes : lire le
dernier commit, deviner ce qui était en cours, rouvrir les décisions, reconstituer le working
set. Ce coût est payé à chaque reprise, par projet, et il croît avec le nombre de projets et
avec le temps écoulé depuis la dernière session.

Ce n'est pas un problème d'affichage. C'est que **l'état de reprise n'est écrit nulle part**.
Le Project Knowledge System le règle en le matérialisant. Cette spec le rend consultable.

### Ce qui existe

| Capacité | Où |
|---|---|
| Extraction incrémentale, sept requêtes bornées | `packages/harness-graph/src/project/` |
| Surface CLI de requête | `void-harness graph explain\|path\|impact\|subgraph\|owners\|tests-for\|staleness` |
| UI locale servie hors-ligne, données pré-générées | `apps/graph-studio/` |
| Config projet, layout `.void/` typé par propriété | `.void/config.json`, `VOID_OWNERSHIP` |
| Routage de fin de session par couche d'autorité | `packages/core/skills/session-handoff/` |

### Ce qui manque, et bloque

`.void/knowledge.json`, `.void/knowledge/intent.yaml`, `.void/machine/checkpoint.md` et
`void-harness context` n'existent pas. Ils sont le contenu de cette interface.

**Conséquence structurante : l'interface ne peut pas précéder le PKS.** Construite avant, elle
devrait inventer ses données, c'est-à-dire devenir la seconde source de vérité que la
direction refuse explicitement. Le Command Center est une conséquence du PKS, pas un projet
parallèle.

## Le principe qui décide de tout

```
projets (.void/)
      ↓
   void-core        registry, lecture, requête, santé, contexte
      ↓
  +---+---+
  |       |
 CLI   serveur local (transport nu)
          ↓
         UI
```

La règle qui empêche la troisième implémentation : **le serveur n'a aucune logique métier**. Il
expose des fonctions du Core en JSON. Un test compare, pour la même question, la sortie de la
CLI et celle du serveur ; toute divergence est un bug de transport.

### Pourquoi pas de daemon

Un processus résident ajoute un port, un cycle de vie, une supervision, un cache, et une
question à chaque anomalie : « le daemon est-il à jour ? ». `void-harness ui` démarre, sert,
s'arrête. `apps/graph-studio` prouve déjà que ce mode fonctionne hors-ligne.

### Pourquoi pas de backend déployé

La connaissance vit dans le système de fichiers des projets. Une application déployée devrait
soit rapatrier les `.void/` (une copie, donc une seconde source), soit ouvrir un accès à la
machine (complexité et surface de sécurité pour zéro gain sur un usage mono-utilisateur).

Le jour où quelqu'un d'autre doit voir cet état, la réponse est un **snapshot signé en lecture
seule publié depuis la machine**, jamais un déplacement de la source. Cette porte reste
ouverte sans rien coûter aujourd'hui.

## Découverte des projets

Un registre de projets est un état global mutable qui pourrit : chemins déplacés, dépôts
supprimés, entrées oubliées. Le harness a déjà un marqueur fiable de « ce dossier est un projet
Void » : `.void/config.json`.

```json
{ "roots": ["~/Developer"], "exclude": ["**/node_modules/**"] }
```

Est un projet tout dossier sous une racine déclarée qui porte `.void/config.json`. Aucun
enregistrement à tenir, aucune entrée morte, un nouveau projet apparaît sans action. Un chemin
devenu illisible s'affiche `introuvable`, il ne fait jamais échouer la vue.

`void-harness project add <chemin>` reste possible pour un dépôt hors racine, comme exception
et non comme voie normale.

## Vue Projects

La contrainte décide du contenu : **tout signal doit être lisible sans exécuter le projet**, en
lecture de fichiers et de plomberie Git, sous 50 ms par projet.

| Signal | Source |
|---|---|
| Nom, chemin | `.void/config.json` |
| Dernière activité | mtime du checkpoint, date du dernier commit |
| Branche, arbre propre ou sale | `git` |
| Fraîcheur de la connaissance | `rootHash` de `knowledge.json` contre l'arbre |
| Warnings, blockers | rapport de santé du PKS |
| Ligne de reprise | première ligne de `session/current.md` |

Sept signaux. La vue répond à une seule question : **où dois-je porter mon attention ?**

**Explicitement exclu du MVP : le statut tests et build.** Il n'existe pas localement sans
lancer la suite ; le lire depuis le CI impose le réseau, casse le hors-ligne et affiche un état
qui n'est plus celui de l'arbre. S'il revient un jour, ce sera daté et nommé comme tel.

## Project cockpit

Lecture de `session/current.md`, plus le sous-graphe qu'il pointe. La propriété héritée du PKS
est ce qui le rend rapide : **le checkpoint est un pointeur, pas un contenu**.

Il porte : objectif courant, état réel, boucles ouvertes, problèmes connus, prochaine action,
working set, décisions et invariants liés.

La santé n'affiche **aucune note globale**. Un pourcentage invite à optimiser le chiffre ; la
valeur est dans le problème actionnable et sa résolution.

## Resume

Le cœur de la valeur, et le seul écran qui justifie à lui seul le projet.

```
intent.yaml + session/current.md + sous-graphe pointé + ADR et invariants liés
```

Strictement ce que `void-harness context --resume` produit. L'interface ne compose pas ce
contexte : elle appelle la primitive et affiche le résultat, avec un bouton qui le copie.

**`void-harness resume` en CLI est livré avant toute interface.** Si reprendre un projet depuis
le terminal ne fait pas gagner de temps, l'interface n'en fera pas gagner non plus, et le
saura pour un coût très inférieur. C'est le test de valeur le moins cher disponible.

## Recherche transversale

Aucun index. Les `knowledge.json` sont des documents uniques et bornés : les lire tous et
filtrer suffit. Un index serait un état à invalider, donc une source de mensonge de plus.

Si la latence devient un problème, elle sera mesurée et arbitrée à ce moment, avec un chiffre.

## Hors périmètre

**La timeline d'activité.** Elle exige un journal d'événements, c'est-à-dire une seconde
histoire à côté de Git et du tracker. La spec PKS l'a déjà refusée pour le checkpoint : « une
seconde timeline exhaustive serait une source de divergence de plus ». L'interface ne la
réintroduit pas par la fenêtre.

**La gestion de tâches.** Le tracker garde le backlog. L'interface montre le travail actif tel
que le checkpoint le décrit, jamais une liste à tenir à jour.

**Le graphe visuel.** Un graphe n'est utile que s'il change une décision. La navigation
conceptuelle par domaine le remplace, et les domaines déclarés sont eux-mêmes hors périmètre du
PKS pour l'instant.

**La connaissance partagée entre projets.** Excellente intra-projet d'abord.

**Le lancement de session d'agent depuis l'interface.** C'est de l'orchestration ; copier le
contexte suffit et n'engage rien.

## Risques

**L'interface force le Core à mentir.** Une home multi-projets veut afficher vingt projets en
moins d'une seconde. Le jour où un `knowledge.json` est périmé, la tentation est de le
régénérer en douce ou d'en cacher un résumé. La parade est le principe d'ouverture : afficher
l'artefact et sa fraîcheur, jamais une valeur recalculée. Un projet périmé s'affiche périmé.

**Le serveur devient une troisième implémentation.** Parade : transport nu, et un test de
parité CLI/serveur.

**Le registre pourrit.** Parade : pas de registre, une découverte par marqueur.

**La valeur multi-projet est surestimée.** Elle est faible tant que le mono-projet n'est pas
excellent. Parade : la séquence ci-dessous commence par un projet et sans interface.

## Séquence

1. **PKS** (`knowledge.json`, décisions et invariants, checkpoint de session). Déjà spécifié
   et découpé. Rien de cette spec n'est exécutable avant.
2. **`void-harness resume`** en CLI. Preuve de valeur, coût faible, aucune interface.
3. **Vue Projects et cockpit**, servis par `void-harness ui`, sur le même Core, en réutilisant
   le socle de `apps/graph-studio`.

Chaque étape est utile seule et se juge sur l'usage réel avant d'ouvrir la suivante.

## Tests

- Découverte : un dossier avec `.void/config.json` sous une racine est trouvé ; un chemin
  illisible est signalé sans faire échouer la vue.
- Parité : pour chaque primitive, CLI et serveur retournent le même objet.
- Fraîcheur : un `knowledge.json` périmé s'affiche périmé et n'est jamais régénéré par une
  lecture.
- Resume : le contexte produit est exactement celui de la primitive, sans recomposition.
