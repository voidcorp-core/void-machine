# Harnais, Machine et Cortex : réconciliation stratégique et backlog

Date : 1er octobre 2026.
Statut : analyse et propositions de frontière produit, non adoption d'une nouvelle architecture.
Périmètre : code, documentation, PR/releases et Linear relus ; synchronisation du tracker autorisée par Folpe.

## 1. Verdict corrigé

**Garder le produit d'aide au code. Réduire l'ambition de moteur généraliste. Séparer les responsabilités avant les dépôts.**

L'[audit initial](../2026-10-01-audit-architectural-strategique-void-machine.md) décrit correctement le risque de duplication des runtimes. Il ne démontre pas que le harnais de développement est inutile. La portabilité des conventions, les contrôles utiles et les preuves de livraison peuvent rester utiles avec un agent dix fois meilleur. Leur valeur marginale doit cependant être mesurée, et chaque contrôle sans bénéfice doit pouvoir disparaître.

Le rapprochement avec les docs et Linear apporte une correction importante : le recours aux capacités natives, la séparation de la verticale développement et l'autonomie de Cortex étaient déjà explicitement recherchés. Ce ne sont pas des nouveautés à reticketter. Le problème est l'accumulation de versions de la cible et de critères périmés dans le backlog.

## 2. Sources, dates et limites

- Checkout principal : `develop`, `ae47db4c77a7ebce6070d7230a099a1a5d99cb46`, volontairement en retard pendant le travail 4.1. Aucune avance de branche effectuée.
- Code intégré inspecté : référence locale `origin/develop`, `f55c4bda116724e126b53fb762651e947c1e61c2`. Les sources des tranches 4.1 ont été lues avec `git show origin/develop:...`, sans les confondre avec le checkout.
- GitHub interrogé en direct : [v4.0.0](https://github.com/voidcorp-core/void-machine/releases/tag/v4.0.0) publiée le 25 septembre ; [#442](https://github.com/voidcorp-core/void-machine/pull/442) fusionnée le 30 septembre ; [#426](https://github.com/voidcorp-core/void-machine/pull/426) seule PR ouverte observée lors du relevé, promotion vers `main`.
- Linear lu dans l'interface connectée : projet [Void Machine](https://linear.app/voidcorp/project/void-machine-053d44aca843/overview), tickets actifs visibles, unités de fondation, de release et de valeur, commentaires de DEV-833/926/934, recherche transverse Cortex/Machine et tickets concernés.
- L'index local `.void/machine/linear-index/INDEX.md` annonce un relevé complet du 12 septembre et une actualisation du 15 septembre. Il n'a pas servi à décider un statut courant et n'a pas été présenté comme actualisé.
- La worktree DEV-929 et ses tests rapportés dans le checkpoint ne valent ni PR fusionnée ni preuve consommateur. Aucun de ces tests n'a été réexécuté pour cette analyse documentaire.

Le relevé ne constitue pas une recertification des centaines de tickets historiques, des installations clientes ou des garanties de sécurité des fournisseurs. Les constats de bugs de DEV-934 sont des observations rapportées à reproduire avant correction.

### Documents directeurs relus

| Source | Ce qu'elle dit réellement | Conséquence |
|---|---|---|
| [Vision Machine](../VOID-MACHINE-VISION.md) | Capacités natives d'abord ; verticale développement ; état opérationnel propre ; raisonnement délégué | Conserver cette séparation déjà voulue ; ne pas recréer une boucle LLM |
| [Vision Déclic du 13 septembre](../DECLIC-MACHINE-VISION-2026-09-13.md) | Cortex possède la connaissance personnelle ; Machine reçoit le nécessaire. Ambition plus large : coordinateur, missions générales, Google, hébergement et provisionnement | La cible généraliste doit être réarbitrée ; elle n'est pas livrée par sa présence dans une vision |
| [Spec TypeScript](../specs/2026-09-19-void-machine-typescript-port.md) | Core indépendant de Git et du métier ; spécialités séparées ; aucun framework ou scheduler sans besoin | Le harnais n'a pas à entrer dans le contrat Cortex/Machine |
| [Plan de fondation TS](../plans/2026-09-20-void-machine-typescript-foundation-plan.md) | Note sourcée et reprise bornée prouvées ; Rust retiré ; nombreuses sections plus anciennes conservées | Son vocabulaire de « port restant » et les receipts historiques ne sont pas un ordre d'exécution actuel |
| [Patterns externes](2026-09-22-void-machine-external-patterns.md) | Réutilisation sélective ; refus de reconstruire les fonctions suffisantes des runtimes | L'audit stratégique renforce une direction déjà présente |
| [Contexte de déploiement](../DEPLOYMENT-CONTEXT.md) | Trois formes : Cortex seul, Machine seule, ensemble. Cible Machine sandboxée dans l'instance client ; endpoint de modèle Cortex proposé | L'option locale n'est pas la seule forme envisagée. Séparer besoin de contrôle, lieu d'exécution et possession d'un moteur |
| [Plan 4.1](../plans/2026-09-28-release-4-1-delegation-and-autonomous-merge-plan.md) | Délégation native, présentation distincte, merge avec retenue humaine, preuve consommateur | Finir les preuves existantes ne justifie pas de relancer une fondation générale |

Certains ADR cités par ces documents portent encore `status: proposed`, même lorsque du code associé a été fusionné. Cette analyse distingue donc comportement livré, intention de Folpe et statut formel des décisions. Elle ne modifie aucun ADR accepté ni ne transforme une proposition en décision.

## 3. État du code et propriété cible

| Ensemble | État et responsabilité observés | Propriétaire recommandé |
|---|---|---|
| `packages/core`, packs | Skills, spécialistes, doctrine de développement, configurations natives | Produit harnais de développement |
| `packages/cli` | Distribution, installation, doctor, maintenance et commandes de livraison | Harnais ; garder les commandes d'exécution distinctes |
| `packages/mission-engine` | Choix de spécialistes, contrôles et preuves autour du code | Harnais. Aucun import à imposer à Cortex |
| `packages/hook-runner` | Contrôles et observation dans les runtimes consommateurs | Harnais, limités aux garanties réellement observables |
| `packages/harness-graph`, Graph Studio | Catalogues, connaissance du projet de code, projections de supervision | Outils facultatifs du harnais ; pas mémoire personnelle de Cortex |
| `packages/void-machine/src/core/mission.ts` et `runtime/mission.ts` | Pipeline borné, admission, journal, reprise et états inconnus | Réutilisable seulement si un appelant concret exige cette garantie |
| `core/delegation.ts`, `runtime/delegation.ts` | Runs Claude/Codex, résultats liés à des sessions, vie des délégations | Adaptation native partagée avec le harnais ; pas contrat métier universel |
| `adapters/runtime/claude-session.ts`, `codex-daemon.ts`, `codex-thread.ts` | Superviseurs et protocole natifs | Adaptateurs remplaçables |
| `adapters/presentation/*` | Herdr, tmux, cmux, absence de surface | Présentation facultative ; aucune autorité d'exécution |
| `verticals/sourced-note` | Démonstrateur borné de traitement de sources | Exemple/preuve ; pas justification d'une plateforme documentaire |
| Runtime, contexte et modèle personnel Cortex | Application autonome, sans import de production Machine constaté dans l'audit | Cortex |

### Limites précises du contrat existant

Au code intégré, `core/delegation.ts` fixe `RuntimeName` à Claude/Codex. `AgentRunRequest` porte notamment `cwd`, `brief`, rôle, mission et ticket facultatif. `RunResult` porte un texte, une session, un tour éventuel et la conformité au schéma. Cela sert une délégation native de développement ; cela ne décrit pas un effet métier autorisé et prouvé.

Ne pas faire grossir ce contrat jusqu'à absorber envoi de mail, lecture Drive et paiement. Le contrat d'action côté Cortex doit pouvoir appeler une API directe sans adopter le registre des agents du harnais. Une sortie JSON conforme ne prouve pas l'effet déclaré. Le journal local mono-utilisateur ne devient pas un service de confiance multi-client par ajout d'un identifiant client.

## 4. Comparaison sévère à l'audit initial

| Point de l'audit | Réconciliation | Traitement |
|---|---|---|
| Machine ne doit pas refaire le runtime | Déjà écrit dans la vision et illustré par l'abandon de #441 pour #442 | Conserver ; corriger les tickets restés sur l'ancienne solution |
| Séparer métier et moteur | Déjà prévu par les couches et la verticale développement | Prouver sur les appelants ; pas nouveau framework de couches |
| Le harnais n'appartient pas au runtime minimal | Correct ; cela ne signifie pas qu'il n'a plus de valeur comme produit autonome | Mesurer via DEV-451 ; décider la frontière produit |
| Uniquement local | Trop restrictif comme règle absolue : l'instance client et ses garanties peuvent justifier une exécution hébergée maîtrisée | Retenir le besoin d'accès ou de contrôle, pas un emplacement obligatoire |
| Cortex route vers des runtimes interchangeables | Bonne cible ; double routage sémantique possible avec le coordinateur Machine de la vision | Cortex décide la route métier ; adaptation opérationnelle limitée au contrat |
| ActionContract et résultat robuste | Déjà un chantier Cortex DEV-956 | Un propriétaire ; contributions Machine liées, pas deuxième contrat concurrent |
| Test d'un runtime externe/local | Déjà DEV-957, bloqué par DEV-956 et le contexte autorisé | Réutiliser le spike, ne pas inventer une API Dots |
| Sécuriser Machine dans une instance | Déjà DEV-893, volontairement différé côté Cortex | Protection obligatoire avant activation de l'usage, pas chantier à dupliquer |
| Retrait de Machine sans casser Cortex | Aucune dépendance de production démontrée ; DEV-779 avait déjà rejeté l'import de mission-engine | Conserver l'autonomie existante ; ne pas attribuer un couplage imaginaire |
| Supprimer les couches sans valeur | Le noyau Rust et le cluster engine ont déjà été retirés ; le backlog conserve leurs solutions | Annuler les solutions obsolètes sans déclarer leurs preuves obtenues |

## 5. Garder un projet pour coder : oui, sous conditions

### La valeur qui peut durer

- Des conventions propres au projet, compréhensibles et transportables entre runtimes.
- Des vérifications mécaniques lorsque leur bénéfice dépasse leur coût et leurs faux positifs.
- Des preuves de qualité et de livraison liées au travail réellement produit.
- Une expérience cohérente de maintenance, mise à jour et retrait pour l'utilisateur.

### Ce qui doit décroître quand les fournisseurs progressent

- Lancement et supervision maison si le runtime fait déjà le travail.
- Duplication des sessions, mémoire conversationnelle, outils de navigation et planification.
- Multiplication systématique des spécialistes et revues pour une petite modification.
- Cérémonies qui bloquent une mission sans voie de reprise : DEV-934 documente précisément ce coût.

Le projet ne doit pas se vendre comme « un agent plus intelligent ». Sa proposition testable est : **obtenir un changement fiable avec moins de corrections et moins d'interventions, à coût total acceptable**. Si le runtime seul atteint ce résultat, retirer la couche supplémentaire est une réussite architecturale.

### Trois options

| Option | Bénéfice | Coût/risque | Verdict |
|---|---|---|---|
| Garder un seul produit Machine généraliste | Une marque et une distribution | Confond besoins du développeur et bras d'exécution Cortex ; entretient l'ambition de plateforme | Rejet comme direction par défaut |
| Deux responsabilités produit, dépôt actuel conservé au départ | Frontières vérifiables, installation existante préservée, coût de migration faible | Nécessite des entrées et propriétaires clairement distincts | **Recommandée** |
| Extraire immédiatement le harnais dans un second dépôt | Identités commerciales et releases indépendantes | Historique, CI, assets générés, versions, paquet npm et utilisateurs à migrer ; possible doublon de contrats | À décider seulement sur besoin démontré |

Une extraction physique devient justifiée si les cadences de livraison divergent, si un utilisateur peut installer chaque produit séparément, si les dépendances sont unidirectionnelles et si deux cas réels consomment la frontière sans exceptions. L'extraction peut aussi être celle du petit runtime hors du dépôt majoritairement harnais. Sortir le harnais n'est pas automatiquement le déplacement le moins coûteux.

Ne pas choisir un nouveau nom ni modifier `voidmachine` pour résoudre une confusion conceptuelle. Le renommage 4.0 vient d'être livré : une seconde migration doit apporter un bénéfice concret à l'utilisateur.

## 6. Architecture recommandée à éprouver

```text
UTILISATEUR DÉVELOPPEUR                    VOID CORTEX
          |                       modèle personnel / décision / policy
          v                                     |
 HARNAIS DE DÉVELOPPEMENT                contrat d'action minimal
 conventions, contrôles, preuves                 |
          |                         routeur dans l'application Cortex
          v                                /         |         \
 Claude / Codex / autre runtime      API/MCP       runtime      Machine
          |                           direct      externe     optionnelle
          |                                                      |
 adaptation native utile <--------------------------------------+
                                            accès contrôlé, drivers,
                                            effets et reçus observés
```

Ce diagramme ne prescrit pas un service partagé. Aucune dépendance de Cortex vers les skills, worktrees ou revues du harnais. Aucune dépendance du harnais vers le modèle personnel. Un daemon propre n'est ajouté que si un accès local durable concret l'exige ; le daemon Codex reste possédé par Codex.

La proposition « Cortex devient l'endpoint de modèle de Machine » du contexte de déploiement doit rester distincte du contrat d'action. Un endpoint d'inférence n'est ni une autorisation d'agir, ni un routeur d'actions, ni un reçu d'effet. Le cumuler par défaut avec deux coordinateurs créerait le double raisonnement que l'audit cherche à éviter.

## 7. Backlog : réutiliser avant créer

### Propriétaires existants conservés

| Sujet | Ticket | Position |
|---|---|---|
| Contrat, effet nommé, autorisation, reprise après effet ambigu | [DEV-956](https://linear.app/voidcorp/issue/DEV-956) | Cortex possède le contrat ; gate de conception avant code |
| Admissibilité et substitution runtime externe/local | [DEV-957](https://linear.app/voidcorp/issue/DEV-957) | Spike existant ; aucun clone ni API Dots présupposée |
| Sandbox hébergée Machine | [DEV-893](https://linear.app/voidcorp/issue/DEV-893) | Usage différé, protection impérative avant activation |
| Valeur du harnais et spécialistes | [DEV-451](https://linear.app/voidcorp/issue/DEV-451) | Recentré sur comparaison bornée au runtime natif ; protocole/budget à approuver |
| Conformance runtime | [DEV-450](https://linear.app/voidcorp/issue/DEV-450) | Preuves du même artefact ; réutiliser DEV-930 |
| Migration et retrait propre | [DEV-452](https://linear.app/voidcorp/issue/DEV-452) | Besoin conservé, solutions Rust et v2/v3 historiques |
| Adoption autonome | [DEV-818](https://linear.app/voidcorp/issue/DEV-818) | Gate humain conservé, dépend désormais de DEV-930 |
| Livraison 4.1 | [DEV-902](https://linear.app/voidcorp/issue/DEV-902), [DEV-920](https://linear.app/voidcorp/issue/DEV-920), [DEV-929](https://linear.app/voidcorp/issue/DEV-929), [DEV-930](https://linear.app/voidcorp/issue/DEV-930) | Livraison existante, sans extension stratégique implicite |
| Défauts CI et revue | [DEV-940](https://linear.app/voidcorp/issue/DEV-940), [DEV-941](https://linear.app/voidcorp/issue/DEV-941) | Ne pas dupliquer depuis le fourre-tout DEV-934 |

DEV-655 porte l'adoption et la télémétrie produit ; ce n'est pas la mesure causale de qualité de DEV-451. Il reste ouvert avec son arbitrage de confidentialité. DEV-833 est un brainstorm terminé ; DEV-838/839/840 sont annulés. Ne pas réactiver cette campagne par simple copie d'un ancien point projet.

### Nouveaux sujets strictement nécessaires

1. [**DEV-961 — Décider la frontière Harnais / Machine / Cortex**](https://linear.app/voidcorp/issue/DEV-961), avec Folpe : comparaison des trois options, responsabilités, coût de migration, éléments à garder/retirer, mise en cohérence des docs après décision. Conception seulement ; pas extraction déjà décidée.
2. [**DEV-962 — Rendre récupérable une mission fermée avant implémentation**](https://linear.app/voidcorp/issue/DEV-962), extrait de DEV-934 : reproduire le problème, distinguer obligation de preuve, erreur de commande et refus de sécurité ; conserver l'historique et les limites sans contourner les contrôles.

Les deux tickets sont créés en `Backlog`, priorité `High`, estimation `M`, assignés à Folpe. DEV-961 porte `architecture`, `Human gate` et `Spike` ; DEV-962 porte `Bug`. L'estimation reste à confirmer à l'ouverture du travail. Aucune extraction ni correction n'est déclarée réalisée.

## 8. Journal de réconciliation Linear

Les changements sont intervenus avant la création des nouveaux tickets :

- Description et résumé du projet mis à jour : 4.0 publiée, 4.1 en cours, cible stratégique explicitement à décider.
- DEV-909 : `In Progress` → `Done`, publication prouvée ; migration consommateur reportée en 4.1 selon la décision déjà écrite dans le ticket.
- DEV-843 : `In Review` → `Todo` ; correction fusionnée, recertification DEV-531 encore attendue.
- DEV-807, DEV-819, DEV-453 : `Canceled` comme solutions/programme remplacés. Historique conservé. Les trois enfants encore ouverts de DEV-807 n'ont pas été annulés.
- DEV-902 et DEV-920 : `Backlog` → `In Progress`, titres et périmètres courants corrigés ; aucune déclaration de release achevée.
- DEV-926 : titre corrigé vers le daemon natif, solution #441 explicitement historique ; statut `Done` conservé sur preuve #442.
- DEV-930 : critère Codex corrigé vers le daemon réellement utilisé ; preuve consommateur et gate humain conservés.
- DEV-450/451/452/818 : besoins conservés et recadrés ; détails de solution périmés identifiés comme historiques.
- Dépendances natives ajoutées : DEV-930 bloque DEV-818 et DEV-450. Les dépendances DEV-818 → DEV-452 et DEV-450 → DEV-451 restent en place.
- Cinq jalons renommés et décrits : deux historiques, qualité du harnais, preuves/adoption, extensions conditionnelles. Aucun pourcentage historique ne certifie le produit actuel.
- Deux jalons ajoutés : `4.1 — preuves et publication` et `Décision — Harnais, Machine et Cortex`. DEV-902, DEV-920 et DEV-921 à DEV-930 rattachés au premier.

Après cette remise en cohérence :

- DEV-961 créé dans le jalon de décision, relié aux propriétaires existants DEV-451/893/956/957.
- DEV-962 créé dans le jalon de qualité du harnais, relié à DEV-934/940/941/961. C'est une relation de contexte, pas une dépendance bloquante à la décision produit.
- DEV-934 conserve son statut de triage, ses observations et commentaires. Sa description indique le transfert du défaut de reprise vers DEV-962 et les points encore à trier.
- Contenu, priorité, estimation, labels, jalons et relations des deux nouveaux tickets relus dans Linear après enregistrement.
- Nouveau point projet publié le 1er octobre et relu depuis la vue d'ensemble. Il remplace comme état courant le point du 10 septembre, qui reste dans l'historique.

Pas de suppression de ticket, d'historique, de worktree ou de branche. Aucune modification de doctrine, aucun merge, aucun déploiement.

## 9. Priorités et test de remplacement

### P0 : retrouver un état vrai

Terminer la synchronisation documentée ci-dessus ; préserver DEV-929/930 et les gates humaines. Reproduire la fermeture prématurée de mission avant tout correctif. Le harnais doit permettre le travail qu'il prétend rendre fiable.

### P1 : trancher la frontière et mesurer la valeur

Décider le produit d'aide au code et sa relation avec Machine. Utiliser DEV-451 pour le protocole de valeur et DEV-450/452 pour les preuves d'usage et de retrait. Réduire les contrôles au besoin observé ; ne pas payer d'abord le coût d'une extraction de dépôt.

### P2 : première action Cortex remplaçable

À l'arrivée d'un usage approuvé, exécuter DEV-956 puis DEV-957. Un contrat suffit pour cet effet : opération/version, entrées minimales, ressources, autorisation bornée, échéance, clé d'idempotence et exigences de preuve. Le reçu distingue effectué/non effectué/inconnu, effets constatés, références de preuve, erreur et décision requise. Les garanties natives absentes restent absentes.

Le test compare un accès direct ou runtime disponible et un candidat Machine. Le cœur personnel de Cortex ne change pas quand l'adaptateur change. Un timeout après effet ne déclenche aucun fallback automatique tant que l'effet reste inconnu. Le passage au cloud ne doit jamais élargir implicitement l'autorisation ou l'exposition des données.

### LATER

Extraction physique, nouveau daemon, hébergement Machine, catalogue universel, scheduler et extensions Mission Control : seulement si un usage le justifie. DEV-893 doit être satisfait avant activation du cas hébergé qu'il protège. Ni le changement de nom ni l'ajout de classes Runtime ne constituent une preuve d'interchangeabilité.

## 10. Conclusion

Si Dots devient dix fois meilleur, le harnais peut rester une offre légère de pratiques et de garanties de développement vérifiées, portable entre runtimes. Il ne doit pas entretenir une orchestration concurrente pour préserver son volume de code.

Machine peut devenir très petite, voire absente d'une installation Cortex : accès que le fournisseur n'a pas, restrictions effectivement appliquées, adaptation et preuves d'effets. Si aucun usage n'exige ces garanties supplémentaires, ne pas déployer Machine est un résultat acceptable.

## Vérification de ce travail

Contrôles applicables : relecture des mutations et relations dans Linear, sources GitHub en direct, documentation reliée au code intégré, contrôle du diff et des liens locaux. Pas de modification de logique, d'interface produit, de frontière d'authentification ni de dépendance : suites de tests, typecheck, couverture, benchmark et QA mobile/desktop non applicables à ce changement documentaire. Aucun commit ni PR produit n'est créé ; hooks de commit et revue de diff de production non applicables.

Contrôle local effectué sur les deux documents : tous les liens Markdown locaux résolvent, aucun espace final, blocs de code équilibrés. Le checkout reste à son SHA initial et les seuls fichiers de cette intervention sont les deux documents non commités. Les statuts Linear sont des observations datées, susceptibles d'évoluer avec le travail en cours.
