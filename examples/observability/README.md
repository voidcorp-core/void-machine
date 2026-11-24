# Native runtime metrics, local preparation

This opt-in example uses **Alloy 1.22.0**, Claude Code **2.1.330** and Codex
**0.171.0**. It installs nothing and changes no runtime/user configuration. Its only
destination is loopback. There is no Cloud account, NAS deployment or SDK dependency.

The two mappings in `config.alloy` accept only observed metric names, versions,
types, units, temporality and bounded category values. Logs and traces have no route.
Resource and datapoint identities, scope metadata and schema URLs are removed
before the exporter. Points carrying exemplars are dropped entirely; they are not
scrubbed and retained. Treat the unauthenticated loopback receiver as a local trust
boundary, not a network endpoint. Keep Alloy debug logging disabled.

## Run the local checks

Supply a separately installed, provenance-verified official Alloy binary:

```sh
export ALLOY_BIN=/path/to/alloy
"$ALLOY_BIN" validate examples/observability/config.alloy
PYTHONDONTWRITEBYTECODE=1 python3 examples/observability/verify.py
```

To verify every expression in `queries.md` against a real temporary Prometheus
backend, also set `PROMETHEUS_BIN=/path/to/prometheus` (verified 3.16.0). Without
that binary the query check explicitly skips; the Alloy checks still run. Port 14321
is used only by that test. No Grafana instance is changed.

The Python file is a bounded test HTTP destination and integration test, not a
collector, sanitizer for production, telemetry SDK or service. It starts the real
Alloy pipeline, replays expurgated native fixtures and checks the exported bytes.
It calls no model and needs only Python's standard library. Ports 14318–14320 must
be free. All subprocesses and temporary state belong to that test.

For a manual run, the loopback destination on 14319 must be supplied separately:

```sh
"$ALLOY_BIN" run examples/observability/config.alloy \
  --disable-reporting --server.http.listen-addr=127.0.0.1:14320 \
  --feature.component-shutdown-deadline=5s --storage.path=/tmp/native-alloy-state
```

Queue: 64 datapoints, one sender, batches at most 32 datapoints, flush 100 ms.
Exporter timeout: 500 ms; retry budget: 2 s. Overflow returns a retryable error
without waiting for room. The memory limiter targets a 256 MiB heap with a 64 MiB
spike margin; this is not a hard RSS limit. HTTP bodies are capped at 2 MiB.
Shutdown has a 5 s component deadline. Memory queues may lose data on overflow,
shutdown, restart or timeout. Collector health is not delivery confirmation.

## Reading the diagnostic view

The candidate mapping deliberately exposes **the last received export delta** as
a gauge. It does not provide usage totals over a selected time range. Adding
identity-free deltas from concurrent sessions to a cumulative stream can lose
or double-count overlapping intervals; no session identifier is exported to make
that look reliable. Within one native metric in one payload, compatible points
are summed after identity removal. Across payloads, the latest observation wins.
Concurrent sources can overwrite each other; out-of-order or colliding samples
can also be rejected by the destination. No cross-resource conservation is claimed.
Do not use `rate`, `increase` or `sum_over_time` on these gauges, and do not use them for billing.

| Native input | Native unit/type | Diagnostic output |
| --- | --- | --- |
| Claude `token.usage` | `tokens`, delta monotonic sum | last delta, distinct input/output/cacheRead/cacheCreation |
| Claude `cost.usage` | `USD`, delta monotonic sum | estimated cost delta; not invoice cost |
| Claude `session.count` | empty unit, delta monotonic sum | last session-start delta; not tool activity |
| Claude `active_time.total` | `s`, delta monotonic sum | activity delta by cli/user; not API latency |
| Codex `turn.token_usage` | **empty unit**, delta histogram | histogram sum by token_type; native unit remains empty |
| Codex `turn.e2e_duration_ms` | `ms`, delta histogram | separate sum/count; average full-turn duration, not API latency |

Codex `total` overlaps input/output; `cached_input` is included in input and
`reasoning_output` in output. Never sum these categories. Unknown versions and
cumulative inputs are dropped. Missing signals, histogram sums and categories
remain absent, never synthesized as zero. No Codex cost is emitted or derived.
Actual zero-valued samples in the fixtures remain genuine zeros.

See [native settings](native-settings.md), [Grafana queries](queries.md) and
[fixture provenance](fixtures/README.md). This is a preparation candidate: its
reduced diagnostic semantics require acceptance before an operational usage view
can be considered complete.

## Before any external activation

Select exactly one backend. First evaluate Grafana Cloud **Free only** against the
actual account's current series/volume limits and required retention using
representative usage. Otherwise inspect the existing Synology DS923+ 16 GiB:
Grafana alone proves neither metric storage, secure ingestion nor capacity.
No paid plan, trial upgrade, dual export or NAS change is implied.

Verify supported versions, native privacy controls, authentication, TLS,
connectivity, observed exported series and volume, and actual converted metric
names on that backend. Provision future credentials through the approved secret
manager/Infisical, never `.env` or copied project secrets. Replace the single local
export destination only in that separately authorized deployment. A backend can
rename units differently; repeat the queries there before enabling a view.

The mappings and their tests are an explicit maintenance cost on every native
schema upgrade. No collection savings are claimed by this example.

## References for the tested versions

- [Alloy 1.22.0 release and checksums](https://github.com/grafana/alloy/releases/tag/v1.22.0)
- [Versioned Alloy component sources](https://github.com/grafana/alloy/tree/v1.22.0/docs/sources/reference/components/otelcol)
- [OTTL transforms 0.164.1](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.164.1/processor/transformprocessor)
- [Claude monitoring and privacy controls](https://code.claude.com/docs/en/monitoring-usage)
- [Codex 0.171.0 configuration schema](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/config.schema.json)
- [Codex native metrics catalog](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry)
- [Prometheus 3.16 configuration](https://prometheus.io/docs/prometheus/3.16/configuration/configuration/)
