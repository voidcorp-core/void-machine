---
title: Une seule revue et un environnement CI reutilisable
date: 2026-10-23
status: in-design
author: folpe + Codex
ticket: ""
related:
  - 2026-09-28-autopilot-merge-without-consumer-setup.md
---

# Une seule revue et un environnement CI reutilisable

## Objectif et observations

Reduire le temps de livraison sans retirer TDD, specialistes pertinents, controles
securite, revue independante ou tests. Observation sur develop `2e655b78` : la
revue locale coexiste avec une revue Claude GitHub obligatoire. La protection de
develop exige `independent-review` depuis l'App 5070504. La promotion depend aussi
de cette autorite. Les consommateurs ont deja une voie sans App, acceptee par
l'ADR `6660e476-77c4-420b-801d-00f941c9395e`.

Sur le run CI 40008853140, l'installation navigateur a pris 10 min 20 et les tests
32 secondes. C'est une observation, pas une moyenne ni un gain garanti. Le tarball
consommateur est deja partage entre les tests navigateur et les trois OS.

## Choix propose : une seule autorite de revue locale

Conserver le parcours existant : contexte neuf, lecture seule, commit exact,
auteur distinct du reviewer, conclusions tracables. Preferer un autre runtime
lorsqu'il est disponible et autorise ; rendre toute indisponibilite explicite.
Une correction invalide le verdict concerne ; la reprise cible les corrections
et leurs impacts. Aucun cycle supplementaire pour des suggestions sans effet
sur le resultat attendu. Une revue absente, obsolete ou bloquante interdit le
merge automatique. Le recap conserve le reviewer, le runtime connu et le SHA.

Retirer ensemble la seconde revue GitHub, le publisher de check dedie et le relais
merge-group, puis adapter la promotion a une validation humaine explicite et aux
preuves CI. Ne pas creer de pont de certification, de signature ou de registre
pour copier le verdict local. Conserver les checks deterministes requis, la merge
queue, le traitement humain des chemins proteges et la promotion humaine vers main.

Cette option fait confiance au coordinateur et a ses droits locaux. Elle ne
remplace pas la resistance a un faux PASS obtenue par une App dont les credentials
sont separes. Ce risque existe deja dans le modele consommateur ; l'accepter ici
change la decision propre au depot public et exige une ADR qui la supersede.
Un contributeur externe passe toujours par une revue du mainteneur ; aucun merge
autonome ne resulte seulement d'un commentaire de PR.

Alternatives examinees : GitHub seul conserve une autorite serveur mais deplace
le parcours consommateur et garde la maintenance de l'integration ; conserver
les deux maximise les controles mais conserve le cout observe. La voie locale
est recommandee pour l'usage de confiance demande, sans pretendre offrir la meme
separation de credentials.

## CI : reutiliser les mecanismes standards

- Conserver l'artefact consommateur deja construit une fois par workflow.
- Utiliser l'image officielle Playwright correspondant exactement au paquet des
  tests. Deriver sa version du manifeste existant via un output de job GitHub,
  sans seconde version a mettre a jour ni Dockerfile maison.
- Generer un lockfile npm pour l'outillage navigateur, utiliser `npm ci` et le cache
  npm natif de setup-node. Un cache absent doit fonctionner ; pas de cache manuel
  de navigateurs ou de node_modules. Les dependances systeme sont dans l'image.
- Proposer les mises a jour navigateur par Dependabot cible sur ce manifeste.
  La PR met a jour paquet et lockfile ; l'image suit la version du paquet. Garder
  les tests et preuves visuelles avant fusion, sans auto-merge des mises a jour.
- Declarer une version Node 24 exacte dans un fichier standard commun au local,
  a la CI et a la publication. Conserver Node 26 comme exception explicite de
  compatibilite. Ne pas modifier automatiquement le Node global de l'utilisateur.

## Execution et preuves

Deux changements separables : optimisation CI deja demandee ; simplification de
l'autorite apres approbation de ce choix. Le second coordonne workflows, promotion,
doctrine miroir, tests et protections live. Preparer les changements versionnes
et verifier leurs consequences avant la bascule supervisee des protections ; ne
laisser ni check requis orphelin ni passage automatique sans revue. La suppression
ou rotation de credentials reste hors scope et n'est pas requise pour cette etape.

TDD strict pour toute logique d'admission ou de derivation ajoutee. Pour la config,
adapter les tests de contrat existants puis verifier le vrai workflow GitHub :
installation verrouillee, versions concordantes, suite navigateur et artefacts
visuels, cache froid puis chaud, checks du merge group. Conserver toute couverture
existante ; ne pas transformer un echec en succes par des reruns sans correction.

Mesurer separement preparation et tests, ainsi que le temps total de workflow.
Aucun gain annonce avant ces mesures. Fin attendue : une seule revue par candidat
sans correction, aucune preparation navigateur par apt a chaque run, mise a jour
Playwright sans desynchronisation et version Node primaire identique.

## Sources officielles

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://playwright.dev/docs/docker
- https://playwright.dev/docs/ci
- https://github.com/actions/setup-node/blob/v6/README.md
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability

## Auto-relecture

Portee bornee a la revue et au cout de preparation CI. Risque d'autorite explicite,
pas de gain presente comme acquis, pas de suppression de tests ou de publication
incluse. Cette proposition ne change aucune protection active avant approbation.
