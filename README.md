# Minecraft Log Resolver

Minecraft Log Resolver is a local desktop tool for reading Minecraft log folders and turning them into searchable reports, match summaries, diagnostics, and review queues.

It is designed for one user on one machine. Your raw Minecraft logs stay on your computer and are treated as read-only input.

## Download

Get the latest Windows build from the GitHub Releases page:

```text
https://github.com/A1mAssist/minecraft-log-resolver/releases/latest
```

Recommended build:

```text
MinecraftLogResolver-v0.1.0-windows-x64.exe
```

Portable folder build:

```text
MinecraftLogResolver-v0.1.0-windows-x64-portable.zip
```

The Tauri desktop build uses the WebView already available on Windows and talks to the Rust backend through Tauri IPC. It does not bundle Node.js, does not start `node.exe`, and does not open a localhost HTTP port.

## What It Does

- Reads selected `.minecraft` roots and launcher instance folders.
- Parses Minecraft chat logs into rounds, activity segments, server labels, and game modes.
- Builds report and summary JSON for the dashboard.
- Exports split JSON/JSONL stores for faster local browsing.
- Produces diagnostics, unknown-result queues, and rule-review files.
- Keeps original Minecraft log files untouched.

## Current Desktop Status

The Windows desktop build is a no-port Tauri app. It validates log roots, saves local config, scans Minecraft logs, writes report/store data, and serves the dashboard through the Rust backend.

For full backend development workflows, use the Node commands in this repository.

## Privacy

Do not publish or attach these local files unless you know exactly what they contain:

- `minecraft-log-resolver.local.json`
- `.cache/`
- `data/`
- `exports/`
- `labeling/`
- `report-combined.json`
- `report-combined-summary.json`
- `unmatched-debug.json`
- `artifacts/`

These files may contain local paths, account names, chat context, derived statistics, or private review data.

The shared example config is safe to commit:

```text
minecraft-log-resolver.local.example.json
```

## Local Config

Shared config:

```text
minecraft-log-resolver.config.json
```

Machine-private config:

```text
minecraft-log-resolver.local.json
```

Create the private config from the example:

```bat
copy minecraft-log-resolver.local.example.json minecraft-log-resolver.local.json
```

Example:

```json
{
  "roots": [
    "D:\\Games\\Example\\.minecraft"
  ],
  "owner": {
    "aliases": [
      "YourServerNick",
      "YourOfflineName"
    ]
  }
}
```

`roots` may point to `.minecraft` folders or launcher instance folders that contain `logs/`.

## Development

Install dependencies:

```bat
npm.cmd install
```

Run the legacy local API and development UI:

```bat
npm.cmd run api
npm.cmd run dev
```

Run tests:

```bat
npm.cmd test
```

Useful focused checks:

```bat
npm.cmd run test:frontend
npm.cmd run test:api
npm.cmd run test:openapi
npm.cmd run test:release-check
```

## Build

Build the Tauri frontend:

```bat
npm.cmd run build:tauri-frontend
```

Build the Windows Tauri executable:

```bat
npm.cmd run tauri:build -- --no-bundle
```

Build the portable desktop folder:

```bat
npm.cmd run build:tauri-portable
```

Output:

```text
dist/tauri-desktop/MinecraftLogResolver.exe
```

Release artifacts are generated under:

```text
artifacts/
```

## Data Model Notes

Some internal schema identifiers still use the earlier `minecraft-log-observatory-*` prefix. They are stable compatibility IDs for existing reports, stores, diagnostics, and tests; they are not the product name.

## Project Principles

- Local-first by default.
- Raw logs are read-only.
- Derived data can be rebuilt.
- No cloud account, sync service, or telemetry is required.
- Result inference is conservative; weak evidence goes to diagnostics and review queues.
- The Pit is treated as activity, not win/loss round results.
