---
date: 2026-06-26
title: "graph-studio consumes the kernel via a static prebuild, not a runtime import"
---

## 2026-06-26: graph-studio consumes the kernel via a static prebuild, not a runtime import

**Decision:** `apps/graph-studio` does not import `@voidcorp/harness-graph` into
the browser bundle. A Node prebuild (`apps/graph-studio/scripts/prepare-data.ts`, run by tsx) reads
`model.json` + `.void/usage.log`, runs the kernel's `analyze()`, and writes four
static JSON blobs the browser renders.

**Why:** keeps `node:fs` (the kernel's `derive/` adapter) out of the bundle, keeps
analysis single-sourced in the kernel (no duplicated detector logic), and requires
zero edits to the already-merged kernel package (no browser-safe subpath export).
The cost -- findings are computed at build time, not live -- is acceptable for the
P1 static maintainer view; the live consumer surface is P2.

**Alternative rejected:** a browser-safe `@voidcorp/harness-graph/analyze` subpath
export imported at runtime. Cleaner data freshness, but edits a merged package and
risks bundling the fs adapter.
