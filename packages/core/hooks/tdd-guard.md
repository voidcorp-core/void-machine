# `tdd-guard` hook

The native PreToolUse manifests invoke the shared Node `tdd-order` rule for
supported structured writes. `tdd-guard.sh` is its compatibility adapter.
`packages/hook-runner/src/rules/tdd-order.ts` owns the structural rule and
`enforcement/runner.ts` resolves the proposed file and evidence.

This floor checks that a governed production file has an existing sibling test,
or a valid first-line `// tdd-cover: e2e <project-relative spec>` declaration pointing
to an existing test inside the project. It does **not** run that test, require a
staged test modification, assess behavior coverage, or prove an observed RED.
`void-tdd` and `void-debug` own the observed RED-before-fix/GREEN evidence.

## Configuration and scope

The rule reads `.void/config.json`: `modes.tdd`, `paths.business` and `paths.spikes`.
The default business glob is `apps/*/src/**`; the default spike glob is
`apps/*/scripts/spike-*`. The first five existing lines may declare
`// tdd-mode: strict`, `souple` or `exploratory`.

- `auto` and `strict` refuse a governed write with no test evidence.
- `souple` allows it with a warning.
- `exploratory` allows it.

Only the supported JS/TS production paths inside business globs are governed.
The owning rule excludes test/declaration files, docs, fixtures, seeds, migrations,
codemods, generated paths and configured spikes. This is a path floor, not a
semantic classifier of all configuration or generated code.

A complete file deletion is exempt. A deletion-only edit to a surviving file is
still checked. A module containing only re-exports is exempt only when both the
original and complete proposed source meet that condition. Adding behavior removes
the exemption. Unresolvable evidence on a governed file is refused, not guessed.

## Runtime results

The rule returns a verdict. Runtime adapters translate a refusal into Claude's
blocking exit 2 or Codex's native deny response; warning and allow are successful
responses. There are no `VOIDCORP_HOOK_FILE`, staged-diff or per-session TDD env
inputs to this native contract. Configured does not mean invoked: the runtime must
load and trust its hooks. Shell writes do not provide this test-content guarantee.

## Proof

The rule and enforcement tests cover sibling/declaration existence, modes,
re-export detection, path escapes, deletion-only edits and unsupported evidence.
Behavioral RED/GREEN for the changed application remains a separate required proof.
