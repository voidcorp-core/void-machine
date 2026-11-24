---
name: void-devex-audit
description: "Audit an EXISTING dev-facing surface (API/CLI/SDK/docs): measured TTHW, real error-path tracing, concrete DX findings, scoped refine. The audit ceiling to plan-review's DevEx-lens."
---

# Developer experience audit

Audit an existing API, CLI, SDK or documentation journey against its intended users and agreed
objectives. `void-plan-review` critiques promises before implementation;
`void-api-and-interface-design` owns contract design. **Attribution**: see `.source`.

## Observe the journey

Walk from setup to a working useful example. Record actual steps, elapsed time, environment and
friction. Distinguish observed, partially exercised and inferred conclusions. A missing runtime or
browser limits that part of the audit; never invent measurements or universal adoption percentages.
Compare with the agreed objective and previous measured evidence where available. Ten minutes or
any other universal time threshold is not automatically a blocker.

Inspect the affected dimensions:

- Getting started: install, authentication, realistic working example and recovery from mistakes.
- API/CLI/SDK: understandable names, defaults, useful overrides and progressive disclosure.
- Errors: trigger relevant bad-input, missing-argument and unauthorized paths on a local or disposable
  surface. Messages should explain the problem and useful recovery without leaking sensitive data.
- Documentation: findability, runnable examples and compatibility with the installed version.
- Upgrades: compatibility, release notes, migration guidance and deprecation behavior.
- Development environment: types, editor support, noninteractive CI and supported platforms.

Do not trigger errors against production tenants or shared data. Browser-based evidence uses the
available authorized browser path; state exactly what could not be exercised.

## Findings and refinement

Report concrete defects, journey consequences, commands or evidence and limitations. Distinguish
blocking violations of accepted requirements from optional improvements. No mandatory rating,
scorecard, competitive rank or gap-to-ten loop applies. Compare planned outcomes with observed
behavior, not subjective plan-versus-live ratings.

Make scoped fixes in the agreed area: quickstart, errors, docs, upgrade or types. Retain meaningful
behavioral and integration proofs and independent review where applicable. Do not redesign the
contract or expand scope merely to improve an audit score. `void-ui-review` owns visual craft;
`void-qa` supplies live interaction evidence when needed.
