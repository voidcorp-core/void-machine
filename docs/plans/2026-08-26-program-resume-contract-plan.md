---
title: Programme durable et reprise de session unifiee
date: 2026-08-26
status: in-progress
spec: docs/specs/2026-08-26-program-resume-contract.md
ticket:
author: Folpe + Codex
high_risk: false
---

# Programme durable et reprise de session unifiee

## Goal

Remplacer le contrat trompeur et couple `.void/active.md` par un programme durable
`.void/program.md`, conserver le checkpoint local comme residu de session, et composer les deux
avec Git dans un unique `ResumeBundle` consomme hors ligne par le CLI et les hooks Codex et Claude
Code. La livraison simplifie aussi le journal ADR sans reecrire son histoire et corrige separement
le faux positif Biome du doctor.

## Steps

### Step 1 - Livrer le programme canonique avec sa compatibilite de lecture (MVP)

- **Goal**: rendre `.void/program.md` lisible de bout en bout, sans dependance Linear, tout en
  detectant explicitement les anciens chemins seuls ou ambigus.
- **Depends on**: none
- **TDD mode**: strict
- **Verification gate**: les tests cibles de
  `packages/cli/src/lib/autopilot/program.test.ts`,
  `packages/cli/src/lib/autopilot/preflight.test.ts` et
  `packages/cli/src/lib/projects/read.test.ts` passent, puis `pnpm typecheck` passe.
- **Expected commits**:
  - `test(program): define the provider-agnostic program contract`
  - `feat(program): make program.md the canonical durable descriptor`
- **Notes**: renommer `ActiveProgram` en `ProgramDescriptor` et `activeProgramPath` en
  `programPath`; conserver `.void/active.md` et `plans/ACTIVE.md` uniquement dans une constante de
  compatibilite et ses fixtures. Un fournisseur inconnu reste lisible. Un autopilot active exige
  les capacites de progression necessaires avant toute action distante.

### Step 2 - Composer et rendre le ResumeBundle

- **Goal**: faire de `ResumeBundle` la seule surface de lecture pour programme, checkpoint et etat
  Git dans les formats `human`, `json` et `context`.
- **Depends on**: [step-1]
- **TDD mode**: strict
- **Verification gate**: les tests cibles de `packages/cli/src/lib/session/checkpoint.test.ts`,
  `packages/cli/src/lib/session/resume.test.ts`, `packages/cli/src/commands/resume.test.ts` et
  `packages/cli/src/lib/projects/read.test.ts` passent; le rendu `context` respecte son budget
  teste et ne contient ni diff, ni decisions, ni sortie tracker.
- **Expected commits**:
  - `test(resume): define the offline resume bundle`
  - `feat(resume): compose program checkpoint and git state`
- **Notes**: ajouter `head` au checkpoint; une absence ou une fraicheur insuffisante produit un gap
  mais jamais un contenu invente. Les lectures `projects` et la commande `resume` consomment le meme
  constructeur de bundle.

### Step 3 - Raccorder le cycle de vie des deux runtimes

- **Goal**: injecter le meme contexte de reprise au demarrage, rappeler `void-checkpoint` sur une
  intention explicite de fermeture et auditer sans ecrire a `SessionEnd`.
- **Depends on**: [step-2]
- **TDD mode**: strict
- **Verification gate**: les tests de `packages/core/hooks/`,
  `test/primitive-hooks/primitive-hooks.test.ts` et
  `packages/core/hooks/codex-parity-hooks.test.ts` prouvent les evenements Codex et Claude, les cas
  positifs/negatifs d'intention, la parite du contexte et l'absence d'ecriture de checkpoint a la
  fin de session.
- **Expected commits**:
  - `test(hooks): define portable session resume behavior`
  - `feat(hooks): inject resume context and checkpoint reminders`
- **Notes**: modifier les sources de hooks sous `packages/core/`, leurs assets compiles sous
  `packages/cli/core-assets/`, `.codex/hooks.json` et `.claude/settings.json` par les generateurs
  existants. Les hooks restent locaux, bornes, advisory et sans appel tracker ou LLM.

### Step 4 - Aligner la skill checkpoint et les instructions installees

- **Goal**: rendre le checkpoint independant du tracker et enseigner partout la distinction entre
  programme global, progression externe et residu de session.
- **Depends on**: [step-3]
- **TDD mode**: souple
- **Verification gate**: `test/skills/checkpoint.test.ts`,
  `test/sync-agent-docs/sync-agent-docs.test.ts`, `pnpm sync:docs` et
  `pnpm skills:check-references` passent.
- **Expected commits**:
  - `docs(session): align program and checkpoint ownership`
- **Notes**: mettre a jour ensemble `AGENTS.md` et `CLAUDE.md`, la source
  `packages/core/skills/void-checkpoint/SKILL.md`, ses assets derives et la documentation vivante.
  Aucune prochaine unite n'est stockee dans le programme ou le checkpoint.

### Checkpoint A - apres Step 4

Le programme canonique, le ResumeBundle et les hooks sont executables. Executer `void-verify` sur
ce sous-ensemble et presenter les contrats observes avant de modifier le journal ADR.

Stop here. Wait for user signal to proceed.

### Step 5 - Autoriser uniquement les migrations mecaniques dans les ADR

- **Goal**: conserver l'immutabilite decisionnelle tout en permettant une reference locale dont la
  cible a ete deplacee ou renommee.
- **Depends on**: [step-4]
- **TDD mode**: strict
- **Verification gate**: `packages/cli/src/lib/decisions/immutability.test.ts` refuse toujours
  prose, titre, frontmatter, suppression, renommage, cible absente et cible hors depot, mais accepte
  les seules substitutions de references bornees vers une cible existante.
- **Expected commits**:
  - `test(decisions): define safe reference migrations`
  - `feat(decisions): distinguish references from decision content`
- **Notes**: porter la meme regle dans `void-decide`, `docs/CONTRIBUTING.md`, `AGENTS.md` et
  `CLAUDE.md`; ne pas ajouter d'ADR pour ce changement de politique explicitement valide.

### Step 6 - Simplifier la lecture du journal et migrer les references certaines

- **Goal**: disposer les cinq propositions auditees, rendre la supersession effective visible et
  corriger uniquement les 24 chemins dont l'equivalent est certain.
- **Depends on**: [step-5]
- **TDD mode**: strict
- **Verification gate**: les tests de `packages/cli/src/lib/decisions/render.test.ts` prouvent le
  statut effectif sans reecriture historique; `DECISIONS_BASE=origin/develop pnpm decisions:check`
  et `pnpm derive:check` passent; le grep des anciens chemins ne retourne que la compatibilite.
- **Expected commits**:
  - `test(decisions): expose effective supersession`
  - `docs(decisions): resolve proposals and migrate local references`
- **Notes**: accepter et amender l'ADR de handoff pour superseder les deux ADR programme; marquer
  l'ADR specialistes deja cible comme `superseded`; accepter les trois propositions implementees.
  Ne ni fusionner, ni supprimer les ADR legacy, et ne pas moderniser les noms historiques reels.

### Step 7 - Corriger le faux positif de frontiere Biome

- **Goal**: faire conclure le doctor sur la portee Biome effective, y compris `extends`, sans
  exclusion redondante dans le `biome.json` racine.
- **Depends on**: none
- **TDD mode**: strict
- **Verification gate**: `packages/cli/src/lib/lint-exclusion.test.ts` couvre une base etendue, les
  includes positifs, les exclusions et les cycles/erreurs de resolution; le test reproduit echoue
  avant la correction puis toute la suite cible passe.
- **Expected commits**:
  - `test(doctor): reproduce inherited Biome exclusion`
  - `fix(doctor): resolve effective Biome file scope`
- **Notes**: fonder l'implementation sur Biome 2.4.16 et sa documentation officielle deja citee
  dans la spec; borner les lectures au depot et echouer explicitement sur une configuration non
  interpretable.

### Step 8 - Regenerer, auditer et sceller la livraison

- **Goal**: verifier que sources, assets, documentation, decisions et harness auto-heberge rendent
  le meme contrat sans regression.
- **Depends on**: [step-6, step-7]
- **TDD mode**: souple
- **Verification gate**: `pnpm test`, `pnpm sync:docs`, `pnpm derive:check`,
  `DECISIONS_BASE=origin/develop pnpm decisions:check`, `pnpm skills:check-references`,
  `node packages/cli/bin/void-harness.mjs self-host doctor` et les greps d'anciens chemins passent
  sur le SHA final; `git diff --check` est vide.
- **Expected commits**:
  - `docs(program): record final verification evidence`
- **Notes**: aucune version ni lockfile n'est modifie; le correctif doctor reste identifiable dans
  ses propres commits; la publication et le merge restent humains.

## Review checkpoints

### Plan gate - avant Step 1

Le present plan est revu et approuve par l'utilisateur avant toute modification de production ou
de test.

### Checkpoint A - apres Step 4

L'utilisateur valide le comportement programme/reprise/hook avant le changement du garde-fou ADR
et la disposition du journal.

## Resume point

**Next step**: Checkpoint A (attendre le signal utilisateur, puis commencer Step 5)

**Completed**:

- Spec approuvee: `docs/specs/2026-08-26-program-resume-contract.md`.
- Audit ADR termine: `docs/plans/2026-08-26-decision-log-audit.md`.
- Steps 1 a 4: programme canonique, ResumeBundle, hooks de cycle de vie, puis alignement du skill
  checkpoint et des instructions installees.

**Pending**:

- Checkpoint A: validation humaine des contrats observes.
- Step 5: Garde-fou ADR.
- Step 6: Disposition et migrations ADR.
- Step 7: Correctif Biome en paire RED/GREEN.
- Step 8: Verification finale.
