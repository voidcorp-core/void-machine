---
title: Délégation supervisée d'agents, agnostique du runtime et de l'affichage
date: 2026-09-28
status: approved
author: Folpe + Claude
ticket: DEV-902
related:
  - ../VOID-MACHINE-VISION.md
  - 2026-09-19-supervised-design-orchestration.md
  - 2026-09-05-visible-agent-supervision.md
  - 2026-08-21-agent-dispatch-closure.md
  - 2026-09-22-autopilot-native-loop.md
  - ../audits/2026-09-22-void-machine-external-patterns.md
  - ../NATIVE-SUPERVISION.md
---

# Délégation supervisée d'agents

Amendement approuvé le 30 octobre 2026 : la présentation intégrée est remplacée
par le [contrat de publication worker](2026-10-30-worker-lifecycle-publication.md).
Les faits datés ci-dessous restent des observations historiques, pas des instructions
pour contrôler les outils d'affichage. Voir le [contrat public](../WORKER-LIFECYCLE.md).

## Résultat attendu

Depuis une demande faite au coordinateur, quel que soit son runtime, la Machine lance un ou
plusieurs agents (Claude, Codex, plus tard d'autres) pour traiter des tickets ou des tâches, les
suit, relaie leurs questions et collecte leurs résultats. Le cycle de vie des workers est
publié pour des outils d'affichage externes ; Machine ne contrôle pas leurs surfaces.
L'humain n'a qu'un point d'entrée : le coordinateur.

Constat d'origine (DEV-902, 2026-09-24) : quatre revues et une recherche déléguées en sous-agents
natifs sont restées invisibles, parce que l'affichage dépendait d'une décision de l'agent. Le
même défaut existe en prose dans `void-autopilot` (« si un multiplexeur existe… ») et dans le
dispatch des spécialistes de `void-implement` : trois appelants, trois façons de lancer un agent.

Livré complet dans la 4.1.0.

## Hors périmètre

- **Routage** (choisir le meilleur agent, runtime ou modèle pour une tâche) : reste chez chaque
  appelant (curateur d'autopilot, plan figé des spécialistes, coordinateur). Le routage
  automatique (DEV-735) se branchera sur ce socle sans le modifier.
- **Outil `Workflow`** de Claude : il lance ses agents sans passer par l'outil `Agent` ; non
  capturé, et documenté comme tel.
- **Sous-agent `fork`** : hérite du contexte du coordinateur, impossible à reproduire dans une
  session séparée ; reste natif.
- **Clients du socle hors de ce dépôt** : `cockpit crew` deviendra un client du socle dans le
  dépôt void-cockpit, en ticket séparé.
- **Backend headless planifié** (cron, walk-away) : déjà différé par la spec autopilot.

## Faits vérifiés (2026-09-28)

Documentation officielle lue et sondes réelles exécutées sur ce poste (Claude Code 2.1.283,
Codex CLI 0.155.1, herdr 0.9.0, macOS, Ghostty).

| Fait | Source | Statut |
|---|---|---|
| `claude --bg --agent <type> --name <n> --permission-mode <m> --model <m> "<brief>"` lance une session hébergée par le superviseur de Claude Code, qui survit au terminal | code.claude.com/docs/en/agent-view | vérifié |
| `claude agents --json --all` est l'interface supportée pour lire `state` (`working`, `blocked` + `waitingFor`, `done`, `failed`, `stopped`) depuis un autre programme | agent-view, « Read session state from a script » | vérifié |
| Une session `--bg` exécute tous les hooks du projet (SessionStart, UserPromptSubmit, Stop) : le plancher de sécurité reste actif | sonde | vérifié |
| `claude --bg` démarre dans une worktree existante sans dialogue de confiance | sonde | vérifié ; worktree neuve à prouver |
| `claude attach <id>` dans un pane herdr affiche la session en direct ; fermer le pane ne tue pas l'agent | sonde | vérifié |
| `claude logs` ne rend que la sortie brute du terminal ; le texte final se lit via `last_assistant_message` du hook Stop, recommandé par la doc plutôt que le transcript | code.claude.com/docs/en/hooks | vérifié |
| `--agent <type>` garde les restrictions d'outils du type (`independent-code-reviewer` : Read, Grep, Glob) ; un type inconnu est refusé | sonde | vérifié |
| `auto` (tâches longues, sans demande de routine) et `dontAsk` (refuse ce qui demanderait, n'attend jamais d'entrée) ; les règles deny et les refus de `PreToolUse` s'appliquent dans tous les modes | permission-modes | vérifié |
| Un message venu d'une autre session ne peut jamais approuver une permission à la place de l'humain | agent-teams, cross-session-messaging | documenté |
| `codex app-server` (stdio JSON-RPC) : `thread/start`, `turn/start` avec `outputSchema`, `turn/steer`, `turn/interrupt`, `turn/completed`, `thread/read` | learn.chatgpt.com/docs/app-server | vérifié (sonde stdio, sortie structurée conforme) |
| Daemon app-server partagé de Codex : le proxy ne répond pas ; daemon 0.153.4 contre CLI 0.155.1 | sonde | non fiable, écarté ; infirmé le 2026-09-29, voir le correctif Codex |
| Daemon 0.158.0 aligné sur le CLI : WebSocket sur `app-server-control.sock` ; cycle complet avec `outputSchema` ; un tour survit à la déconnexion du client qui l'a lancé ; `thread/list` retrouve un thread par son nom | sonde DEV-926 (2026-09-29) | vérifié |
| `codex resume <thread> --remote unix://<socket>` montre le thread en direct dans un pane herdr ; la reprise par nom est refusée en `--remote` | sonde DEV-926 | vérifié |
| `turn/interrupt` laisse vivre les commandes d'arrière-plan du tour ; `thread/backgroundTerminals/clean` (API expérimentale) les termine | sonde DEV-926 | vérifié |
| Le daemon décharge un thread inactif (`notLoaded`) ; `turn/start` y répond `thread not found` jusqu'à un `thread/resume`, qui reprend `approvalPolicy` et `sandbox` passés | sonde DEV-926 | vérifié |
| Depuis un thread `workspace-write`, `connect` sur le socket de contrôle est refusé (`EPERM`) : un agent ne peut pas ouvrir de thread hors sandbox | sonde DEV-926 | vérifié |
| Codex non interactif : `--sandbox workspace-write --ask-for-approval never` ; relecture : `--sandbox read-only` | agent-approvals-security | documenté |
| Hook Codex `PreToolUse` sur `spawn_agent` (alias `Agent`) : observable, refus non garanti | learn.chatgpt.com/docs/hooks | observé (DEV-926, Codex 0.155.1) : le hook voit `collaborationspawn_agent`, le refus tient, mais le brief arrive chiffré |
| Agent teams Claude : panes natifs mais tmux ou iTerm2 seulement, pas Ghostty, expérimental, Claude seul | agent-teams | écarté |

## Rôles

Les rôles sont ceux de la spec du noyau (`2026-09-19-supervised-design-orchestration.md`,
« Proposed responsibilities ») ; cette spec en fixe le contrat pour la délégation.

| Rôle | Responsabilité | Ne fait jamais |
|---|---|---|
| **Coordinateur** (LLM, n'importe quel runtime) | décide quoi déléguer, rédige le brief, juge un retour : résultat à accepter ou question à laquelle répondre, ou à remonter à l'humain | lancer un agent autrement que par le noyau ; approuver une permission |
| **Noyau** (`@voidcorp/void-machine`, TypeScript, déterministe) | identité des runs, admission, transitions, liens run ↔ ticket ↔ session native, publication des observations, attente, réconciliation, clôture | raisonner ; recopier l'état que le runtime détient |
| **Adaptateur de runtime** (un par runtime) | traduit un run en session native, observe, transmet un message, arrête, fournit la commande d'affichage, déclare ses capacités | afficher ; choisir un modèle à la place de l'appelant |
| **Consommateur externe** | lit les événements ou le snapshot, possède son affichage | transformer une observation en permission ou contrôler un worker par la fermeture de sa vue |
| **Coordinateur publiant** | enregistre les faits après accusé, observation et collecte natifs | inventer un lancement ou relancer pour réparer une publication |

Avec ou sans affichage externe, un run garde la même session native et les mêmes permissions.

## Contrat du noyau

### Run

```ts
interface AgentRunRequest {
  readonly runId: string;            // attribué par le noyau à l'admission
  readonly missionId: string;
  readonly ticket: string | undefined;   // DEV-123 ; absent pour une tâche ad hoc
  readonly runtime: 'claude' | 'codex';
  readonly agentType: string | undefined; // type natif : independent-code-reviewer, Explore...
  readonly role: 'work' | 'review';
  readonly model: string | undefined;
  readonly cwd: string;               // worktree du ticket (WORK) ; worktree détachée au SHA jugé (REVIEW)
  readonly brief: string;             // contexte complet : l'agent ne sait rien d'autre
}
```

`role` fixe les permissions, sans option libre :

| Rôle | Claude | Codex |
|---|---|---|
| `work` | `--permission-mode auto`, `cwd` = worktree du ticket | `sandbox: workspaceWrite`, `approvalPolicy: never` |
| `review` | `--agent <type>` + `--permission-mode dontAsk` | `sandbox: readOnly`, `approvalPolicy: never` |

### États du transport historique

Les états publics worker sont une projection distincte, définie par l’amendement.

```text
admitted -> dispatched -> working <-> turn-ended -> accepted -> retired
                              \-> waiting-human (permission ou dialogue)
                              \-> failed | stopped
dispatched|working --(observation perdue)--> reconciling
```

- `turn-ended` porte le dernier message de l'agent. Le noyau ne l'interprète pas : le
  coordinateur répond (`send`, retour à `working`) ou accepte (`accept`).
- `waiting-human` porte la cause (`waitingFor`) et l'action : trancher dans le pane de l'agent,
  car aucune autre session ne peut approuver à la place de l'humain.
- `accepted` exige un résultat collecté durablement ; `retired` termine l’affectation sans contrôler sa présentation.
  La session native, la worktree et les preuves gardent leur propre cycle de vie.
- `reconciling` : lancement ou observation ambigus. On interroge la session native par sa
  référence, on ne relance jamais à l'aveugle.
- L'état vivant vient toujours du runtime. Le registre ne garde que les identités, liens et
  transitions acceptées, dans le journal de mission `.void/machine/runs/<mission-id>/`, résolu
  depuis le répertoire Git commun : un run lancé dans une worktree écrit au même endroit que
  le checkout principal.
- Un run `review` qui juge un commit tourne dans une worktree détachée à ce SHA ; le noyau
  vérifie son `HEAD` avant et après le run et enregistre lui-même le SHA jugé.
- `dispatch` refuse, avec la commande qui répare, quand le hook qui collecte le résultat n'est
  pas installé pour ce runtime : sans lui, aucun résultat ne serait jamais collecté.

### Interface CLI

Point d'entrée unique, appelé par le coordinateur, autopilot, implement et la capture :

```text
void-machine agents dispatch --runtime claude|codex --role work|review [--type T] [--model M]
                             [--ticket DEV-123] [--cwd PATH] --brief-file F      -> runId
void-machine agents wait <runId...> [--any] [--timeout S]  -> transitions (JSON)
void-machine agents status [<runId>]                        -> état historique
void-machine agents status --json                           -> snapshot worker du projet
void-machine agents record --mission ID --event-file F       -> publication native
void-machine agents publish <runId>                          -> reprise de publication historique
void-machine agents send <runId> --message-file F
void-machine agents accept <runId>
void-machine agents stop <runId>
void-machine agents attach <runId>                          -> affiche dans le terminal courant
```

`dispatch` ne bloque pas et rend un accusé immédiat. `wait` est la notification agnostique : le
coordinateur Claude la lance en Bash d'arrière-plan et il est relancé à sa fin ; un coordinateur
Codex la lance au premier plan. Observation : événements natifs d'abord (flux app-server de
Codex), sinon relevé borné de `claude agents --json` toutes les cinq secondes, avec au plus une
observation en cours par mission.

## Adaptateurs de runtime

Port unique, capacités déclarées avec leur provenance (documentée, observée, vérifiée, inconnue) :

```ts
interface AgentRuntime {
  readonly capabilities: RuntimeCapabilities;
  dispatch(request: AgentRunRequest): Promise<NativeRunRef>;
  observe(ref: NativeRunRef): Promise<RunObservation>;
  send(ref: NativeRunRef, message: string): Promise<void>;
  stop(ref: NativeRunRef): Promise<StopObservation>;
  attachCommand(ref: NativeRunRef): readonly string[] | undefined;
}
```

**Claude.** `dispatch` : `claude --bg --name vm-<runId> [--agent T] --permission-mode M
[--model M]` dans `cwd`, avec `VOID_MACHINE_RUN_ID` dans l'environnement. `observe` :
`claude agents --json --all`, filtré sur l'identifiant de la session. Résultat : le hook Stop du
harnais, quand `VOID_MACHINE_RUN_ID` est présent, écrit `session_id` et
`last_assistant_message` dans le dossier du run ; un hook ne décide rien.
*Correctif du 2026-09-28 (DEV-923)* : une sonde a montré qu'une session `--bg` hérite de
l'environnement du superviseur, pas de la commande qui la lance ; `VOID_MACHINE_RUN_ID` ne
distingue donc pas deux runs. Le hook suit une réclamation indexée par `session_id`, écrite par
le noyau dès que la session est listée
([décision](../decisions-log/2026-09-28-delegated-result-correlated-by-session-id--af7d9cc5-2dab-4908-a908-44e4121510e9.md)). `send` :
`claude --resume <sessionId> --bg "<message>"`, qui reprend la session sur place (2.1.257 et
plus). `stop` : `claude stop <id>`. `attachCommand` : `claude attach <id>`.

**Codex.** L'adaptateur possède son processus `codex app-server`, avec un socket Unix dans le
dossier du run ; le daemon partagé, non fiable ici, n'est pas utilisé. `dispatch` :
`thread/start` (`cwd`, sandbox et approbation du rôle), puis `turn/start` avec le brief.
`observe` : flux d'événements, puis `turn/completed` et `thread/read`. `send` : `turn/steer`
pendant un tour, `turn/start` sinon. `stop` : `turn/interrupt`. `attachCommand` :
`codex resume <threadId> --remote unix://<socket>`, déclaré `inconnu` tant que la preuve en pane
n'est pas faite ; sans elle, un run Codex n'a pas de vue, ce que `status` dit explicitement.
La vie de ce processus est liée au driver : un driver arrêté ne prétend pas superviser.

*Correctif du 2026-09-29 (DEV-926)* : un run Codex est un thread du daemon app-server natif de
Codex, pas d'un processus possédé ([décision proposée](../decisions-log/2026-09-28-codex-runs-are-threads-of-native-daemon--5dd5306b-721f-4e9b-b592-c765c8eb823e.md)). Le
daemon supervise les threads, comme le superviseur de `claude --bg` les sessions ; le noyau ne
lance, ne possède et n'arrête aucun processus Codex :

- chaque commande `agents` joint le socket de contrôle (`$CODEX_HOME/app-server-control/`) le
  temps d'un échange borné ; `preflight` lance le daemon s'il ne tourne pas
  (`codex app-server daemon start`) et refuse, en nommant la réparation, un daemon injoignable ou
  d'une autre version que le CLI ;
- `dispatch` : `thread/start`, `thread/name/set` au nom du run, `turn/start` ; l'accusé porte l'id
  complet du thread, donc la vue existe dès le dispatch. Un lancement perdu se retrouve par son
  nom (`thread/list`), jamais relancé ; deux threads du même nom ne sont jamais départagés ;
- `observe` : `thread/read` sans tours (statut, nom), puis `thread/turns/list` du seul dernier
  tour, pour qu'une réponse ne grossisse jamais avec le run ; le runtime rend lui-même le message final, que le
  noyau enregistre une fois par tour et vérifie contre le schéma du run (`--output-schema`), un
  résultat non conforme étant gardé et marqué. Daemon injoignable : runs illisibles, jamais absents ;
- `send` : `turn/steer` pendant un tour, `turn/start` sinon (`thread/resume` d'abord pour un thread
  déchargé, avec l'approbation et le sandbox du rôle) ; `stop` : `turn/interrupt`, puis
  `thread/backgroundTerminals/clean`, seul appel qui demande l'API expérimentale, car une
  interruption laisse vivre les commandes d'arrière-plan ;
- une écriture ni confirmée ni refusée (délai, connexion perdue) rend `lost`, jamais `refused` : le
  run est retrouvé par son nom, jamais relancé ; un thread dont le tour est refusé est archivé ;
- le socket doit être un socket de l'utilisateur courant, et ce que dit le daemon est réduit au
  texte imprimable avant d'entrer dans une cause ;
- `attachCommand` : `codex resume <threadId> --remote unix://<socket>`, prouvé dans un pane herdr.

Ajouter un runtime demande un adaptateur et ses tests de conformité, rien dans le noyau.

## Adaptateurs de présentation

Le port Surface est remplacé par la publication agnostique définie dans
[l'amendement approuvé](2026-10-30-worker-lifecycle-publication.md) et le
[contrat public v1](../WORKER-LIFECYCLE.md). Le noyau publie worker.dispatched,
worker.state et worker.finished dans le journal canonique ; agents status --json
fournit une projection des affectations ouvertes dans toutes les missions du projet.

Les plugins externes gèrent leurs surfaces. Les chemins actifs de délégation,
statut et collecte ne détectent et n'appellent aucun multiplexeur. Les anciennes
surfaces restent intactes. Aucun nouvel ordonnanceur ou démon n'est ajouté.
Le hook herdr-metadata reste une exception transitoire hors périmètre (DEV-1134).

## Capture et appelants

La délégation native reste celle de void-orchestrate. Après un accusé réel, le
coordinateur publie via agents record ; après chaque observation puis collecte,
il publie la transition correspondante. Ce raccordement couvre void-autopilot et
les délégations de void-implement, pas uniquement l'ancien agents dispatch.

Aucune interception universelle des sous-agents Codex n'est revendiquée. Une
capacité absente reste inconnue. La commande d'attachement demeure unknown tant
qu'elle n'est pas établie pour la session ; aucun plugin n'est requis pour exécuter.
Les reçus de spécialistes et de revue indépendante restent distincts et inchangés.
Les instructions actives sont dans void-orchestrate et NATIVE-SUPERVISION.md.

## Erreurs et limites

- Runtime absent ou version trop ancienne : `dispatch` refuse avec la cause et la commande de
  réparation. Pas de repli silencieux.
- Consommateur de présentation absent ou défaillant : le run continue ; permissions et
  preuves ne changent pas. Échec de publication : erreur explicite, même identité à reprendre.
- Accusé perdu : `reconciling`, interrogation par `--name vm-<runId>` ou identifiant de thread,
  jamais de relance aveugle.
- Parallélisme : borné par l'appelant (autopilot : quatre) ; le noyau refuse au-delà d'un
  plafond de mission déclaré.
- Nettoyage : aucun contrôle de surface. Le cycle historique de la session native reste
  indépendant de la publication ; les worktrees suivent la règle universelle.

## Tests et preuves

TDD sur le schéma public et l'émission des trois événements via faux runtime,
avec rejeu idempotent, ordre des transitions, erreurs et lecture partielle.
La projection doit agréger les missions depuis toute worktree du même projet,
sans appeler un runtime ni modifier les journaux. Les tests de permissions,
collecte et reprise du transport historique restent applicables.

La preuve réelle utilise une phase worker d'Autopilot, un runtime natif et une
worktree dédiée : événements présents et snapshot avec ticket/worktree pendant
l'exécution, puis clôture observée. Aucun agent préexistant interrompu. Cette
qualification reste locale avant push/PR et ne prétend pas prouver un merge.

## Tranches historiques de la 4.1

Ces tranches décrivent la livraison initiale. La présentation de la tranche 2
est remplacée par l’amendement du 30 octobre ; ce n’est plus un travail à exécuter.

1. **Contrat du noyau et adaptateur Claude** : run, états, registre, CLI `agents`, résultat par le
   hook Stop, présentation `none`. Déjà utilisable, visible dans `claude agents`.
2. **Présentation et capture** : port `Surface`, adaptateurs herdr, tmux et cmux (script
   supprimé), hook `Agent`. Ferme le besoin d'origine.
3. **Adaptateur Codex** : thread du daemon natif (correctif du 2026-09-29), capacités déclarées,
   sonde de vue et de capture.
4. **Appelants** : autopilot, implement, `NATIVE-SUPERVISION.md`, consignes coordinateur.
5. **Livraison** : `@voidcorp/void-machine` embarqué dans le CLI publié, preuves réelles, 4.1.0.

## Décision structurante requise

Deux décisions en vigueur interdisent de livrer le noyau neuf : `adr:e492e50e` (2026-09-19,
« release … not authorized ») et `adr:ec77d2de` (2026-09-21, `packages/void-machine` reste un
package privé). `adr:873d1c5a` est déjà remplacée par `adr:e492e50e` et n'est pas visée.
Embarquer la capacité de délégation dans `voidmachine` demande une ADR
(`void-machine decisions new`) qui remplace ces deux-là sur ce seul point, avant la tranche 5.
Alternative écartée : implémenter la délégation dans le CLI actuel, ce qui recréerait un
contrôleur que la vision retire.

## Portée actuelle

L'amendement remplace la responsabilité de présentation sans reconstruire les
runtimes ni modifier les permissions, la sécurité ou les règles de merge.
Les anciens runs restent collectables. La migration du hook et le plugin externe
restent des travaux séparés.
