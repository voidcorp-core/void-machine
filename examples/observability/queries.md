# Grafana diagnostic view

Use a Prometheus datasource and **instant queries**, with table/stat panels. Show
category and runtime/version labels in every table. These expressions were executed
against Prometheus **3.16.0** ingesting the actual Alloy output via its OTLP receiver
with `translation_strategy: UnderscoreEscapingWithSuffixes`. This verifies conversion
and query results, not a live Grafana installation or Grafana Cloud compatibility.

Title the view **Latest native export intervals**. Keep the timestamp and age tables
visible beside the values. Missing series must display **Unavailable**, never zero.
Prometheus normally stops returning an untouched instant series after its five-minute
lookback; an absent value is not proof the runtime is idle. A last delta is not a
chosen-period usage total. Concurrent payloads can overwrite one another.

## Tokens in the last received export

Claude table, native unit `tokens`; retain `type` in the legend:

```promql
claude_code_token_usage_delta_tokens{runtime="claude_code"}
```

Codex table, observed native unit **empty**; these are documented token counts from
histogram sums. Retain `token_type` in the legend and label this unit distinction:

```promql
codex_turn_token_usage_delta{runtime="codex"}
```

Keep categories separate. Codex total includes input/output, cached_input overlaps
input, and reasoning_output overlaps output. No cross-runtime total is meaningful.

## Native cost and activity

Claude estimated cost in the latest export, display unit USD. No Codex cost panel:

```promql
claude_code_cost_usage_delta_USD{runtime="claude_code"}
```

Claude active time in the latest export, display seconds and retain `type`. This is
not API latency:

```promql
claude_code_active_time_total_delta_seconds{runtime="claude_code"}
```

Codex mean full-turn duration within its latest export, display milliseconds. Match
sum/count labels and timestamps so a missing newer sum cannot use an older value.
A missing sum or zero count stays unavailable:

```promql
(codex_turn_e2e_duration_ms_delta_sum_milliseconds / (codex_turn_e2e_duration_ms_delta_count > 0)) and (timestamp(codex_turn_e2e_duration_ms_delta_sum_milliseconds) == timestamp(codex_turn_e2e_duration_ms_delta_count))
```

## Timestamp and age of every displayed signal

Timestamp table, display Unix milliseconds as date/time; preserve metric and
category labels so freshness cannot be mistaken for a single global heartbeat.
Apply `timestamp` directly to source selectors before relabeling: a calculated
vector can carry the evaluation time. Codex duration sum/count share the native
`source` label, so select them separately and assign distinct signal labels before
union. The other series are already distinct by source/category.
See [Prometheus timestamp/label functions](https://prometheus.io/docs/prometheus/3.16/querying/functions/)
and [set union semantics](https://prometheus.io/docs/prometheus/3.16/querying/operators/#logicalset-binary-operators).

```promql
(
  label_replace(timestamp({runtime=~"claude_code|codex",source!="codex.turn.e2e_duration_ms"}), "signal", "$1", "source", "(.*)")
  or label_replace(timestamp(codex_turn_e2e_duration_ms_delta_sum_milliseconds{runtime="codex"}), "signal", "$1.sum", "source", "(.*)")
  or label_replace(timestamp(codex_turn_e2e_duration_ms_delta_count{runtime="codex"}), "signal", "$1.count", "source", "(.*)")
) * 1000
```

Age table, display seconds. An old value should remain visibly old, and absent
signals should remain unavailable:

```promql
time() - (
  label_replace(timestamp({runtime=~"claude_code|codex",source!="codex.turn.e2e_duration_ms"}), "signal", "$1", "source", "(.*)")
  or label_replace(timestamp(codex_turn_e2e_duration_ms_delta_sum_milliseconds{runtime="codex"}), "signal", "$1.sum", "source", "(.*)")
  or label_replace(timestamp(codex_turn_e2e_duration_ms_delta_count{runtime="codex"}), "signal", "$1.count", "source", "(.*)")
)
```

Do not apply rate, increase or temporal sums to these gauges. Changing the dashboard
time range does not turn the last export into a cumulative usage or billing report.
The retained session-start delta is available as `claude_code_session_count_delta`
for debugging only; it is neither a current session count nor tool activity.

## Measured size and hypothetical cadence

The two selected native fixtures, through the real pipeline, yielded **14 series**
and **6,523 JSON bytes** after decoding and reserializing the local output (uncompressed JSON,
including whitespace, field names and timestamps; not a wire-byte measurement). That replay is not a full-day sample.

If, hypothetically, the same 14 points/6,523 bytes arrived once per minute, that is
20,160 samples and about 9.39 MB JSON per day, 604,800 samples/about 282 MB per
30 days. At one second the same payload would be about 564 MB JSON/day. This is
not Cloud billable ingestion, compressed network volume or storage usage. Runtime
versions, categories, cadence and activity change these numbers; actual account
quotas/retention and NAS capacity remain unknown. Use backend-native usage reporting
before selecting Grafana Cloud Free or the NAS alternative.
