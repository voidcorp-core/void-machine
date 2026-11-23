---
name: void-dependency-direction
description: Declare cross-package dependencies explicitly and preserve domain-owned ports. Use when crossing a workspace package boundary or investigating undeclared dependencies.
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

## Validation scope

Use the project's existing linter to reject undeclared package dependencies,
with focused checks that legitimate package imports and aliases still pass.
In void-machine, Biome `noUndeclaredDependencies` is an error. It uses the nearest
package manifest, allows declared dev/peer/optional dependencies by default and
ignores relative imports, `#`/`@/` aliases and protocol imports. It is not a proof
of every alias resolution, internal layer, cycle or package boundary.

A `tsconfig` alias changes resolution, not architectural permission. Review the
actual boundary and run the affected package's typecheck and behavior tests.
This pack does not install a Biome configuration: verify equivalent checks in the
consumer's existing tooling before claiming deterministic enforcement. Missing
coverage is reported at validation, not converted into a general host veto.

## Sources

- [Biome dependency rule](https://biomejs.dev/linter/rules/no-undeclared-dependencies/),
  checked against the documentation bundled with repository version 2.4.16.

## Composition

- `void-hexagonal-architecture` owns ports and dependency direction inside a domain.
- `void-service-package` applies the project package layout.
- `void-package-extraction` decides whether a shared package is warranted.
