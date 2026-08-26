# Système — faits vérifiables

Chaque ligne renvoie au fichier qui la prouve. Inventaire relevé sur `main` au
commit `15d6689` ; les règles de garde restent actualisées lorsqu'elles changent.

## Inventaire

| Élément | Nombre | Preuve |
|---|---:|---|
| Agents (`.md`) | 21 | `packages/core/agents/` |
| Fichiers `.source` accompagnant un agent | 5 | `packages/core/agents/*.source` |
| Skills | 37 | `packages/core/skills/*/SKILL.md` |
| Commandes | 6 | `packages/core/commands/` |
| Scripts de hook (`.sh`) | 33 | `packages/core/hooks/*.sh` |
| Workflows YAML | 2 | `packages/core/workflows/` |
| Enregistrements de décision | 132 | `docs/decisions-log/*.md` |
| Workflows GitHub Actions | 4 | `.github/workflows/` |

## Agents

- 21 agents déclarent `tools: Read, Grep, Glob` ; 5 d'entre eux ajoutent `Bash` : `code-explorer`, `doctrine-critic`, `migration-planner`, `silent-failure-hunter`, `type-design-analyzer`. Preuve : frontmatter de `packages/core/agents/*.md`.
- Aucun agent ne déclare `Edit` ou `Write`. Preuve : frontmatter de `packages/core/agents/*.md`.
- 5 agents déclarent un `model` : `sonnet` pour `code-explorer`, `doctrine-critic`, `silent-failure-hunter`, `type-design-analyzer` ; `opus` pour `migration-planner`. Les 16 autres n'ont pas de champ `model`. Preuve : frontmatter de `packages/core/agents/*.md`.

## Commandes

`void-autopilot`, `void-checkpoint`, `void-audit`, `void-doctor`, `void-feedback`, `void-graph`. Preuve : `packages/core/commands/`.

## Hooks câblés

`packages/core/.claude-plugin/plugin.json` déclare 19 entrées de hook réparties ainsi :

| Événement | Entrées | Matchers |
|---|---:|---|
| `PreToolUse` | 13 | 11 × `Edit\|Write`, 1 × `Bash`, 1 × `*` |
| `PostToolUse` | 3 | 1 × `Edit\|Write`, 2 × `*` |
| `SessionStart` | 1 | aucun |
| `Stop` | 2 | aucun |

Les 12 règles `enforce` câblées en `PreToolUse` : `tdd-order`, `no-any`, `no-as-cast`, `no-console`, `no-null`, `no-focused-test`, `boundary-direction`, `test-name`, `protected-file`, `dangerous-command`, `design-slop`, `secret-content`. Preuve : `packages/core/.claude-plugin/plugin.json`.

La 13e entrée `PreToolUse` (matcher `*`) appelle `activation`, non `enforce`. Preuve : `packages/core/.claude-plugin/plugin.json`.

Toutes les entrées invoquent le même exécutable, `packages/core/hooks/_void-hook.mjs`. Preuve : champ `command` de chaque entrée dans `packages/core/.claude-plugin/plugin.json`.

`packages/core/codex/hooks.json` déclare que `trim-large-output` n'est pas mirroré côté Codex : « NOT mirrored, deliberately: trim-large-output, whose PostToolUse output rewriting is unconfirmed on Codex ».

## Règles de décision écrites

### Huit règles anti-bloat

`CLAUDE.md` énonce huit règles numérotées : ≤ 400 lignes par skill (1), un skill = un sujet (2), pas de recouvrement de responsabilité > 30 % (3), cible éditoriale de 250 caractères et plafond bloquant de 500 pour les descriptions de découverte (4), hooks ≤ 100 lignes (5), périmètre explicite des agents (6), tests de skill verts en CI (7), nom `void-` non ambigu et grammaticalement classé (8).

`scripts/anti-bloat-check.sh` applique mécaniquement les seuils et conventions suivants :

| Règle | Seuil | Appliquée par un script |
|---|---|---|
| 1 — SKILL.md | ≤ 400 lignes | oui, `scripts/anti-bloat-check.sh:22-31` |
| 4 — description | cible ≤ 250, plafond 500 caractères | oui, sur skills core/packs, agents et spécialistes canoniques |
| 5 — hooks | ≤ 100 lignes | oui, `scripts/anti-bloat-check.sh:33-43` |
| 2 — un skill, un sujet | — | non trouvé dans `scripts/` |
| 3 — recouvrement > 30 % | — | non trouvé dans `scripts/` |
| 6 — périmètre des agents | — | non trouvé dans `scripts/` |
| 7 — tests de skill | — | étape `Skill tests`, `.github/workflows/ci.yml:177` |
| 8 — nom des skills | préfixe `void-`, grammaire `action`/`standard` | oui, `scripts/anti-bloat-check.sh` |

Les fichiers de hook préfixés par `_` sont exclus du plafond de la règle 5. Preuve : `scripts/anti-bloat-check.sh:33-35`.

### Autres règles écrites dans CLAUDE.md

- Toute convention ajoutée dans un commit doit être reflétée dans `docs/*.md` dans le même commit.
- Toute décision non évidente doit exister comme fichier dédié créé par `void-harness decisions new` ; les enregistrements `accepted` sont immuables et une modification les supersede.
- `docs/DECISIONS.md` est déclaré page d'atterrissage figée.
- Les versions ne sont pas éditées à la main ; `release-please` les bump et `pnpm version:check` échoue en cas de dérive.
- `AGENTS.md` est le miroir de `CLAUDE.md` ; toute modification de l'un doit être portée dans l'autre dans le même commit.

## Points de validation humaine

- « Human gates and merges remain human » — `CLAUDE.md:37`.
- « HITL is absolute: no automatic write into doctrine, ever. Every change is a deliberate commit. » — `CLAUDE.md:111`.
- « There is no `--auto-merge`, on any path » — `CLAUDE.md:115`.
- La CLI refuse l'option : `if (argv.includes('--auto-merge'))` suivi du message `autopilot does not accept --auto-merge` — `packages/cli/src/commands/autopilot.ts:478-485`.
- Le corps de PR généré énonce : « Merging is a human action: this branch arms no auto-merge, and no ticket is completed by this body » — `packages/cli/src/lib/autopilot/pr-body.ts:92`.
- Une suite de tests porte sur cette frontière : `test/autopilot/merge-boundary.test.ts`.
- `.void/program.md` déclare `mergeGate: human` et les `humanGates` du programme courant.
- `.void/program.md` déclare `autopilot.enabled: false` et `clusterSize: 4`.
- L'autopilot exige une confirmation humaine avant le fan-out des workers, et les workers sont commit-only. Preuve : `CLAUDE.md:115`.
- La publication npm est déclenchée par le merge de la PR de release, décrit comme « the only human gate (HITL) » — `docs/RELEASING.md:57-61`.

## Ce qui s'exécute automatiquement

### CI — job `validate` (`.github/workflows/ci.yml`)

Étapes, dans l'ordre du fichier : parité des docs sœurs, lockstep de version, anti-bloat, validité et immuabilité des ADR, fraîcheur du runner de hooks généré, synchronisation de `core-assets`, lint Biome, sûreté de publication, plafonds de taille de paquet, build, benchmark d'extraction ProjectGraph, benchmark de requêtes ProjectGraph, gate self-host, intégrité du graphe, fraîcheur de certification, fraîcheur du bundle consommateur, fraîcheur de la cheat sheet, tests de skill, typecheck.

### CI — job `install-conformance` (`.github/workflows/ci.yml:13-37`)

Exécuté sur `ubuntu-latest`, `macos-latest`, `windows-latest` : installation hors ligne depuis un tarball et exécution des hooks pour Claude, Codex et les deux ; tests et typecheck ProjectGraph ; conformance du sous-chemin ProjectGraph empaqueté.

### CI — job `enforce` (`.github/workflows/void-enforce.yml`)

Rejoue quatre règles via `packages/core/enforce/ci-enforce.sh` : `protected-file` (ligne 136), `secret-content` (157), `tdd-order` (168), `boundary-direction` (174). `protected-file` s'exécute sur le chemin ; les trois autres sur les lignes ajoutées du diff.

`dangerous-command` n'est pas rejouée sur le diff. Le fichier en donne la raison : « A destructive PATTERN committed into a file is a weak signal that self-matches the harness's own detector, security docs, and test fixtures » — `packages/core/enforce/ci-enforce.sh:184-188`.

Le script échoue fermé sur prérequis manquant : « FAIL-CLOSED (DEV-393, the #62-64 class) » — `packages/core/enforce/ci-enforce.sh:7`.

Des exemptions par glob de chemin sont lisibles dans `.github/void-enforce-allow`. Preuve : `packages/core/enforce/ci-enforce.sh:60-66`.

### Release (`.github/workflows/release.yml`)

Deux jobs : `release-please` et `publish`. `publish` est conditionné à `release_created` et utilise le trusted publishing OIDC. Preuve : `.github/workflows/release.yml:32,82,122-134`.

## Ce qui n'est pas automatisé

- Les règles anti-bloat 2, 3 et 6 : aucun script de `scripts/` ne les vérifie.
- Le merge d'une PR : refusé par la CLI, absent de tout workflow.
- La sélection du backlog : `CLAUDE.md:115` la place derrière HITL.
- L'écriture dans la doctrine : `CLAUDE.md:111`.
- La détection `dangerous-command` sur un diff de PR : `packages/core/enforce/ci-enforce.sh:184-188`.

## Enregistrements de décision

- 132 fichiers dans `docs/decisions-log/`, tous avec frontmatter YAML.
- Deux formats coexistent : 96 fichiers avec `date` + `title`, 36 avec `schemaVersion`, `id`, `status`, `deciders`, `supersedes`.
- Parmi les 36 : 31 `status: accepted`, 5 `status: proposed`.
- `pnpm decisions:check` exécute `scripts/build-decisions-index.mjs --check`. Preuve : `package.json:28`.
- En CI, l'étape reçoit `DECISIONS_BASE` depuis `github.event.pull_request.base.sha` et est nommée « Decision records valid and accepted records immutable ». Preuve : `.github/workflows/ci.yml:83-88`.

## Enforcement déclaré par les skills

Les 37 skills déclarent `enforcement.floor: ci`. Preuve : frontmatter de `packages/core/skills/*/SKILL.md`.

## Protection de branche

`packages/cli/src/lib/autopilot/branch-protection.ts:6-8` : « unauthenticated `gh`, a network blip and a genuinely unprotected branch all look the same from inside, and only one of them is safe. Unknown is therefore treated exactly like unprotected. »
