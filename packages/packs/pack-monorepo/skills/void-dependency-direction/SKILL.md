---
name: void-dependency-direction
description: Declare cross-package dependencies explicitly and preserve domain-owned ports. Use when crossing a workspace package boundary or fixing boundary-direction-check.
---

# dependency-direction

The package's `package.json` owns its permitted package dependencies. The project's
architecture owns which dependencies make sense. A universal star topology through
`@repo/core` is not imposed by the harness.

## Before adding an import

1. Read the consuming package's manifest and project architecture.
2. Keep domain code independent of concrete infrastructure; compose adapters through
   domain-owned ports, per `void-hexagonal-architecture`.
3. Declare an accepted dependency in the appropriate manifest section. Types create
   dependencies too. Import the package's public API, not a sibling's private files.
4. If the dependency would violate an accepted project boundary, reshape the port
   and compose at the application edge. A structural exception follows `void-decide`.
5. Run the affected package's typecheck and behavior tests.

## Mechanical scope

The shared Node `boundary-direction-check` rule rejects detected scoped imports
that the nearest readable package manifest does not declare. It accepts self-imports
and dependencies, devDependencies, peerDependencies and optionalDependencies.
It skips tests/generated files and allows when no manifest can be read. Its lexical
matcher is a guardrail, not a complete import graph or internal-layer validator.
An `allow-boundary:` comment is a narrow escape recognized by the existing rule;
it does not approve an architectural exception or make a missing dependency buildable.

A `tsconfig` path alias changes resolution, not permission. It cannot prove a
package boundary. Project-specific cycle or layer checks must be explicitly wired
and verified before claiming deterministic enforcement.

## Composition

- `void-hexagonal-architecture` owns ports and dependency direction inside a domain.
- `void-service-package` applies the project package layout.
- `void-package-extraction` decides whether a shared package is warranted.
