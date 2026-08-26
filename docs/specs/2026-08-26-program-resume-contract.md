---
title: Un contrat de programme durable, un checkpoint de session et une seule reprise
date: 2026-08-26
status: approved
author: Folpe + Codex
ticket:
related:
  - docs/plans/2026-08-26-decision-log-audit.md
  - docs/decisions-log/2026-07-24-active-program-pointer-linear-owned-progress--4f0cad51-1167-4b04-9d5d-a9c1c1605d26.md
  - docs/decisions-log/2026-07-24-consumer-active-program-tracker-continuity--4152e915-f0f8-4763-888e-2bddd66da5a3.md
  - docs/decisions-log/2026-07-29-session-handoff-routes-state-records-residue--b93f13a9-3877-480d-a722-39476f93d84d.md
---

# Un contrat de programme durable, un checkpoint de session et une seule reprise

## Résumé

Le dépôt porte aujourd'hui deux notions utiles mais mal raccordées : `.void/active.md` décrit le
programme global et `.void/machine/checkpoint.md` décrit la fin de la dernière session. Le premier
nom laisse croire qu'il contient le travail actif, alors qu'il sert surtout de contrat de routage ;
son schéma impose Linear. Le second contient le bon résidu de session, mais sa création dépend d'un
geste facile à oublier. `resume` lit les deux sans produire un contrat de reprise réutilisable par
les runtimes.

La cible conserve deux propriétaires et crée une seule surface de lecture :

```text
.void/program.md                  état et contexte global, versionné
           +
.void/machine/checkpoint.md       résidu de la dernière session, local et remplacé
           +
Git                               branche, HEAD et fichiers modifiés
           |
           v
ResumeBundle                      une réponse bornée, hors ligne et agnostique
           |
           +--> void-harness resume
           +--> SessionStart Codex
           +--> SessionStart Claude Code
```

Le checkpoint n'est jamais synthétisé après la disparition du modèle. Un hook détecte seulement
une intention explicite de clôture et rappelle au modèle d'invoquer `void-checkpoint`. Le hook de
fin de session audite la présence et la fraîcheur, sans inventer de décision, de dead end ou de
prochaine action.

## Problèmes observés

1. **Le nom `active` décrit mal le contenu.** Le fichier contient le programme, ses sources, sa
   source de progression et le consentement autopilot. Il ne contient volontairement ni ticket
   courant ni prochaine action.
2. **Le contrat est couplé à Linear.** Le type n'accepte que `provider: linear`, le vocabulaire
   expose `issues` et le parseur refuse tout autre fournisseur avant même qu'une exécution soit
   demandée.
3. **La reprise n'a pas de propriétaire unique.** Le CLI compose partiellement checkpoint, Git,
   décisions et signal de programme ; les hooks de démarrage ne consomment pas ce résultat.
4. **La fermeture repose sur la mémoire humaine.** La mécanique de `void-checkpoint` est correcte,
   mais aucune intention explicite de fin de journée ou d'interruption ne la rejoue.
5. **Les changements de chemin polluent les ADR.** Le contrôle confond immutabilité sémantique et
   identité exacte des octets, ce qui pousse à créer une nouvelle décision pour corriger une
   référence devenue fausse.

## Invariants

- Il reste deux fichiers parce qu'ils ont deux durées de vie et deux propriétaires. Les réunir
  commettrait un état machine éphémère ou rendrait local le contexte partagé du programme.
- Il n'existe qu'une surface de lecture : `ResumeBundle`. Le CLI et les deux runtimes rendent la
  même composition.
- `.void/program.md` ne stocke jamais le ticket courant, la prochaine action ni un compteur de
  progression maintenu à la main.
- Le noyau comprend les rôles sémantiques d'une source de progression, jamais l'API ou le modèle
  d'état de Linear.
- Lire le programme, composer la reprise et démarrer une session ne nécessite ni réseau, ni compte,
  ni tracker disponible.
- Un fournisseur indisponible n'efface pas le programme ou le checkpoint. Il bloque seulement
  l'action qui exige ce fournisseur.
- `autopilot.enabled` reste un consentement explicite. Un bloc absent ou faux interdit la sélection
  autonome.
- Aucun hook de fin de session n'appelle un second modèle et aucun hook n'écrit un checkpoint
  sémantique.
- Une compaction ou une fermeture ne marque jamais une unité de travail terminée.
- Une migration de référence dans un ADR accepté ne peut modifier ni frontmatter, ni décision, ni
  justification, ni portée, ni conséquences.
- Les anciens chemins ne restent que dans une table de compatibilité et ses fixtures. Toute
  documentation vivante nomme `.void/program.md`.

## Le fichier programme

Le chemin canonique devient `.void/program.md`. `program` nomme ce que le fichier contient et reste
vrai que le programme soit en exécution ou terminé.

Le contrat racine est volontairement petit :

```yaml
---
schemaVersion: 1
status: executing
program: knowledge-and-resume
plan: docs/plans/2026-08-17-knowledge-and-resume-plan.md
spec: docs/specs/2026-08-17-project-knowledge-system.md
progress:
  provider: linear
  scope: voidcorp/DEV/void harness
  order: [DEV-614, DEV-616, DEV-620]
  states:
    ready: [Backlog, Todo]
    started: [In Progress]
    review: [In Review]
    done: [Done, Canceled]
humanGates: [DEV-620, DEV-623]
autopilot:
  schemaVersion: 1
  enabled: false
  mergeGate: human
---
```

Champs du noyau :

- `schemaVersion`, `status`, `program`, `plan` et `spec` sont requis ;
- `status` conserve les deux valeurs `executing` et `completed` ; seul `executing` active un
  bootstrap de travail ;
- `plan` et `spec` sont des chemins confinés au dépôt ;
- `progress` est facultatif ; le programme reste lisible sans tracker ;
- `progress.provider` est un identifiant de capacité non vide, pas une union fermée dans le noyau ;
- `scope` est opaque au noyau ;
- `order` et `states` utilisent des rôles génériques. L'adaptateur du fournisseur valide et traduit
  les valeurs natives lorsqu'une action de progression est demandée ;
- `humanGates` reste une liste d'identifiants opaques ;
- `autopilot` conserve son contrat de consentement. Un autopilot activé exige une source de
  progression dont l'adaptateur annonce les capacités de lecture, claim, relations et écriture.

Le corps Markdown explique le contexte global et les sources de vérité. Il peut évoluer lorsque le
programme change réellement de phase, mais ne devient pas un journal. Les détails de progression
restent chez le fournisseur déclaré ; `ResumeBundle` expose où les relire sans en maintenir une
copie.

### Compatibilité de chemin

Les lecteurs cherchent dans cet ordre :

1. `.void/program.md` ;
2. `.void/active.md` ;
3. `plans/ACTIVE.md`.

La présence de plusieurs fichiers est une erreur explicite, pas une priorité silencieuse. Un ancien
chemin seul reste lisible pendant la fenêtre de compatibilité et `doctor` donne la commande de
migration exacte. Les templates, messages, docs et nouvelles écritures n'utilisent que le chemin
canonique. Le dépôt void-harness migre son propre fichier dans la livraison.

## Le checkpoint de session

`.void/machine/checkpoint.md` reste local, gitignoré, remplacé à chaque fermeture et lu de façon
tolérante. Son sujet reste ce qu'aucun autre artefact ne porte : dead ends, hypothèses non vérifiées,
fraîcheur des preuves, boucles ouvertes et une prochaine action exacte.

Le frontmatter ajoute le HEAD observé :

```yaml
---
date: 2026-08-26
branch: folpe/program-resume
head: a1b2c3d
---
```

`branch` et `head` permettent à la reprise de signaler qu'un checkpoint décrit un autre arbre. Ils
ne remplacent pas la preuve détaillée de la section `State`.

La skill ne dépend plus de la disponibilité d'un tracker. Elle route d'abord les faits vers la
source de progression déclarée lorsqu'elle est accessible, mais écrit quand même le résidu local
hors ligne. Une fermeture de session ne change jamais le statut d'une unité.

## ResumeBundle, l'unique surface de lecture

Le domaine `session` produit un contrat stable :

```ts
interface ResumeBundle {
  readonly schemaVersion: 1;
  readonly project: { readonly name: string; readonly path: string };
  readonly program?: ProgramSummary;
  readonly checkpoint?: Checkpoint;
  readonly git: {
    readonly branch?: string;
    readonly head?: string;
    readonly dirtyFiles: number;
  };
  readonly gaps: readonly ResumeGap[];
}
```

`ProgramSummary` contient le statut, le nom, les sources plan/spec et le localisateur de progression,
jamais un état distant mis en cache. Les gaps couvrent au minimum : programme invalide ou absent,
checkpoint absent, vide ou ancien, branche différente, HEAD déplacé et source de progression non
résolue lorsqu'une action la demande.

`void-harness resume` offre trois rendus d'un même bundle :

- `human`, sortie terminal lisible ;
- `json`, contrat d'intégration ;
- `context`, texte borné destiné au contexte développeur d'un runtime.

Le rendu `context` ne dépasse pas le budget du hook et n'inclut ni historique de décisions, ni
sortie de tracker, ni contenu de diff. S'il n'existe ni programme ni checkpoint utile, il reste
silencieux plutôt que d'ajouter du bruit à chaque session.

## Hooks de cycle de vie

### Démarrage

`SessionStart` exécute le rendu `context` pour `startup`, `resume`, `clear` et `compact`. Codex ajoute
le stdout texte au contexte développeur ; Claude Code reçoit le même contenu par
`hookSpecificOutput.additionalContext`. L'appel est local, borné, sans tracker et ne bloque pas le
démarrage si aucun programme n'existe.

Après une compaction Codex, le même hook rejoue le programme et le dernier checkpoint avant la
continuation immédiate. Il ne tente pas de reconstruire ce qui n'avait jamais été checkpointé.

### Intention explicite de fermeture

`UserPromptSubmit` inspecte uniquement le prompt courant. Il ajoute un rappel `void-checkpoint`
lorsque le texte exprime sans ambiguïté la clôture de la session : fin de journée, reprise demain,
interruption volontaire, demande explicite de checkpoint ou formulation autonome « on s'arrête
ici » / « stop here ».

Les motifs sont testés contre des négatifs tels que « arrête le serveur », « stop the process »,
« termine la boucle » ou une occurrence de `checkpoint` dans du code. Le hook conseille ; il ne
bloque pas le prompt et n'écrit rien.

Le contexte injecté demande au modèle de :

1. invoquer `void-checkpoint` avant sa réponse de clôture ;
2. router les faits durables vers leur propriétaire ;
3. montrer toute écriture partagée avant de l'effectuer ;
4. ne pas confondre fin de session et fin d'unité.

### Fin effective

`SessionEnd` ne peut plus demander un jugement au modèle. Codex ne fournit actuellement que la
raison `other` et les deux runtimes traitent ce hook comme une commande de fin sans pouvoir rouvrir
la conversation. Le hook fait donc un audit best-effort : checkpoint présent, daté récemment,
branche cohérente et HEAD non dépassé. Il rend un diagnostic advisory dans les logs du hook et ne
crée aucun troisième fichier d'état. Il ne prétend pas prouver qu'un checkpoint a été écrit pendant
cette session lorsque le runtime ne fournit pas de borne de début portable.

La session suivante refait la même vérification via `ResumeBundle`. Cette redondance est voulue :
le diagnostic de fin peut ne jamais être lu, alors que le diagnostic de reprise arrive au modèle
qui doit agir.

Limite explicite : une commande runtime de type `/clear` peut contourner `UserPromptSubmit`. Aucun
hook pré-clear portable n'est documenté aujourd'hui. La doctrine continue donc d'exiger
`void-checkpoint` avant un clear volontaire ; `SessionEnd` et le prochain `SessionStart` rendent
l'oubli visible mais ne prétendent pas récupérer le contexte perdu.

Sources officielles consultées pour le contrat :

- https://learn.chatgpt.com/docs/hooks
- https://code.claude.com/docs/en/hooks

## Politique ADR et simplification du journal

La règle validée est :

> Un ADR accepté est immuable dans son contenu décisionnel. Une migration mécanique peut toutefois
> corriger en place des références devenues obsolètes à la suite d'un renommage ou déplacement, à
> condition de ne modifier ni le choix, ni sa justification, ni sa portée, ni ses conséquences.
> Toute évolution sémantique exige une supersession.

Aucun ADR supplémentaire n'est créé pour cette clarification, conformément à la demande humaine.
Elle est portée par cette spec, l'audit, la doctrine, `void-decide` et le contrôle exécutable.

Le contrôle d'immutabilité compare l'ADR accepté à sa version de base :

- suppression et renommage restent interdits ;
- frontmatter, titres, paragraphes et structure doivent rester identiques ;
- seules les destinations de liens locaux et les références de chemin locales délimitées peuvent
  différer ;
- chaque nouvelle cible doit être confinée au dépôt et exister ;
- toute différence non reconnue échoue fermé avec l'instruction de superséder.

La projection dérive aussi l'état effectif : une cible de `supersedes` est affichée comme remplacée,
avec les identifiants qui la remplacent, même si son statut stocké reste l'état historique. Le
fichier source n'est pas modifié pour simuler que le futur était connu au moment de la décision.

L'audit du 2026-08-26 est disposé ainsi :

- l'ADR proposé de handoff est amendé et accepté ; il supersède les deux ADR de programme ;
- l'ADR proposé de compilation des spécialistes passe à `superseded`, puisqu'un ADR accepté le
  cible déjà ;
- les trois propositions dont le contrat est implémenté passent à `accepted` après approbation de
  cette spec ;
- 24 occurrences de chemins à équivalent certain sont migrées ;
- les noms de systèmes réellement retirés restent historiques.

## Migration de toutes les références programme

La livraison remplace les références vivantes à `.void/active.md` et `plans/ACTIVE.md` dans :

- `AGENTS.md` et `CLAUDE.md`, toujours dans le même commit ;
- modules runtime et documents générés depuis ces modules ;
- parser, vues projet, resume, doctor et autopilot ;
- skills, architecture, specs, plans, tests et fixtures ;
- ADR, uniquement selon la règle de migration mécanique.

Les anciens chemins ne subsistent que dans le tableau de compatibilité central et les tests qui
prouvent sa lecture. Un `git grep` final rend cette exception vérifiable.

Les symboles suivent le contenu : `ActiveProgram` devient `ProgramDescriptor`,
`activeProgramPath` devient `programPath`, et les libellés utilisateur parlent de programme ou de
progression. Le terme `active` peut rester dans un état métier générique, mais plus comme nom du
fichier ou du contrat.

## Correctif lint boundary sur la même branche

Le faux positif Biome reste une unité séparée et des commits séparés. Le correctif ne pollue pas le
`biome.json` racine avec une exclusion redondante.

Le test de régression prouve d'abord qu'une configuration racine qui étend une base excluant
`.claude/**` est actuellement signalée à tort. L'implémentation lit ensuite la configuration
effective : chaîne `extends`, portée positive de `files.includes` et exclusions. Le doctor ne
conclut `missing` que si `.claude` peut réellement entrer dans la portée lint. La résolution suit
les règles de la version Biome installée et reste fondée sur sa documentation officielle :

- https://biomejs.dev/guides/big-projects/
- https://biomejs.dev/reference/configuration/

Le commit RED du test précède le commit de correction, conformément à `void-debug`. Les deux restent
distincts des commits programme/reprise.

## Compatibilité et échecs

- Programme absent : `resume` fonctionne avec Git et checkpoint ; le hook reste silencieux si rien
  d'utile n'existe.
- Programme invalide : sortie explicite avec cause et correction ; aucun fallback silencieux vers
  un deuxième fichier.
- Deux chemins programme présents : erreur d'ambiguïté et commande de résolution.
- Fournisseur inconnu : programme lisible, progression marquée non résolue ; exécution automatique
  refusée sans adaptateur.
- Tracker hors ligne : reprise locale disponible ; claim, sélection ou mise à jour distants
  s'arrêtent au point qui les exige.
- Checkpoint absent ou ancien : jamais caché, jamais inventé ; gap explicite.
- Hook en erreur : aucune donnée de projet n'est modifiée et le démarrage interactif reste possible.
- ADR modifié hors référence : `decisions check` échoue comme aujourd'hui.

## Vérification attendue

### Contrats et TDD

- Tests stricts du parseur `ProgramDescriptor`, y compris fournisseur inconnu, bloc progression
  absent, consentement autopilot et chemins confinés.
- Tests de migration : chemin canonique, chaque ancien chemin seul, plusieurs chemins en conflit.
- Tests purs de `ResumeBundle` : checkpoint absent/vide/ancien, branche et HEAD déplacés, programme
  facultatif, rendu context borné.
- Fixtures de hooks Codex et Claude Code prouvant une injection identique au démarrage.
- Corpus positif et négatif d'intentions de fermeture.
- Test prouvant qu'aucun hook de fin n'écrit `checkpoint.md`.
- Tests RED puis GREEN du faux positif Biome avec `extends`.
- Tests de l'immutabilité ADR : référence autorisée, prose/frontmatter/titre/suppression/renommage
  refusés, cible hors dépôt ou absente refusée.
- Test de projection montrant la cible et son remplaçant sans modifier le statut stocké.

### Preuves de dépôt

```sh
pnpm test
pnpm sync:docs
pnpm derive:check
DECISIONS_BASE=origin/develop pnpm decisions:check
pnpm skills:check-references
node packages/cli/bin/void-harness.mjs self-host doctor
git grep -n '.void/active.md\|plans/ACTIVE.md'
```

Le dernier grep ne doit retourner que les constantes et fixtures de compatibilité explicitement
allowlistées. La vérification finale observe aussi `void-harness resume` dans un dépôt sans tracker
et les hooks compilés des deux runtimes.

## Hors périmètre

- Télécharger ou interroger un tracker pendant `SessionStart`.
- Stocker un résumé de progression distant dans `.void/program.md`.
- Générer un checkpoint avec un appel LLM de fond.
- Faire de `SessionEnd` une autorité de statut ou de complétion.
- Fusionner ou supprimer en masse les 96 décisions legacy.
- Corriger les noms historiques qui désignent réellement un système retiré.
- Ajouter une interface graphique à `resume` avant que la reprise terminale ait prouvé sa valeur.

## Décision demandée

L'architecture générale et la règle de migration de références ont été validées oralement le
2026-08-26. Cette spec rend leurs contrats, limites, dispositions ADR et preuves explicites. Son
approbation autorise l'implémentation et la disposition des cinq ADR proposés décrite ci-dessus ;
elle n'autorise ni merge, ni publication, ni mise à jour de version.
