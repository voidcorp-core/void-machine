---
schemaVersion: 1
id: "adr:5ea1f2f7-1798-4de5-9e72-9d2e4fab8521"
createdAt: "2026-10-13T10:00:16.147Z"
title: "Use the validated session host for supported orchestration"
status: accepted
deciders: ["Folpe"]
supersedes: ["adr:0d9fd85a-f158-42c5-89a2-c70b6e452c07"]
---

# Use the validated session host for supported orchestration

## Context

Folpe clarified the approved DEV-1019 portability requirement: consumers need not
install Herdr, but a coordinator hosted there must use its supported capabilities.
The earlier wording "available and useful" allowed ignoring that host. An inherited
pane hint can point at another project, so availability alone is insufficient.

## Decision

Use the best supported current-session capabilities, requiring the Herdr adapter
for durable workers and mission visibility after fresh coordinator identity
validation. Native short agents remain native; never duplicate one for a pane.

This narrows only host selection in the superseded decision. Its portable native
execution, ownership, bounded concurrency, permissions, isolation, independent
review, continuity and legacy-collection boundaries remain unchanged. Outside
Herdr, use a supported host such as tmux only after verifying the needed capabilities
and ownership; this slice adds no transport or legacy-kernel launcher. Missing
presentation permits native work with a stated limitation. Failed or ambiguous
host discovery blocks the affected action, never silently redirects it elsewhere.

## Consequences

Positive:

- Consumers keep portability while existing Herdr sessions retain useful visibility.
- A host is selected from validated identity and capabilities, not executable presence.

Negative:

- Other terminal hosts need a supported path before durable-worker use is claimed.
- A stale session hint may require explicit identity reconciliation before host actions.

## Alternatives considered

- **Leave host use discretionary:** rejected because it can ignore the user's active
  Herdr interface despite available supported capabilities.
- **Require Herdr everywhere:** rejected because consumers may use other hosts or
  native agents without a multiplexer.
- **Route tmux through the old kernel:** rejected because it restores a retired
  launcher instead of proving support in the current native workflow.

## Reversal cost

Low: change the central instruction policy, managed mirrors and contract tests.
No runtime schema, stored session, server or permission migration is introduced.
