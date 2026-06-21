import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reportPath = process.argv[2] ?? "report-p0-sample.json";
const report = JSON.parse(await readFile(reportPath, "utf8"));

assert.equal(report.schema?.name, "minecraft-log-observatory-report");
assert.equal(report.schema?.version, 1);
assert.equal(report.version, 1);
if (report.inputs) {
  assert.ok(Array.isArray(report.inputs.roots), "inputs.roots must be an array");
  assert.ok(Array.isArray(report.inputs.selectedRuleSets), "inputs.selectedRuleSets must be an array");
  assert.ok(Array.isArray(report.inputs.bundledRuleFiles), "inputs.bundledRuleFiles must be an array");
  for (const bundledRuleFile of report.inputs.bundledRuleFiles) {
    assert.equal(typeof bundledRuleFile.path, "string", "inputs.bundledRuleFiles[].path must be a string");
    assert.equal(typeof bundledRuleFile.exists, "boolean", "inputs.bundledRuleFiles[].exists must be a boolean");
    if (bundledRuleFile.exists && bundledRuleFile.type === "file") {
      assert.equal(typeof bundledRuleFile.sha256, "string", "inputs.bundledRuleFiles[].sha256 must be a string for files");
    }
  }
  assert.ok(Array.isArray(report.inputs.customRulePaths), "inputs.customRulePaths must be an array");
  assert.ok(Array.isArray(report.inputs.customRuleFiles), "inputs.customRuleFiles must be an array");
  for (const customRuleFile of report.inputs.customRuleFiles) {
    assert.equal(typeof customRuleFile.path, "string", "inputs.customRuleFiles[].path must be a string");
    assert.equal(typeof customRuleFile.exists, "boolean", "inputs.customRuleFiles[].exists must be a boolean");
    if (customRuleFile.exists && customRuleFile.type === "file") {
      assert.equal(typeof customRuleFile.sha256, "string", "inputs.customRuleFiles[].sha256 must be a string for files");
    }
  }
  assert.ok(Array.isArray(report.inputs.ownerAliases), "inputs.ownerAliases must be an array");
}

assert.ok(report.overview, "overview is required");
assert.ok(report.metricDefinitions, "metricDefinitions is required");
assert.equal(report.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(report.metricDefinitions.observedBroadcastMaxKillStreak.scope, "observed_server_chat");
assert.equal(report.metricDefinitions.playerBedDestroys.scope, "player");
assert.equal(report.metricDefinitions.resultEligible.description.includes("False for non-win/loss"), true);
assert.ok(Number.isFinite(report.overview.sessions), "overview.sessions must be numeric");
assert.ok(Number.isFinite(report.overview.playtimeSeconds), "overview.playtimeSeconds must be numeric");
assert.ok(Number.isFinite(report.overview.chatMatched), "overview.chatMatched must be numeric");

assert.ok(report.rounds, "rounds section is required");
assert.ok(Array.isArray(report.rounds.reliable), "rounds.reliable must be an array");
assert.ok(Array.isArray(report.rounds.ignored), "rounds.ignored must be an array");
assert.ok(Array.isArray(report.rounds.all), "rounds.all must be an array");
assert.equal(report.rounds.reliable.length, report.rounds.summary.reliableRounds);
assert.equal(report.rounds.ignored.length, report.rounds.summary.ignoredRounds);
assert.equal(report.rounds.all.length, report.rounds.summary.rounds);
assert.equal(report.rounds.reliable.length + report.rounds.ignored.length, report.rounds.all.length);
assert.equal(report.rounds.allRef, "rounds.all");
assert.ok(Number.isFinite(report.rounds.summary.wins), "rounds.summary.wins must be numeric");
assert.ok(Number.isFinite(report.rounds.summary.losses), "rounds.summary.losses must be numeric");
assert.ok(Number.isFinite(report.rounds.summary.unknownResults), "rounds.summary.unknownResults must be numeric");
assert.ok(Number.isFinite(report.rounds.summary.resultEligibleRounds), "rounds.summary.resultEligibleRounds must be numeric");
assert.ok(Number.isFinite(report.rounds.summary.nonResultRounds), "rounds.summary.nonResultRounds must be numeric");
assert.ok(Number.isFinite(report.rounds.summary.notApplicableResults), "rounds.summary.notApplicableResults must be numeric");
assert.equal(report.overview.playerBedDestroys, report.overview.selfBedDestroys);
assert.equal(report.rounds.summary.playerBedDestroys, report.rounds.summary.selfBedDestroys);
assert.ok(report.rounds.summary.gameModes, "rounds.summary.gameModes is required");
if (report.rounds.summary.gameModes.bedwars) {
  assert.equal(report.rounds.summary.gameModes.bedwars.playerBedDestroys, report.rounds.summary.gameModes.bedwars.selfBedDestroys);
}
if (report.activity?.summary?.gameModes?.the_pit) {
  assert.ok(report.rounds.summary.gameModes.the_pit, "The Pit activity sessions must be present in round mode stats");
  assert.equal(report.rounds.summary.gameModes.the_pit.rounds, report.activity.summary.gameModes.the_pit.segments);
  assert.equal(report.rounds.summary.gameModes.the_pit.notApplicableResults, report.activity.summary.gameModes.the_pit.segments);
  assert.equal(report.rounds.summary.gameModes.the_pit.unknownResults, 0);
  assert.equal(report.rounds.reliable.filter((round) => round.gameMode === "the_pit").every((round) =>
    round.result === "not_applicable" && round.resultEligible === false && round.roundKind === "activity"
  ), true);
}
if (report.rounds.all.length > 0) {
  assert.ok("result" in report.rounds.all[0], "round.result is required");
  assert.ok("resultHint" in report.rounds.all[0], "round.resultHint is required");
  assert.ok("gameMode" in report.rounds.all[0], "round.gameMode is required");
  assert.ok("sessionAlias" in report.rounds.all[0], "round.sessionAlias is required");
  assert.ok("ownerAliasesUsed" in report.rounds.all[0], "round.ownerAliasesUsed is required");
  assert.ok("launcherUser" in report.rounds.all[0], "round.launcherUser is required");
  assert.ok("serverPlayerId" in report.rounds.all[0], "round.serverPlayerId is required");
  assert.ok("serverPlayerIds" in report.rounds.all[0], "round.serverPlayerIds is required");
  assert.ok("serverPlayerIdSource" in report.rounds.all[0], "round.serverPlayerIdSource is required");
  assert.ok("serverPlayerIdConfidence" in report.rounds.all[0], "round.serverPlayerIdConfidence is required");
  assert.equal(report.rounds.all[0].playerBedDestroys, report.rounds.all[0].selfBedDestroys);
}
const unknownRound = report.rounds.reliable.find((round) => round.result === "unknown");
if (unknownRound) {
  assert.ok(unknownRound.resultHint, "unknown reliable rounds must include resultHint");
  assert.ok(unknownRound.resultHint.value, "resultHint.value is required");
  assert.ok(unknownRound.unknownAudit, "unknown reliable rounds must include unknownAudit");
  assert.ok(unknownRound.unknownAudit.category, "unknownAudit.category is required");
  assert.ok(unknownRound.unknownAudit.nextAction, "unknownAudit.nextAction is required");
  assert.ok(["high", "medium", "low"].includes(unknownRound.unknownAudit.reviewPriority), "unknownAudit.reviewPriority is required");
  assert.equal(typeof unknownRound.unknownAudit.reviewReason, "string", "unknownAudit.reviewReason is required");
  assert.ok(unknownRound.unknownAudit.features, "unknownAudit.features is required");
}
const knownRound = report.rounds.reliable.find((round) => round.result !== "unknown");
if (knownRound) {
  assert.equal(knownRound.unknownAudit, null, "known-result rounds must not include unknownAudit suggestions");
}

assert.ok(report.rules?.cache, "rules.cache is required");
assert.equal(report.rules.cache.files, report.rules.cache.hits + report.rules.cache.misses);
assert.ok(report.rules.quality, "rules.quality is required");
assert.equal(typeof report.rules.quality.totalRules, "number", "rules.quality.totalRules must be numeric");
assert.equal(typeof report.rules.quality.hitRules, "number", "rules.quality.hitRules must be numeric");
assert.equal(typeof report.rules.quality.zeroHitRules, "number", "rules.quality.zeroHitRules must be numeric");
assert.ok(report.rules.quality.byRiskGroup, "rules.quality.byRiskGroup is required");
assert.ok(report.rules.quality.byType, "rules.quality.byType is required");
assert.ok(report.rules.quality.byRuleSet, "rules.quality.byRuleSet is required");
assert.ok(report.rules.quality.byRulePack, "rules.quality.byRulePack is required");
assert.ok(Array.isArray(report.rules.quality.duplicatePatterns), "rules.quality.duplicatePatterns must be an array");
assert.ok(Array.isArray(report.rules.quality.topHitRules), "rules.quality.topHitRules must be an array");
assert.ok(Array.isArray(report.rules.quality.zeroHitSamples), "rules.quality.zeroHitSamples must be an array");
assert.ok(Array.isArray(report.rules.quality.resultImpactRules), "rules.quality.resultImpactRules must be an array");
assert.ok(Array.isArray(report.rules.quality.boundaryImpactRules), "rules.quality.boundaryImpactRules must be an array");
assert.ok(report.rules.quality.policy, "rules.quality.policy is required");
assert.equal(
  report.rules.quality.hitRules + report.rules.quality.zeroHitRules,
  report.rules.quality.totalRules,
  "rule quality hit + zero-hit counts must equal total rules",
);
assert.ok(["safe_result", "boundary_only", "diagnostic_only", "experimental"].every((riskGroup) =>
  riskGroup in report.rules.quality.policy
), "rules.quality.policy must document all risk groups");
if (report.rules.quality.topHitRules.length > 0) {
  const topRule = report.rules.quality.topHitRules[0];
  assert.equal(typeof topRule.key, "string", "rules.quality.topHitRules[].key must be a string");
  assert.equal(typeof topRule.ruleSet, "string", "rules.quality.topHitRules[].ruleSet must be a string");
  assert.equal(typeof topRule.ruleId, "string", "rules.quality.topHitRules[].ruleId must be a string");
  assert.equal(typeof topRule.hitCount, "number", "rules.quality.topHitRules[].hitCount must be numeric");
  assert.ok(["safe_result", "boundary_only", "diagnostic_only", "experimental"].includes(topRule.riskGroup));
  assert.equal(typeof topRule.impact?.matchedChatLines, "number", "rules.quality.topHitRules[].impact.matchedChatLines must be numeric");
  assert.equal(typeof topRule.impact?.resultSignal, "boolean", "rules.quality.topHitRules[].impact.resultSignal must be boolean");
  assert.equal(typeof topRule.impact?.resultEvidence, "boolean", "rules.quality.topHitRules[].impact.resultEvidence must be boolean");
  assert.equal(typeof topRule.impact?.boundarySignal, "boolean", "rules.quality.topHitRules[].impact.boundarySignal must be boolean");
}

assert.equal(report.raw?.roundsRef, "rounds.all");
assert.ok(Array.isArray(report.byDay), "byDay must be an array");
assert.ok(report.byDay.length > 0, "byDay must not be empty");
assert.ok(Array.isArray(report.byWeek), "byWeek must be an array");
assert.ok(Array.isArray(report.byMonth), "byMonth must be an array");

assert.ok(report.accounts, "accounts section is required");
assert.ok(report.accounts.owner, "accounts.owner is required");
assert.equal(report.accounts.owner.mode, "all_local_users");
assert.ok(Array.isArray(report.accounts.owner.aliases), "accounts.owner.aliases must be an array");
assert.ok(report.accounts.owner.eventStats, "accounts.owner.eventStats is required");
assert.equal(report.accounts.owner.observedEvents, report.accounts.owner.eventStats.events);
assert.ok(Array.isArray(report.accounts.localUsers), "accounts.localUsers must be an array");
assert.ok(Array.isArray(report.accounts.aliases), "accounts.aliases must be an array");
assert.ok(Array.isArray(report.accounts.aliasCandidates), "accounts.aliasCandidates must be an array");

assert.ok(report.rules.unmatchedByCategory, "rules.unmatchedByCategory is required");
assert.ok(report.rules.topUnmatchedByCategory, "rules.topUnmatchedByCategory is required");

assert.ok(report.results, "results section is required");
assert.ok(report.results.summary, "results.summary is required");
assert.ok(Number.isFinite(report.results.summary.knownResultRate), "results.summary.knownResultRate must be numeric");
assert.ok(report.results.signals, "results.signals is required");
assert.ok(report.results.unknownHints, "results.unknownHints is required");
assert.equal(report.results.unknownHints.total, report.results.summary.unknownRoundResults);
assert.ok(report.results.unknownHints.byHint, "results.unknownHints.byHint is required");
assert.ok(report.results.unknownHints.byReason, "results.unknownHints.byReason is required");
assert.ok(Array.isArray(report.results.unknownHints.examples), "results.unknownHints.examples must be an array");
if (unknownRound) {
  assert.equal(typeof report.results.unknownHints.byReason[unknownRound.resultHint.reason], "number");
}
assert.ok(report.results.unknownAudit, "results.unknownAudit is required");
assert.equal(report.results.unknownAudit.total, report.results.summary.unknownRoundResults);
assert.ok(report.results.unknownAudit.byCategory, "results.unknownAudit.byCategory is required");
assert.ok(report.results.unknownAudit.byNextAction, "results.unknownAudit.byNextAction is required");
assert.ok(report.results.unknownAudit.byPriority, "results.unknownAudit.byPriority is required");
assert.equal(
  Object.values(report.results.unknownAudit.byPriority).reduce((total, count) => total + count, 0),
  report.results.unknownAudit.total,
  "results.unknownAudit.byPriority counts must sum to total",
);
assert.ok(Array.isArray(report.results.unknownAudit.examples), "results.unknownAudit.examples must be an array");

assert.ok(report.activity, "activity section is required");
assert.ok(report.activity.summary, "activity.summary is required");
assert.ok(Number.isFinite(report.activity.summary.segments), "activity.summary.segments must be numeric");
assert.ok(report.activity.summary.gameModes, "activity.summary.gameModes is required");
assert.ok(Array.isArray(report.activity.segments), "activity.segments must be an array");
if (report.activity.segments.length > 0) {
  assert.ok("launcherUser" in report.activity.segments[0], "activity.segment.launcherUser is required");
  assert.ok("serverPlayerId" in report.activity.segments[0], "activity.segment.serverPlayerId is required");
  assert.ok("serverPlayerIds" in report.activity.segments[0], "activity.segment.serverPlayerIds is required");
  assert.ok("serverPlayerIdSource" in report.activity.segments[0], "activity.segment.serverPlayerIdSource is required");
  assert.ok("serverPlayerIdConfidence" in report.activity.segments[0], "activity.segment.serverPlayerIdConfidence is required");
}

assert.ok(report.profile, "profile section is required");
assert.ok(report.profile.metricDefinitions, "profile.metricDefinitions is required");
assert.equal(report.profile.metricDefinitions.playerMaxKillStreak.scope, "player");
assert.ok(report.profile.totals, "profile.totals is required");
assert.ok(report.profile.days, "profile.days is required");
assert.ok(report.profile.preferences, "profile.preferences is required");
assert.ok(report.profile.extremes, "profile.extremes is required");
assert.ok(report.profile.identities, "profile.identities is required");
assert.ok(Number.isFinite(report.profile.totals.localUserCount), "profile.totals.localUserCount must be numeric");
assert.equal(report.profile.totals.clientStarts, report.overview.starts);
assert.equal(report.profile.totals.serverConnects, report.overview.connects);
assert.equal(report.profile.totals.crashes, report.overview.crashes);
assert.equal(report.profile.totals.activitySegments, report.activity.summary.segments);
assert.equal(report.profile.totals.knownResults, report.profile.totals.wins + report.profile.totals.losses + report.profile.totals.ambiguousResults);
assert.equal(report.profile.totals.playerBedDestroys, report.profile.totals.selfBedDestroys);
assert.ok("longestMultiplayerPlaytime" in report.profile.days, "profile.days.longestMultiplayerPlaytime is required");
assert.ok("longestSingleplayerPlaytime" in report.profile.days, "profile.days.longestSingleplayerPlaytime is required");
assert.ok(Array.isArray(report.profile.identities.items), "profile.identities.items must be an array");
assert.ok(Array.isArray(report.profile.identities.topByPlaytime), "profile.identities.topByPlaytime must be an array");
assert.ok(Array.isArray(report.profile.identities.topByRounds), "profile.identities.topByRounds must be an array");
assert.ok(Array.isArray(report.profile.identities.topByKills), "profile.identities.topByKills must be an array");

console.log(`report schema tests passed: ${reportPath}`);
