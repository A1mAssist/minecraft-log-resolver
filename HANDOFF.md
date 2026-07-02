# Minecraft Log Resolver Handoff

更新时间：2026-06-18

这是给下一台电脑上的 Agent / 开发者读取的项目交接文档。项目定位是本地离线 Minecraft 日志分析工具：读取用户选择的本地 `.minecraft` 日志目录，生成报告、JSON/JSONL split store、审计队列和本地 HTTP API。原始 Minecraft 日志永远只读。

## 1. 新电脑开发环境

必须安装：

- Windows 10/11，PowerShell 可用。
- Node.js LTS，建议 Node.js 22.x；Node.js 20.x 也应可用。
- npm，随 Node.js 安装即可。Windows 下命令优先用 `npm.cmd`。
- Git，建议安装，方便后续 diff / branch / commit。

可选：

- VS Code 或其他编辑器。
- 7-Zip / Windows Explorer，用于解压 zip。

当前项目没有第三方 npm 运行依赖，`package-lock.json` 为空依赖锁；仍可运行一次：

```bat
npm.cmd install
```

用于确认 npm 环境正常。

## 2. 迁移后第一步

解压代码包后，在项目根目录执行：

```bat
node -v
npm.cmd -v
npm.cmd run test:rules
npm.cmd run test:core
npm.cmd run test:api
npm.cmd run test:openapi
```

如果还没有本机日志和派生 report，不要立刻跑完整 `npm.cmd test`，因为其中的 report/summary/store/release 检查需要先生成本机派生数据。

配置本机日志：

```bat
copy minecraft-log-resolver.local.example.json minecraft-log-resolver.local.json
```

然后编辑 `minecraft-log-resolver.local.json`：

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
  },
  "app": {
    "dataDir": "data",
    "skinProxyEnabled": true
  }
}
```

`minecraft-log-resolver.local.json` 是机器私有文件，不要提交、不要分享。

生成本机派生数据：

```bat
npm.cmd run report -- --unmatched-out unmatched-debug.json
npm.cmd run store:export
npm.cmd run performance:baseline
```

之后再跑完整验证：

```bat
npm.cmd test
```

启动本地 API / UI：

```bat
start.bat
```

默认前端入口：

```text
http://127.0.0.1:5173/
```

停止：

```bat
stop.bat
```

## 3. 打包时应包含 / 不应包含

代码包应包含：

- `src/`
- `scripts/`
- `docs/`
- `custom-rules/README.md`
- `custom-rules/examples/`
- `README.md`
- `HANDOFF.md`
- `package.json`
- `package-lock.json`
- `index.html`
- `start.bat`
- `stop.bat`
- `minecraft-log-resolver.config.json`
- `minecraft-log-resolver.local.example.json`
- `.gitignore`

代码包不应包含：

- `.git/`
- `.cache/`
- `node_modules/`
- `data/`
- `dist/`
- `artifacts/`
- `exports/`
- `outputs/`
- `labeling/`
- `work/`
- `minecraft-log-resolver.local.json`
- `report-combined.json`
- `report-combined-summary.json`
- `unmatched-debug.json`
- `analysis-*.json`
- `chat-rounds-*.json`
- `chat-templates-*.json`
- `report-*.json`
- `result-candidates.json`

这些排除项都是本机私有信息、缓存、编译/打包结果、审计导出或可重建派生数据。

## 4. 当前已完成的后端能力

核心管线：

- 本地离线 Node.js ESM 后端，无云端、无账号、多租户。
- 日志发现、读取、编码处理、chat line cache、规则匹配、session/play segment、round/activity 构建。
- report v1、summary、split JSON/JSONL store。
- API、静态 UI proxy、刷新任务、取消、历史、派生数据清理、诊断包、性能基线。
- 原始日志只读；所有 report/cache/store/exports 都是可删除重建的派生数据。

规则生态：

- bundled 规则包已按游戏模式拆分：`game-state`、`bedwars`、`skywars`、`duels`、`mega_walls`、`mini_walls`、`the_pit`、`blitz_sg`、`bridge`、`build_battle`、`hide_and_seek`、`murder_mystery`、`speed_uhc`、`the_walls`、`uhc`、`minecraft-combat`。
- 保留旧 `game-state` 兼容选择器；事件同时带 `ruleSet` 和物理 `rulePack`。
- 已有 rule doctor、rule dry-run、user rule pack 保存/启用/禁用/备份/恢复、规则质量 baseline。
- unknown audit label workflow 已有 CLI 和 API：可导出审计队列、保存/校验人工标注、生成 draft rule pack、dry-run 后再启用。

结果统计：

- BedWars 做了多轮保守收敛：本人床破后本人淘汰、低置信队伍淘汰 win fallback、中等 self-death boundary loss、短低证据伪局 ignore。
- 非 BedWars 做了诊断和窄 SkyWars 伪局 ignore。
- `external_winner_broadcast` 不直接转正式 win/loss，除非后续通过 owner 绑定和 dry-run 证明安全。
- `ambiguousResults` 应保持 0。

The Pit：

- The Pit 作为连续 activity / `not_applicable` 统计，不参与 win/loss/unknown。
- The Pit kill/death、个人连杀、广播连杀、reward/gold/xp/bounty 已拆分。
- `observedBroadcastMaxKillStreak` 是服务器广播中看到的最高连杀，不等于本人最高连杀。
- `playerMaxKillStreak` 才是本人连杀指标。

前端契约相关：

- `/api/rounds` 每局有 `serverNetwork`、`serverAddress`、`serverLabel`、`serverConfidence`、`serverEvidence`。
- 本地代理地址可保留为 `serverAddress`，真实服名可由 chat template / chat text 推断为 `serverLabel`。
- `/api/rounds`、`/api/modes`、summary/report/store 都有 `playerBedDestroys`，等于旧字段 `selfBedDestroys`。
- `/api/profile` 暴露两套连胜策略：`break_unknown` 和 `skip_unknown`。
- `/api/activity` 暴露 `playerMaxKillStreak` 和 `observedBroadcastMaxKillStreak`。

## 5. 当前本机最新参考基线

以下数字来自本机 `report-combined-summary.json`，生成时间 `2026-06-17T17:49:18.451Z`。代码包不包含这个 report，新电脑需要重新生成。

总体：

- `reliableRounds = 992`
- `resultEligibleRounds = 841`
- `nonResultRounds = 151`
- `wins = 437`
- `losses = 314`
- `unknownResults = 90`
- `ambiguousResults = 0`
- `knownResultRate = 0.893`
- `winRate = 0.5819`
- `playerBedDestroys = 242`
- `playerMaxKillStreak = 50`

BedWars：

- `rounds = 393`
- `wins = 157`
- `losses = 150`
- `unknownResults = 86`
- `bedDestroys = 603`
- `playerBedDestroys = 242`
- `knownResultRate = 0.7812`

The Pit：

- `rounds = 151`
- `resultEligible = 0`
- `notApplicableResults = 151`
- `kills = 11630`
- `deaths = 66`
- `playerMaxKillStreak = 50`

服务器识别当前大致分布：

- `花雨庭 | NetEase | inferred`: 387
- `Hypixel | Hypixel | direct`: 326
- `花雨庭 | NetEase | direct`: 198
- `粘土云 | 粘土云 | direct`: 30
- `布吉岛 | 布吉岛 | inferred`: 22
- `未知服务器`: 14
- `本地代理 / 未知服务器`: 4

## 6. 用户给出的重要判断规则

必须遵守：

- 不修改、不移动、不删除原始 Minecraft 日志。
- 不重置 git，不丢弃已有改动，除非用户明确要求。
- 后端优先；前端实现不是当前后端任务的一部分。
- 服务器未知样本需要导出 chat-only context，不要导出原始 log 文件内容。
- `test`、`testserver`、反作弊测试服务器一类不算正式 rounds，应走 `ignoredReason = "test_server"` 或等价忽略路径。
- `testserver.loyisa.cn:1337` 是 `Loyisa's Test Server`，测反作弊，不算正式局数。
- `mc32.rhymc.com` 是反作弊测试服务器，不算正式局数。
- `42.186.61.162` 是 `粘土云`。
- `59.111.137.99` 和 `hytpc` 是花雨庭。
- `169.254.233.196` 是花雨庭。
- `mc.aisu.site` 是花雨庭加速 IP，归到花雨庭。
- `42.186.64.241` 是小蜜蜂。
- `a.polars.cc:31001` 是 HmXix。
- 带 `hyp` 关键词的是 Hypixel。
- `remiaft` 服务器叫 Remiaft。
- `mcyc` 是游戏世界。
- chat 里有 `布吉岛` 三个字可推断布吉岛。
- chat 里有 `[战墙]`，这局模式必须是 `the_walls`。
- The Pit 要进 activity / 非胜负统计；一个 activity segment 类似一局用于 KD/时长展示，但不能算 win/loss/unknown。
- unknown / ambiguous 是否断连胜由用户选择；后端同时提供 `break_unknown` 和 `skip_unknown`。
- 连杀不只算 The Pit，所有可靠 round 和 activity segment 的本人击杀/死亡都计算。

## 7. 主要文件入口

- `src/parser/serverContext.mjs`: 服务器地址、网络、标签和证据识别。
- `src/parser/roundBuilder.mjs`: round/activity 构建、结果推断、ignore 规则、The Pit mirror。
- `src/report/reportBuilder.mjs`: report/summary enrichment、profile、mode summary、server fields。
- `src/api/reportApi.mjs`: HTTP API 路由、config/refresh/rules/audit/results/rounds/profile/activity。
- `src/report/unknownAudit.mjs`: unknown 审计分类。
- `src/diagnostics/performanceBaseline.mjs`: 性能基线。
- `src/parser/ruleEcosystem.mjs`: 规则包生命周期。
- `src/parser/auditWorkflow.mjs`: 人工标注到 draft rule / dry-run workflow。
- `docs/api.md`: 前端/后端主要 API 文档。
- `docs/openapi.json`: OpenAPI schema。
- `docs/frontend-api-contract.md`: 给前端看的精简接口契约。
- `docs/backend-status.md`: 当前后端状态文档。
- `docs/backend-todo.md`: 已完成/待办清单。

## 8. 常用命令

开发启动：

```bat
npm.cmd run api
npm.cmd run dev
```

报告刷新：

```bat
npm.cmd run report -- --unmatched-out unmatched-debug.json
npm.cmd run store:export
```

审计导出：

```bat
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current
npm.cmd run result:audit -- --mode bedwars --priority high --include-context --review-packet --label-template --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review --before-ms 0 --after-ms 120000 --context-lines 80
npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
npm.cmd run result:audit-status -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
```

规则：

```bat
npm.cmd run rules:validate
npm.cmd run rules:doctor
npm.cmd run rules:dry-run -- --rule-pack custom-rules/examples/local-server.example.json
npm.cmd run rules:quality-baseline
```

性能/发布检查：

```bat
npm.cmd run performance:baseline
npm.cmd run release:check
npm.cmd run release:notes -- --out artifacts/release-boundary-draft.md
```

推荐回归：

```bat
npm.cmd run test:rules
npm.cmd run test:custom-rules
npm.cmd run test:core
npm.cmd run test:api
npm.cmd run test:api-server
npm.cmd run test:doctor
npm.cmd run test:store
npm.cmd run test:openapi
```

完整回归：

```bat
npm.cmd test
```

## 9. 下一步建议

优先级高：

- 继续清理服务器未知样本，但只导出 chat-only context。
- 把用户新确认的服务器特征补进 `src/parser/serverContext.mjs`，不要用服务器名改变胜负推断。
- 继续 unknown audit 人工标注闭环：标注、校验、draft rule pack、dry-run、再启用。
- 保持 `ambiguousResults === 0`。
- 保持 The Pit `resultEligible === 0`、`notApplicableResults === rounds`。

暂缓：

- 不做 SaaS、账号、多租户、云同步。
- 不引入 SQLite，除非 `/api/performance` 连续提示 JSON/JSONL 不够用。
- 不做 native installer / 桌面壳，等前端产品壳稳定后再做。

