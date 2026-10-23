# Philosophy

## Stack assumption

The harness assumes **TypeScript + web** as its baseline. The `core/` is *not* truly stack-agnostic: it imposes TS strict, Zod at boundaries, a React/Next mental model for UI concerns, `tsc`-style type checking, and TigerStyle naming adapted for typed languages.

Pretending universal agnosticism would dilute the design. A future Rust/Go/Python flavor of the harness would live in a sibling repo (`void-machine-rust`, etc.), reusing the *mechanics* but not the TS-specific skills.

`packs/` specialize *within* the TypeScript/web universe (Next.js PWA, monorepo with Bun/Turbo, future mobile React Native, etc.).

## Three pillars

Three non-negotiables, in order. **Safety > Performance > Developer Experience.**

When two of these collide, the earlier wins. When all three agree, you have an opportunity to find the "super idea" — the simple, elegant move that advances all three simultaneously.

## 1. Safety

Code is steel: cheap to change while hot, expensive once it ships. A problem solved in design is 100× cheaper than the same problem solved in production. The harness invests in design discipline upfront so the implementation is dwarfed by the upfront thought.

**Operational rules**

- Every line of production code is requested by a failing test (Iron Law, in strict mode).
- Every assertion is paired. Validate at write, validate at read. Boundary checks are doubled.
- Every external input is schema-validated at the trust boundary (Zod).
- Functions ≤ 70 lines, lines ≤ 100 cols (TigerStyle limits, physical screen constraint).
- All loops bounded, all queues bounded, all timeouts explicit. Limit everything.
- Use explicitly-sized types. No `usize`. In TypeScript: no `any`, no unmotivated `unknown`.
- All errors handled. The majority of catastrophic production failures come from mishandled non-fatal errors.

Sources: TigerStyle (TigerBeetle), NASA Power of Ten, citypaul `tdd-strict-mode`.

## 2. Performance

Sketches before code. The best time to win 1000× is in design, when nothing exists to profile. Once code exists, you fight diminishing returns.

**Operational rules**

- Back-of-the-envelope sketches across the four resources (network, disk, memory, CPU) and the two characteristics (bandwidth, latency) before non-trivial designs.
- Optimize the slowest resource first, after compensating for frequency of use.
- Batch over react. The program runs at its own pace.
- Be predictable. CPU as a sprinter — no zig-zagging through dispatch tables and dynamic dispatch.
- Distinguish control plane from data plane. Assertions in the control plane stay free.

Sources: TigerStyle, Armin Ronacher "Agentic Coding", citypaul performance notes.

## 3. Developer Experience

Naming, file layout, and feedback loops are not cosmetics — they are how a system scales beyond its author.

**Operational rules**

- Get nouns and verbs right. Long-form, snake_case, units as suffixes (`latency_ms_max`, not `max_latency_ms`).
- Same-length related names line up in source for visual symmetry (`source` and `target`, not `src` and `dest`).
- "Always say why." Commit messages, comments, ADRs — explain the rationale, not the change.
- Comments are sentences, with punctuation. Not scribblings.
- Order matters for readability: important things at the top of a file. Main first. Fields, then types, then methods.
- No em dashes or emojis as AI-slop filler; both are allowed where they carry meaning (typographic separators in prose, glyphs in code). Not a hard CI gate.

Sources: TigerStyle naming, citypaul CLAUDE.md, Folpe quality bar.

## Wing Chun / economy of means

Maximum efficiency, minimum motion. Every dependency, every layer, every file earns its place. The harness forbids:

- Dependency injection containers (tsyringe, awilix) — earn nothing at solopreneur scale, cost hours of onboarding
- Explicit CQRS buses — same logic, smaller cost via simple service composition
- Micro-packages (`@repo/utils`, `@repo/hooks`, `@repo/types`) — kitchen-sink collections of unrelated functions
- Runtime feature flag services — env vars and build-time activation suffice
- Hand-rolled accessibility — wrap Radix, do not re-derive ARIA

A lasting structural choice with a credible alternative is logged as one immutable file under `docs/decisions/` (or the detected equivalent), per `void-decide`. Routine reversible implementation choices need no ADR.

Every change is judged against four questions, in this order:

- **Subtract before adding.** Ask what existing rule, file, layer or proof can be removed or fused instead of adding one, or why nothing can. A removal is never invented to show one. The smallest sufficient change is the deliverable.
- **Simplest design that holds (KISS).** No abstraction, option or indirection that the current requirement does not ask for.
- **One owner per rule (DRY of knowledge, not of text).** A rule, contract or invariant lives in one place and is referenced elsewhere. Two pieces of code that merely look alike are not mutualised by force: shared code is justified by a shared reason to change, never by resemblance.
- **Strong separation, minimum useful layers.** Each module owns one responsibility behind an explicit boundary. A layer with neither a responsibility nor a boundary of its own is removed; a port or facade that delegates but protects a real boundary is kept.

These are judgments, not a metric: no hook or linter decides them, and the harness does not pretend otherwise. The review applies them to the actual change. An explanation (what was removed, which owner holds a rule, which boundary was crossed) is written briefly when it helps understand or record a choice; its absence never blocks on its own. A finding blocks only when it demonstrates a concrete defect: a security flaw, broken behavior, or an architecture violation (a boundary or contract broken with a real consequence). A preference, a hypothetical risk or a possible improvement is advisory: it triggers no new review and no loop.

## Delivery economy

The purpose is time saved with reliable, maintainable code. `void-implement` owns proportional
applicability: clear authorized requests proceed, the primary domain specialist advises before
coding, and TDD, KISS/SOLID, boundary security and independent review remain the floor.
Stop once acceptance criteria, applicable proofs and independent review hold. Optional improvements
never reopen that cycle. Reuse advice and evidence whose inputs remain valid; a new defect or
changed contract warrants only the affected correction and verification. Required project CI
and genuine authorization boundaries are never weakened to save time.

## "Ultra moderne, exceptionnel" — the Folpe quality bar

- Latest stable libs. React 19, Next 16, TS 6, Tailwind 4. Migration cost accepted.
- No half-built features. Tests, types, error states, loading states, dark mode — all ship together or it does not ship.
- No "fonctionnel-but-not-exceptionnel." Visual polish, motion, copy, DX are part of the deliverable.

A change technically correct but below this bar is pushed back.

## Anti-rustine — only state of the art

Before any implementation or fix, read the official documentation of the SDK / framework / tool concerned, for the version the project actually resolves (lockfile), in its most recent revision for that version. The current docs of a newer major are not a license to write against an API the project does not have, and reading them never triggers an upgrade: an upgrade is its own decided change. For internal code, the equivalent sources are the project's own contracts, types, source and docs, read before the first edit. The reading is systematic; the citation is not. A reference is noted briefly where it helps the next reader understand or accept a choice, and a missing citation or trace never blocks on its own.

A fix addresses the root cause; a change that only makes the symptom disappear is a patch. A quick patch to make the test pass at the wrong level of abstraction is rejected. The first implementation that comes to mind is often a patch (tokenize a string where the API expects a typed schema, mock a field where the real adapter does not provide it, disable a flag instead of understanding why it blocks). That is a STOP signal: refactor the approach at the right level.

A throwaway implementation is not an acceptable initial state. It is debt that has not exploded yet. A V0 mock must mirror the signature of the real adapter cible (Graph API, Dropbox v2, etc.), not a comfort signature.

## Universal hard rules

These rules apply to ALL my projects regardless of stack. Project-specific exceptions go in `.void/PROJECT-DOCTRINE.md` with an ADR.

- **No `console.log` in committed business code.** Use the project logger (`@repo/core/logger` via `pack-monorepo`). Enforced by `no-console-log-grep` hook + `void-observability` skill.
- **No em dashes or emojis as AI-slop filler.** Both are allowed where they carry meaning (typographic separators in prose, glyphs in code such as the render layer); just do not sprinkle them decoratively. A taste rule carried by the `void-commit-discipline` skill, deliberately **not** a hard CI gate (DECISIONS.md, 2026-06-01).
- **No `process.env.*` directly in business code.** Use Zod-validated `@repo/core/env` (`void-security-guidance` skill). This governs the app's OWN secrets; a customer-provided credential (BYO key) is application data — store it encrypted at rest per tenant (master key in env), not in env itself.
- **Read the official documentation of any third-party tool BEFORE writing its config or wrapping its SDK.** Shortcuts based on assumed semantics produce subtle bugs that take hours to find. (Anti-rustine, formalized.)
- **Match file naming exactly** per the convention of the active pack (e.g. `Name.tsx`, `Name.helper.ts`, `Name.test.ts`).
- **No `any` in committed TypeScript.** `unknown` + narrowing is the escape valve. Enforced by `no-any-grep` hook + `void-typescript-strict` skill.
- **No raw SQL string concatenation.** Parameterized queries via Drizzle. (`void-security-guidance` skill.)
- **Auth via Better-Auth (or Clerk opt-in).** Never hand-rolled password hashing, session tokens, or CSRF.
- **Server Actions live in `apps/<app>/src/actions/`** (or framework equivalent). Never in shared packages.

Each rule has its enforcement mechanism listed. Rules without enforcement should NOT be added to this file — they belong in `PROJECT-DOCTRINE.md` (project taste) or in a skill (with its own hook).

## Git worktree placement and lifetime

This invariant applies to every project using Git worktree, regardless of language,
framework, editor, terminal or presentation adapter. It does not require a project
to use worktrees and is independent of the TypeScript/web stack assumption above.

- **Emplacement des worktrees** : une worktree de travail vit dans
  `${VOID_WORKTREES:-${XDG_DATA_HOME:-$HOME/.local/share}/git-worktrees}/<dépôt>/<branche>`.
  Elle n'est créée ni dans `/tmp` ni sous un chemin temporaire du système : ces
  répertoires sont purgés au redémarrage et emportent ce qui n'a pas été commité.
  Elle n'est pas créée non plus à l'intérieur du dépôt, fût-ce sous un répertoire
  ignoré : les outils qui parcourent l'arborescence (compilateur, linter, recherche,
  watchers) y voient des doublons du même fichier et rendent des résultats faux.
  - **Réutilisation** : avant de créer, vérifier `git worktree list` : si la branche
    a déjà une worktree, l'utiliser. Deux worktrees sur une même branche sont
    refusées par Git, et la deuxième tentative doit être traitée comme un état
    normal, pas comme une erreur.
  - **Cycle de vie** : la worktree appartient au ticket, pas au run. Elle est retirée
    par `git worktree remove` quand le ticket est mergé, jamais laissée à la purge
    du système. Un run interrompu laisse sa worktree en place : le travail non
    commité y est en sûreté et sera repris.
  - **Indépendance** : aucun chemin ne mentionne un multiplexeur, un éditeur ou un
    outil d'affichage. Ceux-ci découvrent les worktrees par `git worktree list` ;
    ils n'en fixent pas l'emplacement.
  - **Reprise de l'existant** : le projet déplace les worktrees situées hors de cet
    emplacement avec `git worktree move`, jamais en les recréant, ce qui perdrait
    les modifications non commitées. Les références dont le répertoire a disparu
    sont nettoyées avec `git worktree prune`.
  - **Why** : préserver le travail non commité et éviter les doublons dans les
    outils qui parcourent le dépôt.
  - **Enforced by** : planification et cycle de vie des worktrees, inventaire Git et revue ; invariant
    partagé par `void-implement` et `void-autopilot`, sans règle locale à un skill.
  - **Session et présentation** : le cycle de vie d'un agent et de son affichage
    est distinct de celui de sa worktree. Après récupération de son retour et des
    preuves utiles, une session terminée peut libérer sa présentation via
    l'adaptateur disponible. Fermer une session, un terminal, un éditeur ou un
    panneau ne déclenche ni retrait de worktree ni nettoyage global des références.
  - **Stockage** : distinguer le travail durable, les preuves utiles à conserver
    et les fichiers temporaires ou régénérables possédés par la tâche. Libérer de
    l'espace ne justifie jamais la suppression de travail non commité ou d'une
    worktree non mergée. Le nettoyage des fixtures temporaires reste borné à celles
    créées par la tâche, après conservation des preuves nécessaires.

## Mobile-first, dual-quality target

Every UI — including web apps that are not primarily mobile — is designed **mobile-first** AND must reach **first-class quality on both mobile and desktop simultaneously**. Not "mobile-first then responsive afterthought." Not "desktop-first then squeeze for mobile." Both experiences are deliverables.

Concrete invariants enforced by `void-frontend-design` + `void-accessibility` skills:

- Layout designed at 360–390px first, then progressively enhanced to wider viewports — never the reverse
- Touch targets ≥ 44×44px (Apple HIG) on every interactive element, regardless of viewport
- Keyboard navigation works on desktop with the same completeness as touch on mobile (focus rings, skip links, escape closes modals)
- Performance budget enforced for both : LCP < 2.5s on slow 4G mobile + on desktop fiber
- No mobile-only nor desktop-only feature without an equivalent on the other surface (or an explicit, documented decision)
- Both viewports are screenshotted in design review (mobile portrait + desktop) before any UI ships

Source: Folpe operating principle. Translated into mechanical checks via `void-accessibility`, `void-frontend-design`, and the `pack-react` / `pack-pwa` design-review hooks.

## Harness self-evolution — feedback loop and obsolescence audit (HITL strict)

The harness must evolve from real usage in real projects, like citypaul's dotfiles evolves from his daily work. Two complementary mechanisms, both **strict Human-In-The-Loop** (no automatic write into doctrine, ever):

### Inbound — `void-learn` skill, harness-gap branch

While coding in any project consuming the harness, when the model (or the user) perceives that something is missing, wrong, or worth a rule:

1. The perception is filed **directly as a GitHub issue** on `voidcorp-core/void-machine` (not captured to a per-project queue). The body carries source-project context: repo, commit SHA, file path, and the motivation. The agent drafts it and confirms with the user before opening it.
2. The filing bar is load-bearing: open an issue only when the gap is both *agnostic* (helps any consumer, not just this project) and *harness-worthy* (changes a skill, hook, pack, CLI, or doctrine line). A project-specific rule goes to `.void/PROJECT-DOCTRINE.md` via `void-learn`'s project-rule branch instead. When in doubt, do not file.
3. The issue tracker is the triage zone: taking the issue promotes it, closing it declines it — no `proposed/` queue, no `feedback push` step. A promoted issue becomes a void-machine PR carrying the source-project context as motivation. Nothing is merged without human review.

### Outbound — `void-learn` skill, audit branch

A recurring auto-evaluation that questions the harness's current surface:

1. Each invocation and outcome writes a redacted canonical event to `.void/machine/runs/<mission-id>/events.jsonl` (local, never shipped); legacy usage logs remain read-only history.
2. `void-machine audit` joins declared relations, human activations, outcomes, and cost across hooks, skills, and agents. It repairs telemetry before judging behavior, excludes self-host/smoke missions, and requires twenty human sessions before a retirement review. Upstream-source deprecation and decision-matrix-conflict detection are planned extensions.
3. The report **proposes** telemetry repair, failure repair, wiring, tuning/fusion, or retirement review. Nothing is auto-applied. `void-learn` owns the human decision and any resulting PR.

### Why HITL is absolute here

Auto-write into the harness's doctrine — even with good signals — would create silent drift, contradictions, and prompt bloat over time. The harness is the foundation; foundations don't shift without deliberate decision. The cost of a human review per change is the price of keeping the doctrine coherent.

Source: citypaul's manual curation discipline; Boris Cherny's "compounding engineering" (adapted with the review gate); user's explicit project lead direction (2026-05-29).

## Compound engineering — deliberate capture, NOT auto-write

Each session can produce 0–N learnings, **never written automatically to CLAUDE.md or any load-bearing doctrine file**. The per-repo `learnings/proposed/` queue and a `learnings-promote` skill were designed but never built: a markdown queue is a strictly worse reimplementation of the tools that already exist. What actually routes a learning:

- **`void-learn`** — the single skill that names the reusable pattern, decides its scope, and runs the matching HITL capture: an end-of-cycle pattern or a stated project rule into `.void/PROJECT-DOCTRINE.md`, or a universal gap **directly as a GitHub issue** on `voidcorp-core/void-machine`.

Auto-append into CLAUDE.md was rejected: it creates drift, contradictions, prompt bloat. Doctrine evolves deliberately, not by accretion.

Source: Kieran Klaassen (EveryInc/compound-engineering-plugin), Boris Cherny ("how Boris uses Claude Code"). Adapted — not vendored — to add the review gate.

## What this philosophy excludes

The harness does **not** govern:

- Product strategy or roadmap decisions (a written plan's premise/ambition is reviewed by `void-plan-review`'s CEO lens; a raw idea's demand pressure-test lives in `void-brainstorm`)
- Visual design system choices (the `DESIGN.md` contract; build via `void-frontend-design`, audit via `void-ui-review`)
- Live QA of running apps (use `void-qa` through claude-in-chrome)
- Ship/deploy mechanics (use `void-implement` and `gh`; release-please owns versions)

These live elsewhere on purpose. The harness focuses on **how code is conceived, written, tested, and reviewed**.
