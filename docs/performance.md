# Performance Notes

The backend uses a two-level cache for log-heavy work.

1. `cache.chatLines` stores extracted chat lines per source log file.
   - It depends on file path, size, modified time, file kind, and encoding.
   - It does not depend on rule definitions.
   - Rule tuning can reuse this cache and avoid rereading large raw logs.

2. `cache.chat` stores parsed chat events per source log file.
   - It depends on the chat rule signature and analyzer version.
   - Rule or parser changes automatically miss this cache.
   - On a miss, the analyzer now reads from `cache.chatLines` when available.

Useful commands:

```bat
npm.cmd run chat:extract
npm.cmd run chat:extract -- --out data/chat-lines.jsonl
npm.cmd run chat:events -- --top 10
npm.cmd run chat:templates -- --top 20
npm.cmd run result:candidates
npm.cmd run owner:aliases -- --mode bedwars
npm.cmd run result:by-hint -- --per-group 5 --prefix unknown-result-by-hint-current
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current
npm.cmd run result:audit-labels -- --input labeling/reviewed.jsonl
npm.cmd run rules:audit-workflow -- --input labeling/reviewed.jsonl --target-mode bedwars
npm.cmd run performance:baseline
npm.cmd run report
```

Refresh job timing:

- `GET /api/refresh` exposes `phaseTimings` and `phaseDurationsMs` for the active or most recent job.
- `GET /api/refresh/history` stores the last 50 completed jobs with per-job `phaseDurationsMs` and `summary.averagePhaseDurationsMs`.
- `GET /api/performance` summarizes successful refresh jobs into a local baseline with sample size, average duration, per-phase min/average/max, and the current slowest average phase. It also reports split-store `declaredFiles`, total bytes, JSONL table rows, largest files, table-level size/row metadata, sampled `storeReadBaseline`, recent store read metrics, derived cache file presence/bytes, process JSON API cache hit/miss/parse timings by privacy-safe file kind, and `comparison` against the saved `artifacts/performance-baseline-current.json` when present.
- `performance.apiCache` is the current API process hot JSON cache. It uses file `mtime`/`ctime`/`size` validation, stores no raw paths in the response, and is automatically invalidated by refresh commits, config reloads, cleanup, and relevant local derived-data writes.
- `/api/performance.recommendations` is the machine-readable action list for local product UX. It can report `collect_refresh_baseline`, `repair_refresh_history`, `refresh_needed`, `store_not_ready`, `warm_missing_caches`, `investigate_refresh_bottleneck`, `review_split_store_limits`, `review_store_table_read_latency`, or `jsonl_store_ok`.
- If `.cache/refresh-history.json` is missing, corrupt, or unreadable, `/api/refresh/history`, `/api/performance`, diagnostics packages, and `npm run doctor` keep returning usable output with a `refresh_history_*` warning and an empty timing baseline. Store/cache readiness still comes from their own files.
- `GET /api/diagnostics/package` includes the same performance section in privacy-safe troubleshooting bundles.
- `npm run doctor -- --json` and `npm run doctor -- --package` include a privacy-safe `performance` section with refresh-history baseline, split-store size/row metadata, and cache file presence/bytes, without log tails or current-file paths.
- Tracked phases are `scan`, `parse`, `build_report`, `export_store`, `commit`, and `cancelling` when cancellation is requested.
- Use these fields as the first performance baseline before considering SQLite: if `export_store` or store table reads become the bottleneck after warm caches, or if `/api/performance.recommendations` emits `review_split_store_limits`, then revisit storage. The current automatic split-store review threshold is at least `250MB` of store files or at least `1,000,000` JSONL rows.

Expected warm-cache behavior on the current full local dataset:

- `chat:extract`: about 8 seconds with `1440/1440` chat-line cache hits. It only refreshes cache unless `--out` is provided.
- `result:candidates`: about 9 seconds with `1440/1440` chat-line cache hits.
- `owner:aliases`: uses the chat-line cache and does not mutate config; it is a diagnostic export for manual alias review.
- `result:by-hint`: uses the chat-line cache and writes Markdown/JSON review samples grouped by unknown-result hint.
- `result:audit`: reads the current report and writes privacy-safe JSON/JSONL/CSV audit queues grouped by `unknownAudit.category` and `unknownAudit.nextAction`; it does not scan logs or change results.
- `result:audit`: includes server display fields (`serverLabel`, `serverAddress`, `serverConfidence`, `serverEvidence`) so manual reviewers do not need to infer server identity from source/scope.
- `result:audit`: exports schema version 2 review work queues with `allowedReviewLabels`, `suggestedReviewLabel`, blank `reviewLabel` / `reviewNotes`, and optional draft helper columns (`message`, `ruleId`, `confidence`, `negativeExamples`) for direct handoff into label validation and audit workflow.
- `result:audit -- --include-context`: opt-in local review mode that reads `cache.chatLines` / configured roots, then adds bounded `contextLines` with cleaned chat text and matched rule metadata. Leave this flag off for shareable/privacy-safe exports.
- `result:audit -- --review-packet`: opt-in local helper that also writes `<prefix>.review.md`, a human-readable review packet with round facts, owner/team signals, evidence kinds, blank review fields, and bounded context when `--include-context` is also present.
- `result:audit -- --display-encoding utf-8`: review-only display repair for selected context lines. When parser output is mojibake but the original log line is readable with the display encoding, exports keep the raw `text` and add `displayText`; the Markdown packet shows the readable text with the raw text noted for traceability.
- `result:audit -- --label-template`: opt-in local helper that writes `<prefix>.labels.jsonl`, a compact reviewed-label input file with blank labels plus audit facts and short context references. It can be validated directly by `result:audit-labels` and does not change report/store/config/rules.
- `result:audit-labels`: reads reviewed unknown-audit label exports in JSON, JSONL, or CSV form, validates allowed labels and current `roundRef` values, and prints a privacy-safe summary without changing report/store/config/rules.
- `rules:audit-workflow`: validates reviewed labels, generates draft rule-pack artifacts, and dry-runs the candidate through the promotion gate without enabling rules or writing official report/store/config files.
- `performance:baseline`: reads existing report/store/cache/refresh-history derived data, samples split-store page reads, compares with a previous baseline when available, archives the old current baseline under `artifacts/performance-history`, and writes a privacy-safe JSON baseline without scanning original logs.
- `report`: about 8 seconds with warm parse, chat-line, and chat-event caches.

When rules change, `cache.chat` should miss and rebuild, but the rebuild should still use `cache.chatLines`, so it should not scan the full raw log corpus again.
