import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReportApiContext, handleReportApiRequest, sendApiResponse } from "../src/api/reportApi.mjs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const context = await createReportApiContext();

await runCorsHeaderTests();

const health = await request("/api/health");
assert.equal(health.status, 200);
assert.equal(health.body.ok, true);
assert.equal(health.body.schema.name, "minecraft-log-observatory-report");

const summary = await request("/api/summary");
assert.equal(summary.status, 200);
assert.ok(summary.body.overview);
assert.equal(summary.body.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(summary.body.metricDefinitions.observedBroadcastMaxKillStreak.scope, "observed_server_chat");
assert.equal(summary.body.metricDefinitions.playerBedDestroys.scope, "player");

const metricDefinitions = await request("/api/metrics/definitions");
assert.equal(metricDefinitions.status, 200);
assert.equal(metricDefinitions.body.source, "static_backend_contract");
assert.equal(typeof metricDefinitions.body.reportReady, "boolean");
assert.equal(metricDefinitions.body.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(metricDefinitions.body.metricDefinitions.observedBroadcastMaxKillStreak.scope, "observed_server_chat");
assert.equal(metricDefinitions.body.metricDefinitions.goldEarned.unit, "gold");
assert.equal(metricDefinitions.body.metricDefinitions.xpEarned.unit, "xp");
assert.equal(metricDefinitions.body.metricDefinitions.bountyClaims.scope, "player");
assert.equal(metricDefinitions.body.metricDefinitions.bountyGoldEarned.unit, "gold");

const refreshPreflight = await request("/api/refresh/preflight", "POST");
assert.equal(refreshPreflight.status, 200);
assert.equal(typeof refreshPreflight.body.canRefresh, "boolean");
assert.ok(Array.isArray(refreshPreflight.body.blocking));
assert.ok(refreshPreflight.body.checked);

const profile = await request("/api/profile");
assert.equal(profile.status, 200);
assert.ok(profile.body.totals);
assert.ok(profile.body.days);
assert.ok(profile.body.identities);
assert.equal(profile.body.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(profile.body.totals.playerBedDestroys, profile.body.totals.selfBedDestroys);
assert.ok(profile.body.streaks?.win?.breakUnknown, "profile must include breakUnknown win streaks");
assert.ok(profile.body.streaks?.win?.skipUnknown, "profile must include skipUnknown win streaks");
assert.ok(profile.body.streaks?.win?.break_unknown, "profile must include snake_case break_unknown win streak alias");
assert.ok(profile.body.streaks?.win?.skip_unknown, "profile must include snake_case skip_unknown win streak alias");
assert.equal(typeof profile.body.streaks?.playerMaxKillStreak?.count, "number");

const activity = await request("/api/activity?mode=the_pit&limit=3");
assert.equal(activity.status, 200);
assert.equal(activity.body.filters.mode, "the_pit");
assert.equal(activity.body.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(activity.body.metricDefinitions.observedBroadcastMaxKillStreak.scope, "observed_server_chat");
assert.equal(activity.body.metricDefinitions.maxStreak.deprecated, true);
assert.ok(activity.body.items.length <= 3);
assert.ok(activity.body.items.every((segment) => segment.mode === "the_pit"));
assert.equal(typeof activity.body.summary.playerMaxKillStreak, "number");
assert.equal(typeof activity.body.summary.observedBroadcastMaxKillStreak, "number");
assert.equal(typeof activity.body.summary.rewardEvents, "number");
assert.equal(typeof activity.body.summary.goldEarned, "number");
assert.equal(typeof activity.body.summary.xpEarned, "number");
assert.equal(typeof activity.body.summary.bountyClaims, "number");
assert.equal(typeof activity.body.summary.bountyGoldEarned, "number");
assert.ok(activity.body.items.every((segment) =>
  typeof segment.playerMaxKillStreak === "number" &&
  typeof segment.observedBroadcastMaxKillStreak === "number" &&
  typeof segment.rewardEvents === "number" &&
  typeof segment.goldEarned === "number" &&
  typeof segment.xpEarned === "number" &&
  typeof segment.bountyClaims === "number" &&
  typeof segment.bountyGoldEarned === "number"
));

const reliableRounds = await request("/api/rounds?set=reliable&limit=3");
assert.equal(reliableRounds.status, 200);
assert.equal(reliableRounds.body.set, "reliable");
assert.ok(reliableRounds.body.total >= reliableRounds.body.items.length);
assert.ok(reliableRounds.body.items.length <= 3);
assert.ok(reliableRounds.body.items.every((round) => round.playerBedDestroys === (round.selfBedDestroys ?? 0)));
assert.ok(reliableRounds.body.items.every((round) => typeof round.playerMaxKillStreak === "number"));
assert.ok(reliableRounds.body.items.every((round) =>
  typeof round.rewardEvents === "number" &&
  typeof round.streakPoints === "number" &&
  typeof round.goldEarned === "number" &&
  typeof round.xpEarned === "number" &&
  typeof round.bountyClaims === "number" &&
  typeof round.bountyGoldEarned === "number"
));
assert.ok(reliableRounds.body.items.every((round) =>
  "serverNetwork" in round &&
  "serverAddress" in round &&
  typeof round.serverLabel === "string" &&
  ["direct", "inferred", "unknown"].includes(round.serverConfidence) &&
  round.serverEvidence &&
  typeof round.serverEvidence.source === "string"
));

const modes = await request("/api/modes");
assert.equal(modes.status, 200);
assert.equal(modes.body.metricDefinitions.playerBedDestroys.scope, "player");
assert.equal(modes.body.metricDefinitions.resultEligible.scope, "round");

const allReliableRounds = await request("/api/rounds?set=reliable&limit=1000");
assert.equal(allReliableRounds.status, 200);
const pitRound = allReliableRounds.body.items.find((round) => round.roundKind === "activity" && round.gameMode === "the_pit");
if (pitRound) {
  assert.equal(typeof pitRound.rewardEvents, "number");
  assert.equal(typeof pitRound.streakPoints, "number");
  assert.equal(typeof pitRound.goldEarned, "number");
  assert.equal(typeof pitRound.xpEarned, "number");
  assert.equal(typeof pitRound.bountyClaims, "number");
  assert.equal(typeof pitRound.bountyGoldEarned, "number");
  assert.equal(pitRound.result, "not_applicable");
  assert.equal(pitRound.resultEligible, false);
}
assert.ok(allReliableRounds.body.items.every((round) =>
  !/test(?:server)?/i.test([
    round.serverAddress,
    round.serverLabel,
    round.serverNetwork,
    round.source,
    round.scope,
    round.serverEvidence?.text,
  ].filter(Boolean).join(" "))
), "reliable rounds must exclude test/testserver server contexts");

const bedwarsRounds = await request("/api/rounds?set=reliable&mode=bedwars&limit=3");
assert.equal(bedwarsRounds.status, 200);
assert.equal(bedwarsRounds.body.filters.mode, "bedwars");
assert.ok(bedwarsRounds.body.items.every((round) => round.gameMode === "bedwars"));
assert.ok(bedwarsRounds.body.items.every((round) => round.playerBedDestroys === (round.selfBedDestroys ?? 0)));

const knownResultRounds = await request("/api/rounds?set=reliable&hasKnownResult=true&limit=5");
assert.equal(knownResultRounds.status, 200);
assert.equal(knownResultRounds.body.filters.hasKnownResult, true);
assert.ok(knownResultRounds.body.items.every((round) => ["win", "loss", "ambiguous"].includes(round.result)));

const pitStatRounds = await request("/api/rounds?set=reliable&mode=the_pit&result=not_applicable&limit=5");
assert.equal(pitStatRounds.status, 200);
assert.equal(pitStatRounds.body.filters.mode, "the_pit");
assert.ok(pitStatRounds.body.total > 0);
assert.ok(pitStatRounds.body.items.every((round) =>
  round.gameMode === "the_pit" &&
  round.result === "not_applicable" &&
  round.resultEligible === false &&
  round.roundKind === "activity" &&
  typeof round.playerMaxKillStreak === "number"
));

const hintedUnknownRounds = await request("/api/rounds?set=reliable&result=unknown&resultHint=probably_loss&limit=5");
assert.equal(hintedUnknownRounds.status, 200);
assert.equal(hintedUnknownRounds.body.filters.resultHint, "probably_loss");
assert.ok(hintedUnknownRounds.body.items.every((round) => round.result === "unknown" && round.resultHint?.value === "probably_loss"));

const unknownAuditStatus = await request("/api/unknown-audit/status", "POST", {
  labels: [
    { reviewLabel: null, gameMode: "bedwars", unknownAudit: { category: "bedwars_no_safe_result_evidence", nextAction: "label_sample" } },
  ],
});
assert.equal(unknownAuditStatus.status, 200);
assert.equal(unknownAuditStatus.body.status, "needs_labeling");
assert.equal(unknownAuditStatus.body.nextStep, "label_rows");
assert.equal(unknownAuditStatus.body.blocked, true);
assert.equal(unknownAuditStatus.body.writes.report, false);

const unknownAuditStatusReady = await request("/api/unknown-audit/status", "POST", {
  labels: [{ reviewLabel: "loss", gameMode: "bedwars", message: "STATUS LOSS SAMPLE" }],
});
assert.equal(unknownAuditStatusReady.status, 200);
assert.equal(unknownAuditStatusReady.body.status, "ready_for_workflow");
assert.equal(unknownAuditStatusReady.body.canDraftRules, true);
assert.equal(unknownAuditStatusReady.body.canRunDryRun, true);

const unknownRoundWithHintReason = reliableRounds.body.summary?.unknownResults
  ? (await request("/api/rounds?set=reliable&result=unknown&limit=100")).body.items.find((round) => round.resultHint?.reason)
  : null;
if (unknownRoundWithHintReason) {
  const reason = unknownRoundWithHintReason.resultHint.reason;
  const hintedReasonRounds = await request(`/api/rounds?set=reliable&result=unknown&resultHintReason=${encodeURIComponent(reason)}&limit=10`);
  assert.equal(hintedReasonRounds.status, 200);
  assert.equal(hintedReasonRounds.body.filters.resultHintReason, reason);
  assert.ok(hintedReasonRounds.body.items.length > 0);
  assert.ok(hintedReasonRounds.body.items.every((round) => round.result === "unknown" && round.resultHint?.reason === reason));
}

const unknownAuditCategoryRounds = await request("/api/rounds?set=reliable&result=unknown&unknownAuditCategory=bedwars_no_safe_result_evidence&limit=5");
assert.equal(unknownAuditCategoryRounds.status, 200);
assert.equal(unknownAuditCategoryRounds.body.filters.unknownAuditCategory, "bedwars_no_safe_result_evidence");
assert.ok(unknownAuditCategoryRounds.body.items.every((round) =>
  round.result === "unknown" &&
  round.unknownAudit?.category === "bedwars_no_safe_result_evidence"
));

const unknownAuditNextActionRounds = await request("/api/rounds?set=reliable&result=unknown&unknownNextAction=label_sample&limit=5");
assert.equal(unknownAuditNextActionRounds.status, 200);
assert.equal(unknownAuditNextActionRounds.body.filters.unknownNextAction, "label_sample");
assert.ok(unknownAuditNextActionRounds.body.items.every((round) =>
  round.result === "unknown" &&
  round.unknownAudit?.nextAction === "label_sample"
));

const unknownAuditPriorityRounds = await request("/api/rounds?set=reliable&result=unknown&unknownReviewPriority=high&limit=5");
assert.equal(unknownAuditPriorityRounds.status, 200);
assert.equal(unknownAuditPriorityRounds.body.filters.unknownReviewPriority, "high");
assert.ok(unknownAuditPriorityRounds.body.items.every((round) =>
  round.result === "unknown" &&
  round.unknownAudit?.reviewPriority === "high"
));

const badUnknownAuditCategory = await request("/api/rounds?unknownAuditCategory=nope");
assert.equal(badUnknownAuditCategory.status, 400);
assert.equal(badUnknownAuditCategory.body.error, "invalid_rounds_query");
assert.ok(badUnknownAuditCategory.body.errors.some((item) => item.field === "unknownAuditCategory" && item.error === "unknown_value"));

const badUnknownAuditNextAction = await request("/api/rounds?unknownNextAction=nope");
assert.equal(badUnknownAuditNextAction.status, 400);
assert.equal(badUnknownAuditNextAction.body.error, "invalid_rounds_query");
assert.ok(badUnknownAuditNextAction.body.errors.some((item) => item.field === "unknownNextAction" && item.error === "unknown_value"));

const badUnknownAuditPriority = await request("/api/rounds?unknownReviewPriority=nope");
assert.equal(badUnknownAuditPriority.status, 400);
assert.equal(badUnknownAuditPriority.body.error, "invalid_rounds_query");
assert.ok(badUnknownAuditPriority.body.errors.some((item) => item.field === "unknownReviewPriority" && item.error === "unknown_value"));

const badRoundsBooleanFilter = await request("/api/rounds?hasKnownResult=maybe");
assert.equal(badRoundsBooleanFilter.status, 400);
assert.equal(badRoundsBooleanFilter.body.ok, false);
assert.equal(badRoundsBooleanFilter.body.error, "invalid_rounds_query");
assert.ok(badRoundsBooleanFilter.body.errors.some((item) => item.field === "hasKnownResult" && item.error === "expected_boolean"));

const badRoundsDurationFilter = await request("/api/rounds?minDuration=abc");
assert.equal(badRoundsDurationFilter.status, 400);
assert.equal(badRoundsDurationFilter.body.error, "invalid_rounds_query");
assert.ok(badRoundsDurationFilter.body.errors.some((item) => item.field === "minDuration" && item.error === "expected_number"));

const badRoundsNegativeDurationFilter = await request("/api/rounds?maxDuration=-1");
assert.equal(badRoundsNegativeDurationFilter.status, 400);
assert.equal(badRoundsNegativeDurationFilter.body.error, "invalid_rounds_query");
assert.ok(badRoundsNegativeDurationFilter.body.errors.some((item) => item.field === "maxDuration" && item.error === "must_be_non_negative"));

const badRoundsDurationRange = await request("/api/rounds?minDuration=20&maxDuration=10");
assert.equal(badRoundsDurationRange.status, 400);
assert.equal(badRoundsDurationRange.body.error, "invalid_rounds_query");
assert.ok(badRoundsDurationRange.body.errors.some((item) => item.field === "duration" && item.error === "min_must_be_lte_max"));

const badRoundsDateFilter = await request("/api/rounds?dateFrom=2022-02-31");
assert.equal(badRoundsDateFilter.status, 400);
assert.equal(badRoundsDateFilter.body.error, "invalid_rounds_query");
assert.ok(badRoundsDateFilter.body.errors.some((item) => item.field === "dateFrom" && item.error === "expected_date"));

const badRoundsDateRange = await request("/api/rounds?dateFrom=2022-12-31&dateTo=2022-01-01");
assert.equal(badRoundsDateRange.status, 400);
assert.equal(badRoundsDateRange.body.error, "invalid_rounds_query");
assert.ok(badRoundsDateRange.body.errors.some((item) => item.field === "date" && item.error === "from_must_be_lte_to"));

const ignoredRounds = await request("/api/rounds?set=ignored&limit=5");
assert.equal(ignoredRounds.status, 200);
assert.equal(ignoredRounds.body.set, "ignored");

const allIgnoredRounds = await request("/api/rounds?set=ignored&limit=1000");
assert.equal(allIgnoredRounds.status, 200);
assert.ok(allIgnoredRounds.body.items.some((round) => round.ignoredReason === "test_server"));
assert.ok(allIgnoredRounds.body.items
  .filter((round) => round.ignoredReason === "test_server")
  .every((round) => /test(?:server)?|测试|mc32\.rhymc\.com|反作弊测试服务器/i.test([
    round.serverAddress,
    round.serverLabel,
    round.serverNetwork,
    round.source,
    round.scope,
    round.serverEvidence?.text,
  ].filter(Boolean).join(" "))));

const badRoundPagination = await request("/api/rounds?limit=0");
assert.equal(badRoundPagination.status, 400);
assert.equal(badRoundPagination.body.ok, false);
assert.equal(badRoundPagination.body.error, "invalid_pagination");
assert.ok(badRoundPagination.body.errors.some((item) => item.field === "limit" && item.error === "too_small"));

const badSourcePagination = await request("/api/sources?offset=abc");
assert.equal(badSourcePagination.status, 400);
assert.equal(badSourcePagination.body.ok, false);
assert.equal(badSourcePagination.body.error, "invalid_pagination");
assert.ok(badSourcePagination.body.errors.some((item) => item.field === "offset" && item.error === "expected_integer"));

const badRoundSet = await request("/api/rounds?set=nope");
assert.equal(badRoundSet.status, 400);
assert.equal(badRoundSet.body.ok, false);
assert.equal(badRoundSet.body.error, "invalid_round_set");
assert.equal(typeof badRoundSet.body.message, "string");

const missingSkinSource = await request("/api/skin");
assert.equal(missingSkinSource.status, 400);
assert.equal(missingSkinSource.body.ok, false);
assert.equal(missingSkinSource.body.error, "missing_skin_source");
assert.equal(typeof missingSkinSource.body.message, "string");

const invalidSkinKind = await request("/api/skin?kind=nope&source=Steve");
assert.equal(invalidSkinKind.status, 400);
assert.equal(invalidSkinKind.body.ok, false);
assert.equal(invalidSkinKind.body.error, "invalid_skin_kind");
assert.equal(typeof invalidSkinKind.body.message, "string");

const invalidSkinName = await request("/api/skin?kind=player&source=%E7%8E%A9%E5%AE%B6");
assert.equal(invalidSkinName.status, 400);
assert.equal(invalidSkinName.body.ok, false);
assert.equal(invalidSkinName.body.error, "invalid_player_name");
assert.equal(typeof invalidSkinName.body.message, "string");

const missingMinecraftProfileName = await request("/api/minecraft-profile");
assert.equal(missingMinecraftProfileName.status, 400);
assert.equal(missingMinecraftProfileName.body.ok, false);
assert.equal(missingMinecraftProfileName.body.error, "missing_minecraft_username");

const invalidMinecraftProfileName = await request("/api/minecraft-profile?username=%E7%8E%A9%E5%AE%B6");
assert.equal(invalidMinecraftProfileName.status, 400);
assert.equal(invalidMinecraftProfileName.body.ok, false);
assert.equal(invalidMinecraftProfileName.body.error, "invalid_minecraft_username");

const accounts = await request("/api/accounts");
assert.equal(accounts.status, 200);
assert.equal(accounts.body.owner.mode, "all_local_users");

const owner = await request("/api/accounts/owner");
assert.equal(owner.status, 200);
assert.equal(owner.body.mode, "all_local_users");

const accountPlaytime = await request("/api/accounts/playtime?limit=5");
assert.equal(accountPlaytime.status, 200);
assert.ok(accountPlaytime.body.items.length <= 5);
if (accountPlaytime.body.items.length) {
  assert.ok("playtimeSeconds" in accountPlaytime.body.items[0]);
}

const sources = await request("/api/sources?limit=2");
assert.equal(sources.status, 200);
assert.ok(sources.body.items.length <= 2);

const scopes = await request("/api/scopes?source=Neon&limit=3");
assert.equal(scopes.status, 200);
assert.ok(scopes.body.items.every((scope) => scope.source === "Neon"));

const days = await request("/api/days?dateFrom=2022-01-01&dateTo=2022-12-31&limit=5");
assert.equal(days.status, 200);
assert.ok(days.body.items.every((day) => day.date >= "2022-01-01" && day.date <= "2022-12-31"));

const badDaysDateFilter = await request("/api/days?dateFrom=2022-02-31");
assert.equal(badDaysDateFilter.status, 400);
assert.equal(badDaysDateFilter.body.ok, false);
assert.equal(badDaysDateFilter.body.error, "invalid_days_query");
assert.ok(badDaysDateFilter.body.errors.some((item) => item.field === "dateFrom" && item.error === "expected_date"));

const badDaysDateRange = await request("/api/days?dateFrom=2022-12-31&dateTo=2022-01-01");
assert.equal(badDaysDateRange.status, 400);
assert.equal(badDaysDateRange.body.ok, false);
assert.equal(badDaysDateRange.body.error, "invalid_days_query");
assert.ok(badDaysDateRange.body.errors.some((item) => item.field === "date" && item.error === "from_must_be_lte_to"));

const modesAgain = await request("/api/modes");
assert.equal(modesAgain.status, 200);
assert.ok(modesAgain.body.items);
if (modesAgain.body.items.bedwars) {
  assert.equal(modesAgain.body.items.bedwars.playerBedDestroys, modesAgain.body.items.bedwars.selfBedDestroys);
}

const results = await request("/api/results");
assert.equal(results.status, 200);
assert.ok(results.body.summary);
assert.ok(results.body.signals);
assert.ok(results.body.unknownAudit);
assert.equal(results.body.unknownAudit.total, results.body.summary.unknownRoundResults);
assert.equal(results.body.unknownAudit.byCategory.bedwars_no_safe_result_evidence, 69);
assert.equal(results.body.unknownAudit.byCategory.bedwars_low_evidence_pseudo_candidate, 10);
assert.equal(results.body.unknownAudit.byCategory.bedwars_self_death_boundary_review, 2);
assert.equal(results.body.unknownAudit.byCategory.bedwars_team_win_low_confidence_review, 1);
assert.equal(results.body.unknownAudit.byCategory.non_bedwars_remaining_unknown, 12);
assert.ok(results.body.unknownAudit.byPriority);
assert.ok(Object.keys(results.body.unknownAudit.byPriority).every((key) => ["high", "medium", "low"].includes(key)));
assert.equal(Object.values(results.body.unknownAudit.byPriority).reduce((total, count) => total + count, 0), results.body.unknownAudit.total);
assert.ok(Array.isArray(results.body.unknownAudit.examples));

const resultCandidates = await request("/api/result-candidates?category=explicit_win&limit=3");
assert.equal(resultCandidates.status, 200);
assert.equal(resultCandidates.body.filters.category, "explicit_win");
assert.ok(resultCandidates.body.items.length <= 3);
assert.ok(resultCandidates.body.items.every((item) => item.category === "explicit_win"));

const refresh = await request("/api/refresh");
assert.equal(refresh.status, 200);
assert.equal(refresh.body.running, false);
assert.equal(refresh.body.phase, "idle");
assert.equal(refresh.body.status, "idle");
assert.equal(refresh.body.percent, 0);
assert.ok(refresh.body.files);

const refreshCancelIdle = await request("/api/refresh/cancel", "POST");
assert.equal(refreshCancelIdle.status, 200);
assert.equal(refreshCancelIdle.body.ok, true);

const refreshHistory = await request("/api/refresh/history");
assert.equal(refreshHistory.status, 200);
assert.ok(Array.isArray(refreshHistory.body.items));
assert.ok(refreshHistory.body.summary);
assert.equal(refreshHistory.body.summary.total, refreshHistory.body.total);
assert.ok(refreshHistory.body.retention);
assert.equal(refreshHistory.body.retention.maxItems, 50);

const performance = await request("/api/performance");
assert.equal(performance.status, 200);
assert.equal(performance.body.schema.name, "minecraft-log-observatory-performance");
assert.ok(Number.isInteger(performance.body.baseline.sampleSize));
assert.ok(Array.isArray(performance.body.baseline.notes));
assert.ok(Array.isArray(performance.body.refreshReasons));
assert.ok(Array.isArray(performance.body.recommendations));
assert.ok(performance.body.recommendations.every((item) => item.code && item.severity && item.message));
assert.ok(performance.body.outputs);
assert.equal("path" in performance.body.outputs.report, false);
assert.equal("path" in performance.body.outputs.summary, false);
assert.equal(typeof performance.body.outputs.report.exists, "boolean");
assert.equal(performance.body.cache.totalFiles, 3);
assert.ok(["parse", "chat", "chatLines"].every((name) => performance.body.cache.files[name]));
assert.ok(performance.body.apiCache);
assert.equal(performance.body.apiCache.policy, "process_json_cache_mtime_size");
assert.ok(Number.isInteger(performance.body.apiCache.entries));
assert.ok(Number.isInteger(performance.body.apiCache.reads));
assert.ok(Array.isArray(performance.body.apiCache.kinds));
assert.ok(Array.isArray(performance.body.apiCache.hotFiles));
assert.equal("path" in performance.body.apiCache, false);
assert.ok(performance.body.apiCache.kinds.every((item) => item.kind && !("path" in item)));
assert.ok(performance.body.storeReadBaseline);
assert.ok(Array.isArray(performance.body.storeReadBaseline.tables));
assert.ok(performance.body.comparison);
assert.equal(typeof performance.body.comparison.available, "boolean");
assert.ok(Array.isArray(performance.body.comparison.regressions));

const rules = await request("/api/rules");
assert.equal(rules.status, 200);
assert.ok(rules.body.cache);
assert.ok(rules.body.quality, "rules API must include quality summary");
assert.equal(typeof rules.body.quality.totalRules, "number");
assert.equal(typeof rules.body.quality.hitRules, "number");
assert.equal(typeof rules.body.quality.zeroHitRules, "number");
assert.equal(rules.body.quality.hitRules + rules.body.quality.zeroHitRules, rules.body.quality.totalRules);
assert.ok(rules.body.quality.byRiskGroup);
assert.ok(rules.body.quality.byRuleSet);
assert.ok(rules.body.quality.byRulePack);
assert.ok(Array.isArray(rules.body.quality.topHitRules));
assert.ok(Array.isArray(rules.body.quality.zeroHitSamples));
assert.ok(Array.isArray(rules.body.quality.resultImpactRules));
assert.ok(Array.isArray(rules.body.quality.boundaryImpactRules));
assert.ok(rules.body.quality.policy?.safe_result);
if (rules.body.quality.topHitRules.length > 0) {
  assert.equal(typeof rules.body.quality.topHitRules[0].key, "string");
  assert.equal(typeof rules.body.quality.topHitRules[0].rulePack, "string");
  assert.equal(typeof rules.body.quality.topHitRules[0].hitCount, "number");
  assert.ok(["safe_result", "boundary_only", "diagnostic_only", "experimental"].includes(rules.body.quality.topHitRules[0].riskGroup));
}

const ruleTest = await request("/api/rules/test", "POST", { message: "VICTORY!" });
assert.equal(ruleTest.status, 200);
assert.equal(ruleTest.body.matched, true);
assert.equal(ruleTest.body.event.type, "win");

const scopedRuleTest = await request("/api/rules/test", "POST", { message: "VICTORY!", ruleSets: [ruleTest.body.event.ruleSet] });
assert.equal(scopedRuleTest.status, 200);
assert.equal(scopedRuleTest.body.matched, true);
assert.equal(scopedRuleTest.body.event.ruleSet, ruleTest.body.event.ruleSet);

const missingRuleTestMessage = await request("/api/rules/test", "POST", {});
assert.equal(missingRuleTestMessage.status, 400);
assert.equal(missingRuleTestMessage.body.ok, false);
assert.equal(missingRuleTestMessage.body.error, "message_required");
assert.equal(typeof missingRuleTestMessage.body.message, "string");

const badRuleTestArrayBody = await request("/api/rules/test", "POST", []);
assert.equal(badRuleTestArrayBody.status, 400);
assert.equal(badRuleTestArrayBody.body.ok, false);
assert.equal(badRuleTestArrayBody.body.error, "invalid_request_body");
assert.equal(badRuleTestArrayBody.body.received, "array");

const badConfigNullBody = await request("/api/config", "PUT", null);
assert.equal(badConfigNullBody.status, 400);
assert.equal(badConfigNullBody.body.ok, false);
assert.equal(badConfigNullBody.body.error, "invalid_request_body");
assert.equal(badConfigNullBody.body.received, "null");

const badRuleSetShape = await request("/api/rules/test", "POST", { message: "VICTORY!", ruleSets: "game-state" });
assert.equal(badRuleSetShape.status, 400);
assert.equal(badRuleSetShape.body.ok, false);
assert.equal(badRuleSetShape.body.error, "invalid_rule_sets");
assert.ok(badRuleSetShape.body.errors.some((item) => item.error === "expected_string_array"));

const badRuleSetValue = await request("/api/rules/test", "POST", { message: "VICTORY!", ruleSets: ["game-state", 42] });
assert.equal(badRuleSetValue.status, 400);
assert.equal(badRuleSetValue.body.ok, false);
assert.equal(badRuleSetValue.body.error, "invalid_rule_sets");

const unknownRuleSet = await request("/api/rules/test", "POST", { message: "VICTORY!", ruleSets: ["no-such-rule-set"] });
assert.equal(unknownRuleSet.status, 400);
assert.equal(unknownRuleSet.body.ok, false);
assert.equal(unknownRuleSet.body.error, "invalid_rule_sets");
assert.deepEqual(unknownRuleSet.body.unknown, ["no-such-rule-set"]);
assert.ok(unknownRuleSet.body.allowed.includes(ruleTest.body.event.ruleSet));

const badRuleTestPathShape = await request("/api/rules/test", "POST", { message: "VICTORY!", customRulePaths: "custom-rules/user" });
assert.equal(badRuleTestPathShape.status, 400);
assert.equal(badRuleTestPathShape.body.ok, false);
assert.equal(badRuleTestPathShape.body.error, "invalid_custom_rule_paths");

const badRuleTestAbsolutePath = await request("/api/rules/test", "POST", { message: "VICTORY!", customRulePaths: [path.join(process.cwd(), "custom-rules", "user")] });
assert.equal(badRuleTestAbsolutePath.status, 400);
assert.equal(badRuleTestAbsolutePath.body.ok, false);
assert.equal(badRuleTestAbsolutePath.body.error, "invalid_custom_rule_paths");
assert.ok(badRuleTestAbsolutePath.body.errors.some((item) => item.error === "must_be_project_relative_path"));

const badRuleTestReservedPath = await request("/api/rules/test", "POST", { message: "VICTORY!", customRulePaths: ["src/rules.json"] });
assert.equal(badRuleTestReservedPath.status, 400);
assert.equal(badRuleTestReservedPath.body.ok, false);
assert.equal(badRuleTestReservedPath.body.error, "invalid_custom_rule_paths");
assert.ok(badRuleTestReservedPath.body.errors.some((item) => item.error === "must_target_rule_pack_path"));

const ruleDraft = await request("/api/rules/draft", "POST", {
  message: "ExampleGame > You won in 42 seconds!",
  type: "win",
  gameMode: "duels",
});
assert.equal(ruleDraft.status, 200);
assert.equal(ruleDraft.body.rule.type, "win");
assert.equal(ruleDraft.body.rule.payload.gameMode, "duels");
assert.match(ruleDraft.body.rule.pattern, /^/);

const ruleValidation = await request("/api/rules/validate", "POST", {
  id: "inline-test",
  name: "Inline Test",
  rules: [
    {
      id: "inline_win",
      type: "win",
      pattern: "^Inline > You won!$",
    },
  ],
});
assert.equal(ruleValidation.status, 200);
assert.equal(ruleValidation.body.ok, true);

const badRuleValidation = await request("/api/rules/validate", "POST", {
  id: "bad-inline-test",
  rules: [{ id: "broken", type: "win", pattern: "(" }],
});
assert.equal(badRuleValidation.status, 400);
assert.equal(badRuleValidation.body.ok, false);
assert.equal(badRuleValidation.body.error, "invalid_rule_pack");
assert.equal(typeof badRuleValidation.body.message, "string");

const invalidUserRulePackIdSave = await request("/api/rule-packs/user", "POST", {
  id: "API Test Rules",
  name: "Invalid Managed ID",
  rules: [
    {
      id: "api_test_win",
      type: "win",
      pattern: "^API Test > You won!$",
    },
  ],
});
assert.equal(invalidUserRulePackIdSave.status, 400);
assert.equal(invalidUserRulePackIdSave.body.ok, false);
assert.equal(invalidUserRulePackIdSave.body.error, "invalid_rule_pack_id");
assert.equal(typeof invalidUserRulePackIdSave.body.message, "string");
assert.equal(invalidUserRulePackIdSave.body.pattern, "^[a-z0-9][a-z0-9_-]{0,79}$");

const invalidUserRulePackRoute = await request("/api/rule-packs/user/API-Test-Rules");
assert.equal(invalidUserRulePackRoute.status, 400);
assert.equal(invalidUserRulePackRoute.body.ok, false);
assert.equal(invalidUserRulePackRoute.body.error, "invalid_rule_pack_id");

const userRulePackSave = await request("/api/rule-packs/user", "POST", {
  id: "api-test-rules",
  name: "API Test Rules",
  rules: [
    {
      id: "api_test_win",
      type: "win",
      pattern: "^API Test > You won!$",
    },
  ],
});
assert.equal(userRulePackSave.status, 200);
assert.equal(userRulePackSave.body.ok, true);

const userRuleAuditAfterSave = await request("/api/rules/audit");
assert.equal(userRuleAuditAfterSave.status, 200);
assert.ok(userRuleAuditAfterSave.body.items.some((item) => item.action === "save_create" && item.rulePackId === "api-test-rules"));

const requestCustomRulePathTest = await request("/api/rules/test", "POST", {
  message: "API Test > You won!",
  customRulePaths: ["custom-rules/user/api-test-rules.json"],
});
assert.equal(requestCustomRulePathTest.status, 200);
assert.equal(requestCustomRulePathTest.body.matched, true);
assert.equal(requestCustomRulePathTest.body.event.ruleSet, "api-test-rules");
assert.equal(requestCustomRulePathTest.body.event.ruleId, "api_test_win");

const userRulePacks = await request("/api/rule-packs/user");
assert.equal(userRulePacks.status, 200);
assert.ok(userRulePacks.body.items.some((item) => item.id === "api-test-rules" && item.valid));

const userRulePackDetail = await request("/api/rule-packs/user/api-test-rules");
assert.equal(userRulePackDetail.status, 200);
assert.equal(userRulePackDetail.body.id, "api-test-rules");
assert.equal(userRulePackDetail.body.filePath, userRulePackSave.body.filePath);
assert.equal(userRulePackDetail.body.rulePack.id, "api-test-rules");
assert.equal(userRulePackDetail.body.valid, true);

const userRulePackDelete = await request("/api/rule-packs/user/api-test-rules", "DELETE");
assert.equal(userRulePackDelete.status, 200);
assert.equal(userRulePackDelete.body.ok, true);
assert.equal(userRulePackDelete.body.deleted, true);

const userRuleAuditAfterDelete = await request("/api/rules/audit");
assert.equal(userRuleAuditAfterDelete.status, 200);
assert.ok(userRuleAuditAfterDelete.body.items.some((item) => item.action === "delete" && item.rulePackId === "api-test-rules"));

const missingUserRulePackDetail = await request("/api/rule-packs/user/api-test-rules");
assert.equal(missingUserRulePackDetail.status, 404);
assert.equal(missingUserRulePackDetail.body.ok, false);
assert.equal(missingUserRulePackDetail.body.error, "rule_pack_not_found");
assert.equal(typeof missingUserRulePackDetail.body.message, "string");

const missingUserRulePackDelete = await request("/api/rule-packs/user/missing-api-test-rules", "DELETE");
assert.equal(missingUserRulePackDelete.status, 404);
assert.equal(missingUserRulePackDelete.body.ok, false);
assert.equal(missingUserRulePackDelete.body.error, "rule_pack_not_found");
assert.equal(typeof missingUserRulePackDelete.body.message, "string");

const rulePacks = await request("/api/rule-packs");
assert.equal(rulePacks.status, 200);
assert.ok(Array.isArray(rulePacks.body.items));

const rulePackValidation = await request("/api/rule-packs/validate");
assert.equal(rulePackValidation.status, 200);
assert.equal(rulePackValidation.body.ok, true);

const byMonth = await request("/api/timeseries?period=month");
assert.equal(byMonth.status, 200);
assert.equal(byMonth.body.period, "month");
assert.ok(Array.isArray(byMonth.body.items));

const unmatched = await request("/api/unmatched");
assert.equal(unmatched.status, 200);
assert.ok(unmatched.body.categories);

const store = await request("/api/store");
assert.equal(store.status, 200);
assert.equal(store.body.schema.name, "minecraft-log-observatory-store");

const storeByDay = await request("/api/store/table?name=byDay&limit=2");
assert.equal(storeByDay.status, 200);
assert.equal(storeByDay.body.name, "byDay");
assert.equal(storeByDay.body.file, store.body.files.byDay);
assert.ok(storeByDay.body.items.length <= 2);
assert.equal(storeByDay.body.total, store.body.counts.byDay);
if (storeByDay.body.items.length) {
  assert.ok("date" in storeByDay.body.items[0]);
}

const badStoreTable = await request("/api/store/table?name=summary");
assert.equal(badStoreTable.status, 400);
assert.equal(badStoreTable.body.ok, false);
assert.equal(badStoreTable.body.error, "invalid_store_table");
assert.equal(typeof badStoreTable.body.message, "string");
assert.ok(badStoreTable.body.allowed.includes("byDay"));

const badStorePagination = await request("/api/store/table?name=byDay&limit=1001");
assert.equal(badStorePagination.status, 400);
assert.equal(badStorePagination.body.ok, false);
assert.equal(badStorePagination.body.error, "invalid_pagination");
assert.ok(badStorePagination.body.errors.some((item) => item.field === "limit" && item.error === "too_large" && item.max === 1000));

const badTimeseries = await request("/api/timeseries?period=year");
assert.equal(badTimeseries.status, 400);
assert.equal(badTimeseries.body.ok, false);
assert.equal(badTimeseries.body.error, "invalid_period");
assert.equal(typeof badTimeseries.body.message, "string");

const missingAccount = await request("/api/accounts/no-such-local-user");
assert.equal(missingAccount.status, 404);
assert.equal(missingAccount.body.ok, false);
assert.equal(missingAccount.body.error, "account_not_found");
assert.equal(typeof missingAccount.body.message, "string");

const appStatus = await request("/api/app/status");
assert.equal(appStatus.status, 200);
assert.equal(appStatus.body.ok, true);
assert.equal(typeof appStatus.body.needsRefresh, "boolean");
assert.ok(Array.isArray(appStatus.body.refreshReasons));
assert.ok(["first_run", "needs_refresh", "refreshing", "ready"].includes(appStatus.body.setup.state));
assert.ok(Array.isArray(appStatus.body.setup.reasons));
assert.ok(Array.isArray(appStatus.body.setup.nextActions));
assert.ok(appStatus.body.recovery);
assert.ok(Array.isArray(appStatus.body.recovery.actions));
assert.ok(appStatus.body.project);
assert.equal(appStatus.body.app.skinProxyEnabled, true);
assert.equal(appStatus.body.app.skinProxy.remoteRequestsAllowed, true);
assert.equal(appStatus.body.app.launcher.contractVersion, 1);
assert.equal(appStatus.body.app.launcher.bindPolicy.localOnly, true);
assert.equal(appStatus.body.app.launcher.desktopIntegration.statusEndpoint, "GET /api/app/status");
assert.equal(appStatus.body.app.launcher.desktopIntegration.directoryPickerEndpoint, "POST /api/system/select-directory");
assert.equal(typeof appStatus.body.app.dataDir, "string");
assert.equal(typeof appStatus.body.app.storeDir, "string");
assert.ok(appStatus.body.refresh);

const directoryPickerWrongMethod = await request("/api/system/select-directory");
assert.equal(directoryPickerWrongMethod.status, 405);
assert.equal(directoryPickerWrongMethod.body.error, "method_not_allowed");

const config = await request("/api/config");
assert.equal(config.status, 200);
assert.ok(config.body.effective);
assert.equal(config.body.writable.target, "localConfig");

const diagnostics = await request("/api/diagnostics");
assert.equal(diagnostics.status, 200);
assert.equal(diagnostics.body.privacy, "privacy-safe");
assert.equal(diagnostics.body.config.path.redacted, true);
assert.ok(["first_run", "needs_refresh", "refreshing", "ready"].includes(diagnostics.body.setup.state));
assert.ok(Array.isArray(diagnostics.body.refreshReasons));
assert.equal(diagnostics.body.privacyAudit.checked, true);
assert.equal(diagnostics.body.privacyAudit.safe, true);
assert.equal(diagnostics.body.privacyAudit.issueCount, 0);

const originalDiagnosticsRefresh = context.refresh;
const diagnosticRefreshFile = path.join(process.cwd(), "private-refresh", "latest.log");
context.refresh = {
  ...originalDiagnosticsRefresh,
  id: "diagnostics-refresh-privacy-test",
  running: true,
  phase: "parse",
  percent: 42,
  currentFile: diagnosticRefreshFile,
  filesDone: 1,
  filesTotal: 2,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  cancelRequested: false,
  error: `Could not read ${diagnosticRefreshFile}`,
  log: [`Reading ${diagnosticRefreshFile}`],
};
try {
  const safeRefreshDiagnostics = await request("/api/diagnostics");
  assert.equal(safeRefreshDiagnostics.status, 200);
  assert.equal(safeRefreshDiagnostics.body.privacy, "privacy-safe");
  assert.equal(safeRefreshDiagnostics.body.refresh.running, true);
  assert.equal(safeRefreshDiagnostics.body.refresh.hasCurrentFile, true);
  assert.equal(safeRefreshDiagnostics.body.refresh.logLines, 1);
  assert.equal(safeRefreshDiagnostics.body.refresh.hasError, true);
  assert.equal("currentFile" in safeRefreshDiagnostics.body.refresh, false);
  assert.equal("log" in safeRefreshDiagnostics.body.refresh, false);
  assert.equal("error" in safeRefreshDiagnostics.body.refresh, false);
  assert.equal(safeRefreshDiagnostics.body.privacyAudit.safe, true);
  assertNoForbiddenKeys(safeRefreshDiagnostics.body, ["currentFile", "log", "logTail"]);
  assert.doesNotMatch(JSON.stringify(safeRefreshDiagnostics.body), new RegExp(escapeRegexForTest(diagnosticRefreshFile)));

  const safeRefreshPerformance = await request("/api/performance");
  assert.equal(safeRefreshPerformance.status, 200);
  assert.equal(safeRefreshPerformance.body.refresh.running, true);
  assert.equal(safeRefreshPerformance.body.refresh.hasCurrentFile, true);
  assert.equal(safeRefreshPerformance.body.refresh.hasError, true);
  assert.equal(safeRefreshPerformance.body.refresh.logLines, 1);
  assert.equal("currentFile" in safeRefreshPerformance.body.refresh, false);
  assert.equal("log" in safeRefreshPerformance.body.refresh, false);
  assert.equal("error" in safeRefreshPerformance.body.refresh, false);
  assert.doesNotMatch(JSON.stringify(safeRefreshPerformance.body), new RegExp(escapeRegexForTest(diagnosticRefreshFile)));

  const fullRefreshDiagnostics = await request("/api/diagnostics?full=true");
  assert.equal(fullRefreshDiagnostics.status, 200);
  assert.equal(fullRefreshDiagnostics.body.privacy, "full-local");
  assert.equal(fullRefreshDiagnostics.body.refresh.currentFile, diagnosticRefreshFile);
  assert.ok(fullRefreshDiagnostics.body.refresh.log.some((line) => line.includes(diagnosticRefreshFile)));
} finally {
  context.refresh = originalDiagnosticsRefresh;
}

const invalidDiagnosticsFull = await request("/api/diagnostics?full=maybe");
assert.equal(invalidDiagnosticsFull.status, 400);
assert.equal(invalidDiagnosticsFull.body.ok, false);
assert.equal(invalidDiagnosticsFull.body.error, "invalid_boolean_query");
assert.equal(invalidDiagnosticsFull.body.field, "full");

const diagnosticsPackage = await request("/api/diagnostics/package");
assert.equal(diagnosticsPackage.status, 200);
assert.equal(diagnosticsPackage.body.schema.name, "minecraft-log-observatory-diagnostics-package");
assert.equal(diagnosticsPackage.body.privacy, "privacy-safe");
assert.equal(diagnosticsPackage.body.manifest.kind, "api-diagnostics-package");
assert.ok(diagnosticsPackage.body.manifest.excluded.includes("raw_minecraft_logs"));
assert.ok(diagnosticsPackage.body.manifest.contents.some((item) => item.key === "refreshHistory"));
assert.ok(diagnosticsPackage.body.manifest.contents.some((item) => item.key === "performance"));
assert.equal(diagnosticsPackage.body.performance.schema.name, "minecraft-log-observatory-performance");
assert.equal(diagnosticsPackage.body.privacyAudit.checked, true);
assert.equal(diagnosticsPackage.body.privacyAudit.safe, true);
assert.equal(diagnosticsPackage.body.privacyAudit.issueCount, 0);
assert.ok(diagnosticsPackage.body.privacyAudit.checks.includes("forbidden_keys"));
assert.equal(diagnosticsPackage.body.containsRawLogs, false);
assert.equal(diagnosticsPackage.body.containsRawChat, false);
assertNoForbiddenKeys(diagnosticsPackage.body, ["currentFile", "log", "logTail"]);

const invalidDiagnosticsPackageFull = await request("/api/diagnostics/package?full=maybe");
assert.equal(invalidDiagnosticsPackageFull.status, 400);
assert.equal(invalidDiagnosticsPackageFull.body.error, "invalid_boolean_query");
assert.equal(invalidDiagnosticsPackageFull.body.field, "full");

const sharePackage = await request("/api/share/package");
assert.equal(sharePackage.status, 200);
assert.equal(sharePackage.body.schema.name, "minecraft-log-observatory-share-package");
assert.equal(sharePackage.body.privacy, "share-safe");
assert.equal(sharePackage.body.manifest.kind, "share-package");
assert.equal(sharePackage.body.manifest.privacy, "share-safe");
assert.equal(sharePackage.body.manifest.contains.rawLogs, false);
assert.equal(sharePackage.body.manifest.contains.localPaths, false);
assert.equal(sharePackage.body.privacyAudit.checked, true);
assert.equal(sharePackage.body.privacyAudit.safe, true);
assert.equal(sharePackage.body.privacyAudit.issueCount, 0);
assert.ok(sharePackage.body.privacyAudit.checks.includes("forbidden_keys"));
assert.equal(sharePackage.body.containsRawLogs, false);
assert.equal(sharePackage.body.containsRawChat, false);
assert.equal(sharePackage.body.containsLocalPaths, false);
assert.equal(sharePackage.body.containsLocalUserNames, false);
assert.equal(sharePackage.body.player.label, "Player");
assert.equal(sharePackage.body.overview.playerBedDestroys, sharePackage.body.overview.selfBedDestroys);
if (sharePackage.body.profile?.totals) {
  assert.equal(sharePackage.body.profile.totals.playerBedDestroys, sharePackage.body.profile.totals.selfBedDestroys);
}
const shareBedwarsMode = sharePackage.body.modes.find((mode) => mode.id === "bedwars");
if (shareBedwarsMode) {
  assert.equal(shareBedwarsMode.playerBedDestroys, shareBedwarsMode.selfBedDestroys);
}
assert.ok(Array.isArray(sharePackage.body.modes));
assert.ok(Array.isArray(sharePackage.body.activityModes));
const sharePitActivityMode = sharePackage.body.activityModes.find((mode) => mode.id === "the_pit");
if (sharePitActivityMode) {
  assert.equal(typeof sharePitActivityMode.bountyClaims, "number");
  assert.equal(typeof sharePitActivityMode.bountyGoldEarned, "number");
}
assertNoForbiddenKeys(sharePackage.body, ["currentFile", "log", "logTail"]);

const sharePackageWithoutIdentities = await request("/api/share/package?identities=false");
assert.equal(sharePackageWithoutIdentities.status, 200);
assert.deepEqual(sharePackageWithoutIdentities.body.identities, []);

const invalidSharePackageIdentities = await request("/api/share/package?identities=maybe");
assert.equal(invalidSharePackageIdentities.status, 400);
assert.equal(invalidSharePackageIdentities.body.ok, false);
assert.equal(invalidSharePackageIdentities.body.error, "invalid_boolean_query");
assert.equal(invalidSharePackageIdentities.body.field, "identities");

await runProductApiFixtureTests();

const missing = await request("/api/missing");
assert.equal(missing.status, 404);
assert.equal(missing.body.ok, false);
assert.equal(missing.body.error, "not_found");
assert.equal(typeof missing.body.message, "string");

console.log("api tests passed");

async function request(url, method = "GET", body = {}) {
  return handleReportApiRequest(context, { method, url, body });
}

async function runCorsHeaderTests() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiEnv = process.env.MLO_API_ENV;
  const originalCorsOrigin = process.env.MLO_API_CORS_ORIGIN;
  try {
    delete process.env.NODE_ENV;
    delete process.env.MLO_API_ENV;
    delete process.env.MLO_API_CORS_ORIGIN;
    const devResponse = await captureApiResponseHeaders();
    assert.equal(devResponse.headers["Access-Control-Allow-Origin"], "*");

    process.env.MLO_API_ENV = "production";
    const productionDefault = await captureApiResponseHeaders();
    assert.equal(productionDefault.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");

    process.env.MLO_API_CORS_ORIGIN = "http://localhost:3000";
    const productionConfigured = await captureApiResponseHeaders();
    assert.equal(productionConfigured.headers["Access-Control-Allow-Origin"], "http://localhost:3000");

    process.env.MLO_API_CORS_ORIGIN = "http://[::1]:5173";
    const productionIpv6Local = await captureApiResponseHeaders();
    assert.equal(productionIpv6Local.headers["Access-Control-Allow-Origin"], "http://[::1]:5173");

    process.env.MLO_API_CORS_ORIGIN = "https://example.com";
    const productionRejectedRemote = await captureApiResponseHeaders();
    assert.equal(productionRejectedRemote.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173");

    delete process.env.MLO_API_ENV;
    process.env.NODE_ENV = "production";
    process.env.MLO_API_CORS_ORIGIN = "http://127.0.0.1:4321";
    const nodeProduction = await captureApiResponseHeaders();
    assert.equal(nodeProduction.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:4321");
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("MLO_API_ENV", originalApiEnv);
    restoreEnv("MLO_API_CORS_ORIGIN", originalCorsOrigin);
  }
}

async function captureApiResponseHeaders() {
  const response = {
    headers: null,
    status: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  await sendApiResponse(response, {
    status: 200,
    headers: {},
    body: {
      ok: true,
    },
  });
  return response;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function runProductApiFixtureTests() {
  const fixtureDir = path.resolve(".cache", "test-api-product");
  const rootDir = path.join(fixtureDir, "client", ".minecraft");
  const logDir = path.join(rootDir, "logs");
  const gzipRootDir = path.join(fixtureDir, "gzip-client", ".minecraft");
  const gzipLogDir = path.join(gzipRootDir, "logs");
  const emptyRootDir = path.join(fixtureDir, "empty-client", ".minecraft");
  const emptyLogsRootDir = path.join(fixtureDir, "empty-logs-client", ".minecraft");
  const emptyLogsDir = path.join(emptyLogsRootDir, "logs");
  const configPath = path.join(fixtureDir, "observatory.config.json");
  const localConfigPath = path.join(fixtureDir, "observatory.local.json");
  const logPath = path.join(logDir, "latest.log");
  const gzipLogPath = path.join(gzipLogDir, "2026-06-14-1.log.gz");

  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(logDir, { recursive: true });
  await mkdir(gzipLogDir, { recursive: true });
  await mkdir(emptyRootDir, { recursive: true });
  await mkdir(emptyLogsDir, { recursive: true });
  await writeFile(logPath, "[00:00:00] [Client thread/INFO]: Hello local log\n", "utf8");
  await writeFile(gzipLogPath, gzipSync("[00:00:00] [Client thread/INFO]: Hello gzip log\n"));
  await writeFile(
    configPath,
    JSON.stringify(
      {
        roots: [],
        localConfig: "observatory.local.json",
        outputs: {
          report: "report.json",
          summary: "summary.json",
        },
        cache: {
          parse: ".cache/parse.json",
          chat: ".cache/chat.json",
          chatLines: ".cache/chat-lines.json",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const fixtureContext = await createReportApiContext(configPath);

    const emptyStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(emptyStatus.status, 200);
    assert.equal(emptyStatus.body.firstRun, true);
    assert.equal(emptyStatus.body.ready, false);
    assert.equal(emptyStatus.body.setup.state, "first_run");
    assert.equal(emptyStatus.body.setup.recommendedAction, "configure_roots");
    assert.ok(emptyStatus.body.setup.reasons.includes("no_roots"));
    assert.ok(emptyStatus.body.setup.nextActions.some((item) => item.code === "configure_roots"));
    assert.ok(emptyStatus.body.recovery.actions.some((item) => item.code === "configure_roots" && item.severity === "blocking"));

    const emptyPreflight = await fixtureRequest(fixtureContext, "/api/refresh/preflight", "POST");
    assert.equal(emptyPreflight.status, 200);
    assert.equal(emptyPreflight.body.canRefresh, false);
    assert.ok(emptyPreflight.body.blocking.some((issue) => issue.code === "no_roots"));

    const emptyRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
    assert.equal(emptyRefreshStart.status, 400);
    assert.equal(emptyRefreshStart.body.error, "refresh_preflight_failed");
    assert.equal(emptyRefreshStart.body.preflight.canRefresh, false);

    const unsafeDiagnosticsConfigPath = path.join(fixtureDir, "unsafe-diagnostics.config.json");
    await writeFile(
      unsafeDiagnosticsConfigPath,
      JSON.stringify(
        {
          roots: [],
          localConfig: "unsafe-diagnostics.local.json",
          encoding: path.join(fixtureDir, "private-encoding-label"),
          outputs: {
            report: "unsafe-diagnostics-report.json",
            summary: "unsafe-diagnostics-summary.json",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const unsafeDiagnosticsContext = await createReportApiContext(unsafeDiagnosticsConfigPath);
    const unsafeDiagnostics = await fixtureRequest(unsafeDiagnosticsContext, "/api/diagnostics");
    assert.equal(unsafeDiagnostics.status, 500);
    assert.equal(unsafeDiagnostics.body.ok, false);
    assert.equal(unsafeDiagnostics.body.error, "privacy_audit_failed");
    assert.equal(unsafeDiagnostics.body.privacyAudit.safe, false);
    assert.ok(unsafeDiagnostics.body.privacyAudit.issues.some((item) => item.code === "windows_absolute_path" || item.code === "known_sensitive_value"));
    assert.doesNotMatch(JSON.stringify(unsafeDiagnostics.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const unsafeDiagnosticsPackage = await fixtureRequest(unsafeDiagnosticsContext, "/api/diagnostics/package");
    assert.equal(unsafeDiagnosticsPackage.status, 500);
    assert.equal(unsafeDiagnosticsPackage.body.ok, false);
    assert.equal(unsafeDiagnosticsPackage.body.error, "privacy_audit_failed");
    assert.equal(unsafeDiagnosticsPackage.body.privacyAudit.safe, false);
    assert.equal("schema" in unsafeDiagnosticsPackage.body, false);
    assert.equal("diagnostics" in unsafeDiagnosticsPackage.body, false);
    assert.doesNotMatch(JSON.stringify(unsafeDiagnosticsPackage.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const goodRoots = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [rootDir] });
    assert.equal(goodRoots.status, 200);
    assert.equal(goodRoots.body.ok, true);
    assert.equal(goodRoots.body.logFiles, 1);

    fixtureContext.system.openDirectoryPicker = async () => rootDir;
    const pickedRoot = await fixtureRequest(fixtureContext, "/api/system/select-directory", "POST", { validate: true });
    assert.equal(pickedRoot.status, 200);
    assert.equal(pickedRoot.body.ok, true);
    assert.equal(pickedRoot.body.path, rootDir);
    assert.equal(pickedRoot.body.validation.ok, true);
    assert.equal(pickedRoot.body.validation.logFiles, 1);

    fixtureContext.system.openDirectoryPicker = async () => "";
    const cancelledPicker = await fixtureRequest(fixtureContext, "/api/system/select-directory", "POST", { validate: true });
    assert.equal(cancelledPicker.status, 200);
    assert.equal(cancelledPicker.body.ok, false);
    assert.equal(cancelledPicker.body.cancelled, true);
    assert.equal(Object.hasOwn(cancelledPicker.body, "validation"), false);

    const invalidPickerRequest = await fixtureRequest(fixtureContext, "/api/system/select-directory", "POST", { validate: "yes" });
    assert.equal(invalidPickerRequest.status, 400);
    assert.equal(invalidPickerRequest.body.error, "invalid_select_directory_request");
    assert.equal(invalidPickerRequest.body.errors[0].field, "validate");

    const gzipRoots = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [gzipRootDir] });
    assert.equal(gzipRoots.status, 200);
    assert.equal(gzipRoots.body.ok, true);
    assert.equal(gzipRoots.body.roots[0].logFiles, 1);
    assert.equal(gzipRoots.body.roots[0].sampleReadable, true);

    const duplicateValidateRoots = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [rootDir, rootDir] });
    assert.equal(duplicateValidateRoots.status, 400);
    assert.equal(duplicateValidateRoots.body.ok, false);
    assert.equal(duplicateValidateRoots.body.total, 2);
    assert.ok(duplicateValidateRoots.body.roots[1].issues.some((issue) => issue.code === "duplicate_root"));

    const emptyRoot = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [emptyRootDir] });
    assert.equal(emptyRoot.status, 400);
    assert.equal(emptyRoot.body.ok, false);
    assert.ok(emptyRoot.body.roots[0].issues.some((issue) => issue.code === "no_log_scopes"));

    const emptyLogsRoot = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [emptyLogsRootDir] });
    assert.equal(emptyLogsRoot.status, 400);
    assert.equal(emptyLogsRoot.body.ok, false);
    assert.equal(emptyLogsRoot.body.roots[0].scopes, 1);
    assert.ok(emptyLogsRoot.body.roots[0].issues.some((issue) => issue.code === "no_logs_found"));
    assert.equal(emptyLogsRoot.body.roots[0].issues.some((issue) => issue.code === "no_log_scopes"), false);

    const badRoots = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [path.join(fixtureDir, "missing")] });
    assert.equal(badRoots.status, 400);
    assert.equal(badRoots.body.ok, false);
    assert.equal(badRoots.body.roots[0].issues[0].code, "not_found");

    const missingValidateRoots = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", {});
    assert.equal(missingValidateRoots.status, 400);
    assert.equal(missingValidateRoots.body.ok, false);
    assert.equal(missingValidateRoots.body.error, "invalid_validate_roots_request");
    assert.ok(missingValidateRoots.body.errors.some((item) => item.field === "roots" && item.error === "required"));

    const invalidValidateRootsShape = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: rootDir });
    assert.equal(invalidValidateRootsShape.status, 400);
    assert.equal(invalidValidateRootsShape.body.ok, false);
    assert.equal(invalidValidateRootsShape.body.error, "invalid_validate_roots_request");
    assert.ok(invalidValidateRootsShape.body.errors.some((item) => item.field === "roots" && item.error === "expected_string_array"));

    const invalidValidateRootsEncoding = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [rootDir], encoding: 42 });
    assert.equal(invalidValidateRootsEncoding.status, 400);
    assert.equal(invalidValidateRootsEncoding.body.ok, false);
    assert.equal(invalidValidateRootsEncoding.body.error, "invalid_validate_roots_request");
    assert.ok(invalidValidateRootsEncoding.body.errors.some((item) => item.field === "encoding" && item.error === "expected_non_empty_string"));

    const unsupportedValidateRootsEncoding = await fixtureRequest(fixtureContext, "/api/config/validate-roots", "POST", { roots: [rootDir], encoding: "not-a-real-encoding" });
    assert.equal(unsupportedValidateRootsEncoding.status, 400);
    assert.equal(unsupportedValidateRootsEncoding.body.ok, false);
    assert.equal(unsupportedValidateRootsEncoding.body.error, "invalid_validate_roots_request");
    assert.ok(unsupportedValidateRootsEncoding.body.errors.some((item) => item.field === "encoding" && item.error === "unsupported_encoding"));

    const rejectMissingRoot = await fixtureRequest(fixtureContext, "/api/config", "PUT", { roots: [path.join(fixtureDir, "missing")] });
    assert.equal(rejectMissingRoot.status, 400);
    assert.equal(rejectMissingRoot.body.ok, false);
    assert.equal(rejectMissingRoot.body.error, "invalid_config");
    assert.equal(typeof rejectMissingRoot.body.message, "string");

    const rejectUnsupportedConfigEncoding = await fixtureRequest(fixtureContext, "/api/config", "PUT", { roots: [rootDir], encoding: "not-a-real-encoding" });
    assert.equal(rejectUnsupportedConfigEncoding.status, 400);
    assert.equal(rejectUnsupportedConfigEncoding.body.error, "invalid_config");
    assert.ok(rejectUnsupportedConfigEncoding.body.errors.some((item) => item.field === "encoding" && item.error === "unsupported_field"));
    assert.equal(rejectUnsupportedConfigEncoding.body.errors.some((item) => item.field === "roots" && item.error === "invalid_roots"), false);

    const rejectDuplicateRoots = await fixtureRequest(fixtureContext, "/api/config", "PUT", { roots: [rootDir, rootDir] });
    assert.equal(rejectDuplicateRoots.status, 400);
    assert.equal(rejectDuplicateRoots.body.error, "invalid_config");
    assert.ok(
      rejectDuplicateRoots.body.errors.some((item) => (
        item.field === "roots"
        && item.error === "invalid_roots"
        && item.roots.some((root) => root.issues.some((issue) => issue.code === "duplicate_root"))
      )),
    );

    const rejectNestedConfigFields = await fixtureRequest(fixtureContext, "/api/config", "PUT", {
      owner: { displayName: "Owner", unsupportedOwnerField: true },
      app: { dataDir: "derived-data", unsupportedAppField: true },
      outputs: { report: "report.json", unsupportedOutputField: "ignored" },
    });
    assert.equal(rejectNestedConfigFields.status, 400);
    assert.equal(rejectNestedConfigFields.body.error, "invalid_config");
    assert.ok(rejectNestedConfigFields.body.errors.some((item) => item.field === "owner.unsupportedOwnerField" && item.error === "unsupported_field"));
    assert.ok(rejectNestedConfigFields.body.errors.some((item) => item.field === "app.unsupportedAppField" && item.error === "unsupported_field"));
    assert.ok(rejectNestedConfigFields.body.errors.some((item) => item.field === "outputs.unsupportedOutputField" && item.error === "unsupported_field"));

    const rejectAbsoluteDataDir = await fixtureRequest(fixtureContext, "/api/config", "PUT", { app: { dataDir: path.join(fixtureDir, "absolute-data") } });
    assert.equal(rejectAbsoluteDataDir.status, 400);
    assert.equal(rejectAbsoluteDataDir.body.error, "invalid_config");
    assert.ok(rejectAbsoluteDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_be_project_relative_path"));

    const rejectTraversalDataDir = await fixtureRequest(fixtureContext, "/api/config", "PUT", { app: { dataDir: "../outside-data" } });
    assert.equal(rejectTraversalDataDir.status, 400);
    assert.equal(rejectTraversalDataDir.body.error, "invalid_config");
    assert.ok(rejectTraversalDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_be_project_relative_path"));

    const rejectSourceDataDir = await fixtureRequest(fixtureContext, "/api/config", "PUT", { app: { dataDir: "src" } });
    assert.equal(rejectSourceDataDir.status, 400);
    assert.equal(rejectSourceDataDir.body.error, "invalid_config");
    assert.ok(rejectSourceDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_target_derived_data_dir"));

    const rejectPackageDataDir = await fixtureRequest(fixtureContext, "/api/config", "PUT", { app: { dataDir: "package.json" } });
    assert.equal(rejectPackageDataDir.status, 400);
    assert.equal(rejectPackageDataDir.body.error, "invalid_config");
    assert.ok(rejectPackageDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_target_derived_data_dir"));

    const rejectMinecraftRootDataDir = await fixtureRequest(fixtureContext, "/api/config", "PUT", { roots: [rootDir], app: { dataDir: path.relative(fixtureDir, rootDir) } });
    assert.equal(rejectMinecraftRootDataDir.status, 400);
    assert.equal(rejectMinecraftRootDataDir.body.error, "invalid_config");
    assert.ok(rejectMinecraftRootDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_not_be_inside_minecraft_root"));

    const rejectAbsoluteCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: [path.join(fixtureDir, "rules.json")] });
    assert.equal(rejectAbsoluteCustomRule.status, 400);
    assert.equal(rejectAbsoluteCustomRule.body.error, "invalid_config");
    assert.ok(rejectAbsoluteCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_be_project_relative_path"));

    const rejectTraversalCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["../rules.json"] });
    assert.equal(rejectTraversalCustomRule.status, 400);
    assert.equal(rejectTraversalCustomRule.body.error, "invalid_config");
    assert.ok(rejectTraversalCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_be_project_relative_path"));

    const rejectSourceCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["src/rules.json"] });
    assert.equal(rejectSourceCustomRule.status, 400);
    assert.equal(rejectSourceCustomRule.body.error, "invalid_config");
    assert.ok(rejectSourceCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_target_rule_pack_path"));

    const rejectPackageCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["package.json"] });
    assert.equal(rejectPackageCustomRule.status, 400);
    assert.equal(rejectPackageCustomRule.body.error, "invalid_config");
    assert.ok(rejectPackageCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_target_rule_pack_path"));

    const rejectDataCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["data/rules.json"] });
    assert.equal(rejectDataCustomRule.status, 400);
    assert.equal(rejectDataCustomRule.body.error, "invalid_config");
    assert.ok(rejectDataCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_target_rule_pack_path"));

    const rejectMinecraftRootCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { roots: [rootDir], customRules: [path.relative(fixtureDir, path.join(rootDir, "rules.json"))] });
    assert.equal(rejectMinecraftRootCustomRule.status, 400);
    assert.equal(rejectMinecraftRootCustomRule.body.error, "invalid_config");
    assert.ok(rejectMinecraftRootCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_not_be_inside_minecraft_root"));

    const rejectTextCustomRule = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["custom-rules/user/rules.txt"] });
    assert.equal(rejectTextCustomRule.status, 400);
    assert.equal(rejectTextCustomRule.body.error, "invalid_config");
    assert.ok(rejectTextCustomRule.body.errors.some((item) => item.field === "customRules" && item.error === "must_be_rule_pack_json_or_directory"));

    const rejectConfigOutput = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { report: "observatory.config.json" } });
    assert.equal(rejectConfigOutput.status, 400);
    assert.equal(rejectConfigOutput.body.error, "invalid_config");
    assert.ok(rejectConfigOutput.body.errors.some((item) => item.field === "outputs.report" && item.error === "must_target_derived_output_path"));

    const rejectLocalConfigOutput = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { summary: "observatory.local.json" } });
    assert.equal(rejectLocalConfigOutput.status, 400);
    assert.equal(rejectLocalConfigOutput.body.error, "invalid_config");
    assert.ok(rejectLocalConfigOutput.body.errors.some((item) => item.field === "outputs.summary" && item.error === "must_target_derived_output_path"));

    const rejectCustomRulesOutput = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { report: "custom-rules/user/report.json" } });
    assert.equal(rejectCustomRulesOutput.status, 400);
    assert.equal(rejectCustomRulesOutput.body.error, "invalid_config");
    assert.ok(rejectCustomRulesOutput.body.errors.some((item) => item.field === "outputs.report" && item.error === "must_target_derived_output_path"));

    const rejectSourceOutput = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { summary: "docs/openapi.json" } });
    assert.equal(rejectSourceOutput.status, 400);
    assert.equal(rejectSourceOutput.body.error, "invalid_config");
    assert.ok(rejectSourceOutput.body.errors.some((item) => item.field === "outputs.summary" && item.error === "must_target_derived_output_path"));

    const rejectPackageOutput = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { report: "package.json" } });
    assert.equal(rejectPackageOutput.status, 400);
    assert.equal(rejectPackageOutput.body.error, "invalid_config");
    assert.ok(rejectPackageOutput.body.errors.some((item) => item.field === "outputs.report" && item.error === "must_target_derived_output_path"));

    const rejectSameOutputs = await fixtureRequest(fixtureContext, "/api/config", "PUT", { outputs: { report: "same-report.json", summary: "same-report.json" } });
    assert.equal(rejectSameOutputs.status, 400);
    assert.equal(rejectSameOutputs.body.error, "invalid_config");
    assert.ok(rejectSameOutputs.body.errors.some((item) => item.field === "outputs" && item.error === "report_summary_must_be_distinct"));

    const unsafeLocalSubdir = path.join(fixtureDir, "unsafe-local-subdir");
    await mkdir(unsafeLocalSubdir, { recursive: true });
    const outsideLocalConfigPath = path.join(unsafeLocalSubdir, "observatory.config.json");
    await writeFile(outsideLocalConfigPath, JSON.stringify({ localConfig: "../outside.local.json" }, null, 2), "utf8");
    const outsideLocalContext = await createReportApiContext(outsideLocalConfigPath);
    const rejectOutsideLocalConfig = await fixtureRequest(outsideLocalContext, "/api/config", "PUT", { owner: { displayName: "Nope" } });
    assert.equal(rejectOutsideLocalConfig.status, 400);
    assert.equal(rejectOutsideLocalConfig.body.error, "unsafe_local_config_path");
    assert.equal(rejectOutsideLocalConfig.body.reason, "local_config_outside_config_dir");

    const sameLocalConfigPath = path.join(fixtureDir, "same-local.config.json");
    await writeFile(sameLocalConfigPath, JSON.stringify({ localConfig: "same-local.config.json" }, null, 2), "utf8");
    const sameLocalContext = await createReportApiContext(sameLocalConfigPath);
    const rejectSameLocalConfig = await fixtureRequest(sameLocalContext, "/api/config", "PUT", { owner: { displayName: "Nope" } });
    assert.equal(rejectSameLocalConfig.status, 400);
    assert.equal(rejectSameLocalConfig.body.error, "unsafe_local_config_path");
    assert.equal(rejectSameLocalConfig.body.reason, "local_config_overwrites_shareable_config");

    const reservedLocalConfigPath = path.join(fixtureDir, "reserved-local.config.json");
    await writeFile(reservedLocalConfigPath, JSON.stringify({ localConfig: "custom-rules/user/local.json" }, null, 2), "utf8");
    const reservedLocalContext = await createReportApiContext(reservedLocalConfigPath);
    const rejectReservedLocalConfig = await fixtureRequest(reservedLocalContext, "/api/config", "PUT", { owner: { displayName: "Nope" } });
    assert.equal(rejectReservedLocalConfig.status, 400);
    assert.equal(rejectReservedLocalConfig.body.error, "unsafe_local_config_path");
    assert.equal(rejectReservedLocalConfig.body.reason, "local_config_reserved_project_path");

    const saveConfig = await fixtureRequest(fixtureContext, "/api/config", "PUT", {
      roots: [rootDir],
      owner: {
        aliases: ["LocalNick"],
        displayName: "Local Player",
      },
      customRules: ["custom-rules/user"],
      app: {
        dataDir: "derived-data",
        skinProxyEnabled: false,
      },
      outputs: {
        report: "report.json",
        summary: "summary.json",
      },
    });
    assert.equal(saveConfig.status, 200);
    assert.equal(saveConfig.body.ok, true);
    assert.deepEqual(saveConfig.body.effective.roots, [rootDir]);
    assert.equal(saveConfig.body.effective.app.skinProxyEnabled, false);

    const configuredStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(configuredStatus.status, 200);
    assert.equal(configuredStatus.body.firstRun, false);
    assert.equal(configuredStatus.body.ready, false);
    assert.equal(configuredStatus.body.needsRefresh, true);
    assert.equal(configuredStatus.body.setup.state, "needs_refresh");
    assert.equal(configuredStatus.body.setup.recommendedAction, "run_refresh");
    assert.ok(configuredStatus.body.setup.reasons.includes("report_not_ready"));
    assert.ok(configuredStatus.body.setup.nextActions.some((item) => item.code === "run_refresh"));
    assert.ok(configuredStatus.body.recovery.actions.some((item) => item.code === "run_refresh" && item.reason === "report_not_ready"));
    assert.equal(configuredStatus.body.app.skinProxyEnabled, false);
    assert.equal(configuredStatus.body.app.skinProxy.enabled, false);
    assert.equal(configuredStatus.body.app.skinProxy.remoteRequestsAllowed, false);

    const lifecycleRulePackSave = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "lifecycle-rule",
      name: "Lifecycle Rule",
      rules: [
        {
          id: "lifecycle_win",
          type: "win",
          pattern: "^LIFECYCLE WIN$",
        },
      ],
    });
    assert.equal(lifecycleRulePackSave.status, 200);
    assert.equal(lifecycleRulePackSave.body.backup, null);
    const lifecycleAuditAfterSave = await fixtureRequest(fixtureContext, "/api/rules/audit");
    assert.equal(lifecycleAuditAfterSave.status, 200);
    assert.ok(lifecycleAuditAfterSave.body.items.some((item) => item.action === "save_create" && item.rulePackId === "lifecycle-rule"));

    const lifecycleRulePackUpdate = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "lifecycle-rule",
      name: "Lifecycle Rule Updated",
      rules: [
        {
          id: "lifecycle_loss",
          type: "loss",
          pattern: "^LIFECYCLE LOSS$",
        },
      ],
    });
    assert.equal(lifecycleRulePackUpdate.status, 200);
    assert.ok(lifecycleRulePackUpdate.body.backup);
    const lifecycleAuditAfterUpdate = await fixtureRequest(fixtureContext, "/api/rules/audit");
    assert.ok(lifecycleAuditAfterUpdate.body.items.some((item) => item.action === "save_overwrite" && item.rulePackId === "lifecycle-rule"));

    const lifecycleBackups = await fixtureRequest(fixtureContext, "/api/rule-packs/user/backups", "POST", { id: "lifecycle-rule" });
    assert.equal(lifecycleBackups.status, 200);
    assert.ok(lifecycleBackups.body.items.some((item) => item.rulePackId === "lifecycle-rule"));

    const lifecycleInventory = await fixtureRequest(fixtureContext, "/api/rule-packs");
    assert.equal(lifecycleInventory.status, 200);
    assert.ok(lifecycleInventory.body.items.some((item) => item.id === "lifecycle-rule" && item.source === "user" && item.enabled));
    assert.ok(lifecycleInventory.body.items.some((item) => item.source === "bundled" && item.enabled));

    const lifecycleDisable = await fixtureRequest(fixtureContext, "/api/rule-packs/user/enable", "POST", { id: "lifecycle-rule", enabled: false });
    assert.equal(lifecycleDisable.status, 200);
    assert.equal(lifecycleDisable.body.enabled, false);
    assert.equal(lifecycleDisable.body.customRules.includes("custom-rules/user"), false);

    const lifecycleEnable = await fixtureRequest(fixtureContext, "/api/rule-packs/user/enable", "POST", { id: "lifecycle-rule", enabled: true });
    assert.equal(lifecycleEnable.status, 200);
    assert.equal(lifecycleEnable.body.enabled, true);
    assert.ok(lifecycleEnable.body.customRules.includes("custom-rules/user/lifecycle-rule.json"));
    const lifecycleAuditAfterEnable = await fixtureRequest(fixtureContext, "/api/rules/audit");
    assert.ok(lifecycleAuditAfterEnable.body.items.some((item) => item.action === "disable" && item.rulePackId === "lifecycle-rule"));
    assert.ok(lifecycleAuditAfterEnable.body.items.some((item) => item.action === "enable" && item.rulePackId === "lifecycle-rule"));

    const lifecycleRestore = await fixtureRequest(fixtureContext, "/api/rule-packs/user/restore", "POST", {
      id: "lifecycle-rule",
      backupId: lifecycleBackups.body.items[0].id,
    });
    assert.equal(lifecycleRestore.status, 200);
    assert.equal(lifecycleRestore.body.ok, true);
    const lifecycleAuditAfterRestore = await fixtureRequest(fixtureContext, "/api/rules/audit");
    assert.ok(lifecycleAuditAfterRestore.body.items.some((item) => item.action === "restore" && item.rulePackId === "lifecycle-rule"));
    const lifecycleRestoredDetail = await fixtureRequest(fixtureContext, "/api/rule-packs/user/lifecycle-rule");
    assert.equal(lifecycleRestoredDetail.status, 200);
    assert.equal(lifecycleRestoredDetail.body.rulePack.rules[0].id, "lifecycle_win");

    const lifecycleDoctor = await fixtureRequest(fixtureContext, "/api/rules/doctor");
    assert.equal(lifecycleDoctor.status, 200);
    assert.ok(lifecycleDoctor.body.inventory.total >= 1);
    assert.ok(Array.isArray(lifecycleDoctor.body.issues));

    const duplicatePatternRulePack = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "duplicate-pattern-rule",
      name: "Duplicate Pattern Rule",
      rules: [
        { id: "duplicate_one", type: "win", pattern: "^DUPLICATE PATTERN$" },
        { id: "duplicate_two", type: "win", pattern: "^DUPLICATE PATTERN$" },
      ],
    });
    assert.equal(duplicatePatternRulePack.status, 200);
    const duplicatePatternDoctor = await fixtureRequest(fixtureContext, "/api/rules/doctor");
    assert.ok(duplicatePatternDoctor.body.issues.some((item) => item.code === "duplicate_rule_pattern" && item.rulePackId === "duplicate-pattern-rule"));

    const lifecycleDraftFromLabels = await fixtureRequest(fixtureContext, "/api/rules/draft-from-labels", "POST", {
      id: "label-draft",
      labels: [{ label: "win", message: "LABEL DRAFT WIN", gameMode: "bedwars" }],
    });
    assert.equal(lifecycleDraftFromLabels.status, 200);
    assert.equal(lifecycleDraftFromLabels.body.ok, true);
    assert.equal(lifecycleDraftFromLabels.body.workflow.sourceRows, 1);
    assert.equal(lifecycleDraftFromLabels.body.workflow.decisions.win, 1);
    assert.ok(lifecycleDraftFromLabels.body.workflow.nextActions.some((item) => item.includes("/api/rules/dry-run")));
    assert.equal(lifecycleDraftFromLabels.body.rulePack.rules[0].type, "win");
    assert.equal(lifecycleDraftFromLabels.body.rulePack.rules[0].payload.gameMode, "bedwars");

    const lifecycleDraftFromReviewLabels = await fixtureRequest(fixtureContext, "/api/rules/draft-from-labels", "POST", {
      id: "review-label-draft",
      labels: [
        { reviewLabel: "keep-unknown", message: "KEEP UNKNOWN SAMPLE", gameMode: "bedwars" },
        { reviewLabel: "loss", message: "LOSS SAMPLE", gameMode: "bedwars" },
      ],
    });
    assert.equal(lifecycleDraftFromReviewLabels.status, 200);
    assert.equal(lifecycleDraftFromReviewLabels.body.workflow.decisions["keep-unknown"], 1);
    assert.equal(lifecycleDraftFromReviewLabels.body.workflow.decisions.loss, 1);
    assert.equal(lifecycleDraftFromReviewLabels.body.rulePack.rules.length, 1);
    assert.equal(lifecycleDraftFromReviewLabels.body.rulePack.rules[0].type, "loss");

    const lifecycleAuditLabels = await fixtureRequest(fixtureContext, "/api/unknown-audit/labels", "POST", {
      labels: [
        {
          id: "label-1",
          reviewLabel: "keep-unknown",
          gameMode: "bedwars",
          unknownAudit: { category: "bedwars_no_safe_result_evidence", nextAction: "label_sample" },
        },
        {
          id: "label-2",
          reviewLabel: "loss",
          gameMode: "bedwars",
          message: "LOSS SAMPLE",
          unknownAudit: { category: "bedwars_self_death_boundary_review", nextAction: "review_owner_identity" },
        },
      ],
    });
    assert.equal(lifecycleAuditLabels.status, 200);
    assert.equal(lifecycleAuditLabels.body.ok, true);
    assert.equal(lifecycleAuditLabels.body.writes.report, false);
    assert.equal(lifecycleAuditLabels.body.writes.store, false);
    assert.equal(lifecycleAuditLabels.body.byLabel["keep-unknown"], 1);
    assert.equal(lifecycleAuditLabels.body.byLabel.loss, 1);
    assert.equal(lifecycleAuditLabels.body.candidates.draftableRuleRows, 1);
    assert.equal(lifecycleAuditLabels.body.candidates.needsDryRun, true);
    assert.equal(lifecycleAuditLabels.body.status, "ready_for_workflow");
    assert.equal(lifecycleAuditLabels.body.readiness.status, "ready_for_workflow");
    assert.equal(lifecycleAuditLabels.body.readiness.nextStep, "run_audit_workflow");
    assert.equal(lifecycleAuditLabels.body.readiness.blocked, false);
    assert.equal(lifecycleAuditLabels.body.readiness.canDraftRules, true);
    assert.equal(lifecycleAuditLabels.body.readiness.canRunDryRun, true);
    assert.equal(lifecycleAuditLabels.body.readyForWorkflow, true);
    assert.equal(lifecycleAuditLabels.body.workflowRecommended, true);
    assert.equal(lifecycleAuditLabels.body.workflow.readiness.status, "ready_for_workflow");

    const labelSetSave = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets", "POST", {
      id: "bedwars-review",
      title: "BedWars review",
      source: { auditExport: "unknown-audit-bedwars-current.jsonl", mode: "bedwars" },
      rows: [
        {
          id: "saved-label-1",
          reviewLabel: "keep-unknown",
          gameMode: "bedwars",
          unknownAudit: { category: "bedwars_no_safe_result_evidence", nextAction: "label_sample" },
        },
        {
          id: "saved-label-2",
          reviewLabel: "loss",
          gameMode: "bedwars",
          message: "SAVED LOSS SAMPLE",
          unknownAudit: { category: "bedwars_self_death_boundary_review", nextAction: "review_owner_identity" },
        },
      ],
    });
    assert.equal(labelSetSave.status, 200);
    assert.equal(labelSetSave.body.ok, true);
    assert.equal(labelSetSave.body.id, "bedwars-review");
    assert.equal(labelSetSave.body.rows.length, 2);
    assert.equal(labelSetSave.body.summary.labeledRows, 2);
    assert.equal(labelSetSave.body.readiness.status, "ready_for_workflow");
    assert.equal(labelSetSave.body.writes.report, false);
    assert.equal(labelSetSave.body.writes.store, false);
    assert.equal(labelSetSave.body.writes.config, false);
    assert.equal(labelSetSave.body.writes.rules, false);
    assert.equal(labelSetSave.body.writes.labelSet, true);

    const labelSetList = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets");
    assert.equal(labelSetList.status, 200);
    assert.equal(labelSetList.body.ok, true);
    assert.ok(labelSetList.body.items.some((item) => item.id === "bedwars-review" && item.rows === 2 && item.valid));

    const labelSetRead = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets/bedwars-review");
    assert.equal(labelSetRead.status, 200);
    assert.equal(labelSetRead.body.ok, true);
    assert.equal(labelSetRead.body.title, "BedWars review");
    assert.equal(labelSetRead.body.rows[1].message, "SAVED LOSS SAMPLE");
    assert.equal(labelSetRead.body.summary.candidates.draftableRuleRows, 1);

    const labelSetUpdate = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets/bedwars-review", "PUT", {
      title: "BedWars review updated",
      rows: [{ id: "saved-label-3", reviewLabel: null, gameMode: "bedwars" }],
    });
    assert.equal(labelSetUpdate.status, 200);
    assert.equal(labelSetUpdate.body.title, "BedWars review updated");
    assert.equal(labelSetUpdate.body.rows.length, 1);
    assert.equal(labelSetUpdate.body.readiness.status, "needs_labeling");

    const badLabelSetSave = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets", "POST", {
      id: "bad-label-set",
      rows: [{ reviewLabel: "maybe", gameMode: "bedwars" }],
    });
    assert.equal(badLabelSetSave.status, 400);
    assert.equal(badLabelSetSave.body.error, "invalid_label_rows");

    const badLabelSetId = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets/Bad%20ID");
    assert.equal(badLabelSetId.status, 400);
    assert.equal(badLabelSetId.body.error, "invalid_label_set_id");

    const labelSetDelete = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets/bedwars-review", "DELETE");
    assert.equal(labelSetDelete.status, 200);
    assert.equal(labelSetDelete.body.deleted, true);
    const labelSetReadAfterDelete = await fixtureRequest(fixtureContext, "/api/unknown-audit/label-sets/bedwars-review");
    assert.equal(labelSetReadAfterDelete.status, 404);
    assert.equal(labelSetReadAfterDelete.body.error, "label_set_not_found");

    const unlabeledAuditStatus = await fixtureRequest(fixtureContext, "/api/unknown-audit/status", "POST", {
      labels: [
        {
          id: "status-unlabeled",
          reviewLabel: null,
          gameMode: "bedwars",
          unknownAudit: { category: "bedwars_no_safe_result_evidence", nextAction: "label_sample" },
        },
      ],
    });
    assert.equal(unlabeledAuditStatus.status, 200);
    assert.equal(unlabeledAuditStatus.body.ok, true);
    assert.equal(unlabeledAuditStatus.body.status, "needs_labeling");
    assert.equal(unlabeledAuditStatus.body.nextStep, "label_rows");
    assert.equal(unlabeledAuditStatus.body.blocked, true);
    assert.equal(unlabeledAuditStatus.body.requiresHumanInput, true);
    assert.equal(unlabeledAuditStatus.body.canDraftRules, false);
    assert.equal(unlabeledAuditStatus.body.canRunDryRun, false);
    assert.equal(unlabeledAuditStatus.body.counts.unlabeledRows, 1);
    assert.equal(unlabeledAuditStatus.body.writes.report, false);

    const missingTextAuditStatus = await fixtureRequest(fixtureContext, "/api/unknown-audit/status", "POST", {
      labels: [{ reviewLabel: "loss", gameMode: "bedwars", roundRef: null }],
    });
    assert.equal(missingTextAuditStatus.status, 200);
    assert.equal(missingTextAuditStatus.body.status, "needs_rule_text");
    assert.equal(missingTextAuditStatus.body.nextStep, "add_rule_text");
    assert.equal(missingTextAuditStatus.body.blockingReason, "missing_rule_text");
    assert.equal(missingTextAuditStatus.body.counts.missingRuleTextRows, 1);
    assert.equal(missingTextAuditStatus.body.missingRuleTextRows[0].label, "loss");

    const readyAuditStatus = await fixtureRequest(fixtureContext, "/api/unknown-audit/status", "POST", {
      labels: [{ reviewLabel: "loss", gameMode: "bedwars", message: "STATUS LOSS SAMPLE" }],
    });
    assert.equal(readyAuditStatus.status, 200);
    assert.equal(readyAuditStatus.body.status, "ready_for_workflow");
    assert.equal(readyAuditStatus.body.nextStep, "run_audit_workflow");
    assert.equal(readyAuditStatus.body.blocked, false);
    assert.equal(readyAuditStatus.body.canDraftRules, true);
    assert.equal(readyAuditStatus.body.canRunDryRun, true);
    assert.equal(readyAuditStatus.body.readyForWorkflow, true);
    assert.equal(readyAuditStatus.body.workflowRecommended, true);
    assert.equal(readyAuditStatus.body.counts.draftableRuleRows, 1);

    const badAuditStatus = await fixtureRequest(fixtureContext, "/api/unknown-audit/status", "POST", {
      rows: [{ reviewLabel: "maybe", gameMode: "bedwars" }],
    });
    assert.equal(badAuditStatus.status, 400);
    assert.equal(badAuditStatus.body.ok, false);
    assert.equal(badAuditStatus.body.status, "invalid_labels");
    assert.equal(badAuditStatus.body.errors[0].error, "unknown_value");

    const badLifecycleAuditLabels = await fixtureRequest(fixtureContext, "/api/unknown-audit/labels", "POST", {
      rows: [{ reviewLabel: "maybe", gameMode: "bedwars" }],
    });
    assert.equal(badLifecycleAuditLabels.status, 400);
    assert.equal(badLifecycleAuditLabels.body.error, "invalid_label_rows");
    assert.equal(badLifecycleAuditLabels.body.summary.ok, false);
    assert.equal(badLifecycleAuditLabels.body.errors[0].error, "unknown_value");

    const badLifecycleDraftLabel = await fixtureRequest(fixtureContext, "/api/rules/draft-from-labels", "POST", {
      labels: [{ reviewLabel: "maybe", message: "BAD LABEL SAMPLE" }],
    });
    assert.equal(badLifecycleDraftLabel.status, 400);
    assert.equal(badLifecycleDraftLabel.body.error, "invalid_label_rows");
    assert.equal(badLifecycleDraftLabel.body.errors[0].error, "unknown_value");

    const staleLifecycleDraftLabel = await fixtureRequest(fixtureContext, "/api/rules/draft-from-labels", "POST", {
      labels: [{ reviewLabel: "win", roundRef: "stale-round-ref", message: "STALE LABEL SAMPLE" }],
    });
    assert.equal(staleLifecycleDraftLabel.status, 400);
    assert.equal(staleLifecycleDraftLabel.body.error, "invalid_label_rows");
    assert.equal(staleLifecycleDraftLabel.body.errors[0].error, "stale_or_unknown_round_ref");

    const lifecycleAuditWorkflowDraftOnly = await fixtureRequest(fixtureContext, "/api/rules/audit-workflow", "POST", {
      id: "workflow-draft-only",
      skipDryRun: true,
      labels: [{ reviewLabel: "loss", message: "WORKFLOW DRAFT LOSS", gameMode: "bedwars" }],
    });
    assert.equal(lifecycleAuditWorkflowDraftOnly.status, 200);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.ok, true);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.workflow.status, "draft_ready");
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.draft.rules, 1);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.dryRun, null);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.writes.report, false);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.writes.store, false);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.writes.config, false);
    assert.equal(lifecycleAuditWorkflowDraftOnly.body.writes.rules, false);

    const badLifecycleAuditWorkflow = await fixtureRequest(fixtureContext, "/api/rules/audit-workflow", "POST", {
      rows: [{ reviewLabel: "maybe", message: "BAD WORKFLOW LABEL" }],
    });
    assert.equal(badLifecycleAuditWorkflow.status, 400);
    assert.equal(badLifecycleAuditWorkflow.body.error, "invalid_audit_workflow");
    assert.equal(badLifecycleAuditWorkflow.body.labelSummary.ok, false);

    const restoreCustomRuleDirectoryConfig = await fixtureRequest(fixtureContext, "/api/config", "PUT", { customRules: ["custom-rules/user"] });
    assert.equal(restoreCustomRuleDirectoryConfig.status, 200);
    assert.deepEqual(restoreCustomRuleDirectoryConfig.body.effective.customRules, ["custom-rules/user"]);

    const badConfiguredRuleDir = path.join(fixtureDir, "bad-configured-rules");
    await mkdir(badConfiguredRuleDir, { recursive: true });
    await writeFile(
      path.join(badConfiguredRuleDir, "broken.json"),
      JSON.stringify({ id: "broken-configured-rule", rules: [{ id: "bad", type: "win", pattern: "(" }] }, null, 2),
      "utf8",
    );
    const badRuleConfigPath = path.join(fixtureDir, "bad-rule-config.config.json");
    await writeFile(
      badRuleConfigPath,
      JSON.stringify(
        {
          roots: [],
          localConfig: "bad-rule-config.local.json",
          customRules: ["bad-configured-rules"],
        },
        null,
        2,
      ),
      "utf8",
    );
    const badRuleContext = await createReportApiContext(badRuleConfigPath);
    const badConfiguredRulePacks = await fixtureRequest(badRuleContext, "/api/rule-packs");
    assert.equal(badConfiguredRulePacks.status, 400);
    assert.equal(badConfiguredRulePacks.body.ok, false);
    assert.equal(badConfiguredRulePacks.body.error, "invalid_rule_pack_config");
    assert.equal(typeof badConfiguredRulePacks.body.message, "string");
    assert.match(badConfiguredRulePacks.body.details, /invalid regex/);

    const badConfiguredRuleValidation = await fixtureRequest(badRuleContext, "/api/rule-packs/validate");
    assert.equal(badConfiguredRuleValidation.status, 400);
    assert.equal(badConfiguredRuleValidation.body.ok, false);
    assert.equal(badConfiguredRuleValidation.body.error, "invalid_rule_pack_config");
    assert.equal(typeof badConfiguredRuleValidation.body.message, "string");
    assert.match(badConfiguredRuleValidation.body.details, /invalid regex/);

    const localConfig = JSON.parse(await readFile(localConfigPath, "utf8"));
    assert.deepEqual(localConfig.roots, [rootDir]);
    assert.deepEqual(localConfig.owner.aliases, ["LocalNick"]);
    assert.equal(localConfig.app.dataDir, "derived-data");

    const disabledSkin = await fixtureRequest(fixtureContext, "/api/skin?kind=player&source=Steve");
    assert.equal(disabledSkin.status, 403);
    assert.equal(disabledSkin.body.ok, false);
    assert.equal(disabledSkin.body.error, "skin_proxy_disabled");
    assert.equal(typeof disabledSkin.body.message, "string");

    const startRefresh = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
    assert.equal(startRefresh.status, 202);
    assert.equal(startRefresh.body.refresh.phase, "scan");

    const completedRefresh = await waitForFixtureRefresh(fixtureContext);
    assert.equal(completedRefresh.running, false);
    assert.equal(completedRefresh.phase, "done");
    assert.equal(completedRefresh.status, "succeeded");
    assert.equal(completedRefresh.percent, 100);
    assert.ok(Number.isFinite(completedRefresh.durationMs));
    assert.ok(completedRefresh.phaseTimings.scan);
    assert.ok(Number.isFinite(completedRefresh.phaseDurationsMs.scan));
    assert.ok(completedRefresh.phaseTimings.export_store);
    assert.ok(Number.isFinite(completedRefresh.phaseDurationsMs.export_store));
    assert.ok(completedRefresh.phaseTimings.commit);
    assert.ok(Number.isFinite(completedRefresh.phaseDurationsMs.commit));
    assert.ok(completedRefresh.filesTotal >= 1);
    assert.ok(completedRefresh.filesDone >= 1);
    assert.match(completedRefresh.currentFile, /latest\.log$/);
    assert.ok(completedRefresh.diagnostics.discovery.files >= 1);
    assert.ok(Number.isFinite(completedRefresh.diagnostics.discovery.durationMs));
    assert.ok(completedRefresh.diagnostics.scan.files >= 1);
    assert.ok(Number.isFinite(completedRefresh.diagnostics.scan.cacheMisses));
    assert.ok(completedRefresh.diagnostics.chatLines.files >= 1);
    assert.ok(Number.isFinite(completedRefresh.diagnostics.chatLines.cacheMisses));
    assert.ok(completedRefresh.diagnostics.chatEvents.files >= 1);
    assert.ok(Number.isFinite(completedRefresh.diagnostics.chatEvents.cacheMisses));
    assert.ok(completedRefresh.log.every((line) => !line.startsWith("@@MLO_PROGRESS@@")));

    const officialCachePaths = [
      path.join(fixtureDir, ".cache", "parse.json"),
      path.join(fixtureDir, ".cache", "chat.json"),
      path.join(fixtureDir, ".cache", "chat-lines.json"),
    ];
    const officialCachesBeforeDryRun = await Promise.all(officialCachePaths.map((cachePath) => readFile(cachePath, "utf8")));
    const localConfigBeforeDryRun = await readFile(localConfigPath, "utf8");
    const lifecycleAuditWorkflow = await fixtureRequest(fixtureContext, "/api/rules/audit-workflow", "POST", {
      id: "workflow-inline",
      targetMode: "bedwars",
      labels: [{ reviewLabel: "win", message: "WORKFLOW WIN", gameMode: "bedwars" }],
    });
    assert.equal(lifecycleAuditWorkflow.status, 200);
    assert.equal(lifecycleAuditWorkflow.body.ok, true);
    assert.equal(lifecycleAuditWorkflow.body.writes.report, false);
    assert.equal(lifecycleAuditWorkflow.body.writes.store, false);
    assert.equal(lifecycleAuditWorkflow.body.writes.config, false);
    assert.equal(lifecycleAuditWorkflow.body.writes.rules, false);
    assert.equal(lifecycleAuditWorkflow.body.writes.dryRunCache, true);
    assert.equal(lifecycleAuditWorkflow.body.draft.rules, 1);
    assert.ok(lifecycleAuditWorkflow.body.dryRun.promotionGate);
    assert.equal(lifecycleAuditWorkflow.body.dryRun.promotionGate.targetMode, "bedwars");
    assert.ok(["dry_run_pass", "dry_run_review"].includes(lifecycleAuditWorkflow.body.workflow.status));
    assert.doesNotMatch(JSON.stringify(lifecycleAuditWorkflow.body), new RegExp(escapeRegexForTest(fixtureDir)));
    assert.equal(await readFile(localConfigPath, "utf8"), localConfigBeforeDryRun);
    const lifecycleDryRun = await fixtureRequest(fixtureContext, "/api/rules/dry-run", "POST", {
      targetMode: "bedwars",
      rulePack: {
        id: "dry-run-inline",
        name: "Dry Run Inline",
        rules: [{ id: "dry_run_win", type: "win", pattern: "^DRY RUN WIN$" }],
      },
    });
    assert.equal(lifecycleDryRun.status, 200);
    assert.equal(lifecycleDryRun.body.writes.report, false);
    assert.equal(lifecycleDryRun.body.writes.store, false);
    assert.equal(lifecycleDryRun.body.writes.config, false);
    assert.equal(lifecycleDryRun.body.writes.officialCache, false);
    assert.equal(lifecycleDryRun.body.writes.dryRunCache, true);
    assert.equal(lifecycleDryRun.body.cache.officialCache, false);
    assert.equal(lifecycleDryRun.body.cache.dryRunCache, true);
    assert.ok(lifecycleDryRun.body.promotionGate);
    assert.equal(lifecycleDryRun.body.promotionGate.targetMode, "bedwars");
    assert.ok(["pass", "review", "blocked"].includes(lifecycleDryRun.body.promotionGate.status));
    assert.equal(lifecycleDryRun.body.promotionGate.checks.ambiguousResultsDelta, lifecycleDryRun.body.summary.delta.ambiguousResults);
    assert.equal("directory" in lifecycleDryRun.body.cache, false);
    assert.doesNotMatch(JSON.stringify(lifecycleDryRun.body), new RegExp(escapeRegexForTest(fixtureDir)));
    assert.equal(await readFile(localConfigPath, "utf8"), localConfigBeforeDryRun);
    const officialCachesAfterDryRun = await Promise.all(officialCachePaths.map((cachePath) => readFile(cachePath, "utf8")));
    assert.deepEqual(officialCachesAfterDryRun, officialCachesBeforeDryRun);
    const lifecycleAuditAfterDryRun = await fixtureRequest(fixtureContext, "/api/rules/audit");
    assert.ok(lifecycleAuditAfterDryRun.body.items.some((item) => item.action === "dry_run" && item.rulePackId === "dry-run-inline"));
    assert.ok(lifecycleAuditAfterDryRun.body.items.some((item) => item.action === "audit_workflow" && item.rulePackId === "workflow-inline"));

    const missingRulePackDryRun = await fixtureRequest(fixtureContext, "/api/rules/dry-run", "POST", { rulePackId: "missing-dry-run-pack" });
    assert.equal(missingRulePackDryRun.status, 404);
    assert.equal(missingRulePackDryRun.body.error, "rule_pack_not_found");

    const successHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
    assert.equal(successHistory.status, 200);
    assert.ok(successHistory.body.total >= 1);
    assert.equal(successHistory.body.latest.id, completedRefresh.id);
    assert.equal(successHistory.body.latest.status, "succeeded");
    assert.equal(successHistory.body.latest.phase, "done");
    assert.equal(successHistory.body.latest.errorCategory, null);
    assert.ok(Number.isFinite(successHistory.body.latest.durationMs));
    assert.ok(successHistory.body.latest.phaseTimings.scan);
    assert.ok(Number.isFinite(successHistory.body.latest.phaseDurationsMs.scan));
    assert.ok(successHistory.body.latest.phaseTimings.commit);
    assert.ok(Number.isFinite(successHistory.body.latest.phaseDurationsMs.commit));
    assert.ok(successHistory.body.latest.diagnostics.discovery.files >= 1);
    assert.ok(successHistory.body.latest.diagnostics.chatEvents.files >= 1);
    assert.equal(successHistory.body.latest.files.done, successHistory.body.latest.filesDone);
    assert.ok(successHistory.body.summary.succeeded >= 1);
    assert.equal(successHistory.body.summary.lastSucceededAt, successHistory.body.latest.finishedAt);
    assert.ok(Number.isFinite(successHistory.body.summary.averagePhaseDurationsMs.scan));

    const readyPreflight = await fixtureRequest(fixtureContext, "/api/refresh/preflight", "POST");
    assert.equal(readyPreflight.status, 200);
    assert.equal(readyPreflight.body.canRefresh, true);
    assert.equal(readyPreflight.body.recommendedAction, "run_refresh");

    const performanceAfterRefresh = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(performanceAfterRefresh.status, 200);
    assert.equal(performanceAfterRefresh.body.schema.name, "minecraft-log-observatory-performance");
    assert.equal(performanceAfterRefresh.body.refreshHistory.latest.id, completedRefresh.id);
    assert.ok(performanceAfterRefresh.body.baseline.sampleSize >= 1);
    assert.equal(performanceAfterRefresh.body.baseline.latestSucceededAt, completedRefresh.finishedAt);
    assert.ok(Number.isFinite(performanceAfterRefresh.body.baseline.latestDurationMs));
    assert.ok(Number.isFinite(performanceAfterRefresh.body.baseline.averageDurationMs));
    assert.ok(Number.isFinite(performanceAfterRefresh.body.baseline.phaseStats.scan.averageMs));
    assert.ok(performanceAfterRefresh.body.baseline.bottleneckPhase?.phase);
    assert.ok(performanceAfterRefresh.body.comparison);
    assert.equal(typeof performanceAfterRefresh.body.comparison.available, "boolean");
    assert.equal(performanceAfterRefresh.body.store.ready, true);
    assert.ok(performanceAfterRefresh.body.store.declaredFiles >= 1);
    assert.ok(performanceAfterRefresh.body.store.jsonlTables >= 1);
    assert.ok(Number.isFinite(performanceAfterRefresh.body.store.totalBytes));
    assert.ok(Number.isFinite(performanceAfterRefresh.body.store.totalJsonlRows));
    assert.ok(performanceAfterRefresh.body.store.largestFiles.length >= 1);
    assert.ok(performanceAfterRefresh.body.store.tables.some((table) => table.name === "byDay"));
    assert.equal(performanceAfterRefresh.body.storeReads.sampleSize, 0);
    assert.equal(performanceAfterRefresh.body.cache.ready, true);
    assert.equal(performanceAfterRefresh.body.cache.existingFiles, 3);
    assert.equal(performanceAfterRefresh.body.cache.totalFiles, 3);
    assert.ok(Number.isFinite(performanceAfterRefresh.body.cache.totalBytes));
    assert.equal(performanceAfterRefresh.body.cache.files.parse.exists, true);
    assert.equal(performanceAfterRefresh.body.cache.files.chat.exists, true);
    assert.equal(performanceAfterRefresh.body.cache.files.chatLines.exists, true);
    assert.equal("path" in performanceAfterRefresh.body.cache.files.parse, false);
    assert.ok(performanceAfterRefresh.body.apiCache);
    assert.equal("path" in performanceAfterRefresh.body.apiCache, false);
    assert.ok(performanceAfterRefresh.body.apiCache.kinds.every((item) => item.kind && !("path" in item)));
    assert.ok(performanceAfterRefresh.body.refreshDiagnostics.latest.discovery.files >= 1);
    assert.ok(performanceAfterRefresh.body.refreshDiagnostics.latest.chatEvents.files >= 1);
    assert.ok(performanceAfterRefresh.body.refreshDiagnostics.averages.discovery.files >= 1);
    assert.equal(performanceAfterRefresh.body.outputs.consistency.reportMatchesStore, true);
    assert.equal(performanceAfterRefresh.body.outputs.consistency.storeOutOfSync, false);
    assert.equal(performanceAfterRefresh.body.needsRefresh, false);
    assert.ok(performanceAfterRefresh.body.recommendations.some((item) => item.code === "jsonl_store_ok"));

    const warmSummaryA = await fixtureRequest(fixtureContext, "/api/summary");
    assert.equal(warmSummaryA.status, 200);
    const warmSummaryB = await fixtureRequest(fixtureContext, "/api/summary");
    assert.equal(warmSummaryB.status, 200);
    const performanceAfterWarmReads = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(performanceAfterWarmReads.status, 200);
    assert.ok(performanceAfterWarmReads.body.apiCache.hits >= 1);
    assert.ok(performanceAfterWarmReads.body.apiCache.kinds.some((item) => item.kind === "summary" && item.hits >= 1));

    const timedStoreRead = await fixtureRequest(fixtureContext, "/api/store/table?name=byDay&limit=1");
    assert.equal(timedStoreRead.status, 200);
    assert.ok(Number.isFinite(timedStoreRead.body.read.durationMs));
    assert.equal(timedStoreRead.body.read.source, "manifest_count");
    assert.ok(timedStoreRead.body.read.scannedLines <= 1);
    const performanceAfterStoreRead = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(performanceAfterStoreRead.status, 200);
    assert.ok(performanceAfterStoreRead.body.storeReads.sampleSize >= 1);
    assert.ok(performanceAfterStoreRead.body.storeReads.tables.some((table) => table.table === "byDay"));

    const storeManifestPathForPerformance = path.join(fixtureDir, "derived-data", "report-store", "manifest.json");
    const storeManifestTextForPerformance = await readFile(storeManifestPathForPerformance, "utf8");
    const largeStoreManifest = JSON.parse(storeManifestTextForPerformance);
    largeStoreManifest.counts.byDay = 1_000_001;
    await writeFile(storeManifestPathForPerformance, `${JSON.stringify(largeStoreManifest, null, 2)}\n`, "utf8");
    const performanceAfterLargeStore = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(performanceAfterLargeStore.status, 200);
    assert.ok(performanceAfterLargeStore.body.store.totalJsonlRows >= 1_000_001);
    assert.ok(performanceAfterLargeStore.body.recommendations.some((item) => item.code === "review_split_store_limits"));
    await writeFile(storeManifestPathForPerformance, storeManifestTextForPerformance, "utf8");

    const refreshedStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(refreshedStatus.status, 200);
    assert.equal(refreshedStatus.body.report.ready, true);
    assert.equal(refreshedStatus.body.store.ready, true);
    assert.equal(refreshedStatus.body.ready, true);
    assert.equal(refreshedStatus.body.needsRefresh, false);
    assert.deepEqual(refreshedStatus.body.refreshReasons, []);
    assert.equal(refreshedStatus.body.setup.state, "ready");
    assert.equal(refreshedStatus.body.setup.recommendedAction, "none");
    assert.equal(refreshedStatus.body.setup.dataReady, true);
    assert.equal(refreshedStatus.body.report.path, path.join(fixtureDir, "report.json"));
    assert.equal(refreshedStatus.body.store.manifestPath, path.join(fixtureDir, "derived-data", "report-store", "manifest.json"));
    const reportPath = path.join(fixtureDir, "report.json");
    const summaryPathForStatus = path.join(fixtureDir, "summary.json");
    const storeManifestPathForStatus = path.join(fixtureDir, "derived-data", "report-store", "manifest.json");
    const refreshedReportText = await readFile(reportPath, "utf8");
    const refreshedSummaryText = await readFile(summaryPathForStatus, "utf8");
    const refreshedStoreManifestText = await readFile(storeManifestPathForStatus, "utf8");
    const refreshedReport = JSON.parse(refreshedReportText);
    assert.deepEqual(refreshedReport.inputs.ownerAliases, ["LocalNick"]);
    assert.ok(Array.isArray(refreshedReport.inputs.bundledRuleFiles));
    assert.ok(refreshedReport.inputs.bundledRuleFiles.some((item) => item.type === "file" && item.sha256));
    assert.ok(refreshedReport.inputs.customRulePaths.some((item) => item.endsWith(path.join("custom-rules", "user"))));
    assert.ok(Array.isArray(refreshedReport.inputs.customRuleFiles));

    await writeFile(reportPath, `${JSON.stringify({ ...refreshedReport, generatedAt: "2099-01-01T00:00:00.000Z" }, null, 2)}\n`, "utf8");
    const outOfSyncStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(outOfSyncStatus.status, 200);
    assert.equal(outOfSyncStatus.body.store.ready, true);
    assert.equal(outOfSyncStatus.body.store.reportMatchesStore, false);
    assert.equal(outOfSyncStatus.body.store.outOfSync, true);
    assert.equal(outOfSyncStatus.body.needsRefresh, true);
    assert.ok(outOfSyncStatus.body.refreshReasons.includes("store_out_of_sync"));
    const outOfSyncPerformance = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(outOfSyncPerformance.status, 200);
    assert.equal(outOfSyncPerformance.body.outputs.consistency.reportMatchesStore, false);
    assert.equal(outOfSyncPerformance.body.outputs.consistency.storeOutOfSync, true);
    assert.equal(outOfSyncPerformance.body.store.outOfSync, true);
    assert.ok(outOfSyncPerformance.body.recommendations.some((item) => item.code === "refresh_needed"));
    await writeFile(reportPath, refreshedReportText, "utf8");

    await writeFile(reportPath, "{", "utf8");
    const corruptReportStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(corruptReportStatus.status, 200);
    assert.equal(corruptReportStatus.body.needsRefresh, true);
    assert.ok(corruptReportStatus.body.refreshReasons.includes("report_invalid_json"));
    assert.ok(corruptReportStatus.body.recovery.actions.some((item) => item.code === "cleanup_derived_preview" && item.scope === "all_derived"));
    assert.match(corruptReportStatus.body.report.jsonError, /JSON|position|Expected/i);
    await writeFile(reportPath, refreshedReportText, "utf8");

    await writeFile(reportPath, "{}\n", "utf8");
    const malformedReportStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(malformedReportStatus.status, 200);
    assert.equal(malformedReportStatus.body.report.ready, false);
    assert.equal(malformedReportStatus.body.ready, false);
    assert.equal(malformedReportStatus.body.needsRefresh, true);
    assert.ok(malformedReportStatus.body.refreshReasons.includes("report_invalid_schema"));
    assert.equal(malformedReportStatus.body.report.schemaErrorReason, "missing_schema");
    assert.match(malformedReportStatus.body.report.schemaError, /schema/i);

    const malformedReportDiagnostics = await fixtureRequest(fixtureContext, "/api/diagnostics");
    assert.equal(malformedReportDiagnostics.status, 200);
    assert.equal(malformedReportDiagnostics.body.outputs.report.ready, false);
    assert.equal(malformedReportDiagnostics.body.outputs.report.schemaErrorReason, "missing_schema");
    assert.match(malformedReportDiagnostics.body.outputs.report.schemaError, /schema/i);
    assert.doesNotMatch(JSON.stringify(malformedReportDiagnostics.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const malformedReport = await fixtureRequest(fixtureContext, "/api/report");
    assert.equal(malformedReport.status, 503);
    assert.equal(malformedReport.body.error, "report_invalid_schema");
    assert.equal(malformedReport.body.reason, "missing_schema");

    const malformedReportHealth = await fixtureRequest(fixtureContext, "/api/health");
    assert.equal(malformedReportHealth.status, 503);
    assert.equal(malformedReportHealth.body.error, "report_invalid_schema");
    await writeFile(reportPath, refreshedReportText, "utf8");

    await writeFile(summaryPathForStatus, "{", "utf8");
    const corruptSummaryStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(corruptSummaryStatus.status, 200);
    assert.equal(corruptSummaryStatus.body.needsRefresh, true);
    assert.ok(corruptSummaryStatus.body.refreshReasons.includes("summary_invalid_json"));
    assert.match(corruptSummaryStatus.body.report.summaryJsonError, /JSON|position|Expected/i);
    await writeFile(summaryPathForStatus, refreshedSummaryText, "utf8");

    await writeFile(summaryPathForStatus, "{}\n", "utf8");
    const malformedSummaryStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(malformedSummaryStatus.status, 200);
    assert.equal(malformedSummaryStatus.body.report.ready, false);
    assert.equal(malformedSummaryStatus.body.ready, false);
    assert.equal(malformedSummaryStatus.body.needsRefresh, true);
    assert.ok(malformedSummaryStatus.body.refreshReasons.includes("summary_invalid_schema"));
    assert.equal(malformedSummaryStatus.body.report.summarySchemaErrorReason, "missing_schema");
    assert.match(malformedSummaryStatus.body.report.summarySchemaError, /schema/i);

    const malformedSummaryDiagnostics = await fixtureRequest(fixtureContext, "/api/diagnostics");
    assert.equal(malformedSummaryDiagnostics.status, 200);
    assert.equal(malformedSummaryDiagnostics.body.outputs.summary.ready, false);
    assert.equal(malformedSummaryDiagnostics.body.outputs.summary.schemaErrorReason, "missing_schema");
    assert.match(malformedSummaryDiagnostics.body.outputs.summary.schemaError, /schema/i);
    assert.doesNotMatch(JSON.stringify(malformedSummaryDiagnostics.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const malformedSummary = await fixtureRequest(fixtureContext, "/api/summary");
    assert.equal(malformedSummary.status, 503);
    assert.equal(malformedSummary.body.error, "summary_invalid_schema");
    assert.equal(malformedSummary.body.reason, "missing_schema");
    await writeFile(summaryPathForStatus, refreshedSummaryText, "utf8");

    await writeFile(storeManifestPathForStatus, "{", "utf8");
    const corruptStoreStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(corruptStoreStatus.status, 200);
    assert.equal(corruptStoreStatus.body.needsRefresh, true);
    assert.ok(corruptStoreStatus.body.refreshReasons.includes("store_invalid_json"));
    assert.match(corruptStoreStatus.body.store.jsonError, /JSON|position|Expected/i);

    const corruptStoreManifest = await fixtureRequest(fixtureContext, "/api/store");
    assert.equal(corruptStoreManifest.status, 503);
    assert.equal(corruptStoreManifest.body.error, "store_invalid_json");

    const corruptStoreTableManifest = await fixtureRequest(fixtureContext, "/api/store/table?name=byDay");
    assert.equal(corruptStoreTableManifest.status, 503);
    assert.equal(corruptStoreTableManifest.body.error, "store_invalid_json");
    await writeFile(storeManifestPathForStatus, refreshedStoreManifestText, "utf8");

    await writeFile(storeManifestPathForStatus, "{}\n", "utf8");
    const malformedStoreStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(malformedStoreStatus.status, 200);
    assert.equal(malformedStoreStatus.body.store.ready, false);
    assert.equal(malformedStoreStatus.body.ready, false);
    assert.equal(malformedStoreStatus.body.needsRefresh, true);
    assert.ok(malformedStoreStatus.body.refreshReasons.includes("store_invalid_manifest"));
    assert.equal(malformedStoreStatus.body.store.manifestErrorReason, "missing_schema");
    assert.match(malformedStoreStatus.body.store.manifestError, /schema/i);

    const malformedStoreDiagnostics = await fixtureRequest(fixtureContext, "/api/diagnostics");
    assert.equal(malformedStoreDiagnostics.status, 200);
    assert.equal(malformedStoreDiagnostics.body.ready, false);
    assert.ok(malformedStoreDiagnostics.body.refreshReasons.includes("store_invalid_manifest"));

    const malformedStoreManifest = await fixtureRequest(fixtureContext, "/api/store");
    assert.equal(malformedStoreManifest.status, 503);
    assert.equal(malformedStoreManifest.body.error, "store_invalid_manifest");
    assert.equal(malformedStoreManifest.body.reason, "missing_schema");

    const malformedStoreTableManifest = await fixtureRequest(fixtureContext, "/api/store/table?name=byDay");
    assert.equal(malformedStoreTableManifest.status, 503);
    assert.equal(malformedStoreTableManifest.body.error, "store_invalid_manifest");
    assert.equal(malformedStoreTableManifest.body.reason, "missing_schema");
    await writeFile(storeManifestPathForStatus, refreshedStoreManifestText, "utf8");

    const storeByDayPathForStatus = path.join(fixtureDir, "derived-data", "report-store", "by-day.jsonl");
    const refreshedStoreByDayText = await readFile(storeByDayPathForStatus, "utf8");
    await rm(storeByDayPathForStatus, { force: true });
    const missingStoreFileStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(missingStoreFileStatus.status, 200);
    assert.equal(missingStoreFileStatus.body.store.ready, false);
    assert.equal(missingStoreFileStatus.body.ready, false);
    assert.equal(missingStoreFileStatus.body.needsRefresh, true);
    assert.ok(missingStoreFileStatus.body.refreshReasons.includes("store_files_missing"));
    assert.equal(missingStoreFileStatus.body.store.fileErrorReason, "missing_files");
    assert.ok(missingStoreFileStatus.body.store.missingFiles.some((item) => item.name === "byDay"));

    const missingStoreFilePerformance = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(missingStoreFilePerformance.status, 200);
    assert.equal(missingStoreFilePerformance.body.store.ready, false);
    assert.equal(missingStoreFilePerformance.body.store.fileErrorReason, "missing_files");
    assert.ok(missingStoreFilePerformance.body.store.missingFiles.some((item) => item.name === "byDay"));
    assert.ok(missingStoreFilePerformance.body.store.tables.some((table) => table.name === "byDay" && table.exists === false));
    assert.ok(missingStoreFilePerformance.body.recommendations.some((item) => item.code === "refresh_needed"));

    const missingStoreFileDiagnostics = await fixtureRequest(fixtureContext, "/api/diagnostics");
    assert.equal(missingStoreFileDiagnostics.status, 200);
    assert.equal(missingStoreFileDiagnostics.body.outputs.store.ready, false);
    assert.equal(missingStoreFileDiagnostics.body.outputs.store.fileErrorReason, "missing_files");
    assert.ok(missingStoreFileDiagnostics.body.outputs.store.missingFiles.some((item) => item.name === "byDay"));
    assert.doesNotMatch(JSON.stringify(missingStoreFileDiagnostics.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const missingStoreFileDiagnosticsPackage = await fixtureRequest(fixtureContext, "/api/diagnostics/package");
    assert.equal(missingStoreFileDiagnosticsPackage.status, 200);
    assert.equal(missingStoreFileDiagnosticsPackage.body.diagnostics.outputs.store.ready, false);
    assert.equal(missingStoreFileDiagnosticsPackage.body.diagnostics.outputs.store.fileErrorReason, "missing_files");
    assert.ok(missingStoreFileDiagnosticsPackage.body.diagnostics.outputs.store.missingFiles.some((item) => item.name === "byDay"));
    assert.ok(missingStoreFileDiagnosticsPackage.body.diagnostics.outputs.store.missingFiles.some((item) => item.file === "by-day.jsonl"));
    assert.ok(missingStoreFileDiagnosticsPackage.body.appStatus.store.missingFiles.some((item) => item.file === "by-day.jsonl"));
    assert.doesNotMatch(JSON.stringify(missingStoreFileDiagnosticsPackage.body), new RegExp(escapeRegexForTest(fixtureDir)));

    const missingStoreTableFile = await fixtureRequest(fixtureContext, "/api/store/table?name=byDay");
    assert.equal(missingStoreTableFile.status, 503);
    assert.equal(missingStoreTableFile.body.error, "store_table_not_ready");
    await writeFile(storeByDayPathForStatus, refreshedStoreByDayText, "utf8");

    const restoredStoreFileStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(restoredStoreFileStatus.status, 200);
    assert.equal(restoredStoreFileStatus.body.store.ready, true);
    assert.equal(restoredStoreFileStatus.body.needsRefresh, false);

    await writeFile(storeByDayPathForStatus, "{", "utf8");
    const corruptStoreTableFile = await fixtureRequest(fixtureContext, "/api/store/table?name=byDay");
    assert.equal(corruptStoreTableFile.status, 503);
    assert.equal(corruptStoreTableFile.body.error, "store_table_invalid_jsonl");
    await writeFile(storeByDayPathForStatus, refreshedStoreByDayText, "utf8");

    const staleBundledRuleReport = JSON.parse(refreshedReportText);
    staleBundledRuleReport.inputs.bundledRuleFiles[0].sha256 = "stale-rule-hash";
    await writeFile(reportPath, `${JSON.stringify(staleBundledRuleReport, null, 2)}\n`, "utf8");
    const bundledRuleChangedStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(bundledRuleChangedStatus.status, 200);
    assert.equal(bundledRuleChangedStatus.body.needsRefresh, true);
    assert.ok(bundledRuleChangedStatus.body.refreshReasons.includes("inputs_changed"));
    await writeFile(reportPath, refreshedReportText, "utf8");
    const bundledRuleRestoredStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(bundledRuleRestoredStatus.status, 200);
    assert.equal(bundledRuleRestoredStatus.body.needsRefresh, false);
    assert.deepEqual(bundledRuleRestoredStatus.body.refreshReasons, []);

    const statusRulePackSave = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "status-refresh-rule",
      name: "Status Refresh Rule",
      rules: [
        {
          id: "status_refresh_win",
          type: "win",
          pattern: "^Status Refresh > You won!$",
        },
      ],
    });
    assert.equal(statusRulePackSave.status, 200);
    const customRuleChangedStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(customRuleChangedStatus.status, 200);
    assert.equal(customRuleChangedStatus.body.needsRefresh, true);
    assert.ok(customRuleChangedStatus.body.refreshReasons.includes("inputs_changed"));

    const statusRulePackDelete = await fixtureRequest(fixtureContext, "/api/rule-packs/user/status-refresh-rule", "DELETE");
    assert.equal(statusRulePackDelete.status, 200);
    const customRuleRestoredStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(customRuleRestoredStatus.status, 200);
    assert.equal(customRuleRestoredStatus.body.needsRefresh, false);
    assert.deepEqual(customRuleRestoredStatus.body.refreshReasons, []);

    const hotRulePackSave = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "hot-reload-rule",
      name: "Hot Reload Rule",
      rules: [
        {
          id: "hot_reload_win",
          type: "win",
          pattern: "^HOT RELOAD WIN$",
        },
      ],
    });
    assert.equal(hotRulePackSave.status, 200);
    const hotRuleFirstTest = await fixtureRequest(fixtureContext, "/api/rules/test", "POST", { message: "HOT RELOAD WIN" });
    assert.equal(hotRuleFirstTest.status, 200);
    assert.equal(hotRuleFirstTest.body.matched, true);
    assert.equal(hotRuleFirstTest.body.event.ruleId, "hot_reload_win");

    const hotRulePackUpdate = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "hot-reload-rule",
      name: "Hot Reload Rule",
      rules: [
        {
          id: "hot_reload_loss",
          type: "loss",
          pattern: "^HOT RELOAD LOSS$",
        },
      ],
    });
    assert.equal(hotRulePackUpdate.status, 200);
    const hotRuleUpdatedTest = await fixtureRequest(fixtureContext, "/api/rules/test", "POST", { message: "HOT RELOAD LOSS" });
    assert.equal(hotRuleUpdatedTest.status, 200);
    assert.equal(hotRuleUpdatedTest.body.matched, true);
    assert.equal(hotRuleUpdatedTest.body.event.ruleId, "hot_reload_loss");
    const hotRuleOldMessageTest = await fixtureRequest(fixtureContext, "/api/rules/test", "POST", { message: "HOT RELOAD WIN" });
    assert.equal(hotRuleOldMessageTest.status, 200);
    assert.equal(hotRuleOldMessageTest.body.matched, false);
    const hotRulePackDelete = await fixtureRequest(fixtureContext, "/api/rule-packs/user/hot-reload-rule", "DELETE");
    assert.equal(hotRulePackDelete.status, 200);

    const summaryPath = path.join(fixtureDir, "summary.json");
    const storeDir = path.join(fixtureDir, "derived-data", "report-store");
    const oldReportText = await readFile(reportPath, "utf8");
    const oldSummaryText = await readFile(summaryPath, "utf8");
    const oldStoreManifestText = await readFile(path.join(storeDir, "manifest.json"), "utf8");
    const localConfigBeforeRefreshLock = await readFile(localConfigPath, "utf8");
    const refreshLockedRulePackPath = path.join(fixtureDir, "custom-rules", "user", "refresh-locked-rule.json");
    const refreshLockedRulePackSave = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
      id: "refresh-locked-rule",
      name: "Refresh Locked Rule",
      rules: [
        {
          id: "refresh_locked_win",
          type: "win",
          pattern: "^REFRESH LOCKED WIN$",
        },
      ],
    });
    assert.equal(refreshLockedRulePackSave.status, 200);

    const previousRefreshDelay = process.env.MLO_REPORT_TEST_DELAY_MS;
    process.env.MLO_REPORT_TEST_DELAY_MS = "10000";
    try {
      const cancellableRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
      assert.equal(cancellableRefreshStart.status, 202);
      assert.equal(cancellableRefreshStart.body.refresh.running, true);

      const runningRefreshStatus = await fixtureRequest(fixtureContext, "/api/refresh");
      assert.equal(runningRefreshStatus.status, 200);
      assert.equal(runningRefreshStatus.body.id, cancellableRefreshStart.body.refresh.id);
      assert.equal(runningRefreshStatus.body.running, true);
      assert.equal(runningRefreshStatus.body.status, "running");
      assert.equal(typeof runningRefreshStatus.body.startedAt, "string");
      assert.ok(runningRefreshStatus.body.phaseTimings.scan);
      assert.ok(Number.isFinite(runningRefreshStatus.body.phaseDurationsMs.scan));

      const refreshingStatus = await fixtureRequest(fixtureContext, "/api/app/status");
      assert.equal(refreshingStatus.status, 200);
      assert.equal(refreshingStatus.body.refresh.id, cancellableRefreshStart.body.refresh.id);
      assert.equal(refreshingStatus.body.setup.state, "refreshing");
      assert.equal(refreshingStatus.body.setup.recommendedAction, "wait_for_refresh");
      assert.equal(refreshingStatus.body.setup.canConfigure, false);
      assert.equal(refreshingStatus.body.setup.canRefresh, false);
      assert.ok(refreshingStatus.body.setup.reasons.includes("refresh_running"));
      assert.ok(refreshingStatus.body.setup.nextActions.some((item) => item.code === "wait_for_refresh"));
      assert.ok(refreshingStatus.body.recovery.actions.some((item) => item.code === "cancel_refresh" && item.severity === "optional"));

      const cleanupWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "all_derived" });
      assert.equal(cleanupWhileRefreshRunning.status, 409);
      assert.equal(cleanupWhileRefreshRunning.body.error, "refresh_running");
      assert.equal(cleanupWhileRefreshRunning.body.refresh.running, true);
      assert.equal(await readFile(reportPath, "utf8"), oldReportText);
      assert.equal(await readFile(summaryPath, "utf8"), oldSummaryText);
      assert.equal(await readFile(path.join(storeDir, "manifest.json"), "utf8"), oldStoreManifestText);

      const configWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/config", "PUT", { owner: { displayName: "Should Not Save" } });
      assert.equal(configWhileRefreshRunning.status, 409);
      assert.equal(configWhileRefreshRunning.body.error, "refresh_running");
      assert.equal(configWhileRefreshRunning.body.refresh.running, true);
      assert.equal(await readFile(localConfigPath, "utf8"), localConfigBeforeRefreshLock);

      const saveRulePackWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/rule-packs/user", "POST", {
        id: "refresh-running-save",
        name: "Refresh Running Save",
        rules: [
          {
            id: "refresh_running_save_win",
            type: "win",
            pattern: "^REFRESH RUNNING SAVE WIN$",
          },
        ],
      });
      assert.equal(saveRulePackWhileRefreshRunning.status, 409);
      assert.equal(saveRulePackWhileRefreshRunning.body.error, "refresh_running");
      await assertMissing(path.join(fixtureDir, "custom-rules", "user", "refresh-running-save.json"));

      const deleteRulePackWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/rule-packs/user/refresh-locked-rule", "DELETE");
      assert.equal(deleteRulePackWhileRefreshRunning.status, 409);
      assert.equal(deleteRulePackWhileRefreshRunning.body.error, "refresh_running");
      assert.match(await readFile(refreshLockedRulePackPath, "utf8"), /Refresh Locked Rule/);

      const enableRulePackWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/rule-packs/user/enable", "POST", { id: "refresh-locked-rule", enabled: false });
      assert.equal(enableRulePackWhileRefreshRunning.status, 409);
      assert.equal(enableRulePackWhileRefreshRunning.body.error, "refresh_running");

      const restoreRulePackWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/rule-packs/user/restore", "POST", { id: "refresh-locked-rule", backupId: "missing" });
      assert.equal(restoreRulePackWhileRefreshRunning.status, 409);
      assert.equal(restoreRulePackWhileRefreshRunning.body.error, "refresh_running");

      const dryRunWhileRefreshRunning = await fixtureRequest(fixtureContext, "/api/rules/dry-run", "POST", {
        rulePack: { id: "refresh-dry-run", rules: [{ id: "refresh_dry_run_win", type: "win", pattern: "^REFRESH DRY RUN WIN$" }] },
      });
      assert.equal(dryRunWhileRefreshRunning.status, 409);
      assert.equal(dryRunWhileRefreshRunning.body.error, "refresh_running");

      const concurrentRefresh = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
      assert.equal(concurrentRefresh.status, 409);
      assert.equal(concurrentRefresh.body.error, "refresh_already_running");
      assert.equal(concurrentRefresh.body.refresh.running, true);

      const cancelRunningRefresh = await fixtureRequest(fixtureContext, "/api/refresh/cancel", "POST");
      assert.equal(cancelRunningRefresh.status, 202);
      assert.equal(cancelRunningRefresh.body.refresh.cancelRequested, true);
      assert.equal(cancelRunningRefresh.body.refresh.phase, "cancelling");

      const cancelledRefresh = await waitForFixtureRefresh(fixtureContext);
      assert.equal(cancelledRefresh.running, false);
      assert.equal(cancelledRefresh.phase, "cancelled");
      assert.equal(cancelledRefresh.status, "cancelled");
      assert.equal(cancelledRefresh.cancelRequested, true);
      assert.equal(cancelledRefresh.errorCategory, "cancelled");
      assert.equal(cancelledRefresh.error, "Refresh cancelled.");
      assert.equal(await readFile(reportPath, "utf8"), oldReportText);
      assert.equal(await readFile(summaryPath, "utf8"), oldSummaryText);
      assert.equal(await readFile(path.join(storeDir, "manifest.json"), "utf8"), oldStoreManifestText);
      await assertMissing(`${reportPath}.${cancelledRefresh.id}.tmp`);
      await assertMissing(`${summaryPath}.${cancelledRefresh.id}.tmp`);
      await assertMissing(path.join(path.dirname(storeDir), `.refresh-${cancelledRefresh.id}-report-store`));

      const cancelledHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
      assert.equal(cancelledHistory.status, 200);
      assert.equal(cancelledHistory.body.latest.id, cancelledRefresh.id);
      assert.equal(cancelledHistory.body.latest.status, "cancelled");
      assert.equal(cancelledHistory.body.latest.errorCategory, "cancelled");
      assert.ok(cancelledHistory.body.summary.cancelled >= 1);
      assert.equal(cancelledHistory.body.summary.lastCancelledAt, cancelledHistory.body.latest.finishedAt);

      const deleteRefreshLockedRulePack = await fixtureRequest(fixtureContext, "/api/rule-packs/user/refresh-locked-rule", "DELETE");
      assert.equal(deleteRefreshLockedRulePack.status, 200);
    } finally {
      if (previousRefreshDelay === undefined) {
        delete process.env.MLO_REPORT_TEST_DELAY_MS;
      } else {
        process.env.MLO_REPORT_TEST_DELAY_MS = previousRefreshDelay;
      }
    }

    const previousStoreRefreshDelay = process.env.MLO_STORE_TEST_DELAY_MS;
    process.env.MLO_STORE_TEST_DELAY_MS = "10000";
    try {
      const storeCancellableRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
      assert.equal(storeCancellableRefreshStart.status, 202);
      assert.equal(storeCancellableRefreshStart.body.refresh.running, true);

      const storePhaseRefresh = await waitForFixtureRefreshPhase(fixtureContext, "export_store");
      assert.equal(storePhaseRefresh.running, true);
      assert.equal(storePhaseRefresh.phase, "export_store");

      const cancelStoreRefresh = await fixtureRequest(fixtureContext, "/api/refresh/cancel", "POST");
      assert.equal(cancelStoreRefresh.status, 202);
      assert.equal(cancelStoreRefresh.body.refresh.cancelRequested, true);
      assert.equal(cancelStoreRefresh.body.refresh.phase, "cancelling");

      const storeCancelledRefresh = await waitForFixtureRefresh(fixtureContext);
      assert.equal(storeCancelledRefresh.running, false);
      assert.equal(storeCancelledRefresh.phase, "cancelled");
      assert.equal(storeCancelledRefresh.status, "cancelled");
      assert.equal(storeCancelledRefresh.cancelRequested, true);
      assert.equal(storeCancelledRefresh.errorCategory, "cancelled");
      assert.equal(await readFile(reportPath, "utf8"), oldReportText);
      assert.equal(await readFile(summaryPath, "utf8"), oldSummaryText);
      assert.equal(await readFile(path.join(storeDir, "manifest.json"), "utf8"), oldStoreManifestText);
      await assertMissing(`${reportPath}.${storeCancelledRefresh.id}.tmp`);
      await assertMissing(`${summaryPath}.${storeCancelledRefresh.id}.tmp`);
      await assertMissing(path.join(path.dirname(storeDir), `.refresh-${storeCancelledRefresh.id}-report-store`));

      const storeCancelledHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
      assert.equal(storeCancelledHistory.status, 200);
      assert.equal(storeCancelledHistory.body.latest.id, storeCancelledRefresh.id);
      assert.equal(storeCancelledHistory.body.latest.status, "cancelled");
      assert.equal(storeCancelledHistory.body.latest.errorCategory, "cancelled");
      assert.ok(storeCancelledHistory.body.summary.cancelled >= 2);
    } finally {
      if (previousStoreRefreshDelay === undefined) {
        delete process.env.MLO_STORE_TEST_DELAY_MS;
      } else {
        process.env.MLO_STORE_TEST_DELAY_MS = previousStoreRefreshDelay;
      }
    }

    const previousStoreRefreshFail = process.env.MLO_STORE_TEST_FAIL;
    process.env.MLO_STORE_TEST_FAIL = "1";
    try {
      const storeFailedRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
      assert.equal(storeFailedRefreshStart.status, 202);

      const storeFailedRefresh = await waitForFixtureRefresh(fixtureContext);
      assert.equal(storeFailedRefresh.running, false);
      assert.equal(storeFailedRefresh.phase, "failed");
      assert.equal(storeFailedRefresh.status, "failed");
      assert.equal(storeFailedRefresh.failurePhase, "export_store");
      assert.equal(storeFailedRefresh.errorCategory, "store_export_failed");
      assert.match(storeFailedRefresh.error, /Store export exited/);
      assert.equal(await readFile(reportPath, "utf8"), oldReportText);
      assert.equal(await readFile(summaryPath, "utf8"), oldSummaryText);
      assert.equal(await readFile(path.join(storeDir, "manifest.json"), "utf8"), oldStoreManifestText);
      await assertMissing(`${reportPath}.${storeFailedRefresh.id}.tmp`);
      await assertMissing(`${summaryPath}.${storeFailedRefresh.id}.tmp`);
      await assertMissing(path.join(path.dirname(storeDir), `.refresh-${storeFailedRefresh.id}-report-store`));

      const storeFailedHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
      assert.equal(storeFailedHistory.status, 200);
      assert.equal(storeFailedHistory.body.latest.id, storeFailedRefresh.id);
      assert.equal(storeFailedHistory.body.latest.status, "failed");
      assert.equal(storeFailedHistory.body.latest.errorCategory, "store_export_failed");
      assert.equal(storeFailedHistory.body.latest.failurePhase, "export_store");
      assert.ok(storeFailedHistory.body.summary.failed >= 1);
      assert.equal(storeFailedHistory.body.summary.lastErrorCategory, "store_export_failed");
    } finally {
      if (previousStoreRefreshFail === undefined) {
        delete process.env.MLO_STORE_TEST_FAIL;
      } else {
        process.env.MLO_STORE_TEST_FAIL = previousStoreRefreshFail;
      }
    }

    const previousReportRefreshFail = process.env.MLO_REPORT_TEST_FAIL;
    process.env.MLO_REPORT_TEST_FAIL = "1";
    let failedRefresh;
    try {
      const failedRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
      assert.equal(failedRefreshStart.status, 202);
      failedRefresh = await waitForFixtureRefresh(fixtureContext);
      assert.equal(failedRefresh.running, false);
      assert.equal(failedRefresh.phase, "failed");
      assert.equal(failedRefresh.status, "failed");
      assert.equal(failedRefresh.errorCategory, "report_refresh_failed");
      assert.ok(failedRefresh.failurePhase);
      assert.match(failedRefresh.error, /Report refresh exited/);
      assert.equal(await readFile(reportPath, "utf8"), oldReportText);
      assert.equal(await readFile(summaryPath, "utf8"), oldSummaryText);
      assert.equal(await readFile(path.join(storeDir, "manifest.json"), "utf8"), oldStoreManifestText);
      await assertMissing(`${reportPath}.${failedRefresh.id}.tmp`);
      await assertMissing(`${summaryPath}.${failedRefresh.id}.tmp`);
      await assertMissing(path.join(path.dirname(storeDir), `.refresh-${failedRefresh.id}-report-store`));
    } finally {
      if (previousReportRefreshFail === undefined) {
        delete process.env.MLO_REPORT_TEST_FAIL;
      } else {
        process.env.MLO_REPORT_TEST_FAIL = previousReportRefreshFail;
      }
    }

    const failedHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
    assert.equal(failedHistory.status, 200);
    assert.equal(failedHistory.body.latest.id, failedRefresh.id);
    assert.equal(failedHistory.body.latest.status, "failed");
    assert.equal(failedHistory.body.latest.errorCategory, "report_refresh_failed");
    assert.equal(failedHistory.body.latest.failurePhase, failedRefresh.failurePhase);
    assert.ok(failedHistory.body.summary.failed >= 1);
    assert.equal(failedHistory.body.summary.lastFailedAt, failedHistory.body.latest.finishedAt);
    assert.equal(failedHistory.body.summary.lastErrorCategory, "report_refresh_failed");

    const failedPerformance = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(failedPerformance.status, 200);
    assert.equal(failedPerformance.body.refreshHistory.latest.id, failedRefresh.id);
    assert.equal(failedPerformance.body.refreshHistory.latest.errorCategory, "report_refresh_failed");
    assert.equal(failedPerformance.body.refreshHistory.latest.hasError, true);
    assert.ok(failedPerformance.body.refreshHistory.latest.logTailLines >= 0);
    assert.equal("error" in failedPerformance.body.refreshHistory.latest, false);
    assert.equal("logTail" in failedPerformance.body.refreshHistory.latest, false);

    const safePackage = await fixtureRequest(fixtureContext, "/api/diagnostics/package");
    assert.equal(safePackage.status, 200);
    assert.equal(safePackage.body.privacy, "privacy-safe");
    assert.equal(safePackage.body.manifest.privacy, "privacy-safe");
    assert.equal(safePackage.body.manifest.contains.rawLogs, false);
    assert.equal(safePackage.body.manifest.contains.storeRows, false);
    assert.equal(safePackage.body.privacyAudit.checked, true);
    assert.equal(safePackage.body.privacyAudit.safe, true);
    assert.equal(safePackage.body.privacyAudit.issueCount, 0);
    assert.ok(safePackage.body.privacyAudit.checks.includes("forbidden_keys"));
    assert.equal(safePackage.body.appStatus.project.roots[0].redacted, true);
    assert.equal(safePackage.body.appStatus.project.ownerAliases[0].redacted, true);
    assert.equal(safePackage.body.refreshHistory.latest.id, failedRefresh.id);
    assert.equal(safePackage.body.refreshHistory.latest.hasError, true);
    assert.ok(safePackage.body.refreshHistory.latest.logTailLines >= 0);
    assert.equal("error" in safePackage.body.refreshHistory.latest, false);
    assert.equal("logTail" in safePackage.body.refreshHistory.latest, false);
    assert.ok(safePackage.body.refreshHistory.items.every((item) => !("error" in item) && !("logTail" in item)));
    assert.equal(safePackage.body.refreshHistory.summary.lastErrorCategory, "report_refresh_failed");
    assert.equal(safePackage.body.performance.schema.name, "minecraft-log-observatory-performance");
    assert.ok(safePackage.body.performance.baseline.sampleSize >= 1);
    assert.ok(Number.isFinite(safePackage.body.performance.store.totalBytes));
    assert.equal(safePackage.body.performance.cache.totalFiles, 3);
    assert.equal("path" in safePackage.body.performance.cache.files.parse, false);
    assertNoForbiddenKeys(safePackage.body, ["currentFile", "log", "logTail"]);
    const safePackageText = JSON.stringify(safePackage.body);
    assert.doesNotMatch(safePackageText, new RegExp(escapeRegexForTest(rootDir)));
    assert.doesNotMatch(safePackageText, /LocalNick/);

    const fullPackage = await fixtureRequest(fixtureContext, "/api/diagnostics/package?full=true");
    assert.equal(fullPackage.status, 200);
    assert.equal(fullPackage.body.privacy, "full-local");
    assert.equal(fullPackage.body.manifest.privacy, "full-local");
    assert.equal(fullPackage.body.manifest.contains.localPaths, true);
    assert.equal(fullPackage.body.privacyAudit.checked, false);
    assert.equal(fullPackage.body.privacyAudit.safe, false);
    assert.ok(fullPackage.body.appStatus.project.roots.includes(rootDir));

    const refreshHistoryPath = path.join(fixtureDir, ".cache", "refresh-history.json");
    await writeFile(
      refreshHistoryPath,
      JSON.stringify(
        [
          {
            id: "path-leaking-history",
            status: "failed",
            phase: "failed",
            failurePhase: "parse",
            percent: 40,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 1,
            cancelRequested: false,
            currentFile: logPath,
            errorCategory: "report_refresh_failed",
            error: `Report refresh failed while reading ${rootDir}`,
            log: [`Reading ${logPath}`],
            logTail: [`Could not parse ${logPath}`],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
    const pathLeakingHistoryPackage = await fixtureRequest(fixtureContext, "/api/diagnostics/package");
    assert.equal(pathLeakingHistoryPackage.status, 200);
    assert.equal(pathLeakingHistoryPackage.body.refreshHistory.latest.id, "path-leaking-history");
    assert.equal(pathLeakingHistoryPackage.body.refreshHistory.latest.hasCurrentFile, true);
    assert.equal(pathLeakingHistoryPackage.body.refreshHistory.latest.hasError, true);
    assert.equal(pathLeakingHistoryPackage.body.refreshHistory.latest.logLines, 1);
    assert.equal(pathLeakingHistoryPackage.body.refreshHistory.latest.logTailLines, 1);
    assert.equal("currentFile" in pathLeakingHistoryPackage.body.refreshHistory.latest, false);
    assert.equal("error" in pathLeakingHistoryPackage.body.refreshHistory.latest, false);
    assert.equal("log" in pathLeakingHistoryPackage.body.refreshHistory.latest, false);
    assert.equal("logTail" in pathLeakingHistoryPackage.body.refreshHistory.latest, false);
    assert.equal(pathLeakingHistoryPackage.body.privacyAudit.safe, true);
    assert.doesNotMatch(JSON.stringify(pathLeakingHistoryPackage.body), new RegExp(escapeRegexForTest(rootDir)));
    assert.doesNotMatch(JSON.stringify(pathLeakingHistoryPackage.body), /latest\.log/);

    const pathLeakingHistoryPerformance = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(pathLeakingHistoryPerformance.status, 200);
    assert.equal(pathLeakingHistoryPerformance.body.refreshHistory.latest.id, "path-leaking-history");
    assert.equal(pathLeakingHistoryPerformance.body.refreshHistory.latest.hasCurrentFile, true);
    assert.equal(pathLeakingHistoryPerformance.body.refreshHistory.latest.hasError, true);
    assert.equal(pathLeakingHistoryPerformance.body.refreshHistory.latest.logLines, 1);
    assert.equal(pathLeakingHistoryPerformance.body.refreshHistory.latest.logTailLines, 1);
    assert.equal("currentFile" in pathLeakingHistoryPerformance.body.refreshHistory.latest, false);
    assert.equal("error" in pathLeakingHistoryPerformance.body.refreshHistory.latest, false);
    assert.equal("log" in pathLeakingHistoryPerformance.body.refreshHistory.latest, false);
    assert.equal("logTail" in pathLeakingHistoryPerformance.body.refreshHistory.latest, false);
    assert.doesNotMatch(JSON.stringify(pathLeakingHistoryPerformance.body), new RegExp(escapeRegexForTest(rootDir)));
    assert.doesNotMatch(JSON.stringify(pathLeakingHistoryPerformance.body), /latest\.log/);

    await writeFile(refreshHistoryPath, "{ broken refresh history", "utf8");
    const corruptHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
    assert.equal(corruptHistory.status, 200);
    assert.equal(corruptHistory.body.total, 0);
    assert.equal(corruptHistory.body.warning.code, "refresh_history_invalid_json");
    assert.equal(corruptHistory.body.summary.total, 0);
    const corruptPerformance = await fixtureRequest(fixtureContext, "/api/performance");
    assert.equal(corruptPerformance.status, 200);
    assert.equal(corruptPerformance.body.refreshHistory.total, 0);
    assert.equal(corruptPerformance.body.refreshHistory.warning.code, "refresh_history_invalid_json");
    assert.equal(corruptPerformance.body.baseline.sampleSize, 0);
    assert.ok(corruptPerformance.body.warnings.some((warning) => warning.code === "refresh_history_invalid_json"));
    assert.ok(corruptPerformance.body.recommendations.some((item) => item.code === "repair_refresh_history"));
    const corruptHistoryPackage = await fixtureRequest(fixtureContext, "/api/diagnostics/package");
    assert.equal(corruptHistoryPackage.status, 200);
    assert.equal(corruptHistoryPackage.body.refreshHistory.warning.code, "refresh_history_invalid_json");
    assert.equal(corruptHistoryPackage.body.performance.refreshHistory.warning.code, "refresh_history_invalid_json");
    assert.equal(corruptHistoryPackage.body.privacyAudit.safe, true);
    assertNoForbiddenKeys(corruptHistoryPackage.body, ["currentFile", "log", "logTail"]);
    assert.doesNotMatch(JSON.stringify(corruptHistoryPackage.body), new RegExp(escapeRegexForTest(rootDir)));

    const shareFixturePackage = await fixtureRequest(fixtureContext, "/api/share/package");
    assert.equal(shareFixturePackage.status, 200);
    assert.equal(shareFixturePackage.body.privacy, "share-safe");
    assert.equal(shareFixturePackage.body.manifest.kind, "share-package");
    assert.equal(shareFixturePackage.body.manifest.contains.storeRows, false);
    assert.equal(shareFixturePackage.body.privacyAudit.checked, true);
    assert.equal(shareFixturePackage.body.privacyAudit.safe, true);
    assert.equal(shareFixturePackage.body.privacyAudit.issueCount, 0);
    assert.ok(shareFixturePackage.body.privacyAudit.checks.includes("forbidden_keys"));
    assert.equal(shareFixturePackage.body.player.label, "Player");
    assertNoForbiddenKeys(shareFixturePackage.body, ["currentFile", "log", "logTail"]);
    const sharePackageText = JSON.stringify(shareFixturePackage.body);
    assert.doesNotMatch(sharePackageText, new RegExp(escapeRegexForTest(rootDir)));
    assert.doesNotMatch(sharePackageText, /LocalNick/);
    assert.doesNotMatch(sharePackageText, /latest\.log/);
    assert.ok(shareFixturePackage.body.identities.every((item) => /^Identity \d+$/.test(item.label)));

    const shareNestedUuidReport = JSON.parse(refreshedReportText);
    shareNestedUuidReport.profile.days.longestStreak = {
      days: 3,
      uuid: "123e4567-e89b-12d3-a456-426614174000",
      minecraftUuid: "123e4567e89b12d3a456426614174000",
      serverPlayerId: "NestedSecretPlayer",
    };
    await writeFile(reportPath, `${JSON.stringify(shareNestedUuidReport, null, 2)}\n`, "utf8");
    const nestedUuidSharePackage = await fixtureRequest(fixtureContext, "/api/share/package");
    assert.equal(nestedUuidSharePackage.status, 200);
    assert.equal(nestedUuidSharePackage.body.privacyAudit.safe, true);
    const nestedUuidShareText = JSON.stringify(nestedUuidSharePackage.body);
    assert.doesNotMatch(nestedUuidShareText, /123e4567-e89b-12d3-a456-426614174000/i);
    assert.doesNotMatch(nestedUuidShareText, /123e4567e89b12d3a456426614174000/i);
    assert.doesNotMatch(nestedUuidShareText, /NestedSecretPlayer/);
    await writeFile(reportPath, refreshedReportText, "utf8");

    const uuidLeakReport = JSON.parse(refreshedReportText);
    uuidLeakReport.overview.runtime = "123e4567-e89b-12d3-a456-426614174000";
    await writeFile(reportPath, `${JSON.stringify(uuidLeakReport, null, 2)}\n`, "utf8");
    const unsafeUuidSharePackage = await fixtureRequest(fixtureContext, "/api/share/package");
    assert.equal(unsafeUuidSharePackage.status, 500);
    assert.equal(unsafeUuidSharePackage.body.ok, false);
    assert.equal(unsafeUuidSharePackage.body.error, "privacy_audit_failed");
    assert.equal(unsafeUuidSharePackage.body.privacyAudit.safe, false);
    assert.ok(unsafeUuidSharePackage.body.privacyAudit.issues.some((item) => item.code === "uuid"));
    assert.doesNotMatch(JSON.stringify(unsafeUuidSharePackage.body), /123e4567-e89b-12d3-a456-426614174000/i);
    await writeFile(reportPath, refreshedReportText, "utf8");

    const shareLeakReport = JSON.parse(refreshedReportText);
    shareLeakReport.overview.runtime = rootDir;
    await writeFile(reportPath, `${JSON.stringify(shareLeakReport, null, 2)}\n`, "utf8");
    const unsafeSharePackage = await fixtureRequest(fixtureContext, "/api/share/package");
    assert.equal(unsafeSharePackage.status, 500);
    assert.equal(unsafeSharePackage.body.ok, false);
    assert.equal(unsafeSharePackage.body.error, "privacy_audit_failed");
    assert.equal(unsafeSharePackage.body.privacyAudit.safe, false);
    assert.ok(unsafeSharePackage.body.privacyAudit.issues.some((item) => item.code === "windows_absolute_path" || item.code === "known_sensitive_value"));
    assert.doesNotMatch(JSON.stringify(unsafeSharePackage.body), new RegExp(escapeRegexForTest(rootDir)));
    await writeFile(reportPath, refreshedReportText, "utf8");

    await rm(path.join(fixtureDir, "custom-rules", "user", "broken.json"), { force: true });

    const cacheDir = path.join(fixtureDir, ".cache");
    await mkdir(storeDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(reportPath, "{}", "utf8");
    await writeFile(summaryPath, "{}", "utf8");
    await writeFile(path.join(storeDir, "manifest.json"), "{}", "utf8");
    await writeFile(path.join(cacheDir, "parse.json"), "{}", "utf8");

    const unsafeCleanupConfigPath = path.join(fixtureDir, "unsafe-cleanup.config.json");
    await writeFile(
      unsafeCleanupConfigPath,
      JSON.stringify(
        {
          roots: [],
          localConfig: "unsafe-cleanup.local.json",
          outputs: {
            report: "unsafe-cleanup.config.json",
            summary: "unsafe-summary.json",
          },
          cache: {
            parse: ".cache/unsafe-parse.json",
            chat: ".cache/unsafe-chat.json",
            chatLines: ".cache/unsafe-chat-lines.json",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const unsafeCleanupContext = await createReportApiContext(unsafeCleanupConfigPath);
    const unsafeCleanup = await fixtureRequest(unsafeCleanupContext, "/api/data/cleanup", "POST", { scope: "report" });
    assert.equal(unsafeCleanup.status, 200);
    assert.ok(unsafeCleanup.body.skipped.some((item) => item.kind === "report" && item.reason === "target_reserved_project_path"));
    assert.match(await readFile(unsafeCleanupConfigPath, "utf8"), /unsafe-cleanup\.config\.json/);

    const unsafeRefreshOutputs = await fixtureRequest(unsafeCleanupContext, "/api/refresh", "POST");
    assert.equal(unsafeRefreshOutputs.status, 400);
    assert.equal(unsafeRefreshOutputs.body.ok, false);
    assert.equal(unsafeRefreshOutputs.body.error, "unsafe_refresh_outputs");
    assert.ok(unsafeRefreshOutputs.body.errors.some((item) => item.field === "outputs.report" && item.error === "must_target_derived_output_path"));
    const unsafeRefreshState = await fixtureRequest(unsafeCleanupContext, "/api/refresh");
    assert.equal(unsafeRefreshState.status, 200);
    assert.equal(unsafeRefreshState.body.running, false);
    assert.equal(unsafeRefreshState.body.phase, "idle");

    const unsafeRefreshDataDirConfigPath = path.join(fixtureDir, "unsafe-refresh-data-dir.config.json");
    await writeFile(
      unsafeRefreshDataDirConfigPath,
      JSON.stringify(
        {
          roots: [rootDir],
          localConfig: "unsafe-refresh-data-dir.local.json",
          app: {
            dataDir: "src",
          },
          outputs: {
            report: "unsafe-refresh-report.json",
            summary: "unsafe-refresh-summary.json",
          },
          cache: {
            parse: ".cache/unsafe-refresh-parse.json",
            chat: ".cache/unsafe-refresh-chat.json",
            chatLines: ".cache/unsafe-refresh-chat-lines.json",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const unsafeRefreshDataDirContext = await createReportApiContext(unsafeRefreshDataDirConfigPath);
    const unsafeRefreshDataDir = await fixtureRequest(unsafeRefreshDataDirContext, "/api/refresh", "POST");
    assert.equal(unsafeRefreshDataDir.status, 400);
    assert.equal(unsafeRefreshDataDir.body.error, "unsafe_refresh_outputs");
    assert.ok(unsafeRefreshDataDir.body.errors.some((item) => item.field === "app.dataDir" && item.error === "must_target_derived_data_dir"));

    const unsafeRulePackConfigPath = path.join(fixtureDir, "unsafe-rule-pack.config.json");
    await writeFile(
      unsafeRulePackConfigPath,
      JSON.stringify(
        {
          roots: [fixtureDir],
          localConfig: "unsafe-rule-pack.local.json",
          outputs: {
            report: "unsafe-rule-report.json",
            summary: "unsafe-rule-summary.json",
          },
          cache: {
            parse: ".cache/unsafe-rule-parse.json",
            chat: ".cache/unsafe-rule-chat.json",
            chatLines: ".cache/unsafe-rule-chat-lines.json",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const unsafeRulePackContext = await createReportApiContext(unsafeRulePackConfigPath);
    const unsafeRulePackSave = await fixtureRequest(unsafeRulePackContext, "/api/rule-packs/user", "POST", {
      id: "unsafe-rule-pack",
      name: "Unsafe Rule Pack",
      rules: [
        {
          id: "unsafe_rule_pack_win",
          type: "win",
          pattern: "^Unsafe > You won!$",
        },
      ],
    });
    assert.equal(unsafeRulePackSave.status, 400);
    assert.equal(unsafeRulePackSave.body.error, "unsafe_rule_pack_path");
    assert.equal(unsafeRulePackSave.body.reason, "target_inside_minecraft_root");

    const invalidCleanupDryRun = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "report", dryRun: "true" });
    assert.equal(invalidCleanupDryRun.status, 400);
    assert.equal(invalidCleanupDryRun.body.error, "invalid_cleanup_dry_run");

    const invalidCleanupScopeShape = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: null });
    assert.equal(invalidCleanupScopeShape.status, 400);
    assert.equal(invalidCleanupScopeShape.body.error, "invalid_cleanup_scope");

    const cleanupDefaultDryRun = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { dryRun: true });
    assert.equal(cleanupDefaultDryRun.status, 200);
    assert.equal(cleanupDefaultDryRun.body.scope, "cache");
    assert.equal(cleanupDefaultDryRun.body.dryRun, true);
    assert.ok(cleanupDefaultDryRun.body.planned.some((item) => item.kind === "parse_cache"));
    assert.deepEqual(cleanupDefaultDryRun.body.removed ?? [], []);

    const cleanupReportDryRun = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "report", dryRun: true });
    assert.equal(cleanupReportDryRun.status, 200);
    assert.equal(cleanupReportDryRun.body.dryRun, true);
    assert.ok(cleanupReportDryRun.body.planned.some((item) => item.kind === "report" && item.exists));
    assert.ok(cleanupReportDryRun.body.planned.some((item) => item.kind === "summary" && item.exists));
    assert.deepEqual(cleanupReportDryRun.body.removed ?? [], []);
    assert.equal(await readFile(reportPath, "utf8"), "{}");
    assert.equal(await readFile(summaryPath, "utf8"), "{}");

    const cleanupReport = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "report" });
    assert.equal(cleanupReport.status, 200);
    assert.equal(cleanupReport.body.dryRun, false);
    assert.ok(cleanupReport.body.planned.some((item) => item.kind === "report" && item.exists));
    assert.ok(cleanupReport.body.removed.some((item) => item.kind === "report"));

    const cleanupStore = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "store" });
    assert.equal(cleanupStore.status, 200);
    assert.ok(cleanupStore.body.removed.some((item) => item.kind === "store"));

    const missingStore = await fixtureRequest(fixtureContext, "/api/store");
    assert.equal(missingStore.status, 503);
    assert.equal(missingStore.body.error, "store_not_ready");
    const missingStoreTable = await fixtureRequest(fixtureContext, "/api/store/table?name=reliableRounds");
    assert.equal(missingStoreTable.status, 503);
    assert.equal(missingStoreTable.body.error, "store_not_ready");

    const cleanupCache = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "cache" });
    assert.equal(cleanupCache.status, 200);
    assert.ok(cleanupCache.body.removed.some((item) => item.kind === "parse_cache"));

    const cleanedStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(cleanedStatus.status, 200);
    assert.equal(cleanedStatus.body.ready, false);
    assert.equal(cleanedStatus.body.needsRefresh, true);
    assert.ok(cleanedStatus.body.refreshReasons.includes("report_not_ready"));
    assert.ok(cleanedStatus.body.refreshReasons.includes("store_not_ready"));
    assert.equal(cleanedStatus.body.setup.state, "needs_refresh");

    const recoveryRefreshStart = await fixtureRequest(fixtureContext, "/api/refresh", "POST");
    assert.equal(recoveryRefreshStart.status, 202);
    const recoveredRefresh = await waitForFixtureRefresh(fixtureContext);
    assert.equal(recoveredRefresh.status, "succeeded");
    assert.equal(recoveredRefresh.phase, "done");
    assert.ok(Number.isFinite(recoveredRefresh.phaseDurationsMs.scan));

    const recoveredHistory = await fixtureRequest(fixtureContext, "/api/refresh/history");
    assert.equal(recoveredHistory.status, 200);
    assert.equal(recoveredHistory.body.warning, null);
    assert.equal(recoveredHistory.body.latest.id, recoveredRefresh.id);
    assert.equal(recoveredHistory.body.latest.status, "succeeded");

    const recoveredStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(recoveredStatus.status, 200);
    assert.equal(recoveredStatus.body.ready, true);
    assert.equal(recoveredStatus.body.needsRefresh, false);
    assert.equal(recoveredStatus.body.setup.state, "ready");
    assert.equal(recoveredStatus.body.report.ready, true);
    assert.equal(recoveredStatus.body.store.ready, true);

    const recoveredStore = await fixtureRequest(fixtureContext, "/api/store");
    assert.equal(recoveredStore.status, 200);
    assert.equal(recoveredStore.body.schema.name, "minecraft-log-observatory-store");

    const cleanupAllDerivedDryRun = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "all_derived", dryRun: true });
    assert.equal(cleanupAllDerivedDryRun.status, 200);
    assert.equal(cleanupAllDerivedDryRun.body.scope, "all_derived");
    assert.equal(cleanupAllDerivedDryRun.body.dryRun, true);
    assert.ok(cleanupAllDerivedDryRun.body.planned.some((item) => item.kind === "report" && item.exists));
    assert.ok(cleanupAllDerivedDryRun.body.planned.some((item) => item.kind === "summary" && item.exists));
    assert.ok(cleanupAllDerivedDryRun.body.planned.some((item) => item.kind === "store" && item.exists));
    assert.ok(cleanupAllDerivedDryRun.body.planned.some((item) => item.kind === "refresh_history" && item.exists));
    assert.deepEqual(cleanupAllDerivedDryRun.body.removed ?? [], []);
    assert.equal((await readFile(reportPath, "utf8")).trim().startsWith("{"), true);
    assert.equal((await readFile(summaryPath, "utf8")).trim().startsWith("{"), true);
    assert.equal((await readFile(path.join(storeDir, "manifest.json"), "utf8")).trim().startsWith("{"), true);

    const cleanupAllDerived = await fixtureRequest(fixtureContext, "/api/data/cleanup", "POST", { scope: "all_derived" });
    assert.equal(cleanupAllDerived.status, 200);
    assert.equal(cleanupAllDerived.body.scope, "all_derived");
    assert.equal(cleanupAllDerived.body.dryRun, false);
    assert.ok(cleanupAllDerived.body.removed.some((item) => item.kind === "report"));
    assert.ok(cleanupAllDerived.body.removed.some((item) => item.kind === "summary"));
    assert.ok(cleanupAllDerived.body.removed.some((item) => item.kind === "store"));
    assert.ok(cleanupAllDerived.body.removed.some((item) => item.kind === "refresh_history"));
    await assertMissing(reportPath);
    await assertMissing(summaryPath);
    await assertMissing(path.join(storeDir, "manifest.json"));

    const allDerivedCleanedStatus = await fixtureRequest(fixtureContext, "/api/app/status");
    assert.equal(allDerivedCleanedStatus.status, 200);
    assert.equal(allDerivedCleanedStatus.body.ready, false);
    assert.ok(allDerivedCleanedStatus.body.refreshReasons.includes("report_not_ready"));
    assert.ok(allDerivedCleanedStatus.body.refreshReasons.includes("store_not_ready"));

    assert.match(await readFile(logPath, "utf8"), /Hello local log/);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function fixtureRequest(fixtureContext, url, method = "GET", body = {}) {
  return handleReportApiRequest(fixtureContext, { method, url, body });
}

async function assertMissing(filePath) {
  await assert.rejects(() => readFile(filePath, "utf8"), { code: "ENOENT" });
}

function escapeRegexForTest(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoForbiddenKeys(value, forbiddenKeys, pathParts = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbiddenKeys, [...pathParts, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      forbiddenKeys.some((blocked) => blocked.toLowerCase() === key.toLowerCase()),
      false,
      `Forbidden key ${key} found at ${[...pathParts, key].join(".")}`,
    );
    assertNoForbiddenKeys(child, forbiddenKeys, [...pathParts, key]);
  }
}

async function waitForFixtureRefresh(fixtureContext) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fixtureRequest(fixtureContext, "/api/refresh");
    assert.equal(response.status, 200);
    if (!response.body.running) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for fixture refresh.");
}

async function waitForFixtureRefreshPhase(fixtureContext, phase) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fixtureRequest(fixtureContext, "/api/refresh");
    assert.equal(response.status, 200);
    if (response.body.phase === phase) return response.body;
    if (!response.body.running) {
      throw new Error(`Refresh finished before reaching ${phase}: ${response.body.phase}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for fixture refresh phase ${phase}.`);
}
