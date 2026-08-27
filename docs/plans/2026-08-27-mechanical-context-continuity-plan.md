---
title: Continuité mécanique du contexte
date: 2026-08-27
status: in-progress
spec: docs/specs/2026-08-27-mechanical-context-continuity.md
ticket: DEV-651
author: Folpe + Codex
high_risk: false
---

# Continuité mécanique du contexte

## Goal

Livrer, sans nouveau sous-système, un handler `context-continuity` commun à Claude Code et
Codex. Il conserve dans l'unique checkpoint les faits mécaniques bornés, qualifie chaque reprise
comme complète ou dégradée, puis demande un `void-checkpoint` une seule fois lorsque 50 % d'une
fenêtre fiable sont atteints. Le runtime reste seul propriétaire de `/clear` et `/compact`, et le
modèle reste seul auteur du résidu sémantique.

## Invariants d'implémentation

- `.void/machine/checkpoint.md` reste l'unique état de continuité ; aucun sidecar n'est créé.
- `packages/mission-engine` décide sans I/O ; `packages/hook-runner` adapte les runtimes et les
  fichiers ; les manifests ne font que câbler les événements.
- Le handler est advisory : aucune erreur ne bloque un prompt, un outil ou une compaction.
- Les deux runtimes passent la même matrice de comportement. Une capacité absente reste nommée,
  jamais simulée.
- L'état est borné : 20 chemins uniques par liste, 1 048 576 octets de transcript par invocation,
  un diagnostic par cause et par cycle.
- Aucun LLM, daemon, catalogue de modèles, feature flag durable ou dépendance runtime n'est ajouté.
- Aucun lockfile, secret ou bundle self-host publié sous `.void/hooks/` n'est modifié.

## Steps

### Step 1 - Préserver puis reprendre le minimum mécanique sur les deux runtimes (MVP)

- **Goal**: faire traverser une compaction à un bloc mécanique valide, puis rendre la reprise
  complète ou dégradée depuis le même `ResumeBundle`, sans seuil ni working set dans ce premier
  slice.
- **Depends on**: none
- **TDD mode**: strict
- **Verification gate**: RED puis GREEN sont observés dans
  `packages/mission-engine/src/session/checkpoint.test.ts`,
  `packages/mission-engine/src/session/resume.test.ts`,
  `packages/hook-runner/src/lifecycle/context-continuity-executor.test.ts`,
  `packages/hook-runner/src/lifecycle/resume-observer.test.ts`,
  `packages/hook-runner/src/cli.test.ts` et
  `packages/core/hooks/lifecycle-hooks.test.ts`; ensuite
  `pnpm --filter @voidcorp/mission-engine typecheck` et
  `pnpm --filter @voidcorp/hook-runner typecheck` passent.
- **Expected commits**:
  - `test(context): define mechanical compaction continuity`
  - `feat(context): preserve mechanical state before compaction`
- **Files**:
  - étendre `packages/mission-engine/src/session/checkpoint.ts` et son test pour parser, valider et
    remplacer exactement un bloc délimité sans toucher aux sections sémantiques ;
  - étendre `packages/mission-engine/src/session/resume.ts` et son test avec les gaps de continuité
    et le rendu borné des faits mécaniques ;
  - ajouter `packages/hook-runner/src/lifecycle/context-continuity-executor.ts` et son test, puis
    le raccorder dans `packages/hook-runner/src/cli.ts` et
    `packages/hook-runner/src/lifecycle/resume-observer.ts` ;
  - câbler `PreCompact` et remplacer le handler `SessionStart` par `context-continuity` dans
    `packages/core/.claude-plugin/plugin.json` et `packages/core/codex/hooks.json` ;
  - conserver le wrapper compatible `packages/core/hooks/sessionstart-context.sh`, mais le faire
    pointer vers le handler unique `context-continuity` ;
  - étendre les tests de contrat sous `packages/core/hooks/`.
- **Notes**: l'écriture utilise un fichier temporaire dans le même dossier et un renommage
  atomique. Le verrou n'attend pas : moins de 1 000 ms signifie skip, plus de 1 000 ms autorise
  un remplacement unique. Un bloc ambigu ou une erreur laisse l'ancien checkpoint intact.
  `PreCompact` ne produit que des faits et ne fabrique jamais une prochaine action. Aucun
  `PostCompact`, `Stop` ou `SessionEnd` n'entre dans ce flux.

### Step 2 - Tenir la chaîne cumulative et réconcilier le checkpoint sémantique

- **Goal**: conserver les fichiers lus et modifiés à travers les cycles, faire avancer les
  révisions seulement sur une observation nouvelle et reconnaître le checkpoint sémantique qui
  couvre la révision courante.
- **Depends on**: [step-1]
- **TDD mode**: strict
- **Verification gate**: RED puis GREEN couvrent ordre de récence, déduplication, limite de 20,
  overflow, événements dupliqués, changement d'objectif, écriture sémantique réussie, `/clear`
  dégradé et réarmement dans les tests mission-engine et hook-runner de Step 1 ;
  `test/skills/checkpoint.test.ts` prouve que `void-checkpoint` préserve le bloc mécanique ;
  `pnpm exec vitest run packages/mission-engine/src/session/checkpoint.test.ts
  packages/mission-engine/src/session/resume.test.ts
  packages/hook-runner/src/lifecycle/context-continuity-executor.test.ts
  packages/hook-runner/src/cli.test.ts test/skills/checkpoint.test.ts` passe.
- **Expected commits**:
  - `test(context): define cumulative checkpoint revisions`
  - `feat(context): track the bounded working set across sessions`
- **Files**:
  - étendre les contrats et tests de `checkpoint.ts` et `resume.ts` sans créer un second modèle
    d'état ;
  - réutiliser `packages/hook-runner/src/enforcement/normalize.ts` pour les chemins d'édition et
    borner les chemins de lecture reconnus dans `context-continuity-executor.ts` ;
  - câbler le même handler sur `PostToolUse` dans les deux manifests source ;
  - aligner `packages/core/skills/void-checkpoint/SKILL.md` et
    `test/skills/checkpoint.test.ts` sur la conservation du bloc mécanique.
- **Notes**: `work_revision` avance sur tokens, working set, cycle ou source de reprise réellement
  nouveaux. Une écriture réussie de `.void/machine/checkpoint.md` aligne `semantic_revision` ; un
  hash différent de la section `Objective` est le seul reset autoritaire et vide listes et
  overflows. Claude `Edit|Write`, Codex `apply_patch` et les outils de lecture connus produisent
  le même résultat normalisé. Aucun historique exhaustif n'est promis.

### Step 3 - Mesurer une fenêtre fiable et émettre un seul nudge

- **Goal**: observer la dernière occupation complète du transcript, sans additionner le coût de
  session, puis demander `void-checkpoint` à 50 % une seule fois par cycle lorsque le
  dénominateur est connu.
- **Depends on**: [step-2]
- **TDD mode**: strict
- **Verification gate**: RED puis GREEN couvrent fenêtre absente, configuration 40/50/60 et hors
  borne, dernière entrée `usage`, transcript retardé/tronqué/surdimensionné/malformé, cooldown de
  5 000 ms, nudge unique et réarmement ;
  `pnpm exec vitest run packages/cli/src/lib/config-schema.test.ts
  packages/hook-runner/src/lifecycle/context-continuity-executor.test.ts
  packages/hook-runner/src/cli.test.ts packages/core/hooks/lifecycle-hooks.test.ts` passe ; le
  benchmark `pnpm benchmark:hooks` prouve un p95 inférieur à 75 ms à chaud et un coût incrémental
  inférieur à 25 ms face au no-op du même bundle livré. Il publie aussi les p95 bruts Node,
  no-op et feature : la baseline globale hors budget reste visible et appartient à
  [DEV-662](https://linear.app/voidcorp/issue/DEV-662/reduire-le-cold-start-du-hook-runner-livre).
- **Expected commits**:
  - `test(context): define bounded context threshold behavior`
  - `feat(context): nudge semantic checkpoints at a reliable threshold`
- **Files**:
  - ajouter `context.windowTokens` et `context.checkpointThresholdPercent` dans
    `packages/cli/src/lib/config-schema.ts` et son test, sans modifier les anciennes configs ;
  - étendre `context-continuity-executor.ts` avec la lecture incrémentale par empreinte et curseur,
    limitée à 1 048 576 octets ;
  - câbler `UserPromptSubmit` et la remesure conditionnelle de `PostToolUse` dans les deux
    manifests, sans remplacer le rappel de fermeture existant ;
  - ajouter un benchmark sans dépendance sous
    `packages/hook-runner/benchmarks/context-continuity.mjs`, les scripts package associés et son
    gate dans `scripts/verify.mjs`.
- **Notes**: `used_tokens` vaut input + cache read + cache creation + output pour le dernier appel
  complet. L'adaptateur n'importe pas `packages/cli/src/lib/transcript-cost.ts` : ce dernier
  agrège un coût de session et vit dans la couche CLI, alors que le hook mesure une occupation
  incrémentale. Une fenêtre runtime fiable gagne sur la config ; sans les deux, aucun pourcentage
  ni nudge n'est inventé. Aucun runtime ciblé n'expose actuellement une taille de fenêtre
  documentée : l'implémentation n'interprète donc aucun champ supposé et `.void/config.json` est
  le seul dénominateur initial. Le contrat pur garde l'entrée runtime optionnelle pour un futur
  champ documenté. `UserPromptSubmit` et `PreCompact` ignorent le cooldown ; `PostToolUse` le
  respecte. Aucun contenu de transcript n'est journalisé ou envoyé hors machine.

### Step 4 - Décider, documenter, régénérer et dogfooder la livraison

- **Goal**: rendre le nouveau contrat explicite dans les décisions, les skills et la surface
  publique, puis prouver que sources, artefacts et installations Claude/Codex livrent les mêmes
  garanties.
- **Depends on**: [step-3]
- **TDD mode**: souple
- **Verification gate**: le nouvel ADR passe
  `DECISIONS_BASE=origin/develop pnpm decisions:check`; `pnpm sync:docs`,
  `pnpm skills:check-references`, `pnpm derive:check`, `pnpm conformance:hooks`,
  `node packages/cli/bin/void-harness.mjs self-host sync --mode release-gate`,
  `node packages/cli/bin/void-harness.mjs self-host doctor --mode release-gate` et
  `pnpm verify` passent séquentiellement sur le SHA final ; `git diff --check` est vide.
- **Expected commits**:
  - `docs(context): explain mechanical context continuity`
  - `chore(context): regenerate portable harness artifacts`
- **Files**:
  - créer l'ADR avec
    `pnpm cli -- decisions new --title "PreCompact may preserve mechanical checkpoint state"
    --slug precompact-preserves-mechanical-checkpoint-state --status accepted --decider Folpe`,
    puis remplir ses alternatives, son coût de réversion et la position supersédée ;
  - mettre à jour `docs/plans/skill-audits/void-checkpoint.md` en pointant vers cet ADR, sans
    réécrire un ADR accepté ;
  - aligner `packages/core/skills/void-context/SKILL.md`,
    `packages/core/skills/void-checkpoint/SKILL.md`, `docs/ARCHITECTURE.md`, `docs/CODEX.md` et
    `docs/VISION.md` sur le contrat réellement livré ;
  - mettre à jour `README.md` avec la promesse utilisateur, les limites honnêtes, la reprise
    complète/dégradée et la configuration optionnelle ;
  - régénérer `packages/core/hooks/_void-hook.mjs`, `packages/cli/core-assets/`, la certification,
    le graphe et les registres uniquement par les commandes existantes.
- **Notes**: le README ne promet ni déclenchement de `/clear`/`compact`, ni checkpoint sémantique
  automatique, ni pourcentage sans fenêtre fiable. Le self-host compile les sources dans
  `.void/machine/generated/` ; le bundle publié déjà installé sous `.void/hooks/` reste intact.
  Release Please possède les versions et le changelog. La publication, la PR et le merge restent
  humains.

## Review checkpoints

### Plan gate - avant Step 1

Folpe relit et approuve ce plan. Aucun test, manifest ou code de production n'est modifié avant
ce signal.

### Autopilot gate - après approbation du plan

`void-autopilot` exécute le preflight, présente le ticket, le worktree, la lane séquentielle, les
commandes de vérification et les exclusions, puis attend une confirmation explicite avant de
lancer son worker.

## Execution handoff

| Order | Tracker unit | Title | Depends on | Estimate | Human gate |
|---|---|---|---|---|---|
| P1 | DEV-651 | Livrer la continuité mécanique du contexte | none | L | plan, lancement autopilot, merge |

Ce plan reste un seul ticket parce que ses quatre tranches modifient le même contrat checkpoint,
le même handler, les mêmes manifests et les mêmes artefacts générés. Le découper créerait des
relations et des réconciliations sans permettre un fan-out sûr.

Après approbation, `void-ticket` complète `DEV-651` avec le plan, l'estimation, le label, les
critères et les passes applicables. Aucun `.void/active.md` ou nouveau `.void/program.md` n'est
créé : le programme `knowledge-and-resume` déjà en cours est indépendant et reste intact. La
demande explicite de Folpe nomme `DEV-651`, donc l'autopilot n'utilise pas la sélection automatique
du programme global.

L'autopilot prépare un cluster de taille 1, crée un worktree pour `DEV-651`, fait exécuter les
quatre steps dans l'ordre par `void-implement`, puis réconcilie le seul commit range vérifié dans
une branche d'intégration. Il ouvre une PR non mergée et attend la lecture humaine du diff global.
