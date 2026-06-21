# Custom Rules

Custom rule packs let you add local server wording without editing bundled parser files.

## Enable

Add a file or directory to `customRules`:

```json
{
  "customRules": ["custom-rules/my-server.json"]
}
```

Directories load all direct `.json` files in name order.

Custom packs load before bundled rules. This is useful when a server-specific line would otherwise match a broad global rule.
The local API caches custom rule packs by file content hash, so changes made through `POST /api/rule-packs/user` or direct edits to configured custom rule files are visible to rule test/list endpoints without restarting the API process.
When saved through `PUT /api/config`, `customRules` entries must be project-relative rule-pack directories or `.json` files. The API rejects paths outside the project, Minecraft log roots, derived data/cache folders, source/docs directories, package metadata, and other non-rule-pack locations.
Project-managed packs saved through `POST /api/rule-packs/user` must use stable lowercase ids that match `^[a-z0-9][a-z0-9_-]{0,79}$`; the id is also the managed file name.

## Bundled Rule Packs

Bundled rules are split by physical rule pack. `game-state` contains shared result, boundary, lobby, and generic server rules. Mode-specific rules live in packs such as `bedwars`, `skywars`, `duels`, `mega_walls`, `mini_walls`, `the_pit`, `blitz_sg`, `bridge`, `build_battle`, `hide_and_seek`, `murder_mystery`, `speed_uhc`, `the_walls`, and `uhc`.

The legacy `game-state` selector remains backward compatible. When `rules` is empty, or when `ruleSets: ["game-state"]` is used in rule testing, migrated mode rules still report the effective `ruleSet` as `game-state` so old result reasons and filters keep working. The same event also exposes `rulePack`, which is the physical pack that matched the line. Selecting a concrete pack such as `ruleSets: ["skywars"]` reports `ruleSet: "skywars"` and `rulePack: "skywars"`.

Rule quality reports include both `byRuleSet` for compatibility-facing counts and `byRulePack` / `byRulePackId` for physical-pack maintenance. Use the physical pack fields when pruning or adding fixtures for bundled mode rules.

## Validate

```bash
npm run rules:validate
npm run rules:validate -- --rule-file custom-rules/my-server.json
npm run rules:doctor
```

## Lifecycle And Dry Run

- `GET /api/rule-packs` lists bundled, configured, and project-managed user packs with source, enabled state, validation state, rule count, modified time, and warning summaries.
- `POST /api/rule-packs/user/enable` toggles a managed user pack in local `customRules`; run refresh afterward before stats change.
- `POST /api/rule-packs/user` backs up the previous managed file before overwriting it. Backups live under the project data dir and can be listed/restored with `/api/rule-packs/user/backups` and `/api/rule-packs/user/restore`.
- `POST /api/rules/dry-run` and `npm run rules:dry-run` preview rule effects without writing report, store, config, or official cache data. The API response is privacy-safe by default and only writes isolated dry-run caches under the derived data dir; use `full: true` or CLI `--full` for local sample paths.
- `POST /api/unknown-audit/labels` and `npm run result:audit-labels` validate reviewed unknown-audit labels and stale `roundRef` values without changing stats.
- `POST /api/rules/draft-from-labels` and `npm run rules:draft-from-labels` turn reviewed JSON, JSONL, or CSV label rows into a draft rule pack. Review and dry-run the result before enabling.
- `POST /api/rules/audit-workflow` and `npm run rules:audit-workflow -- --input <reviewed.jsonl>` run validation, draft generation, and dry-run preview as one auditable local workflow. The workflow does not save or enable user packs; CLI artifacts are written under `artifacts/unknown-audit-workflows` by default. CLI output includes `artifactSummary` with privacy-safe relative artifact paths for UI/display, while `artifacts` keeps local paths for this machine. If rows are labeled `win`, `loss`, or `ignore` but do not include exact `message` text, the workflow reports `missing_rule_text` and `missingRuleTextRows` instead of silently producing zero draft rules.
- `npm run rules:quality-baseline` writes a privacy-safe snapshot of `report.rules.quality` to `artifacts/rule-quality-baseline-current.json`, archives the previous current snapshot under `artifacts/rule-quality-history`, and compares hit/zero-hit/risk/duplicate-pattern counts. Use it after rule changes and refreshes to catch quality drift before promotion.

## Rule Set Shape

```json
{
  "id": "my-server",
  "name": "My Server",
  "description": "Local rules for one server.",
  "cleaners": [
    {
      "pattern": "^\\[[^\\]]+\\]\\s*",
      "flags": "i",
      "replacement": ""
    }
  ],
  "rules": [
    {
      "id": "my_win",
      "type": "win",
      "pattern": "^You won!$",
      "flags": "i",
      "payload": {
        "gameMode": "duels"
      }
    }
  ]
}
```

## Event Types

- `round_countdown`: payload may include `seconds`.
- `round_start`: starts a new inferred round.
- `round_end`: ends the current round without necessarily marking win/loss.
- `win`: marks the current round as a win and closes it.
- `loss`: marks the current round as a loss and closes it.
- `game_mode`: updates the current round mode.
- `kill`: payload should include `killer` and `victim`.
- `death`: payload should include `victim`.
- `bed_destroy`: payload should include `player` when known.
- `team_eliminated`: currently diagnostic.
- `player_join` / `player_leave`: round population signals.

## Capture Groups

Named regex groups become `payload` fields:

```json
{
  "id": "custom_kill",
  "type": "kill",
  "pattern": "^(?<killer>.+?) defeated (?<victim>.+?)$"
}
```

Static `payload` is merged first, then named captures override it.

## Game Modes

Use normalized IDs such as:

- `bedwars`
- `skywars`
- `duels`
- `bridge`
- `murder_mystery`
- `mini_walls`
- `zombies`
- `tnt_run`
- `dropper`
- `unknown`

## Example

See `custom-rules/examples/local-server.example.json`.

The `examples` directory is not enabled by default. Copy an example to another file and add that file to `customRules`.
