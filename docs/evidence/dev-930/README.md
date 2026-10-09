# DEV-930: preuves préliminaires du 9 octobre 2026

**La publication et la DoD restent BLOCKED.** Ce dossier établit des observations
locales sur `8fee97c9ba8ab7ad17c24a45204dd849f54acf24`, avant les merges DEV-916/917.
Le pack porte encore **4.0.0**. Ce n'est ni le candidat final ni une certification
`voidmachine@4.1.0` publiée. Aucune version n'a été modifiée.
La première phase locale est terminée; les deux essais privés ont ensuite été
autorisés explicitement. Le premier est bloqué avant PR par un défaut reproduit
d'admission des identifiants natifs; voir le rapport dédié et `remote.log`.

Ticket complet et relations relus par MCP Linear le 9 octobre, statut In Progress.
Références : [Step 10 du plan](../../plans/2026-09-28-release-4-1-delegation-and-autonomous-merge-plan.md),
[spec délégation](../../specs/2026-09-28-supervised-agent-delegation.md),
[spec merge](../../specs/2026-09-28-autopilot-merge-without-consumer-setup.md).
Le transport actuel suit [Native supervision](../../NATIVE-SUPERVISION.md) :
workers Herdr terminaux `codex --no-daemon`; anciens runs daemon dans une cellule distincte.

## Matrice d'acceptation

PASS signifie uniquement que l'observation nommée a réussi sur cette base.
BLOCKED indique une dépendance ou une autorisation manquante; NON MESURÉ indique
une expérience non exécutée. Les simulations sont nommées comme telles.

| Observation | Statut | Preuve et limite |
|---|---|---|
| Pack issu du SHA annoncé | PASS préliminaire | [build.log](build.log), [artifact.json](artifact.json); checkout isolé propre après pack |
| Versions alignées | PASS préliminaire | `pnpm version:check`: 12 fichiers à 4.0.0 |
| Installation du tarball, init both | PASS local | Installation npm offline, scripts désactivés, puis CLI du pack; [consumer.log](consumer.log) |
| Commit, clone et réhydratation | PASS local | Commit consommateur `dac473b86e2b6907318e7392c314cd4a22a2435b`; 136 fichiers restaurés et vérifiés par hash; clone propre |
| Doctor après init et après hydrate | PASS avec réserve explicite | `no blocker; 1 advisory`; spécialistes Codex: le sandbox parent peut affaiblir read-only |
| Doctor avant hydrate | PASS du contrôle négatif | **Exit 1, 11 checks failed, 1 advisory**; fichiers dérivés absents, dont compétences et manifeste divergent. Pas un état consommateur sain |
| Conformité install | PASS local | Claude, Codex, both; init/re-init/update/récupération du reçu; résolution npm du nom du package |
| Conformité hooks | PASS local macOS | Claude, Codex, both; manifeste Codex depuis racine et sous-dossier via sh, sh login, bash, zsh |
| Conformité autopilot | PASS surface hors réseau | CLI/skills installés et calcul sur entrées synthétiques; **aucun merge GitHub prouvé** |
| Retenue humaine persistée | PASS local | Commande du pack `autopilot merges --by-human`; JSON `schemaVersion:1`, `mergedBy:human` conservé |
| Retenue arrêtant une PR prête | BLOCKED | Même défaut de revue; aucune PR encore créée, état local de retenue et tests déjà prouvés |
| Ticket mergé en intégration sans App/protection | BLOCKED | Dépôt privé autorisé, main/develop poussées; mission bloquée par le refus des vrais contextId natifs; aucun merge |
| Worker terminal visible Herdr | PASS observation partielle | WORK-3 identifié par label + worktree, session `01a1202c-90e6-7b11-98b7-813fc5882069`, processus `codex --no-daemon`; [runtime.log](runtime.log) |
| Délégation consommateur via artefact final sous Herdr | NON MESURÉ | Le worker observé est cette collecte, pas une délégation lancée depuis le tarball consommateur |
| Sous-agent natif sans multiplexeur | NON MESURÉ | Ni un test de CLI hors réseau, ni une observation Herdr ne prouvent cette cellule |
| Daemon Codex: versions | PASS lecture seule | CLI et app-server 0.162.0 alignés, daemon déjà running; aucun start/stop/restart/update |
| Daemon Codex: résultat structuré corrélé | NON MESURÉ | Aucun nouveau run; ne pas imposer ce transport au worker terminal |
| Windows/PowerShell | NON MESURÉ ici | Les preuves de ce dossier sont macOS uniquement |
| Pack final après DEV-916/917 | BLOCKED | Attendre leurs merges, enregistrer le SHA final puis reconstruire et réexécuter les preuves affectées |
| Promotion, release, provenance npm | BLOCKED, humain | Aucune promotion/publication; aucun update du dépôt principal avant publication |

Les sorties détaillées des trois conformités sont dans [conformance.log](conformance.log).
Les tests de retenue passent (6 tests), puis la table de décision complète passe
(141 tests). Le premier appel `test:fast` sélectionne seulement le fichier de
retenue; un second appel explicite sans filtre de projet couvre `loop.test.ts`.
Ces 147 tests utilisent des observations locales/synthétiques, pas une PR réelle.

Le contrôle négatif doctor a également été reproduit par un subprocess direct sur
un second clone frais : exit 1. Une première lecture orale attribuant exit 0 à
ce contrôle était erronée; les journaux conservés font foi. Aucun défaut doctor reproduit. **Un défaut produit de revue native a ensuite été
reproduit et bloque les deux essais privés**, décrit dans [NATIVE-CONTEXT-BLOCKER.md](NATIVE-CONTEXT-BLOCKER.md).

`doctor` sur la worktree du harnais via le wrapper local `void-machine` a répondu
`self-host not-installed` (reçu manquant). Cette observation n'est pas un doctor
consommateur PASS. Aucun init ni réparation n'a été exécuté dans le harnais réel.

## Provenance et reproduction

Les logs conservent date UTC, cwd, commande, sortie et résultat. `<USER_HOME>`
remplace le chemin personnel; aucun secret, configuration personnelle ou code
consommateur privé n'est joint. Le pack SHA-256 vaut
`e63f7aed59fed4e0fc9de369c4a431fff2bfd7c3f4137fba509ea1322dbe7320`.
Node 24.15.0, pnpm 10.34.5, macOS. Source de travail et artefacts locaux ignorés :
`.void/machine/dev930/` dans cette worktree. `run.py` capture les commandes;
`consumer-proof.mjs` contient l'enchaînement et utilise l'environnement isolé
fourni par `conformanceFixtureEnvironment` pour les écritures consommateur.

1. Clone source local sans hardlinks, checkout détaché du SHA ci-dessus.
2. `pnpm install --frozen-lockfile --ignore-scripts`. L'essai offline initial
   a refusé un tarball absent du store; l'installation suivante a réussi.
   Aucun `prepare`, aucune modification du lockfile ou de la config Git partagée.
3. `pnpm --filter ./packages/cli pack --pack-destination ../artifact`;
   vérifier le checkout propre et enregistrer SHA source, version et digest.
4. Copier le consommateur de sonde dev929, commit source
   `3ad30d88170bb46fbf40842d85818aa7bf8ade5d`, sans toucher à son origine.
   Cette sonde TypeScript est synthétique, pas un consommateur métier réel.
5. Installer le tarball dans un répertoire package isolé avec
   `npm install --offline --ignore-scripts --no-audit --no-fund <tarball>`.
   Depuis la copie consommateur, appeler son bin absolu :
   `init --runtime both --no-interactive`, `doctor --no-remote`, commit, clone,
   `doctor --no-remote`, `hydrate`, `doctor --no-remote`, `git status --short`.
6. Depuis la copie source, appeler `pnpm conformance:install --tarball <tarball>`,
   puis les scripts `conformance:hooks` et `conformance:autopilot` avec le même
   argument. Le manifeste adjacent est vérifié contre le SHA et les octets.
7. Dans le clone hydraté, `autopilot merges --by-human` puis lire
   `.void/machine/autopilot/merge-hold.json`. La retenue reste active dans ce clone.

Aucune modification de Cortex, aucun init --force, aucun global personnel changé.
Le store local produit par l'essai offline a été déplacé sous les preuves ignorées;
il ne fait pas partie du diff. L'empreinte Git partagée avant mission appartient
à ORCH et n'a pas été recréée.

## Preuves historiques examinées, non recyclées

[historical-index.json](historical-index.json) conserve les chemins expurgés et
hashes des deux journaux examinés. Le journal DEV-927 cite explicitement
`gh-shim-927` : son merge et sa retenue sont une **simulation locale**. Le journal
DEV-926 utilise Codex 0.155.1 et un processus app-server possédé; il ne prouve pas
le daemon 0.162.0 courant. Les faits du 29 septembre figurant dans la spec sont
historiques, non rejoués le 9 octobre. Rien de cela ne devient un PASS actuel.

La mission centrale `milestone-01-20261009` a été reconstruite **après** lancement
réel du cockpit. Son brief et sa session ont été relus; ce n'est pas une preuve
d'enregistrement avant lancement. Le serveur Herdr 0.9.0 et le client 0.9.3 ont
été observés sans restart/update. Ni reprise de session, ni `resume_argv`, ni
restauration après restart ne sont prétendues testées.

## Besoin distant minimal et suite concrète

Après les preuves locales, ORCH a relayé l'autorisation explicite de deux essais
privés avec nettoyage complet, puis créé
`voidcorp-core/void-machine-proof-dev930-20261009`. GitHub a confirmé `isPrivate:true`,
`isEmpty:true`, permission ADMIN avant initialisation. WORK-3 a poussé uniquement
un seed synthétique sur `main` et `develop` dans ce dépôt autorisé.
[remote.log](remote.log) conserve ces faits et la nouvelle empreinte PROOF-1,
sans remplacer l'empreinte DEV-930 de la mission principale.

Observé : `main` par défaut, `develop` non protégée, zéro ruleset (parents inclus),
zéro workflow. `GET .../installation` répond 401 car il exige un JWT App :
l'absence totale d'App installée est **inconnue**, pas démontrée. Aucun secret ou
App de revue n'a été configuré pour ce dépôt. Aucun merge n'est encore prouvé.
ORCH prend en charge les invocations natives et la suppression finale du dépôt.

Le dépôt de preuve peut être privé et ne contenir que des fichiers synthétiques.
Il faut une branche par défaut `main` distincte de l'intégration `develop`, sans
environnement de déploiement, sans App de revue, sans checks requis, protection,
ruleset hérité ou merge queue sur `develop`. Avant expérimentation, observer ces
propriétés via GitHub; absence de permission pour les lire = inconnu, pas absent.
L'identité opératrice doit pouvoir lire les propriétés, créer deux branches/PR et
merger dans `develop`, une fois cette exécution autorisée. Aucun token ni secret
ne doit être copié dans les preuves.

Après correction du défaut natif, réception des merges DEV-916/917 et nouvelle
preuve du pack final, ORCH pourra :

1. Figer le SHA final et reconstruire le pack sans changer manuellement la version.
2. Initialiser une copie locale synthétique; garder le programme/ticket prêts et
   les critères vérifiables. Installer le pack et refaire le cycle ci-dessus.
3. Pour une première unité, conserver invocation/reçu réels de revue native en
   contexte frais read-only, liés au head/base/critères; observer checks et base,
   puis utiliser la commande produit de merge exact-head vers `develop`.
4. Pour une seconde PR prête et revue, poser la retenue humaine avant le tick;
   observer `human-merge-gate`, PR toujours ouverte et aucun effet de merge.
5. Exécuter séparément délégation native sans multiplexeur, preuve Herdr depuis
   le consommateur, et éventuellement daemon legacy sans toucher aux sessions
   partagées. Conserver version, session réelle, schéma et résultat corrélé.
6. Présenter les preuves à Folpe pour promotion/release. Après publication seulement,
   vérifier provenance/version publiée puis update et doctor du dépôt principal.

Les deux essais privés ont leur autorisation explicite distincte; ce document
ne donne aucune autorisation de promotion ou de publication du harnais.

## Vérification void-verify

| Item | Résultat de cette collecte documentaire |
|---|---|
| 1 Typecheck | SKIP: aucun code modifié; build réel du pack passé |
| 2 Tests | Conformités install/hooks/autopilot PASS; tests locaux de retenue joints, distincts du réel distant |
| 3 Lint | SKIP: uniquement preuves textuelles/JSON; contrôle whitespace et JSON avant remise |
| 4 Couverture | Exploratory; cellules manquantes explicites dans la matrice |
| 5 Hooks | Conformité des hooks installés PASS; pré-commit documentaire exécuté: PASS (après installation ignore-scripts de yaml manquant) |
| 6 UI | SKIP: aucune UI modifiée; observation terminal bornée à MACHINE |
| 7 Observabilité | SKIP: aucune logique ajoutée; ne pas confondre wired/fired avec observed |
| 8 Sécurité | Logs expurgés, aucune donnée privée consommateur ou permission élargie |
| 9 Documentation | Ce dossier seulement; aucune convention changée |
| 10 Commit | Commit documentaire avec raison; reçu final dans le rapport worker |
| 11 Revue indépendante | ORCH propriétaire; revue documentaire finale en attente, aucune review inventée |
| 12 Plan/spec | Liens ci-dessus; Step 10 PARTIAL, progression et checkpoint restent à ORCH |

Inventaire : [CLEANUP.md](CLEANUP.md). Les suppressions ne sont pas encore exécutées.
