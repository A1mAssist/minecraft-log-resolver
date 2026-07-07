# Minecraft Log Resolver Handoff

更新时间: 2026-07-07

这是 Minecraft Log Resolver 的交接文档。当前桌面版是 Tauri + Rust 后端，前端仍复用现有 Web UI。运行时不需要 Node.js，不启动 localhost HTTP 服务，不监听 TCP 端口。

## 当前状态

- 仓库: `https://github.com/A1mAssist/minecraft-log-resolver`
- 默认分支: `main`
- 当前版本: `0.1.0`
- 桌面运行时: Tauri IPC + Rust in-process backend
- Windows 应用名: `Minecraft Log Resolver`
- 单文件产物: `artifacts/MinecraftLogResolver-v0.1.0-windows-x64.exe`
- Portable 产物: `artifacts/MinecraftLogResolver-v0.1.0-windows-x64-portable.zip`

## Rust 后端已接管的能力

- `/api/config`, `/api/config/validate-roots`, `/api/system/select-directory`
- `/api/refresh`, `/api/refresh/preflight`, `/api/refresh/history`, `/api/refresh/cancel`
- 日志发现、`.log/.log.gz/!CHAT` 读取、编码处理、规则匹配、report/summary/store 生成
- `/api/report`, `/api/summary`, `/api/profile`, `/api/activity`, `/api/rounds`, `/api/modes`, `/api/results`
- `/api/store`, `/api/store/table`, `/api/timeseries`, `/api/sources`, `/api/scopes`, `/api/days`
- `/api/rules/test`, `/api/rules/draft`, `/api/rules/validate`, `/api/rules/dry-run`, `/api/rules/audit-workflow`, `/api/rules/draft-from-labels`
- `/api/rule-packs`, `/api/rule-packs/user`, enable/disable/delete/backups/restore
- `/api/unknown-audit/labels`, `/api/unknown-audit/status`, `/api/unknown-audit/label-sets`
- `/api/diagnostics`, `/api/diagnostics/package`, `/api/share/package`, `/api/performance`
- `/api/minecraft-profile` 和 `/api/skin` 的 Mojang/texture 查询元数据
- `/api/data/cleanup` 的安全派生数据清理策略

## 运行时约束

- 不内嵌 `node.exe`
- 不启动本地 HTTP server
- 不暴露 localhost 端口
- 原始 Minecraft 日志只读
- 配置写入只允许本地 overlay: `minecraft-log-resolver.local.json`
- cleanup 只允许删除派生数据/cache/store/history，不允许触碰 Minecraft roots
- rule dry-run、label workflow、share package 不写官方 report/store/config，只有明确保存/启用操作才会写文件

## 配置和输出位置

默认放在 exe 同目录或 portable 根目录:

- 配置模板: `minecraft-log-resolver.config.json`
- 本地配置: `minecraft-log-resolver.local.json`
- 报告: `report-combined.json`
- 摘要: `report-combined-summary.json`
- store: `data/report-store`
- unmatched: `unmatched-debug.json`
- unknown audit label sets: `data/unknown-audit-label-sets`
- user rule packs: `custom-rules/user`
- user rule pack backups: `data/rule-pack-backups`

## 开发环境

需要:

- Windows 10/11
- Node.js/npm, 用于前端构建和测试脚本
- Rust toolchain
- Tauri CLI
- Visual Studio Build Tools 2022, MSVC x64

本机已使用的 VS build tools:

```bat
D:\Tools\VSBuildTools2022\VC\Auxiliary\Build\vcvars64.bat
```

## 常用命令

Rust 验证:

```bat
cd src-tauri
cargo check
cargo test
```

前端/发布检查:

```bat
npm.cmd run test:frontend
npm.cmd run test:release-check
```

构建 Tauri exe:

```bat
cmd /c "call D:\Tools\VSBuildTools2022\VC\Auxiliary\Build\vcvars64.bat && npm.cmd run tauri:build -- --no-bundle"
```

构建 portable:

```bat
npm.cmd run build:tauri-portable
```

更新 artifacts:

```powershell
Copy-Item -LiteralPath 'dist\tauri-desktop\MinecraftLogResolver.exe' -Destination 'artifacts\MinecraftLogResolver-v0.1.0-windows-x64.exe' -Force
Compress-Archive -Path 'dist\tauri-desktop\*' -DestinationPath 'artifacts\MinecraftLogResolver-v0.1.0-windows-x64-portable.zip' -Force
```

## 发布验证

发布前至少跑:

```bat
cd src-tauri
cargo test
cd ..
npm.cmd run test:frontend
npm.cmd run test:release-check
```

运行探针必须满足:

- `nodeProcesses = 0`
- `tcpListeners = 0`
- 进程只应包含 app exe 和 `msedgewebview2`
- zip 内不得包含 `node.exe`
- zip 内不得出现旧名 `MinecraftLogObservatory`

## 重要实现文件

- `src-tauri/src/lib.rs`: Rust API 路由、扫描、report/store、规则、audit、profile 查询
- `src-tauri/Cargo.toml`: Rust 依赖
- `src/app/main.js`: 前端入口和 Tauri IPC API bridge
- `scripts/build-tauri-frontend.mjs`: 前端静态资源构建
- `scripts/build-tauri-portable.mjs`: portable 目录构建
- `src/parser/rules/*.json`: bundled 规则源，Rust 通过 `include_str!` 读取
- `README.md`: 用户文档

## 规则工作流说明

Rust 后端现在不再返回占位错误:

- `POST /api/rules/dry-run` 会实际编译候选 rule pack，并用现有 report/unmatched 样本跑规则匹配差异
- `POST /api/rules/draft-from-labels` 会从 reviewed labels 生成可校验 rule pack
- `POST /api/rules/audit-workflow` 会生成 draft 并立即跑 dry-run
- `POST /api/rule-packs/user` 保存前会备份旧文件
- `POST /api/rule-packs/user/restore` 可从 `data/rule-pack-backups` 恢复

## 已知后续优化

这些不是运行阻断项，但后续可以继续做精细化:

- dry-run 目前使用 Rust 规则匹配样本做影响预览；如果需要完全等价 JS 的重建式 diff，可以继续把 roundBuilder/reportBuilder 的所有细节拆进 Rust 模块
- refresh 目前是同步 Rust 执行；如果需要 UI 中显示逐文件实时进度，可以把扫描改成后台 job 状态机
- diagnostics/performance 目前足够本地排查；如果需要公开分享诊断包，可以继续补更细的 privacy audit 字段

## 交接原则

- 不要恢复 Node 后端作为桌面运行时
- 不要重新引入 localhost API server
- 不要让 API 返回假成功；做不到就返回明确错误
- 不要删除用户 Minecraft 日志
- 不要把 `minecraft-log-resolver.local.json`, `data/`, `report-combined*.json`, `unmatched-debug.json`, `artifacts/` 提交进 git
