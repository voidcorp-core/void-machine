# Void Machine (private workspace)

Private Machine foundation, never published on its own. One capability reaches users: agent
delegation, embedded in the voidmachine CLI as `void-machine agents` through the `./agents`
export ([decision](../../docs/decisions-log/2026-09-28-kernel-delegation-ships-in-published-cli--0cfd77e6-1e8e-43e7-9d07-be5f1691b9c7.md)).
Its layers and contracts are described in `docs/ARCHITECTURE.md`, "Delegated agent runs"; the
Claude background-session contract is replayed from captures in `test/fixtures/claude-session/`,
and the Codex daemon contract from captures in `test/fixtures/codex-daemon/`.
Every other capability stays private until a consumer asks.

A1 candidate entry after build: `node dist/application/cli.js doctor --json`.
There is no public launcher; the Rust one was removed without a port. Direct application callers
supply cwd and environment. Doctor is read-only; paths follow XDG_CACHE_HOME,
then HOME/.cache, then repository .void/machine/cache. USERPROFILE is not a new
fallback. machine.toml path fields remain validated but do not override discovery,
matching retained behavior. No generic core is needed for this command.

Configuration/lock reads are capped at 65,536 bytes, strictly decoded as UTF-8,
and restricted to regular files. Malformed syntax/version/types are degraded;
read failures are blocked. Parser diagnostics never expose source contents.
TOML has maximum nesting 16 and exact integer parsing. Empty config remains valid;
its known fields are optional. A lock requires numeric schemaVersion 1; legacy
extra metadata remains readable. Reports preserve present nullable v1 fields;
compare parsed values, not JSON whitespace/control-character escaping.

Source grounding:

- smol-toml 1.8.0 [README](https://github.com/squirrelchat/smol-toml/blob/v1.8.0/README.md)
  and [parse options](https://github.com/squirrelchat/smol-toml/blob/v1.8.0/src/parse.ts):
  parse, maxDepth, integersAsBigInt; UTF-8 validation belongs to our file adapter.
- Zod 4.6.5 [release notes](https://zod.dev/blog/zod-4-6),
  [object API](https://zod.dev/api#objects) and
  [JSON Schema guide](https://zod.dev/json-schema): strictObject, safeParse,
  and Draft-7 output remain the contracts used here.
- TypeScript 7.0.2 [release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  and [6.0 transition notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html):
  the package has an autonomous strict NodeNext configuration with explicit
  `types: ["node"]` and `rootDir: "./src"`. The consumer pack baseline was not
  changed. Emit Node ESM. Distribution needs no
  runtime TS loader. Doctor contract tests run current sources with the existing
  CLI test dependency tsx 4.22.4 through Node --import, as the repository stdin
  process test does. Installed tsx package.json exports and dist/loader.mjs are
  the version-specific references; no dependency or configuration was added.
- Codex CLI 0.158.0 [app-server](https://learn.chatgpt.com/docs/app-server) (transports, daemon,
  threads, turns), checked against the installed version's own bindings
  (`codex app-server generate-ts`, `--experimental` for `thread/backgroundTerminals/clean`) and
  `codex app-server daemon --help`, `codex resume --help`: the sandbox modes are `read-only` and
  `workspace-write`, `thread/start` takes no name (`thread/name/set` does), `thread/turns/list`
  reads the last turn alone, and the daemon speaks WebSocket on its control socket.
- ws 8.21.0 [client API](https://github.com/websockets/ws/blob/8.21.0/doc/ws.md):
  `ws+unix://<path>:/` IPC addresses, `handshakeTimeout`, `maxPayload`, `perMessageDeflate: false`.
- Zod 4.6.5 `fromJSONSchema` is marked semi-experimental and refuses external `$ref`: an output
  schema is compiled when it is admitted, and an answer it cannot check is never called valid.
- Node 24 [filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html):
  openSync, fstatSync, readSync and closeSync bound the actual file read.

## Toolchain floor

This private package requires Node >=24.15.0. The foundation build, test typecheck,
and 111 contracts passed under Node 24.15.0 and Node 26.8.2 on 2026-09-21.
It uses TypeScript 7.0.2, Vitest 5.0.1, Zod 4.6.5, and Node 24 types.
Vitest 5's [migration guide](https://vitest.dev/guide/migration/) documents its
Node/Vite prerequisites and changed defaults. The package test suite remains on
its own runner; the repository-wide Vitest version is unchanged. The Node-floor
choice and SQLite implication are recorded in the
[Node 24 decision](../../docs/decisions-log/2026-09-21-machine-node-24-lts-floor--89f1ec74-3cf3-492a-be98-2ec03c924508.md).

The existing packed CLI budget is 2,000,000 bytes. Measure check:size before any CLI cutover;
do not drop maintained parsing or raise the ceiling to make the gate green.


## Layer boundary proof

`test/layer-boundaries.test.ts` parses the complete private source module graph
with the official TypeScript 6 AST API, installed as a test dependency beside
TypeScript 7. It checks static/type imports, reexports, import types and dynamic
imports statically; it loads no module to prove isolation. A forbidden edge names
its importer and specifier. Core and runtime do not import adapters, application or
verticals; verticals use their own modules and core; adapters may implement
vertical-owned ports but cannot import application. Only application composes the
route. Core, runtime and verticals import no Node built-in module, with or without
the `node:` prefix, as `isBuiltin` from `node:module` reports it. Each layer names
its external packages in an explicit list (`zod` for core, runtime, verticals and
application, plus `smol-toml` for adapters); any other package is refused. A dynamic
import whose specifier is not a string literal is refused in every layer, and the
kernel refuses dynamic imports altogether. A fixed table of refused sources (bare
`fs`, `node:os`, `createRequire`, an unlisted package, `import(name)`, a reexport, a
type import, an extensionless path, an imported `.mts`, `export * from 'fs'`,
`import x = require('fs')`, `type T = import('fs')`, a literal dynamic import in core,
a root-level file) must each report one message naming the import, so a detector that
stops reporting fails the test. A local import must name a `.js` specifier, the NodeNext
form of a production `.ts` source. The scan refuses, rather than skips, any file of
`src/` outside the five known layers or that is not a production `.ts` source (`.mts`,
`.cts`, `.js`, `.mjs`, `.tsx`, `.d.ts`, `*.test.ts`), and asserts that it read the
known modules of every layer, so it cannot pass by reading nothing.
The guard reads module edges only; host globals are refused by a second proof.
`tsconfig.pure.json`, run by `typecheck`, compiles core, runtime and verticals with
`lib: ["ES2022"]` and `types: []`: no Node and no DOM types, so `process` (and
`process.getBuiltinModule`), `fetch`, `Buffer`, `require`, `import.meta.url`, timers
and `structuredClone` are compile errors there. The only host globals it types are
listed in `types/pure-globals.d.ts`: `AbortController`, `AbortSignal` and `TextEncoder`,
WHATWG primitives that do no I/O.
`test/pure-layer-types.test.ts` asserts that configuration and compiles a negative
fixture that must fail on each escape.
Neither proof confines code at run time: a typing boundary is not a sandbox.
The existing doctor format/Git adapters correctly depend on
doctor-owned schemas and types. The choice and its limits are in the
[layer guard decision](../../docs/decisions-log/2026-09-21-machine-layer-import-ast-guard--ba06a613-526a-4101-8f6f-165e583d63b9.md).

## M1 private application boundary

`src/application/note.ts` composes two injected asynchronous executors. Model and
runtime configuration stays in those caller-supplied functions; no provider,
process protocol or doctor dependency is required. `runtime/execution.ts` owns
correlation, caller-armed deadlines and explicit stop observations. Its injected
clock only schedules a callback and returns a cancellation function.

`sourced-note` owns question/two-source validation, exact quotation membership,
coverage of both sources and bounded JSON deliverables. Completed means this
structural/sourcing contract passed, not semantic quality certification.
Timeout requests AbortSignal and returns requested-unconfirmed cancellation;
it never asserts remote termination, retries or durable recovery.

The first proof uses simulated executors and a manual clock through the real
application/runtime. It does not prove real model execution. No process fixture
or general orchestration framework is needed for this transport-neutral seam.


M1 admission limits: timeoutMs applies to each execution separately (up to two
execution deadlines for a note), not to the whole mission. Correlation checks an
executor-supplied executionId; it is not authentication of the executor. The
transport adapter must bound incoming bytes before decoding: this object-level
runtime has no pre-parsing byte cap. The vertical bounds admitted inputs and
serialized note size, not transport memory. Exact quotation membership accepts
a single character and does not establish relevance or semantic support.

The package export remains doctor only; note is a private source application
seam, not a released package API. The accepted package ADR records the original
A5 sequence as provenance; the revised plan defers that cutover. No separate
publication is authorized.

## M2 native note entry

The private application entry can run the two-source note path through the installed
Claude Code CLI without making the generic runtime know a provider. Supply an input
JSON file, an explicit scratch cwd outside repositories, and two model names:

```text
node dist/application/cli.js note --input ./request.json --cwd /tmp/void-note-run \
  --extraction-model haiku --synthesis-model sonnet --timeout-ms 90000
```

The command performs extraction and synthesis sequentially, validates both untrusted
payloads with the same vertical schemas. Claude's native JSON Schema contract currently
accepts Draft-7, so the adapter asks Zod 4.4.3 to emit that target for both calls and
keeps the objects closed (`additionalProperties: false`). It prints the accepted note plus a receipt
of requested model, reported `modelUsage`, session id and non-hermetic native context.
The receipt is evidence from the CLI response, not absolute model or environment
attestation. Native user and managed settings remain enabled; the adapter does not
remove installed hooks or protections. The cwd and environment are explicit, but
the native runtime is not hermetic. A stopped result is printed as structured JSON,
including usage already observed for an earlier role, and exits 1. Native refusals are
classified into bounded public actions; raw stderr is never included. Process exit and
captured byte counts are retained only for otherwise-unclassified failures. Invalid CLI arguments or input files exit 2. Docker
and live model quality certification remain outside this tranche; durable recovery is the
separate mission entry below.

### M2 observation receipt

The executable pipeline is two sequential native calls: extraction from the two supplied
sources, then synthesis from the admitted extraction. Each response is untrusted and is
validated by the sourced-note vertical before the next call or final receipt. Requested
models, native `modelUsage` when present, session identifiers and role are recorded as
observations; they are not absolute model attestation. Each role has its own caller
deadline, and the adapter does not retry or claim remote termination after cancellation.

The first two bounded live attempts stopped during extraction with exit 1 and no accepted
model result. The confirmed native diagnostic reported stdout 0 bytes, stderr 122 bytes,
and the public refusal that the generated Draft 2020-12 JSON Schema was unavailable.
The adapter now emits the supported Zod Draft-7 target; the earlier concrete `-p`
argument change remains a separate hypothesis and is not recorded as the root cause.
The final live observation is pending and must use a fresh scratch cwd, explicit native
settings and the child environment allowlist. User and managed runtime context remain
non-hermetic by design. Docker execution remains deferred.

## Durable note mission

`note start` records the request and each step in a mission directory; `note resume`
continues it from those records in a new process. Paths are explicit: no home, XDG or
platform default is used, so the store can be a mounted volume. Relative paths resolve
against the process working directory, like any other CLI argument.

```text
node dist/application/cli.js note start --store /data/missions --mission m-42 \
  --input ./request.json --cwd /tmp/void-note-run \
  --extraction-model haiku --synthesis-model sonnet --timeout-ms 90000 [--stop-after extraction]
node dist/application/cli.js note resume --store /data/missions --mission m-42 --cwd /tmp/void-note-run
node dist/application/cli.js note cancel --store /data/missions --mission m-42
node dist/application/cli.js note abandon --store /data/missions --mission m-42
```

The mission id is required at start so a host crash can be followed by a resume.
Models and deadline come from the recorded start; executable, cwd and environment
are local to each process and never recorded. `--stop-after extraction` ends after the
accepted extraction is durable, for instance to read it before paying for synthesis.

Receipts: `completed` and `paused` exit 0; `stopped`, `rejected`, `abandoned` and a
`cancelled` with `stop: confirmed` or `stop: late-result-discarded` exit 1; `blocked`
exits 3 with a reason (`missing`, `conflict`, `storage`, `unrecordable`, `unreadable`,
`incompatible`, `context-changed`, `inadmissible`, `outcome-unknown`, `not-abandonable`)
and a diagnostic without source contents, as does a `cancelled` with
`stop: requested-unconfirmed`. Usage errors exit 2. Resuming a finished mission returns
the same bytes without a model call; a stopped mission replays its stop and is never
retried.

The generic mission reducer in `core/mission.ts` validates bounded event order.
`runtime/mission.ts` drives durable dispatch, revisions, resume and cancellation
through an injected journal. The kernel names a mission position a `step` in every
event and receipt; only the note codec, whose stored records say `stage`, and the note
receipt, whose public field is `stage`, translate it. The note vertical supplies its
two steps, result admission and codecs for both historical formats; the application only composes
these parts with the native executor and file journal. The private package export
remains doctor-only. A three-step test vertical with a distinct journal format
proves the same core can serve another policy without edits. The core covers one linear
pipeline of at most eight fixed, distinct steps, each dispatched once in declared order,
within 32 events. A review/correction loop that dispatches a step again, a branch, or a
durable wait for a clarification answer (plan B2) is outside it and will change the
reducer. This split does not change stored note bytes; the [core decision](../../docs/decisions-log/2026-09-21-machine-generic-mission-core--b9347b31-9053-45e0-a153-0a7104c0191b.md)
records its boundaries and reversal cost.

The current private suite has 161 passing tests under Node 24.15.0 and Node
26.9.0, including frozen `/1` and `/2` journal fixtures read byte for byte and a
three-step mission that resumes in a new context. Build and test typecheck pass on both runtimes.
Admission is a parser: the vertical's `admit(step, raw, input, config)` returns
`{ ok: true, value }` or `{ ok: false, reason }`. The codec decodes records into
untrusted values and encodes only admitted ones. On every read, the driver parses each
recorded value once, before a resume, cancel, abandon or completed delivery, and hands
the typed values to later steps and receipts; nothing downstream parses them again. A
schema-valid value that breaks the vertical's rules is blocked as `inadmissible`, with
the vertical's reason, without rewriting the journal. A live result the vertical
refuses, or a step the vertical refuses locally before launching anything, is recorded
as `rejected`, never as `outcome-unknown`. Codec and admission exceptions return typed
refusals before a step is launched.

The CLI and doctor contracts run source-loaded Node subprocesses. Their bounds only stop
a hang and never measure speed: every child process is bounded at 20 seconds and every
test at 30 seconds, above its children, so a hung child is reported by its own bound
first. A test that must order two processes awaits an event, the line a held fixture
sends to a loopback port the test publishes when it reaches its barrier, never a file
polled under an assertion deadline. A performance budget, if one is wanted, belongs in a
dedicated measurement, not in a timeout. See the [Vitest timeout
contract](https://vitest.dev/api/vi#setconfig).

Format `void-machine.note-mission/1`: one JSON record per file `NNNNNN.json`, at most
16 records of 262,144 bytes each, measured on the encoded JSON. Not every admitted
request fits: sources near their 65,536-byte limit, or text that JSON escaping enlarges,
can exceed it, and such a start is refused as `storage` before anything is dispatched.
Every record is checked against the format before it is written; one the reader would
refuse is never written (`unrecordable`). Directories are created 0700 and records 0600. An
append writes `.tmp-<uuid>` in the mission directory, syncs it, then links it to the next
revision. `link` refuses an existing name, so exactly one writer gets each revision;
any other link error is a storage failure, never a `rename` fallback. Readers ignore
hidden temporaries and keep them. The store root is trusted as chosen by the caller;
a mission directory that is a symbolic link is refused for reading and writing. Records are `started` (request, models, deadline,
contract digest), `dispatched`, `accepted` (extraction), `unconfirmed`, `stopped` and
`completed`; usage observed by the runtime is kept with the step that produced it.
Cancellation adds `cancelled`, `cancel-requested` and `abandoned`, written only in
`void-machine.note-mission/2`; every other record keeps `/1`, so a mission never cancelled
keeps its bytes and an older binary still reads it, while that binary refuses a cancelled
mission as `incompatible`. A `/2` historical kind or a `/1` cancellation kind is `unreadable`.
`rejected` (step, usage) is written only in `void-machine.note-mission/3`: the vertical
refused a step result that had run, so the mission settles as `rejected` with the usage
observed for that step, exits 1 and is never retried. `discarded` (see cancellation
below) is the only other `/3` kind. A resume replays that receipt; it is
not reported as `outcome-unknown`. Journals in `/1` and `/2` are read unchanged, and a
`rejected` kind under `/1` or `/2` is `unreadable`.

Cancellation and abandonment read and append the journal only; they start no runtime and
signal no process:

- `note cancel` on a mission with no step in flight records `cancelled` with
  `stop: confirmed`. That confirms only that no Machine step was active or will follow
  from that point; it is not the proof that a native model call stopped. The accepted
  extraction stays recorded, and synthesis is never dispatched.
- `note cancel` on a step in flight or unknown records `cancel-requested` and reports
  `stop: requested-unconfirmed, effect: unknown`: the native call is not killed, and its
  effect stays unknown. The writer of that step loses its next revision and reads the
  cancellation. If its call returned meanwhile, it records `discarded` (step, usage) in
  `note-mission/3`: the usage it observed is kept and reported by every later receipt,
  the result itself is never recorded and no next step runs. The mission is then settled
  as `cancelled` with `stop: late-result-discarded`: the step has stopped, so its effect
  is no longer unknown, and the receipt names why its value is absent. A second late
  result for the same step is refused as unreadable history. A
  cancel recorded after the dispatch intent but before the native spawn cannot prove that
  nothing spawned.
- `note abandon` settles an unknown or cancel-requested step as `abandoned, effect:
  unknown`; it is never launched again under that identifier, and `note start` still
  refuses the identifier. If the abandoned step's call still returns, its writer records
  `discarded` the same way: the cost is kept, the value is not, and the receipt becomes
  `abandoned, effect: late-result-discarded`. On a mission with nothing in flight it is refused as
  `not-abandonable`, since `note cancel` applies.
- Repeating either command on a settled mission writes nothing and returns the settled
  receipt. Missing, unreadable or incompatible records are refused and preserved. A cancel
  or abandon that loses its revision to a concurrent writer reads the journal once more
  and decides once more from the winning state: a settled mission returns its receipt, an
  idle or in-flight one is cancelled accordingly. A second loss reports `conflict`.
- There is no signal handler, process tracking or automatic reconciliation of an unknown
  step: the operator decides with `note abandon`.

Guarantees and limits:

- A dispatch intent is recorded before every native call, and its execution id is the
  native session id passed to Claude (`--session-id`). An intent with no outcome, from a
  crash or a timeout whose cancellation is unconfirmed, is reported as `outcome-unknown`
  from the first receipt on, and never launched again. There is no external exactly-once
  promise: an unknown or stopped step may still have spent.
- `blocked` and `paused` write nothing, so a live writer can still record its result
  after another resume saw it in flight. Two racing resumes launch one step; the
  loser reports `conflict` or `outcome-unknown` depending on timing.
- Recorded extraction and notes are re-admitted by `sourced-note` against the recorded
  request before synthesis or delivery. Corrupt, unknown-format or changed-contract
  records are preserved byte for byte, and nothing is dispatched.
- A failure to record the accepted extraction forbids synthesis; the next resume then
  reports the extraction as unknown. A record that was linked but whose directory sync
  failed is reported as `storage` with unconfirmed durability. After any uncertain storage
  outcome, including one that follows a native call, the process launches no further step.
- The contract digest covers the instructions and the emitted output schemas. It does not
  cover the native CLI version, user or managed settings, or model behavior: a resume
  under the same digest is not a hermetic replay.
- Only survival of an OS process crash is guaranteed and tested. Power loss is best effort:
  records and the mission directory are synced, but the parent store directories are
  not, Node on macOS cannot request a full drive flush, and the Docker Desktop mount was
  not measured. A torn record is refused, never repaired.
- The Claude runtime runs with `--no-session-persistence`, so an in-flight native call
  cannot be found again or queried; whether an orphaned native process still completes
  is not verified.

Observed on 2026-09-21 under Node 22.12.0 with the public M2 fixture: a paused start,
a resume in a new process that dispatched synthesis only, then a resume of the finished
mission that returned the same receipt and journal with no model call. Evidence is in the
[foundation plan](../../docs/plans/2026-09-20-void-machine-typescript-foundation-plan.md#22-reprise-durable-de-la-note-21-septembre-2026).

The choice of a file journal over `node:sqlite` is recorded in
[the file journal decision](../../docs/decisions-log/2026-09-21-machine-note-mission-file-journal--5450858b-e832-40f2-a066-1f176dda6f5f.md).
