# La cible

Ce document dit **où va le harnais**, pas ce qu'il fait aujourd'hui. `README.md` décrit le
produit tel qu'il est, `ARCHITECTURE.md` comment il est construit ; celui-ci existe pour qu'une
session, un runtime ou un contributeur qui arrive dans six mois n'ait pas à redécouvrir
l'intention.

Il est tenu à jour quand la cible bouge, jamais quand une étape est franchie — l'avancement
vit dans le tracker.

## La promesse

Un projet qui installe void-harness est entre de bonnes mains sans que son mainteneur ait à
le surveiller. Concrètement : il décrit ce qu'il veut, et il retrouve la fonctionnalité sur
`develop`, testée, vérifiée, passée à la sécurité, prête à être promue.

Le niveau attendu est le top 5 %, sans exception et sans qu'on ait besoin de le rappeler.

## Le parcours cible

**1. Une intention, formulée librement.** « J'aimerais cette fonctionnalité. » Rien d'autre
n'est exigé : pas de ticket préalable, pas de commande à connaître, pas de skill à nommer.

**2. Le cadrage part tout seul.** Le harnais reconnaît qu'une intention est arrivée et entre en
conception : il pose les questions qui changent le résultat, une à la fois, pressure-teste la
demande, propose des approches, et n'écrit rien avant qu'une spec soit approuvée.

**3. Le découpage suit.** La spec devient un plan en tranches verticales, puis des tickets dans
le tracker, avec leurs dépendances.

**4. L'exécution va jusqu'au bout, seule.** Chaque ticket traverse le cycle complet :
architecture, doc officielle avant d'écrire, TDD, end-to-end, UX, sécurité, revue,
vérification. Aucune passe déclenchée n'est sautée.

**5. La branche se merge sur `develop` sans intervention.** Tout vert, prédicats observables
satisfaits, vérification post-merge, arrêt net de la chaîne au premier échec.

**6. La boucle continue.** Le harnais prend le ticket suivant. Quand une fenêtre fiable est
configurée et que le contexte se remplit, il demande un checkpoint ; avant une compaction annoncée,
il préserve les faits mécaniques sur disque ; au cycle suivant, il réinjecte une reprise complète
ou dégradée. Le runtime ou l'humain reste seul à pouvoir vider la fenêtre. Implémenter, vérifier,
merger, recommencer, avec une perte éventuelle explicitement nommée.

**7. L'humain intervient une fois.** Il ouvre le navigateur, regarde le résultat sur `develop`,
et décide. S'il valide, il merge `develop → main`, ce qui déploie.

## Les invariants

Ce qui ne bouge pas, quelle que soit l'autonomie atteinte.

- **`main` reste humain.** La promotion `develop → main` est le moment où quelqu'un décide que
  cela peut atteindre la production. Ce gate ne se déplace ni ne se supprime.
- **Le harnais est autosuffisant ; l'humain est un bonus.** Aucune règle, aucune skill, aucun
  mécanisme ne suppose qu'il y a quelqu'un pour répondre. Face à une ambiguïté : résoudre par
  les moyens du harnais, sinon avancer sous hypothèse nommée. **Ne jamais bloquer sur une
  question.**
- **Une règle tient là où elle est rejouée.** Un texte chargé une fois s'efface avec le
  contexte. Ce qui doit tenir vit dans un hook, dans une passe du cycle, ou dans un rappel
  rejoué à chaque tour — jamais dans un document qu'on espère relu.
- **Ce que plus personne ne lit doit être garanti par un mécanisme.** L'autonomie au merge est
  acceptable exactement à proportion de ce que le plancher attrape sans lecture humaine. Une QA
  navigateur juge un comportement, pas un diff : elle ne voit ni un secret en dur, ni une
  dépendance ajoutée, ni un test affaibli pour passer au vert.
- **Rien n'est gardé par ancienneté.** Une règle intégralement portée par un mécanisme est
  supprimée de la doctrine, pas conservée en double. Un doublon finit par diverger.

## Où en est chaque maillon

Relevé le 2026-08-27, chaque ligne vérifiée dans le dépôt.

| Maillon | État | Ce qui manque |
| -- | -- | -- |
| Cadrage automatique | **partiel** | `void-brainstorm` porte déjà son déclencheur (« Notice that the exchange has become design »), mais 8 activations de skill sur 812 appels d'outil ont été mesurées sur un projet réel. Le texte existe, le déclenchement non — DEV-641. |
| Spec → plan → tickets | **livré** | `void-brainstorm` → `void-plan` → `void-ticket`, chaînage écrit dans les skills. |
| Cycle d'exécution complet | **livré** | `void-implement`, douze passes à prédicat observable. |
| Chaînage entre skills | **manque** | Rien ne relie `void-implement` à `void-merge`, ni l'implémentation à la QA et à la passe sécurité — DEV-641. |
| Merge autonome sur `develop` | **conçu, non livré** | DEV-612. Bloqué par DEV-618 (séquentiel par défaut). DEV-613 est livré : la CI tire sur `develop` et la branche est protégée. |
| Boucle longue et reprise | **mécanique livrée, nettoyage externe** | Le handler commun mesure le dernier `usage` complet quand une fenêtre est configurée, émet un seul nudge, préserve le bloc mécanique à `PreCompact` et réinjecte `ResumeBundle`. Il ne peut ni invoquer `void-checkpoint`, ni déclencher `/clear` ou `/compact` : le résidu sémantique reste agentique et un `/clear` brutal peut encore imposer une reconstruction. |
| Doctrine rejouée | **en cours** | La directive permanente par `UserPromptSubmit` (spec du 2026-08-20) ; l'audit de placement de chaque règle, DEV-650. |
| QA navigateur avant promotion | **livré** | `void-qa`, via claude-in-chrome. |

## Ce que la cible n'est pas

- **Un merge autonome vers `main`.** Refusé par la CLI et par un gate source, et cela ne change
  pas.
- **Un backend headless.** L'autonomie visée s'exerce dans une session lancée par un humain, pas
  dans un service qui tourne sans que personne l'ait démarré.
- **Une confiance dans la CI.** Le remplacement du regard humain n'est pas « les tests passent »
  mais un plancher qui refuse à l'écriture, une vérification après chaque merge, et un arrêt net
  au premier échec.
- **Un harnais qui devine.** Autosuffisant ne veut pas dire silencieux : une hypothèse prise
  faute de réponse est nommée dans la sortie, toujours.
