# Chantier : rendre la gestion du contexte mécanique

Tu travailles dans `void-harness`. Lis `CLAUDE.md` et `.void/PROJECT-DOCTRINE.md` avant tout.
Ce brief vient d'un audit de `PrimeIntellect-ai/prime-agent` (MIT) ; tout ce qu'il affirme sur
void-harness a été vérifié dans le code aux références données.

Commence par `void-brainstorm`. Il y a un vrai arbitrage à rendre avant d'écrire une ligne, et
il est décrit plus bas sous « Le piège ».

---

## L'objectif

Aujourd'hui, garder le contexte sain est un conseil que le modèle suit ou pas. On veut que le
harnais le fasse : à un seuil de remplissage, il écrit un checkpoint, la session repart propre,
et le travail continue depuis ce checkpoint — sans que l'humain ait à y penser, quelle que soit
la skill en cours.

Le cycle visé : **seuil atteint → checkpoint écrit → contexte vidé → reprise depuis le
checkpoint → l'implémentation continue.**

Contrainte non négociable : ça doit valoir pour n'importe quelle skill et n'importe quel
travail. Pas un mécanisme greffé sur `void-implement`.

---

## Ce qui existe déjà, et qu'il ne faut pas réinventer

- **Le seuil est déjà écrit.** `packages/core/skills/void-context/SKILL.md:61` : « Aim to keep
  effective usage around **40–60%** ». C'est de la doctrine, pas un mécanisme. Le chantier
  consiste à lui donner son mécanisme.
- **Le contenu du checkpoint est déjà conçu.** `void-checkpoint` sait quoi écrire et quoi
  refuser d'écrire (routage avant écriture, impasses, hypothèses étiquetées, fraîcheur des
  preuves, une action suivante exacte). Ne réécris pas ce contenu.
- **L'emplacement est déjà classé.** `packages/hook-runner/src/void-layout.ts:102` classe
  `checkpoint.md` en `observed`, donc sous `.void/machine/` et gitignoré. Volontaire : c'est ce
  que *cette machine* a observé.
- **Les hooks câblés aujourd'hui**, lus dans `packages/core/.claude-plugin/plugin.json` :
  `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`. **`PreCompact` n'est câblé nulle part.**
- Le runner de hooks vit dans `packages/hook-runner/src/lifecycle/`. `context.ts` produit
  aujourd'hui la bannière de `SessionStart`.

---

## Le piège, et c'est le cœur du chantier

**Cette automatisation a déjà été refusée une fois, par écrit.**
`docs/plans/skill-audits/void-checkpoint.md`, section « What was rejected » :

> **An automatic hook on session end.** Tempting, and refused for the reason `void-learn`
> already documented for its own Stop nudge: a stop event cannot distinguish an interruption
> from a context limit from a completed turn. A handoff written on a false positive is
> authoritative and describes a moment nobody chose, which is worse than no handoff.

Et `void-checkpoint/SKILL.md:20-22` dit que le déclencheur est « chosen by a human, not guessed
by a runtime ».

Lis ce refus attentivement : il porte sur **l'événement `Stop`**, dont l'ambiguïté est le motif.
Un seuil de contexte franchi n'a pas cette ambiguïté — c'est un fait observable, pas une
inférence. Le refus ne s'étend donc pas mécaniquement au nouveau déclencheur.

Mais tu ne passes pas outre en silence. Soit tu montres que le nouveau déclencheur échappe au
motif du refus, soit tu renonces. Dans le premier cas, la décision est écrite avec
`void-harness decisions new` et **supersede** explicitement la position de la note d'audit, qui
doit être mise à jour dans le même commit.

---

## Ce qui est déjà vérifié dans la documentation officielle

Fait le 2026-08-26 sur https://code.claude.com/docs/en/hooks. Ne le refais pas ; vérifie
seulement ce que ce brief laisse ouvert.

**Aucun hook ne peut déclencher `/clear` ni `/compact`.** Ce sont des commandes utilisateur.
Aucun champ de sortie de hook ne les demande, ne les provoque ni ne les initie.

**Aucun hook ne reçoit le remplissage du contexte.** Ni tokens, ni pourcentage, ni taille de
fenêtre. Le seuil de 40 % n'est donc PAS observable directement.

**Mais la compaction a deux points d'accroche, et le clear n'en a aucun avant :**

| Événement | Quand | Champ utile |
|---|---|---|
| `PreCompact` | avant la compaction | `trigger`: `manual` \| `auto` |
| `PostCompact` | après la compaction | `trigger`: `manual` \| `auto` |
| `SessionStart` | démarrage de session | `source`: `startup` \| `resume` \| `clear` \| `compact` \| `fork` |

`SessionStart` accepte un `matcher` sur `source`. Le harnais le câble aujourd'hui **sans
matcher**, donc il tire déjà après un clear — il n'en fait simplement rien de spécifique.

**Tous les hooks reçoivent `transcript_path`**, chemin d'un JSONL de la conversation. Réserve
documentée : il est écrit en asynchrone et peut retarder d'un tour.

Et le harnais sait déjà lire ce format : `packages/cli/src/lib/transcript-cost.ts` agrège les
compteurs `usage` par session, en ne lisant que les compteurs, jamais le contenu. Estimer le
remplissage depuis un hook est donc à portée, en réutilisant cet adaptateur.

---

## Ce que ça impose au design

Le cycle que Folpe a décrit — seuil, puis checkpoint, puis vidage, puis reprise — n'est pas
réalisable tel quel : le harnais ne peut pas provoquer le vidage. Il se scinde en deux moitiés
de nature différente, et c'est cette scission qu'il faut concevoir.

**Ce qui peut être garanti mécaniquement :**

- `PreCompact` écrit le checkpoint avant que la compaction ne détruise la moitié chère de la
  session. Déclencheur non ambigu : la compaction est annoncée, elle n'est pas devinée.
- `PostCompact`, et `SessionStart` avec `source` valant `clear` ou `compact`, réinjectent le
  checkpoint via `hookSpecificOutput.additionalContext`. Le harnais fait déjà exactement ça pour
  sa bannière, dans `packages/hook-runner/src/lifecycle/context.ts`.

Ces deux moitiés ferment la boucle sans qu'aucun `/clear` soit nécessaire.

**Ce qui ne peut être que demandé :**

- Le seuil de 40 %. Il faut l'estimer depuis `transcript_path`, puis injecter une instruction
  que le modèle exécute. Le harnais propose, le modèle dispose.

**Le trou restant, à nommer explicitement dans la spec :** un `/clear` brutal, sans checkpoint
préalable, perd tout — rien ne prévient avant un clear. Le nudge au seuil est la seule parade,
et elle dépend du modèle. Ne prétends pas le contraire dans la doc.

---

## Codex expose les mêmes points, et c'est ce qui rend le mécanisme portable

Vérifié le 2026-08-26 sur https://learn.chatgpt.com/docs/hooks. Le mécanisme n'a donc PAS à
être Claude-only, et aucune dégradation n'a à être déclarée dans `docs/CODEX.md` pour ce sujet.

| Événement | Claude Code | Codex | Champ commun |
|---|---|---|---|
| `SessionStart` | oui | oui | `source`: `startup` \| `resume` \| `clear` \| `compact` |
| `PreCompact` | oui | oui | `trigger`: `manual` \| `auto` |
| `PostCompact` | oui | oui | `trigger` |

Deux différences à connaître, aucune bloquante :

- Le `PreCompact` de **Codex peut bloquer** la compaction ; celui de Claude ne peut qu'observer.
  Ne construis rien qui dépende du blocage : le dénominateur commun est l'observation.
- Codex garantit `model` dans l'entrée de `SessionStart` ; Claude ne le garantit pas.

Le gabarit Codex vit dans `packages/core/codex/hooks.json`, compilé vers `.codex/hooks.json`
par `wireCodexFloor`. Il câble aujourd'hui les quatre mêmes événements que le côté Claude, avec
les matchers doublés (`apply_patch|Edit|Write`, `Bash|shell`) — respecte cette convention.

---

## Ce qui reste à vérifier

1. **La fenêtre de contexte du modèle courant.** `transcript-cost.ts` donne des tokens
   consommés ; un pourcentage exige un dénominateur. Le champ `model` est présent dans l'entrée
   des hooks mais **non garanti**. Décide ce que fait le mécanisme quand il manque — et rappelle
   que le biais du dépôt est : ce qui n'est pas connu ne déclenche pas.
2. **Le retard du transcript.** Il est écrit en asynchrone. Mesure de combien, et vérifie que
   ça ne fait pas manquer le seuil ou tirer deux fois.
3. **Où poser la mesure du seuil.** `UserPromptSubmit` existe sur les deux runtimes et tire une
   fois par tour — bien moins souvent que `PostToolUse`, qui tire à chaque outil. Compare le
   coût des deux avant de choisir.

---

## Un défaut à ne pas reproduire

Ce harnais vient de passer une journée à éteindre des faux rouges — un check qui échouait sur
l'usage normal d'un fichier, en nommant un remède qui ne faisait pas ce qu'il disait. La leçon
est écrite dans `docs/decisions-log/2026-08-21-co-owned-edits-are-not-manifest-drift--*.md` :
un verdict que personne ne peut éteindre est un verdict qu'on apprend à sauter, et il emporte
les vrais avec lui.

Un nudge de contexte qui part trop tôt, trop souvent, ou au milieu d'une opération en cours,
sera ignoré au bout de deux jours. La qualité du **déclencheur** compte plus que celle du
message.

---

## À prendre chez prime-agent pendant que tu y es

Leur format de résumé de compaction (`packages/coding-agent/docs/compaction.md`, section
« Summary Format ») porte deux blocs que `void-checkpoint` n'a pas :

```
<read-files>
path/to/file1.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

Tenus cumulativement à travers les compactions successives. C'est exactement la donnée « où
j'en étais » qu'une reprise cherche en premier, et notre checkpoint ne la porte pas. Leur
structure générale (Goal / Constraints / Progress en Done-InProgress-Blocked / Key Decisions /
Next Steps / Critical Context) vaut aussi d'être comparée à la nôtre.

En sens inverse, ne prends pas leur contenu : leur format n'a **ni impasses ni hypothèses
étiquetées**. Leur « Key Decisions » dit ce qui a été décidé, jamais ce qui a été écarté. C'est
précisément l'apport de `void-checkpoint`. Prends leur structure, garde notre contenu.

---

## Périmètre

Dans le périmètre : le déclencheur, l'écriture automatique du checkpoint, la reprise depuis ce
checkpoint, les deux blocs de fichiers ci-dessus, le support Claude **et** Codex ou une
dégradation déclarée, la décision écrite qui supersede le refus existant.

Hors périmètre : tout le reste de l'audit prime-agent. Ils font l'objet de tickets séparés.

## Sortie attendue

Une spec approuvée via `void-brainstorm`, puis un plan via `void-plan`, puis des tickets via
`void-ticket`. Pas de code avant que la spec soit validée par Folpe.
