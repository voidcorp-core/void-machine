---
title: Continuité mécanique du contexte
date: 2026-08-27
status: approved
author: Folpe + Codex
ticket: DEV-651
related:
  - docs/backlog-audit-prime-agent.md
  - docs/brief-contexte-mecanique.md
  - docs/plans/skill-audits/void-checkpoint.md
  - docs/specs/2026-08-26-program-resume-contract.md
---

# Continuité mécanique du contexte

## Résumé

La continuité de contexte devient un contrat hybride : le harnais garantit les faits
mécaniques qu'il peut observer, tandis que le modèle reste responsable du résidu sémantique
qu'aucun hook ne peut déduire honnêtement.

Un handler commun à Claude Code et Codex suit la progression du transcript et le working set,
demande un `void-checkpoint` à 50 % de la fenêtre lorsqu'un dénominateur fiable existe, scelle
l'état mécanique avant une compaction annoncée, puis réinjecte une reprise explicitement
complète ou dégradée. Le harnais ne déclenche jamais `/clear` ou `/compact`.

Le point 5 de `docs/backlog-audit-prime-agent.md`, le suivi cumulatif des fichiers, est absorbé
dans cette spec. Il partage le même état, les mêmes événements et les mêmes garanties que le
point 1 ; une seconde mécanique créerait deux réponses à la même question.

## Problème

`void-context` recommande aujourd'hui de maintenir l'usage effectif autour de 40 à 60 %, mais
aucun mécanisme ne l'observe. `void-checkpoint` sait écrire l'objectif, les impasses, les
hypothèses, les preuves et la prochaine action, mais son invocation reste un geste humain ou
un geste du modèle.

Les runtimes imposent trois limites :

1. aucun hook ne peut déclencher `/clear` ou `/compact` ;
2. aucun hook ne reçoit directement un pourcentage de remplissage ;
3. un `/clear` n'a aucun événement préalable, contrairement à une compaction qui expose
   `PreCompact`.

Le cycle initialement visé, seuil puis checkpoint puis vidage puis reprise, ne peut donc pas
être garanti en entier. Prétendre le contraire transformerait une limite de runtime en faux
contrat.

## Objectifs

- Garantir un état mécanique borné avant chaque compaction annoncée.
- Conserver cumulativement les fichiers lus et modifiés à travers compactions, `/clear`,
  reprises et redémarrages.
- Demander une mise à jour sémantique une seule fois par cycle lorsqu'un seuil fiable est
  observable.
- Reprendre automatiquement en nommant la complétude ou la dégradation.
- Fonctionner de façon symétrique sur Claude Code et Codex.
- Rester dans le budget de latence existant du hook runner.
- Garder un seul fichier de checkpoint et une seule chaîne d'autorité.

## Non-objectifs

- Déclencher ou simuler `/clear` ou `/compact`.
- Inventer une fenêtre de contexte à partir d'un nom de modèle.
- Ajouter un catalogue de modèles ; le point 9 de l'audit reste différé.
- Appeler un LLM depuis un hook dans cette livraison.
- Ajouter un daemon, un sidecar, un second checkpoint ou un nouveau sous-système.
- Envoyer un transcript, un chemin de fichier ou un état de checkpoint hors de la machine locale.
- Garantir la sémantique après un `/clear` brutal sans checkpoint récent.
- Utiliser `Stop`, `SessionEnd` ou `PostCompact` pour cette mécanique.

## Pourquoi l'automatisation devient acceptable

La note `docs/plans/skill-audits/void-checkpoint.md` refuse un checkpoint automatique sur
`Stop`, car cet événement ne distingue pas une interruption, une limite de contexte et un tour
terminé. Ce motif reste valide.

`PreCompact` est différent : il annonce une compaction réelle. Le hook n'infère pas une
intention de fin de session et n'écrit pas une prochaine action ; il préserve uniquement des
faits observés avant une perte de contexte connue. L'implémentation devra créer un ADR dédié
avec `void-harness decisions new`, puis mettre à jour la référence de la note d'audit dans le
même commit. Elle ne réécrit pas un ADR accepté existant.

## Contrat hybride

### Garantie mécanique

Le harnais possède :

- la dernière observation de tokens exploitable ;
- les 20 derniers chemins uniques lus ;
- les 20 derniers chemins uniques modifiés ;
- l'overflow explicite de chaque liste ;
- la révision mécanique du travail ;
- la révision couverte par le dernier checkpoint sémantique ;
- le fait qu'un nudge a déjà été émis dans le cycle courant ;
- les faits dont le `ResumeBundle` dérive une reprise complète ou dégradée.

### Autorité sémantique

`void-checkpoint` possède :

- l'objectif et sa position dans le travail global ;
- l'état réellement prouvé ;
- les boucles ouvertes ;
- les impasses ;
- les hypothèses non vérifiées ;
- une prochaine action exacte.

Le hook n'invente, ne complète et ne reformule aucun de ces champs.

### Extension LLM différée

Un LLM dans le hook reste la cible idéale pour produire automatiquement le résidu sémantique.
Cette livraison ne crée ni port LLM, ni credentials, ni politique de coût, ni envoi de contenu.
Le seam d'extension est le format de checkpoint : un futur enrichisseur pourra produire les
mêmes sections sémantiques sans changer le contrat de reprise.

## Architecture

### Manifests runtime

Les manifests ne font que câbler les événements communs vers un handler nommé
`context-continuity`. Ils ne portent aucune décision métier et aucune logique de format.

### `hook-runner`

Le hook runner possède :

- la normalisation des payloads Claude Code et Codex ;
- la lecture incrémentale et bornée du transcript ;
- l'extraction des chemins depuis les événements d'outils connus ;
- le verrou, la lecture et le remplacement atomique du bloc mécanique ;
- l'émission des sorties natives du runtime ;
- le journal local de succès, skip et dégradation.

Il étend les modules de cycle de vie existants et n'introduit qu'un handler public.

### `mission-engine`

Le moteur possède les fonctions pures :

- normaliser et borner une observation ;
- fusionner les chemins en ordre de récence ;
- décider si une observation avance `work_revision` ;
- décider si le seuil autorise un nudge ;
- décider si une reprise est complète ou dégradée ;
- fusionner un bloc mécanique sans modifier le reste du Markdown.

Les formats de transcript et les primitives de fichiers n'entrent pas dans le moteur.

### État local unique

`.void/machine/checkpoint.md` reste l'unique état de continuité. Aucun sidecar n'est créé.
Le fichier est observé, local et gitignoré ; il ne devient ni état de programme ni état de
tracker.

## Format du checkpoint

Le Markdown conserve les sections sémantiques actuelles. Le hook ajoute un bloc délimité
unique :

````markdown
<!-- void-harness:context-continuity:begin -->
## Mechanical context

```yaml
schema_version: 1
objective_hash: sha256:...
work_revision: 18
semantic_revision: 17
sealed_work_revision: 17
nudge_emitted: true
transcript_fingerprint: sha256:...
transcript_cursor_bytes: 42891
last_measurement_at_ms: 1787846400000
read_files_overflow: 3
modified_files_overflow: 0
```

### Read files

- packages/mission-engine/src/session/checkpoint.ts

### Modified files

- docs/specs/2026-08-27-mechanical-context-continuity.md
<!-- void-harness:context-continuity:end -->
````

Règles :

- zéro bloc : le hook peut en ajouter un ;
- exactement un bloc bien formé : le hook peut le remplacer ;
- plusieurs blocs, une borne manquante ou un ordre ambigu : le hook refuse d'écrire ;
- le remplacement se fait sous verrou borné puis par fichier temporaire dans le même dossier
  et renommage atomique ;
- l'ancien fichier reste intact si une étape échoue ;
- les timestamps ne décident jamais de la fraîcheur sémantique. Ils servent uniquement à
  limiter la fréquence des mesures.

Le curseur est lié à une empreinte du `transcript_path`. Quand l'empreinte change, la lecture
reprend à zéro sur le nouveau transcript sans réinitialiser la chaîne cumulative du checkpoint.
Un transcript est lu via un descripteur borné sans suivi de lien symbolique. Son chemin canonique
doit rester dans le projet. Claude Code peut aussi utiliser son répertoire de transcript propre au
projet lorsque l'identifiant de session est borné et correspond exactement au nom de fichier.
Codex ne dispose pas ici d'une provenance externe équivalente : ses transcripts externes sont
ignorés.

## Configuration

La configuration optionnelle vit dans `.void/config.json` :

```json
{
  "context": {
    "windowTokens": 200000,
    "checkpointThresholdPercent": 50
  }
}
```

- `windowTokens` est un entier strictement positif et sert seulement lorsque le runtime ne
  fournit pas une fenêtre exploitable ;
- `checkpointThresholdPercent` est un entier entre 40 et 60 inclus ;
- sa valeur par défaut est 50 ;
- une valeur invalide est diagnostiquée par le schéma de configuration et n'est jamais clampée
  silencieusement ;
- sans fenêtre runtime ni `windowTokens`, aucun pourcentage n'est calculé et aucun nudge de
  seuil n'est émis.

Le nom du modèle seul n'est pas un dénominateur. Aucun tableau implicite de fenêtres n'est
maintenu dans cette fonctionnalité.

## Mesure du contexte

L'adaptateur extrait la dernière entrée de `usage` complète depuis le curseur, sans interpréter
ni journaliser le prompt ou la réponse. Il normalise :

```text
used_tokens = input + cache_read + cache_creation + output
usage_ratio = used_tokens / window_tokens
```

La dernière observation complète représente le contexte de l'appel le plus récent. Les
compteurs ne sont pas additionnés entre appels pour mesurer le remplissage : cette somme serait
un coût de session, pas une occupation de fenêtre.

Le transcript peut avoir un tour de retard. Ce retard rend le nudge tardif, jamais précoce. Une
observation identique à la précédente n'avance pas la révision et ne réémet rien.

## Cycle d'événements

| Événement | Action |
|---|---|
| `UserPromptSubmit` | Mesure principale, une fois par tour ; décide éventuellement le nudge. |
| `PostToolUse` | Fusionne les chemins ; remesure seulement si le transcript a progressé et si le cooldown est écoulé. |
| `PreCompact` | Tente une dernière observation, scelle le bloc mécanique, ne bloque jamais la compaction. |
| `SessionStart:compact` | Compose la reprise et réarme le nudge du nouveau cycle. |
| `SessionStart:clear` | Avance la révision, réarme le cycle et force une reprise dégradée avec reconstruction avant mutation. |
| autres `SessionStart` | Compose la reprise depuis le checkpoint et Git sans inventer d'état distant. |

`PostToolUse` ne remesure pas avant 5 000 ms depuis la dernière mesure. `UserPromptSubmit` et
`PreCompact` ignorent ce cooldown. Le coût est ainsi borné sans retarder la mesure principale
d'un tour.

## Révisions et complétude

`work_revision` avance uniquement lorsqu'une observation nouvelle modifie les tokens observés,
le working set, l'état de cycle ou la source de reprise. Un événement dupliqué n'avance rien.

Après une écriture réussie du checkpoint sémantique, le `PostToolUse` suivant reconnaît le
chemin `.void/machine/checkpoint.md` et copie atomiquement :

```text
semantic_revision = work_revision
```

Le modèle ne modifie donc jamais directement le bloc mécanique.

`void-checkpoint` conserve la section `Objective` à l'identique tant que l'objectif ne change
pas. Une modification de cette section est la déclaration autoritaire d'un nouvel objectif.
Le hook compare son hash au `objective_hash` précédent ; en cas de changement, il ouvre une
nouvelle chaîne, vide les listes cumulatives, remet les overflow à zéro et aligne les deux
révisions sur la nouvelle base.

La continuité sémantique est :

```text
complete  si work_revision == semantic_revision et le bloc est valide
degraded  dans tous les autres cas
```

Les gaps existants du `ResumeBundle` restent applicables. La sortie ajoute un statut de
continuité et des raisons bornées ; elle ne copie pas un second état d'exécution.

## Nudge

Le nudge est émis lorsque toutes les conditions sont vraies :

- une fenêtre fiable est connue ;
- la dernière observation complète atteint le seuil configuré ;
- aucun nudge n'a été émis dans le cycle ;
- le checkpoint sémantique ne couvre pas déjà la révision courante.

Son contenu demande d'invoquer `void-checkpoint` avant de poursuivre une longue branche de
travail. Il ne prétend pas avoir compacté, ne bloque pas le prompt et ne se répète pas dans le
même cycle.

`SessionStart:compact` et `SessionStart:clear` réarment le nudge. Le `/clear` reste dégradé
jusqu'à ce qu'un nouveau `void-checkpoint` aligne les révisions.

## Reprise

Une reprise complète injecte les sections sémantiques et les faits mécaniques bornés.

Une reprise dégradée injecte ce qui est connu, nomme précisément les raisons et exige un tour
de reconstruction avant toute mutation. Elle n'invente jamais une prochaine action. Raisons
minimales :

- bloc mécanique absent ou ambigu ;
- `semantic_revision` en retard ;
- le dernier `PreCompact` ne scelle pas la révision de travail courante ;
- `/clear` non réconcilié.

Une fenêtre inconnue dégrade la capacité de nudge, pas nécessairement la reprise. Une erreur
d'écriture observée dégrade la sortie de l'invocation courante ; l'ancien checkpoint reste
l'autorité jusqu'à une écriture atomique réussie.

## Gestion des erreurs

- Une erreur de continuité ne bloque jamais un outil, un prompt ou une compaction.
- Une entrée invalide désactive seulement la décision qu'elle empêche.
- Un transcript absent, retardé, tronqué ou illisible conserve la dernière observation connue ;
  aucune estimation n'est inventée.
- L'acquisition du verrou n'attend jamais activement. Un verrou de moins de 1 000 ms fait
  abandonner l'écriture courante ; un verrou plus ancien est remplacé par le gagnant d'une élection
  de reprise exclusive, les autres invocations abandonnant sans attendre.
- Le verrou couvre la lecture, la décision et le remplacement ; une écriture sémantique invalide
  `sealed_work_revision` et seul un `PreCompact` réussi le remet à la révision courante.
- La mutation reste ancrée au descripteur du répertoire machine validé. Une écriture atomique
  échouée ferme et nettoie son fichier temporaire sans toucher à l'ancien checkpoint.
- Un bloc ambigu n'est jamais réparé automatiquement.
- Une même cause n'émet qu'un diagnostic local par cycle ; les répétitions restent silencieuses.
- Le `ResumeBundle` porte la dégradation visible au lieu de transformer l'erreur en succès.

## Performance

DEV-651 porte les budgets qu'il peut causalement garantir :

- p95 mural inférieur à 75 ms à chaud ;
- coût CPU incrémental p95 inférieur à 25 ms face au no-op du même bundle livré.

Le benchmark lance 25 processus frais sur le bundle livré complet pour le froid et répète un
scénario représentatif dans le même processus pour le chaud. Les processus frais mesurent aussi le
même bundle en no-op et un processus Node nu. Chacun rapporte son uptime et son temps CPU. Après
trois groupes de warm-up exclus, les 25 groupes mesurés alternent leur ordre. Les p95 muraux bruts
et leurs deltas restent diagnostiques : la contention du scheduler d'une CI partagée n'est pas
attribuée à la feature. Le delta des p95 CPU entre feature et no-op du même bundle gate DEV-651.
Les budgets globaux p95 froid inférieur à 150 ms et no-op/Node inférieur à 25 ms ne sont ni
supprimés ni attribués à cette feature : la baseline préexistante qui les dépasse est suivie dans
[DEV-662](https://linear.app/voidcorp/issue/DEV-662/reduire-le-cold-start-du-hook-runner-livre).

La lecture est incrémentale depuis `transcript_cursor_bytes` et ne dépasse jamais 1 048 576
octets par invocation. Si le delta est plus grand, l'adaptateur lit sa fin à partir de la
première ligne JSONL complète disponible, avance le curseur jusqu'à la fin et diagnostique les
octets sautés. Une entrée individuelle qui dépasse la borne est ignorée et diagnostiquée ;
aucun fallback ne relit le transcript entier sur le chemin interactif.

## Tests

### Noyau pur

- seuil juste sous, à et au-dessus de la limite ;
- fenêtre absente et configuration invalide ;
- nudge unique puis réarmement ;
- événement dupliqué sans nouvelle révision ;
- égalité et retard des révisions ;
- changement d'objectif et reset unique ;
- ordre de récence, déduplication, limite de 20 et overflow ;
- ajout, remplacement et refus d'un bloc ambigu sans toucher à la sémantique.

### Intégration hook runner

- fixtures Claude Code et Codex produisant la même observation normalisée ;
- transcript retardé, inchangé, tronqué, surdimensionné et malformé ;
- checkpoint absent, valide et ambigu ;
- concurrence, verrou abandonné et échec d'écriture ;
- ancien checkpoint intact après chaque échec ;
- aucune sortie ne bloque un événement runtime.

### Contrat et bout en bout

- manifests source et artefacts générés câblent les mêmes événements ;
- nudge puis checkpoint puis compaction donne une reprise complète ;
- compaction sans rafraîchissement sémantique donne une reprise dégradée ;
- `/clear` donne une reprise dégradée et exige la reconstruction ;
- benchmark chaud, froid et overhead sous les trois budgets.

Les tests étendent les suites existantes de `mission-engine` et `hook-runner`. Aucun framework ou
banc parallèle n'est ajouté.

## Modes TDD

- **Strict** : décisions pures de `mission-engine`, avec RED observé avant production ; mutation
  seulement si un runner est déjà configuré.
- **Souple** : I/O, adaptateurs runtime, verrouillage, manifests et tests de contrat.
- **Souple** : artefacts générés, documentation, dogfood et benchmarks.
- **Exploratoire** : aucune phase.

## Déploiement

Trois phases techniques forment une seule livraison publique :

1. étendre le contrat pur et le parseur de façon rétrocompatible ;
2. câbler le handler et les événements sur les deux runtimes, puis régénérer les artefacts ;
3. dogfooder dans le self-host isolé et un consommateur représentatif, vérifier performances et
   contrats, puis laisser Release Please publier.

Un ancien checkpoint sans bloc mécanique reste lisible et dégradé jusqu'à la première
observation. Il n'existe ni migration d'installation ni feature flag durable.

Le rollback retire le câblage des événements. Le bloc mécanique déjà écrit reste inerte et le
parseur tolérant l'ignore ; aucune migration inverse n'est requise.

## Critères d'acceptation

- [ ] `PreCompact` préserve un état mécanique sans bloquer Claude Code ni Codex.
- [ ] `SessionStart:compact` réinjecte une reprise complète ou dégradée et réarme le cycle.
- [ ] `SessionStart:clear` produit toujours une reprise dégradée avant réconciliation.
- [ ] Le seuil par défaut vaut 50 %, la configuration refuse toute valeur hors 40 à 60.
- [ ] Aucune fenêtre inconnue n'est remplacée par une valeur inventée.
- [ ] Un seul nudge est émis par cycle.
- [ ] Les 20 derniers chemins uniques lus et modifiés survivent aux compactions et redémarrages.
- [ ] L'overflow est explicite et borné.
- [ ] `void-checkpoint` préserve le bloc mécanique ; le hook préserve les sections sémantiques.
- [ ] Un nouvel objectif ouvre une nouvelle chaîne sans reset implicite par session ou branche.
- [ ] Une écriture concurrente ou échouée ne corrompt pas l'ancien checkpoint.
- [ ] Les deux runtimes passent la même matrice de contrat.
- [ ] Les trois budgets de latence sont prouvés sur la machine de référence.
- [ ] L'ADR `PreCompact` supersède explicitement la position de la note d'audit.

## Décisions rejetées

- **Tout automatiser avec un LLM dans le hook maintenant** : meilleur résultat sémantique, mais
  coût, credentials, confidentialité et récursion ne sont pas résolus.
- **Rester purement événementiel** : mécanique simple, mais aucun nudge avant un `/clear` brutal.
- **Déclencher sur `Stop`** : événement ambigu ; le refus existant reste valide.
- **Deux fichiers, sémantique et mécanique** : réconciliation et double source sans bénéfice.
- **Réécrire tout le checkpoint** : risque de perte silencieuse des sections de l'autre auteur.
- **Catalogue implicite modèle vers fenêtre** : duplique le point 9 différé et devient vite faux.
- **Feature flag durable** : double les chemins de maintenance alors que le format est
  rétrocompatible et le rollback mécanique.

## Limites assumées

- Le nudge dépend du modèle : il peut être ignoré.
- Le transcript peut retarder la mesure d'un tour.
- Sans fenêtre fiable, seul le filet `PreCompact` est disponible.
- Un `/clear` brutal peut perdre le résidu sémantique depuis le dernier checkpoint.
- La liste de fichiers est un working set borné, pas un historique exhaustif.
- Le harnais ne possède pas le runtime et ne peut promettre une compaction qu'il ne déclenche pas.
