---
date: 2026-06-01
title: "one `doctrine-critic` agent, not the three originally planned"
---

## 2026-06-01: one `doctrine-critic` agent, not the three originally planned

Context: the design doc Section 8 and DEV-363 planned three review agents
(`senior-reviewer`, `security-reviewer`, `architect-critic`). An agent-layer
audit (DEV-363, pre-implementation) measured each against what the harness and
the global layer already ship and found heavy responsibility overlap, in tension
with anti-bloat rules 3 (overlap > 30 %) and 6 (no spillover into gstack):

- `senior-reviewer` ≈ global `pr-reviewer` agent + `tdd-guardian` + `ts-enforcer`,
  gstack `/review`, built-in `/code-review` (incl. `ultra`), harness `code-review`
  skill. ~75 % overlap.
- `security-reviewer` ≈ gstack `/cso` (OWASP/STRIDE/secrets/supply-chain, the exact
  scope), built-in `/security-review`, harness `security-guidance` skill (which
  already delegates to `/cso`). ~85 % overlap.
- `architect-critic` ≈ gstack `/plan-eng-review`, harness `hexagonal-architecture` +
  `domain-driven-design` skills + pack `dependency-direction`, and the deterministic
  `boundary-direction-check.sh` hook. ~70 % overlap.

The principle: an agent only earns its place when it adds something a skill or a
hook cannot. The one gap nothing else fills is a **context-isolated, read-only
judgment of conformance to VoidCorp doctrine**. The 8 PreToolUse hooks enforce the
*mechanical* floor (no-any, boundary direction, …) at Edit/Write time; generic
reviewers (`pr-reviewer`, `/review`) check generic quality. Neither judges the
*non-mechanical* doctrine calls — over-abstraction, tests that assert nothing, the
strict-TDD Iron Law and its `.void/config` modes, a boundary respected by the
letter but not the spirit, the seven anti-bloat rules on skills/hooks themselves.

Decision: ship a single `doctrine-critic` agent (read-only, isolated context). It
judges doctrine conformance and **routes** rather than re-implements: it flags
trust-boundary code and hands off to `/cso`, and hands line-level bug hunting to
`/code-review`. Spec: `docs/plans/2026-06-01-doctrine-critic-agent.md`. DEV-363 is
rescoped 3 → 1; the `security-reviewer` and `architect-critic` slots are dropped
(their value already lives in `/cso`, the boundary hook, and the hexagonal/DDD
skills). Manifests move from "3 agents on the roadmap" to "1 shipped".

Naming: "critic", not "reviewer", to avoid routing ambiguity with `pr-reviewer`,
gstack `/review`, and built-in `/code-review` — three review tools already in a
consumer session. "doctrine", not "harness" (which reads as the install itself,
colliding with `doctor`/`audit`) and not "craftsman"/"conformance" (vaguer / more
process-flavoured). It inherits the "critic" of the dropped `architect-critic`.

Alternatives rejected:
- Build all three as planned: triples the maintenance surface and injects
  routing non-determinism (three thin wrappers competing with the global agents
  already present) for near-zero marginal value. Disqualifying for a harness whose
  edge is determinism.
- Ship zero agents (purist anti-bloat): defensible, but leaves the doctrine
  judgment layer uncovered — the hooks catch only the mechanical violations.
