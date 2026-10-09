# Inventaire de conservation et nettoyage DEV-930

L'autorisation des essais privés exige le nettoyage complet après collecte.
Ce fichier est un inventaire, pas un reçu de suppression. ORCH possède la clôture.
Ne rien supprimer avant conservation et acceptation des preuves utiles.

## À conserver comme preuves

- Commit(s) de `docs/evidence/dev-930/**` : matrice, logs expurgés, digests,
  autorisation et limites. Aucun tarball binaire ou source privée dans le commit.
- Rapport central WORK-3 et reçus natifs effectivement exécutés, leurs enveloppes,
  critères/hash, SHA head/base, résultats et événements canoniques.
- Captures des états PR avant/après, du merge exact-head et de la retenue, puis
  confirmation de suppression GitHub par ORCH. À compléter après les essais.

Les transcripts bruts ont été retirés du suivi après archivage byte-identique
dans `raw-versioned-evidence-938a5fa5/` sous les preuves locales. Conserver cet
archive et les preuves négatives originales avec leurs hashes avant nettoyage;
le Git versionné ne contient plus ces octets sur le dernier commit.

## Traces créées, à nettoyer après acceptation

Toutes les traces locales WORK-3 sont sous `.void/machine/dev930/` de sa worktree,
à l'exception du report central et des inventaires temporaires explicitement
nommés ci-dessous :

| Trace | Contenu / action après collecte |
|---|---|
| `source/` | clone source isolé, dépendances/builds; supprimer copie complète |
| `artifact/` | tarball et manifeste; conserver digest/log, puis supprimer binaire |
| `artifact-fixed/`, `installed-package-fixed/` | pack préliminaire6e21 devenu inadmissible après revue, répertoire d’installation vide; garder l’échec puis nettoyer |
| `raw-versioned-evidence-938a5fa5/` | huit fichiers archivés à l’identique, index/hashes versionnés; conserver avant nettoyage |
| `attempt-2-preparation/` | fichiers/tickets/plan seulement, aucun essai lancé; conserver le manifeste puis nettoyer |
| `installed-package/` | installation npm offline du pack; supprimer copie |
| `consumer/` | clone synthétique dev929 modifié, commit local; supprimer copie |
| `consumer-clone/` | clone réhydraté, retenue humaine active locale; supprimer copie |
| `consumer-negative/` | second clone frais du contrôle doctor; supprimer copie |
| `isolated-env/` | environnement/cache temporaires de preuve; supprimer copie |
| `offline-store-residue/` | store local issu de l'essai offline; supprimer copie |
| `remote-global/` | état global du harnais redirigé pour le seul consommateur distant; supprimer copie |
| `github-consumer/` | clone privé synthétique, branches, empreintes PROOF, missions et reçus; collecter puis supprimer |
| `review-worktrees/` si créé | worktrees détachées des revues du repo synthétique; collecter, retirer via Git depuis leur propre dépôt puis supprimer le clone |
| `*.log`, scripts `.py`/`.mjs`, fichiers `.json`, `report.md` | conserver copies expurgées utiles, supprimer les résidus locaux après acceptation |

PROOF-1 est un échec conservé: journal14 original et journal16 final,
récupération seq15, branch locale `proof/PROOF-1` et commit `7ccf658` sans push.
Aucune réparation additionnelle de ce journal. La prochaine fixture sera distincte
et devra être ajoutée à cet inventaire seulement après création effectivement observée.

Les inventaires temporaires Herdr `/tmp/dev930-panes.json` et
`/tmp/dev930-panes-current.json` sont à nettoyer après conservation de la vue WORK-3.
Les fixtures temporaires des scripts de conformité sont supprimées par leurs
blocs `finally` lors des trois sorties réussies.

La worktree DEV-930 et sa branche dans le harnais gardent le cycle de vie du ticket;
elle ne peut pas être supprimée au titre du seul nettoyage du dépôt synthétique.
Les `node_modules/` installés dans cette worktree pour faire passer le pré-commit
sont ignorés et disparaîtront avec elle. Aucun changement de configuration Git
partagée, ni global Codex/Claude/zsh/Herdr n'est à annuler.

Remote unique : `voidcorp-core/void-machine-proof-dev930-20261009`.
ORCH supprimera **tout le dépôt privé** après captures et acceptation, ce qui
couvre les branches `main`, `develop`, `proof/PROOF-1`, `proof/PROOF-2`, PR,
commentaires et éventuels checks propres à ces essais. Le détail réellement créé
est à réconcilier contre GitHub avant suppression; pas de suppression d'un autre dépôt.

Rapport central autorisé :
`<USER_HOME>/.local/state/orchestra/f1eb590afa628adc7f1149bc62acfc0e4b9d6e80a1913d433f5a6f447a61c42c/milestone-01-20261009/workers/WORK-3/report.md`.
Il reste dans la mission ORCH comme preuve; WORK-3 ne supprime ni la mission ni
les rapports de ses voisins. Aucun daemon démarré par WORK-3, aucun pane créé,
donc aucun daemon/pane à arrêter ou fermer par WORK-3.
