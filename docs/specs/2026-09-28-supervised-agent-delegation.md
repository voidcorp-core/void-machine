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

## Résultat attendu

Depuis une demande faite au coordinateur, quel que soit son runtime, la Machine lance un ou
plusieurs agents (Claude, Codex, plus tard d'autres) pour traiter des tickets ou des tâches, les
suit, relaie leurs questions et collecte leurs résultats. Quand un multiplexeur est présent
(herdr aujourd'hui, tmux, cmux ou autre demain), chaque agent est visible dans son propre pane.
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
| Daemon app-server partagé de Codex : le proxy ne répond pas ; daemon 0.153.4 contre CLI 0.155.1 | sonde | non fiable, écarté |
| Codex non interactif : `--sandbox workspace-write --ask-for-approval never` ; relecture : `--sandbox read-only` | agent-approvals-security | documenté |
| Hook Codex `PreToolUse` sur `spawn_agent` (alias `Agent`) : observable, refus non garanti | learn.chatgpt.com/docs/hooks | inconnu |
| Agent teams Claude : panes natifs mais tmux ou iTerm2 seulement, pas Ghostty, expérimental, Claude seul | agent-teams | écarté |

## Rôles

Les rôles sont ceux de la spec du noyau (`2026-09-19-supervised-design-orchestration.md`,
« Proposed responsibilities ») ; cette spec en fixe le contrat pour la délégation.

| Rôle | Responsabilité | Ne fait jamais |
|---|---|---|
| **Coordinateur** (LLM, n'importe quel runtime) | décide quoi déléguer, rédige le brief, juge un retour : résultat à accepter ou question à laquelle répondre, ou à remonter à l'humain | lancer un agent autrement que par le noyau ; approuver une permission |
| **Noyau** (`@voidcorp/void-machine`, TypeScript, déterministe) | identité des runs, admission, transitions, liens run ↔ ticket ↔ session native ↔ surface, attente, réconciliation, clôture | raisonner ; recopier l'état que le runtime détient |
| **Adaptateur de runtime** (un par runtime) | traduit un run en session native, observe, transmet un message, arrête, fournit la commande d'affichage, déclare ses capacités | afficher ; choisir un modèle à la place de l'appelant |
| **Adaptateur de présentation** (un par multiplexeur) | ouvre une surface qui exécute une commande, l'étiquette, la ferme | connaître les agents ; décider d'un état ; fermer autre chose que ce qu'il possède |
| **Capture** (optionnelle, par runtime coordinateur) | redirige la délégation native du coordinateur vers le noyau quand une surface existe | porter une logique ; exister sans preuve de capacité |

Un seul chemin d'exécution : avec ou sans multiplexeur, un run est la même session native. Le
multiplexeur ajoute une vue, jamais un mode d'exécution.

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

### États

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
- `accepted` exige un résultat collecté durablement ; `retired` ferme la surface possédée.
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
void-machine agents status [<runId>]                        -> état + cause + action
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

Ajouter un runtime demande un adaptateur et ses tests de conformité, rien dans le noyau.

## Adaptateurs de présentation

```ts
interface Surface {
  open(view: { command: readonly string[]; cwd: string; label: string;
               role: 'work' | 'review'; ticket: string | undefined }): Promise<SurfaceRef>;
  close(ref: SurfaceRef): Promise<void>;
}
```

Détection par l'environnement, dans cet ordre : `HERDR_ENV` donne herdr, la socket cmux donne
cmux, `TMUX` donne tmux, sinon `none`. `none` n'ouvre rien : le run tourne à l'identique et
reste visible par `void-machine agents status` ou `claude agents`.

- **herdr** : onglet d'équipage, `pane run` de la commande d'affichage, libellé
  `WORK-n`/`REVIEW-n`, ticket en métadonnée du pane (`report-metadata`).
- **cmux** : porte la logique de `scripts/mission-presentation.mjs`, qui est supprimé.
- **tmux** : `split-window` avec la commande, titre du pane.

Fermer une surface ne touche jamais le run, la worktree ni les preuves.

*Correctif du 2026-09-28 (DEV-925)* : la revue d'avant implémentation a changé le port livré
(`runtime/presentation.ts`, sans dépendance vers la délégation) :

- le libellé `WORK-n`/`REVIEW-n` est choisi par l'adaptateur, seul à voir les libellés déjà
  affichés ; la vue porte le `runId`, que l'adaptateur appose sur la surface comme marque ;
- chaque réponse est une valeur (`open` → `ref` ou cause, `close` → `closed`,
  `already-absent`, `skipped` ou `failed`), jamais une exception : un multiplexeur en panne
  n'échoue jamais le run ;
- `inspect(ref)` s'ajoute, pour que `status` dise qu'un humain a fermé le pane
  (`closed` seulement si le multiplexeur a répondu sans la surface ; sans réponse : `unknown`) ;
- la référence enregistre le serveur (socket) de la surface, et `close` n'agit qu'après avoir
  relu le libellé et la marque du run sur ce serveur ; le pane de l'appelant n'est jamais fermé ;
- la surface s'ouvre hors du verrou de mission, après un `opening` écrit sous verrou, et se
  ferme à `retired` comme à `stopped` : un run arrêté n'atteint jamais `retired`, et sa surface
  n'aurait sinon plus de propriétaire. Un run `failed` garde sa vue, qui montre l'échec.

## Capture

**Claude** : hook `PreToolUse` sur `Agent`, moins de 100 lignes, sans logique propre :

- il laisse passer si aucune surface n'est détectée, si `subagent_type` vaut `fork`, ou si
  l'appelant est lui-même un run délégué, reconnu par son `session_id` (réclamé par le registre,
  ou lancé sous un handle qui en est le premier bloc) comme le hook `delegation-result`, et non
  par l'environnement, qu'une session `--bg` hérite du superviseur ;
- sinon il appelle `void-machine agents dispatch` avec `prompt`, `subagent_type` et `model`,
  le rôle `review` pour un type en lecture seule et `work` sinon, et le ticket de la mission ;
- il refuse l'appel natif avec un `permissionDecisionReason` qui donne le `runId` et la
  commande `wait` ;
- il n'élargit jamais l'autorité : un run `work` agissant en mode `auto`, un coordinateur dans un
  autre mode que `auto` ou `bypassPermissions` garde son sous-agent natif, avec la cause signalée.

**Codex** : même hook sur `spawn_agent`, livré seulement si la sonde prouve que le refus tient.
Sinon, un coordinateur Codex appelle le CLI par l'instruction de son skill, et la capacité est
déclarée non garantie.

## Appelants migrés

- **Coordinateur** : la capture, plus une consigne d'une ligne dans `CLAUDE.md` et `AGENTS.md`.
- **`void-autopilot`** : le paragraphe « Spawning » appelle `agents dispatch` pour chaque worker
  et chaque relecteur ; la prose conditionnelle sur le multiplexeur disparaît.
- **`void-implement`** : chaque enveloppe `invoke-specialists` devient un `dispatch` de rôle
  `review`, avec le type natif du spécialiste. Le contrat d'événements de
  `2026-08-21-agent-dispatch-closure.md` ne change pas.
- **`docs/NATIVE-SUPERVISION.md`** : réécrit ; l'étape 4 ne dépend plus d'une décision de l'agent.

## Erreurs et limites

- Runtime absent ou version trop ancienne : `dispatch` refuse avec la cause et la commande de
  réparation. Pas de repli silencieux.
- Présentation qui échoue : le run continue sans vue, l'échec est signalé ; permissions et
  preuves ne changent pas.
- Accusé perdu : `reconciling`, interrogation par `--name vm-<runId>` ou identifiant de thread,
  jamais de relance aveugle.
- Parallélisme : borné par l'appelant (autopilot : quatre) ; le noyau refuse au-delà d'un
  plafond de mission déclaré.
- Nettoyage : la surface est fermée à `retired` ; la session native s'arrête sur `stop` ou à
  l'acceptation d'un run `review` ; les worktrees suivent la règle universelle.

## Tests et preuves

- **Strict** (`void-tdd`) : machine d'états, admission, liens du registre, choix de la surface,
  construction des commandes et analyse des observations de chaque adaptateur. Fonctions pures.
- **Conformité d'adaptateur** : exécutables factices qui rejouent les sorties réelles capturées
  (`claude agents --json`, flux app-server), sur le modèle de
  `packages/void-machine/test/claude-runtime-contract.test.ts`. Un seul jeu de tests par port.
- **Preuves réelles** consignées dans la PR, faites sur un consommateur jetable installé depuis
  `pnpm pack` : ce dépôt exécute le bundle de hooks publié (4.0.0) jusqu'à la 4.1.0, donc les
  nouveaux hooks n'y tournent pas avant la release :
  1. sous herdr et Ghostty, une délégation par l'outil `Agent` ouvre un pane rattaché au ticket,
     et le coordinateur récupère le retour sans action humaine ;
  2. sans multiplexeur, la même délégation reste un sous-agent natif ;
  3. un relecteur délégué garde ses restrictions d'outils ;
  4. un run Codex va jusqu'au résultat structuré ;
  5. une worktree neuve démarre sans dialogue de confiance.

## Tranches

1. **Contrat du noyau et adaptateur Claude** : run, états, registre, CLI `agents`, résultat par le
   hook Stop, présentation `none`. Déjà utilisable, visible dans `claude agents`.
2. **Présentation et capture** : port `Surface`, adaptateurs herdr, tmux et cmux (script
   supprimé), hook `Agent`. Ferme le besoin d'origine.
3. **Adaptateur Codex** : app-server possédé, capacités déclarées, sonde de vue et de capture.
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

## Auto-relecture

Pas de TBD. Hypothèses restantes, toutes avec leur preuve prévue : worktree neuve, vue Codex,
refus de la capture Codex. Portée : une capacité du noyau, un port par axe (runtime,
présentation), cinq tranches livrables séparément dans la même version.
