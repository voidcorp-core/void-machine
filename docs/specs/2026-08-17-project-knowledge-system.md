---
title: Project Knowledge System - un artefact de connaissance compilé, pas une arborescence de Markdown
date: 2026-08-17
status: proposed
author: Folpe + Claude
related:
  - docs/specs/2026-07-24-void-harness-v3-top-tier-engineering-team.md
  - docs/ARCHITECTURE.md
---

# Project Knowledge System

## Résumé

Le harness sait déjà extraire la topologie d'un projet, la maintenir en incrémental, et
répondre à sept questions dessus. Il ne sait rien de l'**intention** : aucune décision, aucun
invariant, aucun domaine n'existe dans le graphe. Un agent peut demander qui dépend de quoi,
jamais pourquoi la chose est ainsi.

Cette spec ajoute cette couche, matérialise le graphe en un artefact unique sous `.void/`, et
le maintient à jour par un hook. Elle n'ajoute pas de moteur documentaire, pas d'inférence de
domaines, pas de second graphe.

Trois livrables, dont deux mécaniques.

## Problème

### Ce qui existe

| Capacité | Où |
|---|---|
| Extraction incrémentale (hash par fichier, journal, tombstones, lignée de rename) | `packages/harness-graph/src/project/build.ts` |
| Provenance typée sur chaque nœud et arête | `origin`, `confidence`, `sources[{kind, ref, hashOrVersion}]` |
| Sept requêtes bornées, lecture seule | `packages/harness-graph/src/project/query.ts` |
| Surface CLI | `void-harness graph explain\|path\|impact\|subgraph\|owners\|tests-for\|staleness` |
| Staleness et fallback source | `stalenessOf`, rendu par la surface CLI |
| ADR : un fichier immuable par décision, superseding, gate CI | `docs/decisions-log/`, `pnpm decisions:check` |
| Routage de fin de session par couche d'autorité | `packages/core/skills/session-handoff/SKILL.md` |

### Ce qui manque

Le graphe projet connaît sept types de nœuds — `root`, `workspace`, `file`, `symbol`,
`module`, `owner`, `test` — et neuf relations : `contains`, `declares`, `exports`, `imports`,
`dynamic-imports`, `depends-on`, `owned-by`, `tests`, `previous-id`.

Aucun nœud ne porte une décision, un invariant ou un domaine. Les ADR existent comme fichiers
sans exister comme entités. Conséquences directes :

1. `why` est impossible : rien ne relie un fichier à la décision qui l'a fait naître.
2. Un invariant qui ne peut pas être déduit du code (« un tenant n'accède jamais aux données
   d'un autre ») n'a aucune représentation.
3. Le graphe n'est jamais matérialisé : il est reconstruit en mémoire à chaque appel, ce qui
   coûte environ 3,5 s par invocation CLI sur ce dépôt.
4. Rien ne détecte qu'une décision référence un composant qui n'existe plus.

## Modèle d'autorité

Trois couches, déjà présentes dans la doctrine, ici rendues explicites dans le graphe.

**Humain autoritaire.** Vision, principes, boundaries, contraintes, ADR, invariants. Jamais
réécrit à partir du code. Un agent propose, un humain décide. Provenance `origin: declared`,
`confidence: 1`.

**Machine observée.** Ce que l'extraction lit dans l'arbre : fichiers, symboles, imports,
tests, ownership Git. Recalculable intégralement. Provenance `origin: extracted`.

**Machine dérivée.** Projections produites à partir des deux précédentes : working sets,
snapshots, rapports de santé. Jetables, régénérables, jamais promues en source.

La règle qui gouverne tout : **un artefact dérivé ne devient jamais une source**. Si sa sortie
est fausse, on corrige l'extracteur, la source ou le générateur, jamais l'artefact.

## Architecture

### Emplacements

```
docs/decisions-log/          inchangé - les ADR restent lisibles sur GitHub
.void/
├── knowledge.json           GÉNÉRÉ - le graphe unifié
├── knowledge/
│   ├── intent.yaml          HUMAIN - vision, principes, boundaries, contraintes
│   └── invariants/          HUMAIN - un fichier par invariant
├── session/current.md       le checkpoint de session
└── local/                   inchangé - cache, runs, generated, outputs
```

Quatre entrées nouvelles, aucun déplacement.

**Pourquoi les ADR ne bougent pas.** Ce sont des documents que des humains lisent sur une
forge. Sous un dossier caché, ils cessent d'être lus. Le regroupement se fait dans l'artefact,
pas dans le système de fichiers : `knowledge.json` les contient comme entités, donc ils sont
requêtables sans quitter l'endroit où ils sont lisibles.

**Pourquoi un fichier et pas quatre dossiers.** Séparer `entities/`, `relations/`, `graph/` et
`indexes/` reconstruit un stockage de base de données à la main, avec autant d'occasions de
désynchronisation. Le graphe v3 est déjà un document unique, scellé par un `rootHash`, dont la
validation rejette les identifiants dupliqués, les relations pendantes et les dérives de hash.

### `knowledge.json` n'est pas un cache

Distinction structurante, parce qu'elle décide de ce qui est permis.

Le **cache** (`ProjectCachePort`) est une preuve d'observation : le croire, c'est croire que
l'arbre n'a pas changé. Le port dépôt refuse délibérément de lire et d'écrire
(`PROJECT_CACHE_READ_ONLY`), parce qu'un auteur de dépôt peut resceller un self-hash et que
Node portable ne ferme pas les courses parent-swap.

`knowledge.json` est un **artefact généré** : une projection qu'on régénère et qu'on vérifie,
jamais une preuve qu'on croit sur parole. C'est exactement le statut de `model.json` et
`catalog.v3.json`, qui ont déjà ce mécanisme et son gate de fraîcheur en CI.

Conséquence pratique : la décision de sécurité sur le cache n'est pas rouverte par cette spec.

## Le compilateur de connaissance

```
sources (code, ADR, invariants, intent)
      ↓
extracteurs
      ↓
entités + relations normalisées
      ↓
knowledge.json
      ↓
requêtes et projections
```

L'extraction de code existe. Cette spec ajoute deux extracteurs, tous deux **déclaratifs** :
ils lisent des fichiers structurés écrits par un humain, ils n'infèrent rien.

**Extracteur ADR.** Lit `docs/decisions-log/*.md`. Le frontmatter existant fournit `id`,
`title`, `status`, `supersedes`. Un champ optionnel `affects: [chemins]` déclare le lien vers
le code. Sans ce champ, la décision existe comme nœud isolé, ce qui est honnête et déjà utile.

**Extracteur invariants.** Lit `.void/knowledge/invariants/*.yaml`.

```yaml
id: INV-TENANT-002
scope: tenancy
severity: critical
statement: Les données d'un tenant ne doivent jamais être accessibles par un autre tenant.
enforced_by: [src/db/tenant-scope.ts]
verified_by: [tests/tenancy/isolation.spec.ts]
decided_by: [adr:077c5419-...]
```

### Vocabulaire ajouté

Trois nœuds, trois relations. Volontairement petit ; il s'étend sur cas réel, jamais par
anticipation.

```
nœuds     : decision, invariant, domain (différé)
relations : decided_by, constrained_by, verified_by
```

`domain` n'est pas construit dans cette tranche. Un domaine inféré est exactement le type
d'artefact que la règle de provenance interdit de promouvoir silencieusement ; un domaine
déclaré attendra qu'un usage réel le demande.

## Provenance

Le contrat existant s'applique sans changement aux nouveaux nœuds :

```ts
{ origin: 'declared' | 'extracted', confidence: number, sources: [{ kind, ref, hashOrVersion }] }
```

Une entité déclarée porte `origin: declared` et le chemin du fichier qui la déclare, avec son
hash. Aucune entité de cette spec n'est inférée, donc aucune ne peut être promue à tort.

## Maintien à jour

Le graphe se régénère à trois moments, et à aucun autre :

1. **Sur demande**, quand une commande le lit et le trouve périmé.
2. **Au commit**, par un hook installé explicitement, qui régénère l'artefact en incrémental.
3. **En CI**, par un gate de fraîcheur qui échoue si l'artefact committé diffère de celui que
   les sources produisent.

Le hook est le mécanisme emprunté à Graphify (`hook install`). L'incrémentalité existe déjà :
seuls les fichiers dont le hash a bougé sont ré-extraits.

Rien n'est régénéré à la fermeture de session : payer une régénération à chaque `/clear` pour
un artefact recalculé au commit suivant serait un coût sans contrepartie.

## Les trois artefacts de continuité

Recouvrement nul, et c'est la propriété qui empêche la dérive.

| Artefact | Répond à | Durée de vie | Lu par | Autorité |
|---|---|---|---|---|
| `.void/program.md` | quel programme exécuter, quel fournisseur de progression, quels gates | le programme | du code, avec validation de frontmatter | humain |
| `.void/machine/checkpoint.md` | où en était la session interrompue | une session | un humain ou un agent qui reprend | dérivé de la session |
| `.void/knowledge.json` | ce que le projet est et pourquoi | le projet | les requêtes | mixte, par couche |

`.void/program.md` est parsé par `readProgramDescriptor`, exigé par le preflight de l'autopilot,
injecté dans les instructions des consommateurs, et son bloc `autopilot` porte le consentement à
l'exécution autonome. Ce n'est pas un handoff de session, c'est la configuration globale du
programme ; le fournisseur de progression facultatif reste propriétaire de l'état mutable.

## Fin de session

`session-handoff` porte déjà la table de routage qui envoie chaque fait à sa couche : le
tracker pour l'exécution, le diff pour le code, l'ADR pour les décisions, la mémoire pour le
durable. Sa doctrine énonce déjà qu'un handoff long a échoué son triage.

Deux ajustements :

1. `.void/machine/checkpoint.md` devient la destination du résidu quand le projet n'a pas de
   convention propre. Aujourd'hui le skill préfère tracker et mémoire, sans fichier de dépôt.
2. Une ligne de routage pour l'invariant, couche qui n'existait pas.

Le checkpoint répond à une seule question — *que se passait-il juste avant l'arrêt* — et
contient : objectif courant, état réel de l'implémentation, boucles ouvertes, problèmes connus,
prochaine action, working set, références de connaissance. Il reste court **parce que tout ce
qui est durable est parti ailleurs**, pas parce qu'on le tronque.

Il est remplacé à chaque checkpoint. L'historique appartient à Git et au tracker ; une seconde
timeline exhaustive serait une source de divergence de plus.

## Reprise

```
intent.yaml + session/current.md + sous-graphe pointé par le checkpoint
```

Jamais `.void/` en entier. Le checkpoint est un pointeur, pas un contenu.

## Interfaces

Trois primitives, dont deux existent.

| Commande | État | Rôle |
|---|---|---|
| `void-harness graph <requête> <cible>` | livré | explain, path, impact, subgraph, owners, tests-for, staleness |
| `void-harness why <cible>` | **à construire** | décisions, invariants et contraintes qui expliquent une cible |
| `void-harness context "<tâche>"` | DEV-443 | working set borné pour une tâche |

`find` est du grep, `project` est une projection de `context`. Aucune des deux ne devient une
commande tant qu'un usage réel ne le demande pas.

`status` est étendu plutôt que doublé : c'est déjà la commande « ce qui est actif dans ce
projet », et c'est le seul endroit où un consommateur peut apprendre ce que le harness a
installé chez lui. `docs/CHEATSHEET.md` remplit ce rôle pour le dépôt du harness uniquement.

Sortie attendue de `why` :

```
src/auth/token-service.ts

  décidé par
    ADR-087  refresh token ownership moved here          (declared, 1.0)
  contraint par
    INV-AUTH-004  a refresh token is single-use          (declared, 1.0)
  vérifié par
    tests/auth/refresh-token.spec.ts                     (extracted, 1.0)
```

## Santé de la connaissance

Une seule vérification dans cette tranche, celle qui détecte la dérive que rien ne rattrape
aujourd'hui : **une décision ou un invariant qui référence un chemin absent de l'arbre**.

Les métriques de coût cognitif — nombre de fichiers lus avant implémentation, taille moyenne
du working set — attendent `context`, faute de dénominateur avant lui.

## Hors périmètre

Explicitement non construit, et pour quelles raisons :

- **Domaines, features et flows inférés.** Inférence faible que la règle de provenance interdit
  de promouvoir. Déclarés d'abord, s'ils sont demandés.
- **Communautés et clusters.** DEV-448 exige déjà une décision par benchmark.
- **Projections Markdown de l'architecture courante.** Elles exigent leur propre gate de
  fraîcheur, sans quoi quelqu'un corrigera le Markdown au lieu de la source.
- **Recherche sémantique.** Suppose des embeddings, donc un modèle et un envoi de code ; le
  harness est déterministe et hors ligne par défaut.
- **`entities/`, `relations/`, `indexes/` en dossiers séparés.** Contenu de `knowledge.json`.
- **Un `PROJECT.md` maintenu.** Une projection à la demande, jamais une source.

## Tests

- Extraction ADR et invariants : happy, frontmatter absent, référence pendante, doublon d'id.
- Gate de fraîcheur : artefact périmé détecté, artefact courant accepté.
- Hook : régénère en incrémental, ne réécrit rien quand rien n'a changé.
- `why` : cible sans décision, cible avec plusieurs, cible absente du graphe.
- Provenance : aucune entité déclarée ne sort avec `origin: extracted`.
- Le corpus d'exactitude existant reste vert : aucun type de nœud ajouté ne modifie une réponse
  existante.

## Risques

**Duplication.** Le mode de dérive le plus probable n'est pas technique : c'est deux
emplacements pour la même connaissance. La spec n'en crée aucun, et c'est sa contrainte la plus
serrée.

**Artefact édité à la main.** `knowledge.json` sera un jour corrigé directement par quelqu'un.
Seul le gate de fraîcheur l'empêche ; sans lui, ne pas matérialiser l'artefact.

**Vocabulaire figé trop tôt.** Trois relations suffisent à `why`. Toute extension attend un cas
réel qu'elles ne couvrent pas.
