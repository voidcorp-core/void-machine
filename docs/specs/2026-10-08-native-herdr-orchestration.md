---
title: Orchestration native Herdr et continuité par fichiers
date: 2026-10-08
status: in-design
author: Folpe + Codex
ticket: DEV-1016
related:
  - 2026-09-28-supervised-agent-delegation.md
  - ../NATIVE-SUPERVISION.md
  - ../decisions-log/2026-10-08-native-herdr-file-missions--673f19ca-e968-4cd0-ac3d-bd2d6f5798a3.md
---

# DEV-1016 : orchestration native Herdr

## Résultat et périmètre

Un ORCH interchangeable choisit le travail via les skills existants, délègue les
analyses courtes au runtime natif et les implémentations longues à Herdr, puis
consolide des rapports sur disque. Après interruption, il retrouve les mêmes
workers et leurs worktrees sans reconstruire l'état depuis un écran.

Le ticket Linear porte l'avancement :
https://linear.app/voidcorp/issue/DEV-1016/orchestration-multi-agents-native-herdr-sans-dependance-a-void-cockpit

À la demande de Florent, DEV-1017 suit DEV-1016 : remplacement des vues cockpit,
mise à jour Herdr, migration des hooks personnels, puis retrait du plugin. Linear
porte la relation de blocage. La présente tranche ne désinstalle pas cockpit.

Cette proposition remplace le transport de délégation, pas les exigences de
qualité, les permissions, les règles de merge ou les gates humains. Elle n'ajoute
ni démon, ni seconde file de tickets, ni liste blanche de projets. Lire un projet
voisin reste possible selon les permissions du runtime ; le ciblage exact d'un
pane protège contre une mauvaise attribution, sans créer un cloisonnement.

## État observé le 8 octobre

Base : develop à bc1722cb1dc5cf3487b26804b9117b966620eea2, références distantes
actualisées. Branche de travail : folpe/dev-1016-native-herdr. Le checkout principal
reste sur docs/2026-10-01-strategic-audits et conserve ses documents.

- Herdr client/serveur 0.9.0, protocole 22, compatibles ; Claude Code 2.1.294 ;
  Codex CLI 0.161.0. Intégrations Herdr déclarées courantes : Claude v9, Codex v8.
- `herdr agent` expose start/prompt/wait ; les arguments après `--` sont transmis
  tels quels. Les aides locales exposent `--add-dir` et Codex `--no-daemon`.
- Le contexte hérité de cette session désigne w9/Cortex ; `pane get wA:p2` confirme
  ORCH dans void-machine. Aucun contrôle ne doit se fier uniquement à cet héritage.
- develop impose `agents dispatch` aux spécialistes dans le skill implement et
  capture l'outil Agent sous multiplexeur. Son adaptateur Codex utilise le démon
  partagé. Aucun appel exécutable à cockpit n'a été trouvé dans les skills/modules
  core, le hook-runner et les deux documents d'agents par la recherche ciblée.
- Le doctor du checkout principal rapporte un artefact self-host sain. Cela ne
  certifie pas les nouveaux comportements. Le lanceur global pointe vers l'ancien
  répertoire void-harness et échoue ; il n'a pas été réparé dans cette préparation.

La documentation Herdr 0.9.0 distingue détachement et redémarrage : un redémarrage
perd les processus, restaure le layout, puis reprend les agents admissibles après
attachement d'un client. Il exige une référence de session officielle valide.
Il ne promet pas de préserver les options supplémentaires du lancement initial.

## Propriétaires et délégation

| Élément | Propriétaire | Responsabilité |
| --- | --- | --- |
| Travail à faire | Linear | Statut du ticket, blocages, PR |
| Mission | ORCH | Participants, mandat, état consolidé, décisions de reprise |
| Brief | ORCH | Ticket, critères, fichiers possédés, chemins, limites |
| Rapport | Worker concerné | Résultat, commits, tests, risques, questions |
| Processus et terminal | Herdr et runtime | Lancement, état vivant, session, reprise |
| Acceptation | Harnais existant | Preuves, revue indépendante, critères, vérification |
| Affichage | Métadonnées Herdr | Projection reconstructible, jamais une autorité |

Un worker long possède un ticket, une branche et une worktree durable. Réutiliser
celles du ticket avant de créer. Les empreintes qui se chevauchent sont séquentielles ;
lockfiles et migrations restent séquentiels. Quatre workers maximum, ou moins si le
programme le demande. Les sous-agents courts restent natifs, sans capture vers un
pane ; les spécialistes reçoivent leurs enveloppes et restent en lecture seule.

Le skill d'orchestration possède uniquement dispatch, collecte et reprise. Il
compose brainstorm, plan, implement et autopilot sans répéter leurs règles. Son
verbe est `orchestrate`, avec le préfixe obligatoire des skills livrés. La source
est versionnée dans core, puis distribuée par les mécanismes existants. La copie
personnelle commune sous ~/.agents/skills suit cette source ; aucune édition
manuelle indépendante de deux copies et aucun nouveau gestionnaire de skills.

## Contrat central, schéma 1

Racine : `~/.local/state/orchestra/<project>/<mission>/`, hors Git et hors worktree.
`project` est un identifiant stable associé au répertoire Git commun canonique ;
les homonymes de dépôts ne doivent pas partager une mission. `mission` est unique.

```text
mission.md
workers/WORK-1/brief.md
workers/WORK-1/report.md
workers/WORK-2/brief.md
workers/WORK-2/report.md
```

Chaque document commence par un frontmatter YAML délimité, schéma strict et borné.
Un format inconnu, illisible, partiel ou ambigu bloque son usage ; il ne vaut ni
absence de mission ni réussite. Taille maximale : 64 Kio pour mission/rapport,
256 Kio pour un brief, quatre workers simultanés. Horodatages UTC ISO 8601.
Les lectures refusent les chemins sortant de la mission attendue et les liens
symboliques redirigeant un fichier d'état. Écriture atomique par remplacement
local ; un seul auteur par fichier. Ne pas réécrire les fichiers d'un autre rôle.

`mission.md` contient `schema: 1`, `mission`, `project`, `status`, `updated_at`,
`repository`, `coordinator` et `workers`. `status` vaut planned/running/blocked/done/
failed. `coordinator` conserve le label, la worktree et le serveur/workspace
vérifiés. Chaque worker conserve label, pane_id, agent, worktree, branch, ticket,
status et attempt. `pane_id` peut être absent avant création et doit être revérifié
après restauration. La référence native de session, optionnelle, sert uniquement
à reprendre une conversation, jamais à sélectionner le propriétaire d'un pane.

`report.md` contient `schema: 1`, `mission`, `attempt`, `status`, `worker`, `branch`,
`commits`, `tests`, `updated_at`. `status` vaut running/blocked/done/failed ; `tests`
vaut passed/failed/not_run. Le corps liste les commandes réellement exécutées,
leurs résultats et preuves, les risques, questions et travail restant. Une relance
de tour possède un nouvel attempt dans le brief ; un simple resume conserve le
même. Un rapport d'un autre attempt ou d'une autre mission n'est pas accepté.

Le brief donne tous les chemins absolus, la base exacte, l'empreinte des fichiers,
les critères et les limites du mandat. Il précise que d'autres agents travaillent
sur le dépôt et interdit d'annuler leurs changements. Aucun secret dans ces fichiers.

## Lancement et reprise

Tous les détails propres aux agents vivent dans une table kind/options : lancement,
resume, accès au dossier de mission, permissions de rôle. Pour Codex, tout lancement
et resume dans Herdr comprend `--no-daemon`. Codex et Claude reçoivent `--add-dir`
vers le dossier de mission autorisé. Les options n'élargissent pas les permissions
au-delà du mandat. Un kind sans recette vérifiée est signalé comme non pris en charge.

1. Lire mission, brief, rapports et état Git. Vérifier le serveur/workspace ; apparier
   label et worktree canonique. Une correspondance multiple ou contradictoire refuse
   l'action ; une variable d'environnement seule ne décide pas.
2. Enregistrer le worker prévu avant lancement. Créer sa surface, conserver l'ID
   renvoyé, puis démarrer l'agent. Après accusé ambigu, rechercher le même worker ;
   jamais relancer à l'aveugle ni prendre un pane déjà occupé.
3. Soumettre le brief une fois. Une erreur de prompt ou un délai expiré ne prouve
   pas que le prompt n'a pas été reçu. Réconcilier avant une nouvelle soumission.
4. Attendre par tranches bornées via `herdr agent wait`, puis lire le rapport.
   idle/done signifie fin de tour. Rapport absent ou incomplet : demander au même
   agent de le produire. blocked : traiter la question de mandat, et transmettre
   à l'humain toute décision ou permission qui lui appartient.
5. Vérifier commits, tests et critères avant consolidation. Fermer seulement les
   panes possédés après collecte et acceptation ; conserver worktree et preuves.
6. Après /clear, relire ce même dossier. Après kill du worker, reprendre sa session
   dans sa worktree avec son brief. Si la session est introuvable, conserver la
   mission et signaler la perte avant toute nouvelle session ; pas de doublon.

Le chemin de découverte après /clear est injecté par la continuité du harnais et
reste reconstructible depuis le dépôt canonique et les missions non terminales du
projet. Une seule mission compatible se reprend ; plusieurs sont exposées à ORCH
sans sélection arbitraire. Aucun pointeur mutable dans le programme versionné.

Un alias shell pour Codex n'est pas une preuve suffisante : le lancement explicite
et le resume automatique de Herdr doivent être observés. Si Herdr perd une option
indispensable au redémarrage, le critère reste bloqué par la capacité amont ; ne pas
le masquer avec un démon maison ou une reprise déclarée réussie sans observation.

## Hooks et affichage

Les hooks existants publient, de façon bornée, des tokens vers `pane report-metadata`
et `workspace report-metadata` : mission, ticket, rôle, statut et contexte lorsqu'une
mesure réelle est disponible. Source distincte des tokens d'identité gérés par Herdr.
Aucun remplacement de `report-agent-session`, aucun calcul inventé de pourcentage.
Une cible non vérifiée n'est pas modifiée ; l'erreur de projection est visible et
ne détruit ni rapport ni progression. Les tokens expirent ou sont retirés à clôture.

Le garde personnel cockpit codex-session reste hors des assets du harnais jusqu'à
la correction amont prévue au ticket. La migration n'écrase pas ce garde ni les
intégrations Herdr. Les commandes projet vivent dans package.json/justfile/mise.

## Migration et conservation des preuves

Remplacer la capture obligatoire et les appels imposés au transport du noyau dans
les skills, les consignes sœurs et NATIVE-SUPERVISION. Ne pas ajouter un troisième
orchestrateur au-dessus de deux anciens. Retirer le code devenu sans appelant et
ses preuves redondantes ; conserver les journaux existants lisibles et les runs en
cours jusqu'à leur clôture. Les contrats du contrôleur de mission sont réutilisés.

Une revue native reste indépendante et porte commit, base, critères, conclusions,
preuves et provenance réelles. L'admission doit vérifier ce sujet exact et produire
le reçu consommé par les juges existants. Un report.md ou une métadonnée Herdr ne
peut remplacer ce reçu, désarmer un bloqueur ni déclencher un merge. Le changement
de transport ne modifie pas consentement, CI, chemins protégés ou promotion humaine.
Les cinq ADR nommées par l'ADR proposée sont remplacées seulement sur ce périmètre.

## Vérification attendue et ordre de livraison

1. **Capacités avant code** : preuve de lancement avec arguments, puis de restauration
   avec no-daemon, accès central, bonnes identités et hooks actifs. Redémarrage testé
   en environnement d'essai dédié ; ne pas arrêter le serveur de travail ni ses panes.
2. **Contrats en TDD strict** : schémas, écritures concurrentes par propriétaires,
   reprise, rapport périmé/étranger, accusé perdu, identité ambiguë, option manquante,
   absence de session, transport indisponible et refus de permission.
3. **Skill et migration des appelants** : tests de comportement des skills et des
   invariants supprimés/remplacés, dérivation des assets, sources et audit d'adaptation.
4. **Hooks en TDD strict** : destinataire vérifié, tokens bornés, contexte inconnu,
   expiration, échec de projection, aucun appel à cockpit dans les assets actifs.
5. **Preuves réelles** : deux workers dans deux worktrees de void-cortex, rapports
   distincts et consolidation ; /clear ORCH sans doublon ; kill/resume worker ;
   redémarrage Herdr ; Claude ORCH/Codex worker puis configuration inverse.
6. **Acceptation** : revue indépendante du commit, vérifications du dépôt applicables,
   aucune régression des garanties de merge, PR et suivi Linear. Pas de Done avant
   merge et vérification finale. Pas de publication implicite.

À cette préparation, seuls les contrôles documentaires et de lecture ci-dessus ont
été réalisés. Aucun scénario réel de lancement, /clear, kill/resume ou redémarrage
n'est encore prouvé. La spécification reste in-design ; aucune implémentation livrée.

## Sources et auto-relecture

- Herdr 0.9.0, [automation](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx)
  et [restauration](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/session-state.mdx).
- Aides locales : `herdr agent`, `herdr worktree`, `herdr pane`, `herdr workspace`,
  `codex --help`, `claude --help`, versions et `herdr integration status`.
- Incidents : void-cockpit/docs/2026-10-07-agent-isolation.md et
  void-cockpit/docs/2026-10-08-session-rattachement.md, lus sans modification.
- Baseline : skill implement, skill autopilot, delegation-capture.ts, adaptateur
  de présentation Herdr et ADR citées, sur develop bc1722cb.

Auto-relecture : les neuf points du périmètre et les sept critères Linear ont une
responsabilité et une preuve nommées. Les faits observés sont séparés des capacités
à éprouver ; aucune reprise, permission, identité, revue ni réussite n'est déduite
d'un écran ou d'un simple statut. Le passage à un transport natif demande validation
de cette proposition avant écriture du code.
