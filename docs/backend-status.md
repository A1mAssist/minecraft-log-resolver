# Backend Status

Updated: 2026-06-16

This document is the current backend handoff entrypoint. It summarizes what is already usable, the latest accuracy/performance baseline, and the safest next work.

The current working-tree release boundary draft can be regenerated with `npm.cmd run release:notes -- --out artifacts/release-boundary-draft.md`.

## Product Scope

- Local offline tool for one user on one machine.
- Raw Minecraft logs are read-only. Reports, caches, split store, refresh history, diagnostics packages, and exports are derived data and can be regenerated.
- Backend remains a dependency-free Node.js ESM HTTP API by default.
- Data layer remains JSON/JSONL. Evaluate SQLite only when `/api/performance` reports sustained split-store size or read-latency pressure.
- Default API bind policy is local-only: `127.0.0.1`, with local port fallback recorded in `.cache/api-server.json`.

## Current Baseline

Source: `report-combined.json`, generated `2026-06-16T09:19:17.822Z`.

| Metric | Value |
| --- | ---: |
| Reliable rounds | 992 |
| Result-eligible rounds | 841 |
| Non-result activity rounds | 151 |
| Known result rounds | 751 |
| Unknown result rounds | 90 |
| Unknown rate | 10.70% |
| Wins | 437 |
| Losses | 314 |
| Ambiguous results | 0 |
| Not-applicable results | 151 |

Mode highlights:

| Mode | Rounds | Wins | Losses | Unknown | Unknown rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bed Wars | 395 | 158 | 150 | 87 | 22.03% |

Team/color attribution note:

- Non-BedWars reliable rounds with `ownerTeam`: `52` total (`mega_walls=32`, `the_walls=17`, `mini_walls=3`).
- `3` of those now come from the shared `generic_hypixel_team_chat` rule (`[COLOR] Player: message`) via `owner_team_from_team_chat_channel`.
- This attribution is diagnostic/context only for non-BedWars team chat. It does not broaden official win/loss inference; non-BedWars team-winner summaries still need explicit team assignment evidence before they can resolve a result.
- Current chat rule coverage after this pass: `chatMatched=65,314`, `chatMatchRate=0.2338`.

Test and anti-cheat sandbox servers are excluded from official round totals:

- `test_server` ignored rounds: 4
- Known test label: `Loyisa's Test Server`
- Known test address: `testserver.loyisa.cn:1337`

The Pit is correctly modeled as continuous activity mirrored into reliable non-result stats:

- The Pit reliable activity rounds: 151
- The Pit result-eligible rounds: 0
- The Pit not-applicable results: 151
- The Pit unknown results: 0
- The Pit activity segments: 151
- The Pit activity duration: `35h 11m`
- The Pit kills/deaths: 11,630 / 66
- Parsed The Pit activity economy totals currently read as `rewardEvents=468`, `goldEarned=8,316.28`, `xpEarned=5,255`, `bountyClaims=2`, and `bountyGoldEarned=1,000` on this refreshed report. The fields sum explicit player reward prompts such as kill/assist rewards, gold pickups, free XP, death-streak rewards, reward summaries, and owner-bound bounty-claim income; they are still not a full player economy ledger.
- The Pit bounty-created, bounty-bump, prestige, and temporary event notices remain diagnostic activity signals. They explain/extend activity segments but do not change personal kill/death, personal kill streak, `rewardEvents`, `xpEarned`, or win/loss/unknown result coverage; only confirmed owner-bound bounty claims increment `bountyClaims`, `bountyGoldEarned`, and `goldEarned`.

## Rule Pack Split

Bundled rules are now physically split by game mode while preserving old `game-state` compatibility:

- Shared/common rules remain in `src/parser/rules/game-state.json`.
- Mode packs include `bedwars`, `skywars`, `duels`, `mega_walls`, `mini_walls`, `the_pit`, `blitz_sg`, `bridge`, `build_battle`, `hide_and_seek`, `murder_mystery`, `speed_uhc`, `the_walls`, and `uhc`.
- `minecraft-combat` remains a separate generic combat pack.
- Default parsing and explicit `ruleSets: ["game-state"]` keep migrated rule events compatible by reporting legacy `ruleSet: "game-state"` where needed.
- Events also expose `rulePack`, the physical JSON pack that matched the line. Explicit mode selection such as `ruleSets: ["skywars"]` reports `ruleSet: "skywars"` and `rulePack: "skywars"`.
- Report/API rule quality now exposes physical-pack maintenance fields: `rules.byRulePack`, `rules.byRulePackId`, and `rules.quality.byRulePack`.
- `npm.cmd run test:rules` now includes a structural invariant: `game-state` and `minecraft-combat` may not declare `payload.gameMode`, and each mode pack may only declare its own normalized mode. This prevents mode rules from drifting back into the shared pack.
- `npm.cmd run test:rules` also locks representative default and direct-selection events against their physical `rulePack`, so migrated rules keep legacy `ruleSet: "game-state"` for compatibility while still proving the real mode JSON pack that matched.
- Current `rules.quality.zeroHitSamples` are guarded by rule-id-locked fixtures in `test:rules`; if the zero-hit maintenance queue changes, the guard now forces the fixture list to be reviewed.

Current bundled packs from `rules.available`:

```text
game-state
bedwars
skywars
duels
mega_walls
mini_walls
the_pit
blitz_sg
bridge
build_battle
hide_and_seek
murder_mystery
speed_uhc
the_walls
uhc
minecraft-combat
```

## Unknown Audit Queue

Unknown audit is diagnostic only. It does not change `round.result`, `ignoredReason`, round splitting, or win/loss totals.

Current counts:

| Category | Count | Main next action |
| --- | ---: | --- |
| `bedwars_no_safe_result_evidence` | 63 | `label_sample` |
| `bedwars_low_evidence_pseudo_candidate` | 21 | `label_sample` |
| `bedwars_self_death_boundary_review` | 2 | `review_owner_identity` |
| `bedwars_team_win_low_confidence_review` | 1 | `review_owner_identity` |
| `non_bedwars_remaining_unknown` | 3 | `review_rule_candidate` |

Priority counts:

| Priority | Count | Meaning |
| --- | ---: | --- |
| `high` | 3 | Owner-identity review can decide whether existing evidence is promotable or should stay unknown. |
| `medium` | 87 | Rule/pseudo-round/sample labeling work that needs manual pattern review. |

Current exports:

- `labeling/unknown-audit-bedwars-current.json`
- `labeling/unknown-audit-bedwars-current.jsonl`
- `labeling/unknown-audit-bedwars-current.csv`
- `labeling/unknown-audit-bedwars-high-current.json`
- `labeling/unknown-audit-bedwars-high-current.jsonl`
- `labeling/unknown-audit-bedwars-high-current.csv`
- `labeling/unknown-audit-bedwars-high-review.json`
- `labeling/unknown-audit-bedwars-high-review.jsonl`
- `labeling/unknown-audit-bedwars-high-review.csv`
- `labeling/unknown-audit-bedwars-high-review.review.md`
- `labeling/unknown-audit-bedwars-high-review.labels.jsonl`
- `labeling/activity-review-the-pit-current.json`
- `labeling/activity-review-the-pit-current.jsonl`
- `labeling/activity-review-the-pit-current.csv`

Latest label validation status, refreshed against report `2026-06-16T09:19:17.822Z`:

- `npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-current.jsonl` passes with `87` valid rows, `0` labeled rows, and `0` errors.
- `npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl` passes with `3` valid rows, `0` labeled rows, and `0` errors.
- `npm.cmd run result:audit-status -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl` reports `needs_labeling`, `requiresHumanInput: true`, `canDraftRules: false`, and `canRunDryRun: false`.
- This is the expected stop point for the backend-only pass: the queue is valid and ready for review, but the 3 high-priority rows still need human labels before any draft/dry-run can safely proceed.

The three high-priority rows should not be auto-labeled by backend heuristics:

- `c81d84acf5954be5`: likely loss-shaped BedWars self-death/crash case, but promotion depends on confirming owner identity in the observed player/team evidence.
- `34d51f706e1a55eb`: likely loss-shaped BedWars self-death/server-connect case, but review packet shows noisy local-proxy/HuaYuTing context and after-boundary spectator lines, so owner identity still needs human confirmation.
- `3d1e7d5528e0ccba`: low-confidence team-win review with repeated `You are now a ghost.` / bot context; do not promote to win/loss without human review.

These exports are review work queues, not just diagnostics. JSON includes schema `minecraft-log-observatory-unknown-audit-export` version 2 and a `review` contract. Each row carries `unknownAudit.reviewPriority`, `unknownAudit.reviewReason`, `allowedReviewLabels`, `suggestedReviewLabel`, empty `reviewLabel` / `reviewNotes`, and optional draft helper fields (`message`, `ruleId`, `confidence`, `negativeExamples`) so reviewed files can go directly into `result:audit-labels` and `rules:audit-workflow`.

Useful command:

```bat
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current
npm.cmd run result:audit -- --mode bedwars --priority high --prefix unknown-audit-bedwars-high-current
npm.cmd run result:audit -- --mode bedwars --priority high --include-context --review-packet --label-template --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review
```

For local-only manual review, add bounded context explicitly. `--display-encoding utf-8` only repairs selected review-context display text when the parser encoding produced mojibake; it does not change report/store/statistics.

```bat
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current --include-context --display-encoding utf-8 --before-ms 0 --after-ms 120000 --context-lines 80
```

The context/review-packet mode may include cleaned raw chat text in `contextLines` and `.review.md`; keep it local. The default command remains privacy-safe and does not export raw chat context. Add `--label-template` to write a compact `<prefix>.labels.jsonl` file that reviewers or the frontend can fill with `reviewLabel` / `reviewNotes` and validate with `result:audit-labels`.

The CLI audit workflow now has an end-to-end fixture test for `reviewed labels -> draft rule pack -> dry-run artifact`. The test asserts that official report, summary, local config, rule packs, and store data are not written by the workflow; only explicit workflow artifacts and isolated dry-run caches are allowed.

OpenAPI/docs now expose named responses for `/api/unknown-audit/labels`, `/api/unknown-audit/status`, and `/api/rules/audit-workflow`, including `UnknownAuditLabelsResponse`, `UnknownAuditStatusResponse`, `RuleAuditWorkflowResponse`, `AuditWorkflowArtifactSummary`, label readiness statuses (`needs_labeling`, `needs_rule_text`, `ready_for_workflow`, `ready_keep_unknown_only`), and the `missing_rule_text` workflow state. `/api/unknown-audit/status` is the thin readiness preflight for frontend/local UI flows that only need the next step before drafting or dry-running. The API contract now makes the review queue and draft workflow easier for frontend typing without changing runtime behavior.

Frontend/manual review can now persist local labeling progress through `GET/POST /api/unknown-audit/label-sets` and `GET|PUT|DELETE /api/unknown-audit/label-sets/{id}`. These label sets live under derived app data, validate the same review rows as `/api/unknown-audit/labels`, return readiness summaries, and never write report/store/config/rules or raw logs. The concise frontend handoff is `docs/frontend-api-contract.md`.

## Activity Review Queue

`npm.cmd run activity:review` exports continuous-mode activity segments for manual review without changing statistics. It reads only the current report and writes JSON/JSONL/CSV under `labeling/`.

Current The Pit export:

```bat
npm.cmd run activity:review -- --mode the_pit --prefix activity-review-the-pit-current
```

Latest output from the current report:

- Exported segments: `151`
- Segments with rewards/economy signals: `12`
- Segments with diagnostic activity rules such as bounty/prestige/minor-event notices: `12`
- Segments with owner id confidence above `none`: `134`
- Max player kill streak in exported segments: `50`
- Max observed broadcast kill streak: `630`
- Reward totals in export: `rewardEvents=468`, `goldEarned=8,316.28`, `xpEarned=5,255`, `bountyClaims=2`, `bountyGoldEarned=1,000`

Default activity review output is privacy-safe for local aggregate review: it omits local `filePath` and raw `examples` messages. It keeps segment summaries, server display fields, owner-id confidence summaries, personal kill streak, observed broadcast streak, reward/economy counters, rule hit counts, and diagnostic rule ids. Add `--include-examples` only for local manual review; that mode includes example messages already stored in the derived report.

## Implemented Backend Areas

1. Report and parser pipeline
   - Full report and summary generation.
   - Reliable, ignored, and all-round sets.
   - Conservative win/loss inference with evidence and result reasons.
   - The Pit kept as continuous `activity` and mirrored into reliable stats as `not_applicable`, outside win/loss/unknown result coverage.
   - The Pit activity metrics separate player kill streaks, observed broadcast streaks, reward prompt counts, and parsed explicit player reward economy totals (`goldEarned`, `xpEarned`).

2. Local project and first-run setup
   - Local config overlay for roots, owner aliases, output names, app data dir, custom rules, and skin proxy.
   - Root validation for existence, readability, duplicate roots, log discovery, empty directories, and sample readability.
   - App status states: `first_run`, `needs_refresh`, `refreshing`, `ready`.
   - Backend directory-picker helper exists as `POST /api/system/select-directory`; it can now return root validation diagnostics with `{ "validate": true }`. Full desktop packaging and shell integration are still pending.
   - `npm.cmd run build:local-desktop` creates a local distributable folder under `dist/local-desktop`, excluding local logs and derived/private data. Passing `-- --embed-node current` copies the current Node runtime into the bundle. Native installer wrapping is deferred until frontend/product shell work resumes.
   - `npm.cmd run test:local-desktop-runtime` starts the bundle API and static frontend, then verifies first-run app status, root validation, config save, and `needs_refresh` state through the frontend proxy.

3. Refresh job lifecycle
   - `scan -> parse -> build_report -> export_store -> commit -> done`.
   - Single active refresh lock.
   - Progress, phase timings, current file, cancellation, and history.
   - Staged report/store commit so failed or cancelled refreshes preserve old derived data.

4. Derived data lifecycle
   - Split JSON/JSONL store export.
   - Store table pagination API for large lists.
   - Cleanup API with dry-run for `cache`, `report`, `store`, and `all_derived`.
   - Cleanup and writes are constrained to derived targets and never touch Minecraft log roots.

5. API hardening and privacy
   - Standard `ok: false`, `error`, `message` envelopes for common failures.
   - Request body validation, request size limits, local-only bind host, production CORS hardening.
   - Privacy-safe diagnostics and share packages with fail-closed privacy audit.
   - Skin proxy networking is configurable and exposed in status.

6. Rule ecosystem
   - Bundled, configured, and managed user rule pack metadata.
   - Bundled game-mode rules are physically split into per-mode packs, with `game-state` retained as a backward-compatible selector.
   - Parser events and rule quality reports expose `rulePack` / `byRulePack` so maintenance can target the real JSON pack without breaking legacy `ruleSet` result reasons.
   - Managed user pack save/delete/enable/disable, backup, restore, audit history.
   - Rule doctor for duplicate IDs, invalid regex, broad result rules, empty packs, and disabled user packs.
   - Rule dry-run diff API and CLI before statistics-changing rule promotion.
   - Draft-from-labels flow for turning reviewed samples into candidate rule packs.
   - Unknown-audit label validation API/CLI before draft generation, with JSON/JSONL/CSV label input support.
   - Unknown-audit export rows include a machine-readable review contract and label template fields for direct audit workflow handoff.
   - Report/API rule quality summary for enabled rule sets, including hit counts, zero-hit samples, duplicate patterns, risk groups, and result/boundary impact samples.
   - Rule quality baseline CLI with archived current snapshots and comparisons for hit/zero-hit/risk/duplicate-pattern drift.
- Rule-id-locked fixtures now cover important result/boundary rules plus additional low-hit result-impact rules, including duel fight win/loss, permanent death, spectator self-death, Chinese loss lines, token win rewards, representative physical `rulePack` ownership for split mode packs, and every current `rules.quality.zeroHitSamples` entry.
   - Rule-pack split invariants are covered in `test:rules` so shared and mode-specific packs stay separated over time.

7. Accuracy iteration
   - BedWars conservative result inference, owner/team/final-death/bed-destroy evidence, and low-evidence pseudo-round ignore rules.
   - Non-BedWars unknown diagnostics and narrow SkyWars pseudo-fragment ignore rule.
   - Non-BedWars owner-team/team-color attribution now includes shared Hypixel-style team chat (`[COLOR] Player: message`) and post-identity owner team recovery, while keeping team-chat-derived non-BedWars results unknown unless explicit assignment evidence exists.
   - Current remaining unknowns are mostly auditable BedWars cases rather than parser crashes or ambiguous outcomes.

8. Performance baseline
   - `/api/performance` reports refresh-history timing, split-store scale, JSONL page read baseline, derived cache sizes, process API JSON cache hit/miss/parse timings, saved-baseline comparison, and machine-readable recommendations.
   - `npm.cmd run performance:baseline` writes a privacy-safe baseline, archives the previous current baseline, and compares against the previous/specified baseline without scanning raw logs.

Current performance snapshot:

- Store ready: `true`
- Store files: 23
- JSONL tables: 9
- Store bytes: 6,846,024
- JSONL rows: 1,842
- Sampled table reads: 3
- Slowest sampled table read: `reliableRounds`, 50 ms
- Current recommendation: `jsonl_store_ok`.

## Verification Snapshot

Recently refreshed derived data:

```bat
npm.cmd run report -- --unmatched-out unmatched-debug.json
npm.cmd run store:export
```

Current release gate:

- `npm.cmd run release:check` passes against `report-combined.json` and `data/report-store`.
- Store manifest `storeReportGeneratedAt` matches report `generatedAt` (`2026-06-16T09:19:17.822Z`); store generated `2026-06-16T09:19:25.562Z`.
- Rule pack split smoke tests pass and assert legacy `game-state` compatibility plus direct mode-pack selection.
- API port fallback now retries Windows reserved/denied local ports (`EACCES` / `EPERM`) in addition to occupied ports before failing the local API startup.
- Rule-quality fixtures now include additional positive/negative guards for result/boundary-adjacent rules such as winner announcements, coin/token/SkyWars win rewards, generic team chat, SkyWars cage start, and The Pit streak signals.

Recently generated audit/performance outputs:

```bat
npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current
npm.cmd run result:audit -- --mode bedwars --priority high --include-context --review-packet --label-template --display-encoding utf-8 --prefix unknown-audit-bedwars-high-review --before-ms 0 --after-ms 120000 --context-lines 80
npm.cmd run activity:review -- --mode the_pit --prefix activity-review-the-pit-current
npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-current.jsonl
npm.cmd run result:audit-labels -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
npm.cmd run result:audit-status -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl
npm.cmd run store:export
npm.cmd run performance:baseline
npm.cmd run release:check
```

Release gate spot-check passed on the current artifacts:

- `ambiguousResults === 0`
- The Pit has `rounds=151`, `resultEligible=0`, `notApplicableResults=151`, `unknownResults=0`
- `/api/performance` / current baseline recommendation includes `jsonl_store_ok`
- `labeling/unknown-audit-bedwars-high-review.labels.jsonl` validates with `3` unlabeled high-priority rows and `0` errors
- `npm.cmd run result:audit-status -- --input labeling/unknown-audit-bedwars-high-review.labels.jsonl` reports `needs_labeling` for the current 3 high-priority rows
- `npm.cmd run release:check` passes against the current report, store, performance baseline, and label template; default output is privacy-safe, while `-- --full` is for local path debugging only

Full regression verification has passed:

```bat
npm.cmd test
```

Current backend-only verification also passed:

```bat
npm.cmd run test:backend
```

Before shipping another backend change, prefer at least:

```bat
npm.cmd run test:core
npm.cmd run test:audit-export
npm.cmd run test:api
npm.cmd run test:doctor
npm.cmd run test:store
npm.cmd run test:openapi
```

Run full verification when parser, rule, API contract, refresh, store, or privacy behavior changes:

```bat
npm.cmd test
```

## Best Next Work

P0: Stabilize handoff and release boundaries.

- Keep regenerating release notes after large backend milestones so the dirty worktree remains reviewable.
- Keep this status document, `HANDOFF.md`, and `docs/backend-todo.md` aligned after each backend milestone.
- Avoid broad rewrites of older garbled docs unless the task is specifically documentation cleanup.

P1: Continue the unknown audit loop.

- Label `unknownAudit` rows in the current export work queue and validate them with `POST /api/unknown-audit/labels` or `npm.cmd run result:audit-labels`.
- Generate draft user rule packs from confirmed labels with `POST /api/rules/draft-from-labels` or `npm.cmd run rules:draft-from-labels`.
- Require rule dry-run before enabling anything that can change official statistics.
- Keep `npm.cmd run test:audit-export` green so the JSON/JSONL/CSV work queue contract does not drift.

P1: Improve BedWars unknowns conservatively.

- Start with the 63 `bedwars_no_safe_result_evidence` samples and the 21 `bedwars_low_evidence_pseudo_candidate` samples.
- Promote only rules that keep `ambiguousResults === 0`, do not increase target-mode unknowns, do not disturb non-target modes, and keep The Pit non-result (`resultEligible === 0`, `notApplicableResults === rounds`) if it appears in round mode stats.
- Continue avoiding external winner broadcasts unless owner binding is proven.

Deferred: Finish product shell integration.

- Keep `npm.cmd run build:local-desktop -- --embed-node current` available for a local distributable folder with a copied Node runtime.
- Do not wrap it in a native installer/desktop shell until frontend/product shell work resumes.
- Do not add first-run UI automation while backend-only work is the active focus.

P2: Build operational confidence.

- Collect several successful refresh history samples on warm caches.
- Use `/api/performance.recommendations` to decide whether JSONL is still enough.
- Do not introduce SQLite until store size, row count, or read latency crosses the review threshold in real usage.

P3: Broaden rule fixture coverage.

- Continue expanding positive/negative fixture coverage for important result, team, bed, final-death, and winner-broadcast rules. Current rule-id-locked fixtures cover direct win/loss, placement, team winner, BedWars final kill/death/bed/team elimination/team chat, common boundary signals, reward-based win signals, SkyWars start/reward/ELO signals, The Pit streak/activity signals, low-hit Chinese result/mode/reward lines, split mode-pack ownership, the full current zero-hit sample queue, and scoped BedWars-only fallbacks that are normally shadowed by global rules.
- Use `rules.quality.zeroHitSamples`, `resultImpactRules`, and `boundaryImpactRules` to prioritize pruning, fixture additions, and dry-run review.
- Use `npm.cmd run rules:quality-baseline` after refreshes to track longer-term quality drift across archived baselines.

## Guardrails

- Do not reset or discard existing worktree changes unless explicitly requested.
- Do not modify original Minecraft logs.
- Do not write arbitrary absolute paths from API requests.
- Do not turn `external_winner_broadcast` into official win/loss without owner-bound evidence and dry-run review.
- Do not count The Pit as win/loss/unknown. It may appear in `rounds.summary.gameModes` only as non-result activity with `result: "not_applicable"` and `resultEligible: false`.
- Keep official result inference conservative; diagnostic hints can be broader than official statistics.
