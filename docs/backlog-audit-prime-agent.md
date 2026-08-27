# Backlog issu de l'audit prime-agent — à brainstormer point par point

Contexte : audit en lecture seule de `PrimeIntellect-ai/prime-agent` (MIT, runtime concurrent de
Claude Code et Codex), croisé avec la doc officielle des hooks des deux runtimes, le 2026-08-26.
Tout ce qui est affirmé ici a été vérifié dans le code ou dans la doc officielle, aux références
données. Ne re-dérive pas ces faits.

Dans `void-harness`. Lis `CLAUDE.md` et `.void/PROJECT-DOCTRINE.md` d'abord.
Un point = un `void-brainstorm`. Ne les enchaîne pas dans une seule session.

Deux briefs détaillés existent déjà et complètent cette liste :
`brief-contexte-mecanique.md` (point 1) et `brief-prises-annexes.md` (points 2 à 5).

---

## 1. Gestion mécanique du contexte  — PRIORITÉ HAUTE

**Ce qu'on veut.** Que le harnais tienne le contexte sain à la place du modèle : à un seuil de
remplissage, écrire un checkpoint, repartir propre, et continuer le travail depuis ce
checkpoint. Valable pour n'importe quelle skill, pas greffé sur `void-implement`.

**Ce qui existe.** Le seuil est déjà de la doctrine : `packages/core/skills/void-context/SKILL.md:61`
dit « keep effective usage around 40–60% ». `void-checkpoint` sait déjà quoi écrire.
`packages/hook-runner/src/void-layout.ts:102` classe `checkpoint.md` en `observed` (gitignoré).

**Faits vérifiés, à ne pas revérifier.**
- Aucun hook, sur aucun des deux runtimes, ne peut déclencher `/clear` ni `/compact`.
- Aucun hook ne reçoit le remplissage du contexte (ni tokens, ni pourcentage).
- `PreCompact` et `PostCompact` existent **sur les deux runtimes**, avec `trigger: manual|auto`.
- `SessionStart` porte `source: startup|resume|clear|compact` **sur les deux**.
- Tous les hooks reçoivent `transcript_path`, et `packages/cli/src/lib/transcript-cost.ts` sait
  déjà lire ce JSONL pour agréger les compteurs `usage`.

**Le piège à traiter frontalement.** `docs/plans/skill-audits/void-checkpoint.md` REFUSE déjà
l'automatisation, au motif qu'un événement d'arrêt ne distingue pas une interruption d'une
limite de contexte d'un tour fini. Le motif porte sur l'ambiguïté de `Stop` ; une compaction
annoncée n'est pas ambiguë. Soit tu montres que le refus ne s'étend pas, soit tu renonces — et
dans le premier cas la décision supersede la note d'audit, mise à jour dans le même commit.

**À brainstormer.** Où mesurer le seuil (`UserPromptSubmit`, une fois par tour, contre
`PostToolUse`, à chaque outil) ; quel dénominateur pour le pourcentage quand `model` manque ;
quoi faire du `/clear` brutal, qui ne prévient jamais ; et jusqu'où le harnais garantit contre
jusqu'où il se contente de demander.

---

## 2. Bloquer `git add -A`, `git add .` et `git commit --no-verify`

**Le constat.** Cette règle n'existe nulle part : ni dans
`packages/hook-runner/src/rules/dangerous-command.ts`, ni dans `CLAUDE.md`, ni dans
`void-commit-discipline`. Elle ne vit que dans la mémoire de Folpe, écrite après un incident
réel — 2,4 Mo d'images embarquées par accident dans une PR. Or `PHILOSOPHY.md` pose que « Rules
without enforcement should NOT be added to this file ». Règle payée, sans mécanisme, non écrite.

`dangerous-command.ts` couvre aujourd'hui fork bomb, mkfs, écriture disque brute, SQL
destructif, `rm`/`chmod`/`chown` récursifs sur racine, `git push --force` sans lease, et
`git rebase|am|apply|cherry-pick` avec flag d'exécution. Rien sur le staging.

**À brainstormer.** Le périmètre exact. Prime-agent bloque aussi `reset --hard`, `checkout .`,
`clean -fd` et `stash` — mais parce que plusieurs de leurs agents partagent un worktree, alors
que `void-autopilot` en donne un par ticket. Les prendre créerait des faux positifs sur des
opérations légitimes en solo. Où passe la ligne ?

**Le cas `--no-verify` est distinct** : il contourne le hook pre-commit qui refuse une doc sœur
désynchronisée. C'est un contournement de gate, pas une destruction de travail.

---

## 3. Ne pas rejouer une porte échouée quand l'arbre n'a pas bougé

**Ce qui existe.** `packages/cli/src/lib/autopilot/proof-invalidation.ts` lie une preuve à un SHA
d'intégration, un hash de diff et l'argv exact, et recalcule la fraîcheur plutôt que de la
mémoriser. Biais assumé : tout ce qui n'est pas reconnu est périmé.

**Ce qui manque.** La moitié symétrique, que prime-agent a
(`packages/coding-agent/docs/long-running-agents.md:221`) : « avoids rerunning the same failed
gate when the workspace has not changed ». Gain direct sur un cluster autopilot qui boucle.

**À brainstormer.** Le biais doit s'inverser par rapport à une preuve fraîche : un échec mis en
cache est plus dangereux qu'une preuve mise en cache, donc dans le doute il faut relancer.
Comment formuler ça sans réintroduire la boucle qu'on cherche à couper ?

---

## 4. Une phrase d'honnêteté dans `void-verify`

`packages/core/skills/void-verify/SKILL.md`. À intégrer dans la langue de la skill :

> Une porte qui passe ne vérifie que ce que cette porte vérifie ; atteindre une limite
> n'implique pas que la tâche a réussi.

Prise de prime-agent (mode autonome). Une ligne, et elle ferme le raccourci « c'est vert donc
c'est fait » — celui que `void-verify` existe pour refuser.

**Presque rien à brainstormer.** Vérifie le budget de description et les plafonds anti-bloat
après édition. Si ça tient en un `void-implement`, fais-le directement.

---

## 5. Suivi cumulatif des fichiers dans `void-checkpoint`

**Ce qu'ils ont.** Leur format de résumé de compaction
(`packages/coding-agent/docs/compaction.md`, section « Summary Format ») porte deux blocs tenus
cumulativement à travers les compactions successives :

```
<read-files>…</read-files>
<modified-files>…</modified-files>
```

C'est la donnée « où j'en étais » qu'une reprise cherche en premier. Notre checkpoint ne la
porte pas.

**En sens inverse, ne prends pas leur contenu.** Leur format n'a **ni impasses ni hypothèses
étiquetées** : leur « Key Decisions » dit ce qui a été décidé, jamais ce qui a été écarté. C'est
précisément l'apport de `void-checkpoint`. Leur structure, notre contenu.

**À brainstormer.** Qui tient la liste cumulative, et comment elle survit à un `/clear`.
Ce point est probablement à fusionner avec le point 1 plutôt qu'à traiter seul.

---

## 6. Télémétrie d'agents en première main via `SubagentStart` / `SubagentStop`

**Le constat.** Le commit `8b53f8f` sur la branche dit : « Codex subagent spawns were stored as
generic tools ». La télémétrie **infère** aujourd'hui l'usage des agents depuis des événements
d'outils génériques, avec des jointures à corriger.

Or `SubagentStart` et `SubagentStop` existent **sur les deux runtimes**, avec `agent_type` et
`agent_id`. Une heuristique de jointure remplacée par un fait.

**À brainstormer.** Ce que ça change pour `void-graph` et pour les propositions de suppression
de `void-audit`, qui reposaient sur cette inférence. Et si l'ancienne heuristique doit rester
en repli pour les journaux déjà écrits.

---

## 7. Améliorer la continuité d'exécution

**Où on en est.** `void-checkpoint` est un fichier markdown qu'un humain déclenche.

**Ce qu'ils ont.** Daemon survivant à la fermeture du terminal, détachement et rattachement,
heartbeats, schedules, buts persistants avec budget de tokens et d'horloge
(`packages/coding-agent/docs/long-running-agents.md`, `daemon.md`).

**Le point cheap et directement transposable** : leur séparation entre **but** et **politique**.
Chez eux le but est un état persistant — objectif plus progression, à travers les tours — et le
mode autonome est une politique distincte qui décide d'injecter une continuation, selon des
preuves, des portes et des limites. Chez nous `.void/active.md` et `void-autopilot` mélangent
les deux.

**Ce qui n'est probablement pas transposable** : le daemon. void-harness ne possède pas le
runtime, il s'y installe. Ne pars pas là-dessus sans avoir montré ce qu'un harnais peut en faire.

---

## 8. Les points de hook communs encore inutilisés

**Le constat.** Claude Code expose 30 événements, Codex 11, dont **neuf communs** :
`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `PermissionRequest`, `SubagentStart`,
`SubagentStop`, `UserPromptSubmit`, `PreCompact`, `PostCompact`.

Le harnais n'en câble que **quatre** : PreToolUse, PostToolUse, SessionStart, Stop.

Les points 1 et 6 en consomment quatre de plus. Restent :

- **`UserPromptSubmit`** — une fois par tour, peut bloquer, sur les deux runtimes.
- **`PermissionRequest`** — peut refuser ou autoriser, sur les deux. Le plancher ne vit
  aujourd'hui qu'en `PreToolUse`.

**Claude seulement**, donc à traiter comme dégradation déclarée si retenu :
`WorktreeCreate` et `WorktreeRemove`, qui touchent directement `void-autopilot` (un worktree par
ticket) ; plus `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `FileChanged`.

**Asymétries connues.** Le `PreCompact` de Codex peut bloquer, celui de Claude non — donc rien
ne doit dépendre du blocage. Codex garantit `model` dans `SessionStart`, Claude non. Codex a
`SessionEnd`, Claude ne l'a pas : ne bâtis rien dessus.

**À brainstormer.** Lesquels méritent d'exister, et lesquels ajouteraient un hook qui ne dit
rien d'actionnable. Le dépôt vient de passer une journée à éteindre un faux rouge ; un hook qui
parle sans qu'on puisse agir est la même faute sous un autre costume.

---

## 9. Catalogue de modèles généré — DIFFÉRÉ, ne pas commencer

Leur `packages/ai/src/models.generated.ts` : ~22 000 lignes générées depuis models.dev et les
APIs fournisseurs, une quinzaine de providers, et par modèle le `contextWindow`, le `maxTokens`
et un coût à quatre entrées (`input`, `output`, `cacheRead`, `cacheWrite`).

Ça donnerait des chiffres réels à `void-llm-cost-discipline`, qui dit aujourd'hui « Sonnet par
défaut, Opus exige un commentaire » sans savoir combien ça coûte. Et ça rendrait implémentable
l'idée de model tiering qui dort dans le backlog.

Ne pas vendorer le leur — le générer depuis la même source, comme eux, ce qui colle à la
discipline de sourçage.

**Classé en dernier par Folpe. Ne le commence pas.**

---

## Ce qu'on ne prend pas, et pourquoi

**Leur `/refine`** — une revue automatique de la trajectoire qui crée, met à jour et supprime des
prompts supplémentaires, mémoires et descriptions de skills. Frontalement contraire à « no
automatic write into doctrine, ever ». Leur propre garde-fou le trahit : ils ont dû rendre le
prompt de base immuable précisément parce que le reste ne l'est pas. Seul le **rollback par
snapshot** vaut d'être repris, pas la boucle d'écriture.

**Un adaptateur prime-agent complet.** Les skills et la doctrine y passent déjà gratuitement :
ils lisent `.agents/skills/` (`package-manager.ts:440`) et `AGENTS.md` / `CLAUDE.md`
(`resource-loader.ts:59`). Mais `ipython` est leur **seul outil-modèle par défaut** : lire,
éditer, lancer des commandes, tout part du kernel Python. Un plancher qui matcherait `edit` et
`bash` serait contourné dès la première écriture via Python — le bug du matcher Codex, sauf
qu'ici ce n'est pas un cas limite mais le chemin principal. Si un adaptateur est écrit un jour,
il doit être classé à un niveau de capacité inférieur, sans plancher.
