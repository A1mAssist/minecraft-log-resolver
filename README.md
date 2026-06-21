# Minecraft Log Observatory

Local offline Minecraft log analytics for one user on one machine.

The tool reads your selected `.minecraft` log roots and generates derived reports, split JSON/JSONL stores, diagnostics, review queues, and a local API for the dashboard. Raw Minecraft logs are read-only: the app does not move, edit, upload, or delete them.

## Quick Start

Start the local app:

```bat
start.bat
```

Default UI:

```text
http://127.0.0.1:5173/
```

Stop local services:

```bat
stop.bat
```

The backend API binds to `127.0.0.1` by default. If port `8787` is busy, it chooses a local fallback and writes the runtime state to `.cache/api-server.json` for the static UI proxy.

## First Run

The first-run UI can open a Windows folder picker through:

```text
POST /api/system/select-directory
```

When called with `{ "validate": true }`, the picker also returns root validation diagnostics for the selected folder. If the picker is unavailable, paste an absolute path manually.

Useful setup endpoints:

```text
GET /api/app/status
GET /api/config
PUT /api/config
POST /api/config/validate-roots
POST /api/refresh
GET /api/refresh
POST /api/refresh/cancel
```

## Local Config

Shared config:

```text
minecraft-log-observatory.config.json
```

Machine-private config:

```text
minecraft-log-observatory.local.json
```

Do not put local paths, account aliases, or private directories in the shared config. Copy the example file:

```text
minecraft-log-observatory.local.example.json
```

to:

```text
minecraft-log-observatory.local.json
```

Example:

```json
{
  "roots": [
    "D:\\Games\\Neon\\.minecraft",
    "D:\\Games\\AuroraNetease_Clients\\.minecraft"
  ],
  "owner": {
    "aliases": [
      "YourServerNick",
      "YourOfflineName"
    ]
  }
}
```

`roots` may contain multiple `.minecraft` roots or launcher instance roots that contain `logs/`.

## Refresh Data

CLI refresh:

```bat
npm.cmd run report -- --unmatched-out unmatched-debug.json
npm.cmd run store:export
```

API refresh:

```text
POST /api/refresh
GET /api/refresh
POST /api/refresh/cancel
```

Refresh phases:

```text
scan -> parse -> build_report -> export_store -> commit -> done
```

Report and store outputs are staged first. Old derived data is preserved if refresh is cancelled or fails.

## Diagnostics And Cleanup

Privacy-safe doctor:

```bat
npm.cmd run doctor
npm.cmd run doctor -- --package
```

Performance baseline:

```bat
npm.cmd run performance:baseline
GET /api/performance
```

Release gate:

```bat
npm.cmd run release:check
npm.cmd run release:notes -- --out artifacts/release-boundary-draft.md
```

Build a local distributable folder:

```bat
npm.cmd run build:local-desktop
```

The bundle is written to `dist/local-desktop`. It includes the local API, static dashboard, rules, docs, and launch scripts, while excluding raw logs and derived local data.

To include the current Node.js runtime in the bundle:

```bat
npm.cmd run build:local-desktop -- --embed-node current
```

The embedded runtime is copied to `dist/local-desktop/runtime/node/node.exe`, and `start.bat` prefers it before falling back to `node` from `PATH`.

The first-run flow is the same in the bundle: choose or paste a root, validate it, save it through `/api/config`, then refresh to generate derived data.

Derived-data cleanup:

```text
POST /api/data/cleanup
```

Cleanup only removes derived data such as reports, cache, store, and refresh history. It never deletes original Minecraft logs.

## Unknown Audit Workflow

Export current unknown review queues:

```bat
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current
npm.cmd run result:audit -- --mode bedwars --priority high --include-context --review-packet --label-template --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review --before-ms 0 --after-ms 120000 --context-lines 80
```

Check review readiness:

```bat
npm.cmd run result:audit-status -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
```

Validate reviewed labels:

```bat
npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
```

Preview candidate rules before enabling:

```bat
npm.cmd run rules:audit-workflow -- --input labeling/reviewed.jsonl --target-mode bedwars
```

Audit exports and labels do not change official win/loss/unknown statistics. Candidate rules must pass dry-run review before enabling and refreshing.

## Development

Common commands:

```bat
npm.cmd run api
npm.cmd run dev
npm.cmd run test:api
npm.cmd run test:openapi
npm.cmd test
```

Backend handoff and contracts:

```text
docs/backend-status.md
docs/backend-runbook.md
docs/backend-todo.md
docs/api.md
docs/openapi.json
docs/performance.md
docs/store.md
```

## Privacy Boundary

Do not share these local files directly:

- `minecraft-log-observatory.local.json`
- `.cache/`
- `report-combined.json`
- `report-combined-summary.json`
- `data/`
- `artifacts/`
- `exports/`
- `labeling/`

They may contain local paths, account names, raw chat context, full reports, or derived local statistics. Use privacy-safe diagnostics or share packages for troubleshooting.

## Current Principles

- Raw Minecraft logs are always read-only.
- The backend is a dependency-free Node.js ESM HTTP API by default.
- Official win/loss inference is conservative; weak evidence goes to diagnostics and audit queues first.
- The Pit is modeled as non-result activity with `result: "not_applicable"`, not as win/loss/unknown rounds.
- JSON/JSONL remains the default data layer. Evaluate SQLite only if `/api/performance` shows sustained store size or read-latency pressure.
