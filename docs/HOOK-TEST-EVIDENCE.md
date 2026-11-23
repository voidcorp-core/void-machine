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

### Destructive shell operations

`dangerous-command` checks targeted operations in command position, including
executable basenames, ordinary `sudo`/`env`/`command`/`exec` wrappers and literal
assignments. Quotes and escapes preserve argument boundaries: searching for or
printing destructive shell or SQL text does not itself execute that text.
Tool payloads supplied as argv retain each literal argument, including empty
arguments, apostrophes and dollar signs, before lexical inspection.
Unquoted operators and pipelines start commands; redirections to raw devices
are checked independently of the executable. Shell `-c`, `eval`, visible shell
stdin, command/process substitutions and backticks are inspected recursively.
Single quotes suppress shell substitutions; double quotes do not.

Destructive SQL is checked in command arguments to `psql`, `mysql`/`mariadb`,
`sqlite3` and `sqlcmd`, or visible pipeline/here-string input to those clients.
One here-document at the end of a command line is supported, with quoted
delimiter suppression of substitutions. Its body is inspected as code only
when the receiving command executes it. Git rebase `--rebase-merges` and
`--strategy-option` are ordinary options; `--exec`/`-x` remain execution flags.
Git apply/am `--unsafe-paths` and forced pushes without a lease remain refused.

This is a bounded lexical guard, not a shell or SQL interpreter and not a
security boundary. It does not resolve aliases, variables, external scripts,
SQL files or generated output. SQL matching does not parse SQL string literals
or comments. Pipeline text is conservative evidence, not evaluated output.
Unclosed syntax, unsupported here-document layouts, ANSI-C quoting and dynamic
command names refuse explicitly instead of being treated as safe quoted data;
recursive inspection is limited to eight levels. Other shell dialects, arbitrary
wrapper options and indirect execution remain outside its proven coverage.
No command fixture is executed: source tests pass strings to the rule, and
delivered tests pass JSON to both hook bundles in `packages/core` and
`packages/cli/core-assets`.

Semantics checked against [Git 2.54 rebase](https://git-scm.com/docs/git-rebase/2.54.0),
[Git apply](https://git-scm.com/docs/git-apply/2.51.0),
[Bash quoting and substitutions](https://www.gnu.org/software/bash/manual/bash.html#Quoting)
and [psql command/stdin input](https://www.postgresql.org/docs/current/app-psql.html).

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
