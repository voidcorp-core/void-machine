---
name: void-make-pdf
description: Turn a markdown file into a publication-quality PDF — marked + puppeteer-core on the system Chrome, with page-number footers. No gstack daemon. For signed deliverables (DECLIK audits).
---

# make-pdf — voidcorp craftsman edition

Render a markdown file to a clean, paginated PDF with page-number footers. State-of-the-art pipeline: **`marked`** parses the markdown, **`puppeteer-core`** drives the **system** Chrome/Chromium and prints via `page.pdf()`. No gstack browse daemon; no bundled Chromium download (`puppeteer-core` uses the browser already on the machine).

For French-language signed deliverables (DECLIK Audit Pulse), it keeps diacritics, tables, and code intact, never splits a table or heading across a page, and numbers the pages.

The engine lives in `apps/make-pdf/` (`@voidcorp/make-pdf`). This skill tells the agent how to drive it.

**Attribution**: see `.source`. Distilled from gstack `/void-make-pdf` (its `marked` pipeline + print-CSS intent + HTML sanitizer), rebuilt on `puppeteer-core` + the system Chrome instead of the browse daemon — the standard `marked` + Puppeteer approach.

---

## Run it

```bash
pnpm --filter @voidcorp/make-pdf make-pdf <input.md> [output.pdf] [--a4|--legal] [--margins=1in] [--title="..."]
```

- `output.pdf` defaults to the input's basename with a `.pdf` extension.
- Default page format is US Letter; `--a4` / `--legal` switch it. `--margins` overrides the 1in default.
- The title defaults to the first `# H1`, else "Document"; `--title` overrides.

## What it does

1. `marked` parses the markdown to HTML.
2. A conservative sanitizer strips dangerous embedded HTML (`<script>`/`<iframe>`/`on*`/`javascript:` — untrusted markdown can carry raw HTML, a real trust boundary).
3. The body is wrapped with an inlined content stylesheet: a metric-compatible sans stack (Helvetica / Liberation Sans / Arial — renders French accents on every OS) and `break-inside: avoid` on tables / figures / code.
4. `puppeteer-core` launches the system Chrome, `page.setContent` loads the HTML, and `page.pdf()` prints it with `printBackground`, precise margins, and a **page-number footer** (`<span class="pageNumber"></span> / <span class="totalPages"></span>`).

## Requirements & failure modes

- **System Chrome or Chromium** must be installed (macOS: Google Chrome / Chromium / Edge; Linux: `google-chrome` / `chromium`). Set `CHROME_PATH` to override. If none is found, the CLI exits non-zero with an explicit message — never a silent failure.
- **Relative images** in the markdown resolve against the CWD at print time; use absolute paths or run from the markdown's directory.

## Anti-rules

- MUST NOT depend on the gstack browse daemon or any gstack runtime.
- MUST NOT bundle/download a Chromium (use `puppeteer-core` + the system browser).
- MUST NOT fail silently when Chrome is absent — the error is explicit.
- MUST NOT trust raw HTML embedded in markdown — the sanitizer runs unconditionally. (It matches `javascript:` literally; the output is printed, never live-rendered, so a surviving entity-encoded scheme is inert — harden before any live-render reuse.)

## Composition

Downstream: a generated deliverable is reviewed by the read-only `pdf-specialist` agent for faithful
rendering, pagination, accessibility, and artifact evidence. The renderer owns production; the
specialist judges the output and never edits it. `void-verify` carries that observed proof into the
final gate.
