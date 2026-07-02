# Local Report API

The API serves already-generated JSON reports. It does not rescan Minecraft logs per request.

Start it with:

```bash
npm run api
```

Default address: `http://127.0.0.1:8787`.
If the requested port is busy, `scripts/api.mjs` tries the next local ports by default and writes the selected endpoint plus runtime status to `.cache/api-server.json`. Use `--strict-port` to fail instead.

Use `npm run report` first when the report needs to be refreshed.

Use `npm run doctor` to check whether config roots, report outputs, store outputs, manifest-declared store files, caches, and refresh-history performance baselines are present. Doctor output is privacy-safe by default; pass `-- --full` only for local debugging, or `-- --package` to emit a safe troubleshooting bundle with a content manifest and privacy audit.

## Frontend Integration Contract

Use this section as the frontend source of truth. A shorter handoff version lives in `docs/frontend-api-contract.md`; send that file to frontend when they only need dashboard, rules, audit, and labeling integration. The full endpoint catalog below is broader because it also covers rule editing, diagnostics, refresh jobs, and support tooling.

### Startup Flow

1. Call `GET /api/app/status`.
2. If `setup.state` is `first_run`, show log-root selection and save through `PUT /api/config`.
3. If `setup.state` is `needs_refresh`, call `POST /api/refresh` after optional `POST /api/refresh/preflight`.
4. If `setup.state` is `refreshing`, poll `GET /api/refresh`.
5. If `setup.state` is `ready`, load dashboard data.

Do not infer first-run or refresh-needed state from missing cards, empty lists, or raw filesystem paths. Use `setup.state`, `refreshReasons`, and `recovery.actions`.

### Which Endpoint To Use

| UI need | Recommended endpoint | Main fields / response shape |
| --- | --- | --- |
| App readiness / first-run | `GET /api/app/status` | `setup.state`, `refreshNeeded`, `refreshReasons`, `recovery.actions`, `app.skinProxyEnabled` |
| Dashboard aggregate cards | `GET /api/summary` | `overview.*`, `metricDefinitions` |
| Career/profile cards | `GET /api/profile` | `totals`, `streaks`, `extremes`, `preferences`, `days` |
| Mode table/cards | `GET /api/modes` | `items` is an object keyed by mode id |
| Match/round list with filters | `GET /api/rounds` | top-level `total`, `offset`, `limit`, `items[]` |
| Very large unfiltered table pages | `GET /api/store/table?name=reliableRounds` | top-level `total`, `offset`, `limit`, `items[]`, `read.durationMs` |
| The Pit/activity timeline | `GET /api/activity?mode=the_pit` | `summary`, top-level `total`, `offset`, `limit`, `items[]` |
| Unknown review queues | `GET /api/results` plus `GET /api/rounds?result=unknown...` | `unknownAudit`, filtered unknown rows |
| Unknown label drafts | `GET/POST /api/unknown-audit/label-sets` | local derived label-set drafts, no report/store/config/rule writes |
| Metric labels/tooltips | `GET /api/metrics/definitions` | `metricDefinitions` |
| Refresh progress | `GET /api/refresh` | `status`, `phase`, `percent`, `filesDone`, `filesTotal`, `phaseDurationsMs` |
| Performance/debug panel | `GET /api/performance` | `baseline`, `store`, `storeReadBaseline`, `cache`, `apiCache`, `recommendations` |

### Response Shapes

The list endpoints use top-level pagination fields. There is no nested `pagination` object.

`GET /api/rounds`:

```json
{
  "set": "reliable",
  "filters": { "mode": "bedwars", "result": null },
  "total": 401,
  "offset": 0,
  "limit": 100,
  "items": [],
  "summary": {}
}
```

`GET /api/activity`:

```json
{
  "summary": {},
  "policy": {},
  "metricDefinitions": {},
  "filters": { "mode": "the_pit" },
  "total": 12,
  "offset": 0,
  "limit": 100,
  "items": []
}
```

`GET /api/store/table`:

```json
{
  "name": "reliableRounds",
  "file": "reliable-rounds.jsonl",
  "total": 992,
  "offset": 0,
  "limit": 100,
  "items": [],
  "truncated": false,
  "read": { "durationMs": 3 },
  "source": "split_store"
}
```

`GET /api/modes` is different: `items` is an object, not an array. Frontends that render a table should use `Object.values(data.items)`.

```json
{
  "total": 6,
  "metricDefinitions": {},
  "items": {
    "bedwars": { "id": "bedwars", "label": "BedWars" },
    "the_pit": { "id": "the_pit", "label": "The Pit", "resultEligible": 0 }
  }
}
```

`GET /api/results` returns aggregate result coverage and audit buckets. It is not a paginated round list. Use `/api/rounds?set=reliable&result=unknown&unknownAuditCategory=...` when the UI needs actual rows to review.

### Metric Semantics

These names are intentionally strict. Prefer the public `player*` fields for player-facing cards.

| Metric | Meaning | Frontend guidance |
| --- | --- | --- |
| `kills` / `deaths` | All observed combat events inside the row/mode, including other players when the log saw them | Good for "observed activity" or mode totals, not always personal |
| `selfKills` / `selfDeaths` | Confirmed owner/player kills and deaths | Use for personal K/D when available |
| `playerMaxKillStreak` | Highest confirmed owner/player kill streak | Use for "最高连杀" |
| `observedBroadcastMaxKillStreak` | Highest server-chat streak broadcast seen, often another player | Do not use as a personal metric |
| `maxStreak` | Legacy alias for observed broadcast streak | Deprecated for frontend personal cards |
| `wins` / `losses` | Official result-eligible round results only | The Pit and other activity rows do not affect these |
| `unknownResults` | Result-eligible reliable rounds without a safe official result | Do not count The Pit here |
| `notApplicableResults` | Non-result activity rows such as The Pit | Keep separate from win/loss/unknown |
| `resultEligible` | Whether a row/mode participates in win/loss/unknown rates | Filter or label non-result rows with this |
| `bedDestroys` | All observed bed-break events in a round/mode | Not personal |
| `selfBedDestroys` | Legacy owner/player bed-break count | Keep for compatibility |
| `playerBedDestroys` | Recommended owner/player bed-break count | Use for "本人破床数" |
| `rewardEvents` | Count of parsed reward prompt events | Event count, not gold or XP |
| `goldEarned` / `xpEarned` | Parsed explicit The Pit reward amounts plus owner-bound bounty gold | Useful partial economy counters, not a complete ledger |
| `bountyClaims` / `bountyGoldEarned` | Owner-bound The Pit bounty claims only | Non-owner bounty broadcasts are diagnostic only |

### Recommended Dashboard Cards

For a general overview page:

- Total playtime: `/api/summary.overview.playtime` or `playtimeSeconds`.
- Reliable rounds: `/api/summary.overview.reliableRounds`.
- Wins/losses: `/api/summary.overview.wins` and `losses`.
- Win rate: `/api/summary.overview.winRate`; denominator is known result rounds, not all reliable rounds.
- Unknown rate: compute `unknownResults / resultEligibleRounds`.
- Highest win streak: `/api/profile.streaks.win.breakUnknown.best.count` by default. Offer `skipUnknown` as a user preference if desired.
- Current win streak: `/api/profile.streaks.win.breakUnknown.current.count` by default.
- Highest kill streak: `/api/profile.streaks.playerMaxKillStreak.count`.
- BedWars player bed breaks: `/api/summary.overview.playerBedDestroys` or BedWars row from `/api/modes`.
- The Pit personal kills: `/api/activity?mode=the_pit` `summary.selfKills`, or The Pit row from `/api/modes`.

Avoid these common mistakes:

- Do not show `activity.maxStreak` or `observedBroadcastMaxKillStreak` as "最高连杀"; use `playerMaxKillStreak`.
- Do not show `source` or `scope` as server; use `serverLabel`.
- Do not treat `serverPlayerId` as a server id; it is the in-server player name inferred for owner identity.
- Do not include The Pit `not_applicable` rows in win/loss/unknown result rates.
- Do not label `bedDestroys` as personal bed breaks; use `playerBedDestroys`.
- Do not treat `rewardEvents` as money or XP.

### Frontend Field Map

Recommended dashboard fetch pattern:

1. `GET /api/app/status`; only continue when `setup.state === "ready"`.
2. `GET /api/summary` for aggregate totals.
3. `GET /api/profile` for streaks, extremes, preferences, and profile cards.
4. `GET /api/modes` for mode cards/tables. Remember `items` is a mode-id object.

Common cards:

| Card | Preferred source | Notes |
| --- | --- | --- |
| Total playtime | `/api/summary` `overview.playtime` or `overview.playtimeSeconds` | `playtime` is formatted text; `playtimeSeconds` is numeric |
| Reliable rounds | `/api/summary` `overview.reliableRounds` | Includes result rows plus non-result activity mirrors such as The Pit |
| Wins / losses | `/api/summary` `overview.wins`, `overview.losses` | Only official result-eligible rounds |
| Win rate | `/api/summary` `overview.winRate` | Denominator is known result rounds: `wins + losses` |
| Unknown rate | compute `overview.unknownResults / overview.resultEligibleRounds` | Do not include `notApplicableResults` |
| Highest win streak | `/api/profile` `streaks.win.breakUnknown.best.count` | Default conservative policy: unknown/ambiguous break streak |
| Highest win streak, skip unknown | `/api/profile` `streaks.win.skipUnknown.best.count` | Optional user preference: unknown/ambiguous are skipped |
| Current win streak | `/api/profile` `streaks.win.breakUnknown.current.count` | Use matching policy if the user switches |
| Highest kill streak | `/api/profile` `streaks.playerMaxKillStreak.count` | Confirmed player kill streak only |
| BedWars player bed breaks | `/api/modes` `items.bedwars.playerBedDestroys` | Equivalent to legacy `selfBedDestroys`; not `bedDestroys` |
| The Pit player kills | `/api/modes` `items.the_pit.selfKills` or `/api/activity?mode=the_pit` `summary.selfKills` | `kills` is all observed kills, `selfKills` is player-owned |
| The Pit broadcast streak | `/api/activity?mode=the_pit` `summary.observedBroadcastMaxKillStreak` | Diagnostic label only, not "highest kill streak" |

Mode table conversion:

```js
const modes = await getJson("/api/modes");
const rows = Object.values(modes.items ?? {});
```

Main round list:

```js
const rounds = await getJson("/api/rounds?set=reliable&offset=0&limit=100");
for (const row of rounds.items ?? []) {
  const server = row.serverLabel;
  const result = row.result;
  const beds = row.playerBedDestroys ?? row.selfBedDestroys ?? 0;
  const killStreak = row.playerMaxKillStreak ?? 0;
}
```

The Pit detail page:

```js
const pit = await getJson("/api/activity?mode=the_pit&offset=0&limit=100");
const playerKills = pit.summary?.selfKills ?? 0;
const playerDeaths = pit.summary?.selfDeaths ?? 0;
const playerMaxKillStreak = pit.summary?.playerMaxKillStreak ?? 0;
const observedBroadcastMaxKillStreak = pit.summary?.observedBroadcastMaxKillStreak ?? 0;
```

### Round List Contract

Use `GET /api/rounds?set=reliable&offset=0&limit=100` for the main round list. Each item is already frontend-enriched and includes:

```json
{
  "key": "stable row id",
  "roundKind": "round",
  "gameMode": "bedwars",
  "result": "win",
  "resultEligible": true,
  "startAt": "2022-01-01T00:00:00.000Z",
  "durationSeconds": 300,
  "serverLabel": "Hypixel",
  "serverNetwork": "Hypixel",
  "serverAddress": "mc.hypixel.net",
  "serverConfidence": "direct",
  "serverEvidence": { "source": "server_connect" },
  "kills": 4,
  "selfKills": 2,
  "playerMaxKillStreak": 2,
  "bedDestroys": 3,
  "playerBedDestroys": 1
}
```

The Pit appears in reliable rounds only as mirrored non-result activity:

```json
{
  "roundKind": "activity",
  "gameMode": "the_pit",
  "result": "not_applicable",
  "resultEligible": false
}
```

Show these as activity/history rows only if the UI intentionally mixes continuous activity with rounds. For a dedicated The Pit view, prefer `/api/activity?mode=the_pit`.

### Activity Contract

`GET /api/activity?mode=the_pit&offset=0&limit=100` returns source activity segments. Use:

- `summary.kills` for all observed Pit kills.
- `summary.selfKills` for confirmed player Pit kills.
- `summary.playerMaxKillStreak` for confirmed player max kill streak.
- `summary.observedBroadcastMaxKillStreak` only as "highest observed broadcast streak".
- `summary.goldEarned` / `summary.xpEarned` as partial parsed economy, with caveat text from `metricDefinitions`.

Activity `items[]` include `examples` only when present in the derived report; do not assume examples are complete raw log context.

### Error Handling

All common API errors use:

```json
{
  "ok": false,
  "error": "machine_code",
  "message": "Human-readable message"
}
```

Frontend should branch on `error`, not English text. Important codes:

- `report_not_ready`, `summary_invalid_json`, `report_invalid_schema`
- `store_not_ready`, `store_invalid_manifest`, `store_files_missing`
- `invalid_rounds_query`, `invalid_days_query`, `invalid_pagination`
- `refresh_running`, `refresh_preflight_failed`, `unsafe_refresh_outputs`
- `invalid_json`, `invalid_request_body`, `unsupported_media_type`, `request_too_large`

## Endpoints

- `GET /api/health`: report readiness, schema, paths, and small overview.
- `GET /api/app/status`: first-run/project readiness, app runtime settings such as derived data dirs, launcher contract, and skin proxy networking status, report/store readiness, refresh status, whether a refresh is needed, and `refreshReasons` such as `report_not_ready`, `store_not_ready`, `report_invalid_json`, `summary_invalid_json`, `report_invalid_schema`, `summary_invalid_schema`, `store_invalid_json`, `store_invalid_manifest`, `store_files_missing`, `inputs_changed`, or `store_out_of_sync`. The compatible `setup` object exposes `state` (`first_run`, `needs_refresh`, `refreshing`, `ready`), machine-readable reasons, `recommendedAction`, and `nextActions`. The `recovery.actions` array gives stable recovery action codes such as `configure_roots`, `validate_roots`, `run_refresh`, `wait_for_refresh`, `cancel_refresh`, `cleanup_store_preview`, and `cleanup_derived_preview`.
- `GET /api/config`: effective local app config and the local overlay path that writes are constrained to.
- `PUT /api/config`: save whitelisted local-only config fields (`roots`, owner aliases/display name, `customRules`, project-relative app data dir, skin proxy setting, report/summary output names). Unsupported top-level or nested fields return `400 invalid_config`; writes while refresh is running return `409 refresh_running`. Root paths are validated before saving, including duplicate-root diagnostics. The local overlay target must be a safe `.json` file under the config directory and cannot overwrite the shareable config, Minecraft logs, rule packs, source/docs directories, or package metadata. `customRules` entries must be safe project-relative rule-pack directories or `.json` files, not Minecraft roots, derived data, source/docs directories, or package metadata. `app.dataDir` must be a safe project-relative derived-data directory and cannot target Minecraft roots, config files, rule packs, source/docs directories, or package metadata. Report/summary outputs must be distinct project-relative `.json` paths and cannot target config files, rule packs, source/docs directories, or package metadata.
- `POST /api/config/validate-roots`: validate selected local Minecraft roots. Body: `{ "roots": ["D:\\Games\\Client\\.minecraft"], "encoding": "gb18030" }`. `roots` is required and must be an array of strings; optional `encoding` must be a non-empty TextDecoder-supported encoding label. Malformed or unsupported request fields return `400 invalid_validate_roots_request`.
- `POST /api/system/select-directory`: Windows desktop-only helper for OOBE. Opens a native folder picker on the local machine and returns `{ ok: true, path }`, `{ ok: false, cancelled: true }`, or an explicit unavailable/failure error. Optional body `{ "validate": true, "encoding": "gb18030" }` includes a `validation` object for the selected path so first-run UI can show root diagnostics immediately. The frontend falls back to pasted absolute paths when this helper is unavailable.
- `GET /api/summary`: contents of `report-combined-summary.json`. Corrupt JSON returns `503 summary_invalid_json`; valid JSON with an unsupported summary schema returns `503 summary_invalid_schema`.
- `GET /api/report`: contents of `report-combined.json`. Corrupt JSON returns `503 report_invalid_json`; valid JSON with an unsupported report schema returns `503 report_invalid_schema`.
- `GET /api/profile`: frontend-ready career/profile highlights, including best days, multiplayer/singleplayer day records, streaks, preferences, session/match extremes, BedWars owner bed-break totals, late-night play, and per-ID leaderboards. `profile.streaks.win` exposes both `breakUnknown`/`break_unknown` and `skipUnknown`/`skip_unknown` policies; `unknown` and `ambiguous` break streaks in the conservative policy and are skipped in the alternate policy. `profile.streaks.playerMaxKillStreak.count` is the highest confirmed owner/player kill streak.
- `GET /api/metrics/definitions`: static machine-readable metric definitions. This endpoint is available even before report/store data is ready; use it for frontend labels, tooltips, and safeguards against confusing player-owned metrics with observed server-chat values.
- `metricDefinitions`: `/api/summary`, `/api/profile`, `/api/activity`, `/api/modes`, and the split store `metric-definitions.json` also include machine-readable metric definitions. Use them to distinguish player-owned metrics such as `playerMaxKillStreak` and `playerBedDestroys` from observed server-chat metrics such as `observedBroadcastMaxKillStreak`, explicit activity economy metrics such as `goldEarned` / `xpEarned`, and non-result activity rows such as The Pit `notApplicableResults`.
- `GET /api/activity?mode=the_pit&offset=0&limit=100`: continuous-mode activity source segments such as The Pit. These source segments are not win/loss rounds; The Pit is also mirrored into reliable `/api/rounds` rows as `result: "not_applicable"` and `resultEligible: false` so K/D and mode totals include it without changing result coverage. Activity rows expose `playerMaxKillStreak` for confirmed owner/player kills and `observedBroadcastMaxKillStreak` for server chat streak broadcasts; legacy `maxStreak` is the broadcast value and should not be shown as a personal metric. `rewardEvents` counts explicit activity reward prompts such as The Pit kill/assist rewards, gold pickups, free XP, death-streak rewards, or streak-point awards; it is an event count, not a gold/XP amount. `goldEarned` and `xpEarned` sum only explicit The Pit player reward amounts parsed from chat, so they are useful activity economy counters but not a complete economy ledger. Owner-bound The Pit `BOUNTY CLAIMED` broadcasts increment `bountyClaims`, `bountyGoldEarned`, and `goldEarned`; bounties created on a player, bounty bumps, prestige notices, and temporary event notices remain diagnostic-only unless they are separately owner-bound.
- `GET /api/rounds?set=reliable|ignored|all&mode=bedwars&result=unknown&resultHint=probably_loss&resultHintReason=self%20death%20followed%20by%20leaving%20boundary&unknownAuditCategory=bedwars_no_safe_result_evidence&unknownNextAction=label_sample&unknownReviewPriority=high&source=Neon&scope=1.8.9_legit&dateFrom=2022-01-01&dateTo=2022-12-31&minDuration=60&maxDuration=1200&hasKnownResult=false&offset=0&limit=100`: paginated round rows with optional filters. Every item includes `playerMaxKillStreak` plus stable server display fields: `serverNetwork`, `serverAddress`, `serverLabel`, `serverConfidence`, and `serverEvidence`. BedWars rows expose `bedDestroys` for all observed bed-break events, legacy `selfBedDestroys` for owner/player bed breaks, and recommended `playerBedDestroys` with the same owner/player value for frontend display. Frontends should show `serverLabel` instead of treating `source` or `scope` as the server. Direct known domains such as Hypixel and NetEase/HYT are labeled directly; known HuaYuTing hosts such as `59.111.137.99`, `169.254.233.196`, `mc.aisu.site`, and `hytpc.mc.netease.com` use `serverNetwork: "NetEase"` with `serverLabel: "花雨庭"`. `42.186.61.162` displays as `粘土云`, `42.186.64.241` as `小蜜蜂`, `a.polars.cc` as `HmXix`, Remiaft hosts as `Remiaft`, and `mcyc` hosts as `游戏世界`. Hypixel accelerator hosts containing `hyp` are labeled as `Hypixel`. Hosts or scopes with `test`/`testserver` are excluded from reliable round totals with `ignoredReason: "test_server"`; known `testserver.loyisa.cn` entries display as `Loyisa's Test Server`, and `mc32.rhymc.com` displays as `反作弊测试服务器` while also being ignored as `test_server`. Local proxy/private IP addresses keep the proxy value in `serverAddress`, but when same-segment rule events or chat text identify the real server, `serverLabel` and `serverNetwork` are inferred from that log evidence with `serverConfidence: "inferred"` and `serverEvidence.source` of `chat_template` or `chat_text`; otherwise they remain `serverNetwork: null` with `serverLabel: "本地代理 / 未知服务器"`. `resultHintReason` filters by the diagnostic `round.resultHint.reason` string; `unknownAuditCategory`, `unknownNextAction`, and `unknownReviewPriority=high|medium|low` filter reliable unknown audit queues. Malformed date, duration, known-result, or unknown-audit filter values return `400 invalid_rounds_query`.
- `GET /api/modes`: game mode totals from reliable rounds. BedWars mode totals include `playerBedDestroys`, the owner/player bed-break count, alongside legacy `selfBedDestroys` and all-event `bedDestroys`. Continuous activity modes such as The Pit can appear here only as non-result rows with `notApplicableResults` and `resultEligible: 0`.
- `GET /api/results`: result coverage, win/loss signal counts, unknown-result hints, privacy-safe `unknownAudit` queues (`byCategory`, `byNextAction`, `byPriority`, `examples`), and debug examples. Unknown audit is diagnostic only and does not change `round.result`, `ignoredReason`, round splitting, or win/loss totals.
- `GET /api/unknown-audit/label-sets`, `POST /api/unknown-audit/label-sets`, `GET|PUT|DELETE /api/unknown-audit/label-sets/{id}`: local derived review drafts for frontend/manual labeling progress. Label sets validate the same `keep-unknown|win|loss|ignore|new-rule-needed` rows as `/api/unknown-audit/labels`, return readiness summaries, and never write report/store/config/rules or raw logs.
- `GET /api/result-candidates?category=explicit_win&mode=bedwars&offset=0&limit=50`: mined candidate chat lines for improving result rules.
- `GET /api/skin?kind=player|uuid|url|auto&source=Steve`: same-origin PNG proxy for the 3D skin viewer. `source` can be a player name, UUID, or HTTPS PNG URL. Set `app.skinProxyEnabled: false` in local config to disable remote skin requests.
- `GET /api/minecraft-profile?username=Steve`: same-origin proxy for official Minecraft profile lookup. It uses Minecraft Services plus Mojang session textures and returns the canonical player name, UUID, skin URL, cape URL when present, and skin model for the frontend profile/avatar picker. Set `app.skinProxyEnabled: false` in local config to disable remote profile and skin requests.
- `GET /api/refresh`: refresh job status, including phase (`idle`, `scan`, `parse`, `build_report`, `export_store`, `commit`, `done`, `failed`, `cancelled`, `cancelling`), status (`idle`, `running`, `succeeded`, `failed`, `cancelled`), progress, `currentFile`, file counts, total duration, per-phase `phaseTimings` / `phaseDurationsMs`, privacy-safe `diagnostics` for discovery/scan/chat-line/chat-event cache behavior, failure phase, error category, cancellation state, and log tail.
- `POST /api/refresh/preflight`: validate roots, rule-pack health, refresh write targets, and current app status without starting a refresh. Returns `canRefresh`, blocking issues, warnings, and a recommended action. `POST /api/refresh` runs the same preflight and returns `400 refresh_preflight_failed` when blocking issues exist.
- `POST /api/refresh`: start one background report refresh followed by split-store export. New report/store outputs are staged first and committed only after both phases succeed. Refresh write targets are validated before the child process starts and commit targets are revalidated before replacing old derived data. Split-store export failures are reported as `store_export_failed` and leave old derived data in place. Returns `400 unsafe_refresh_outputs` for unsafe manually edited output/data-dir config, or `409` if one is already running.
- `POST /api/refresh/cancel`: request cancellation of the current refresh job. Existing report/store files are left in place when cancellation happens during report build or split-store export, staged outputs are cleaned, and refresh history records a `cancelled` job.
- `GET /api/refresh/history`: last 50 completed refresh jobs, stored under `.cache/refresh-history.json`, with summary counts, latest job, total and per-phase durations, privacy-safe parser diagnostics, average phase durations, failure phase, and error category. If this derived history file is missing, malformed, or unreadable, the endpoint still returns `200` with empty `items` and a `warning` code such as `refresh_history_invalid_json`; the next refresh can regenerate the file.
- `GET /api/performance`: lightweight local performance baseline from refresh history, split-store metadata, current store read baseline, recent store table read metrics, derived cache file stats, process JSON API cache stats, and saved-baseline comparison. It includes successful-refresh sample size, average duration, per-phase stats, current slowest average phase, store file sizes, JSONL table row counts, sampled JSONL page-read latency, cache presence/bytes, `refreshDiagnostics`, output timestamp consistency, `apiCache` hit/miss/invalidations by safe file kind, and `comparison` against `artifacts/performance-baseline-current.json` when present. It does not scan logs or expose raw local paths, and it reports refresh/current-history status without raw `currentFile`, raw `error`, `log`, or `logTail` fields. If refresh history or saved baseline data is missing/corrupt, the response keeps store/cache/apiCache stats and reports a warning instead of failing. The `recommendations` array gives machine-readable next actions such as `collect_refresh_baseline`, `repair_refresh_history`, `refresh_needed`, `store_not_ready`, `warm_missing_caches`, `investigate_refresh_bottleneck`, `review_split_store_limits`, `review_store_table_read_latency`, or `jsonl_store_ok`; `refresh_needed` includes `store_out_of_sync` when report and split store timestamps do not match.
- `POST /api/data/cleanup`: remove derived data only. Body: `{ "scope": "cache|report|store|all_derived", "dryRun": false }`. Omit `scope` to use the safe default `cache`. If provided, `scope` must be one of the allowed strings; malformed scope fields return `400 invalid_cleanup_scope`. With `dryRun: true`, the response returns `planned` and `skipped` targets without deleting anything. Cleanup returns `409 refresh_running` while a refresh job is active. Each target is revalidated before deletion; Minecraft log roots, config files, rule packs, source/docs directories, and package metadata are never removed.
- `GET /api/diagnostics?full=false`: privacy-safe doctor output by default, including setup state, refresh-needed reasons, report/summary schema readiness, store readiness details such as `outputs.store.missingFiles`, and refresh progress without exposing full paths, active `currentFile`, raw refresh errors, or refresh log lines. The response includes a `privacyAudit`; audit failures return `500 privacy_audit_failed` without the diagnostics content. Use `full=true` only from a trusted local UI to include full local paths and refresh debug fields. Malformed boolean query values return `400 invalid_boolean_query`.
- `GET /api/diagnostics/package?full=false`: privacy-safe troubleshooting bundle with app status, diagnostics, refresh history, performance baseline, and rule-pack validation. It includes `manifest` and `privacyAudit` sections, and does not include raw Minecraft logs, raw chat, full reports, store rows, refresh log lines/tails, raw refresh error text, or raw `currentFile` values. Refresh history keeps `errorCategory`, `hasCurrentFile`, `hasError`, `logLines`, and `logTailLines` summary fields for troubleshooting. Use `full=true` only for local debugging when full paths and refresh logs are acceptable. Malformed boolean query values return `400 invalid_boolean_query`; privacy-safe audit failures, including failures from the embedded diagnostics payload, return `500 privacy_audit_failed` without the package content.
- `GET /api/share/package?identities=true`: privacy-safe aggregate stats package for sharing. It includes `manifest` and `privacyAudit` sections, excludes raw logs, raw chat, local paths, local usernames, UUIDs, and full report/store rows, and anonymizes identity rows. Malformed boolean query values return `400 invalid_boolean_query`; privacy audit failures return `500 privacy_audit_failed` without the package content.
- `GET /api/accounts`: owner and raw local username stats.
- `GET /api/accounts/playtime?source=Neon&user=Prisma1337&offset=0&limit=100`: local ID playtime ranking.
- `GET /api/accounts/owner`: aggregate owner account.
- `GET /api/accounts/<name>`: one raw local username.
- `GET /api/sources?offset=0&limit=100`: source/client groups.
- `GET /api/scopes?source=Neon&offset=0&limit=100`: version/scope groups.
- `GET /api/days?dateFrom=2022-01-01&dateTo=2022-12-31&offset=0&limit=100`: daily rows. Malformed or reversed date filters return `400 invalid_days_query`.
- `GET /api/rules`: rule coverage, cache stats, unmatched category counts, physical rule-pack counts (`byRulePack`, `byRulePackId`), and diagnostic `quality` summary for the enabled rule sets. Bundled rules are physically split by mode while legacy `game-state` compatibility remains available through `ruleSet`; use `rulePack` for the actual pack that matched. `quality` includes hit/zero-hit counts by `byRuleSet` and `byRulePack`, exact duplicate-pattern groups, risk groups (`safe_result`, `boundary_only`, `diagnostic_only`, `experimental`), and samples for top-hit, zero-hit, result-impact, and boundary-impact rules. This is diagnostic only and does not change statistics.
- `POST /api/rules/test`: test one chat message against configured rules. Body: `{ "message": "VICTORY!" }`. Optional `ruleSets` must be known rule set ids, and optional `customRulePaths` entries use the same safe project-relative rule-pack path policy as config writes.
- `POST /api/rules/draft`: generate a first-pass custom rule from one chat message. Body: `{ "message": "...", "type": "win", "gameMode": "bedwars" }`.
- `POST /api/unknown-audit/labels`: validate and summarize reviewed `unknownAudit` label rows without writing report, store, config, or rules. Body accepts `{ "labels": [...] }` or `{ "rows": [...] }`; accepted labels are `keep-unknown`, `win`, `loss`, `ignore`, and `new-rule-needed`. By default, rows with `roundRef` are checked against the current reliable unknown queue so stale exports fail before rule drafting. The response includes `status`, `readyForWorkflow`, `workflowRecommended`, `readiness`, `byLabel`, `byCategory`, `byNextAction`, `candidates`, `missingRuleTextRows`, stale refs, samples, and workflow hints. `status` is one of `invalid_labels`, `empty_queue`, `needs_labeling`, `needs_rule_text`, `ready_for_workflow`, or `ready_keep_unknown_only`. `readiness` also includes machine-readable workflow controls: `nextStep`, `blocked`, `blockingReason`, `requiresHumanInput`, `canDraftRules`, `canRunDryRun`, `canArchive`, and `nextCommand`. `candidates.missingRuleTextRows` counts `win`/`loss`/`ignore` labels that still need an exact `message`/`text` field before a draft rule can be generated.
- `POST /api/unknown-audit/status`: thin readiness check for reviewed unknown-audit rows. It uses the same request body as `/api/unknown-audit/labels` but returns only the next-step status, counters, and workflow controls, making it a lighter preflight check before draft generation or dry-run.
- `POST /api/rules/draft-from-labels`: generate a draft rule pack from reviewed label rows. Accepted review labels are `keep-unknown`, `win`, `loss`, `ignore`, and `new-rule-needed`; unsupported labels return `400 invalid_label_rows`. By default, rows with `roundRef` are checked against the current report's reliable unknown queue so stale audit exports are rejected before drafting. Send `validateRoundRefs: false` only for local migration/debug cases. Drafts must be validated and dry-run before enabling.
- `POST /api/rules/audit-workflow`: validate reviewed labels, generate a draft rule pack, and unless `skipDryRun: true`, preview it with the dry-run `promotionGate` in one request. It does not write report, store, config, or user rule-pack files; dry-run may write isolated preview caches under derived data. `workflow.status` can be `invalid_labels`, `invalid_draft`, `missing_rule_text`, `no_draftable_rules`, `draft_ready`, `dry_run_pass`, or `dry_run_review`; `missing_rule_text` means reviewed win/loss/ignore rows need exact message text before rule drafting. CLI/local artifact mode also returns `artifactSummary` with project-relative or filename-only paths and `privacy: "local_paths_redacted"`.
- `POST /api/rules/validate`: validate one inline custom rule pack JSON object.
- `GET /api/rules/doctor`: rule pack lifecycle and quality diagnostics, including duplicate ids, duplicate patterns, invalid packs, broad result/boundary rules, empty packs, and user packs that exist but are not enabled.
- `GET /api/rules/audit`: recent privacy-safe rule lifecycle audit entries for user-pack save/delete/enable/restore and rule dry-run operations. This is derived diagnostic data and can be removed by `all_derived` cleanup.
- `POST /api/rules/dry-run`: preview inline or user rule pack changes without writing report, store, config, or official cache files. The response compares current report results with the candidate run, flags risks such as ambiguous result increases or The Pit becoming result-eligible, and includes `promotionGate` for audit review. Send optional `targetMode` such as `"bedwars"` so the gate can separate target unknown deltas from non-target mode changes. By default it is privacy-safe: samples use redacted round ids and cache paths are omitted. Send `full: true` only from local debugging UI/CLI when full paths and sample line references are acceptable. Dry-run may write isolated preview caches under the derived data dir.
- `GET /api/rule-packs`: bundled, configured, and project-managed user rule pack metadata, including source, enabled state, validation state, rule count, modified time when available, and warning summaries. Bundled packs include shared `game-state`, mode packs such as `bedwars`, `skywars`, `duels`, `mega_walls`, `mini_walls`, `the_pit`, and `minecraft-combat`. Bad configured custom packs return `400 invalid_rule_pack_config`.
- `GET /api/rule-packs/validate`: validate configured custom rule packs. Bad configured custom packs return `400 invalid_rule_pack_config`.
- `GET /api/rule-packs/user`: list rule packs saved in the project-managed `custom-rules/user` directory.
- `POST /api/rule-packs/user`: validate and save one rule pack into `custom-rules/user/<id>.json`. Overwriting an existing pack creates a derived-data backup first. Managed ids must match `^[a-z0-9][a-z0-9_-]{0,79}$`; the endpoint never writes to arbitrary user-provided paths. Writes while refresh is running return `409 refresh_running`.
- `POST /api/rule-packs/user/enable`: enable or disable one project-managed user rule pack by updating local `customRules`. Refresh is required before statistics change.
- `POST /api/rule-packs/user/backups`: list derived-data backups for one user rule pack or all user rule packs.
- `POST /api/rule-packs/user/restore`: restore one user rule pack from a backup; the current file is backed up before replacement.
- `GET /api/rule-packs/user/<id>`: read one project-managed user rule pack, including validation errors if the file is malformed.
- `DELETE /api/rule-packs/user/<id>`: delete one project-managed user rule pack. The id is resolved through the same safe filename mapping as save. Deletes while refresh is running return `409 refresh_running`.
- `GET /api/timeseries?period=day|week|month`: time series rows.
- `GET /api/unmatched`: `unmatched-debug.json` when present, otherwise the unmatched section from the report.
- `GET /api/store`: report store manifest. Returns `503 store_not_ready` when the split store has not been generated or was cleaned, `503 store_invalid_json` when the manifest is corrupt JSON, and `503 store_invalid_manifest` when the manifest JSON shape is unsupported.
- `GET /api/store/table?name=reliableRounds&offset=0&limit=100`: paginated rows from a JSONL table declared by the split report store manifest. Only manifest-declared `.jsonl` tables are allowed; missing store data returns `503 store_not_ready`, malformed store manifests return `503 store_invalid_manifest`, missing declared tables return `503 store_table_not_ready`, and corrupt table JSONL returns `503 store_table_invalid_jsonl`. When manifest counts are available, the reader stops after the requested page and reports `read.durationMs` / `read.scannedLines`; recent reads feed `/api/performance.storeReads`.

## Rule Editor Draft Flow

1. Send a raw chat line to `POST /api/rules/test` to see whether current rules already classify it.
2. If it is unmatched, send the same line to `POST /api/rules/draft` with the desired `type`.
3. Review the generated regex manually, then validate a full rule pack through `POST /api/rules/validate`.
4. Save reviewed rules with `POST /api/rule-packs/user`, or place them in another custom rule pack path configured in `minecraft-log-resolver.config.json`.
5. Inspect or remove project-managed packs with `GET` or `DELETE /api/rule-packs/user/<id>`.

The write endpoint is deliberately constrained to `custom-rules/user`. Add `custom-rules/user` or an individual saved file to `customRules` before a report refresh if you want saved rules loaded by default.
Configured custom rule packs are cached by file content hash, so editing or saving a project-managed pack is visible to rule test/list endpoints without restarting the API process.

## Notes

- CORS is open for local frontend development. In production mode (`NODE_ENV=production` or `MLO_API_ENV=production`), CORS only allows a local frontend origin: by default `http://127.0.0.1:5173`, or `MLO_API_CORS_ORIGIN` when it is an HTTP origin on `127.0.0.1`, `localhost`, or `::1`. Remote origins are ignored.
- JSON error responses use a common envelope with `ok: false`, `error`, and `message`, plus endpoint-specific context such as `allowed`, `errors`, or `refresh`.
- Local static-server proxy failures also use the same envelope shape with `502 api_proxy_failed`.
- Paginated read endpoints reject malformed or out-of-range `offset`/`limit` values with `400 invalid_pagination`; they do not silently clamp invalid pagination requests.
- The local static server rejects malformed static paths with `400` and path traversal outside the project root with `403`.
- Write requests with bodies must send `Content-Type: application/json` or another `+json` media type. Malformed JSON returns `400 invalid_json`; valid JSON that is not an object returns `400 invalid_request_body`; missing/non-JSON content types return `415 unsupported_media_type`; oversized bodies return `413 request_too_large`.
- The API process refuses non-local bind hosts and only supports a single local user/workspace.
- The local static server reads `.cache/api-server.json` when `API_TARGET` is not set, so it can follow the API if the API had to choose a fallback port. It only trusts state with `status: "running"`, a local HTTP URL, and a successful lightweight `/api/refresh` probe; stopped, stale, corrupt, or remote state falls back to `http://127.0.0.1:8787`. The API process writes a versioned state file (`schema.name: minecraft-log-observatory-api-server-state`, `contractVersion: 1`) with host, port, URL, PID, local-only policy, useful endpoint paths, and shutdown capabilities. During graceful shutdown by `SIGINT`, `SIGTERM`, or an IPC `{ "type": "shutdown" }` / `{ "type": "mlo_shutdown" }` message from a launcher, it best-effort rewrites the same state file with `status: "stopped"`, `stoppedAt`, and `signal`.
- Paths and output names come from merged config: `minecraft-log-resolver.config.json` plus optional local `minecraft-log-resolver.local.json`; API-written local config overlays and report/summary output names are constrained to safe local targets only.
- App status compares report input signatures against the current roots, selected rules, owner aliases, bundled rule file hashes, and custom rule file hashes so app/rule updates or edited custom rule packs can trigger `needsRefresh`.
- After `POST /api/data/cleanup`, use `GET /api/app/status` to confirm `refreshReasons`, then `POST /api/refresh` to regenerate report and store outputs from the original read-only logs.
- Querying before `npm run report` returns `503 report_not_ready`.
- A machine-readable draft contract lives at `docs/openapi.json`.
