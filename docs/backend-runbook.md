# Backend Runbook

## Release Verification Checklist

Use this checklist before handing the backend to frontend work, another maintainer, or a local build/package step.

Current authoritative baseline:
- Read `docs/backend-status.md` first. It records the current report/store/performance timestamps, result totals, unknown-audit counts, and safest next work.
- Raw Minecraft logs remain read-only. Do not include raw logs, local config, full reports, split store rows, or context review exports in a shareable package.

Derived data checks:
- `npm.cmd run release:notes -- --out artifacts/release-boundary-draft.md`
- `npm.cmd run refresh:local`
- `npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current`
- `npm.cmd run result:audit -- --mode bedwars --priority high --include-context --review-packet --label-template --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review --before-ms 0 --after-ms 120000 --context-lines 80`
- `npm.cmd run activity:review -- --mode the_pit --prefix activity-review-the-pit-current`
- `npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl`

Automated verification:
- Fast backend contract pass: `npm.cmd run test:api && npm.cmd run test:api-server && npm.cmd run test:doctor && npm.cmd run test:store && npm.cmd run test:openapi`
- Backend-only regression: `npm.cmd run test:backend`
- Release gate: `npm.cmd run test:release-check`
- Current artifact gate: `npm.cmd run release:check`; output is privacy-safe by default. Use `-- --full` only for local debugging when full paths are needed.
- Full regression: `npm.cmd test`

Deferred until frontend/product shell work resumes:
- Local desktop bundle smoke tests: `npm.cmd run test:local-desktop-build && npm.cmd run test:local-desktop-runtime`
- Native installer or desktop-shell wrapping.

Current acceptance gates:
- `ambiguousResults === 0`.
- The Pit remains non-result activity only: `resultEligible === 0`, `notApplicableResults === rounds`, and `unknownResults === 0` for `the_pit`.
- Unknown-audit export is diagnostic-only: generating JSON/JSONL/CSV/review packet/label template does not write report, store, config, or rules.
- Reviewed labels must pass `result:audit-labels` before draft generation.
- Any candidate rule must pass dry-run review before enable/refresh. Promotion requires no ambiguous-result increase, no target-mode unknown increase, no unexpected non-target result shifts, and no The Pit result eligibility.
- `/api/performance.recommendations` should stay `jsonl_store_ok`; only investigate SQLite when the recommendation reports split-store size/read-latency pressure.

Local bundle:
- `npm.cmd run build:local-desktop` writes `dist/local-desktop`.
- `npm.cmd run build:local-desktop -- --embed-node current` also copies the current Node runtime to `runtime/node/node.exe`; generated launchers prefer that runtime before falling back to `node` on `PATH`.
- The bundle contains source, scripts, rules, docs, config examples, and launchers.
- It intentionally excludes `.cache`, `data`, `artifacts`, `exports`, `labeling`, `node_modules`, and raw Minecraft logs.
- A native installer wrapper is deferred until frontend/product shell work resumes.

## Rule Ecosystem Runbook

The rule ecosystem is intentionally conservative. Bundled rules are maintained by the project, while user packs live under `custom-rules/user` and can be enabled through local config only.

Core lifecycle:
- Inspect packs with `GET /api/rule-packs` or `npm.cmd run rules:doctor -- --json`.
- Save managed packs with `POST /api/rule-packs/user`; overwrites create derived-data backups before replacing the file.
- Toggle managed packs with `POST /api/rule-packs/user/enable`; statistics do not change until a refresh runs.
- List or restore backups with `POST /api/rule-packs/user/backups` and `POST /api/rule-packs/user/restore`.

Dry-run before promotion:
- Use `POST /api/rules/dry-run` or `npm.cmd run rules:dry-run -- --rule-pack <id-or-path> --out artifacts/rules-dry-run.json`.
- Pass `targetMode` in the API body or CLI `--target-mode <mode>` when auditing a mode-specific rule change.
- Dry-run never writes report, store, config, or official cache files.
- It may write isolated preview caches under the configured derived data directory.
- The default API response is privacy-safe; use `full: true` or CLI `--full` only for local debugging with full paths/sample line refs.
- Accept a rule change only when `promotionGate.status` is `pass`, or when `review` warnings are explicitly accepted after confirming `ambiguousResults` stays `0`, target-mode unknowns do not increase, non-target modes do not show unexpected result changes, and The Pit remains non-result activity (`result: "not_applicable"`, `resultEligible: false`) if present in `rounds.summary.gameModes`.

Audit-to-rule flow:
- Export review samples, label rows as `keep-unknown`, `win`, `loss`, `ignore`, or `new-rule-needed`.
- The current `result:audit` export is a schema-v2 review work queue with allowed labels, suggested label hints, and blank review fields; treat it as the starting file for manual review rather than a final diagnostic snapshot.
- Default `result:audit` output is privacy-safe and does not include raw chat context. Use `npm.cmd run result:audit -- --mode bedwars --priority high --include-context --before-ms 0 --after-ms 120000 --context-lines 80 --review-packet --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review` only for local manual review; that opt-in mode reads the chat-line cache/log roots, adds `contextLines` with cleaned local chat text plus matched rule metadata, and writes a human-readable `.review.md` packet next to the JSON/JSONL/CSV files.
- `--display-encoding` is review-only. It re-reads selected context lines for display and may add `displayText` when the configured parser encoding produced mojibake; it does not change parsing, rules, report/store output, or official statistics.
- Add `--label-template` when you want a compact `<prefix>.labels.jsonl` file for manual or frontend labeling. It preserves `roundRef`, audit priority/reason, owner/team/stat summaries, blank `reviewLabel` / `reviewNotes`, and a short context summary; validate it with `result:audit-labels` before drafting rules.
- Frontends can persist in-progress manual labels with `GET/POST /api/unknown-audit/label-sets` and `GET|PUT|DELETE /api/unknown-audit/label-sets/{id}`. These local label sets live in derived app data, validate rows against the current report when requested, and do not write report, store, config, rules, or raw logs.
- Use `npm.cmd run result:audit-status -- --input <reviewed.jsonl|csv>` to check whether a reviewed file still needs labels, needs exact rule text, is ready for the combined workflow, or should simply be archived as keep-unknown evidence.
- Validate reviewed rows with `POST /api/unknown-audit/labels` or `npm.cmd run result:audit-labels -- --input <reviewed.jsonl|csv>` before drafting.
- Generate draft packs with `POST /api/rules/draft-from-labels` or `npm.cmd run rules:draft-from-labels`.
- Or run the combined local preview with `POST /api/rules/audit-workflow` or `npm.cmd run rules:audit-workflow -- --input <reviewed.jsonl|csv> --target-mode bedwars`; this validates labels, writes a draft artifact, and dry-runs the candidate without enabling rules.
- Keep medium/low confidence rules in user packs until repeated dry-runs and negative examples prove they are safe enough for bundled promotion.

Activity review flow:
- Use `npm.cmd run activity:review -- --mode the_pit --prefix activity-review-the-pit-current` to export continuous-mode activity segments for manual review.
- The export reads only the current report and writes JSON/JSONL/CSV under `labeling/`; it does not scan raw logs and does not write report, store, config, or rules.
- Default output omits local `filePath` and raw `examples` messages. It keeps segment summaries, server display fields, owner-id confidence summaries, player kill streak, observed broadcast streak, reward/economy counters, and diagnostic rule ids.
- Add `--has-reward`, `--has-diagnostic`, or `--has-owner-id` to focus The Pit economy/diagnostic/identity review queues.
- Add `--include-examples` only for local manual review. It includes example messages already stored in the derived report, so treat that output as local-only.

Rule quality baseline flow:
- Inspect current quality through `GET /api/rules` or `report.rules.quality`.
- Use `npm.cmd run rules:quality-baseline` after a refresh to write `artifacts/rule-quality-baseline-current.json`.
- The previous current baseline is archived under `artifacts/rule-quality-history` unless `-- --no-history` is passed.
- Use `-- --previous <path>` to compare against a specific archived baseline.
- Treat increases in `zeroHitRules`, `duplicatePatterns`, or `experimental` risk rules as review prompts before promoting a rule pack.

Performance baseline flow:
- Use `GET /api/performance` for current refresh/store/cache status plus comparison against `artifacts/performance-baseline-current.json` when it exists.
- Use `npm.cmd run performance:baseline` to write the current privacy-safe baseline; the previous current file is archived under `artifacts/performance-history`.
- Treat comparison regressions as investigation prompts, not automatic SQLite triggers.

这份 runbook 面向本地离线交付和后端接手。前端可以只依赖 API；后端负责配置、日志读取、刷新 job、派生数据、诊断和隐私边界。

## 交付形态

- 单机单用户、本地离线工具。
- 后端是 dependency-free Node.js ESM HTTP API。
- 默认只绑定 `127.0.0.1`，不做 SaaS、账号、多租户或云上传。
- 原始 Minecraft 日志只读；report、cache、store、history 都是可删除重建的派生数据。
- 默认数据层是 JSON/JSONL。只有 `/api/performance` 显示 split store 规模或延迟需要复查时，才评估 SQLite。

## 第一次启动

1. 准备 Node.js 和 npm。
2. 复制 `minecraft-log-observatory.local.example.json` 为 `minecraft-log-observatory.local.json`。
3. 在 local config 中设置：
   - `roots`: 一个或多个本机 `.minecraft` 根目录。
   - `owner.aliases`: 服务器昵称或离线名。
   - 可选 `app.dataDir`: 项目内派生数据目录。
   - 可选 `app.skinProxyEnabled`: 是否允许 skin proxy 联网。
4. 启动 API：

```bat
npm.cmd run api
```

5. 检查状态：

```text
GET /api/app/status
POST /api/config/validate-roots
```

`setup.state` 会是 `first_run`、`needs_refresh`、`refreshing` 或 `ready`。前端不要从零散布尔值推断启动流程，直接用 `setup.recommendedAction`。

运行时/桌面壳契约：

- `GET /api/app/status` 还会返回 `setup.nextActions`、`recovery.actions` 和 `app.launcher`。
- `app.launcher.contractVersion` 当前为 `1`。桌面壳应读取 `app.launcher.bindPolicy`、`desktopIntegration` 和 `lifecycle`，不要硬编码端口、目录校验或 refresh 端点。
- `.cache/api-server.json` 是版本化运行时状态文件，`schema.name` 为 `minecraft-log-observatory-api-server-state`，`contractVersion` 为 `1`，包含实际本地 URL、PID、端点提示和可用的优雅关闭消息。
- 错误恢复 UI 优先使用 `recovery.actions`，不要直接解析 `refreshReasons`。

## 配置 API

读取配置：

```text
GET /api/config
```

保存本机配置：

```text
PUT /api/config
```

允许字段只有：

- `roots`
- `owner.aliases`
- `owner.displayName`
- `customRules`
- `app.dataDir`
- `app.skinProxyEnabled`
- `outputs.report`
- `outputs.summary`

保护策略：

- 写配置时会校验 roots 是否存在、可读、能发现 `.log/.log.gz`。
- 重复 roots 会被拒绝。
- local overlay 不能覆盖共享配置、日志、规则包、源码、docs 或 package metadata。
- `app.dataDir`、`customRules`、`outputs` 都必须落在安全的项目相对路径。
- refresh 运行中配置写入返回 `409 refresh_running`。

## Refresh Job

启动：

```text
POST /api/refresh
```

查询：

```text
GET /api/refresh
GET /api/refresh/history
```

取消：

```text
POST /api/refresh/cancel
```

阶段：

```text
scan -> parse -> build_report -> export_store -> commit -> done
```

约束：

- 同一时间只允许一个 refresh。
- report/store 输出先写入 staging。
- report build 和 store export 都成功后才 commit。
- 取消或失败会保留旧 report/store。
- 失败会记录 `failurePhase` 和 `errorCategory`，例如 `report_refresh_failed`、`store_export_failed`、`commit_failed`、`cancelled`。
- refresh history 只保留最近 50 条。

## 派生数据生命周期

派生数据包括：

- report / summary / unmatched / result candidates
- parse/chat/chat-line cache
- split report store
- refresh history

清理：

```text
POST /api/data/cleanup
```

请求体：

```json
{
  "scope": "cache",
  "dryRun": true
}
```

`scope` 可选：

- `cache`
- `report`
- `store`
- `all_derived`

规则：

- 默认 scope 是 `cache`。
- `dryRun: true` 返回 planned/skipped，不删除文件。
- cleanup 会重新校验目标，只允许删除派生目标。
- cleanup 不会删除原始 Minecraft 日志。
- refresh 运行中 cleanup 返回 `409 refresh_running`。
- 清理后用 `GET /api/app/status` 查看 `refreshReasons`，再用 `POST /api/refresh` 重建。

## 诊断和隐私

CLI：

```bat
npm.cmd run doctor
npm.cmd run doctor -- --json
npm.cmd run doctor -- --package
npm.cmd run doctor -- --full
```

API：

```text
GET /api/diagnostics
GET /api/diagnostics/package
GET /api/share/package
GET /api/performance
```

默认诊断是 privacy-safe：

- 不包含原始 Minecraft 日志。
- 不包含原始 chat 行。
- 不包含 full report。
- 不包含 split store rows。
- 不暴露本机绝对路径、owner aliases、UUID。
- refresh history 在安全包里只保留 `hasCurrentFile`、`hasError`、`logLines`、`logTailLines`、`errorCategory` 等摘要。

`full=true` 或 `--full` 只用于可信本地调试，可能包含完整路径和 refresh debug 字段。

privacy-safe 包如果审计失败，会返回：

```text
500 privacy_audit_failed
```

并且不会返回 package content。

## Store 和性能路线

split store 默认位于：

```text
data/report-store
```

如果配置了 `app.dataDir`，则位于：

```text
<app.dataDir>/report-store
```

前端大列表优先走：

```text
GET /api/store
GET /api/store/table?name=reliableRounds&offset=0&limit=100
```

性能状态：

```text
GET /api/performance
```

关键建议：

- `collect_refresh_baseline`: 先跑一次成功 refresh。
- `repair_refresh_history`: refresh history 派生文件损坏，跑 refresh 修复。
- `refresh_needed`: report/store 或输入签名需要刷新。
- `warm_missing_caches`: 缓存缺失，跑 refresh 重建。
- `investigate_refresh_bottleneck`: 某个 refresh 阶段足够慢，先定位瓶颈。
- `review_split_store_limits`: split JSONL store 到达复查阈值，再考虑 SQLite。
- `jsonl_store_ok`: 当前 JSON/JSONL 路线可继续使用。

当前自动复查阈值：

- store 文件合计至少 `250MB`，或
- JSONL 行数合计至少 `1,000,000`。

## 回归验证

后端产品化相关的常用验证：

```bat
npm.cmd run test:api
npm.cmd run test:api-server
npm.cmd run test:doctor
npm.cmd run test:store
npm.cmd run test:openapi
```

完整验证：

```bat
npm.cmd test
```

刷新真实派生数据：

```bat
npm.cmd run report -- --unmatched-out unmatched-debug.json
npm.cmd run store:export
```

## 交付检查清单

- `GET /api/app/status` 能区分 first-run、needs-refresh、refreshing、ready。
- roots 校验能报告 not found、duplicate、empty、no logs、sample unreadable。
- `POST /api/refresh` 能从日志重建 report 和 store。
- 取消或失败不会破坏旧 report/store。
- cleanup dry-run 能预览删除目标。
- cleanup 只删派生数据，不碰日志 roots。
- diagnostics package privacy audit 通过。
- share package 不泄露路径、用户名、UUID 或 raw rows。
- `/api/performance` 能给出 JSONL 继续使用或需要复查的机器可读建议。
- OpenAPI 与实现保持同步。
