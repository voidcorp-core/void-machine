---
title: "Épuration de Void Machine : décisions approuvées"
date: 2026-11-23
status: approved-scope-record
source: conversation-maintainer-2026-11-20-2026-11-23
tickets: [DEV-1372, DEV-1373, DEV-1374, DEV-1375, DEV-1376, DEV-1393, DEV-1394, DEV-1395, DEV-1396, DEV-1397, DEV-1398, DEV-1399, DEV-1400]
---

# Décisions approuvées pour l’épuration de Void Machine

Ce relevé conserve le périmètre approuvé pendant la discussion avec le mainteneur.
Il accompagne le [plan d’exécution](2026-11-23-void-machine-simplification-plan.md),
qui porte l’ordre des lots et leurs vérifications. Il ne constitue ni une configuration
runtime, ni un nouveau registre à synchroniser en continu. Il n’est pas injecté dans
le contexte de démarrage des projets consommateurs.

Les choix sont déjà approuvés ; leur présence ici ne les active pas. Les états
ci-dessous sont ceux consignés lors de la consolidation, pas une attestation de
livraison, de tests ou de publication. Le plan et les preuves d’exécution distinguent
ce qui est réalisé de ce qui reste à appliquer. Les formulations de portée, d’accord
et de limites sont conservées dans leur langue d’origine pour éviter une traduction
qui changerait l’autorisation donnée.

La source de travail était le fichier local ignoré
`.void/machine/style-gates-20261120/decisions.json`. Cette copie versionnable en
préserve les arbitrages afin qu’ils ne dépendent plus de ce seul fichier local.
Elle ne modifie pas les décisions historiques du dépôt et n’ajoute aucun mécanisme
de génération, de contrôle CI ou de journalisation.

## Priorité des décisions et remplacements

Les précisions ultérieures ci-dessous prévalent sur les formulations antérieures
conservées dans le relevé. Une entrée historique n’autorise pas à réintroduire une
option ensuite abandonnée.

| Sujet | Périmètre final retenu |
| --- | --- |
| Source de la philosophie | Le principe de source unique est conservé. Le choix initial `docs/PHILOSOPHY.md` de `philosophy-duplicate-source` est remplacé par `source-build-install-layout` : source produit dans `packages/core/src/PHILOSOPHY.md`, copie installée dans `.void/PHILOSOPHY.md`, à côté de `.void/PROJECT-DOCTRINE.md`. Aucun `packages/core` n’est imposé aux consommateurs. |
| Documents des deux runtimes | `sister-doc-mechanical-parity` retient une seule rédaction autoritaire et un import natif Claude léger, dont le fonctionnement doit être vérifié. Cela remplace la duplication manuelle et ses contrôles de parité, sans prétendre que deux runtimes exécutent identiquement une instruction commune. |
| Adaptateur de télémétrie | Les anciennes formulations excluant tout adaptateur ne prévalent plus. `native-telemetry-signal-scope` et les décisions suivantes exigent un adaptateur mince pour les deux runtimes, sans inventer les signaux manquants ni installer de SDK dans les projets consommateurs. |
| Collecteur et destination | Le choix final est Grafana + Alloy. Grafana Cloud Free est envisagé d’abord après vérification de l’usage ; le NAS Synology DS923+ avec 16 Go reste l’alternative si le gratuit ne convient pas. Aucun abonnement payant, export effectif ou déploiement n’est activé par cette décision. Les autres plateformes LLM et moteurs de collecte maison sont exclus de cet exercice. |
| Workers visibles dans Herdr | La suppression de `mandatory-worker-display-publication` concerne la cérémonie manuelle de publication. Elle reste conditionnée à la visibilité des vrais workers dans Herdr par l’intégration minimale nécessaire. On ne supprime pas cette capacité sans remplacement fonctionnel ; pas de workers dupliqués pour l’affichage, ni de commande vers une cible non vérifiée. Herdr demeure facultatif pour le travail local et la délégation native indépendante. |
| Reprise Autopilot | Le checkpoint local conserve directement l’état observé, les références aux tickets et travaux engagés, la prochaine action et la suite envisagée. Il remplace la dépendance à `program.md` et l’idée intermédiaire d’un document de file séparé dans le tracker. À la reprise, les états réels sont réconciliés ; le checkpoint n’est ni une autorisation ni une preuve d’activité actuelle. |
| Journaux et preuves | Retirer la collecte d’usage maison ne retire pas les preuves natives d’invocation, les résultats utiles, les preuves de revue indépendante, les contrôles de fusion ni les informations nécessaires à une reprise honnête. Examiner les consommateurs partagés avant toute suppression. |
| Revues après correction | Les plafonds de correction restent ceux approuvés. La seconde lecture couvre les corrections et leur comportement affecté, y compris une régression démontrée ; la formulation trop restrictive d’Autopilot doit être alignée sans ajouter de tour ou de panel. |
| Validation des données | La règle finale vise les frontières de confiance et les invariants susceptibles de changer. Aucune suppression globale de contrôles et aucun pourcentage universel de confiance. La validation d’un format ne prouve ni la vérité d’une donnée ni l’autorisation d’agir. |

Le socle installé protégé reste protégé, y compris ici : aucune exception générale de
maintenance n’est accordée. Les changements passent par les sources et le processus
approuvé, puis par des livrables vérifiés. `void-learn` reste le canal de capture des
règles. La simplification conserve les tests comportementaux utiles, les protections
concrètes et la revue indépendante ; elle ne donne aucune garantie absolue de fiabilité.

## Relevé des décisions

Chaque identifiant ci-dessous apparaît une seule fois. Le choix, la portée,
l’autorisation et l’état sont reproduits depuis la source. Les limites de gain et
les réserves sont conservées lorsqu’elles avaient été consignées.

Nombre d’entrées : **124**. Empreinte SHA-256 de la source locale au moment de la copie : `02ae908c3e55bb965c98f536be9b87d6cb1425cca07fe3fdb4dd08f43d172017`.

### test-name

**Choix** : remove

**Accord consigné** : User answered enlève after the keep/remove comparison

**État consigné** : pending

**Portée approuvée** : Remove the lexical blocking rule and its wiring; retain descriptive test-name guidance and independent test-correctness checks

### design-slop

**Choix** : remove

**Accord consigné** : User answered enlever after the keep/remove comparison

**État consigné** : pending

**Portée approuvée** : Remove lexical visual-pattern blocking and its wiring; retain contextual design guidance, visual review and accessibility checks

### dangerous-command

**Choix** : keep-and-narrow

**Accord consigné** : User answered oui to keeping destructive-command protection with a narrower scope

**État consigné** : existing-protection-active-refinement-pending

**Portée approuvée** : Retain protection against targeted destructive data/device/history operations; correct false positives for quoted text, documentation searches and harmless Git usages. Test both harmful and harmless cases without building a full shell interpreter.

### secret-content-prewrite

**Choix** : keep

**Accord consigné** : User answered on garde c'est trop important

**État consigné** : already-active

**Portée approuvée** : Retain secret detection before edits, with truthful coverage limits and useful detection/false-positive tests

### no-console-prewrite

**Choix** : mandatory-logger-via-linter-validation-ci

**Accord consigné** : User challenged the recommendation to reaffirm logger preference, then answered oui to the clarified combination

**État consigné** : pending

**Portée approuvée** : Require the project logger in application code; configure console calls as blocking lint violations in validation/CI. Remove the redundant edit-time no-console hook. Limit exceptions to legitimate CLI/script output. Sensitive-data logging protection remains a distinct concern.

### no-any-prewrite

**Choix** : replace-with-existing-linter-validation-ci

**Accord consigné** : User answered ok recommandation to transferring explicit-any enforcement to the existing linter/CI

**État consigné** : pending

**Portée approuvée** : Remove the custom edit-time regex hook. Configure one syntax-aware explicit-any lint rule to block validation/CI. Retain TypeScript strict checking for implicit any; avoid duplicate enforcement and do not assume existing severity already blocks.

### typescript-assertion-policy

**Choix** : adopt-in-existing-skill-and-review

**Accord consigné** : User answered oui to the proposed replacement policy

**État consigné** : pending

**Portée approuvée** : Assertions must not replace missing verification. Exceptional assertions remain local and backed by an identifiable guarantee. Allow as const and justified interoperability or validated branded-type construction. Reject assertions on unvalidated external data and double assertions masking unexplained incompatibility. Prefer inference, generics, satisfies for known structures and runtime validation for external data. No new blocking hook or per-assertion approval procedure.

### no-as-cast

**Choix** : remove-and-design-replacement

**Accord consigné** : User answered on enlève and requested a genuine rule against abusive TypeScript assertions

**État consigné** : pending

**Portée approuvée** : Remove the lexical as-plus-uppercase gate; separately agree a precise policy against assertions that replace proof of a type, with legitimate cases and enforcement location explicit

### no-focused-test-prewrite

**Choix** : move-to-validation-ci

**Accord consigné** : User answered on déplace after the edit-time versus validation/CI comparison

**État consigné** : pending

**Portée approuvée** : Remove edit-time blocking of focused/skipped tests; provide one reliable final validation/CI check before accepting test evidence, avoiding duplicate checks

### tdd-order

**Choix** : remove

**Accord consigné** : User answered on enlève after the keep/remove comparison

**État consigné** : pending

**Portée approuvée** : Remove the structural sibling-test/declaration gate and tests solely preserving it; retain risk-based behavioral tests and meaningful verification

### no-null

**Choix** : remove

**Accord consigné** : User answered enlever after the keep/remove comparison

**État consigné** : pending

**Portée approuvée** : Remove the blanket lexical null prohibition; retain strict typing and explicit absence handling

### protected-sensitive-files

**Choix** : keep-with-secret-manager-first-and-legacy-compatibility

**Accord consigné** : User answered oui to the Infisical policy and legacy compatibility proposal

**État consigné** : existing-protection-active-policy-update-pending

**Portée approuvée** : Keep sensitive-file protection. For projects using Infisical, inject secrets at runtime without exporting plaintext values to .env files. Preserve legacy .env operation and protection; migration remains separate and is not required for unrelated work. Permit secret-free examples, public configuration and secret references. Manager unavailability stops only dependent secret operations, with no plaintext file fallback. Keep the public harness provider-neutral; Infisical is the selected manager for VoidCorp projects. Replace the unconditional cp .env.example .env guidance.

### protected-harness-assets

**Choix** : keep-absolute-block-and-void-learn

**Accord consigné** : User explicitly rejected relaxing the block: keep absolute protection to prevent consumer-project drift and continue through void-learn

**État consigné** : already-active

**Portée approuvée** : Keep the absolute block on exclusively harness-owned installed assets in consumer projects and the void-learn route. Reject the proposed maintenance exception mechanism. Simplify Void Machine at its sources and unnecessary controls rather than allowing consumer agents to alter their installed safeguards. No blanket exemption for this repository's active installed harness is inferred.

### control-character

**Choix** : keep-without-expansion

**Accord consigné** : User answered oui to retaining the existing narrow control

**État consigné** : already-active

**Portée approuvée** : Keep detection of literal control characters such as NUL in covered source files, allow ordinary whitespace and binary fixtures, and retain useful behavioral tests. Do not expand into a broader Unicode policing mechanism or add dependencies or procedures. Execution latency remains unmeasured.

### dependency-import-controls

**Choix** : replace-prewrite-hook-with-existing-linter

**Accord consigné** : User answered oui after comparing hook removal with the cost of enabling an existing lint rule

**État consigné** : pending

**Portée approuvée** : Remove boundary-direction prewrite enforcement and its implementation-specific tests. Validate undeclared dependencies through the project's existing linter, using Biome here after verifying aliases and package behavior. Add neither a new tool nor a CI job solely for this rule; respect consumer tooling. Keep focused proof that undeclared imports fail and legitimate imports pass. Net latency benefit remains unmeasured; account for the linter's project analysis cost.

### formatting-frequency

**Choix** : remove-post-edit-format-hook

**Accord consigné** : User answered oui to removing formatting after every edit

**État consigné** : pending

**Portée approuvée** : Remove the format lifecycle hook and its implementation-specific machinery/tests. Use the project's configured formatting command on affected files when edits are complete, before validation; respect disabled or absent formatters and existing project automation. Add no formatter dependency, new hook or CI job. Avoid repeated intermediate rewrites. Timing savings remain unmeasured.

### typecheck-end-of-turn

**Choix** : remove-stop-hook-with-targeted-in-work-validation

**Accord consigné** : User answered oui but explicitly warned against moving all checks into a final validation bottleneck

**État consigné** : pending

**Portée approuvée** : Remove the automatic Stop typecheck hook and its exclusively owned machinery/configuration/tests after checking shared uses. Keep relevant type checking during implementation after coherent changes, and sooner for changed contracts/shared types. Retain required final and CI verification without unnecessary local repetition of unaffected successful checks. Do not replace the hook with a new watcher, scheduler or homemade cache. The existing 45-second timeout is not a measured execution cost.

### checkpoint-session-end-audit

**Choix** : remove

**Accord consigné** : User answered oui and noted they often create checkpoints manually

**État consigné** : pending

**Portée approuvée** : Remove the SessionEnd checkpoint audit, its wiring and exclusively owned implementation/tests. Keep void-checkpoint and existing checkpoint relevance checks at resume. Do not add replacement validation. Lost capability is the closing diagnostic and associated audit event, not checkpoint persistence.

### checkpoint-close-reminder

**Choix** : remove-without-replacement

**Accord consigné** : User explicitly said on supprime ca alourdi pour peu de gain

**État consigné** : pending

**Portée approuvée** : Remove the UserPromptSubmit checkpoint-reminder hook, its phrase-based close-intent detection and exclusively owned tests. Keep void-checkpoint available on request and when an agent needs to preserve unfinished work before interruption. Add no replacement trigger or procedure.

### context-continuity-tracking

**Choix** : remove-continuous-tracking

**Accord consigné** : User explicitly approved removal because maintenance cost appears greater than the benefit

**État consigné** : pending

**Portée approuvée** : Remove the continuous context-continuity checkpoint tracking, event wiring, threshold reminder and exclusively owned state/locking/recovery machinery and tests. Preserve explicit void-checkpoint, semantic checkpoint contents and resume from saved information; remove requirements for retired mechanical state rather than marking ordinary checkpoints degraded. Retain the shared context measurement needed for Herdr display without retaining the continuous checkpoint tracker. Do not infer permission to alter Herdr target verification. Rely on runtime context management with honest limitations. Source/test line counts are observed size, not a promised deletion count; timing savings remain unmeasured.

### routine-hook-success-telemetry

**Choix** : remove-custom-usage-collection-in-favor-of-native-telemetry

**Accord consigné** : User approved removal and explicitly requested using the telemetry supplied by the tool directly, including OpenTelemetry

**État consigné** : pending

**Portée approuvée** : Prefer runtime-native telemetry for usage, costs, tool activity and supported hook/skill metrics. Remove redundant custom usage collection, including routine successful or no-effect hook events; do not replace it with a custom OTel SDK, collector, adapter layer or dual-writing pipeline in consumer projects. Preserve actionable refusal/error diagnostics and independently necessary test/review/merge evidence and worker lifecycle observations. Map shared consumers before deleting common event infrastructure. Adapt or separately retire reports dependent on removed usage data; absence of data must not imply success or non-use. Native coverage differs by runtime/version; exact named custom-skill coverage is not assumed. Export configuration needs a chosen destination and bounded data scope; no external telemetry has been enabled during this discussion.

Références consignées :

- [Référence 1](https://code.claude.com/docs/en/monitoring-usage)
- [Référence 2](https://learn.chatgpt.com/docs/config-file/config-advanced)

### native-telemetry-runtime-differences

**Choix** : accept-differences-with-minimal-adapter-if-useful

**Accord consigné** : User explicitly accepts runtime differences and allows an intermediate abstraction file to simplify management

**État consigné** : pending

**Portée approuvée** : Refines the previous preference against adapters: permit a small shared adapter only for an identified common consumer of native runtime telemetry. Normalize available fields without synthesizing missing observations, claiming parity or adding a custom collection pipeline. Avoid speculative abstraction or a new framework; preserve runtime-specific capabilities when useful.

### usage-audit-after-native-telemetry

**Choix** : remove-dedicated-audit-command-and-skill

**Accord consigné** : User answered oui to retiring void-audit and its CLI command without a new homemade audit

**État consigné** : pending

**Portée approuvée** : Remove void-audit, the void-machine audit command and exclusively owned usage classification, aggregation, proposal publishing and tests. Do not rebuild them around OTel. Preserve shared graph integrity checks, review evidence and other live consumers of common modules. Review native telemetry when a human requests harness evaluation and route approved changes through void-learn. Update live references and generated assets; preserve immutable historical decisions. Benefit is primarily maintenance reduction because this command runs on demand, not on every edit.

### repeated-read-detector

**Choix** : remove-without-replacement

**Accord consigné** : User answered oui to removing the repeated-read detector

**État consigné** : pending

**Portée approuvée** : Remove the read-loop detector, its post-tool integration, disk state/locking machinery and exclusively owned tests. Retain ordinary guidance to reuse available results and reread when new information is expected. Do not introduce a replacement counter, runtime observer or telemetry-based blocker. Preserve other consumers of shared outcome infrastructure until their own approved removal.

### large-output-trimming

**Choix** : remove-custom-trim-hook

**Accord consigné** : User answered oui to removing homemade output trimming

**État consigné** : pending

**Portée approuvée** : Remove the trim lifecycle hook, its custom output replacement/spill machinery and exclusively owned tests and configuration. Preserve existing saved logs; no historical output deletion is authorized. Use native output limits and targeted queries; explicitly capture full logs where needed. Verify command completion/status and relevant errors rather than inferring success from truncated output. No replacement universal truncation layer. The observed string replacement conflicts with the current documented Bash output shape; no live runtime effectiveness claim was established.

### large-change-reminder

**Choix** : remove-line-count-warning-and-marker

**Accord consigné** : User answered oui to removing the 400-line change control

**État consigné** : pending

**Portée approuvée** : Remove the optional large-change/large-cl-grep warning, its threshold configuration, large-cl-justification marker requirement and exclusively owned implementation/tests. Retain guidance for coherent reviewable changes and contextual reviewer judgment. Preserve immutable historical decisions. No new gate or replacement step. The control is shipped but absent from examined standard runtime manifests, so benefit is primarily maintenance rather than default-session latency.

### lockfile-direct-edit-protection

**Choix** : keep

**Accord consigné** : User answered oui to retaining direct lockfile edit protection

**État consigné** : already-active

**Portée approuvée** : Keep refusal of recognized direct edits to supported dependency lockfiles. Use the package manager for updates and supported conflict resolution; keep meaningful proof that direct edits are refused and normal package-manager commands remain allowed under existing permissions. No additional process or validation layer is introduced.

### git-metadata-direct-edit-protection

**Choix** : keep

**Accord consigné** : User answered oui to retaining direct Git metadata edit protection

**État consigné** : already-active

**Portée approuvée** : Keep the existing refusal of recognized direct edits under .git/. Git commands remain available under their ordinary permissions. No new process, validation layer or expanded write-detection framework; do not claim exhaustive coverage.

### skill-editorial-wording-tests

**Choix** : remove-purely-editorial-assertions

**Accord consigné** : User answered oui to removing tests that freeze editorial skill wording

**État consigné** : pending

**Portée approuvée** : Remove assertions whose only protection is exact editorial wording, headings or line wrapping. Preserve machine-consumed structure, valid references and justified safety-contract checks; do not blanket-delete text tests because skills are themselves textual instructions. Keep useful behavioral evidence without introducing a replacement LLM evaluation platform. Quantify actual removals and maintenance gains during implementation; CI duration benefit is unmeasured.

### sister-doc-mechanical-parity

**Choix** : replace-duplicate-authoring-with-native-shared-source

**Accord consigné** : User answered ok after challenging drift and approving one common source with a minimal CLAUDE.md

**État consigné** : pending

**Portée approuvée** : Use runtime-neutral AGENTS.md as the authoritative common repository instructions and a thin CLAUDE.md importing @AGENTS.md with only necessary Claude-specific instructions. Reconcile installer-managed blocks and doctrine loading, preserve consumer-authored content and verify the linkage through existing installation tests before removing normalized-heading and both-files-staged parity gates and their exclusive tests. No new generator or CI job. Keep critical runtime behavior tests: identical instructions do not guarantee identical execution. This supersedes the earlier proposal of relying only on manual consistency.

### precommit-generated-artifact-mutation

**Choix** : remove-generation-and-auto-staging-from-precommit

**Accord consigné** : User answered oui to removing generated-artifact automation from pre-commit

**État consigné** : pending

**Portée approuvée** : Remove pre-commit pnpm derive, its before/after auto-staging machinery, and the redundant core-assets regeneration block, with exclusively owned tests. Retain explicit generation after coherent relevant source changes during work, review generated diffs before staging, and keep useful existing CI freshness verification. Do not defer all generation to final validation or add a replacement scheduler/hook. Other pre-commit gates remain separately undecided. Timing savings unmeasured.

### philosophy-duplicate-source

**Choix** : single-editable-source-in-docs

**Accord consigné** : User agreed to one source and corrected its location to docs because consumer architectures differ

**État consigné** : pending

**Remplacé ou précisé par** : source-build-install-layout; keep the single-source principle but use src for product doctrine

**Portée approuvée** : Make docs/PHILOSOPHY.md the sole editable source of universal doctrine. Remove the second manually maintained source in packages/core; retain only delivery copies that are necessary and derived through existing build/install machinery. Do not require packages/core in consumer projects or move their installed doctrine out of .void/installed merely to centralize source authoring. Preserve project-owned doctrine and the released-installed versus working-source boundary. Reconcile npm, marketplace and isolated self-host paths, then remove the standalone docs/core parity gate and exclusive tests while retaining useful delivery verification. No new framework or CI job. Net line savings must account for any necessary generated delivery copy; do not promise physical deletion of every copy.

### source-build-install-layout

**Choix** : src-dist-separation-and-adjacent-installed-doctrines

**Accord consigné** : User approved the source/build separation, preferred adjacent doctrine files, then asked to continue after the revised proposal

**État consigné** : pending

**Portée approuvée** : Use package src directories for authored product inputs, including runtime-consumed Markdown, and dist for assembled output through existing builds; docs explains the product. This supersedes docs/PHILOSOPHY.md as the authoritative product source: target packages/core/src/PHILOSOPHY.md, one editable source. In consumers and this repository's own installation, place .void/PHILOSOPHY.md beside .void/PROJECT-DOCTRINE.md. Preserve managed versus project ownership via the existing manifest, short headers and void-learn; keep protection of delivered philosophy. Keep .void/machine state and native runtime integration paths. Other installed assets' placement is not decided. Builders never consume installed .void inputs; active released install remains separate from source self-host artifacts. Reconcile npm/marketplace and existing migration, preserve conflicting user data, verify loading without duplicate doctrine. No new build framework, gate or consumer source-layout requirement. Remove obsolete parity after distribution proves one source; migration cost and actual gains must be reported.

### skill-size-hard-cap

**Choix** : remove-blocking-line-cap

**Accord consigné** : User answered oui to removing the 400-line skill blocker

**État consigné** : pending

**Portée approuvée** : Remove the 400-line blocking rule in pre-commit/CI and exclusively owned cap/count-equivalence tests, including duplicate assertions in mixed suites while preserving unrelated useful checks. Keep concise skill authoring and progressive disclosure guidance, with detail references only when useful. No replacement counter, exception approval, automatic warning or evaluation framework. Preserve shared counting helpers if other live consumers need them. Observed baseline: 42 core skills spawn wc in the dedicated 49-line test; time saved unmeasured. Description budgets and other anti-bloat rules remain separate decisions.

### hook-size-hard-cap

**Choix** : remove-blocking-line-cap-preserve-context-sobriety

**Accord consigné** : User approved removing the cap and explicitly warned against increasing startup context

**État consigné** : pending

**Portée approuvée** : Remove the 100-line shell-hook cap and exclusively owned assertions. Preserve focused hook design, syntax/entrypoint checks and behavioral proofs of kept protections. No replacement complexity gate or benchmark framework. Hook source length is not automatically model context; minimize actual injected content, while keeping actionable diagnostics. Runtime latency benefit not established.

### discovery-description-budget

**Choix** : keep-existing-target-and-cap

**Accord consigné** : User answered oui to retaining the existing description budget

**État consigné** : already-active

**Portée approuvée** : Keep the editorial target of 250 characters and blocking cap of 500 characters for shipped skill/agent descriptions, with useful validation tests. Add no new control or collector. This constrains individual discovery entries, not total context or actual token consumption; keep startup context sobriety and runtime-loading limitations explicit.

### skill-name-editorial-suffix-gates

**Choix** : remove-lexical-blockers-keep-coherent-conventions

**Accord consigné** : User accepted provided coherence, cleanliness and expert engineering quality remain the objective

**État consigné** : pending

**Portée approuvée** : Remove automatic suffix refusals for action names ending in ing and skill names ending in the forbidden editorial suffix lists, plus exclusively owned assertions. Keep concise meaningful names and the existing action/standard naming convention as review guidance, technical name validation, name-directory identity, void- prefix and reference resolution. No bulk renames, no kind-metadata removal in this item, no replacement naming checker or approval mechanism. Review inconsistent names when they impair understanding; do not claim lexical endings prove or disprove quality.

### mandatory-per-skill-audit-note

**Choix** : remove-second-document-requirement

**Accord consigné** : User answered oui and reiterated preference for removing potential blockers

**État consigné** : pending

**Portée approuvée** : Remove mandatory docs/plans/skill-audits/<name>.md presence per skill, its blocking check and exclusive assertions. Keep concise co-located .source provenance and important adaptation rationale, with applicable attribution/license material; identify original work honestly. Preserve existing useful audit history and unique rationale rather than bulk deleting archives. Existing structural decision mechanism remains applicable. No new registry, mandatory template or replacement gate. Gain mainly maintenance, not initial context.

### redundant-command-skill-collision-checks

**Choix** : remove-redundant-within-root-collision-checks

**Accord consigné** : User answered oui to removing the two redundant checks

**État consigné** : pending

**Portée approuvée** : Remove the anti-bloat command-versus-skill collision loop and the duplicate within-root test. Preserve the existing no-shipped-commands-directory test and unique skill names across core/packs. Preserve consumer-authored command files. Update obsolete explanatory comments without relying on historical duplicate-menu behavior as current runtime evidence. No new gate or format migration.

### redundant-ci-builds

**Choix** : build-once-reuse-valid-results

**Accord consigné** : User explicitly approved simplifying redundant builds by doing them once and reusing the result

**État consigné** : pending

**Portée approuvée** : Consolidate identical builds/generation within a validation run when source inputs, toolchain and output remain valid. Preserve distinct behavior/integrity checks and stale committed-artifact detection; prove earlier regeneration cannot silently turn stale delivery green. Prefer simple existing command sequencing and native CI artifact reuse where needed, without a new cache framework or service. Preserve relevant checks during work, not only at final validation. Required independent environments and fresh changed inputs still need their own build. Measure actual saved work/time after implementation.

### harness-graph-retirement-direction

**Choix** : target-full-engine-retirement-with-minimal-needed-capabilities

**Accord consigné** : User explicitly prefers removing the whole engine if dispensable, asks to map replacements, and warns against dependency proliferation

**État consigné** : design-direction-recorded-implementation-pending

**Portée approuvée** : Investigate and design full retirement of harness-graph rather than preserving it by default because other custom components import it. Remove unused reporting/visualization instead of recreating it; prefer native runtime OTel for available observability. Identify concrete development and safety outcomes still required, preserve existing test/review/merge evidence and installation protection, use existing Git/compiler/linter/schema tools first. Consider Knip or dependency-cruiser only for a demonstrated remaining need and net maintenance benefit; Dependabot handles dependency updates/vulnerabilities, not code topology. No new dependency, collector, backend or export activation approved here. Final capability removals and public API migration consequences remain to be made concrete in the one-item discussion; no package deletion yet. CPU/memory savings are hypotheses until measured; source/test footprint is observed, not equivalent to deletion count.

### harness-health-score

**Choix** : retire-score-and-exclusive-machinery

**Accord consigné** : User explicitly approved removal of health score and dedicated machinery while retaining concrete controls.

**État consigné** : pending

**Portée approuvée** : Remove score computation/display and score-exclusive tests; stop automatic score history production; preserve historical data and concrete doctor diagnostics, tests and review/merge evidence. No replacement scoring tool or dependency. Remaining certification/status capabilities and public API migration assessed separately.

**Gains et limites consignés** : 188 lines score.ts + 216 lines dedicated test = 404 lines observed; not full deletion or runtime savings measurement.

### harness-certification

**Choix** : retire-frozen-certification-and-exclusive-machinery

**Accord consigné** : User explicitly approved removal: oui on supprime, ca napporte rien.

**État consigné** : pending

**Portée approuvée** : Remove graph certification manifest, dedicated generator, mirrored artifacts, synchronization checks and display consumers. Retain concrete behavioral/install tests, useful eval reports, independent review and merge evidence. Do not delete stress-proof/test-certification workflow merely because its name matches. Check shared validator consumers before retiring. No replacement tool or dependency.

**Gains et limites consignés** : 282 lines across builder/types/dedicated test/CLI generator; 36118 bytes source JSON observed, before mirrors. No measured runtime savings.

### project-code-graph

**Choix** : retire-projectgraph-and-exclusive-commands

**Accord consigné** : User explicitly approved: oui on supprime.

**État consigné** : pending

**Portée approuvée** : Remove proprietary ProjectGraph and exclusive graph project/knowledge build/check and impact/owners/tests/path query commands, why command, caches, exclusive benchmarks/conformance/tests and generated knowledge machinery. Migrate internal references and document removal of published /project API. Preserve historical user artifacts, unrelated mission state and actual validation/review/merge proofs. Use existing search/Git/compiler/test runner; do not imply identical automatic impact answers or narrow tests based on assumed completeness. No replacement engine or dependency approved.

**Gains et limites consignés** : 64 TS files including 31 tests, 15426 lines in project subtree. Included within harness-graph baseline; avoid double counting. No measured latency/memory gain.

### generated-cheatsheet

**Choix** : retire-generation-and-command-retain-short-guide

**Accord consigné** : User approved the proposed removal and short guide: ok.

**État consigné** : pending

**Portée approuvée** : Remove exhaustive cheatsheet generation and multi-format CLI command, exclusive taxonomy/rendering/availability logic and synchronization checks. Retain short human-oriented essential workflow guide in existing docs, native skill discovery, CLI help and concrete doctor diagnostics. Preserve shared receipt/manifest/catalog consumers until independently assessed. No new generator or dependency.

**Gains et limites consignés** : 890 lines dedicated library/tests plus generator, excluding command, other tests and generated docs. Not final net deletion estimate.

### ci-stress-proof

**Choix** : retire-weekly-blanket-stress-campaign

**Accord consigné** : User explicitly approved removal and prioritizes reducing excessive CI consumption.

**État consigné** : pending

**Portée approuvée** : Remove weekly/manual dedicated stress workflow and exclusive orchestrator/report machinery/tests. Retain ordinary suites and native Vitest shuffle/seed for justified targeted investigations, no retry-to-green or replacement job. Preserve historical reports. Less proactive broad flake detection accepted; no evidence of measured prior detection rate or duration.

**Gains et limites consignés** : Up to 60 suite invocations per weekly full successful campaign (20 fast + 10 times 4 complete lanes), plus 230 lines workflow/runner/tests. 90-minute timeout is a ceiling, not measured runtime savings.

### ci-stop-after-required-failure

**Choix** : aggregate-cheap-feedback-then-stop-expensive-dependent-work

**Accord consigné** : User agrees with early failure direction, conditioned on avoiding serial correction loops; recalls prior excessive errors preventing progress to CI.

**État consigné** : pending

**Portée approuvée** : Refine initial first-failure proposal: collect failures from a small existing set of cheap independent checks in one pass; if any required check fails, stop before expensive downstream work. Preserve dependency order; failed build stops checks requiring that build. Existing test runner should continue useful failure collection within its selected suite rather than adding bail=1. Reuse existing commands locally after coherent changes and still-valid evidence; no new precommit gate, scheduler, framework, repeated full validation or retry-to-green. Keep all applicable required checks for a passing verdict; unexecuted checks stay explicitly skipped/unproven, never passed. Preserve failure diagnostics and independent review. Determine cheap set from observed duration/dependencies, not arbitrary classification.

**Compromis consigné** : Cannot guarantee zero correction iterations. Batching cheap independent errors reduces serial discovery; savings on failed runs only, to measure after implementation.

### ci-explanatory-docs-only

**Choix** : target-validation-to-explanatory-doc-changes

**Accord consigné** : User approved docs-only targeting and expanded direction to targeted CI before production.

**État consigné** : pending

**Portée approuvée** : Use existing bounded selection/native Actions conditions for explanatory docs-only PRs. Keep relevant reference/security checks and conclusive required results; product Markdown, build inputs, generated artifacts and uncertain diffs are not exempt. No new dependency or parallel mapping.

### ci-targeted-development-full-promotion

**Choix** : target-development-and-integration-full-before-main

**Accord consigné** : User proposes targeted CI until production/main and full replay at promotion; asks whether this aligns with leaders.

**État consigné** : design-direction-recorded-implementation-pending

**Portée approuvée** : Adopt direction: affected checks during development including affected dependents and integration contracts; validate combined merge-group result for develop rather than only isolated branch. Broaden for shared foundation/config/lockfile/installer/CI changes or unknown impact. Run all retained useful required suites on actual up-to-date promotion candidate before main admission/publication, including supported-OS installation. No claim of absolute production guarantee. Preserve targeted feedback throughout work, independent review/security and grouped cheap failures. Reuse existing workspace/Git/test capabilities; no Nx or replacement graph engine installation. Define minimal concrete selection and promotion activation during design.

**Compromis consigné** : Selective testing can miss indirect effects; full promotion is last safety check, not first integration test. No measured savings yet.

### promotion-ci-activation

**Choix** : draft-promotion-until-ready-full-validation-on-ready-candidate

**Accord consigné** : User explicitly asks to adapt standing promotion PR issue and accepts remainder of targeted CI direction.

**État consigné** : pending

**Portée approuvée** : Use native draft PR lifecycle for standing develop-to-main promotion during development. Human marks ready to trigger full useful validation; later candidate/base changes invalidate affected proof and require current complete validation before merge. Never auto-mark ready or merge. Avoid heavy full pipeline for draft promotion updates; preserve lightweight explicit non-admissible state and cancellation of superseded PR runs. Existing ready promotion must not be silently reset by every develop push. Preserve release-please/publication protections. No new scheduler/labels/approval service.

### ci-install-os-targeting

**Choix** : linux-development-baseline-platform-sensitive-expansion-full-promotion

**Accord consigné** : User approved selective OS matrix, then asked why platform tests exist and whether they can be dispensed with. Total removal not authorized.

**État consigné** : pending

**Portée approuvée** : Linux baseline for development changes needing consumer conformance with clear platform-independent impact. macOS/Windows added for install/update/paths/files/process/shell/permissions/dependencies/shared configuration and uncertain impact. All supported OS before main. Docs-only exemptions remain. Reuse one existing selection mechanism and native matrix, no new tool.

**Gains et limites consignés** : Two of three conformance jobs avoided per qualifying run; not two thirds of all CI or measured monetary savings.

### ci-platform-conformance-scope

**Choix** : retain-small-real-platform-coverage

**Accord consigné** : User explicitly accepts limiting scope, then asks about libraries to simplify and reduce CI consumption.

**État consigné** : pending

**Portée approuvée** : Keep essential real-platform installed-package/init/update/hook checks at agreed targeted cadence. Avoid repeating platform-independent logic suites across OS. Further removal of latency campaign or suite-specific behavior remains to assess separately. No library addition authorized merely by inquiry.

### consumer-test-preparation-reuse

**Choix** : reuse-package-preparation-preserve-fixture-isolation

**Accord consigné** : User explicitly approved mutualized preparation without a new dependency.

**État consigné** : pending

**Portée approuvée** : Reuse immutable tested package preparation across compatible consumer suites within an OS run. Preserve independent writable test projects, real clean installation/update/package-name invocation and platform-sensitive path cases. Do not share mutable fixture state or build a cache framework. Use existing runner/Node/Actions and measure actual installation/time reduction.

**Gains et limites consignés** : Seven explicit npm install calls per OS observed across install/hooks/autopilot/latency before simplification, plus separate package-name npm exec proof. No promised seven-to-one reduction; overlaps gains from any suite retirement.

### ci-latency-campaign

**Choix** : on-demand-benchmark-no-routine-ci-campaign

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove repeated latency campaign from normal consumer CI including full pre-main validation. Keep simple existing benchmark for intentional performance investigations, no replacement schedule/job/dependency. Remove exclusive CI observation wrapper/classifier/tests if unused. Preserve functional protocol/input/timeout/termination tests and real installed-hook timing limits. Measure worker changes when pertinent.

**Gains et limites consignés** : 180 Node measurement processes avoided per selected OS, 540 for full three-OS matrix; not measured seconds. Installation reduction overlaps preparation mutualization.

### legacy-conformance-oracle

**Choix** : retire-declarative-oracle-preserve-behavioral-regressions

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove standalone legacy-v3 compatibility inventory, exclusive schema/duplicated validators/typings/tests and consumer preflight. Preserve real tests of supported installation/update/collision/rollback/receipt/runtime/merge behavior. Map important retained contracts to executable tests before removal and address material gaps with targeted tests only; no generated catalogue/framework or mechanical 24-test replacement. No blanket removal of backward compatibility.

**Gains et limites consignés** : 450 lines across seven dedicated files observed; maintenance saving, no measured CI duration saving.

### ci-per-gate-json-reports

**Choix** : native-actions-results-no-per-gate-report-roundtrip

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove CI-only per-step JSON serialization/readback aggregation and exclusive tests. Use native step/job outcomes and exit codes, retaining grouped cheap failure feedback and expensive early stopping. Preserve actual checkout/candidate identity, applicable check completeness, artifact drift protection, protected judging paths and separate local mission/review/merge/publication proofs. Unexpected missing/skipped required checks cannot pass; continue-on-error outcomes must retain failures. Do not delete verify.mjs wholesale or introduce new evidence framework.

**Gains et limites consignés** : Up to 23 report writes/readbacks per current full run; overlaps gate retirements. Primary gain maintenance, no measured large duration improvement.

### package-size-ci-report

**Choix** : keep-light-size-guard-reuse-tarballs-widen-headroom

**Accord consigné** : User explicitly approved and requests remaining-work overview.

**État consigné** : pending

**Portée approuvée** : Retain minimal accidental tarball bloat guard; measure already-produced relevant artifacts, remove size-only repacking and duplicate inventory where existing owner suffices. Choose meaningful headroom from post-cleanup measured size to avoid routine budget edits; no arbitrary new ceiling yet. Preserve publication content safety and real install checks; package size is not startup context budget. No new size dependency/job/service.

**Gains et limites consignés** : Current size script performs four pack invocations, including CLI prepack builds; overlaps package retirement/build reuse and must not be double counted.

### test-runner-organization

**Choix** : native-vitest-projects-retire-custom-classifier

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace custom tier/resource classification scanner with small native Vitest configuration and only justified resource-constrained groups. Remove proof-tier taxonomy, regex inference and exclusive classifier tests/scripts. Preserve isolation/cleanup, conservative heavy-suite concurrency, explicit network requirements and targeted invocation. No new dependency/scheduler or manual per-file registry. Compare collected retained tests before/after to avoid omissions/duplicates; measure before adjusting worker budgets.

**Gains et limites consignés** : 345 lines classifier plus dedicated tests, partly replaced by standard configuration. Four current lane invocations reload scanner; no measured wall-time gain.

### ci-workflow-generation

**Choix** : native-yaml-retire-workflow-generator

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace generated managed CI block with ordinary GitHub Actions YAML calling shared project commands. Remove generator/render-check scripts, derive step and exclusive byte-equality tests. Preserve single command implementations/shared selection, actual applicable-check coverage, cheap grouped feedback, native failure outcomes, candidate identity and artifact freshness. Keep meaningful workflow contract tests without textual snapshots. Do not remove whole verify CLI without evaluating remaining consumers or create another generator/registry.

**Gains et limites consignés** : 135 lines generator plus dedicated tests baseline, overlapping CI-report test retirement; no measured material duration saving.

### skill-reference-register

**Choix** : retire-generated-inventory-retain-reference-validation

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove generated docs/SKILL-REFERENCES.md, rendering, freshness-only checks/tests, derive generation step and mandatory register-first rename instruction. Preserve unresolved skill name/path detection and real regressions; consolidate useful validation with existing checker. Existing rg provides on-demand navigation, not validation. No new dependency or registry.

**Gains et limites consignés** : 89 generated documentation lines plus exclusive rendering/tests. Generator has 346 lines but includes useful validation and is not wholly removable; runtime saving unmeasured.

### asset-path-validation

**Choix** : retire-static-prose-path-gate

**Accord consigné** : User explicitly requests removal, preferring worker diagnosis, search for the actual target and proposed correction.

**État consigné** : pending

**Portée approuvée** : Remove scripts/check-asset-paths.mjs, exclusive tests, package command and validation/CI wiring. Accept loss of proactive stale prose path detection. During work signal an invalid path, search evidence for actual destination and propose correction; ambiguous/unavailable destinations do not license fabricated paths or relaxed authorization. Retain separately accepted skill-reference validation and executable hook/manifest/install correctness checks. Capture reusable wording through the agreed void-learn consolidation, no new hook or detector.

**Gains et limites consignés** : 151 script lines + 92 dedicated test lines = 243 lines plus wiring. One observed local check took 156ms; no claimed CI benchmark or major speed gain.

### remaining-repository-precommit

**Choix** : retire-repository-precommit-and-auto-install

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove repository .githooks/pre-commit and root prepare auto-configuration of core.hooksPath once its approved parity/generation retirements are implemented. Preserve useful structural checks through existing targeted in-work validation and CI; no pre-push replacement or final-only validation bottleneck. Installed runtime safety hooks and consumer hooks unaffected. Preserve personal hooks/custom Git configuration; any obsolete local configuration cleanup must target proven repository-owned value only.

**Gains et limites consignés** : 91-line hook plus prepare wiring, largely overlapping earlier parity/generation retirements. Residual time saving unmeasured; do not double-count.

### autonomous-value-evaluation-campaign

**Choix** : retire-experimental-campaign-without-replacement

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove autonomous-value campaign infrastructure and exclusive tests, fixtures, manifests, protocol inputs and wiring after dependency verification. Preserve historical reports and actual product Autopilot safety, authorization, merge and spending controls outside this experiment. Assess simple behavioral evaluations separately. No replacement framework/dependency or paid run.

**Gains et limites consignés** : autonomous-value subtree 28 TS files, 5375 lines including 2453 test lines. Excludes extra exclusive shared types/cases; exact net and CI saving to measure. Paid campaigns were not automatically running; no invented token savings.

### simple-behavioral-evaluations

**Choix** : retire-bespoke-eval-engine-retain-useful-scenarios

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove remaining custom evaluation execution/scoring/report engine and exclusive tests/wiring. Preserve useful scenario fixtures, task and observable success criteria for proportionate on-demand native-runtime checks, historical reports, and actual product/runtime regression coverage; transfer any meaningful unique coverage before removing wrappers. No replacement framework/dependency, mandatory per-change ritual or automatic paid campaign. Explicitly accept loss of automatic repeated A/B comparison; manual checks are not equivalent statistical evidence.

**Gains et limites consignés** : 4724 TS lines outside autonomous-value subtree as upper baseline, includes some autonomous-only shared code and retained fixtures/criteria. Net to count after removal; no double-count or claimed measured CI/token savings.

### consumer-ci-protected-foundation

**Choix** : preserve-foundation-allow-additive-project-ci

**Accord consigné** : User clarification: Void Machine guarantees a clean efficient CI foundation; consumers may enrich it without deeply changing that foundation.

**État consigné** : design-constraint-pending-implementation-audit

**Portée approuvée** : Preserve previously approved absolute protection of installed harness assets. CI foundation owned/versioned by Void Machine; consumer-specific checks extend via native separate jobs/workflows and documented configuration without weakening foundation. Prefer existing reusable .github/workflows/enforce.yml over custom composition machinery. Distinguish design intent from current enforcement: immutable reusable implementation alone does not guarantee required invocation in consumer repo. Verify actual caller/required-check protections before claiming enforced guarantee; no remote configuration change authorized by this clarification. Foundation changes through void-learn/upstream release. ADR immutability is separate and still undecided.

**Gains et limites consignés** : No additional dependency/generator intended; cost/coverage to verify, no claim all consumer CI already protected.

### adr-text-immutability-gate

**Choix** : retire-text-lock-preserve-decision-history

**Accord consigné** : User explicitly authorizes removal and requires preserving decision history.

**État consigné** : pending

**Portée approuvée** : Remove accepted-ADR text immutability gate, mechanical-reference exception machinery and exclusive tests/DECISIONS_BASE wiring. Preserve existing ADR files/identities/history, project CI foundation protections and void-learn approval. Corrections of typos/links/wording may be committed normally; actual reversal or material change remains a new short decision linking the previous one, which stays readable. Use native Git history for committed revisions and existing replacement links; no new history service, duplicate ledger, snapshot generator or CI gate. Document that Git records committed states, not unsaved/uncommitted intermediate edits; do not claim absolute retention despite history rewrite. CLI creation/schema/render machinery remains separately undecided.

**Gains et limites consignés** : 288 lines immutability implementation plus 257 dedicated test lines = 545 baseline, plus exclusive wiring. Actual net and CI duration unmeasured.

### remaining-adr-cli-machinery

**Choix** : retire-custom-cli-keep-light-frontmatter

**Accord consigné** : User confirmed Markdown with frontmatter, then: ok on continue.

**État consigné** : pending

**Portée approuvée** : Remove dedicated decisions new/check/render CLI and exclusive tooling, format gates and tests/wiring, preserving useful Markdown ADRs with lightweight YAML frontmatter: stable id, title, createdAt/date, status and replacement references. Preserve historical files, IDs, metadata and links; no bulk rewrite. Keep useful existing metadata readers or adapt them to retained lightweight format; no new index, dependency, schema gate or taxonomy. Meaningful decisions/history and void-learn approval remain. Stable unique file names, no shared sequential counter or overwrite. Document public command removal as breaking. Any remaining project-conformance/migration machinery assessed separately, not automatically authorized by this decision.

**Gains et limites consignés** : Prior upper baseline1475lines beyond immutability; retained metadata readers and historical compatibility reduce net. Measure actual diff without double-count.

### backlog-index

**Choix** : retire-local-synchronization-use-connected-tracker

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove private backlog:index scripts, exclusive tests/wiring and mandatory local refresh after Linear writes. Query connected tracker on demand and read relevant full issues/comments. Preserve existing local snapshots and human reviews as dated archives; no deletion of historical user data or remote mutations. No SDK, cache replacement or new dependency. Tracker remains authoritative, unavailable remote state does not block unrelated local work.

**Gains et limites consignés** : 584 lines:363script+221tests, plus docs/wiring. Actual CI/time savings unmeasured; loss of offline coherent corpus accepted.

### doctor-documentation-conformance-repair

**Choix** : retire-document-migration-engine

**Accord consigné** : User approved: ok au pire je demanderai au llm de convertir au bon format.

**État consigné** : pending

**Portée approuvée** : Remove doctor documentation-format advisory, sole decisions-format repair rule, generic repair framework and exclusive tests/docs/flags after checking remaining callers. Keep existing documents, history, useful metadata readers and technical install/runtime diagnostics. A later explicitly requested conversion is ordinary scoped reviewed work preserving content/history, no permanent replacement engine.

**Gains et limites consignés** : 965 lines across six source/test files plus doctor wiring. Advisory already nonblocking; no claimed blocker removal or measured CI saving.

### doctor-local-health-update-check-separation

**Choix** : local-doctor-explicit-update-check

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove remote version/auth checks from ordinary doctor; retain local installation, manifest integrity, wiring and CLI/layout compatibility checks. Consolidate remote version discovery in existing check with npm-channel support using existing functions (currently marketplace only). Keep needed remote/auth checks in install/update and other dependent operations. No new command/dependency or automatic updates. Document compatibility of --no-remote and do not delete shared fetch utilities needed elsewhere.

**Gains et limites consignés** : Remove network/auth dependency from ordinary diagnosis and redundant remote version orchestration; exact lines/latency unmeasured. Registry freshness already advisory, gh auth path could fail local diagnosis.

### doctor-invocation-health

**Choix** : retire-usage-derived-health-and-alerts

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove invocation health verdict based on mission usage and corresponding cached startup alerts, exclusive tests/cache/wiring. Preserve real installed-file integrity, hook/runtime wiring and skill-reference validation, actionable errors, redirects and shared mission/review evidence. Do not replace with OTel polling or another absence-of-use heuristic. Native telemetry remains separate and no exporter activated.

**Gains et limites consignés** : 283 lines invocation-health + test, plus exclusively owned shared-module portions after caller check. Journal reads bounded64MiB not a measured typical saving; avoid double-count with usage/audit retirements.

### selfhost-rollout-modes

**Choix** : single-explicit-validation-contract

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove shadow/warn/enforce/release-gate rollout modes and --mode plumbing. Explicit self-host validation returns failure on structural defects; absent optional runtime remains visibly untested/degraded. Preserve isolated artifact, source/file integrity, rollback and released root floor. No automatic per-edit check or unrelated local-work prohibition. Adapt old receipt handling and callers; remove mode-only tests and mode-only rebuild invalidation.

**Gains et limites consignés** : Four mode values and mode-dependent behavior removed; exact net lines/time unmeasured. Eliminates mode-only rebuild cause, overlap build-reuse benefits.

### doctor-source-routing

**Choix** : remove-implicit-selfhost-redirection

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : doctor always diagnoses the installed released harness, including source repository. Explicit self-host doctor diagnoses isolated current-source artifacts and remains in applicable CI. Remove routing helper/exclusive tests; retain source-repo detection for init/update/source compiler safety and installRoot worktree behavior. No combined automatic double check/rebuild. Source-only clone missing install reports actual absence.

**Gains et limites consignés** : Small conditional/helper/test reduction; benefit clarity and restored installed-floor diagnosis, no measured speed gain.

### release-version-lockstep

**Choix** : retain-lightweight-targeted-check

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Keep local manifest version coherence. Target development checks to affected manifests/release configuration/generation; retain before main and on publish candidate. Remove graph/retired component references and real-repository duplicate assertion; retain useful behavioral drift checks. No new job or dependency.

**Gains et limites consignés** : 78-line source guard retained; modest duplicate test/execution savings, no measured CI time.

### release-back-merge

**Choix** : retain-native-auto-merge-and-targeted-ci

**Accord consigné** : User explicitly approved: oui c’est bien ça.

**État consigné** : pending

**Portée approuvée** : Keep main-to-develop synchronization through existing PR and native auto-merge, ancestry/identity/conflict/queued-head protections and useful behavioral regressions. Apply approved targeted development CI; no blanket exemption, extra LLM review or dependency.

**Gains et limites consignés** : Workflow retained; downstream CI savings belong to targeted-CI decision and must not be counted twice.

### manual-version-bumper

**Choix** : remove

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove scripts/bump-version.mjs, pnpm bump and obsolete active instructions. Keep historical decisions, release-please version authority/native Release-As, version coherence and immutable-tag publication recovery. No replacement dependency.

**Gains et limites consignés** : 150 source lines plus command and obsolete documentation. No routine CI saving evidenced.

### publish-safety-repacking

**Choix** : validate-reused-published-cli-tarball

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove standalone four-package repacking engine. Check actual existing CLI archive for unresolved workspace references and preserve useful install/start proofs, artifact identity/integrity and OIDC separation. Internal unpublished modules need no separate npm publish-safety pack. Reuse artifacts in applicable development checks and publication; adapt command/callers and size coverage tests.

**Gains et limites consignés** : Five direct pack calls to one in two inspected release steps; four removed. Shared build/graph/size savings counted once, elapsed saving unmeasured; 65-line old engine net replacement diff TBD.

### post-publication-provenance

**Choix** : retain-proof-reduce-native-duplicates

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Keep credential-free verification of actual published bytes and cryptographic provenance using native npm/GitHub commands. Simplify only demonstrated equivalent manual checks and unnecessary format-only restrictions; retain unique expected producer/current-run vs retry identity and release artifact binding and meaningful negative regressions. No new dependency or per-development-PR job.

**Gains et limites consignés** : 367 production and 257 test lines inspected, not all removable. Net reduction and elapsed savings unmeasured.

### registry-convergence

**Choix** : retain-bounded-read-only-wait-and-idempotent-recovery

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Keep single publish, bounded read-only polling, immediate fatal hash/auth/invalid response failures, stop on convergence, and existing-version recovery without republishing. Keep current operating allowance until actual release timings justify adjustment. No development CI polling or additional scheduler.

**Gains et limites consignés** : No direct removal saving; retain 30-minute hard job ceiling, distinct from 12-minute pause allowance. Historical six-minute propagation evidence, not remeasured.

### legacy-local-release-command

**Choix** : remove

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove root pnpm release direct local publishing script and obsolete active guidance. Keep protected release workflow and immutable-tag retry; no wrapper or registry permission change, retain historical ADRs.

**Gains et limites consignés** : One script entry and stale guidance, no significant direct CI saving.

### mandatory-primary-domain-consultation

**Choix** : risk-and-uncertainty-triggered-advice

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove systematic pre-edit specialist consultation for every behavior/contract/structure change. Use targeted expertise early for consequential unresolved choices, missing expertise or concrete high-impact risk; preserve applicable safeguards, relevant tests and independent post-change review. Reuse applicable unchanged advice. No exemption form, default panel or extra general review at end.

**Gains et limites consignés** : One otherwise mandated consultation avoided per qualifying routine task; tokens and elapsed gain unmeasured. Specialist capabilities retained.

### pr-review-evidence-format

**Choix** : remove-mandatory-template-and-heading-hook

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove literal Review Evidence heading/checklist obligation and shipped pre-PR-review-evidence hook/mirror and stale references. Keep concise actual review result, unresolved blockers, limitations and useful proof references. Preserve authoritative independent review identity, exact subject and evidenced resolution checks. No replacement gate.

**Gains et limites consignés** : 47 source hook lines plus generated mirror and template/reference reduction. No active wiring found in inspected configurations, so no current execution/CI saving claimed.

### subjective-review-scores

**Choix** : remove-mandatory-ratings-and-universal-score-gates

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove mandatory /10 ratings and approval thresholds across plan/UI/DevEx reviews and derived instructions. Remove universal TTHW>10min blocker and unsupported generic adoption percentages. Keep measured journey time/steps, contextual agreed objectives, concrete quality/accessibility/reliability defects, actual visual/behavioral evidence and reviews. No new scoring engine.

**Gains et limites consignés** : Instruction/template reduction and avoided score-chasing, no measured savings or net line estimate.

### plan-review-scope-reopening

**Choix** : remove-automatic-expansion-respect-accepted-scope

**Accord consigné** : User explicitly approved removing automatic expansion and respecting accepted scope; suggests ambition/alternatives/opportunities belong in brainstorm.

**État consigné** : pending

**Portée approuvée** : Remove automatic product ambition/expansion, fixed alternatives/opportunities quotas and repeated approval from ordinary plan review. Keep risk-relevant critique and reopen only for consequential new evidence or explicit strategic mandate. Exploration belongs before scope acceptance in brainstorm; exact nonmandatory brainstorm formulation remains under discussion.

**Gains et limites consignés** : Procedure reduction and avoided repeated scope/approval cycles; no measured gain.

### brainstorm-exploration-without-quotas

**Choix** : contextual-exploration-before-scope-acceptance

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Consolidate alternatives/ambition/opportunities in existing brainstorm before scope acceptance. Compare credible materially different approaches, consider better or simpler outcomes when useful, no mandatory2-3 alternatives,10x ambition or five opportunities. Confirm consequential chosen scope once; preserve settled decisions. No added mandatory stage.

**Gains et limites consignés** : Consolidated instructions and reduced invented alternatives/approval cycles, no measured savings.

### plan-human-checkpoint-quota

**Choix** : remove-step-count-human-pauses

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove default1-2human pauses triggered solely by>=5plan steps. Continue authorized execution with meaningful progress updates and incremental verification. Preserve explicit human holds, decisions beyond mandate, void-learn approval and protected deployment promotion. Do not silently erase existing explicit holds; context checkpoints remain separate. No shifted final bottleneck.

**Gains et limites consignés** : Avoid1-2arbitrary user waits per qualifying plan; elapsed/token gain unmeasured.

### mutation-capability-is-not-obligation

**Choix** : remove-tool-presence-triggered-mandatory-mutation

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Mutation tool/config command presence alone no longer mandates execution. Keep explicit project requirements/CI thresholds, explicit request and targeted use for concrete test-strength uncertainty or critical behavior. No default installation or CI campaign. Preserve useful behavioral tests and do not lower consumer requirements silently.

**Gains et limites consignés** : Avoid unnecessary mutation executions in equipped consumer projects; no active campaign found in inspected Void Machine CI, no immediate measured saving.

### per-step-tdd-declaration

**Choix** : remove-repeated-plan-label-retain-testing-discipline

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove mandatory TDD-mode field on every plan step and missing-label incompleteness rule. Apply existing testing/TDD discipline from actual change and explicit project requirements; retain appropriate acceptance/verification and required RED/GREEN proof. Record only material testing strategy or exceptions; remove obsolete claim of plan field feeding retired tdd-guard. No new detector.

**Gains et limites consignés** : One repeated field per step plus redundant instructions, no immediate measured CI saving.

### snapshot-blanket-ban

**Choix** : allow-focused-reviewed-snapshots

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace blanket snapshot ban, directory whitelist and special review exception with ordinary test-quality review. Permit short deterministic readable snapshots for stable observable outputs when clearer; prefer targeted assertions for logic/interactions; review updates, never blindly regenerate. No new tool or wholesale test conversion; preserve explicit consumer policy. Remove stale no-snapshot-default hook references.

**Gains et limites consignés** : Reduced exception/instruction overhead; no demonstrated runtime or CI saving.

### beforeeach-test-data-ban

**Choix** : allow-isolated-readable-shared-setup

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace categorical ban on data preparation in beforeEach with isolation/readability. Prefer local setup/simple factories where clearer; permit common preparation with fresh/reset state. Avoid shared mutable suite variables for concurrent tests. Correct misleading leak example; no mass rewrite, forced helper or new framework.

**Gains et limites consignés** : Reduced style-only corrections and exceptions; no measured runtime/CI saving.

### fixture-five-line-extraction

**Choix** : remove-line-threshold-and-forced-fixture-layout

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove five-line extraction threshold, mandatory tests/fixtures location and compulsory configurable factory. Keep scenario-relevant data adjacent; extract bulky/reused data when clearer and easier to maintain. Preserve test isolation, no automatic existing-test reorganization or new framework.

**Gains et limites consignés** : Fewer unnecessary helper files and navigation; no measured net lines or CI saving.

### test-interaction-assertion-ban

**Choix** : allow-observable-boundary-interaction-assertions

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace never-assert-mock-call-count wording and misleading example with contract distinction. Permit calls/counts/arguments/order for meaningful observable effects (zero unauthorized commands, no duplicate payment, bounded retries). Keep actual decision/auth code and meaningful integration tests; avoid incidental private call graphs. Harmonize existing boundary-side-effect allowance, no new tooling or wholesale rewrite.

**Gains et limites consignés** : Fewer contradictory instructions and artificial manual counters; no measured CI/time saving.

### mandatory-test-tool-vendors

**Choix** : reuse-existing-faithful-test-tooling

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace mandatory named libraries/providers with existing project tooling when faithful to tested behavior. Examples optional, no automatic dependency/service/account addition. Keep real SQL/adapter/migration proof and representative engine for locking/concurrency/extensions/version-sensitive behavior; document substitute limitations. Preserve useful existing installations and explicit consumer stack, no mass migration.

**Gains et limites consignés** : Avoid unnecessary consumer dependencies/setup; no immediate measured CI saving or automatic dependency removals.

### test-output-pristine-gate

**Choix** : verify-expected-diagnostics-retain-real-failure-detection

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Remove universal warning/error-output silence condition and invalid onConsoleLog:fail prescription. Capture/assert expected diagnostics narrowly; no global silencing. Preserve unhandled-error/resource failure detection, actual project requirements and logger policy. Assess deprecation warnings by impact; no new log-policing framework.

**Gains et limites consignés** : Fewer warning-only correction cycles and misleading instructions; no measured current CI saving.

### autopilot-shared-git-fingerprint

**Choix** : retain-scoped-autonomous-admission-protection

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Retain shared-Git fingerprint before/after worker and before autonomous merge admission, along with real permission controls. Explain detected drift affects concerned autonomous publication/merge, not blanket repository/host work. Preserve diagnostic/manual resolution and no baseline reset to hide mutation.

**Gains et limites consignés** : Retained8localGit reads plus directory hashing per observation, no measured cost or direct saving. Detects net change, not author or prevention.

### bounded-correction-cycles

**Choix** : retain-existing-differentiated-limits

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Keep ordinary mission initial review+max2correction batches and Autopilot initial+max1corrected-head review. Only demonstrated blockers trigger corrections, targeted affected-proof verification, no repeated general panel. Reviewer failures do not consume correction rounds. At exhaustion preserve unresolved evidence and stop concerned automatic correction with cause/next action, no blanket repo ban or fabricated green.

**Gains et limites consignés** : Existing loop/resource limit retained; no direct removal saving.

### autopilot-advisory-triage-issues

**Choix** : remove-automatic-nit-tickets-retain-important-followups

**Accord consigné** : User approves removal except when something is important. In context this concerns automatic suggestion tickets, not removal of tracker labels generally.

**État consigné** : pending

**Portée approuvée** : Remove systematic oneTriageissue-per-merged-ticket for routine advisories. Preserve review history and file follow-up only for important evidence-backed consequence (concrete risk, recurring reliability issue or material maintenance/user impact), recording consequence briefly. No importance from reviewer preference alone; actual current-scope blockers still resolved before completion. Retain void-learn for recurring rules. Do not delete existing issues or create local queue; this brainstorm records policy, no external issue write now.

**Gains et limites consignés** : Avoid routine suggestion tickets and human triage; important followups remain. Frequency/time unmeasured.

### autopilot-rerank-after-every-merge

**Choix** : replace-full-reranking-with-targeted-refresh

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace full mandatory curation/ranking after each merge with bounded scoped initial candidate queue and relevant refresh when dependency/status/human priority/footprint changes or queue exhausted. Re-read complete selected ticket, real blockers and in-flight collisions before every admission; use current native tracker filtering, no new local index/cache/engine. Broaden scan if effects uncertain. Preserve consent/project scope and no inferred remote state on unavailable provider. Automatic priority rewriting remains separate next decision.

**Gains et limites consignés** : Avoid repeated broad model/API curation after unrelated merges; actual call/token/time reduction unmeasured. No fewer safety admissions claimed.

### autopilot-tracker-priority-rewriting

**Choix** : replace-ranking-churn-with-native-milestone-visibility

**Accord consigné** : User accepts classification at creation and next agent resumption, without permanent service; removal conditional on verified milestone visibility and incoming-ticket handling.

**État consigné** : pending

**Portée approuvée** : Replace ranking-only priority/status churn with native milestone organization: agreed ordered milestones with short scope descriptions; view exposes upcoming ready tickets, blocked tickets and unclassified arrivals. Harness-created tickets assigned to existing unambiguous milestone on creation and persisted field reread; intake detects new/changed/unclassified tickets from other sources at next active session/refresh, without full rerank. Preserve human milestone assignments and priorities; factual lifecycle updates remain. Ambiguity stays visible for focused clarification rather than guessed placement or blocking unrelated work. No new daemon/index/dependency; no claim of continuous off-session classification without a separately verified existing automation. Removal must wait until placement, visibility, arrivals and ambiguity behavior are verified; reconcile static program order with milestone-driven arrivals before claiming coverage.

**Gains et limites consignés** : Avoid ranking-only tracker writes and comments, fewer human priority overrides. Counts and elapsed savings unmeasured; no CI saving claimed.

### ticket-mandatory-description-template

**Choix** : retain-structured-executable-ticket-remove-only-redundancy

**Accord consigné** : User explicitly approves refined structured ticket: oui.

**État consigné** : pending

**Portée approuvée** : Retain structured actionable ticket with objective/context, bounded expected behavior, technical constraints/contracts/known entry points and source links, verifiable acceptance including relevant failure cases, explicit reference to accessible project Definition of Done plus ticket-specific proofs, native project/milestone/dependencies. Bugs include observed vs expected behavior and available reproduction evidence. All consequential decisions needed to execute must be explicit or accessible in linked sources; missing material information prevents readiness only for affected ticket. Common quality requirements have one owner and are read by worker; links must be accessible, essential requirements included directly when unavailable. Remove redundant generic prose, universal TDD/pass predictions and impossible no-unknown requirement; ordinary implementation choices/investigation stay with worker. No new gate/service/dependency or historical mass rewrite. Estimate/labels remain separate.

**Gains et limites consignés** : Reduce repeated generic text and unnecessary mandatory subsections, not task clarity or proof quality. Savings unmeasured; no CI savings claimed.

### ticket-mandatory-estimate

**Choix** : retain-mandatory-tshirt-size-for-human-planning

**Accord consigné** : User rejects optional sizing; S/M/XL etc are important for human visibility of relative size and approximate effort.

**État consigné** : pending

**Portée approuvée** : Keep native Linear estimate populated using existing team T-shirt scale, without changing workspace configuration or historical values. Size represents relative effort/complexity and uncertainty, not guaranteed duration. Do not add numeric scoring engine, mandatory time conversion or new CI gate. Preserve bounded scope and split oversized tasks when justified. Respect different consumer team scales.

**Gains et limites consignés** : No saving claimed: retained metadata has demonstrated human planning value.

### ticket-label-classification

**Choix** : retain-useful-type-classification-reuse-existing-labels

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Replace arbitrary at-least-one-label with useful classification using existing team type labels (e.g. bug, feature, maintenance); retain type classification for visibility, add other labels only for actual filters/routing. Preserve operational labels including human holds and explicit consumer taxonomy. No automatic new taxonomy, mass historical relabeling or new validator. If equivalent native type exists reuse it rather than duplicate.

**Gains et limites consignés** : No demonstrated CI gain; avoids invented/duplicated labels while retaining useful human classification. Maintenance benefit unmeasured.

### multi-ticket-program-threshold

**Choix** : retire-program-md-replace-with-durable-agreed-autopilot-handoff

**Accord consigné** : User explicitly rejects program.md based on failed cross-session experience; asks to abandon it and persist upcoming Autopilot choices aligned with discussion. Replacement location/design remains to agree.

**État consigné** : pending

**Portée approuvée** : Retire mandatory local programme descriptor after replacement proves durable restart and preserves approved scope, actual human consent, holds and merge/deployment protections. Preserve historical context during migration; do not delete current executing state prematurely. Autopilot chooses and records forthcoming tickets within agreed objectives, across sessions interrupted for days. No new daemon or competing progress database.

**Gains et limites consignés** : Potential local descriptor/schema/legacy-path maintenance reduction; net gain unknown until replacement uses existing tracker capabilities and safety configuration responsibilities are accounted for.

### durable-autopilot-handoff-in-tracker

**Choix** : direct-checkpoint-autopilot-snapshot-no-mandatory-tracker-document

**Accord consigné** : User explicitly approves direct mutable Autopilot checkpoint snapshot: oui, et liste ce quil nous reste a faire.

**État consigné** : pending

**Portée approuvée** : Prefer existing local checkpoint as sole execution handoff snapshot; remove mandatory separate Linear queue document. At explicit checkpoint record observed time/repo/branch, agreed objective/milestone focus, exact project/ticket/PR/worktree identifiers for engaged work, observed stage and uncommitted work/evidence pointers, intended resume ticket/action and ordered upcoming tickets with brief rationale only where useful. Preserve essential user holds/scope constraints without using snapshot as fresh permission or verified status. Planned list is intent, not admission authority or immutable commitment; user may reorder/add/remove, completed work omitted after fresh verification and dependency changes handled. Removing from planned list does not cancel/delete remote ticket or destroy in-flight work. Resume first reads bounded local entry, fetches actual referenced tickets/PRs/Git and reconciles live workers before resuming/spawning to avoid duplicates, then confirms intended next action in update without repeated approval within existing mandate. Multiple active tickets represented honestly, no pretending all activity is one ticket. Native Linear milestones remain human visibility and actual tickets/PRs authoritative execution state. Existing project docs optional for enduring design, not compulsory mirrored queue. No daemon/index/continuous tracking/reminder gate; checkpoint can be written offline but observations labeled and remote-dependent admission deferred until verified. Snapshot reflects last successful checkpoint only; no promise to recover unsaved subsequent decisions. Preserve existing autonomy consent and merge/deploy safeguards through independently reviewed migration. Verify fresh-session resume on both runtimes including stale completed ticket, changed queue, existing live work and missing provider before removing program.md.

**Gains et limites consignés** : Avoid mandatory second queue document and programme descriptor; reuse local checkpoint/resume and native tracker. Snapshot duplicates selected observed identifiers/status deliberately for restart and is explicitly nonauthoritative until refreshed. Net time/code saving unmeasured.

### autopilot-github-observation-roundtrips

**Choix** : reduce-native-github-roundtrips-preserve-fresh-safety-checks

**Accord consigné** : User explicitly approved: Oui.

**État consigné** : pending

**Portée approuvée** : Reduce repeated GitHub round trips by narrowly grouping compatible fresh observations with existing gh GraphQL facilities and requesting only used fields. Preserve fresh authoritative checks at merge/arm/disarm boundaries, exact head/base identity, current human holds, complete changed-file pagination including rename sources, live queue membership separate from stale timeline semantics, independent local review receipt and unknown/error refusals. No persistent cache, new polling service, dependencies or generic batching framework; do not replace all REST with GraphQL when fidelity lost. Use bounded fixtures and measured invocation counts to accept only real reduction without complexity inflation. Do not reuse mutable CI/status solely because head SHA is unchanged.

**Gains et limites consignés** : Observed illustrative baseline 17 explicit gh invocations per tick under stated conditions. Reduction and elapsed/API cost savings not yet measured; GraphQL grouping does not guarantee lower server query cost.

### plan-universal-vertical-slices

**Choix** : vertical-slices-default-allow-useful-technical-steps

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : Keep small end-to-end vertical feature slices as default, remove absolute demand that every plan step cross UI/domain/persistence or ship a user-visible feature. Allow bounded verifiable preparatory refactors, infrastructure/CI work and staged compatible migrations when required by accepted scope. Preserve early integration/contract verification and completion of migration cleanup; no speculative foundation phase, scope expansion, exception form, added approval or new automated gate.

**Gains et limites consignés** : Less artificial plan decomposition and unnecessary cross-layer work; no measured timing or CI gain.

### installed-directory-retirement

**Choix** : retire-installed-directory-preserve-native-runtime-paths

**Accord consigné** : User explicitly approved: oui.

**État consigné** : pending

**Portée approuvée** : After previously approved PHILOSOPHY move beside PROJECT-DOCTRINE, retire .void/installed as a mandatory generated container instead of putting other assets there. Keep .void/hooks and native .agents/.claude/.codex runtime paths, .void/machine local recovery/state, existing ownership manifest protecting delivered assets and preserving project authored files. Remove obsolete installed-directory writers/helpers/ignore rules only when unused; migrate known managed philosophy safely and remove directory only if empty. Keep bounded legacy read/migration support as needed for supported consumers; unknown/modified files preserved, no blanket deletion or runtime symlink framework. No promise all .void root files have same ownership or tracking semantics; document explicit ownership.

**Gains et limites consignés** : Remove one dedicated current layout level and exclusive path machinery after migration; no measured runtime/CI savings and legacy compatibility may remain temporarily.

### native-telemetry-signal-scope

**Choix** : native-operational-signals-with-required-thin-two-runtime-adapter

**Accord consigné** : User explicitly approves operational telemetry scope and requires adapter for both runtimes to simplify maintenance.

**État consigné** : pending

**Portée approuvée** : Initial native runtime telemetry for useful operational signals: token/cost where actually emitted, API/tool duration and failures/retries, tool/skill/subagent activity where runtime provides it. No equal-coverage promise or custom event collector to fill gaps. Content capture prompts/responses/tool arguments/results/full payload disabled or excluded using supported native settings; if filtering cannot avoid unwanted content use metrics-only subset instead of shipping content or inventing new sanitizer. Preserve critical review/authorization/recovery records outside optional telemetry. OTel is transport/instrumentation, requires separately chosen actual destination/viewer; no endpoint/export or service activated by this decision. Configuration at user/org supported runtime layer, no SDK/dependency in consumers, no blocking on telemetry failure. Verify capabilities against deployed runtime versions and emitted sample before export. Add explicitly requested thin shared adapter boundary with separate Claude Code and Codex mappings for actual native exported inputs and minimal shared normalized operational view. Preserve runtime/version/source provenance, units and optional/unsupported fields; missing data is unavailable, never zero or invented parity. Reuse native OTLP transport/export facilities, no new collector, SDK instrumentation of every consumer or generic plugin framework. Prefer pure translation and small meaningful fixtures from actual emitted samples for both runtimes. Exact location/consumer determined with destination, no empty unused abstraction. Configuration differences isolated without storing credentials or copying secrets into projects.

**Gains et limites consignés** : Avoid bespoke journal instrumentation/analytics maintenance already approved; do not double-count that removal. Native export volume and destination cost depend on configuration and usage, not measured. Adapter is additional maintenance cost explicitly accepted to isolate runtime differences; net gain assessed after actual mappings and consumer identified.

### native-telemetry-destination

**Choix** : grafana-cloud-free-only-retain-existing-synology-option

**Accord consigné** : User owns Synology NAS with Grafana and accepts Cloud if it remains free and simplifies maintenance. No paid subscription authorized.

**État consigné** : pending

**Portée approuvée** : Recommend managed Grafana Cloud as best fit for native Claude/Codex OTLP operational signals and shared visual dashboard, compared with Honeycomb and Datadog; user requested top-quality choice. Start Free evaluation, no assumption free tier sufficient long term; Pro published from USD19/month plus usage. Native runtime direct OTLP export supported architectural path for dev telemetry; no self-hosted Grafana/Loki/Tempo/Alloy by default. Keep requested thin two-runtime adapter through configuration and actually consumed field/query mappings where possible, no mandatory proxy/collector solely to normalize fields. Native data remains distinguishable and unsupported fields unavailable. Actual compatibility/privacy/sample ingestion and units must be verified before activation; if a collector becomes necessary for agreed requirement, surface actual tradeoff rather than silently adding service. Optional telemetry failure must not block development. Prefer common dashboard for tokens/cost-when-available, durations/errors/tool activity; no synthetic quality scores. No account creation/subscription/exports authorized by research alone. Explicit condition overrides any suggestion of Pro: use Free plan only, no paid upgrade/add-on/payment commitment. Verify actual account plan/quota and sample consumption before activation; native billing/usage visibility rather than custom quota engine. Provider published Free no charges/no card and trial return to Free, but no guarantee future provider terms or workload fit. If limits are insufficient, reduce unnecessary data or reassess existing Synology installation before any paid option. Preserve NAS untouched; do not assume Grafana UI includes metrics/log/trace storage or configured secure ingestion. Required thin runtime adapter remains portable/configurable and directly consumed; no automatic dual export.

**Gains et limites consignés** : Expected service bill USD0 on actual Free plan within provider conditions; ingestion fit/retention sufficiency and setup time unmeasured. Hosted backend avoids new NAS services if direct export suffices. No claim future free terms guaranteed.

### telemetry-collector-deployment-shape

**Choix** : alloy-with-grafana-cloud-free-nas-alternative

**Accord consigné** : User approves clarified architecture recommendation with ok after text diagram: Alloy + Grafana Cloud Free initially, NAS reconsidered if free tier insufficient.

**État consigné** : pending

**Portée approuvée** : For requested complete observability suite recommend standard Grafana Alloy collector plus managed Grafana Cloud Free storage/UI if measured quotas fit; alternative self-hosted Alloy + existing Grafana + Prometheus metrics + Loki logs + Tempo only for actual useful native traces, small single-instance deployments, no distributed infrastructure. One chosen destination, not preventive dual export. Required two-runtime adapter preferably two tested explicit mapping/config modules using stable Alloy OTTL components plus runtime exporter settings, not a bespoke daemon/SDK. Bound batches/queues/retries/resources and retention; configure supported persistent export queues where useful, acknowledge loss possible before receiver or after capacity exhausted. Maintain sensitive-content exclusions and private authenticated access, Infisical-backed credentials without .env. No prometheus/high-cardinality session-id labels or invented event-to-trace relationships. Existing NAS model/RAM/storage/backend inventory not known; no promised sizing or deployment. Standard Alloy collector now approved, superseding initial direct-export-only preference; free-only hosting constraint persists. Actual collector placement awaits machine/connectivity inventory. Architecture approval does not authorize paid subscription or unknown NAS changes; prepare concrete configuration and verify access/target before activation.

**Gains et limites consignés** : Cloud variant one collector to operate; full NAS variant up to four added components if only Grafana already installed. No RAM/CPU/storage benchmark or free-tier fit measured. Adapter configs replace custom normalization process, but add maintenance acknowledged.

### telemetry-ecosystem-scope

**Choix** : grafana-alloy-only-no-additional-agent-platform

**Accord consigné** : User explicitly decides: restons simple avec grafana + alloy.

**État consigné** : pending

**Portée approuvée** : Keep agreed Grafana + Alloy with thin Claude Code/Codex adapter. Grafana Cloud Free first after representative usage check; existing Synology DS923+ with16GiB alternative if quotas/retention inadequate. Do not introduce LangGraph, LangChain, LangSmith, Langfuse or another agent observability/execution platform for this exercise. No bespoke collector, duplicate export chain, paid upgrade, or expansion into prompt management/evaluation services. Actual deployment and export validation remain pending.

**Gains et limites consignés** : Avoid additional platform/dependency and operational maintenance; no measured savings claimed for software never installed.

### mandatory-worker-display-publication

**Choix** : retire-mandatory-manual-display-publication-preserve-visible-herdr-workers

**Accord consigné** : User agreed to retire mandatory publication provided the orchestrator remains their sole interlocutor and dispatches real ticket workers visible in Herdr; explicitly confirmed Herdr tabs for visibility.

**État consigné** : pending

**Portée approuvée** : Remove universal manual JSON/agents record ceremony only after identifying the minimal integration actually required for Herdr worker visibility. Keep a single user-facing orchestrator and actual native workers, their task identity, completion/results, correction continuity and checkpoint recovery. Reuse real sessions in Herdr; never duplicate workers for display. Use supported native capabilities through a thin runtime adapter and optional Herdr integration, not another execution engine. Required display integration must not be deleted without a working replacement. Verify Herdr targets before any command. Herdr absence/refusal affects only Herdr operations; report unavailable visibility explicitly, retain local work/native delegation under normal permissions, and never claim an invisible native worker has an attached Herdr tab. Preserve independent review and authorization evidence. No guarantee of equivalent runtime attachment until tested.

**Gains et limites consignés** : Potential removal of at least four coordinator-authored display records per simple assignment; actual residual presentation operations depend on supported Herdr integration. No measured time/token/code savings yet; do not double-count telemetry retirement.

### orchestrator-blanket-inspection-ban

**Choix** : allow-targeted-coordinator-inspection-preserve-independent-review

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Remove the blanket ban on the orchestrator assessing tickets and reading diffs. Allow targeted inspection needed for user explanation, dispatch, integration coherence and blocked-worker clarification. Keep implementation assigned to writers and independent review in a fresh read-only reviewer; coordinator inspection never substitutes for the required verdict or grants merge permission. Do not impose systematic duplicate review or full-diff ingestion. No new agent/service/dependency.

**Gains et limites consignés** : Qualitative reduction in unnecessary handoffs for narrow clarification; no measured token/time savings or CI reduction. Targeted inspection can add context if overused.

### autopilot-global-human-wait-streak

**Choix** : remove-global-three-human-waits-drain-preserve-scoped-stops

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Remove blanket drain after three consecutive tickets requiring human action. Keep affected tickets and dependency/collision scopes waiting; continue only already-authorized independent ready work. Preserve explicit stop/drain, quota limits, bounded per-ticket correction and existing failed-capability/permission/merge guards. A demonstrated shared failure stops dependent actions without repeated doomed dispatch; do not add a replacement counter, diagnosis engine or dependency. Signal waits to user with actionable reason.

**Gains et limites consignés** : Avoid unnecessary interruption of independent agreed work after three unrelated human waits; no measured time savings. Removing global brake may permit more spend while overall effectiveness is poor; retain existing finite agreed scope, quota and correction bounds.

### autopilot-ready-pr-required-before-local-review

**Choix** : allow-independent-local-review-of-completed-draft-candidate

**Accord consigné** : User explicitly approved the preceding proposal with ok.

**État consigné** : pending

**Portée approuvée** : Allow the existing independent native local review on a completed committed candidate with appropriate proofs even while its PR remains draft; do not add an obligatory early review or review ongoing partial work by default. Keep a draft ineligible for merge/auto-merge and do not treat a clean review as authorization to mark a human-held draft ready. Reuse a valid review only for its exact unchanged head/base/criteria; keep fresh checks and all existing merge guards. Coordinate with already-approved targeted development CI and full promotion CI; draft alone does not suppress GitHub Actions. No new dependencies, statuses, report layers or review rounds.

**Gains et limites consignés** : Possible earlier defect detection before ready-triggered expensive checks; no automatic CI savings from draft alone and no measured savings. Early review of changing work could add rework; only mature candidate review proposed.

### autopilot-duplicate-ticket-fetch-and-claim

**Choix** : single-coordinator-ticket-fetch-and-claim-with-complete-worker-handoff

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Under Autopilot, coordinator reads selected complete ticket and necessary linked context, verifies current blockers/status and claims once before immediate dispatch. Pass faithful complete execution contract, source identifier and observed claim to worker using existing native brief. Worker need not unconditionally fetch or claim the same ticket again when it received that current complete evidence. Refresh required missing/truncated/uncertain information and changed/possibly stale state on delayed launch, resume or materially changed scope; always preserve actual human holds and dependency checks before dependent actions. Standalone void-implement retains its own fetch/claim responsibility. No persistent cache, new schema service, subscription or duplicate tracker owner.

**Gains et limites consignés** : Potential one redundant full ticket fetch and repeated claim avoided per immediate dispatch when complete current context supplied; actual API calls unmeasured and connector-dependent. Context payload still transmitted, so no claim of removing its token cost. No CI gain.

### autopilot-semantic-conflict-human-arbitration

**Choix** : retain-human-arbitration-only-for-unresolved-incompatible-intents

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Retain human arbitration for genuinely incompatible approved intents that cannot be reconciled from existing decisions. Ordinary Git textual/mechanical conflicts remain worker-resolvable with verification and renewed applicable review. Coordinator first examines existing accepted decisions, then presents one concrete unresolved behavioral choice and its recommendation instead of raw Git details. Only affected ticket and dependent/colliding work wait. No new reviewer, approval ceremony, dependency or global stop; do not re-request an already documented decision. Preserve conflict evidence tied to actual head.

**Gains et limites consignés** : Retain existing protection; no code/CI saving claimed. Operational cost is human delay on genuinely unresolved behavioral decisions; avoid accidental interpretation of every textual Git conflict as human-only.

### mandatory-ticket-comment-at-session-pause

**Choix** : remove-routine-pause-comment-retain-material-updates-and-real-handoffs

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Remove mandatory tracker handoff comment for every unfinished session pause. Use agreed explicit local checkpoint for same-workspace session recovery; keep accurate tracker status, assignee, milestone, dependency and PR links. Post a concise tracker update only for material new blocker, decision, changed scope, useful result, explicit user request or actual handoff to someone/a machine without local checkpoint access. Never imply local checkpoint is remotely recoverable. Preserve existing shared comments/history and durable decision records; do not add sync or another journal. Coordinator owns shared updates under Autopilot.

**Gains et limites consignés** : Potential one redundant comment per unfinished ticket per paused session avoided; no measured volume/token/time or CI savings. Shared readers lose detailed local pause notes but retain material updates and explicit handoffs.

### mandatory-fowler-refactor-name

**Choix** : remove-mandatory-fowler-name-and-exclusive-lexical-hook

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Remove mandatory recognized Fowler-name wording for refactors and retire refactor-named-grep plus its exclusive allowlist/tests/wiring after checking all consumers. Keep Fowler techniques as useful references, precise commit rationale, Conventional Commits, small verifiable transformations and behavior preservation; do not alter unrelated mixed-intent commit policy in this item. No replacement lexical rule. Regenerate shipped copies and remove obsolete current documentation while preserving historical decisions.

**Gains et limites consignés** : Remove one lexical hook and exclusive allowlist/maintenance; actual consumers/tests/CI time not measured. Do not count as a proven live blocker or measured runtime saving until wiring audited. Loss of enforced terminology consistency, without loss of behavioral verification.

### refactor-commit-keyword-warning

**Choix** : remove-refactor-message-keyword-scan

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Retire tidying-commit-prefix lexical message scan and exclusive tests/wiring/documentation. Keep coherent commits and substantive review/testing of actual behavior; no replacement lexical linter or additional review stage. This item does not change the separate policy on splitting structural and behavioral changes. Preserve Conventional Commits and release-relevant type/breaking-change semantics.

**Gains et limites consignés** : Remove one lexical shell hook and exclusive maintenance; observed false positive eliminated. No measured production frequency, time or CI savings; do not double-count earlier general pre-commit retirement.

### mandatory-separate-tidying-commits

**Choix** : coherent-reviewable-commits-instead-of-universal-tidying-split

**Accord consigné** : User explicitly approved with oui and emphasized that reliability of produced code must remain the objective.

**État consigné** : pending

**Portée approuvée** : Replace universal one-tidying-one-commit and mandatory structural/behavioral commit split with one coherent reviewable revertible intent per commit. Keep separate preparatory refactor commits when independently useful or substantial enough to obscure behavior changes. Permit a small directly necessary extraction/rename together with its feature/fix and regression test under the correct feat/fix type. Keep testing before/after structural changes, applicable observed RED/GREEN, meaningful rationale, independent review and no unrelated cleanup. No numeric threshold, new exception approval, or replacement hook.

**Contrainte de fiabilité** : Commit grouping must preserve readable review, appropriate behavioral and regression evidence, applicable observed RED/GREEN, valid independent review and useful rollback boundaries. Keep substantial or independent preparatory restructuring separate when needed for these properties. Approval does not waive tests, review or existing consumer protections.

**Gains et limites consignés** : Potential fewer artificial micro-commits and associated local operations; no quantified savings or automatic CI gain since multiple commits can already be pushed together. Risk of larger less-readable commits limited by coherent intent and separating substantial/unrelated restructuring.

### universal-function-line-count-limit

**Choix** : replace-mandatory-function-line-cap-with-readability-guidance

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Replace universal mandatory function length <=70 lines with a non-blocking readability signal; keep cohesive responsibilities, explicit understandable control flow and testable boundaries. Split where responsibilities or complexity warrant, not solely to meet line count. Preserve consumer-specific justified limits unless separately authorized. No new complexity score, rule engine, review stage or exception form. This item does not change the formatter column width or previously decided skill/hook limits.

**Gains et limites consignés** : Avoid artificial function splitting and associated indirection/review effort; no measured savings or CI/runtime gate removal established. Potential decline in readability must be caught through concrete cohesion/control-flow review, not numerical compliance.

### universal-latest-stable-library-mandate

**Choix** : maintained-compatible-verified-dependencies-with-deliberate-upgrades

**Accord consigné** : User explicitly approved the preceding proposal with oui.

**État consigné** : pending

**Portée approuvée** : Replace blanket latest-stable libraries/migration-cost-accepted mandate and stale universal framework version examples with maintained, compatible and verified dependency choices. Existing project tasks use resolved supported versions and version-matched official docs; do not trigger unrelated framework migration solely for newest version. Continue deliberate routine maintenance and prioritize applicable security fixes/end-of-support migration; major upgrades require real compatibility work within authorized scope, not abandonment. New projects/dependencies prefer a current stable supported compatible version, excluding known critical regressions. Reuse existing update tooling; no new dependency, CI campaign, approval form or permanent freeze.

**Gains et limites consignés** : Avoid out-of-scope upgrade churn and associated review/test effort; no measured upgrades, time or CI savings. Tradeoff is slower access to newest features, addressed through deliberate maintained-version updates, not security neglect.

### universal-paired-validation-mandate

**Choix** : targeted-boundary-and-invariant-validation-without-global-confidence-score

**Accord consigné** : User explicitly approved targeted validation without a confidence-percentage mechanism after clarification.

**État consigné** : pending

**Portée approuvée** : Replace universal Every assertion is paired / boundary checks are doubled wording with validation of untrusted inputs at actual trust boundaries and enforcement of domain invariants where they can change. A value validated and retained unchanged within the same trusted typed flow need not be reparsed by every internal helper. Preserve server checks despite client checks, tool invocations, received API/queue data, relevant persisted/cached records, mutations and schema changes, and all distinct authorization/integrity/ownership/transactional guards. Application validation and database integrity constraints are not duplicates. No blanket validation deletion: any concrete removal needs evidence same value/invariant/trust context, otherwise retain. No new validation framework or mandatory checklist. Distinguish deterministic schema/domain checks, provenance/freshness evidence and probabilistic factual correctness. Recommend no global confidence percentage in Void Machine and no new score engine/registry. Preserve explicit unknown vs observed/verified evidence in existing briefs when relevant. A future task-specific LLM confidence score is only useful with representative labelled evaluation and calibration, never as a replacement for authorization, input checks or independent review. Valid schema does not prove truth; model self-confidence is not validation. Same unchanged value within a controlled flow may reuse validation; changed trust boundary/invariant requires the applicable checks.

**Gains et limites consignés** : Avoid future redundant internal validation and duplicated schemas; actual removals/performance savings unknown. Risk is misidentifying trust boundaries or mutable values, so retained boundary/invariant checks take precedence and each concrete removal must be justified.

## Contraintes transversales approuvées

Les textes suivants sont conservés une seule fois, tels que consignés. Ils bornent
chaque lot du plan ; ils n’ajoutent pas de contrôle automatique.

### workflow

Discuss one control at a time; preserve prepared changes until approved scope is implemented and verified

### qualityConstraint

User states the development specialty must produce coherent, simple, maintainable expert-quality code suitable for confident production delivery, avoiding spaghetti and accumulated mismatched mechanisms. Cleanup removes low-signal enforcement, not substantive standards. Preserve clear responsibilities and dependency boundaries, stable comprehensible naming, minimal abstractions/dependencies, risk-relevant behavioral/error/security tests, applicable type/lint/integration checks and independent review. Apply these proportionately during work; do not invent a new framework, approval layer, blanket checklist or final-stage bottleneck. No absolute quality guarantee: justify confidence with actual evidence and disclose untested runtime/production conditions.

### contextConstraint

Removing physical line limits must not authorize uncontrolled context growth. Keep startup instructions and discovery descriptions concise, avoid duplicated loaded doctrine and unnecessary hook-injected prose; load detailed skill references only when needed. Distinguish executed hook source code from emitted context and on-demand skill bodies. Include before/after evidence for harness-controlled startup content in the final gains report where observable, marking character counts or token estimates as such and not claiming complete runtime token measurement. No new continuous collector or CI framework.

### validationCadence

User explicitly requires that removing edit/turn hooks must not merely move a bottleneck to final validation. Run relevant existing checks after coherent changes during implementation, including earlier type checking for changed contracts or shared types. Reuse observed successful results only while their relevant inputs and scope remain unchanged. Final validation fills evidence gaps and runs required integration checks rather than blindly repeating every local check. Preserve independently required CI; add no scheduler, cache service or proof-tracking framework for this cleanup. Measure total validation work as well as interactive latency.

### simplicityConstraint

User requires reliability without sacrificing common sense and speed. Do not add exception machinery, approval layers or project complexity to implement this cleanup; simplify Void Machine sources and unnecessary controls while preserving accepted consumer protections.

### ciCostConstraint

User reports excessive CI consumption; prioritize unnecessary job/repetition removal and valid reuse. Avoid correction loops by collecting cheap independent failures together before stopping expensive dependent work. No blanket deletion of meaningful controls or new validation bottleneck.

### finalDeliverable

A table for all decisions with estimated gains, distinguishing directly countable removals, measured results and assumptions/unknowns; include implementation and operating cost plus retained protection. Do not fabricate latency, token, defect or productivity percentages.

### Précision finale sur la fiabilité

**Accord consigné** : User: surtout ne perd pas de vue l’objectif de fiabilité du code produit.

**Portée** : Simplification serves reliable, understandable and maintainable production code. Reduce ceremony and redundant machinery, not concrete behavioral protection. During implementation and independent review, identify which retained proof protects each affected risk; report gaps honestly rather than claiming equivalent reliability without evidence. Reuse existing useful tests, type checks, CI and review; do not introduce blanket new gates or a parallel scoring/checklist engine.

**État consigné** : recorded-design-constraint-not-an-installed-doctrine-change
