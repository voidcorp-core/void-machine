# Native tracker access

The source-only `pnpm backlog:index` generator has been retired. Read complete
issues, their relations and comments through the connected native tracker when
needed. Lists may truncate issue descriptions; fetch the complete selected issue.
An unavailable provider remains unknown and blocks only the action that needs it.

Existing `.void/machine/linear-index/` generations and `linear-export.json` files
are preserved as historical local data. No migration deletes or refreshes them,
and no incremental index update is required after a tracker write. Never replay a
successful remote write because a local reporting step failed.
