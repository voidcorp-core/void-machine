# Audit de cohérence des instructions du dépôt

Date : 30 octobre 2026. Statut : constats et propositions, aucune modification de doctrine adoptée.

L'audit retient **25 incohérences ou divergences de contrat**, dont **3 prioritaires** : la protection des écritures shell diffère entre runtimes, un exemple de webhook peut perdre un événement, et un wrapper est présenté comme assurant une protection anti-rejeu qu'il délègue au consommateur.

Les contrôles structurels et les tests ciblés passent malgré ces écarts. Le problème principal est la répétition de règles dans des supports dont les mises à jour ne sont pas liées : doctrine, skills, exemples, messages CLI, métadonnées et hooks. Les recommandations ci-dessous restent des propositions ; cet audit ne change aucune autorisation.

## Périmètre et état observé

- Checkout audité : `docs/2026-10-01-strategic-audits`, commit `2a8994f1792bff5e66cb4cdecdfc040d0ae5fb46`. Les 12 manifestes vérifiés par `version:check` annoncent **4.0.0**.
- Installation locale : `.void/install-manifest.json` annonce **6.0.0** ; les **142 fichiers** qu'il décrit existent et correspondent à leurs empreintes. Ce contrôle prouve leur conformité au manifeste local, pas leur identité avec une archive npm relue pendant cet audit.
- Modifications préexistantes préservées : `.claude/settings.json`, `.void/hooks/_void-hook.mjs`, `.void/install-manifest.json`, `.void/program.md`, une entrée `.pnpm-store` et le document de vision du 23 octobre. Le seul ajout de l'audit est ce rapport.
- Inventaire suivi : **494 Markdown sous `docs/`**, **69 skills et leurs 69 `harness.yaml`**, **21 agents**, **46 fichiers sous les hooks core**, manifests natifs, générateurs, enforcement, workflows et tests associés. Les fichiers locaux installés et le programme ont également été comparés aux sources.
- Méthode : inventaire transversal, recherches de règles, lecture approfondie des surfaces actives, comparaison instruction/instruction et instruction/code, sondes inoffensives des gardes, tests ciblés. Trois lectures indépendantes ont couvert documentation, skills/agents, puis hooks/prompts ; la synthèse a écarté les doublons et les faux positifs de version.
- Limite : ce n'est pas une lecture ligne par ligne de chaque document historique, ni une preuve d'absence de toute contradiction. Aucun état GitHub courant, protection distante, tracker ou consommateur externe n'a été recertifié. Les constats source portent sur ce checkout, pas automatiquement sur le dernier `main` ni sur le paquet publié.

Les décisions anciennes conservées comme historique ne sont pas des incohérences en elles-mêmes. En revanche, un ancien texte chargé comme instruction courante ou un plan encore référencé par un programme actif entre dans le périmètre.

## Priorités

| Niveau | Sens | Constats |
|---|---|---|
| P1 | Risque concret de perte de travail ou de fausse garantie de sécurité | C01 à C03 |
| P2 | Instructions incompatibles, procédure ambiguë ou garantie d'enforcement incorrecte | C04 à C25 |

### C01 Protection des fichiers différente entre Claude et Codex

**Contrat annoncé.** [CODEX.md](../CODEX.md), lignes 84–88, annonce la même surface d'enforcement.

**Contrat exécuté.** Le [manifest Claude](../../packages/core/.claude-plugin/plugin.json), lignes 102–115, déclenche `protected-file` sur `Edit|Write`, et `dangerous-command` sur Bash. Le [manifest Codex](../../packages/core/codex/hooks.json), lignes 12–14, déclenche aussi `protected-file` sur `Bash|shell`. Le [compilateur](../../packages/cli/src/lib/runtime-assets.ts), lignes 121–126 et 181, conserve ces matchers.

**Preuve.** Une entrée synthétique contenant la chaîne `printf harmless > pnpm-lock.yaml` donne exit 0 pour `dangerous-command` et exit 2 pour `protected-file`. La commande contenue dans l'entrée n'a pas été exécutée : seule son analyse par le hook a été testée.

**Conséquence.** Une écriture shell vers un chemin protégé ne rencontre pas le même garde selon le runtime. Cela ne démontre pas l'absence de protections serveur ou de sandbox supplémentaires.

**Correction proposée.** Aligner le déclenchement au niveau des manifests et prouver le parcours complet événement → matcher → garde pour chaque runtime, au-delà du prédicat unitaire.

### C02 Le modèle de webhook acquitte un événement non traité

Le [handler canonique du pack server](../../packages/packs/pack-server/skills/void-webhook-handler-pattern/SKILL.md), lignes 72–81, insère la clé inbox puis acquitte toute clé existante comme doublon. Les lignes 94–97 retournent 500 après un échec du traitement sans libérer la clé ni distinguer réception et succès. À l'inverse, [void-async-safety](../../packages/core/skills/void-async-safety/SKILL.md), ligne 29, exige de libérer sur échec pour permettre la reprise.

**Scénario établi par lecture du code d'exemple :** première livraison insérée, traitement en échec ; deuxième livraison rejetée comme doublon et acquittée alors que le travail n'a jamais abouti. Aucun appel à Stripe n'a été nécessaire ou effectué pour établir cette contradiction.

**Correction proposée.** Faire porter la déduplication sur un état de traitement explicite et durable, avec reprise après échec. Vérifier le scénario échec transitoire → nouvelle livraison → effet unique avant de republier cet exemple.

### C03 Une fenêtre anti-rejeu est promise par un wrapper qui ne la définit pas

[void-async-safety](../../packages/core/skills/void-async-safety/SKILL.md), lignes 39 et 49, passe `replayWindowMs` et annonce que le wrapper vérifie une fenêtre de cinq minutes par défaut. Le [type réellement livré](../../packages/packs/pack-nextjs/src/async/withWebhookSafety.ts), lignes 25–35, ne déclare pas cette option ; ligne 59, toute la vérification est déléguée à `verify`.

**Conséquence.** L'exemple ne correspond pas au type et peut faire croire que la fraîcheur de l'événement est vérifiée automatiquement. Le constat ne signifie pas que tous les callbacks consommateurs sont vulnérables.

**Correction proposée.** Documenter explicitement que `verify` possède signature et fraîcheur, ou faire évoluer le contrat du wrapper avec ses preuves. Ne pas laisser une propriété fictive servir de garantie.

## Installation et autorité des instructions

### C04 Une même session reçoit deux protocoles de revue et de livraison

[AGENTS.md](../../AGENTS.md), ligne 168, exige la revue GitHub App. Le [skill installé](../../.agents/skills/void-autopilot/SKILL.md), lignes 93–99 et 224, exige une revue locale et réserve push/PR au coordinateur. Le [skill source](../../packages/core/skills/void-implement/SKILL.md), ligne 109, demande encore au worker de pousser et d'ouvrir la PR dans le parcours autopilote. Le [programme local](../../.void/program.md), lignes 53–58 puis 125–127, mêle verdict local et exigence du check de l'App.

**Mesure.** Sur les 42 skills installés dans chacun des répertoires `.agents/skills` et `.claude/skills`, 23 sont identiques au core source, 18 diffèrent et `void-orchestrate` n'a pas de répertoire correspondant dans ce checkout. Ces différences ne sont pas toutes des défauts : l'installation publiée et les sources ont volontairement des cycles distincts.

**Défaut précis.** Les consignes chargées ensemble ne désignent pas clairement quelle version gouverne la mission. La cohérence des workflows GitHub de ces sources n'est pas remise en cause par la seule existence d'une version publiée plus récente.

**Correction proposée.** Réconcilier d'abord la révision de travail voulue, le programme et l'installation, en préservant les changements locaux. Expliciter l'autorité opérationnelle sans remplacer les hooks publiés par des sources en développement.

### C05 La doctrine chargée renvoie vers des parcours retirés

La [philosophie installée](../../.void/installed/PHILOSOPHY.md), lignes 161–162, prescrit encore `gstack:/void-qa`, `gstack:/ship` et `/land-and-deploy`. [AGENTS.md](../../AGENTS.md), ligne 155, interdit toute dépendance de parcours livré à gstack. La [philosophie source](../../packages/core/PHILOSOPHY.md), lignes 215–216, route déjà vers les skills natifs et `gh`.

Le fichier installé compte 164 lignes contre 218 pour la source et correspond exactement au hash annoncé par le manifeste local 6.0.0. Ce n'est donc pas une altération locale détectable par une simple vérification d'empreintes. Ses lignes 127, 136 et 149 conservent aussi l'ancien nom de dépôt/commande.

**Correction proposée.** Vérifier la provenance de cette matérialisation et la chaîne de publication de la doctrine ; corriger le support propriétaire puis réinstaller par le chemin prévu. Un manifeste valide prouve des octets attendus, pas la cohérence sémantique de ces octets.

### C06 Les merges sont simultanément réservés aux humains et autonomes

[AGENTS.md](../../AGENTS.md), lignes 24 et 68, et [ARCHITECTURE.md](../ARCHITECTURE.md), ligne 350, disent sans restriction que les merges restent humains. Le [générateur de consignes](../../packages/cli/src/lib/claude-md.ts), ligne 98, réémet cette règle. [CONTRIBUTING.md](../CONTRIBUTING.md), lignes 108–110, décrit `mergeGate: human` comme contrat requis.

À l'inverse, le [skill autopilote source](../../packages/core/skills/void-autopilot/SKILL.md), lignes 24–29, et le [parseur source](../../packages/cli/src/lib/autopilot/program.ts), ligne 18 et lignes 296–327, autorisent aussi `union-reviewed`.

**Conséquence.** Une reprise peut demander une approbation à chaque fusion malgré un consentement autonome déclaré, ou interpréter trop largement une exception mal délimitée.

**Correction proposée.** Distinguer intégration autorisée par le programme, gates explicitement humaines et promotion vers la branche de déploiement. Corriger aussi le générateur, pas seulement ses copies.

### C07 Le moment d'armement du merge n'est pas unique

[RELEASING.md](../RELEASING.md), lignes 44–46, encourage l'armement anticipé. Le [plan chargé par le programme](../plans/2026-09-28-release-4-1-delegation-and-autonomous-merge-plan.md), ligne 37, demande une auto-merge armée à l'ouverture. [AGENTS.md](../../AGENTS.md), ligne 168, exige un head déjà passé par la revue ; [void-autopilot](../../packages/core/skills/void-autopilot/SKILL.md), lignes 191–201, désarme un head dont le verdict n'est pas prouvé.

**Conséquence.** Le plan peut faire armer ce que la boucle doit aussitôt désarmer. Un éventuel parcours manuel différent n'est pas délimité.

**Correction proposée.** Une seule séquence d'admission pour le parcours autonome, sur un head admissible. Toute exception manuelle doit être explicitement séparée.

### C08 Deux corrections et deux revues désignent des budgets différents

[void-implement](../../packages/core/skills/void-implement/SKILL.md), ligne 54, et [void-code-review](../../packages/core/skills/void-code-review/SKILL.md), ligne 139, annoncent deux lots de correction après la revue générale. [void-autopilot](../../packages/core/skills/void-autopilot/SKILL.md), lignes 280–284, rend la main après la revue initiale puis une seule revue corrective. Le [noyau](../../packages/cli/src/lib/autopilot/loop.ts), lignes 108 et 581–584, applique bien cette seconde limite.

**Correction proposée.** Nommer l'unité du budget et documenter un contrat commun, ou une exception autonome explicite. Le constat n'autorise pas à augmenter automatiquement le budget.

### C09 Un hook enseigne un consentement autopilote supprimé

[block-protected-push.sh](../../packages/core/hooks/block-protected-push.sh), lignes 11–13 et 27–33, utilise `AUTO_MERGE=1`, qu'il présente comme issu de `--auto-merge`, et conseille cet override. [void-autopilot](../../packages/core/skills/void-autopilot/SKILL.md), lignes 24–28, supprime ce flag ; la [CLI](../../packages/cli/src/commands/autopilot.ts), lignes 66–71, le refuse.

Le hook reste présenté comme défense dans [CHEATSHEET.md](../CHEATSHEET.md), ligne 214, et [relations.graph.yaml](../../packages/harness-graph/relations.graph.yaml), ligne 476, sans être câblé dans les deux manifests natifs inspectés.

**Correction proposée.** Retirer ou adapter le vestige et ses relations déclarées. Ne pas présenter sa présence sur disque comme une protection active ni restaurer l'ancien mécanisme de consentement.

## Architecture et règles de développement

### C10 Les dépendances autorisées par le moteur sont interdites par les skills

[void-dependency-direction](../../packages/packs/pack-monorepo/skills/void-dependency-direction/SKILL.md), lignes 13–21 et 142–151, et [void-service-package](../../packages/packs/pack-monorepo/skills/void-service-package/SKILL.md), lignes 55–59, n'autorisent que le package lui-même et `@repo/core`, en annonçant l'enforcement par le hook.

Le [moteur boundary-direction](../../packages/hook-runner/src/rules/boundary-direction.ts), lignes 3–20 et 94–95, rejette explicitement cette topologie universelle et autorise les dépendances déclarées. [ARCHITECTURE.md](../ARCHITECTURE.md), lignes 1506–1512, décrit ce comportement. [void-hexagonal-architecture](../../packages/core/skills/void-hexagonal-architecture/SKILL.md), lignes 148–154, lui attribue aussi des contrôles entre couches internes que sa regex d'import de packages ne réalise pas.

**Correction proposée.** Distinguer convention architecturale choisie par un projet et vérification des dépendances déclarées. Ne pas promettre des contrôles de couches internes qui n'existent pas.

### C11 La validation Zod est interdite et imposée dans les adapters

[void-hexagonal-architecture](../../packages/core/skills/void-hexagonal-architecture/SKILL.md), ligne 127, interdit la validation de frontière dans les adapters ; ligne 204, il l'y impose. [void-security-guidance](../../packages/core/skills/void-security-guidance/SKILL.md), lignes 49 et 216, la place à cette frontière et refuse de la repousser dans le service.

**Correction proposée.** Garder une définition commune de la frontière de confiance ; séparer validation d'entrée externe, traduction de représentation et invariants métier. Un même emplacement ne doit pas être simultanément obligatoire et interdit.

### C12 Un identifiant de session doit être journalisé et ne jamais l'être

[void-observability](../../packages/core/skills/void-observability/SKILL.md), ligne 124, demande de journaliser « Session ID » ; ligne 187, interdit les « session IDs » avec les secrets.

**Conséquence.** Le texte ne distingue pas identifiant de corrélation et jeton authentifiant. Le risque est une interprétation dangereuse, pas une fuite observée pendant cet audit.

**Correction proposée.** Nommer distinctement la corrélation opaque et les secrets de session, avec leur politique respective.

### C13 Logger une exception suffit pour le skill mais pas pour le reviewer

[void-observability](../../packages/core/skills/void-observability/SKILL.md), ligne 113, autorise « log it, or rethrow ». [silent-failure-hunter](../../packages/core/agents/silent-failure-hunter.md), lignes 39–43, considère comme erreur avalée le catch qui ne fait que logger sans remonter un échec ou une récupération explicite à l'appelant.

**Correction proposée.** Distinguer visibilité du problème et sémantique de l'opération. Un log seul ne doit pas transformer un échec non récupéré en succès apparent ; les récupérations intentionnelles doivent avoir un contrat explicite.

### C14 Des noms de skills ont remplacé des mots de grammaires techniques

[void-commit-discipline](../../packages/core/skills/void-commit-discipline/SKILL.md), ligne 30, autorise `void-refactor` comme type de commit ; son exemple ligne 104 et [void-refactor](../../packages/core/skills/void-refactor/SKILL.md), ligne 123, utilisent `refactor`. [void-observability](../../packages/core/skills/void-observability/SKILL.md), ligne 48, appelle le niveau standard `void-debug`, puis interdit les niveaux personnalisés ligne 222.

**Correction proposée.** Réserver le préfixe aux références de skills. Conserver `refactor` dans la grammaire des commits et `debug` dans celle du logger ; vérifier les autres substitutions de renommage selon leur contexte.

### C15 Les workflows de bug prescrivent des ordres incompatibles

[void-qa](../../packages/core/skills/void-qa/SKILL.md), ligne 73, prescrit correctif → commit → régression. [void-debug](../../packages/core/skills/void-debug/SKILL.md), lignes 70–80, exige test rouge → commit du test → correctif et interdit le test ultérieur. [void-implement](../../packages/core/skills/void-implement/SKILL.md), ligne 109, demande des commits indépendamment valides, regroupant domaine et tests.

**Correction proposée.** Préserver le RED/GREEN observé, puis choisir une politique Git explicite. Le cycle de preuve et la granularité des commits sont deux questions distinctes ; QA ne doit pas inverser l'ordre des preuves.

### C16 Le skill TDD cherche une configuration et des defaults absents

[void-tdd](../../packages/core/skills/void-tdd/SKILL.md), lignes 42 et 185, lit `voidcorp.config.json`, mais ses lignes 50 et 148 utilisent `.void/config.json`. L'[installateur](../../packages/cli/src/commands/init.ts), ligne 337, écrit ce second fichier. Le chemin de defaults `packages/core/claude/skills/void-tdd/defaults.md`, cité ligne 42, n'existe pas.

**Correction proposée.** Utiliser la configuration et le schéma de l'installateur comme autorité, avec un lien vers un support effectivement livré. Éviter que l'agent invente modes et commandes après une recherche infructueuse.

## Garanties annoncées et garanties exécutées

### C17 Le garde TDD ne prouve pas ce que sa documentation annonce

[tdd-guard.md](../../packages/core/hooks/tdd-guard.md), lignes 3 et 78, promet un test modifié dans le même staged set ; [CHEATSHEET.md](../CHEATSHEET.md), ligne 225, évoque un test échouant. Le [runner](../../packages/hook-runner/src/enforcement/runner.ts), lignes 346–353, ne vérifie que l'existence du test voisin ; [tdd-order.ts](../../packages/hook-runner/src/rules/tdd-order.ts), lignes 163–177, accepte cette présence et précise que la suite E2E n'est pas exécutée.

Le document promet aussi un bypass pour un diff de suppressions, lignes 49–51. La règle dispense la suppression du fichier, ligne 150, tandis que [ci-enforce.sh](../../packages/core/enforce/ci-enforce.sh), lignes 134–138, contrôle encore le source final après une suppression partielle.

**Correction proposée.** Décrire exactement le contrôle structurel, puis confier la preuve RED/GREEN au workflow qui l'observe. Harmoniser le cas des suppressions sans prétendre qu'un fichier de test existant prouve son exécution.

### C18 Les interdictions et exceptions de tests divergent du prédicat

[void-testing](../../packages/core/skills/void-testing/SKILL.md), lignes 230–234 et 262, interdit `.only`, `.skip`, `fdescribe`, `xit`, avec une exception `__skip-on-purpose__`. [no-focused-test.ts](../../packages/hook-runner/src/rules/no-focused-test.ts), lignes 11–17, ne couvre ni `fdescribe` ni `describe.skip` et n'implémente pas cette exception.

**Sondes :** `fdescribe(...)` et `describe.skip(...)` sont acceptés ; `test.skip(...)` sous `test/__skip-on-purpose__/audit.test.ts`, avec commentaire explicatif, est refusé. Les sondes ont présenté du contenu au garde sans créer ces fichiers.

**Correction proposée.** Définir les syntaxes interdites et les exceptions une seule fois, puis aligner prédicat, tests et documentation. Préciser le moment réel d'enforcement, qui n'est pas automatiquement un hook Git pre-commit.

### C19 Une règle présentée comme warning bloque l'édition

[void-testing](../../packages/core/skills/void-testing/SKILL.md), ligne 263, décrit `test-name-lint` comme avertissement pour des noms génériques. [test-name.ts](../../packages/hook-runner/src/rules/test-name.ts), lignes 11–18, utilise un verdict bloquant et refuse également des noms commençant par `should ` ou `works`. [source-helpers.ts](../../packages/hook-runner/src/rules/source-helpers.ts), lignes 44–51, confirme la sévérité `block`.

**Correction proposée.** Choisir une sévérité et une grammaire cohérentes. Un conseil stylistique ne doit pas devenir une interdiction plus large sans que le contrat le dise.

### C20 Les captures UI sont présentées comme un gate automatique non établi

[void-accessibility](../../packages/core/skills/void-accessibility/SKILL.md), lignes 201 et 232, et [void-frontend-design](../../packages/core/skills/void-frontend-design/SKILL.md), ligne 237, annoncent des PR refusées sans captures mobile et desktop.

[viewport-screenshot-gate.sh](../../packages/core/hooks/viewport-screenshot-gate.sh), lignes 4 et 16, se décrit comme avertissement. Il retourne succès si la PR ou sa base manque, lignes 22–26, et ses regex lignes 39–40 acceptent des mentions textuelles sans image. Il n'est câblé ni dans les manifests natifs inspectés ni dans le pre-commit du dépôt.

**Correction proposée.** Publier le statut réel de chaque mécanisme : automatique, manuel, consultatif ou non câblé. La présence d'un script et d'une relation `enforces` ne prouve pas l'exécution d'un gate ni une vérification visuelle.

## Progression, preuves et conservation

### C21 Verify réintroduit un pointeur de progression interdit par Plan

[void-verify](../../packages/core/skills/void-verify/SKILL.md), lignes 39, 93 et 151, demande de mettre à jour le « Resume point » du plan. [void-plan](../../packages/core/skills/void-plan/SKILL.md), ligne 122, le réserve aux plans sans tickets, et lignes 144–148 interdit un second pointeur mutable lorsque le provider possède la progression.

**Correction proposée.** Rendre l'item de vérification conditionnel : reprise locale d'un plan séquentiel, ou état du provider pour un programme décomposé. Ne pas dupliquer les états Linear/GitHub dans le plan.

### C22 Trois chemins sont présentés comme télémétrie courante

[HARNESS_EVOLUTION.md](../HARNESS_EVOLUTION.md), lignes 43 et 60, décrit `.void/runs/*/events.jsonl` puis `.void/*.jsonl`. [ARCHITECTURE.md](../ARCHITECTURE.md), ligne 844, conserve l'ancien chemin, mais ligne 851 désigne `.void/machine/runs/`. La [philosophie](../PHILOSOPHY.md), ligne 189, et [void-audit](../../packages/core/skills/void-audit/SKILL.md), ligne 33, donnent ce dernier chemin comme canonique. Le message [audit.ts](../../packages/cli/src/commands/audit.ts), ligne 121, conseille encore l'ancien emplacement.

**Correction proposée.** Distinguer un chemin canonique d'écriture et des chemins historiques lus pour compatibilité. Éviter des diagnostics d'absence d'événements basés sur le mauvais dossier.

### C23 Machine est déclaré supprimable sans perte mais contient des preuves à conserver

[ARCHITECTURE.md](../ARCHITECTURE.md), lignes 46–53, répond à « puis-je supprimer ce dossier ? » par « nothing is lost » pour `.void/machine/`. [BOUNDED-REVIEWS.md](../BOUNDED-REVIEWS.md), lignes 37, 112 et 120, impose la conservation des événements, résultats, budgets, invocations originales et preuves de reprise, notamment sous `.void/machine/reviews/`.

**Correction proposée.** Séparer cache régénérable, historique facultatif et état/preuves encore nécessaires. « Local et non versionné » ne signifie pas « supprimable sans perte ». Aucun nettoyage n'a été effectué.

### C24 L'audit peut proposer une retraite à partir d'une observabilité partielle

Le [score d'activation](../../packages/harness-graph/src/state/score.ts), lignes 117–127, traite l'usage Codex comme inconnu, jamais comme zéro. [void-audit](../../packages/core/skills/void-audit/SKILL.md), lignes 63–65, interdit l'inférence depuis le silence.

Pourtant le [seuil de retraite](../../packages/harness-graph/src/synergy/analyze.ts), lignes 195–199 et 270–276, compte les sessions sans contrat de couverture par runtime. Le [détecteur de lacune](../../packages/harness-graph/src/behavior/index.ts), lignes 129–169, ne protège une famille que si aucune activation correspondante n'est enregistrée ; une activation observable dans une fenêtre mixte suffit à lever cette protection. Le [type d'événement analysé](../../packages/harness-graph/src/behavior/types.ts), lignes 12–18, ne conserve pas la couverture d'observation par runtime.

**Observation locale.** `void-machine audit` a proposé des `retirement-review` à partir de 28 071 événements et 31 sessions humaines, alors que le contexte de session signale que l'usage des skills Codex n'est pas observable. Ces propositions ne prouvent donc pas une absence d'usage sur les sessions non observables. Elles ne déclenchent pas de suppression automatique.

Cette exécution utilise la CLI installée **6.0.0**, vérifiée par `void-machine version`. Les références d'algorithme ci-dessus décrivent les sources **4.0.0** ; l'observation locale ne prouve pas à elle seule que les deux versions exécutent un algorithme identique.

**Correction proposée.** Compter seulement les sessions dont l'observation est suffisante pour la capacité concernée, ou publier explicitement l'inconnue et suspendre cette catégorie de conclusion. Une réparation ou un retrait ne doit pas être décidé à partir de ce rapport brut.

### C25 La règle typographique change de nature selon le support

La [philosophie](../../packages/core/PHILOSOPHY.md), ligne 104, autorise les tirets et emojis porteurs de sens, cite `void-commit-discipline` et exclut explicitement un blocage CI. [void-commit-discipline](../../packages/core/skills/void-commit-discipline/SKILL.md), lignes 55, 150 et 196, impose l'ASCII absolu comme « harness invariant » et annonce un hook bloquant.

**Correction proposée.** Aligner le skill sur la doctrine, ou rendre explicite une règle plus stricte propre aux commits avec sa justification. Ne pas présenter une règle de goût contextualisée comme un invariant mécanique universel déjà décidé.

## Écarts secondaires et hypothèses non retenues

- [void-audit](../../packages/core/skills/void-audit/SKILL.md), description ligne 3, annonce les dépréciations upstream et conflits de matrice, alors que [audit.ts](../../packages/cli/src/commands/audit.ts), lignes 7–8, et la philosophie les décrivent comme extensions futures. Cela limite ce que la commande peut couvrir pour le présent audit sémantique.
- [RELEASING.md](../RELEASING.md), ligne 5, conserve la qualification « pre-1.0 » dans un checkout dont les manifestes sont en 4.0.0.
- La règle d'[AGENTS.md](../../AGENTS.md) sur `kind` dans le frontmatter mérite clarification : la métadonnée se trouve désormais dans `harness.yaml`, explicitement séparé du SKILL portable. Ce n'est pas une absence de métadonnée constatée.
- Les mentions « fourni par le pack » pour UI, logger, env et autres composants méritent un inventaire contractuel séparé. Elles peuvent désigner une convention à matérialiser dans le projet ; elles ne sont pas comptées ici comme autant de bugs d'exports sans vérifier cette intention.
- Les différences de formulation Codex/Claude attendues, les ADR supersédés et les visions historiques non exécutables ont été exclus du décompte principal.

## Vérifications effectuées

| Vérification | Résultat observé | Ce que cela prouve |
|---|---|---|
| `pnpm sync:docs` | Succès, 14 sections | Parité de titres après normalisation, pas identité sémantique des corps |
| `pnpm sync:philosophy` | Succès, 218 lignes | Identité des deux philosophies source, pas cohérence avec l'installation locale |
| `pnpm anti-bloat:check` | Succès, un advisory de description | Tailles, syntaxe shell, noms, sourcing, présence des hooks déclarés |
| `pnpm skills:check-references` | Succès, 139 noms connus | Résolution des références contrôlées, pas exactitude des promesses |
| `pnpm skills:register-check` | Succès, registre frais | Fraîcheur du registre, 14 skills nommés depuis le code |
| `pnpm version:check` | Succès, 12 fichiers à 4.0.0 | Lockstep des manifestes de ce checkout |
| Tests skills/agents/références/philosophie | 22 fichiers, 599 tests passants | Contrats actuellement testés sur ces surfaces |
| Tests ciblés des gardes | 4 fichiers, 64 tests passants | Contrats actuellement testés pour TDD, dépendances, push et qualité |
| Comparaison core → miroir npm | 251 fichiers communs identiques | Aucun écart d'octets dans les fichiers communs ; les exclusions de build ne sont pas déclarées manquantes |
| Empreintes de l'installation | 142 fichiers conformes au manifeste 6.0.0 | Intégrité locale des fichiers listés |
| `void-machine doctor` | Succès du **self-host doctor** | Artefact isolé, 133 fichiers vérifiés, découverte, hooks, replay et smokes runtimes ; pas diagnostic global de cohérence des instructions |
| `void-machine audit` | Succès, 28 071 événements, 31 sessions humaines, 456 sessions synthétiques exclues | Observation d'usage selon ses limites ; aucune proposition appliquée ou publiée |

Commande des 599 tests :

```sh
pnpm exec vitest run test/skills test/agents test/skill-references test/sync-philosophy --maxWorkers=2
```

Commandes réellement exécutées pour les gardes :

```sh
pnpm exec vitest run packages/hook-runner/src/rules/tdd-order.test.ts packages/hook-runner/src/rules/boundary-direction.test.ts packages/hook-runner/src/rules/no-focused-test.test.ts test/block-protected-push/block-protected-push.test.ts --maxWorkers=1
pnpm exec vitest run packages/hook-runner/src/rules/quality-rules.test.ts --maxWorkers=1
```

La première commande a exécuté **3 fichiers et 57 tests**, car `no-focused-test.test.ts` n'existe pas et Vitest a ignoré ce filtre. Le constat a été relevé puis complété avec le vrai fichier `quality-rules.test.ts` : **1 fichier et 7 tests**. Aucun succès n'est attribué au fichier absent.

Les sondes ont appelé le bundle source existant, sans build : `node packages/core/hooks/_void-hook.mjs enforce-ci no-focused-test <chemin>` avec le texte à analyser sur stdin ; pour C01, `node packages/core/hooks/_void-hook.mjs enforce <règle> claude` avec l'événement JSON `Bash` sur stdin. Les chaînes shell n'ont pas été exécutées. Les preuves du webhook et du wrapper sont des traces de contrat/code, pas des tests de production exécutés.

La suite complète `pnpm test`, les workflows GitHub et une régénération `pnpm derive` n'ont pas été exécutés. `derive --check` régénère des fichiers avant comparaison ; il aurait modifié ce checkout d'audit. Aucun résultat global vert n'est donc revendiqué.

## Ordre de correction proposé

1. **Fixer le sujet et l'autorité.** Décider quelle révision doit être maintenue et réconcilier les instructions actives du checkout, du programme et de l'installation. Préserver toutes les modifications utilisateur ; ne pas remplacer le floor publié par des sources non livrées.
2. **Traiter C01 à C03.** Écrire les contre-exemples exécutables au niveau du branchement des hooks et des contrats webhook, puis corriger les exemples et mécanismes concernés.
3. **Unifier les protocoles opérationnels.** Consentement, armement, ownership des pushes/PR, unité du budget de revue, progression et conservation des preuves doivent chacun avoir une autorité nommée. Les autres documents y renvoient.
4. **Aligner les garanties annoncées.** Séparer « règle conseillée », « prédicat disponible », « hook câblé », « contrôle exécuté » et « preuve obtenue ». Générer les descriptions mécaniques depuis leurs propriétaires quand c'est possible.
5. **Protéger les migrations suivantes.** Tester les exemples canoniques exécutables et les variantes de runtime, vérifier les références de configuration et conserver des cas de contradiction issus de cet audit. Les checks de taille, noms et titres restent utiles, mais ne remplacent pas la revue sémantique des règles.

Ce rapport n'autorise ni merge, ni publication, ni modification silencieuse de doctrine. Les corrections peuvent être organisées par contrat plutôt que par fichier, afin qu'une même règle soit rectifiée dans tous ses supports au même moment.
