---
title: Une seule revue, CI reutilisable et Node courant
status: executing
date: 2026-10-23
spec: docs/specs/2026-10-23-pareto-review-and-ci.md
ticket: ""
author: folpe + Codex
high_risk: true
---

# Execution autorisee

Folpe approuve le 23 octobre la revue locale unique et les caches standards,
avec la derniere version stable Node partout ou compatible. Cette execution
porte sur cette unite autonome ; aucun jalon consommateur n est selectionne.

## 1. Retirer la seconde autorite de revue

- Depends on: none. TDD: strict pour la logique de promotion, souple pour la config.
- Ownership: workflows independent-review et queue, scripts associes et leurs tests,
  promotion.yml/promotion-authority, docs vivantes et miroirs AGENTS/CLAUDE.
- Garder le parcours local existant, CI requise, queue et promotion humaine.
- Adapter les dependances de promotion sans nouveau registre de verdicts ; verifier
  les cas PR absente, contribution externe, back-merge et historique pre-bascule.
- Creer une ADR par la CLI decisions new, sans modifier les ADR acceptees.
- Gate: tests de promotion et workflows, references generees, une revue independante
  du commit final ; aucun workflow supprime encore requis apres bascule live.

## 2. Reutiliser l environnement navigateur et aligner Node

- Depends on: step 1 pour eviter les ecritures concurrentes dans les workflows.
- TDD: strict pour toute nouvelle logique, tests de contrat existants pour la config.
- Ownership: ci.yml, autres workflows Node, fichier standard de version, test/browser,
  dependabot.yml, documentation et tests de conformance existants.
- Node primaire 26.12.1, derniere release officielle observee ; Node 24 conserve
  seulement pour prouver la compatibilite declaree. Pas de changement Node global.
- Image officielle Playwright derivee du manifeste, npm ci avec lockfile genere et
  cache setup-node ; paquet consommateur deja partage conserve. Pas de Dockerfile.
- Gate: resolution reelle verrouillee, build/typecheck/tests pertinents, CI navigateur
  reelle et artefacts visuels. Comparer preparation et tests, sans gain invente.

## 3. Revue, livraison et bascule coordonnee

- Depends on: steps 1 et 2. TDD: souple, verification operationnelle.
- Un seul writer pour implementation/corrections ; un reviewer independant neuf sur
  le commit exact. Reutiliser les conseils architecture deja recueillis.
- Coordinator seul: push/PR et protections live. Worker commit-only, aucun credential.
- Verifier develop et main, les workflows pull_request_target/workflow_run actifs
  sur main, et la promotion avant suppression du check requis ; pas de bypass admin.
- Un changement default-branch ou credential non couvert est expose avec son impact.
- Bilan: skills lus versus activations observables, vrais appels specialists/review,
  tests, cout CI observe et limites. Aucun compteur d activation Codex invente.

## Resume point

Execution deleguee a un seul writer dans le worktree de cette proposition.
Reprise: consulter son rapport, git et la PR ; ne pas recreer une revue valide.

## Parcours jalon demande

Utiliser le parcours existant : scope tracker explicite, dependances et footprints,
void-autopilot puis void-implement par ticket, onglets Herdr si host verifie,
parallele sur perimetres disjoints, conflits mecaniques resolus puis verifies.
Un conflit semantique qui change le besoin remonte a l humain. Pas de second moteur.
Cette intention ne selectionne aucun jalon ou projet consommateur aujourd hui.
