# DEV-916: bounded npm registry convergence

Source: [DEV-916](https://linear.app/voidcorp/issue/DEV-916), fetched through Linear MCP
on 2026-10-09. The ticket records approximately six minutes between npm accepting
`voidmachine@4.0.0` with provenance on 2026-09-25 and the registry exposing it.
The previous loop made 12 observations with 11 ten-second pauses: 110 seconds of
waiting, excluding npm calls. It could not accommodate that observed propagation.

## Budget

The workflow now makes at most 73 observations, separated by 72 ten-second pauses.
The 720 seconds of pauses are twice the recorded six-minute propagation. This is
an empirical operating allowance from one publication, not an npm latency SLA or
a claim that all future publications converge within twelve minutes.

Each read uses `--fetch-retries=0 --fetch-timeout=10000`: the outer observation loop
owns transient retries, and each HTTP request has a ten-second budget. npm's
[configuration contract](https://docs.npmjs.com/cli/v11/using-npm/config/#fetch-timeout)
otherwise permits five-minute requests and two retries. Under the normal one-request
`npm view` path, convergence permits 730 seconds of HTTP waits plus 720 seconds of
pauses (24m10s). Pre-publication classification adds at most three reads and two
five-second pauses (40s), for a combined 24m50s.

The OIDC job has a hard 30-minute timeout, leaving 5m10s for setup, artifact
verification, process overhead and the single publish. That remaining allocation
is an operational ceiling, not a measured duration. HTTP timeouts do not bound
every npm operation or redirect, so the job timeout is the authoritative total
limit. It reduces GitHub's default six-hour ceiling; it does not increase a test
timeout. See the [GitHub job timeout contract](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes).

## Safety and recovery

The classifier remains the authority: only matching bytes with the SLSA
provenance marker converge. E404 and matching bytes awaiting provenance remain
transient observations. Different bytes, E401/E403 and malformed JSON still fail
immediately. The convergence loop never publishes. Publishing remains a single
operation, only after preflight reports the exact version absent.

A read-only local probe with npm 11.20.0 and a silent HTTP server returned
`FETCH_ERROR` with a `network timeout at: <url>` summary. That specific timeout
joins the existing transient codes; other `FETCH_ERROR` responses still fail.
The emitted shape is covered by a regression that failed before the classifier
change. No npm version or dependency is upgraded by this work.

On observation exhaustion the job fails with package, version, observation count,
last classifier state and a request to rerun the failed `publish` job after npm
propagates. `absent` means E404; `retry` means a transient read failure or matching
bytes without the expected provenance. A recovered existing matching version
skips publication and still goes through the credential-free signature and signed
SLSA verification job. A hard job timeout is reported by GitHub; use the same
recovery path after inspecting the failed step. Never bypass provenance or change
expected integrity to make a retry pass.

No repository script is loaded into the OIDC job. The tests execute its real
inline shell with registry I/O and sleep doubles at the infrastructure boundary.
Long polling scenarios replace the query boundary with classified observations;
existing-version and fatal cases also execute the inline classifier against npm
response doubles. This avoids spawning 73 Node processes per polling case.
They simulate propagation at six minutes, the final observation at
twelve minutes, exhaustion, existing-version recovery and fatal responses, without
contacting npm or sleeping. Existing classifier and cryptographic provenance tests
retain their separate responsibilities.

## Verification and limits

Before the fix, the convergence regression had four expected failures: both delayed
success paths, the final observation and expiry at 720s instead of 110s. The added
network-budget check also failed before the flags and job ceiling existed.

Run `pnpm exec vitest run test/workflows` for the focused release contracts.
Publication itself requires GitHub OIDC and remains a human release gate. Local
simulation does not claim a new production propagation measurement. Record the
next real publication latency before revisiting the operating allowance.
