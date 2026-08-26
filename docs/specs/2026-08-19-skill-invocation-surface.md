---
title: Surface d'invocation - une skill par geste, un nom qui résout, un déclenchement prouvé
date: 2026-08-19
status: in-design
author: Folpe + Claude
ticket:
related:
  - docs/specs/2026-08-17-structural-conformance.md
  - docs/decisions-log/2026-08-18-skill-naming-rule-three-families--c109429b-480e-48a9-baba-93f644f9e9e1.md
  - CLAUDE.md
  - AGENTS.md
---

# Surface d'invocation

## Résumé

Le harnais définit 37 skills, 4 commands et 21 agents. Ce qu'il définit est bon ; ce qui est
cassé, c'est la façon dont un runtime les atteint. Trois surfaces coexistent pour le même geste,
le nom que les skills utilisent pour s'appeler entre elles ne résout pas dans le mode
d'installation principal, et le champ qui déclare quand une skill s'arme n'est lu par aucun
runtime.

Cette spec ramène le harnais à une règle unique : **un geste, une skill, un nom qui résout dans
les trois runtimes, et un déclenchement qu'on peut prouver.**

Elle est née d'un symptôme visible : la palette de Claude Code proposait quatre entrées
`/checkpoint` avec deux descriptions contradictoires.

## Problème

Quatre défauts, tous mesurés le 2026-08-19, tous reproductibles.

### 1. La chaîne d'`implement` ne s'enchaîne pas, parce que les noms sont morts

Les skills se citent entre elles avec le préfixe de plugin. `implement` écrit seize fois
« Compose `harness:tdd` », `harness:testing`, `harness:security-guidance`. Ce préfixe n'existe
que si le harnais est installé comme plugin de marketplace. En installation project-local, celle
de `npx voidharness` et celle de ce dépôt, le nom invocable est `tdd`.

**Preuve.** Sur un projet neuf portant `.claude/skills/zzprobe/SKILL.md`, un appel forcé :

```
Argument envoyé : skill='harness:zzprobe'
Résultat : erreur — Unknown skill: harness:zzprobe
```

Chaque « compose » de la chaîne est donc un appel qui échoue. Le modèle rattrape en devinant le
nom nu, ou n'appelle rien et rejoue la passe de mémoire. La chaîne a l'air de tourner et n'est
jamais garantie.

**Ampleur.** 223 occurrences de `harness:<nom>` dans 60 fichiers d'assets livrés, dont les 37
`SKILL.md`, portant 29 noms distincts. Plus 19 dans `CLAUDE.md` et 3 dans `AGENTS.md`.

**Aggravant.** `pnpm skills:check-references` valide que la skill citée existe au catalogue, pas
que le nom soit invocable. Le gate donne une assurance fausse, ce qui est pire qu'aucun gate.

### 2. Le déclenchement automatique n'est déclaré nulle part où un runtime le lit

Chaque skill porte `enforcement.inline.{claude,codex,hermes}` avec les valeurs `pretooluse`,
`active` ou `ci-only`. Le champ n'est lu que par `packages/harness-graph/src/state/score.ts`,
`derive/read-frontmatter.ts` et `model/types.ts`, c'est-à-dire par le graphe, pour scorer.
**Aucun runtime ne le consomme.** Il décrit une intention, pas un mécanisme.

Le déclenchement repose donc entièrement sur la `description` que le modèle lit et interprète.
Les treize hooks `PreToolUse` câblés refusent des écritures ; aucun ne rappelle la skill qui
s'applique.

Il n'existe d'ailleurs aucun mécanisme, dans aucun des trois runtimes, qui charge une skill de
force sur un fichier. `paths`, souvent pris pour cela, fait l'inverse : la documentation le donne
comme « glob patterns that *limit* when this skill is activated ». Le déclenchement automatique
est donc, partout, une affaire de description lue par un modèle, plus ce qu'un hook dit au moment
où il agit.

### 3. Les commands sont un format legacy, et Claude-only par construction

La documentation officielle est explicite : « Custom commands have been merged into skills. A
file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create
`/deploy` and work the same way. » Le frontmatter de skill porte tout ce que la command portait,
plus `paths`, `model`, `effort`, `context: fork`, `disable-model-invocation`.

Ni Codex ni Kimi n'ont la moindre notion de command. Tant qu'un geste vit dans `commands/`, il
est structurellement Claude-only : `runtime-assets.ts` ne stage `commands/` que vers
`.claude/commands/`.

Et c'est déjà cassé au-delà de la théorie : `.claude/commands/void-graph.md` installé localement
contient encore `${CLAUDE_PLUGIN_ROOT}`, jamais substitué hors plugin.

La décision du 2026-06-04 explique l'origine : « the plugin shipped zero slash commands, leaving
in-session ergonomics unused ». Les commands ont été créées quand une skill n'était pas
invocable au clavier. La raison a disparu, le format est resté.

### 4. Le frontmatter est hors de la spécification Agent Skills

La spec Agent Skills n'autorise que `name`, `description`, `license`, `compatibility`,
`metadata`, `allowed-tools`, et veut les données propriétaires sous `metadata` en map
chaîne vers chaîne. Le harnais place `kind`, `owner`, `runtimes`, `enforcement` (map imbriquée)
et `eval_targets` (liste) à la racine.

**Ce que ça coûte aujourd'hui : rien.** Vérifié en direct : `codex exec` charge sans broncher une
skill portant le frontmatter maison. Claude Code ignore les champs inconnus.

**Ce que ça coûtera :** le validateur officiel `skills-ref validate` refuse ces fichiers, et un
runtime qui durcira sa validation les refusera aussi. Pour un harnais qui se veut aux
conventions, c'est une dette qui se paie au pire moment.

### Le terrain multi-runtime, mesuré

| Runtime | Lit | Invocation | Vérifié |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `/nom` | oui, cette session |
| Codex | `$REPO_ROOT/.agents/skills/` | `$nom` | oui, `codex exec` 0.147.0 |
| Kimi | `.agents/skills/`, `.claude/skills/` | `/skill:nom` | doc officielle |

Le harnais produit déjà les deux répertoires. La surface est bonne ; c'est le contenu qui ne
l'est pas encore. Conséquence directe pour la rédaction : **le corps d'une skill nomme la skill
voisine, il ne code jamais en dur sa syntaxe d'invocation**, puisque cette syntaxe diffère dans
les trois runtimes.

## Ce qui a déjà été corrigé

Travail du 2026-08-19, présent dans l'arbre, non committé :

- `checkpoint` et `autopilot` existaient en command **et** en skill, avec deux descriptions
  divergentes. Les deux commands sont supprimées ; ce qui n'existait que dans le wrapper est
  porté dans la skill (le garde `.void/program.md` et `autopilot.enabled: false` pour autopilot,
  le sens d'un argument pour checkpoint).
- Gate dans `scripts/anti-bloat-check.sh` et test `test/skills/slash-command-uniqueness.test.ts` :
  un nom ne peut pas exister à la fois en command et en skill. Prouvé mordant par injection
  d'une collision.
- Règle 8 étendue dans `CLAUDE.md` et `AGENTS.md`.

C'est la tranche 0 : elle traite le symptôme visible, pas la cause.

## Le modèle cible

### La règle

Un geste, une skill, un nom qui résout dans les trois runtimes, un déclenchement prouvé.

### La forme des références

Dans le corps d'une skill, une skill voisine se nomme par son **nom nu** : `` `tdd` ``. La
syntaxe d'invocation appartient au runtime, jamais au texte de la doctrine.

La règle de résolution est écrite une seule fois, dans le bloc géré de `CLAUDE.md` et
`AGENTS.md`, qui sont déjà compilés par runtime : `claude-md.ts` fait déjà la distinction
`isClaude ? 'harness:implement' : 'implement'`. C'est le seul endroit qui a le droit de connaître
un préfixe, parce que c'est le seul qui sait dans quel canal il est installé.

Les deux canaux restent valides. Le nom nu est ce que voit une installation locale, la très
grande majorité ; le mode plugin conserve son préfixe, et le doc d'amorce le dit.

### Les trois niveaux de déclenchement

Du plus universel au plus contraignant. Ils se composent, ils ne se remplacent pas.

**1. La description.** Le seul levier qui porte dans les trois runtimes, et celui qui décide de
l'essentiel. `description` dit ce que la skill fait et quand ; `when_to_use` porte les phrases
déclencheuses. Une skill qui ne se déclenche pas est d'abord une skill mal décrite.

**2. `paths`.** Claude Code uniquement, et **restrictif** : la documentation dit « glob patterns
that *limit* when this skill is activated ». Il ne provoque aucune activation, il empêche celles
qui sortent du périmètre. C'est donc un outil de précision et de frugalité, pas le mécanisme de
déclenchement qu'il semblait être. Mesure qui tranche : les huit standards à périmètre de fichier
pèsent 13 534 mots ensemble, soit environ vingt mille tokens s'ils se chargeaient tous sur chaque
édition TypeScript. Le chargement automatique de masse n'est pas souhaitable, et `paths` ne le
produirait de toute façon pas.

**3. Les hooks.** Le filet dur, le seul niveau qui traverse Claude et Codex de la même façon
(`.claude/settings.json` et `.codex/hooks.json` portent déjà le même runner), et, la mesure faite,
**le levier principal** plutôt que le dernier recours. Un refus qui nomme la skill gouvernante
coûte une clause et ne charge rien ; le modèle va chercher la doctrine seulement si la phrase ne
suffit pas. C'est ce que les 26 440 exécutions de hooks contre 4 activations de skill désignent :
la couche qui s'exécute vraiment est celle des hooks, et c'est par elle que la doctrine se fait
connaître.

C'est à ce moment que `enforcement.inline` cesse d'être décoratif : il devient la source depuis
laquelle ces trois niveaux sont câblés, et le graphe le lit comme une observation, plus comme une
déclaration d'intention.

### Le frontmatter conforme

Les champs de la spec restent à la racine. Les champs propriétaires passent sous `metadata`,
aplatis en chaînes :

```yaml
---
name: tdd
description: ...
allowed-tools: ...
metadata:
  void_kind: standard
  void_owner: folpe
  void_runtimes: claude,codex
  void_enforcement_floor: ci
  void_enforcement_claude: pretooluse
---
```

`skills-ref validate` passe en CI. Le graphe lit `metadata.void_*` au lieu de la racine.

## Décisions

**`void-feedback` est fondu dans `learn`.** Tranché par Folpe le 2026-08-19. La command est une
copie de la branche B de `learn` : même barre agnostique et harness-worthy, même
`gh issue create --repo voidcorp-core/void-harness`, même HITL. `learn` reçoit les phrases
déclencheuses dans son `when_to_use`. C'est la seule surface qui disparaît de tout ce chantier.
*Alternative rejetée :* garder une skill `void-feedback` qui délègue à `learn`, c'est-à-dire
recréer exactement le wrapper que la tranche 0 vient de supprimer.

**Les trois autres commands deviennent des skills** avec `disable-model-invocation: true`, qui
dit précisément ce qu'elles sont : des gestes qu'on tape, pas que le modèle déclenche.
`packages/core/commands/` disparaît. Aucun nom ne bouge.
*Alternative rejetée :* garder les commands pour leur `allowed-tools`, qui existe aussi dans le
frontmatter de skill.

**Le nom nu est la forme écrite.**
*Alternative rejetée :* une réécriture des références à l'installation. Elle marcherait, mais
elle crée deux formes du même texte, une en source et une sur disque, et rend toute lecture de
skill installée différente de sa source.
*Alternative rejetée :* abandonner le canal marketplace pour n'avoir qu'un nom. Le canal ne coûte
rien tant que le doc d'amorce porte la règle de résolution.

## Ce que cette spec ne fait pas

- **Le bloc `.gitignore` géré.** Le bloc installé porte 29 entrées d'avant le renommage 3.0 et
  il manque les 29 vraies ; l'installation du 18/08 a écrit ses fichiers et son reçu sans jamais
  patcher le bloc. Ce défaut appartient à `docs/specs/2026-08-17-structural-conformance.md`, qui
  nomme déjà « blocs d'ignore gérés » dans sa frontière d'admission. Il est réparé là-bas, pas
  ici, et cette spec ne redéfinit pas le moteur.
- **La revue du contenu des 37 skills.** Elle vient après, et elle vient après pour une raison :
  juger le contenu d'une skill à travers des liens cassés reviendrait à corriger deux choses en
  même temps sans savoir laquelle produisait le symptôme.
- **Les agents.** 21 agents, autre surface, autres règles d'invocation. Hors périmètre.
- **Le choix des runtimes supportés.** Kimi lit déjà ce que le harnais produit ; aucun adaptateur
  Kimi n'est écrit ici.

## Risques

**Le déclenchement par `paths` peut devenir bruyant.** Une skill armée sur `**/*.ts` se charge
sur toute édition TypeScript. La mitigation est le périmètre : `paths` est réservé aux standards
qui s'appliquent vraiment à tout le fichier, jamais aux actions.

**Le mode plugin devient le cas non testé.** Écrire le nom nu privilégie l'installation locale.
La mitigation est un test qui monte les deux canaux et vérifie qu'un nom cité résout dans chacun.

**La migration du frontmatter touche 37 fichiers plus le graphe.** Elle est mécanique mais large.
Elle passe en dernier, derrière les tranches qui ont une valeur observable.

## Preuves attendues

Une tranche n'est finie que si sa preuve est observée, jamais déduite.

| Tranche | Preuve |
|---|---|
| Noms | un test monte un projet local, cite une skill par son nom nu, et l'invocation résout |
| Commands | `packages/core/commands/` absent, les quatre noms toujours invocables, `${CLAUDE_PLUGIN_ROOT}` absent des assets installés |
| Déclenchement | un test vérifie que chaque skill `paths` déclare des globs qui matchent des fichiers réels du dépôt ; un hook nomme la skill dans son refus |
| Conventions | `skills-ref validate` passe sur les 37 skills, en CI |
| Multi-runtime | `codex exec` et Claude Code résolvent la même skill par le même nom, dans le même dépôt |
