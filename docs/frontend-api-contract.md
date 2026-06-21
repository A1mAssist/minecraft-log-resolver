# Frontend API Contract

This is the short contract for frontend integration. The full catalog remains in `docs/api.md`; this file lists the fields most likely to be wired incorrectly.

## Startup

1. `GET /api/app/status`
2. If `setup.state === "first_run"`, select and validate log roots.
3. Save roots with `PUT /api/config`.
4. If `setup.state === "needs_refresh"`, start `POST /api/refresh`.
5. Poll `GET /api/refresh` while `setup.state === "refreshing"`.
6. Load dashboard data only when `setup.state === "ready"`.

Do not infer setup state from empty reports, missing cards, source names, or local paths.

## Dashboard Sources

| UI | Endpoint | Notes |
| --- | --- | --- |
| Overview cards | `GET /api/summary` | Use `overview` and `metricDefinitions`. |
| Career/profile cards | `GET /api/profile` | Use streaks, extremes, preferences, and totals. |
| Mode table/cards | `GET /api/modes` | `items` is an object keyed by mode id; use `Object.values(items)`. |
| Round list | `GET /api/rounds?set=reliable&offset=0&limit=100` | Top-level pagination fields; each item is enriched for display. |
| Large table page | `GET /api/store/table?name=reliableRounds` | Prefer for very large unfiltered lists. |
| The Pit detail | `GET /api/activity?mode=the_pit` | Source activity segments, not win/loss rounds. |
| Unknown review | `GET /api/results` and filtered `GET /api/rounds` | Results gives buckets; rounds gives rows. |
| Metric labels/tooltips | `GET /api/metrics/definitions` | Use to distinguish player-owned vs observed metrics. |

## Metric Rules

Use these for personal cards:

- Highest kill streak: `/api/profile.streaks.playerMaxKillStreak.count`
- Highest win streak default: `/api/profile.streaks.win.breakUnknown.best.count`
- Current win streak default: `/api/profile.streaks.win.breakUnknown.current.count`
- Optional win streak policy: `skipUnknown` if the user chooses unknown/ambiguous should not break streaks.
- Personal BedWars bed breaks: `playerBedDestroys`
- Personal kills/deaths when available: `selfKills` / `selfDeaths`

Avoid these mistakes:

- Do not show `activity.maxStreak` as personal highest kill streak. It is deprecated and aliases observed broadcast streaks.
- Do not show `observedBroadcastMaxKillStreak` as a personal metric.
- Do not show `source` or `scope` as server; use `serverLabel`.
- Do not treat `serverPlayerId` as a server id. It is the owner/player name on that server.
- Do not include `result: "not_applicable"` rows in win/loss/unknown rates.
- Do not label `bedDestroys` as personal bed breaks; use `playerBedDestroys`.
- Do not treat `rewardEvents` as gold or XP.

## Round Rows

`GET /api/rounds` returns:

```json
{
  "total": 992,
  "offset": 0,
  "limit": 100,
  "items": [
    {
      "key": "stable row id",
      "roundKind": "match",
      "gameMode": "bedwars",
      "result": "win",
      "resultEligible": true,
      "serverLabel": "Hypixel",
      "serverNetwork": "Hypixel",
      "serverAddress": "mc.hypixel.net",
      "serverConfidence": "direct",
      "serverEvidence": { "source": "server_connect" },
      "playerMaxKillStreak": 2,
      "bedDestroys": 3,
      "selfBedDestroys": 1,
      "playerBedDestroys": 1
    }
  ]
}
```

Server display fields are stable:

- `serverLabel`: primary UI label.
- `serverNetwork`: normalized known network or `null`.
- `serverAddress`: direct host/address when present.
- `serverConfidence`: `direct`, `inferred`, or `unknown`.
- `serverEvidence`: why the backend chose that label.

The Pit can appear in reliable round rows only as non-result activity:

```json
{
  "roundKind": "activity",
  "gameMode": "the_pit",
  "result": "not_applicable",
  "resultEligible": false
}
```

## Unknown Audit UI

Read aggregate queues:

```http
GET /api/results
```

Read rows for a bucket:

```http
GET /api/rounds?set=reliable&result=unknown&unknownAuditCategory=bedwars_no_safe_result_evidence&limit=100
```

Allowed review labels:

- `keep-unknown`
- `win`
- `loss`
- `ignore`
- `new-rule-needed`

Save frontend/manual labeling progress locally:

```http
POST /api/unknown-audit/label-sets
```

```json
{
  "id": "bedwars-review",
  "title": "BedWars review",
  "source": { "auditExport": "unknown-audit-bedwars-current", "mode": "bedwars" },
  "rows": [
    {
      "roundRef": "c81d84acf5954be5",
      "reviewLabel": "loss",
      "reviewNotes": "owner identity confirmed",
      "message": "exact chat text only when drafting a rule"
    }
  ]
}
```

Label set APIs:

- `GET /api/unknown-audit/label-sets`
- `POST /api/unknown-audit/label-sets`
- `GET /api/unknown-audit/label-sets/{id}`
- `PUT /api/unknown-audit/label-sets/{id}`
- `DELETE /api/unknown-audit/label-sets/{id}`

Label sets are local derived review drafts. They do not write report/store/config/rules and do not change official statistics.

Validate current labels:

```http
POST /api/unknown-audit/status
POST /api/unknown-audit/labels
```

When `status === "ready_for_workflow"`, preview rule impact:

```http
POST /api/rules/audit-workflow
```

Only after reviewing dry-run risks should a frontend allow saving/enabling a user rule pack through the rule-pack APIs.

## Rule Management UI

Use:

- `GET /api/rule-packs`
- `GET /api/rule-packs/user`
- `POST /api/rule-packs/user`
- `GET /api/rule-packs/user/{id}`
- `DELETE /api/rule-packs/user/{id}`
- `POST /api/rule-packs/user/enable`
- `POST /api/rule-packs/user/backups`
- `POST /api/rule-packs/user/restore`
- `GET /api/rules/doctor`
- `POST /api/rules/dry-run`
- `GET /api/rules/audit`

Bundled rule packs are read-only through the API. User rule pack changes require refresh before official report statistics change.

## Error Handling

Common write/read failures use:

```json
{
  "ok": false,
  "error": "invalid_rounds_query",
  "message": "Round filter query parameters are invalid."
}
```

Frontend should branch on `error`, not on English `message`.
