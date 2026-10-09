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
mission-recovery-routing.test.ts dans le CLI. Aucun autre code modifié.
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

## Vérifications actuelles

- Noyau: 162 tests PASS, y compris les bornes et les refus de récupération.
- CLI: 19 tests PASS; chemin réel recordSpecialistLifecycle vers dispatch et
  recovery, conservation du préfixe et idempotence observées.
- Build workspace et typecheck global PASS. Premier typecheck bloqué par un
  pack local non compilé; le build complet a résolu ce prérequis.
- Lint ciblé exit0: une alerte noNonNullAssertion préexistante dans la récupération;
  les cinq alertes introduites dans les tests ont été retirées. Build: avertissements
  de bundling déjà présents sur le build baseline. Les sorties ne sont pas vierges.
- Couverture instrumentée: NON MESURÉE, providers Vitest absents. Mutation:
  non applicable, aucun runner configuré. Aucun pourcentage inventé.
- Tests globaux en cours; revue native finale à ORCH après commit du correctif.
- Récupération réelle non exécutée à ce stade; preuve de merge privée encore BLOCKED.

Commandes et sorties: [native-context-fix.log](native-context-fix.log).
Original tgz sha256 `e63f7aed59fed4e0fc9de369c4a431fff2bfd7c3f4137fba509ea1322dbe7320` conservé.
Journal original sha256 `1b842a7d7798f127e06db21dfbffdc1f6a90f067ed95eef9e7954173d224e841`
conservé localement dans `.void/machine/dev930/fix-original-events.jsonl`.
La requête vise le hash canonique
`sha256:9391ea0ccc343d167e578b2b08579b770c5a1750922d6d121a0058c719fafa87`.

## void-verify

1. Typecheck PASS. 2. Tests ciblés PASS; globaux en cours. 3. Lint exit0 avec alerte
préexistante documentée. 4. Couverture NON MESURÉE. 5. Hooks RED PASS; hooks fix à faire.
6. UI sans objet. 7. Observabilité: refus diagnostiqué et receipt canonique existants.
8. Frontière de confiance: refus négatifs testés, revue native à faire.
9. Contrat restauré, procédure documentée ici. 10. RED séparé et message causal.
11. Revue indépendante finale à faire par ORCH. 12. Plan release 4.1 Step10 lié dans
README; checkpoint et progression centrale appartiennent à ORCH.
