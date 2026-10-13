---
title: Fermer la boucle de dispatch des agents spécialistes
date: 2026-08-21
status: approved
author: Folpe + Codex
ticket:
related:
  - docs/specs/2026-07-24-void-harness-v3-top-tier-engineering-team.md
  - docs/plans/2026-07-24-void-harness-v3-top-tier-engineering-team-plan.md
  - docs/decisions-log/2026-07-28-route-specialists-from-canonical-contracts--746a9448-0aaf-44d7-adbe-d7c6d3deaf0d.md
---

# Fermer la boucle de dispatch des agents spécialistes

## Résumé

Les seize spécialistes sont installés et routés, mais le chemin vivant s'arrête avant leur
exécution : le contrôleur produit `invoke-specialists`, aucun adaptateur ne le consomme, et
`void-implement` nomme encore trois rôles en dur. En parallèle, le compteur Codex classe
`collaborationspawn_agent` comme un outil générique. Le rapport de comportement conclut donc que
tous les agents sont morts alors que des sous-agents ont effectivement été lancés.

Cette tranche ferme la boucle sans transformer les hooks en orchestrateur :

1. le compteur reconnaît les primitives natives de spawn et leurs noms d'agents ;
2. le rapport compare les activations aux agents réellement installés et sépare les missions
   synthétiques des sessions humaines ;
3. un protocole de dispatch déterministe transforme `invoke-specialists` en invocations bornées ;
4. `void-implement` exécute chaque spécialiste applicable, sans liste de rôles locale ;
5. le cycle de vie `started/completed/failed` rend les lancements, fins et échecs observables ;
6. un corpus réaliste mesure précision, rappel, dispatch et complétion ;
7. le graphe joint hooks, skills et agents à leur coût et à leurs résultats pour alimenter
   `void-learn` en propositions réversibles.

## Invariants

- Le Mission Engine décide quels spécialistes sont applicables. Une skill ou un runtime ne
  recalcule jamais cette liste.
- Le dispatcher transporte des identifiants, versions de contrat, étapes, rounds et hashes. Il
  n'interprète pas le domaine.
- Codex exécute avec `spawn_agent`; Claude Code avec `Agent`. Les hooks observent ces appels mais
  ne les provoquent pas.
- Un résultat de spécialiste est validé avant d'être journalisé. Un résultat absent, invalide,
  obsolète ou provenant d'un autre spécialiste échoue fermé.
- Une capacité `unavailable` bloque le dispatch. Une capacité `degraded` autorise les revues et
  permet de terminer un ticket dont les preuves métier et techniques sont valides, avec ses
  limitations conservées dans le verdict du contrôleur. Elle ne prétend pas fournir la garantie
  manquante ; les releases et routes à haut risque peuvent exiger `available`.
- Aucune mission synthétique `mis_selfhost_*` ou smoke interne ne compte comme preuve d'usage
  humain dans `graph behavior`.
- Un événement d'agent étranger au catalogue ne suffit pas à effacer un `telemetry-gap` pour les
  agents installés.
- Le dispatcher n'exécute ni shell ni modèle lui-même. Il émet un contrat que le runtime actif
  consomme avec sa primitive native.
- Un hook n'est jamais une autorité de routage. Il observe une invocation ou bloque une violation
  certaine ; il ne choisit pas un spécialiste.
- Une skill conduit le cycle mais ne maintient pas une seconde liste d'agents. Toute amélioration
  de routage se fait dans les contrats canoniques et se prouve par le corpus.
- Une absence d'usage ne provoque jamais une suppression. Après vingt sessions humaines, elle peut
  seulement produire une revue de retrait que `void-learn` soumet à un humain.

*Correctif du 2026-09-30 (DEV-929)* : le lancement d'une enveloppe ne passe plus par la primitive
native du coordinateur (`Agent`, `spawn_agent`) mais par `void-machine agents dispatch`, rôle
`review`, avec `agentName`, `runtime` et `missionId` recopiés de l'enveloppe
([spec de délégation](2026-09-28-supervised-agent-delegation.md), « Appelants migrés » ;
[décision](../decisions-log/2026-09-28-kernel-delegation-ships-in-published-cli--0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7.md)).
Les invariants « Codex exécute avec `spawn_agent` ; Claude Code avec `Agent` » et « le dispatcher
n'exécute ni shell ni modèle », ainsi que l'exclusion « lancer un modèle depuis le CLI », sont
remplacés sur ce seul point : le contrôleur de mission n'exécute toujours rien, c'est le noyau de
délégation qui lance la session native. Le contrat de dispatch, le cycle de vie `specialist.*` et
la validation de `mission specialist-event` ne changent pas ; `contextId` porte l'identifiant du
run. Conséquence sur la télémétrie : un spécialiste lancé ainsi n'émet plus d'événement
`runtime.tool.*` de catégorie `agent` ; sa preuve d'exécution est l'enregistrement du run.

## Contrat de dispatch

Pour chaque action `invoke-specialists`, le contrôleur produit une enveloppe par spécialiste :

```json
{
  "schemaVersion": 1,
  "missionId": "mis_...",
  "runtime": "codex",
  "specialistId": "core:security-engineer",
  "agentName": "security-engineer",
  "contractVersion": 2,
  "stage": "post-implementation",
  "reviewRound": 1,
  "inputHash": "sha256:..."
}
```

L'ordre est stable et reprend exactement `specialistIds`. Un nom non résolu, une version absente,
un hash non canonique ou un doublon invalide toute l'action. Le runtime ne lance donc jamais un
sous-ensemble silencieux.

Le cycle de vie canonique est :

```text
specialist.requested -> specialist.started -> specialist.completed
                                      \----> specialist.failed
```

`specialist.completed` conserve le résultat structuré déjà compris par `reduceReviewLoop`.
`specialist.failed` garde le même `contextId` et une raison bornée, sans prompt ni sortie brute.
Un terminal sans requête et démarrage antérieurs exacts est refusé ; les retries identiques sont
idempotents et un second terminal concurrent entre en conflit sur le même identifiant atomique.

## Intégration runtime

Le CLI expose le prochain état sûr en JSON. `void-implement` boucle dessus :

1. démarrer une mission avec le ticket ; le runtime est dérivé du marqueur de session natif et son
   plan de spécialistes minimal est figé
   dans le run, hashé et lié à `mission.started`, avec le chemin canonique et le hash du contenu
   du ticket ;
2. demander la prochaine action sans fournir localement étape, round, runtime ou rôles ;
3. pour `invoke-specialists`, lancer chaque enveloppe avec l'agent natif exact ;
4. `dispatch` enregistre `requested`, puis le runtime soumet un fichier JSON borné à
   `mission specialist-event` pour `started`, `completed` ou `failed` ;
5. après une action d'écriture, appeler `mission writer-event --id ...` ; la commande consomme le
   reçu d'action du contrôleur et en dérive writer et round ;
6. redemander la prochaine action jusqu'à correction, vérification, arrêt ou complétion.

Le fichier ne peut contenir que l'enveloppe et les champs du statut : `contextId`, complétion
structurée ou raison bornée. Le CLI refuse les champs inconnus, les chemins hors projet, les
fichiers de plus de 100 Ko, tout contenu détecté comme secret et toute divergence
mission/runtime/spécialiste/version/étape/round/hash/contexte. Il ne journalise ni prompt ni sortie
brute. Les requêtes et transitions de dispatch sont idempotentes pour une même identité complète.
Les fichiers sont lus depuis le même descripteur `no-follow` que celui validé, puis l'inode et le
confinement sont revérifiés. Chaque transition revalide `mission.closed` sous le verrou du séquenceur
et aucun événement spécialiste situé après la première fermeture n'entre dans l'audit.
Le plan figé garde le routage pré-implémentation ; les hashes post-implémentation sont recalculés
sur le diff courant, sans permettre au CLI de réinventer la liste des spécialistes. `dispatch`
n'accepte plus le ticket : il relit le ticket lié au démarrage et refuse que son contenu ait changé.
Le runtime n'est plus un argument : les marqueurs Codex priment sur `CLAUDECODE=1`, documenté par
Claude Code pour les commandes issues de son shell, et une identité absente reste dégradée. Ainsi un
coordinateur Codex ne peut pas demander la capacité Claude plus forte.
Les actions terminales du contrôleur écrivent `mission.closed`. Une interruption ou un abandon doit
passer par `mission close --reason interrupted|abandoned`. Ce marqueur est le seul qui autorise
l'audit à conclure qu'une requête n'a jamais démarré ou qu'un démarrage n'a jamais terminé ; une
mission active n'est jamais classée morte.

Les descriptions natives restent importantes mais ne sont plus l'unique mécanisme. La
documentation Codex actuelle précise que la délégation suit une demande directe ou une instruction
applicable d'`AGENTS.md`/skill ; la documentation Claude Code indique que la description guide la
délégation automatique. Le protocole explicite donne aux deux runtimes la même décision, tout en
leur laissant leur primitive native :

- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/env-vars#claudecode

## Télémétrie

Le compteur adapte au minimum :

| Primitive observée | Catégorie | Nom |
|---|---|---|
| Claude `Agent` / `Task` | `agent` | `subagent_type` ou `agent` |
| Codex `collaborationspawn_agent` | `agent` | `agent_type` |
| forme qualifiée `collaboration.spawn_agent` | `agent` | `agent_type` |

Les événements explicites du contrôleur prouvent le lifecycle métier. Les événements
`runtime.tool.*` prouvent que la primitive runtime a bien été appelée. Les deux signaux se
complètent ; aucun n'est inféré de l'autre.

`graph behavior` calcule la vie sur les noms installés et respecte le fournisseur. Une activation
`superpowers:void-tdd` ne prouve rien sur le `void-tdd` local, comme
`agent:claude-code-guide` ne prouve rien sur `security-engineer`. Le rapport affiche aussi le
nombre d'événements et de sessions synthétiques exclus.

## Boucle d'optimisation hooks + skills + agents

La boucle a un seul propriétaire par responsabilité :

```text
hooks (mesure + garde) -> graphe (jointure) -> audit (proposition)
        ^                                           |
        |                                           v
runtime <- skills (conduite) <- contrats <- learn (décision HITL)
                    |
                    v
              agents (jugement borné)
```

`void-graph` et `void-audit` croisent quatre preuves : relations déclarées, activations humaines,
résultats et coût statique/runtime. Une mission self-host ou smoke n'entre jamais dans la preuve
d'adoption. Le lifecycle détecte les chaînes forgées ou mal attribuées et les échecs explicites en
joignant l'identité complète du dispatch ; une requête simplement en cours n'est jamais condamnée.
Une seule proposition prioritaire est émise par composant :

1. `repair-telemetry` quand la jointure de noms est cassée ;
2. `repair` quand des complétions échouent ;
3. `retirement-review` après au moins vingt sessions humaines sans activation ;
4. `wire` quand le composant est orphelin dans le graphe ;
5. `tune-or-fuse` quand le composant coûte beaucoup pour peu de résultats.

La priorité empêche un faux signal de retrait de masquer une télémétrie cassée. Chaque proposition
porte sa preuve, le risque d'une mauvaise décision et le marqueur `learnCandidate`. `void-learn`
reste l'unique porte d'écriture : modifier, fusionner ou retirer demande une décision humaine et
une preuve ciblée ; le rapport n'édite rien.

## Mesures d'acceptation

Un corpus versionné contient au moins 40 missions couvrant backend, UI, sécurité, données,
performance, produit, DevEx, PDF et contrôles négatifs. Le score publie :

- précision de routage ;
- rappel de routage ;
- taux d'enveloppes émises sur spécialistes attendus ;
- taux de complétions reconnues sur enveloppes émises ;
- faux verts, obligatoirement à zéro.

Le corpus déterministe doit atteindre 100 % sur ces invariants avant merge. Les evals LLM restent
une couche complémentaire et ne remplacent pas les tests de contrat.

L'audit vivant a deux seuils distincts : trois sessions et vingt événements humains suffisent pour
proposer réparation, câblage ou réglage ; un retrait exige vingt sessions humaines. Avant ces
seuils, l'absence de données est rendue explicitement et aucune proposition n'est émise.

## Hors périmètre

- Faire des hooks un moteur d'orchestration.
- Lancer un modèle depuis le CLI.
- Certifier verte une isolation runtime non prouvée.
- Inventer une seconde logique de routage dans les skills.
- Auto-appliquer une modification de doctrine ou ouvrir un ticket de feedback sans confirmation.

## Décision

La spec v3 et l'ADR de routage ont déjà fixé la direction. Cette spec ferme un écart
d'implémentation ; elle ne crée pas une nouvelle architecture. Folpe a approuvé l'exécution le
2026-08-21.
