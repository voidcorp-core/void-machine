# Chantier : quatre prises indépendantes issues de l'audit prime-agent

Tu travailles dans `void-harness`. Lis `CLAUDE.md` et `.void/PROJECT-DOCTRINE.md` d'abord.
Quatre sujets indépendants, dans l'ordre. Chacun est une unité livrable seule — utilise
`void-implement` par unité, pas un gros commit fourre-tout.

La gestion mécanique du contexte fait l'objet d'un **brief séparé** et n'est pas ici.

---

## 1. Bloquer `git add -A`, `git add .` et `git commit --no-verify`

**Le constat, vérifié :** cette règle n'existe nulle part dans le harnais. Ni dans
`packages/hook-runner/src/rules/dangerous-command.ts`, ni dans `CLAUDE.md`, ni dans
`packages/core/skills/void-commit-discipline/SKILL.md`. Elle ne vit que dans la mémoire de
Folpe, écrite après un incident réel : 2,4 Mo d'images embarquées par accident dans une PR.

Or `.void/installed/PHILOSOPHY.md` pose que « Rules without enforcement should NOT be added to
this file ». On a donc une règle payée, sans mécanisme et non écrite. C'est le pire des trois
états.

`dangerous-command.ts` couvre aujourd'hui : fork bomb, mkfs, écriture disque brute, SQL
destructif, `rm`/`chmod`/`chown` récursifs sur un chemin racine, `git push --force` sans lease,
et `git rebase|am|apply|cherry-pick` avec un flag d'exécution. Rien sur le staging.

**À faire :** ajouter `git add -A`, `git add .` et `git commit --no-verify`. Le dernier compte
autant que les deux autres : il contourne le hook pre-commit qui refuse une doc sœur
désynchronisée et fait tourner l'anti-bloat.

**À ne PAS faire :** ne prends pas le reste de la liste de prime-agent (`git reset --hard`,
`git checkout .`, `git clean -fd`, `git stash`). Leur liste existe parce que plusieurs agents
partagent un même worktree ; `void-autopilot` en donne un par ticket. Les bloquer en solo
créerait un faux positif sur des opérations parfaitement légitimes — exactement le défaut que ce
dépôt vient de corriger dans le check de manifeste.

Vérifie que le message de refus nomme le remède utile (`git add <chemins>`), pas seulement
l'interdit.

---

## 2. Ne pas rejouer une porte échouée quand l'arbre n'a pas bougé

**Ce qui existe :** `packages/cli/src/lib/autopilot/proof-invalidation.ts` lie une preuve à un
SHA d'intégration, un hash de diff et l'argv exact, et recalcule la fraîcheur plutôt que de la
mémoriser. Biais assumé : tout ce qui n'est pas reconnu est périmé.

**Ce qui manque :** la moitié symétrique. Une porte qui **échoue** n'a aucune raison d'être
relancée tant que rien n'a changé dans l'arbre. Prime-agent l'a :
« avoids rerunning the same failed gate when the workspace has not changed »
(`packages/coding-agent/docs/long-running-agents.md:221`).

**À faire :** appliquer la même liaison qu'une preuve fraîche — même argv, même SHA, même hash
de diff — à un échec, et refuser de relancer à l'identique. Le gain est direct sur un cluster
autopilot qui boucle.

**Attention :** un échec mis en cache est plus dangereux qu'une preuve mise en cache. Le biais
doit s'inverser : dans le doute, relancer. Écris ce renversement dans le code, avec sa raison.

---

## 3. Une phrase d'honnêteté dans `void-verify`

`packages/core/skills/void-verify/SKILL.md`. À intégrer dans la langue de la skill, pas à coller
tel quel :

> Une porte qui passe ne vérifie que ce que cette porte vérifie ; atteindre une limite
> n'implique pas que la tâche a réussi.

C'est une prise de prime-agent (`long-running-agents.md`, mode autonome). Une ligne, et elle
ferme le raccourci « c'est vert donc c'est fait » — celui que `void-verify` existe pour refuser.

Vérifie le budget de description et les plafonds anti-bloat après édition.

---

## 4. Améliorer la continuité d'exécution

Le plus ouvert des quatre. Commence par `void-brainstorm`, ne code pas d'emblée.

**Où on en est :** `void-checkpoint` est un fichier markdown qu'un humain déclenche.
`.void/machine/checkpoint.md`, classé `observed` dans
`packages/hook-runner/src/void-layout.ts:102`, donc gitignoré et local à la machine.

**Ce qu'ils ont :** un daemon qui survit à la fermeture du terminal, détachement et
rattachement de session, heartbeats, schedules, et des buts persistants avec budget de tokens
et d'horloge. Voir `packages/coding-agent/docs/long-running-agents.md` et `daemon.md`.

**Le point à creuser en premier**, parce qu'il est cheap et directement transposable : leur
séparation entre **but** et **politique**. Chez eux le but est un état persistant (objectif +
progression, à travers les tours) ; le mode autonome est une politique distincte qui décide
d'injecter une continuation, selon des preuves, des portes et des limites. Chez nous
`.void/active.md` et `void-autopilot` mélangent les deux.

**Ce qui n'est probablement pas transposable :** le daemon. void-harness ne possède pas le
runtime, il s'y installe. Ne pars pas là-dessus sans avoir montré ce qu'un harnais peut en
faire.

---

## Différé, à ne pas traiter ici

Le catalogue de modèles généré (leur `packages/ai/src/models.generated.ts` : ~15 fournisseurs,
`contextWindow`, `maxTokens`, et un coût à quatre entrées input/output/cacheRead/cacheWrite,
régénéré depuis models.dev). Ça donnerait des chiffres réels à `void-llm-cost-discipline`.
Folpe l'a explicitement classé en dernier. **Ne le commence pas.**

---

## Sortie attendue

Les points 1 à 3 sont assez cadrés pour aller directement en `void-implement`, une unité chacun.
Le point 4 passe par `void-brainstorm` et une spec validée avant tout code.

Toute décision non triviale s'écrit avec `void-harness decisions new`.
