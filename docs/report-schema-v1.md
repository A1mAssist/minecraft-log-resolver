# Report Schema v1

Stable top-level shape for `minecraft-log-observatory-report`.

`minecraft-log-observatory-summary` is a compact companion schema generated beside the full report. It includes `schema`, `generatedAt`, `overview`, `rounds`, `accounts`, `confidence`, `topScopes`, `topDays`, and `anomalies`.

## Top-Level Fields

- `schema`: schema metadata.
- `version`: report payload version, currently `1`.
- `generatedAt`: ISO timestamp when the report was generated.
- `roots`: scanned `.minecraft` roots.
- `encoding`: log encoding used by the scan.
- `selectedRuleSets`: enabled rule sets, or `"all"`.
- `inputs`: normalized scan/config inputs used by app status to detect when a report is stale, including bundled rule file hashes, configured custom rule paths, and per-file custom rule content hashes when custom rules are loaded.
- `overview`: global totals intended for dashboards.
- `bySource`: totals grouped by Minecraft root/client source.
- `byScope`: totals grouped by source + version/scope.
- `byDay`: daily time series.
- `byWeek`: weekly time series derived from `byDay`.
- `byMonth`: monthly time series derived from `byDay`.
- `confidence`: confidence policy and distribution for inferred rounds.
- `results`: win/loss coverage and matched result-signal diagnostics.
- `activity`: continuous-mode segments for modes that do not have match-style win/loss rounds, currently including The Pit. These segments are also mirrored into reliable round statistics with `result: "not_applicable"` so combat and duration count toward mode/KD totals without affecting win/loss coverage.
- `profile`: frontend-ready career/profile highlights derived from the stable report data.
- `rounds`: full round data split into `reliable`, `ignored`, and `all`.
- `accounts`: local usernames observed from `Setting user:` lines.
- `rules`: rule coverage and match statistics.
- `anomalies`: diagnostic data for suspicious or uncovered logs.
- `raw`: parser-level data that is useful for debugging but not required by UI.

## Rounds

`rounds.summary` contains global round totals.

`rounds.reliable` contains rounds included in main stats.

`rounds.ignored` contains all low-confidence or invalid-duration rounds. These are preserved for review and are not included in the main totals.

`rounds.all` contains every inferred round in a normalized shape.

`rounds.allRef` and `raw.roundsRef` both point to `rounds.all`.

Each round has:

- `key`
- `source`
- `scope`
- `startAt`
- `endAt`
- `durationSeconds`
- `duration`
- `confidence`: `high`, `medium`, or `low`
- `ignoredReason`: why a round is excluded from main stats, or `null` for reliable rounds
- `parserConfidence`
- `startReason`
- `endReason`
- `kills`
- `deaths`
- `bedDestroys`
- `selfKills`
- `selfDeaths`
- `selfDeathSignals`: local-only death/spectator-style signals that are not counted as public death stats
- `selfBedDestroys`: compatibility field for beds destroyed by the owner/player
- `playerBedDestroys`: recommended public/API field for beds destroyed by the owner/player; equals `selfBedDestroys`
- `result`: `win`, `loss`, `unknown`, `ambiguous`, or `not_applicable`
- `resultReason`: rule ID or inference source for a known/ambiguous result
- `resultEligible`: `false` for non-win/loss continuous activity rows such as The Pit; result coverage and unknown rate use only result-eligible rows
- `roundKind`: `match` for normal match-style rounds, `activity` for continuous-mode statistical rows
- `resultHint`: diagnostic hint for unknown rounds, or `null` when the result is already known
- `unknownAudit`: privacy-safe audit category, next action, and feature summary for reliable unknown rounds, or `null` for known results and ignored rounds
- `gameMode`: normalized game mode ID, such as `bedwars`, `skywars`, `duels`, `murder_mystery`, or `unknown`
- `sessionAlias`: compatibility alias for the local launcher/session user observed in the log.
- `localUser`: local launcher/session user observed from the client log.
- `localUsers`: local launcher/session user counts seen inside the round.
- `launcherUser`: normalized public name for the launcher/local layer; usually the same as `localUser`.
- `launcherUsers`: launcher/local user counts used for identity fallback.
- `serverPlayerId`: best-known server-side in-game player ID, or `null` when not safely known.
- `serverPlayerIds`: direct server-side self ID evidence counts.
- `serverPlayerIdSource`: `direct_self_event`, `launcher_user_fallback`, `none_localserver_requires_self_evidence`, or `none`.
- `serverPlayerIdConfidence`: `high`, `medium`, or `none`.
- `serverIdentityContext`: `launcher_alt_likely` or `localserver_likely`.
- `serverPlayerIdPolicy`: short machine-readable policy explaining why the ID was or was not selected.
- `ownerAliasesUsed`: direct self aliases seen in matched chat events.
- `joins`
- `leaves`
- `roundStarts`
- `roundEnds`
- `boundaryEvents`: compact evidence for the start/merge/end boundary events used by the round builder
- `killers`
- `victims`
- `bedDestroyers`
- `punishedPlayers`
- `punishedExit`: evidence for a punishment followed by a client/account/server transition, or `null`
- `teamEliminations`
- `bedDestroyedTeams`
- `resultEvidence`: compact evidence used by the result resolver
- `ownerBedDestroyed`
- `ownerTeamEliminated`
- `ownFinalDeaths`
- `filePath`
- `lineNo`

## Main Stat Policy

Main totals use `rounds.reliable` only.

`rounds.ignored` and `anomalies.ignoredRounds` are preserved for inspection and future rule tuning.

Countdown-only waiting-room segments are ignored. A `round_countdown` can anchor the start time of a real round, but it does not make a round reliable unless the same segment also has a result, a real `round_start`, combat/objective events, or self stats. Common `ignoredReason` values include `test_server`, `waiting_only`, `started_without_gameplay`, `short_unowned_combat`, `short_unowned_bedwars_no_result_evidence`, `short_unowned_bedwars_non_owner_punishment_noise`, `short_unowned_solo_lobby_fragment`, `no_reliable_signal`, `too_short`, `too_long`, and `parser_low_confidence`.

Test or anti-cheat sandbox servers are excluded from main statistics with `ignoredReason: "test_server"` when server address, server label, server network, source, scope, or server evidence contains a test/testserver server-context marker. The original round remains available under `rounds.ignored`; raw Minecraft logs are not modified.

When a following `round_countdown` closes a round, the parser prefers the previous round's last gameplay timestamp over the next countdown timestamp. This keeps lobby/waiting time from inflating the previous round duration.

When a `round_end` summary line cannot be tied to the owner account, the parser keeps the round open for a short grace window so direct client result lines such as `You won! Want to play again? Click here!` can still attach to the same round. If no direct result arrives, the round closes at the original `round_end` timestamp.

Win/loss totals are conservative. Explicit result messages such as `VICTORY!`, `DEFEAT!`, `You won`, `You lost`, `胜利`, and `失败` are counted directly. Some round-end messages are context-inferred only when the meaning is narrow enough, such as `Winner: PLAYERS`. Otherwise the round stays `unknown`.

Server-wide or cross-room winner broadcasts are not allowed to close a round unless the winner can be tied to the owner account. Non-owner winner-on-map messages are preserved in `resultEvidence` as `external_winner_broadcast` background evidence, but they keep the round result unchanged and do not produce an unknown-result review hint.

`rounds.summary.gameModes` groups reliable match-style rounds and non-result activity rows by normalized game mode. Current mode detection covers common servers and modes including Bed Wars, SkyWars, Duels, The Bridge, UHC, Survival Games, Murder Mystery, Build Battle, TNT games, Arcade variants, SkyBlock, The Pit, SMP, and singleplayer-like labels. Continuous modes such as The Pit are tracked under `activity` and mirrored into `rounds.reliable` / mode stats with `roundKind: "activity"`, `result: "not_applicable"`, and `resultEligible: false`.

`results.summary.knownResultRate` is the share of result-eligible reliable rounds with a known result. Non-result activity rows are counted in `reliableRounds`, `nonResultRounds`, and `notApplicableResults`, but they do not change `unknownResults`, win rate, or known-result rate. `results.signals` is broader: it lists every matched `win`, `loss`, or `round_end` chat signal, including result messages that could not be safely attached to a reliable round.

`results.unknownHints` groups reliable unknown-result rounds into diagnostic buckets such as `probably_loss`, `probably_win`, and `keep_unknown`. It also includes `byReason`, keyed by the exact diagnostic `round.resultHint.reason`, so review screens can focus queues such as low-evidence pseudo-round candidates or self-death boundary candidates. These hints are intentionally not counted as wins or losses; they exist for review screens and future rule work.

`results.unknownAudit` groups reliable unknown-result rounds into privacy-safe audit queues. Categories include `bedwars_no_safe_result_evidence`, `bedwars_low_evidence_pseudo_candidate`, `bedwars_self_death_boundary_review`, `bedwars_team_win_low_confidence_review`, and `non_bedwars_remaining_unknown`; next actions include `label_sample`, `review_owner_identity`, `review_rule_candidate`, and `keep_unknown`. Each audit row also includes `reviewPriority` (`high`, `medium`, or `low`) plus a short `reviewReason` so clients can sort manual review queues before labeling. Audit features summarize mode, duration, ending reason, owner/team/self-action signals, and result evidence kinds. They do not change `round.result`, `ignoredReason`, round splitting, or win/loss totals.

Punishment messages like `玩家xxx在本局游戏中行为异常, 已被踢出游戏并封禁处罚` are treated as a loss when `xxx` is the current local user or an explicit owner alias. If the punished display name is not known, the parser only infers an owner loss when that punishment is followed within a short window by a client/account/server transition and no later gameplay/result signal appears in the same round. That evidence is preserved as `punishedExit`.

BedWars result inference also tracks owner team evidence from explicit team assignment and from team tags on self kill/death chat lines. A round is resolved as loss when the owner team is eliminated. If the owner has a final death, or the owner bed is destroyed and the owner later dies, the resolver can infer a loss when the next clear boundary arrives without a result message. These inferences are recorded in `resultEvidence`.

BedWars can also infer a win at a clear boundary when the owner team is known, the owner team was not eliminated, and every enemy team in a known 4-team or Hypixel-style 8-team universe has a team-eliminated signal. Custom or unknown team colors keep the result unknown.

## Player Identity

The report separates launcher/local identity from server-side in-game identity. `sessionAlias`, `localUser`, and `launcherUser` describe the local client or launcher layer, including `Setting user:` values. `serverPlayerId` describes the display name actually observed inside server chat after joining a server.

Direct self evidence wins. If a matched chat event says the owner killed, died, or broke a bed as a particular displayed player name, that name is recorded in `serverPlayerIds` and selected as `serverPlayerId` with `serverPlayerIdSource: direct_self_event`.

Launcher fallback is intentionally limited. In Hypixel/normal launcher-alt contexts, the parser may use `launcherUser` as `serverPlayerId` with medium confidence when no direct self chat evidence exists. In NetEase, HuaYuTing, HYT, and localserver-like contexts, the parser does not use the launcher name as the server player ID unless direct self evidence appears, because proxy/alt-manager flows can change the in-game ID after connect.

## Activity

`activity` keeps continuous-mode source segments for modes such as The Pit, where logs usually contain streak/combat activity but no stable match start, match end, win, or loss. The same segments are mirrored into reliable statistics as `not_applicable` rows so The Pit kill/death data appears in totals and mode views.

`metricDefinitions` is present on the full report, summary, profile, and split store. It explains whether a metric is player-owned, observed from server chat, result-eligible-only, or non-result activity so clients do not display observed broadcasts as personal records.

`activity.summary` includes segment count, duration, kills, deaths, self kills/deaths, mode signals, streak points, explicit reward event count, parsed The Pit reward economy totals, owner-bound bounty claim totals, megastreak count, and `gameModes`. `rewardEvents` counts clear activity reward prompts such as The Pit kill/assist rewards, gold pickups, free XP, death-streak rewards, or streak-point awards; it is not a gold/XP total. `goldEarned` and `xpEarned` sum explicit The Pit player reward amounts parsed from chat, not the player's complete economy ledger. Owner-bound The Pit `BOUNTY CLAIMED` broadcasts increment `bountyClaims`, `bountyGoldEarned`, and `goldEarned`; bounty-created, bounty-bump, prestige, and temporary event notices remain diagnostic-only unless they become separately owner-bound. `playerMaxKillStreak` is the confirmed owner/player kill streak. `observedBroadcastMaxKillStreak` is the highest server broadcast streak observed in chat, and legacy `maxStreak` is kept only as that broadcast value, not as a personal metric.

`activity.segments` contains each inferred continuous-mode segment with start/end timestamps, duration, source, scope, file, mode, local user, the same launcher/server identity fields used by rounds, combat stats, streak stats, matched rule counts, and short evidence examples.

The Pit bounty-created, bounty-bump, prestige, and temporary event notice rules use diagnostic event types. They can extend or explain activity segments, but they do not change personal kill/death, personal kill streak, reward totals, or win/loss/unknown result coverage. The narrow exception is owner-bound bounty-claim income, which is counted in the bounty fields and included in `goldEarned`.

The Pit activity currently starts from signals such as `PIT!`, `STREAK!`, `MEGASTREAK!`, `Streak Points`, `KILL STREAK`, Battle Pit entry text, and HuaYuTing/Chinese `天坑乱斗` kill and streak messages. Segments close on server/client/world transitions, another known mode, or a long gap. The Pit remains excluded from win/loss/unknown result coverage.

## Profile

`profile` is a compact career/profile section intended for the dashboard and share-card UI. It is derived from `overview`, `byDay`, `byScope`, `rounds.reliable`, and `accounts`.

It includes:

- `totals`: first/last played timestamps, ID count, client starts, server connects, client sessions, play segments, crashes, reliable rounds, known-result count, win rate, and win/loss/unknown totals.
- `days.longestPlaytime`: day with the most total playtime.
- `days.longestMultiplayerPlaytime`: day with the most multiplayer playtime.
- `days.longestSingleplayerPlaytime`: day with the most singleplayer playtime.
- `days.mostRounds`: day with the most reliable rounds.
- `days.latestPlayed`: latest calendar day with playtime.
- `days.latestLocalEnd`: play segment or session that ended latest by local late-night clock. `nightOfDate` assigns after-midnight play to the previous night for dashboard copy.
- `days.longestStreak`: longest consecutive-day play streak.
- `preferences.gameModeByRounds` and `preferences.gameModeByDuration`.
- `preferences.clientVersionByPlaytime` and `preferences.clientVersionByRounds`.
- `extremes.longestSession`, `extremes.shortestSession`, `extremes.longestPlaySegment`, `extremes.shortestPlaySegment`, `extremes.longestMatch`, and `extremes.shortestMatch`.
- `identities`: per-local-ID playtime, sessions, reliable round count, kills, deaths, bed destroys, and result totals. It also includes top-ID lists by playtime, rounds, kills, deaths, and wins.

## Rule Debugging

`rules.topUnmatchedByCategory` groups the retained top unmatched chat templates into coarse buckets. `rules.unmatchedByCategory` is kept as a compatibility alias for the same data:

- `possible_bedwars_objective`
- `possible_combat`
- `possible_round_state`
- `possible_presence`
- `possible_reward`
- `client_mod_noise`
- `separator_noise`
- `unknown`

`anomalies.unmatchedTemplates` keeps the top unmatched templates with category labels and examples.

`rules.quality` is a report-local rule quality summary for the rule sets that were enabled during this scan. It is diagnostic only and does not change parsing, round splitting, or official results. It includes:

- `totalRules`, `hitRules`, and `zeroHitRules`.
- `byRiskGroup`, using `safe_result`, `boundary_only`, `diagnostic_only`, and `experimental`.
- `byType`, compatibility-facing `byRuleSet`, and physical-pack `byRulePack` counts.
- `duplicatePatterns` for exact duplicate regex/type/flag combinations.
- `topHitRules`, `zeroHitSamples`, `resultImpactRules`, and `boundaryImpactRules`.

Each listed rule has a stable `key` in `rulePack:ruleId` form, compatibility `ruleSet`, physical `rulePack`, a `hitCount`, a `riskGroup`, and an `impact` block showing matched chat lines, direct result signals, official result evidence usage, and boundary/mode signal usage. Bundled mode rules that were migrated out of the old monolithic `game-state` pack keep legacy-compatible event `ruleSet` values where needed, while `rulePack` identifies the actual JSON pack for maintenance. Use this section to decide which rules need fixtures, pruning, or manual dry-run review before promotion.

The report CLI also supports `--unmatched-out <file>` to write a compact rule-debugging export. Each template includes a `priority` score and `ruleDraft` hint so rule work can start from likely combat/objective/round-state messages instead of client noise. Draft hints are advisory and should be reviewed against real examples before becoming bundled rules.

## Accounts

`accounts.owner` treats every username found in `Setting user:` as the same owner. It also includes explicit `owner.aliases` entries from config for server-side display names that do not appear in `Setting user:`. This matches the local-log use case where these names are all accounts or offline names used by the same player. The display name comes from `owner.displayName` in config.

`accounts.owner.eventStats` contains direct matched chat-event totals for all local users. `accounts.owner.rounds` contains reliable-round-only totals and is the safer source for dashboards that summarize BedWars performance.

`accounts.owner.observedFiles` is the unique number of log files with owner events. `accounts.owner.observedFileRefs` preserves the per-local-user file reference count.

`accounts.localUsers` still lists each raw username for traceability.

`accounts.aliases` lists explicit config aliases. `accounts.aliasCandidates` is currently empty in the report itself. Run `npm run owner:aliases -- --mode bedwars` to export diagnostic alias candidates under `labeling/`; this command does not mutate config. Similarity-based alias detection is intentionally disabled to avoid accidental stat pollution.

## Configuration

The default shareable config file is `minecraft-log-resolver.config.json`.

The loader also reads `minecraft-log-resolver.local.json` beside it when present, or the path named by top-level `localConfig`. This local file is for machine-specific values such as `.minecraft` roots and owner aliases. It should not be committed or shared.

Supported fields:

- `roots`: default `.minecraft` roots to scan.
- `encoding`: default log encoding.
- `rules`: enabled rule set IDs. Empty means all bundled rules.
- `customRules`: custom rule pack JSON files or directories. Empty means no custom packs.
- `scopes`: enabled scopes/version folders. Empty means all scopes.
- `unmatchedTemplatesLimit`: number of unmatched templates to keep.
- `owner.mode`: owner aggregation mode. Currently supported: `all_local_users`.
- `owner.displayName`: display name for the aggregate owner account.
- `owner.aliases`: explicit server-side display names to treat as the owner during winner-name inference. Use this for nicked/offline/server display names that do not appear in `Setting user:`.
- `cache.parse`: session/playtime parse cache path.
- `cache.chat`: chat event cache path.
- `outputs.report`: default full report output path.
- `outputs.summary`: default summary report output path.

Precedence is always: CLI argument > local config file > shareable config file > built-in default.

Relative paths in config are resolved from the config file directory.
