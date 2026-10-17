# Isolated consumer browser QA

The `browser conformance` CI job consumes the existing archive from
`consumer-artifact`. The shared verifier checks its SHA and digest before an
offline npm installation. The installed CLI generates absent/installed synthetic
documents on the runner. No exported developer document, personal browser
profile, home directory or connected-browser permission is used.

Playwright runs on GitHub-hosted Ubuntu 24.04, with the Chromium revision bundled
with Playwright 1.63.0. Contexts are offline, service workers are blocked, and
unexpected requests or uncaught page errors fail the suite. One worker, zero
retries, a five-minute suite limit and a fifteen-minute job limit bound execution.
This suite intentionally refuses local execution; do not set CI markers on a
developer machine to evade that boundary. Run it through the PR's normal CI.

The private tooling manifest stays outside the pnpm workspace and shipped CLI.
It pins Playwright and its exact playwright/playwright-core dependency chain,
and pins both axe packages (including the transitive axe-core override). The
playwright-core peer is also explicitly pinned. The
runner installs with scripts and lockfile creation disabled. Review this complete
dependency graph when upgrading; do not introduce floating transitives silently.

## Evidence and review

The artifact `browser-evidence-<SHA>` holds the HTML report, attached screenshots,
print PDFs, failure traces, the resolved `tooling-tree.json` and `evidence.json`. The manifest binds the source SHA,
archive digest, generated document hashes and tooling versions. Uploads run on
success or failure and expire after fourteen days. The test step's failure is
never replaced by the upload outcome. Missing fixtures or zero selected tests
fail instead of certifying an empty run.

The same job also retains `browser-native.log`, combining the original test
command's stdout and stderr with Playwright's `pw:protocol,pw:browser` diagnostics.
It records raw CDP requests/responses (including layout metrics and screenshot
parameters) and browser process output without truncating protocol messages. The
log lives outside `test-results`, which Playwright clears at startup. The shell
returns the original command's exit status; logging changes no capture assertion,
browser flag or execution limit. Match protocol session/request IDs to the retained
trace when investigating a capture failure. These diagnostics may not reveal
compositor internals, and a later passing run does not explain an earlier failure.

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

- [Playwright 1.63.0 protocol logging](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/packages/playwright-core/src/server/helper.ts)
- [Playwright 1.63.0 browser process logging](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/packages/playwright-core/src/server/browserType.ts)
- [GitHub Actions shell and exit semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsrun)
- [Playwright 1.63.0 configuration](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/test-configuration-js.md)
- [Playwright 1.63.0 CI](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/ci.md)
- [Playwright 1.63.0 browser context options](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/docs/src/test-use-options-js.md)
- [axe Playwright 4.13.0](https://raw.githubusercontent.com/dequelabs/axe-core-npm/v4.13.0/packages/playwright/README.md)
- [npm install options](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [Visual comparison environment constraints](https://playwright.dev/docs/test-snapshots)
- [Automated accessibility limitations](https://playwright.dev/docs/accessibility-testing)
- [GitHub Actions context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
