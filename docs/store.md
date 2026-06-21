# Report Store

The report store is a dependency-free split export of `report-combined.json`.

Run:

```bash
npm run store:export
```

Default output:

```text
data/report-store
```

When local config sets `app.dataDir`, the default output becomes `<app.dataDir>/report-store`.

It writes:

- `manifest.json`: schema, source report, file map, and row counts.
- `overview.json`, `summary.json`, `profile.json`, `metric-definitions.json`, `modes.json`, `activity.json`, `accounts.json`, `results.json`, `rules.json`, `confidence.json`.
- `metric-definitions.json` explains frontend metric semantics, including player-owned metrics, observed server-chat broadcasts, result-eligible-only totals, and non-result activity rows.
- `sources-index.json`, `scopes-index.json`, `accounts-index.json`, `modes-index.json` for frontend filters. `modes-index.json` uses unique ids such as `round:bedwars` and `activity:the_pit`, while `modeId` keeps the normalized game mode id for filtering.
- JSONL tables for time series, scopes, sources, reliable rounds, ignored rounds, and continuous-mode activity segments.

The local API reports missing split-store data explicitly:

- `GET /api/store` returns `503 store_not_ready` when `manifest.json` is absent.
- `GET /api/store` returns `503 store_invalid_json` when `manifest.json` is corrupt.
- `GET /api/store` returns `503 store_invalid_manifest` when `manifest.json` is valid JSON but has an unsupported schema, missing file map, missing counts, or invalid JSONL table declarations.
- `GET /api/app/status` reports `store_files_missing` when the manifest is valid but one or more declared store files are missing, so clients can offer refresh before a table query fails.
- `GET /api/diagnostics` and `GET /api/diagnostics/package` include privacy-safe `outputs.store.ready`, `outputs.store.fileErrorReason`, and `outputs.store.missingFiles` details for the same condition. Safe relative store file names such as `by-day.jsonl` are kept; absolute local paths remain redacted.
- `npm run doctor -- --json` also reports `outputs.store.filesReady` and `outputs.store.missingFiles` for manifest-declared store files.
- `GET /api/store/table?...` returns `store_not_ready` until a refresh or `npm run store:export` regenerates the manifest, `store_invalid_manifest` when the manifest shape is unsupported, `store_table_not_ready` when a declared table file is missing, and `store_table_invalid_jsonl` when a declared table has corrupt JSONL.
- Cleaning derived data with `POST /api/data/cleanup` never touches original logs; follow it with `POST /api/refresh` to rebuild report and store outputs.

This is not a replacement for the canonical full report yet. It is a storage bridge for future large-report handling, frontend lazy loading, or a later SQLite import.
