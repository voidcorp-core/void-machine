# Index des sorties originales conservées

Ce fichier est une synthèse et un index, **pas une sortie de commande originale**.
Les fichiers bruts précédemment versionnés au SHA `938a5fa5` sont archivés sans
changer un octet sous `.void/machine/dev930/raw-versioned-evidence-938a5fa5/`,
répertoire ignoré de la worktree WORK-3. Ils avaient déjà été expurgés du chemin
personnel lors de leur collecte; aucune autre réécriture n’a été appliquée.

[raw-evidence-index.json](raw-evidence-index.json) donne chaque ancien chemin,
son emplacement local, sa taille et son SHA-256. Il indexe séparément les nouvelles
vérifications. Les archives ne sont pas des ressources distantes: ORCH doit les
conserver avec le dossier local avant tout nettoyage.

Le contrôle d’identité du produit rejetait les occurrences historiques présentes
dans ces transcripts. Les déplacer vers les preuves locales et versionner leur
index résout le classement documentaire; le contrôle reste inchangé. Aucun log
réécrit n’est présenté comme un original, aucun événement canonique n’est modifié.

| Fichier archivé | Ce qu’il établit, avec sa limite |
|---|---|
| `build.log` | Pack préliminaire source8fee97c9 et alignement des versions4.0.0; pas le candidat final |
| `consumer.log` | Installation/init/commit/clone/hydrate sur copie synthétique; doctor avant hydrate exit1,11failed,1advisory; après hydrate no blocker,1advisory |
| `conformance.log` | Conformités install/hooks/autopilot; cette dernière est hors réseau, sans merge réel |
| `runtime.log` | Observations Herdr terminal et versions daemon, sans lancement de daemon ni résultat structuré |
| `remote.log` | Création autorisée du seed privé et observation des règles; aucune PR mergée |
| `native-context.log` | Refus réel des identités natives par le pack original; essai échoué |
| `native-receipts.json` | Extrait des événements originaux et hash du journal14; aucune réémission de receipt |
| `native-context-fix.log` | RED puis premières vérifications du correctif; ne prouve pas sa validation finale |

Les logs batch1 distincts établissent deux échecs RED attendus puis183 tests PASS
et le typecheck global PASS sur le correctif `938a5fa5`. L’essai original demeure
un **ÉCHEC / contrôle négatif de compatibilité**, décrit dans
[NATIVE-CONTEXT-FIX.md](NATIVE-CONTEXT-FIX.md). Il ne sera ni réparé ni réinitialisé.

Pour vérifier les archives, depuis la worktree WORK-3:

```python
import hashlib, json
from pathlib import Path
index = json.loads(Path('docs/evidence/dev-930/raw-evidence-index.json').read_text())
for item in index['archivedVersionedEvidence'] + index['additionalLocalEvidence']:
    body = Path(item['rawPath']).read_bytes()
    assert len(body) == item['bytes']
    assert hashlib.sha256(body).hexdigest() == item['sha256']
```
