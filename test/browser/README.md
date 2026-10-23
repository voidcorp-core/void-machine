# Isolated consumer browser QA

The `browser conformance` CI job consumes the existing archive from
`consumer-artifact`. The shared verifier checks its SHA and digest before an
offline npm installation. The installed CLI generates absent/installed synthetic
documents on the runner. No exported developer document, personal browser
profile, home directory or connected-browser permission is used.

Playwright runs in its official noble image on GitHub-hosted Ubuntu 24.04.
The existing artifact producer derives the image version from `package.json`
and refuses an unpinned version or mismatched core override. The image supplies
Chromium and OS dependencies; setup-node selects the primary `.node-version`. Contexts are offline, service workers are blocked, and
unexpected requests or uncaught page errors fail the suite. One worker, zero
retries, a five-minute suite limit and a fifteen-minute job limit bound execution.
This suite intentionally refuses local execution; do not set CI markers on a
developer machine to evade that boundary. Run it through the PR's normal CI.

Container paths come from the step's `RUNNER_TEMP`, published through
`GITHUB_OUTPUT` for artifact inputs, the tarball environment, the test working
directory and every evidence upload path. The host's `runner.temp` context is
not a container path; a multiline action input must not depend on prefix
translation of its first line. The conformance Git command retains its isolated
environment: checkout's temporary `HOME` and Git configuration are not inherited.
It passes `-c safe.directory=<exact source checkout>` for that command only,
without wildcard trust or changes to local, global or system Git configuration.

The private tooling manifest stays outside the pnpm workspace and shipped CLI.
It pins Playwright and its exact playwright/playwright-core dependency chain,
and pins both axe packages (including the transitive axe-core override). The
playwright-core peer is also explicitly pinned. The
runner installs the committed npm lockfile with `npm ci --ignore-scripts`, using
setup-node's npm cache keyed by that lockfile. Cache misses work normally.
Dependabot proposes weekly updates for `/test/browser` against develop; package,
overrides and generated lockfile must agree before human review of the browser
evidence. There is no automatic dependency merge or separate image-version pin.
Generate the lockfile with npm, never by hand. Measure cold and warm preparation
and test durations in real CI before claiming a performance improvement.

## Evidence and review

The artifact `browser-evidence-<SHA>` holds the HTML report, attached screenshots,
print PDFs, failure traces, the resolved `tooling-tree.json` and `evidence.json`. The manifest binds the source SHA,
archive digest, generated document hashes and tooling versions. Uploads run on
success or failure and expire after fourteen days. The test step's failure is
never replaced by the upload outcome. Missing fixtures or zero selected tests
fail instead of certifying an empty run.

Review the mobile and desktop catalogue, empty state, installed/absent availability, disabled
skill versus inactive pack, keyboard
focus, clipboard denial, 320 px reflow, enlarged text, print and no-JavaScript
attachments on the same candidate SHA. Captures are review evidence, not
automatically accepted visual baselines. A later visual regression baseline
requires explicit review in the same pinned rendering environment.

The clipboard denial test doubles only the browser API rejection. It does not
claim an actual operating-system permission interaction. Print CSS and Chromium
PDF output do not certify every printer. axe covers automatically detectable
WCAG A/AA violations; screen-reader usability and human visual judgment remain
explicitly separate evidence. Nothing here certifies the connected browser's
local-file access, which remains refused.

## Official references

- [Playwright 1.63.0 configuration](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/test-configuration-js.md)
- [Playwright 1.63.0 CI](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/ci.md)
- [Playwright 1.63.0 browser context options](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/test-use-options-js.md)
- [axe Playwright 4.13.0](https://raw.githubusercontent.com/dequelabs/axe-core-npm/v4.13.0/packages/playwright/README.md)
- [npm install options](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [Visual comparison environment constraints](https://playwright.dev/docs/test-snapshots)
- [Automated accessibility limitations](https://playwright.dev/docs/accessibility-testing)
- [GitHub Actions context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
- [GitHub Actions step outputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter)
- [Pinned checkout temporary Git configuration](https://github.com/actions/checkout/blob/d23441a48e516b6c34aea4fa41551a30e30af803/src/git-auth-helper.ts)
- [Git protected configuration scopes](https://git-scm.com/docs/git-config#SCOPES)
- [Git safe.directory](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory)
- [Git ownership regression tests](https://github.com/git/git/blob/v2.43.0/t/t0033-safe-directory.sh)
