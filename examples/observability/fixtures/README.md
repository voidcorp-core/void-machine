# Native fixture provenance

Captured on 2026-11-23 from installed Claude Code 2.1.330 and Codex CLI 0.171.0,
one synthetic invocation each. A temporary loopback-only HTTP test receiver
accepted native OTLP JSON. Raw request bodies and native stdout/stderr were not
persisted. Resource and datapoint attributes were allowlisted in memory before
writing local evidence. Only the selected metrics were then copied here.

Kept: observed metric names, units, types, temporality, monotonicity, numerical
values, histogram bounds/counts and supported category values. Removed: all other
metrics, identities, model names, scope/description, exemplars and unsupported
categories. Timestamps were replaced with the fixed interval 1700000000–1700000001
seconds. No numerical value was invented. The Codex fixture omits one observed
zero-valued token point whose category was outside the selected allowlist.

Native transport observations, before reduction:

| Runtime | Requests | JSON bytes | Elapsed | Exit |
| --- | ---: | ---: | ---: | ---: |
| Claude | 2 | 7,429 | 5.500 s | 1 (observed cost above configured budget) |
| Codex | 1 | 1,044,071 | 5.891 s | 0 |

Only `/v1/metrics` was received. Native input was much larger than the retained
signals. These are two synthetic sessions with repository startup context,
not representative daily consumption or a Cloud quota guarantee. The committed
fixtures intentionally contain no user/session/account identity. Test-generated
canaries and mutations are synthetic and kept separate from these observations.
