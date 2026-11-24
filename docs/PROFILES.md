# Stack profiles

`void-machine mission plan` compiles only the stack knowledge that applies to the current changed
files. The operation is deterministic, offline, and LLM-free. Profiles influence mission context;
they do not install dependencies or mutate consumer code.

## Catalog and extensions

The certified catalog is bundled from `packages/core/src/profiles/*.yaml` and currently covers base,
TypeScript, React, Next.js, Node server, monorepo, PWA, Expo, and SQL work.
Next.js and Expo configuration advice lives in separate profiles with exact filename selectors. A consumer can add a
strict project profile under:

```text
.void/profiles/<name>.profile.yaml
```

Only that explicit suffix is loaded as a profile. `*.policy.yaml` in the same directory remains a
profile-layer policy overlay. Profile IDs must be unique across the bundled and project catalogs.

## Contract

Each profile declares a bounded set of technologies with either reviewed version ranges or
explicitly version-independent guidance, deterministic file selectors, official HTTPS sources, a review date, an expiry period, invariants, and conditional
patterns. Detectors are declarative; commands and executable predicates are rejected.

```yaml
schemaVersion: 1
id: project:rust
version: 1
name: rust
technologies:
  - id: rust
    minimumVersion: 1.80.0
    maximumVersionExclusive: 2.0.0
detectors:
  always: false
  technologies: [rust]
  files:
    extensions: [.rs]
    names: [Cargo.toml]
    pathSegments: []
sources:
  - title: Rust documentation
    url: https://doc.rust-lang.org/
reviewedAt: 2026-07-27
expiresAfterDays: 180
invariants:
  - Keep unsafe code isolated and justified.
patterns:
  - id: rust-source
    appliesWhen:
      technologies: [rust]
      files:
        extensions: [.rs]
        names: []
        pathSegments: []
    guidance: Apply Rust guidance only to changed Rust source.
```

For general guidance, a technology may declare `versionIndependent: true` instead of both
version bounds. Combining independence with bounds is rejected. This says nothing about
compiler/API compatibility and does not disable expiry or required verification. See
[consumer compatibility](CONSUMER-COMPATIBILITY.md) for the shipped-profile audit.

Version bounds are minimum-inclusive and maximum-exclusive exact `x.y.z` values. Installed
dependency ranges are normalized only when an exact semantic version can be observed. Values such
as `workspace:*` remain unknown rather than being guessed.

## Project-scoped routing

For every changed path, the router selects the longest matching workspace package. Root
technologies such as the TypeScript toolchain are inherited into that package. Dependencies from a
sibling package are never inherited. Technology and file selectors must match in that file owner's
context before a profile or pattern becomes applicable.

Each result includes:

- `applicable`, `not-applicable`, or `degraded` state;
- active conditional pattern IDs;
- stable predicate inputs and a SHA-256 input hash;
- reasons and whether official-source review is required.

An applicable expired profile, incomplete detection, or an unknown or uncovered version of
version-dependent advice produces `degraded`. The mission context stays degraded until the
source-driven review updates or replaces the profile; stale recommendations are never labeled
current. Version-independent advice bypasses only the version comparison. Unavailable advice
whose selectors do not match remains `not-applicable`, with reasons and `sourceReviewRequired`
visible in the plan and specialist context; it is not activated or used as proof.

## Input safety

Profile YAML is limited to 64 KiB per file and 64 files per catalog location. Unknown keys,
duplicate keys and IDs, aliases, unsafe path selectors, non-HTTPS sources, symlink escapes, and
unsupported workspace traversal fail planning closed. Workspace discovery accepts explicit paths
and the common bounded `<directory>/*` form; deeper recursive globs are ignored.
