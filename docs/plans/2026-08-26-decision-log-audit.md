# Audit du journal de décisions - 2026-08-26

## Objet

Cet audit répond à deux questions : le journal de décisions peut-il être simplifié sans perdre
l'historique, et quelles références doivent être corrigées lors du remplacement de
`.void/active.md` par `.void/program.md` ?

L'audit couvre les 151 fichiers de `docs/decisions-log/`, leur contrat, leur statut, leur graphe
de supersession, leurs références entrantes versionnées et les chemins de dépôt cités dans leur
corps. Il ne juge pas qu'une décision est obsolète uniquement parce que son implémentation a été
renommée.

## Inventaire observé

| Signal | Valeur |
|---|---:|
| Décisions valides | 151 |
| Acceptées | 146 |
| Proposées | 5 |
| Contrat actuel avec frontmatter v1 | 55 |
| Entrées legacy importées | 96 |
| Décisions déclarant une supersession | 6 |
| Cibles déjà supersédées | 8 |
| Fichiers dépassant la cible éditoriale de 100 lignes | 4 |
| Lignes totales | 7 288 |

`void-harness decisions check --json` valide les 151 entrées. Les 55 ADR au contrat actuel
contiennent tous les cinq blocs attendus : contexte, décision, conséquences, alternatives et coût
de réversibilité.

Les références externes stables sont rares : hors journal et projection legacy, seuls quelques
specs, plans et documents pointent vers un identifiant ou un fichier ADR. Une suppression ou un
renommage reste néanmoins dangereux parce que ces références sont précisément les portes d'entrée
utiles du journal.

## Conclusion de simplification

Les fichiers acceptés ne doivent pas être fusionnés, renommés ou supprimés en masse. Le journal
physique est l'historique auditable ; le simplifier en réécrivant les décisions mélangerait ce qui
avait été décidé avec ce qui est vrai aujourd'hui.

La simplification sûre se fait à trois endroits :

1. corriger en place les références de dépôt qui ont seulement été déplacées ou renommées ;
2. disposer les cinq propositions encore ouvertes ;
3. rendre la supersession visible dans la projection afin qu'une décision remplacée ne se présente
   plus comme le choix courant.

Une nouvelle décision n'est pas créée pour enregistrer un simple changement de chemin. Une
évolution de choix, de justification, de portée ou de conséquences reste une supersession.

## Groupe programme et reprise

Trois ADR portent aujourd'hui le même arc :

- `adr:4f0cad51-1167-4b04-9d5d-a9c1c1605d26`, pointeur de programme avec progression Linear ;
- `adr:4152e915-f0f8-4763-888e-2bddd66da5a3`, continuité du programme livrée aux consommateurs ;
- `adr:b93f13a9-3877-480d-a722-39476f93d84d`, handoff de session, encore proposé.

La simplification retenue n'ajoute pas de quatrième fichier. L'ADR de handoff proposé devient la
décision courante sur le contrat de programme, le checkpoint et la reprise ; il supersède les deux
ADR acceptés dont la dépendance au tracker change réellement. Les deux anciens fichiers restent
lisibles comme historique, et leurs seules références de chemin sont migrées mécaniquement vers
`.void/program.md`.

## Disposition des cinq propositions

| ADR proposé | Preuve actuelle | Disposition proposée |
|---|---|---|
| Handoff de session `b93f...` | `checkpoint`, `resume` et le nouveau besoin de bootstrap convergent | Amender, faire approuver, accepter et superséder les deux ADR de programme |
| Spécialistes canoniques `5e48...` | Déjà ciblé par la supersession de `9138...` | Passer à `superseded` ; aucun nouveau contenu |
| Contrôleur de team review `5a59...` | Contrôleur, review loop et tests existent dans `packages/mission-engine` | Accepter après validation explicite de cette disposition |
| Sessions natives headless `2c2b...` | Adaptateurs spécialistes et documentation d'architecture existent | Accepter après validation explicite de cette disposition |
| Reprise par reçus `14b9...` | Recovery, reçus et idempotency keys sont implémentés et testés | Accepter après validation explicite de cette disposition |

Après disposition, aucune proposition ancienne ne reste silencieusement ouverte.

## Migrations de références certaines

Vingt-quatre occurrences dans les ADR ont un équivalent actuel non ambigu. Elles peuvent être
modifiées sans toucher au raisonnement :

| Ancienne référence | Référence actuelle |
|---|---|
| `plans/ACTIVE.md` | `.void/program.md` |
| `plans/<plan existant>` | `docs/plans/<même plan>` |
| `plans/skill-audits/ui-review.md` | `docs/plans/skill-audits/void-ui-review.md` |
| `.void/PHILOSOPHY.md` | `.void/installed/PHILOSOPHY.md` |
| `.void/generated/current` | `.void/machine/generated/current` |
| `.void/local/receipts/install-v1.json` | `.void/machine/receipts/install-v1.json` |
| `.void/local/runs/` | `.void/machine/runs/` |
| `packages/core/skills/tdd` | `packages/core/skills/void-tdd` |
| `packages/core/skills/adr-workflow` | `packages/core/skills/void-decide` |
| `packages/harness-graph/certification.json` | `packages/core/data/certification.json` |
| `scripts/prepare-data.ts` | `apps/graph-studio/scripts/prepare-data.ts` |

Les chemins d'artefacts runtime absents du checkout parce qu'ils sont gitignorés ne sont pas des
liens cassés. Les noms de systèmes retirés, comme `.void/harness-feedback/` ou
`packages/core/commands/`, restent dans les décisions qui expliquent précisément leur retrait.
Les remplacer par leur successeur falsifierait l'alternative historique et sort donc du périmètre
d'une migration mécanique.

## Garde-fou à faire évoluer

Le contrôle actuel bloque tout octet modifié dans un ADR accepté. Il doit conserver ce défaut
fermé pour les suppressions, renommages et modifications sémantiques, mais reconnaître une
migration de référence bornée :

- frontmatter, titres et structure inchangés ;
- seuls une destination de lien local ou un chemin local délimité peuvent changer ;
- la nouvelle cible doit rester dans le dépôt et exister ;
- toute autre différence continue d'exiger une supersession.

La doctrine, `void-decide`, `docs/CONTRIBUTING.md`, `AGENTS.md` et `CLAUDE.md` doivent porter la
même règle. Le contrôle et ses tests sont la preuve que l'exception ne devient pas une autorisation
générale de réécrire l'histoire.

## Ce que l'audit déconseille

- Supprimer les 96 entrées legacy : leurs identifiants et liens datés sont encore la trace des
  décisions antérieures au contrat v1.
- Réécrire un ancien nom de composant lorsqu'il désigne réellement le système de l'époque.
- Créer un ADR de migration pour chaque renommage : cela recrée exactement la dilution que
  l'exception de référence doit éviter.
- Déduire automatiquement qu'un ADR est obsolète depuis l'absence d'un chemin : un artefact peut
  être généré, gitignoré, externe ou volontairement retiré.

## Preuves rejouables

```sh
node packages/cli/bin/void-harness.mjs decisions check --json
node packages/cli/bin/void-harness.mjs decisions render --format json
git grep -n 'plans/ACTIVE.md\|.void/active.md' -- docs/decisions-log
```

Ces commandes observent respectivement la validité structurelle, les statuts et supersessions, puis
les références du groupe programme. La vérification finale devra aussi prouver qu'aucune référence
versionnée à `.void/active.md` ou `plans/ACTIVE.md` ne subsiste hors des fixtures explicites de
compatibilité.
