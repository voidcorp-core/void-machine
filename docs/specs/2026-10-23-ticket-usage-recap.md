# Ticket usage recap

Approved through the user's request after the proportional delivery correction: provide a simple
complete cheatsheet and ticket-end counts for skills, hooks and specialists. No external telemetry.

Acceptance: reuse the existing catalogue/formats; count actual invocation starts (skills and
specialists) and hook completions once per event ID; show outcomes separately; explicitly identify
unknown linkage and Codex activation limits; compact text, full JSON; preserve normal inspect and
verdict semantics; usage inspection never writes; wire one informational end recap, never a gate.

Scope: CLI projection, regression tests and documentation only. Existing event producers,
controller routing, security hooks, TDD and delivery rules stay authoritative. Contract and limits:
[Ticket usage](../TICKET-USAGE.md).
