# Backend TODO

## P0: Stable Report Layer

- [x] Generate a full Neon + Aurora report with schema v1.
- [x] Keep `rounds.reliable`, `rounds.ignored`, and `rounds.all`.
- [x] Preserve abnormal rounds in `rounds.ignored` while keeping main stats on reliable rounds.
- [x] Add report, summary, cache, and rules tests.
- [x] Verify hot chat-cache reuse.

## P1: Global Rules And Result Coverage

- [x] Expand global game-state rules from mined real logs.
- [x] Keep result statistics conservative: only explicit or narrow-context signals become `win` or `loss`.
- [x] Add result coverage by mode and report-level debug examples.
- [x] Add candidate mining for future rule expansion via `npm run result:candidates`.

## P2: App-Callable Backend

- [x] Add a local report API for health, summary, full report, rounds, modes, accounts, rules, timeseries, unmatched data, and store manifest.
- [x] Add filtering for rounds by source, scope, mode, result, date range, duration, and known-result state.
- [x] Reject malformed round filter query values with `invalid_rounds_query` instead of silently dropping filters.
- [x] Reject malformed daily date filters with `invalid_days_query` instead of silently filtering by raw strings.
- [x] Add a controlled refresh endpoint with one job at a time.
- [x] Persist recent refresh history under `.cache/refresh-history.json`.
- [x] Add a dependency-free split JSON/JSONL report store via `npm run store:export`.

## P3: Custom Rules And Data Navigation

- [x] Support configured custom rule packs through `customRules`.
- [x] Restrict API-written `customRules` paths to safe project-relative rule-pack directories or JSON files.
- [x] Cache custom rule packs by content hash so saved/edited packs hot-reload in API rule testing/listing.
- [x] Validate custom rule packs from CLI and API.
- [x] Return standardized `invalid_rule_pack_config` API errors when configured custom packs cannot be loaded.
- [x] Provide example local-server custom rules.
- [x] Document custom rule format and config path behavior.
- [x] Add source, scope, account, mode, and store indexes for frontend navigation.

## P4: Frontend-Ready Contracts

- [x] Add rule-editor backend primitives: test one chat line, draft a regex rule, validate an inline rule pack.
- [x] Validate request-provided `ruleSets` for rule testing so unknown ids return explicit API errors instead of silent no-match results.
- [x] Validate request-provided `customRulePaths` for rule testing with the same safe rule-pack path policy.
- [x] Add constrained rule-pack save/read/delete APIs for project-managed `custom-rules/user` files.
- [x] Require stable managed rule-pack ids so API saves cannot silently normalize to colliding filenames.
- [x] Add rule-pack lifecycle metadata, enable/disable, backups, restore, doctor, and dry-run preview APIs.
- [x] Add privacy-safe rule lifecycle audit history for save/delete/enable/restore/dry-run operations.
- [x] Add CLI helpers for rule doctor, rule dry-run, and label-to-rule-pack draft generation.
- [x] Add API docs for all current backend endpoints.
- [x] Add a machine-readable OpenAPI draft at `docs/openapi.json`.
- [x] Add smoke tests for API contract coverage.
- [x] Add `/api/profile` career/profile data for best days, streaks, preferences, session/match extremes, late-night play, and per-ID leaderboards.
- [x] Add diagnostic `results.unknownHints` so review screens can show probable outcomes without changing official win/loss totals.
- [x] Attach `resultHint` to unknown rounds and allow `/api/rounds?resultHint=...` filtering.
- [x] Add `results.unknownHints.byReason` and `/api/rounds?resultHintReason=...` so review queues can target exact unknown diagnostics.
- [x] Add continuous-mode `activity` data and `/api/activity` for The Pit-style non-round gameplay.
- [x] Keep SQLite deferred behind `/api/performance` thresholds; current baseline reports `jsonl_store_ok`, so JSON/JSONL remains the active data layer.

## P5: Accuracy Iteration

- [x] Refresh mined result candidates from the full Neon + Aurora logs.
- [x] Expose mined result candidates through `GET /api/result-candidates`.
- [x] Treat all observed `localUser` names as owner aliases for conservative winner-name inference.
- [x] Support explicit `owner.aliases` for server display names that do not appear in `Setting user:`.
- [x] Add diagnostic owner alias candidate export via `npm run owner:aliases`.
- [x] Add grouped unknown-result review exports via `npm run result:by-hint`.
- [x] Move machine-specific roots and owner aliases into an ignored local config overlay for safe distribution.
- [x] Keep known result counting conservative when a winner/team cannot be tied to an owner account.
- [x] Add generic Hypixel-style elimination, placement, countdown, and player-join signals.
- [x] Add Chinese countdown/player-join signals for round boundary detection.
- [x] Track abnormal-behavior ban/kick messages and count them as a loss only when the punished player is an owner account.
- [x] Add The Pit streak/megastreak/streak-point signals and keep Pit out of win/loss round totals.
- [x] Infer a BedWars win only when owner team is known and all enemy teams in a known 4-team or 8-team universe are eliminated.
- [x] Stop treating countdown-only waiting/lobby segments as reliable rounds.
- [x] Add `ignoredReason` diagnostics so waiting-only fake rounds are easy to separate from real unknown-result rounds.
- [x] Export manual labeling candidates to `labeling/candidates.csv`, `labeling/candidates.json`, and `labeling/candidates.jsonl`.
- [x] Avoid classifying result candidates from player names or client strings by matching normalized templates.
- [x] Add `--hint-reason` filters to unknown/result review exports for focused manual audits.
- [x] Add a conservative rule dry-run diff before rule changes are allowed to affect official stats.
- [x] Add workflow metadata to label-to-rule draft responses so review screens can guide validate/dry-run/save steps.
- [x] Add unknown-audit label validation/summarization API and CLI before rule drafting.
- [x] Add local unknown-audit label-set APIs so frontend/manual review can save, read, update, and delete labeling progress without changing report/store/config/rules.
- [x] Support JSON, JSONL, and CSV reviewed label inputs for audit validation and draft generation.
- [x] Make `result:audit` exports usable as review work queues with schema/version, allowed labels, suggested labels, and draft helper fields.
- [x] Add unknown-audit review priority/reason fields plus API/CLI priority filtering for focused manual queues.
- [x] Add opt-in local Markdown review packets for focused unknown-audit queues with bounded context.
- [x] Add review-only `--display-encoding` repair for unknown-audit context packets so UTF-8 Chinese logs remain readable even when the parser config uses a different encoding.
- [x] Add combined unknown-audit label workflow API/CLI that validates labels, writes draft artifacts, and dry-runs candidate rules before enabling.
- [x] Add CLI end-to-end test coverage for reviewed audit labels flowing into draft rule packs, dry-run artifacts, and no official report/store/config/rule writes.
- [x] Add `result:audit-status` readiness checks so reviewed label files can report `needs_labeling`, `needs_rule_text`, `ready_for_workflow`, or keep-unknown archive status before rule drafting.
- [x] Add `/api/unknown-audit/status` readiness preflight for frontend/local UI flows before draft generation or dry-run.
- [x] Add report/API rule quality summary with hit counts, zero-hit samples, duplicate patterns, risk groups, and result/boundary impact samples.
- [x] Add broader team-color inference for modes beyond the current BedWars/self-combat/team-assignment coverage.
- [x] Add long-term rule quality baseline comparison across archived report snapshots.
- [x] Add first rule-id-locked fixture pass for important result, team, bed, final-death, boundary, and winner-broadcast-adjacent rules based on `rules.quality` samples.
- [x] Add second rule-id-locked fixture pass for lower-hit and current zero-hit result/mode/reward/BedWars fallback rules based on `rules.quality` samples.
- [x] Add third rule-id-locked fixture pass for low-hit result-impact rules such as fight win/loss, permanent death, spectator/self-death, Chinese loss, and token win rewards.
- [x] Add another positive/negative fixture pass for result/boundary-adjacent rules such as winner announcements, coin/token/SkyWars win rewards, generic team chat, SkyWars cage start, and The Pit streak signals.
- [ ] Long-term/P3: continue expanding positive/negative fixture coverage for future lower-hit and long-term zero-hit rules based on `rules.quality` samples.
- [x] Add first-pass Pit reward economy parsing for explicit death-streak `goldEarned` and `xpEarned` totals.
- [x] Add more Pit reward/economy parsing for explicit player kill/assist rewards, gold pickups, free XP, and reward-summary lines.
- [x] Add diagnostic-only Pit bounty-created, bounty-bump, prestige, and temporary event notice parsing without adding broadcast gold to personal economy totals.
- [x] Add narrow owner-bound Pit bounty-claim income parsing via `bountyClaims` and `bountyGoldEarned`, included in `goldEarned`.
- [x] Add activity review export for The Pit/activity segments with privacy-safe default JSON/JSONL/CSV outputs and opt-in local examples.
- [ ] Pit deferred: add more reward/economy parsing if logs expose owner-bound renown, prestige, or other non-reward-summary economy lines.
- [ ] Requires human labels: label current `unknown-audit-*` work queues, dry-run generated candidates, and promote only confirmed global patterns into user/bundled rules.

## P6: Dashboard Rebuild

- [x] Replace the placeholder/garbled frontend with a real API-backed dashboard.
- [x] Add overview metrics, playtime chart, mode analysis, result confidence, round filters, round table, candidates, and store status.
- [x] Keep the first screen as the usable app instead of a landing page.
- [x] Add responsive layout for desktop and narrow viewports.
- [ ] Frontend deferred: add browser visual regression checks when frontend/product UI work resumes.

## P7: Local Productization Backend

- [x] Add app/project status for first-run, report/store readiness, and refresh-needed state.
- [x] Add explicit app setup states for first-run, needs-refresh, refreshing, and ready so clients do not infer setup flow from raw booleans.
- [x] Add constrained local-config read/write APIs for roots, owner aliases, custom rules, app data dir, skin proxy, and output names.
- [x] Reject unsupported nested local-config fields under owner/app/outputs instead of silently ignoring them.
- [x] Ensure unsupported local-config fields cannot affect root validation during config saves.
- [x] Reject duplicate log roots during config saves instead of silently deduplicating them.
- [x] Validate the configured local overlay target before API config writes so it cannot overwrite shareable config, logs, rule packs, source/docs, or package metadata.
- [x] Restrict API-written app data dirs to project-relative paths so local config writes cannot create derived directories at arbitrary absolute paths.
- [x] Restrict API-written app data dirs to safe derived-data directories outside Minecraft roots, config files, rule packs, source/docs, and package metadata.
- [x] Restrict API-written report/summary outputs to distinct derived JSON targets so they cannot overwrite config, rule pack, source, docs, or package metadata files.
- [x] Add local root validation for existence, readability, log discovery, duplicate paths, and sample readability.
- [x] Reject malformed root-validation request fields with a stable `invalid_validate_roots_request` envelope.
- [x] Reject unsupported root-validation encoding labels with `invalid_validate_roots_request` before scanning files.
- [x] Add root-validation regression coverage for `.log.gz`, duplicate roots, empty selected roots, and empty `logs/` directories.
- [x] Let the native directory picker optionally return root validation diagnostics so first-run UI can show selected-folder readiness immediately.
- [x] Upgrade refresh status with phases, progress, cancellation, and automatic split-store export.
- [x] Add refresh preflight checks for roots, rule health, app status, and write targets before starting refresh.
- [x] Add structured refresh history with duration, latest job, summary counts, failure phase, and error category.
- [x] Track refresh phase timings and average phase durations for scan, parse, report build, store export, commit, and cancellation.
- [x] Add refresh `currentFile`, `filesDone`, and `filesTotal` progress from report parsing hooks.
- [x] Add regression coverage for running refresh status and app setup state (`refreshing`, `wait_for_refresh`, disabled configure/refresh actions).
- [x] Add regression coverage for active refresh cancellation, concurrent refresh rejection, staged-output cleanup, and cancelled history records.
- [x] Add regression coverage for cancellation after the refresh has reached split-store export, preserving old report/store outputs.
- [x] Add regression coverage for split-store export failures, preserving old report/store outputs and recording `store_export_failed`.
- [x] Stage report/store refresh outputs and commit them only after both report build and store export succeed.
- [x] Validate refresh output and data-dir write targets before starting child processes, returning `unsafe_refresh_outputs` for unsafe manually edited config.
- [x] Reject local config and managed user rule-pack writes while refresh is running with `refresh_running`.
- [x] Add derived-data cleanup for cache, report, store, and all derived outputs without touching Minecraft log roots.
- [x] Add derived-data cleanup dry-run previews so clients can show planned safe deletions before removing files.
- [x] Reject malformed cleanup scope fields with `invalid_cleanup_scope` instead of defaulting to cache on explicit bad input.
- [x] Align cleanup OpenAPI contract with the safe default cache scope when `scope` is omitted.
- [x] Reject cleanup while refresh is running with `refresh_running` and preserve existing derived outputs.
- [x] Cover `all_derived` cleanup end-to-end, including dry-run, report/store/history removal, and original-log preservation.
- [x] Route cleanup, refresh commit, and managed rule-pack writes/deletes through a shared local API write-target policy.
- [x] Align OpenAPI and contract tests for refresh-running write locks, direct diagnostics privacy audit failures, and privacy-safe performance summaries.
- [x] Add cleanup recovery coverage: cleaned report/store/cache becomes `needs_refresh`, store APIs return `store_not_ready`, and refresh regenerates derived outputs from logs.
- [x] Make app status tolerant of corrupt derived report/summary/store JSON and surface `*_invalid_json` refresh reasons.
- [x] Treat malformed-but-valid report/summary JSON as `report_invalid_schema` / `summary_invalid_schema` in app status and direct API reads.
- [x] Return explicit store manifest/table corruption errors from store APIs so refresh can be recommended instead of surfacing internal errors.
- [x] Treat malformed-but-valid store manifests as `store_invalid_manifest` in app status and store APIs.
- [x] Treat missing manifest-declared store files as `store_files_missing` in app status.
- [x] Standardize API error responses around `ok: false`, `error`, and `message` for common local-backend failures.
- [x] Add privacy-safe diagnostics with optional full-local path output.
- [x] Include privacy-safe setup state and refresh-needed reasons directly in diagnostics output.
- [x] Expose skin proxy networking status in app status for first-run/product UI flows.
- [x] Include privacy-safe report/summary schema readiness details in API diagnostics output.
- [x] Include privacy-safe store readiness details in API diagnostics output.
- [x] Preserve safe relative store file names in privacy-safe diagnostics packages while still redacting local paths.
- [x] Make CLI doctor detect missing manifest-declared store files.
- [x] Add a privacy-safe diagnostics package for troubleshooting without raw logs, raw chat, full reports, or store rows.
- [x] Add diagnostics package manifests and privacy audits for API and `npm run doctor -- --package` output.
- [x] Forbid refresh debug fields such as `currentFile`, `log`, and `logTail` from privacy-safe API/doctor/share packages.
- [x] Forbid active refresh `currentFile` and raw refresh log lines from direct privacy-safe `/api/diagnostics` output.
- [x] Add privacy audit fail-closed behavior to direct privacy-safe `/api/diagnostics` output.
- [x] Reject malformed privacy/share boolean query toggles with `invalid_boolean_query` instead of silently using defaults.
- [x] Refuse to return privacy-safe diagnostics/share packages when privacy audit fails, returning `privacy_audit_failed` without package content.
- [x] Propagate embedded diagnostics privacy audit failures from `/api/diagnostics/package` without returning package content.
- [x] Summarize refresh history inside privacy-safe diagnostics packages without raw refresh `currentFile`, `error`, `log`, or `logTail` fields.
- [x] Include `/api/performance` baseline in privacy-safe API diagnostics packages.
- [x] Include refresh-history performance baseline in CLI doctor output and packages.
- [x] Include split-store and cache performance summaries in CLI doctor output and packages.
- [x] Make `npm run doctor` privacy-safe by default, with `--full` and `--package` modes for local debugging/support.
- [x] Add a privacy-safe share package for aggregate stats without raw logs, chat, local paths, local usernames, or store rows.
- [x] Add share package manifest and privacy audit so exported aggregate stats are self-describing and self-checking.
- [x] Strip UUID-like fields from share-safe nested profile summaries and block UUID leaks with privacy audit failures.
- [x] Add paginated JSONL store table API so large frontend lists can read split store rows without loading the full report.
- [x] Reject malformed or out-of-range pagination parameters with `400 invalid_pagination` instead of silently clamping API reads.
- [x] Keep the API local-only by default and reject non-local bind hosts.
- [x] Add API port fallback and `.cache/api-server.json` runtime state for local launchers.
- [x] Mark `.cache/api-server.json` as `running` on startup and `stopped` during graceful shutdown.
- [x] Make the local static proxy ignore stopped, corrupt, or remote `.cache/api-server.json` state.
- [x] Probe running `.cache/api-server.json` targets before the static proxy trusts them.
- [x] Make the local static proxy report the actual bound port and use `ok: false` error envelopes for proxy failures.
- [x] Harden local static-server path handling for malformed URLs and traversal outside the project root.
- [x] Add a real HTTP API smoke test for local startup, port fallback, JSON endpoints, and request-size limits.
- [x] Add production CORS hardening with local-only origin override coverage.
- [x] Reject malformed JSON and missing/non-JSON write body content types with explicit API error envelopes.
- [x] Reject non-object JSON write bodies with a consistent `invalid_request_body` envelope.
- [x] Return `ok: false` error envelopes for local static-server API proxy failures.
- [x] Support empty/minimal log first-run refresh without profile extreme crashes.
- [x] Record report input signatures so app status can detect stale reports after roots, rules, custom rules, or owner aliases change.
- [x] Include bundled rule file content hashes in report input signatures so app/rule updates trigger `needsRefresh`.
- [x] Include custom rule file content hashes in report input signatures so editing a configured rule pack triggers `needsRefresh`.
- [x] Add a lightweight `/api/performance` baseline from refresh history before considering SQLite.
- [x] Include split-store file sizes and JSONL table row counts in `/api/performance`.
- [x] Record recent JSONL store table read metrics and expose table read latency in `/api/performance`.
- [x] Include derived cache file presence and size in `/api/performance`.
- [x] Omit raw refresh `currentFile`, `error`, `log`, and `logTail` fields from `/api/performance` while preserving summary flags.
- [x] Tolerate corrupt or malformed refresh-history derived data in `/api/refresh/history`, `/api/performance`, diagnostics packages, and `npm run doctor`, and repair it on the next refresh.
- [x] Add machine-readable performance recommendations before considering SQLite or other storage changes.
- [x] Add saved performance-baseline comparison and archive previous current baselines for trend review.
- [x] Add regression coverage for `review_split_store_limits` so large JSONL stores trigger review before any SQLite decision.
- [x] Replace the garbled README with a readable local/offline setup, refresh, diagnostics, cleanup, privacy, and verification entrypoint.
- [x] Add `docs/backend-runbook.md` for backend-only local productization handoff.
- [x] Add a local desktop distributable folder builder via `npm run build:local-desktop`, excluding logs and derived/private data, with optional `--embed-node current` runtime copy.
- [x] Add local desktop runtime smoke coverage for first-run app status, root validation, config save, and needs-refresh state through the bundled frontend proxy.
- [x] Run backend delivery verification commands: `test:api`, `test:api-server`, `test:doctor`, `test:store`, and `test:openapi`.
- [x] Run backend-only full verification: `test:rules`, `test:custom-rules`, `test:core`, `test:config`, `test:report`, `test:summary`, `test:api`, `test:api-server`, `test:doctor`, `test:store`, and `test:openapi`.
- [ ] Frontend/product deferred: wrap the local desktop bundle into a native installer or desktop shell after frontend/product shell work resumes.
- [ ] Frontend/product deferred: add browser-level first-run UI automation after frontend/product shell work resumes.

## Next

- Use `docs/backend-status.md` as the current backend handoff and baseline document.
- Current P0/P1 pass is prepared: `unknown-audit-bedwars-current.*`, `unknown-audit-bedwars-high-current.*`, and `unknown-audit-bedwars-high-review.*` have been regenerated from report `2026-06-16T09:19:17.822Z`; label/status validation passes and correctly reports `needs_labeling`.
- Close the unknown audit loop after human review: label `unknownAudit` samples, draft candidate user rules, dry-run them, then enable only safe rules.
- Improve BedWars unknowns from reviewed evidence rather than external winner broadcasts.
- Keep product shell / installer / first-run UI automation paused until frontend work resumes.
- Collect more `/api/performance` refresh samples before considering SQLite.
