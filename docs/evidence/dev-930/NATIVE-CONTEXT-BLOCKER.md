# Blocage réel : identifiants natifs admis puis refusés en revue

Le 9 octobre 2026, le pack lié à `8fee97c9` et au digest de `artifact.json`
a bloqué PROOF-1 **avant écriture, PR ou merge**. Aucun correctif n'a été ajouté
par WORK-3 à cet instant, alors limité à la collecte de preuves.
Ce document conserve le constat initial. La correction autorisée ensuite et
l’échec définitif de cet essai sont décrits dans [NATIVE-CONTEXT-FIX.md](NATIVE-CONTEXT-FIX.md).

## Déclencheur et observation

1. Créer la mission par le CLI installé depuis le pack :
   `mission start --title PROOF-1 --ticket tickets/PROOF-1.md --mode team --json`.
   Mission réelle : `mis_98a644f5-6596-41d5-89b6-41226613e6d7`.
   Base : `3d9432a7f04055f618d806bca7c36bdaf5b0a805`.
2. `mission dispatch --id <mission> --json` demande quatre spécialistes de
   préparation. ORCH les invoque réellement en contextes natifs indépendants.
   Les identifiants retournés sont `/root/proof1_observability`,
   `/root/proof1_product`, `/root/proof1_security`, `/root/proof1_qa`.
3. ORCH confirme leurs quatre résultats PASS et enregistre huit événements
   `started`/`completed` par l'API canonique. La commande rend `recorded:true`.
4. Sans réécrire le journal, WORK-3 rappelle la même commande `mission dispatch`.
   Elle sort avec code 0 mais **phase `degraded`, action `stop`**, quatre raisons
   `invalid-completion: completion envelope is invalid`.

La sortie exacte, les enveloppes et le diagnostic figurent dans
[native-context.log](RAW-EVIDENCE.md). Les événements canoniques pertinents et
le digest du journal observé figurent dans [native-receipts.json](RAW-EVIDENCE.md).
Les sources des retours natifs restent chez ORCH à
`<USER_HOME>/Developer/void-machine/.void/machine/milestone-01/proof1-native-completions.json`.
Cette référence est une provenance de l'invocation réelle, pas une revue indépendante
inventée par WORK-3.

## Cause vérifiée, sans modification

`packages/mission-engine/src/orchestration/review-loop.ts` contient :

```text
const CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,159}$/;
```

`parseEnvelope` applique cette expression à `payload.contextId` et rejette les
identifiants avec `/`, sauf voie de provenance `review-artifact`. Le contrôle
de diagnostic avec le parseur de completion du build montre pour les quatre
événements : `completionBodyValid:true`, `reviewLoopContextAccepted:false`.

Cela contredit le contrat de [Native supervision](../../NATIVE-SUPERVISION.md)
et du skill d'orchestration livré, qui demande de préserver les identifiants
opaques réellement retournés, y compris ceux commençant par `/`. Une commande
qui accepte le reçu puis une autre qui refuse le même identifiant empêche ici
la transition de préparation vers implémentation.

## Effet au premier arrêt, puis décision de conservation

- À seq14: aucun fichier `proof-1.txt`, aucune PR, aucun merge. Les deux essais
  autorisés restent non prouvés; le dépôt distant ne contient que le seed synthétique.
- Les quatre vrais contextes/résultats sont conservés. Ne pas les renommer,
  relancer un panel à l'aveugle, inventer un reçu ni éditer le journal.
- Le défaut a ensuite été admis explicitement dans DEV-930, corrigé en TDD et
  soumis à la revue native puis à une correction ciblée. L’essai original a
  atteint seq16 avant ce second constat et reste désormais un échec conservé.
- Aucune reprise supplémentaire de ce journal n’est autorisée. Un nouvel essai
  indépendant est autorisé après validation globale du nouveau code et des docs;
  il ne recycle aucun receipt de cette mission. L’ancien pack et son échec restent conservés.
- Le dépôt privé et les traces restent à nettoyer par ORCH après collecte ou
  abandon explicite; [CLEANUP.md](CLEANUP.md) inventorie leur périmètre.
