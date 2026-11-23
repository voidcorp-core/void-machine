# Test evidence and validation

## Editing and accepting evidence

Writing a test temporarily focused or skipped is allowed. Before accepting test
results as delivery evidence, run the project's configured validation that detects
those forms. A green partial run is not proof that the complete applicable suite
passed. Keep platform exclusions, conditional skips and todos visible in the
result; do not count them as passed coverage.

TDD relies on relevant observed RED/GREEN behavior where strict mode applies.
Neither a sibling test file nor a `tdd-cover` comment proves coverage. The retired
structural write gate and TypeScript syntax worker are not required to edit code.

## Existing linter, explicit scope

This repository configures Biome 2.4.16 with these rules at error severity:

- `suspicious/noExplicitAny`: explicit type escapes; strict TypeScript checks
  separately cover implicit `any`.
- `suspicious/noConsole`: application code uses the project logger. Legitimate
  CLI/script output and a logger's explicit transport are narrow exceptions.
- `correctness/noUndeclaredDependencies`: supported package imports are checked
  against the nearest manifest. Relative paths, `#`/`@/` aliases and protocol
  imports are outside this rule; it does not validate all architectural boundaries.
- `suspicious/noFocusedTests` and `suspicious/noSkippedTests`: supported test forms
  are checked before accepting evidence. Confirm the files and forms actually
  covered, including test files outside conventional source directories.

A comment or string holding invalid source for a negative test is test data.
Prefer that representation or a tightly scoped fixture exception; do not exempt
all tests or an application directory. Assertions are reviewed against a local,
identifiable guarantee, not rejected lexically. Unvalidated external data and
unexplained double assertions do not establish that guarantee.

The configuration is local to void-machine, not copied into consumers by `init`.
Consumers use and verify equivalent checks in their existing tooling. When a
check is absent or cannot cover a form, report the limitation; do not invent an
activation proof, install another checker automatically or forbid unrelated work.
Run checks after coherent changes as well as at the acceptance boundary.

## Runtime and installation protections

Claude and Codex retain targeted secret, protected-file, dangerous-command and
control-character guards. Unknown enforcement rule names still refuse. Removing
a rule therefore requires updating its manifest with the runner that removes it.

The installer no longer requires the syntax worker. Normal update removes an
unchanged receipt-owned obsolete file through the existing transaction; modified
or unowned files are preserved. Adding a runtime may retain an older inert asset.
Preserve the installation, rollback and user-file ownership proofs.

## CI content boundary

`enforce-ci` receives added artifact content, not a runtime tool payload. Its
input remains capped at 8 MiB; runtime payloads retain their 1 MiB cap. Both
readers reject invalid UTF-8 and NUL bytes. CI refuses oversized input without
truncation, and enforcement input failures return a nonzero exit code. These
content protections are separate from the retired test-syntax worker.

## References

Rule capabilities and defaults were checked against `biome explain` in the
installed 2.4.16 release and the official documentation:

- [Explicit any](https://biomejs.dev/linter/rules/no-explicit-any/)
- [Console output](https://biomejs.dev/linter/rules/no-console/)
- [Undeclared dependencies](https://biomejs.dev/linter/rules/no-undeclared-dependencies/)
- [Focused tests](https://biomejs.dev/linter/rules/no-focused-tests/)
- [Skipped tests](https://biomejs.dev/linter/rules/no-skipped-tests/)
