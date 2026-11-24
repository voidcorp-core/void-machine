# Native settings, scoped to one invocation

Apply these through the supported user/organization layer only when explicitly
activating telemetry. A repository cannot configure these exporters for its users.
No configuration file here is automatically loaded. Keep existing permissions,
hooks, trust and model/provider selection. Managed settings may override local
choices; verify the actual destination before activation.

## Claude Code 2.1.330

Use these process environment settings. The probe used the exporter/content controls;
the two explicit beta-disable aliases below were added after that observation. They may still emit
identities in native metric resources, which is why Alloy's allowlist is required.

```sh
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=0
ENABLE_ENHANCED_TELEMETRY_BETA=0
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_TRACES_EXPORTER=none
OTEL_LOG_USER_PROMPTS=0
OTEL_LOG_ASSISTANT_RESPONSES=0
OTEL_LOG_TOOL_DETAILS=0
OTEL_LOG_TOOL_CONTENT=0
OTEL_LOG_RAW_API_BODIES=0
OTEL_LOG_MANAGED_SETTINGS=0
OTEL_RESOURCE_INCLUDE_HOST=0
OTEL_METRICS_INCLUDE_SESSION_ID=false
OTEL_METRICS_INCLUDE_ACCOUNT_UUID=false
OTEL_METRICS_INCLUDE_VERSION=true
OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES=false
OTEL_METRICS_INCLUDE_REPOSITORY=false
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318
OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://127.0.0.1:14318/v1/metrics
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
OTEL_EXPORTER_OTLP_TIMEOUT=2000
OTEL_EXPORTER_OTLP_METRICS_TIMEOUT=2000
OTEL_METRIC_EXPORT_INTERVAL=1000
```

The one-second interval is for local verification, not a recommended production
cadence. Do not inherit unrelated exporter headers or beta tracing endpoints into
a probe. The observed session used `claude -p` with `--tools ''` and a synthetic
instruction to reply `OK`, without reading files or delegating. Its 0.25 USD budget
was exceeded by the first context-bearing request: native cost was 1.202744 USD
and exit status was 1. The CLI error text was discarded, so budget termination
is inferred from those observations. A CLI budget is not a strict per-request cost cap. This proves
metric emission, not a successfully completed task. No retry was made.

## Codex 0.171.0

Equivalent invocation-scoped overrides, without changing `config.toml`:

```sh
codex exec --ephemeral \
  -c 'analytics.enabled=false' \
  -c 'otel.exporter="none"' \
  -c 'otel.trace_exporter="none"' \
  -c 'otel.log_user_prompt=false' \
  -c 'otel.log_agent_responses=false' \
  -c 'otel.metrics_exporter={otlp-http={endpoint="http://127.0.0.1:14318/v1/metrics",protocol="json"}}' \
  'Synthetic telemetry check only. Reply with OK. Do not use tools, read files, delegate or change anything.'
```

Analytics and the custom metrics exporter are separate controls. Logs/traces are
explicitly disabled; a tool-result byte cap would not exclude content. The actual
probe exited 0 in 5.891 seconds and emitted metrics once at shutdown. It proves no
tool execution or successful session resume. Native export timeout/queue behavior
is not configured by this example and must not be inferred from Alloy's limits.
