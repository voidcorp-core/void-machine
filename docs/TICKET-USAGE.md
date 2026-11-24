# Mission usage retirement

DEV-1400 removes `mission inspect --usage`, `mission usage-bind`,
`mission usage-unbind` and `mission advisory-start`, plus their reporting projections.
Ordinary `mission inspect --id <id> [--json]` still reports the canonical mission
verdict. Use `agents status` for observed worker activity; canonical specialist
receipts, review/admission evidence and worker lifecycle records remain available.
No usage count certifies quality, and missing telemetry proves neither success
nor non-use. Historical journals and usage records remain untouched.

Doctor no longer judges health from usage or missing invocations. SessionStart
ignores the historical `.void/machine/invocation.json` cache and never refreshes it.
Installed-file integrity, runtime wiring, reference validation and actionable
refusal/error diagnostics remain. No replacement usage collector or exporter is added.

Routine successful and skipped hook records are no longer emitted. Refusal/degraded
hook records and canonical runtime tool/session events remain. Audit, graph and status
still consume runtime tool/session telemetry; their coherent retirement belongs to
DEV-1402. Herdr's real context measurements and real spend controls remain.
