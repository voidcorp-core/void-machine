# Guarded autopilot publication

The coordinator publishes through `autopilot publish`, which checks the shared Git
guard before invoking Git with the explicit candidate SHA and destination. Human
renewal preserves the original fingerprint and complete prior evidence.

The shipped [operator commands and recovery contract](../packages/core/skills/void-autopilot/references/publication.md)
are the single procedure for policy coverage, retained v3 comparison, explicit policy renewal, replay, partial failure,
concurrency and the limits of direct Git. DEV-1204's
[proposed boundary decision](decisions-log/2026-11-08-guarded-publication--8f812459-82f5-445b-8a1a-75b8a641eaec.md)
records the alternatives.
