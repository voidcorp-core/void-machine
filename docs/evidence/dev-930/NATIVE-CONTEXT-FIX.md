# DEV-930: réparation du contrat natif opaque

## Cause observée

Le CLI acceptait les identités natives `/root/proof1_*` et enregistrait les huit
événements started/completed. Le reducer exigeait ensuite un identifiant limité à
`[A-Za-z0-9._:-]`, contradictoire avec le contrat opaque d’ingestion. Il rejetait
donc les quatre résultats PASS et dispatch fermait PROOF-1, seq14.
Voir [preuve initiale](NATIVE-CONTEXT-BLOCKER.md). Aucun receipt historique n’est
remplacé ni considéré comme une nouvelle invocation.

## Périmètre autorisé et RED

Autorisation humaine étendue aux six fichiers annoncés: review-loop.ts/test,
mission-recovery.ts/test dans mission-engine, et mission-recovery.ts plus
mission-recovery-routing.test.ts dans le CLI. Folpe a ensuite autorisé l’extension
ciblée à `packages/cli/src/commands/mission.ts` pour corriger le panel observé.
Plan et empreintes inscrits dans le rapport WORK-3 avant production.

Commit RED `e2586d01`: dix échecs attendus, 154 tests passants. Les premiers
essais avaient une dépendance locale non compilée, puis une assertion erronée
sur le retour void de recordSpecialistLifecycle; ils sont conservés mais ne
constituent pas le RED de référence. `fix-red-confirmed` établit le RED réel:
dispatch répond stop et le parser refuse la nouvelle disposition.

## Réparation bornée

Le reducer accepte le même contrat opaque que l’ingestion: non blanc, longueur
maximale 160, aucun C0/DEL/C1. La détection de contextes réutilisés reste active.

`controller-defect / opaque-native-context` exige le journal complet d’une
préparation Codex initiale attestée, fermée par mission.dispatch. Chaque demande
doit avoir exactement un started et un completed concordants, au premier round,
avec plan, source, identité, input hash et version inchangés. Tous les résultats
doivent être PASS sans findings, demandes de preuve ou limitations. Au moins un
contexte doit prouver la différence avec l’ancien validateur. Aucun autre effet
ou round ne peut accompagner cette admission. Les contrôles existants de
cohérence, d’identité réutilisée et de budget restent appliqués.

La récupération ajoute un reçu vérifiable depuis le préfixe exact du journal.
Elle conserve les événements et les budgets, reprend en verification et est
idempotente. Elle n’approuve aucune PR ni aucun merge.

La revue native initiale de `6e21f6ea` a démontré un blocage: un spécialiste requis
entièrement absent des demandes pouvait être ignoré. RED `93592688` reproduit ce
cas et la confusion entre catalogue complet et panel applicable côté CLI.
Le correctif `938a5fa5da607b617140dc3b8f274bfe12db60d7` exige `readyForVerdict`
et l’ensemble exact du panel applicable issu du plan lié. Le test positif couvre
les quatre rôles de préparation; le négatif exclut Security complètement.
ORCH a relayé la revue ciblée `/root/dev930_fix_review`: blocage résolu sur ce SHA,
aucun autre défaut démontré. Les conclusions non affectées sont conservées.

## Vérifications actuelles

- Noyau: 164 tests PASS, y compris les bornes et le panel requis complet.
- CLI: 19 tests PASS; chemin réel recordSpecialistLifecycle vers dispatch et
  recovery, conservation du préfixe et idempotence observées.
- Build workspace et typecheck global PASS. Premier typecheck bloqué par un
  pack local non compilé; le build complet a résolu ce prérequis.
- Lint ciblé exit0: une alerte noNonNullAssertion préexistante dans la récupération;
  les cinq alertes introduites dans les tests ont été retirées. Build: avertissements
  de bundling déjà présents sur le build baseline. Les sorties ne sont pas vierges.
- Couverture instrumentée: NON MESURÉE, providers Vitest absents. Mutation:
  non applicable, aucun runner configuré. Aucun pourcentage inventé.
- Suite globale lancée sur `6e21f6ea`: CPU2333 PASS, filesystem2090 PASS,
  subprocess1582 PASS/1skip/1FAIL (identité dans les transcripts versionnés).
  Network non exécuté car la chaîne s’est arrêtée. La validation globale du
  correctif et de la présente correction documentaire reste à obtenir.
- Revue native ciblée PASS sur `938a5fa5`; elle ne remplace pas la CI globale.
- Preuve de merge privée BLOCKED; aucun essai mutateur nouveau avant validation.

## Essai original conservé comme échec

Avant réception du blocage de revue, le CLI `6e21f6ea` avait ajouté la récupération
seq15 puis dispatch seq16. Le préfixe original14, les quatre started et les quatre
completed sont inchangés; le second appel recovery était idempotent. Le fichier
synthétique `proof-1.txt` a été commité localement (`7ccf658`), sans push ni PR.
Le reçu seq15 contient les16 versions du catalogue et est **refusé par le
validateur corrigé**. Cet essai est donc ÉCHEC / contrôle négatif de compatibilité.

Journal16 SHA-256:
`0d0f19483b4f9ce749ae840255366707f1d85bbbf01b843bacbd55e9ac3e4fee`.
Il reste intact. Aucune amnistie, récupération supplémentaire, réécriture ou
réémission de receipt ne sera faite. L’audit en lecture seule des quatre reçus
originaux avec le panel applicable n’est pas une récupération réelle réussie.

Folpe autorise un essai indépendant depuis zéro sur un nouveau SHA/artefact corrigé,
avec fixture et ticket distincts. Il n’existe toujours aucune première PR de preuve.
Cette nouvelle expérience ne remet à zéro ni DEV-930 ni son budget de revue.

Commandes et sorties: [native-context-fix.log](RAW-EVIDENCE.md).
Original tgz sha256 `e63f7aed59fed4e0fc9de369c4a431fff2bfd7c3f4137fba509ea1322dbe7320` conservé.
Journal original sha256 `1b842a7d7798f127e06db21dfbffdc1f6a90f067ed95eef9e7954173d224e841`
conservé localement dans `.void/machine/dev930/fix-original-events.jsonl`.
La requête vise le hash canonique
`sha256:9391ea0ccc343d167e578b2b08579b770c5a1750922d6d121a0058c719fafa87`.

## void-verify

1. Typecheck PASS. 2. Tests ciblés183 PASS; globale à valider. 3. Lint exit0 avec alerte
préexistante documentée. 4. Couverture NON MESURÉE. 5. Hooks RED et fix PASS.
6. UI sans objet. 7. Observabilité: refus diagnostiqué et receipt canonique existants.
8. Frontière de confiance: refus négatifs testés, revue native ciblée PASS.
9. Contrat restauré, procédure documentée ici. 10. RED séparé et message causal.
11. Revue indépendante ciblée relayée par ORCH. 12. Plan release 4.1 Step10 lié dans
README; checkpoint et progression centrale appartiennent à ORCH.
