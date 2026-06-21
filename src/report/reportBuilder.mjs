import { listRuleSetDetails, listRuleSets } from "../parser/chatRules.mjs";
import { buildBundledRuleManifest, buildCustomRuleManifest } from "../parser/customRuleManifest.mjs";
import { formatDuration } from "../parser/time.mjs";
import { applyBoundaryResultInference, applyKnownServerPlayerToRound, getIgnoredRoundReason, isReliableRound } from "../parser/roundBuilder.mjs";
import { labelGameMode, unknownGameMode } from "../parser/gameModes.mjs";
import { normalizePlayerDisplayName, normalizePlayerIdCounts, noteServerPlayerIdFromEvent, resolveServerPlayerIdentity } from "./playerIdentity.mjs";
import { buildDirectServerContext, ensureServerContext, inferProxiedServerContext, inferServerContextFromChatLines, inferServerContextFromRound } from "../parser/serverContext.mjs";
import { buildUnknownAudit, buildUnknownAuditSummary } from "./unknownAudit.mjs";
import { buildMetricDefinitions } from "./metricDefinitions.mjs";

const LONG_SESSION_SECONDS = 6 * 3600;
const ACTIVITY_GAP_MS = 60 * 60 * 1000;
const ACTIVITY_MODE_IDS = new Set(["the_pit"]);

export function buildReport({ roots, encoding, ruleSets, customRulePaths, owner, summaries, eventResult, rounds }) {
  const chatLines = eventResult.chatLines ?? [];
  const serverAnnotatedRounds = annotateRoundsWithServerContext(rounds, summaries, eventResult.events, chatLines);
  const propagatedRounds = addPlayerKillStreakToRounds(applyPostIdentityResultInference(propagateServerPlayerIdentityWithinPlaySegments(serverAnnotatedRounds, summaries)));
  const reliableMatchRounds = propagatedRounds.filter(isReliableRound);
  const ignoredRounds = propagatedRounds.filter((round) => !isReliableRound(round));
  const generatedAt = new Date().toISOString();
  const availableRuleSets = listRuleSets({ customRulePaths });
  const ruleSetDetails = listRuleSetDetails({ ruleSets, customRulePaths });
  const activity = buildActivity(summaries, eventResult.events, chatLines);
  const activityStatRounds = buildActivityStatRounds(activity.segments);
  const reliableRounds = [...reliableMatchRounds, ...activityStatRounds];
  const allRounds = [...propagatedRounds, ...activityStatRounds];
  const bySource = aggregateBySource(summaries, reliableRounds, allRounds, activity.segments);
  const byScope = aggregateByScope(summaries, reliableRounds, allRounds, activity.segments);
  const byDay = aggregateByDay(summaries, reliableRounds, allRounds, eventResult.events, activity.segments);
  const byWeek = aggregatePeriod(byDay, "week");
  const byMonth = aggregatePeriod(byDay, "month");
  const confidence = buildConfidence(allRounds);
  const anomalies = buildAnomalies(summaries, propagatedRounds, eventResult.unmatchedTemplates ?? []);
  const overview = buildOverview(summaries, eventResult, allRounds, reliableRounds, activity);
  const roundSection = buildRoundSection(allRounds, reliableRounds, ignoredRounds);
  const results = buildResults(eventResult.events, reliableRounds);
  const accounts = buildAccounts(eventResult.events, reliableRounds, summaries, owner);
  const profile = buildProfile({ generatedAt, summaries, reliableRounds, byDay, byScope, accounts, overview, activity });

  const topUnmatchedByCategory = categorizeUnmatchedTemplates(eventResult.unmatchedTemplates ?? []);

  return {
    schema: {
      name: "minecraft-log-observatory-report",
      version: 1,
    },
    version: 1,
    generatedAt,
    roots,
    encoding,
    selectedRuleSets: ruleSets?.length ? ruleSets : "all",
    inputs: buildReportInputs({ roots, encoding, ruleSets, customRulePaths, owner }),
    overview,
    metricDefinitions: buildMetricDefinitions(),
    bySource,
    byScope,
    byDay,
    byWeek,
    byMonth,
    confidence,
    results,
    activity,
    profile,
    rounds: roundSection,
    accounts,
    rules: {
      available: availableRuleSets,
      selected: ruleSets?.length ? ruleSets : availableRuleSets.map((ruleSet) => ruleSet.id),
      eventCounts: eventResult.counts,
      byRuleSet: sortCountObject(eventResult.ruleCounts?.byRuleSet ?? {}),
      byRuleId: sortCountObject(eventResult.ruleCounts?.byRuleId ?? {}),
      byRulePack: sortCountObject(eventResult.ruleCounts?.byRulePack ?? {}),
      byRulePackId: sortCountObject(eventResult.ruleCounts?.byRulePackId ?? {}),
      quality: buildRuleQuality(ruleSetDetails, eventResult.ruleCounts?.byRulePackId ?? eventResult.ruleCounts?.byRuleId ?? {}, eventResult.events, reliableRounds),
      chatLines: eventResult.totals.chatLines,
      matched: eventResult.totals.matched,
      unmatched: Math.max(0, eventResult.totals.chatLines - eventResult.totals.matched),
      matchRate: ratio(eventResult.totals.matched, eventResult.totals.chatLines),
      cache: {
        files: eventResult.totals.files,
        hits: eventResult.totals.cacheHits ?? 0,
        misses: eventResult.totals.cacheMisses ?? 0,
      },
      topUnmatchedByCategory,
      unmatchedByCategory: topUnmatchedByCategory,
    },
    anomalies,
    raw: {
      analysisSummaries: summaries,
      roundsRef: "rounds.all",
    },
  };
}

function buildRuleQuality(ruleSets, byRuleId, events, reliableRounds) {
  const rows = [];
  const resultRuleKeys = new Set(events.filter((event) => ["win", "loss"].includes(event.type)).map((event) => rulePackKey(event)));
  const boundaryRuleKeys = new Set(events.filter((event) => ["round_start", "round_end", "round_countdown", "server_connect", "player_join", "player_leave", "game_mode"].includes(event.type)).map((event) => rulePackKey(event)));
  const resultEvidenceRuleKeys = new Set();
  for (const round of reliableRounds) {
    for (const evidence of round.resultEvidence ?? []) {
      if (!evidence?.ruleSet || !evidence?.ruleId) continue;
      if (evidence.result === "win" || evidence.result === "loss") {
        resultEvidenceRuleKeys.add(rulePackKey(evidence));
      }
    }
  }
  const patternIndex = new Map();
  for (const ruleSet of ruleSets ?? []) {
    for (const rule of ruleSet.rules ?? []) {
      const key = `${ruleSet.id}:${rule.id}`;
      const hitCount = byRuleId[key] ?? 0;
      const riskGroup = classifyRuleRisk(rule, {
        key,
        resultRuleKeys,
        boundaryRuleKeys,
        resultEvidenceRuleKeys,
      });
      const patternKey = `${rule.type ?? ""}\0${rule.flags ?? ""}\0${rule.pattern ?? ""}`;
      patternIndex.set(patternKey, [...(patternIndex.get(patternKey) ?? []), key]);
      rows.push({
        ruleSet: ruleSet.id,
        rulePack: ruleSet.id,
        ruleId: rule.id,
        key,
        type: rule.type,
        hitCount,
        riskGroup,
        impact: {
          matchedChatLines: hitCount,
          resultSignal: resultRuleKeys.has(key),
          resultEvidence: resultEvidenceRuleKeys.has(key),
          boundarySignal: boundaryRuleKeys.has(key),
        },
      });
    }
  }
  const duplicatePatterns = [...patternIndex.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([patternKey, keys]) => {
      const [type, flags, pattern] = patternKey.split("\0");
      return { type, flags, pattern, rules: keys.sort() };
    })
    .sort((a, b) => b.rules.length - a.rules.length || a.pattern.localeCompare(b.pattern));
  const sortedRows = rows.sort((a, b) => b.hitCount - a.hitCount || a.key.localeCompare(b.key));
  const zeroHit = sortedRows.filter((row) => row.hitCount === 0);
  const resultImpact = sortedRows.filter((row) => row.impact.resultSignal || row.impact.resultEvidence);
  const boundaryImpact = sortedRows.filter((row) => row.impact.boundarySignal);
  return {
    totalRules: rows.length,
    hitRules: rows.filter((row) => row.hitCount > 0).length,
    zeroHitRules: zeroHit.length,
    byRiskGroup: countBy(sortedRows, (row) => row.riskGroup),
    byType: countBy(sortedRows, (row) => row.type ?? "unknown"),
    byRuleSet: Object.fromEntries(
      Object.entries(groupRowsBy(sortedRows, (row) => row.ruleSet))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ruleSet, items]) => [ruleSet, {
          totalRules: items.length,
          hitRules: items.filter((row) => row.hitCount > 0).length,
          zeroHitRules: items.filter((row) => row.hitCount === 0).length,
          hits: items.reduce((total, row) => total + row.hitCount, 0),
        }]),
    ),
    byRulePack: Object.fromEntries(
      Object.entries(groupRowsBy(sortedRows, (row) => row.rulePack))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([rulePack, items]) => [rulePack, {
          totalRules: items.length,
          hitRules: items.filter((row) => row.hitCount > 0).length,
          zeroHitRules: items.filter((row) => row.hitCount === 0).length,
          hits: items.reduce((total, row) => total + row.hitCount, 0),
        }]),
    ),
    duplicatePatterns,
    topHitRules: sortedRows.slice(0, 25),
    zeroHitSamples: zeroHit.slice(0, 50),
    resultImpactRules: resultImpact.slice(0, 50),
    boundaryImpactRules: boundaryImpact.slice(0, 50),
    policy: {
      safe_result: "Rules that directly produce win/loss or are observed in result evidence.",
      boundary_only: "Rules that mainly create mode/boundary/population signals.",
      diagnostic_only: "Rules that enrich context without directly changing result statistics.",
      experimental: "Low-confidence or broad custom/unknown rules that need review before promotion.",
    },
  };
}

function rulePackKey(event) {
  return `${event.rulePack ?? event.ruleSet}:${event.ruleId}`;
}

function classifyRuleRisk(rule, context) {
  const type = rule?.type ?? "unknown";
  if (["win", "loss"].includes(type) || context.resultEvidenceRuleKeys.has(context.key)) return "safe_result";
  if (["round_start", "round_end", "round_countdown", "game_mode", "server_connect", "player_join", "player_leave"].includes(type) || context.boundaryRuleKeys.has(context.key)) return "boundary_only";
  if (rule?.confidence === "experimental" || looksBroadRulePattern(rule?.pattern)) return "experimental";
  return "diagnostic_only";
}

function looksBroadRulePattern(pattern = "") {
  const text = String(pattern);
  return text.length < 12 || text === ".*" || text === "^.*$" || /\.\*\??/.test(text.replace(/^\^|\$$/g, ""));
}

function buildReportInputs({ roots, encoding, ruleSets, customRulePaths, owner }) {
  const normalizedCustomRulePaths = normalizeStrings(customRulePaths).sort();
  return {
    roots: normalizeStrings(roots).sort(),
    encoding,
    selectedRuleSets: ruleSets?.length ? [...ruleSets].sort() : [],
    bundledRuleFiles: buildBundledRuleManifest(),
    customRulePaths: normalizedCustomRulePaths,
    customRuleFiles: buildCustomRuleManifest(normalizedCustomRulePaths),
    ownerAliases: normalizeStrings(owner?.aliases).sort(),
    ownerMode: owner?.mode ?? "all_local_users",
  };
}

function normalizeStrings(values = []) {
  return Array.from(values ?? []).map((value) => String(value)).filter(Boolean);
}

export function createReportSummary(report, options = {}) {
  const topScopes = report.byScope.slice(0, options.top ?? 10);
  const topDays = [...report.byDay]
    .sort((a, b) => b.playtimeSeconds - a.playtimeSeconds)
    .slice(0, options.topDays ?? 10);

  return {
    schema: {
      name: "minecraft-log-observatory-summary",
      version: 1,
      reportSchema: report.schema,
    },
    generatedAt: report.generatedAt,
    overview: {
      schemaVersion: report.schema?.version ?? report.version,
      scopes: report.overview.scopes,
      files: report.overview.files,
      sizeMb: report.overview.sizeMb,
      sessions: report.overview.sessions,
      runtime: report.overview.runtime,
      playtime: report.overview.playtime,
      multiplayer: report.overview.multiplayer,
      singleplayer: report.overview.singleplayer,
      chatLines: report.overview.chatLines,
      chatMatched: report.overview.chatMatched,
      chatMatchRate: report.overview.chatMatchRate,
      crashes: report.overview.crashes,
      reliableRounds: report.overview.reliableRounds,
      roundDuration: report.overview.roundDuration,
      kills: report.overview.kills,
      deaths: report.overview.deaths,
      playerMaxKillStreak: report.overview.playerMaxKillStreak,
      activityGoldEarned: report.overview.activityGoldEarned ?? 0,
      activityXpEarned: report.overview.activityXpEarned ?? 0,
      activityBountyClaims: report.overview.activityBountyClaims ?? 0,
      activityBountyGoldEarned: report.overview.activityBountyGoldEarned ?? 0,
      pitGoldEarned: report.overview.pitGoldEarned ?? 0,
      pitXpEarned: report.overview.pitXpEarned ?? 0,
      pitBountyClaims: report.overview.pitBountyClaims ?? 0,
      pitBountyGoldEarned: report.overview.pitBountyGoldEarned ?? 0,
      bestWinStreak: report.overview.bestWinStreak,
      currentWinStreak: report.overview.currentWinStreak,
      winStreaks: report.overview.winStreaks,
      bedDestroys: report.overview.bedDestroys,
      selfKills: report.overview.selfKills,
      selfDeaths: report.overview.selfDeaths,
      selfBedDestroys: report.overview.selfBedDestroys,
      playerBedDestroys: report.overview.playerBedDestroys,
      wins: report.overview.wins,
      losses: report.overview.losses,
      unknownResults: report.overview.unknownResults,
      ambiguousResults: report.overview.ambiguousResults,
      winRate: report.overview.winRate,
      knownResultRate: report.overview.knownResultRate,
      chatCache: `${report.rules.cache.hits}/${report.rules.cache.files}`,
      chatCacheHits: report.rules.cache.hits,
      chatCacheMisses: report.rules.cache.misses,
    },
    rounds: report.rounds.summary,
    profile: report.profile,
    metricDefinitions: report.metricDefinitions ?? buildMetricDefinitions(),
    accounts: {
      owner: report.accounts.owner,
      localUsers: report.accounts.localUsers.length,
      topLocalUsers: report.accounts.localUsers.slice(0, 10),
      topPlaytimeUsers: report.accounts.playtimeByUser.slice(0, 10),
    },
    confidence: report.confidence.summary,
    results: report.results.summary,
    activity: report.activity?.summary ?? null,
    topScopes: topScopes.map((scope) => ({
      source: scope.source,
      scope: scope.scope,
      playtime: scope.playtime,
      sessions: scope.sessions,
      reliableRounds: scope.rounds.reliable,
      kills: scope.rounds.kills,
      deaths: scope.rounds.deaths,
      bedDestroys: scope.rounds.bedDestroys,
      selfKills: scope.rounds.selfKills,
      selfBedDestroys: scope.rounds.selfBedDestroys,
      playerBedDestroys: scope.rounds.playerBedDestroys ?? scope.rounds.selfBedDestroys ?? 0,
      wins: scope.rounds.wins,
      losses: scope.rounds.losses,
      winRate: scope.rounds.winRate,
      crashes: scope.crashes,
    })),
    topDays: topDays.map((day) => ({
      date: day.date,
      playtime: day.playtime,
      reliableRounds: day.rounds.reliable,
      kills: day.rounds.kills,
      selfKills: day.rounds.selfKills,
      selfBedDestroys: day.rounds.selfBedDestroys,
      playerBedDestroys: day.rounds.playerBedDestroys ?? day.rounds.selfBedDestroys ?? 0,
      wins: day.rounds.wins,
      losses: day.rounds.losses,
      winRate: day.rounds.winRate,
      crashes: day.crashes,
    })),
    anomalies: {
      ignoredRounds: report.anomalies.ignoredRounds.length,
      longClientSessions: report.anomalies.longClientSessions.length,
      crashyScopes: report.anomalies.crashyScopes.slice(0, 5),
      unmatchedTemplates: report.anomalies.unmatchedTemplates.slice(0, 10),
      topUnmatchedByCategory: report.rules.topUnmatchedByCategory,
      unmatchedByCategory: report.rules.unmatchedByCategory,
    },
  };
}

function buildOverview(summaries, eventResult, rounds, reliableRounds, activity = emptyActivitySection()) {
  const fileBytes = summaries.reduce((total, summary) => total + summary.bytes, 0);
  const runtimeSeconds = summaries.reduce((total, summary) => total + sumDurations(summary.clientSessions), 0);
  const playtimeSeconds = summaries.reduce((total, summary) => total + sumDurations(summary.playSegments), 0);
  const multiplayerSeconds = summaries.reduce((total, summary) => total + sumDurations(summary.playSegments.filter((segment) => segment.type === "multiplayer")), 0);
  const singleplayerSeconds = summaries.reduce((total, summary) => total + sumDurations(summary.playSegments.filter((segment) => segment.type === "singleplayer")), 0);
  const roundStats = aggregateRoundStats(reliableRounds, rounds);
  const winStreaks = buildWinStreakSummary(reliableRounds);

  return withDurations({
    scopes: summaries.length,
    files: summaries.reduce((total, summary) => total + summary.logFiles, 0),
    bytes: fileBytes,
    sizeMb: Number((fileBytes / 1024 / 1024).toFixed(1)),
    starts: sumEvents(summaries, "client_start"),
    stops: sumEvents(summaries, "client_stop"),
    connects: sumEvents(summaries, "server_connect"),
    sessions: summaries.reduce((total, summary) => total + summary.clientSessions.length, 0),
    runtimeSeconds,
    playSegments: summaries.reduce((total, summary) => total + summary.playSegments.length, 0),
    playtimeSeconds,
    multiplayerSeconds,
    singleplayerSeconds,
    chatLines: sumEvents(summaries, "chat_message"),
    chatObservedByRuleScan: eventResult.totals.chatLines,
    chatMatched: eventResult.totals.matched,
    chatUnmatched: Math.max(0, eventResult.totals.chatLines - eventResult.totals.matched),
    chatMatchRate: ratio(eventResult.totals.matched, eventResult.totals.chatLines),
    combatSignals: sumEvents(summaries, "death_or_kill"),
    crashes: sumEvents(summaries, "crash"),
    activitySegments: activity.summary.segments,
    activityDurationSeconds: activity.summary.durationSeconds,
    activityDuration: activity.summary.duration,
    pitSegments: activity.summary.gameModes.the_pit?.segments ?? 0,
    pitDurationSeconds: activity.summary.gameModes.the_pit?.durationSeconds ?? 0,
    pitDuration: activity.summary.gameModes.the_pit?.duration ?? "0s",
    pitMaxStreak: activity.summary.gameModes.the_pit?.observedBroadcastMaxKillStreak ?? activity.summary.gameModes.the_pit?.maxStreak ?? 0,
    pitObservedBroadcastMaxKillStreak: activity.summary.gameModes.the_pit?.observedBroadcastMaxKillStreak ?? activity.summary.gameModes.the_pit?.maxStreak ?? 0,
    pitGoldEarned: activity.summary.gameModes.the_pit?.goldEarned ?? 0,
    pitXpEarned: activity.summary.gameModes.the_pit?.xpEarned ?? 0,
    pitBountyClaims: activity.summary.gameModes.the_pit?.bountyClaims ?? 0,
    pitBountyGoldEarned: activity.summary.gameModes.the_pit?.bountyGoldEarned ?? 0,
    activityGoldEarned: activity.summary.goldEarned ?? 0,
    activityXpEarned: activity.summary.xpEarned ?? 0,
    activityBountyClaims: activity.summary.bountyClaims ?? 0,
    activityBountyGoldEarned: activity.summary.bountyGoldEarned ?? 0,
    playerMaxKillStreak: Math.max(roundStats.playerMaxKillStreak ?? 0, activity.summary.playerMaxKillStreak ?? 0),
    bestWinStreak: winStreaks.breakUnknown.best.count,
    currentWinStreak: winStreaks.breakUnknown.current.count,
    winStreaks,
    ...roundStats,
  });
}

function aggregateBySource(summaries, reliableRounds, allRounds, activitySegments = []) {
  const groups = new Map();
  for (const summary of summaries) {
    const group = getGroup(groups, summary.source, () => emptyGroup(summary.source));
    addSummary(group, summary);
  }
  addRoundsToGroups(groups, reliableRounds, allRounds, (round) => round.source);
  addActivityToGroups(groups, activitySegments, (segment) => segment.source);
  return [...groups.values()].map(finalizeGroup).sort((a, b) => b.playtimeSeconds - a.playtimeSeconds);
}

function aggregateByScope(summaries, reliableRounds, allRounds, activitySegments = []) {
  const groups = new Map();
  for (const summary of summaries) {
    const key = scopeKey(summary.source, summary.scope);
    const group = getGroup(groups, key, () => emptyGroup(summary.source, summary.scope));
    addSummary(group, summary);
  }
  addRoundsToGroups(groups, reliableRounds, allRounds, (round) => scopeKey(round.source, round.scope));
  addActivityToGroups(groups, activitySegments, (segment) => scopeKey(segment.source, segment.scope));
  return [...groups.values()].map(finalizeGroup).sort((a, b) => b.playtimeSeconds - a.playtimeSeconds);
}

function aggregateByDay(summaries, reliableRounds, allRounds, events, activitySegments = []) {
  const days = new Map();

  for (const summary of summaries) {
    for (const session of summary.clientSessions) {
      addCount(days, dateKey(session.startMs), "sessions", 1);
      addDuration(days, session.startMs, session.endMs, session.durationSeconds, "runtimeSeconds");
    }
    for (const segment of summary.playSegments) {
      addCount(days, dateKey(segment.startMs), "playSegments", 1);
      addDuration(days, segment.startMs, segment.endMs, segment.durationSeconds, "playtimeSeconds");
      addDuration(days, segment.startMs, segment.endMs, segment.durationSeconds, segment.type === "singleplayer" ? "singleplayerSeconds" : "multiplayerSeconds");
    }
    if (summary.latestModifiedMs && summary.events.crash > 0) {
      addCount(days, dateKey(summary.latestModifiedMs), "crashes", summary.events.crash);
    }
  }

  const reliableSet = new Set(reliableRounds);
  for (const round of allRounds) {
    const key = dateKey(round.startMs);
    addCount(days, key, "rounds.total", 1);
    if (!reliableSet.has(round)) {
      addCount(days, key, "rounds.ignored", 1);
      continue;
    }
    addCount(days, key, "rounds.reliable", 1);
    addCount(days, key, "rounds.kills", round.kills);
    addCount(days, key, "rounds.deaths", round.deaths);
    addMaxCount(days, key, "rounds.playerMaxKillStreak", round.playerMaxKillStreak);
    addCount(days, key, "rounds.bedDestroys", round.bedDestroys);
    addCount(days, key, "rounds.selfKills", round.selfKills);
    addCount(days, key, "rounds.selfDeaths", round.selfDeaths);
    addCount(days, key, "rounds.selfBedDestroys", round.selfBedDestroys);
    addRoundResultCount(days, key, round);
    addDuration(days, round.startMs, round.endMs, round.durationSeconds, "rounds.durationSeconds");
    addReliableRoundToGameMode(days, key, round);
  }

  for (const event of events) {
    const key = dateKey(event.timestampMs);
    addCount(days, key, "matchedEvents.total", 1);
    addCount(days, key, `matchedEvents.${event.type}`, 1);
  }

  for (const segment of activitySegments) {
    const key = dateKey(segment.startMs);
    const day = getGroup(days, key, () => ({}));
    day.activity ??= emptyActivityStats();
    addActivitySegmentToStats(day.activity, segment);
  }

  return [...days.entries()]
    .map(([date, day]) => finalizeDay(date, day))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function aggregatePeriod(days, period) {
  const groups = new Map();
  for (const day of days) {
    if (day.date === "unknown") continue;
    const key = period === "week" ? weekKey(day.date) : day.date.slice(0, 7);
    const group = getGroup(groups, key, () => ({
      period: key,
      days: 0,
      sessions: 0,
      runtimeSeconds: 0,
      playSegments: 0,
      playtimeSeconds: 0,
      multiplayerSeconds: 0,
      singleplayerSeconds: 0,
      crashes: 0,
      rounds: emptyRoundStats(),
      activity: emptyActivityStats(),
      matchedEvents: { total: 0 },
    }));

    group.days += 1;
    group.sessions += day.sessions;
    group.runtimeSeconds += day.runtimeSeconds;
    group.playSegments += day.playSegments;
    group.playtimeSeconds += day.playtimeSeconds;
    group.multiplayerSeconds += day.multiplayerSeconds;
    group.singleplayerSeconds += day.singleplayerSeconds;
    group.crashes += day.crashes;
    addRoundStats(group.rounds, day.rounds);
    addActivityStats(group.activity, day.activity);
    mergeCounts(group.matchedEvents, day.matchedEvents);
  }

  return [...groups.values()]
    .map((group) =>
      withDurations({
        ...group,
        rounds: finalizeRoundStats(group.rounds),
        activity: finalizeActivityStats(group.activity),
      }),
    )
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function buildActivity(summaries, events, chatLines = []) {
  const transitionEvents = summaries.flatMap((summary) => summary.transitionEvents ?? []);
  const byFile = new Map();
  for (const event of [...events, ...transitionEvents]) {
    if (event.timestampMs === null || event.timestampMs === undefined || !event.filePath) continue;
    if (!byFile.has(event.filePath)) byFile.set(event.filePath, []);
    byFile.get(event.filePath).push(event);
  }

  const playSegments = buildMultiplayerPlaySegmentRefs(summaries);
  const playSegmentsByKey = groupPlaySegmentRefsByRoundLookupKey(playSegments);
  const serverHints = buildProxiedServerHints(playSegments, events, chatLines);
  const eventsByFile = groupByFile(events);
  const chatLinesByFile = groupByFile(chatLines);
  const segments = [...byFile.values()]
    .flatMap((fileEvents) => buildActivitySegmentsForFile(fileEvents))
    .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo)
    .map((segment) => enrichActivitySegment(annotateActivitySegmentWithServerContext(segment, {
      playSegmentsByKey,
      serverHints,
      eventsByFile,
      chatLinesByFile,
    })));

  const stats = emptyActivityStats();
  for (const segment of segments) {
    addActivitySegmentToStats(stats, segment);
  }

  return {
    summary: finalizeActivityStats(stats),
    segments,
    policy: {
      model: "Continuous modes such as The Pit are tracked as activity segments instead of win/loss rounds.",
      boundary: "Segments start from mode-specific chat signals and close on server/client/world transitions, another known mode, or a long gap.",
    },
  };
}

function buildActivitySegmentsForFile(events) {
  const ordered = [...events]
    .filter((event) => event.timestampMs !== null && event.timestampMs !== undefined)
    .sort((a, b) => a.timestampMs - b.timestampMs || activityEventSortPriority(a) - activityEventSortPriority(b) || a.lineNo - b.lineNo);

  const segments = [];
  let current = null;

  function close(endMs, reason, event = null) {
    if (!current) return;
    current.endMs = Math.max(current.startMs, endMs ?? current.lastEventMs ?? current.startMs);
    current.endAt = iso(current.endMs);
    current.endReason = reason;
    current.endLineNo = event?.lineNo ?? current.endLineNo ?? null;
    current.durationSeconds = Math.max(0, Math.round((current.endMs - current.startMs) / 1000));
    current.duration = formatDuration(current.durationSeconds);
    current.confidence = current.durationSeconds <= 10 * 3600 ? "inferred" : "low";
    segments.push(current);
    current = null;
  }

  for (const event of ordered) {
    if (current && event.timestampMs - current.lastEventMs > ACTIVITY_GAP_MS) {
      close(current.lastEventMs, "gap", event);
    }

    const mode = activityModeForEvent(event);
    if (current && isActivityBoundary(event, current.mode, mode)) {
      close(event.timestampMs, event.type, event);
    }

    if (!current && mode) {
      current = createActivitySegment(event, mode);
    }

    if (current) {
      applyActivityEvent(current, event);
    }
  }

  if (current) close(current.lastEventMs, "last_event");
  return segments;
}

function createActivitySegment(event, mode) {
  return {
    key: `${event.source}\0${event.scope}\0${event.filePath}\0${event.lineNo}\0${event.timestampMs}`,
    source: event.source,
    scope: event.scope,
    mode,
    label: labelGameMode(mode),
    localUser: event.localUser ?? null,
    localUsers: event.localUser ? { [event.localUser]: 1 } : {},
    serverPlayerIdsDirect: {},
    filePath: event.filePath,
    lineNo: event.lineNo,
    startMs: event.timestampMs,
    startAt: iso(event.timestampMs),
    endMs: null,
    endAt: null,
    lastEventMs: event.timestampMs,
    durationSeconds: 0,
    duration: "0s",
    confidence: "partial",
    startReason: `${event.ruleSet ?? "event"}:${event.ruleId ?? event.type}`,
    endReason: null,
    endLineNo: null,
    modeSignals: 0,
    kills: 0,
    deaths: 0,
    selfKills: 0,
    selfDeaths: 0,
    maxStreak: 0,
    observedBroadcastMaxKillStreak: 0,
    currentPlayerKillStreak: 0,
    playerMaxKillStreak: 0,
    streakPoints: 0,
    rewardEvents: 0,
    goldEarned: 0,
    xpEarned: 0,
    bountyClaims: 0,
    bountyGoldEarned: 0,
    megastreaks: 0,
    rules: {},
    examples: [],
  };
}

function applyActivityEvent(segment, event) {
  segment.lastEventMs = Math.max(segment.lastEventMs, event.timestampMs);
  segment.endLineNo = event.lineNo ?? segment.endLineNo;
  if (event.localUser) {
    if (!segment.localUser) segment.localUser = event.localUser;
    addPlainCount(segment.localUsers, event.localUser, 1);
  }
  noteServerPlayerIdFromEvent(segment.serverPlayerIdsDirect, event);

  const eventMode = activityModeForEvent(event);
  if (eventMode === segment.mode) {
    segment.modeSignals += 1;
    addPlainCount(segment.rules, `${event.ruleSet ?? "event"}:${event.ruleId ?? event.type}`, 1);
  }

  if (event.type === "kill") {
    segment.kills += 1;
    if (event.self?.kill) {
      segment.selfKills += 1;
      segment.currentPlayerKillStreak += 1;
      segment.playerMaxKillStreak = Math.max(segment.playerMaxKillStreak, segment.currentPlayerKillStreak);
    }
    if (event.self?.death) {
      segment.deaths += 1;
      segment.selfDeaths += 1;
      segment.currentPlayerKillStreak = 0;
    }
  } else if (event.type === "death") {
    segment.deaths += 1;
    if (event.self?.death) {
      segment.selfDeaths += 1;
      segment.currentPlayerKillStreak = 0;
    }
  } else if (event.type === "self_death") {
    segment.currentPlayerKillStreak = 0;
  }

  const streak = Number(event.payload?.streak);
  if (Number.isFinite(streak)) {
    segment.observedBroadcastMaxKillStreak = Math.max(segment.observedBroadcastMaxKillStreak, streak);
    segment.maxStreak = Math.max(segment.maxStreak, streak);
  }
  const points = Number(event.payload?.points);
  if (Number.isFinite(points)) segment.streakPoints += points;
  if (isActivityRewardEvent(segment, event)) segment.rewardEvents += 1;
  if (segment.mode === "the_pit" && isActivityEconomyEvent(event)) {
    const gold = parseActivityRewardAmount(event.payload?.gold);
    const xp = parseActivityRewardAmount(event.payload?.xp);
    if (gold !== null) segment.goldEarned += gold;
    if (xp !== null) segment.xpEarned += xp;
  }
  if (segment.mode === "the_pit" && isOwnerBountyClaimEvent(segment, event)) {
    const gold = parseActivityRewardAmount(event.payload?.gold);
    if (gold !== null) {
      segment.bountyClaims += 1;
      segment.bountyGoldEarned += gold;
      segment.goldEarned += gold;
    }
  }
  if (event.ruleId === "pit_megastreak_activated") segment.megastreaks += 1;

  if (segment.examples.length < 12 && eventMode === segment.mode) {
    segment.examples.push({
      lineNo: event.lineNo,
      timeText: event.timeText ?? null,
      type: event.type,
      rule: `${event.ruleSet ?? "event"}:${event.ruleId ?? event.type}`,
      message: event.message ?? null,
      payload: event.payload ?? {},
    });
  }
}

function isActivityRewardEvent(segment, event) {
  if (segment.mode !== "the_pit") return false;
  return ["pit_death_streak_reward", "pit_streak_points"].includes(event.ruleId) || event.type === "activity_reward";
}

function isActivityEconomyEvent(event) {
  return event.ruleId === "pit_death_streak_reward" || event.type === "activity_reward";
}

function isOwnerBountyClaimEvent(segment, event) {
  if (event.type !== "activity_diagnostic") return false;
  if (event.payload?.diagnosticKind !== "bounty_claimed") return false;
  if (!event.payload?.killer) return false;
  if (event.self?.kill) return true;
  const identity = resolveServerPlayerIdentity({
    ...segment,
    ownerAliasesUsed: segment.serverPlayerIdsDirect ?? {},
  });
  if (identity.serverPlayerIdConfidence === "none" || !identity.serverPlayerId) return false;
  return sameNormalizedPlayer(event.payload.killer, identity.serverPlayerId);
}

function parseActivityRewardAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function activityModeForEvent(event) {
  if (event.type === "ignore") return null;
  const mode = event.gameMode ?? event.payload?.gameMode ?? unknownGameMode;
  return ACTIVITY_MODE_IDS.has(mode) ? mode : null;
}

function isActivityBoundary(event, currentMode, eventMode) {
  if (["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash", "world_switch", "lobby_signal"].includes(event.type)) {
    return true;
  }
  if (event.type === "game_mode" && eventMode && eventMode !== currentMode) return true;
  return false;
}

function activityEventSortPriority(event) {
  if (["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash", "world_switch", "lobby_signal"].includes(event.type)) return 2;
  return 1;
}

function buildActivityStatRounds(activitySegments = []) {
  return activitySegments.map((segment) => ({
    key: `activity:${segment.key}`,
    source: segment.source,
    scope: segment.scope,
    localUser: segment.localUser ?? null,
    localUsers: segment.localUsers ?? {},
    launcherUser: segment.launcherUser ?? segment.localUser ?? null,
    launcherUsers: segment.launcherUsers ?? segment.localUsers ?? {},
    serverPlayerId: segment.serverPlayerId ?? null,
    serverPlayerIds: segment.serverPlayerIds ?? {},
    serverPlayerIdSource: segment.serverPlayerIdSource ?? "none",
    serverPlayerIdConfidence: segment.serverPlayerIdConfidence ?? "none",
    serverIdentityContext: segment.serverIdentityContext ?? null,
    serverPlayerIdPolicy: segment.serverPlayerIdPolicy ?? null,
    serverNetwork: segment.serverNetwork ?? null,
    serverAddress: segment.serverAddress ?? null,
    serverLabel: segment.serverLabel ?? "未知服务器",
    serverConfidence: segment.serverConfidence ?? "unknown",
    serverEvidence: segment.serverEvidence ?? { source: "unknown" },
    ownerAliasesUsed: segment.serverPlayerIds ?? {},
    propagatedServerPlayerIds: {},
    identityPropagation: null,
    filePath: segment.filePath,
    lineNo: segment.lineNo,
    startMs: segment.startMs,
    endMs: segment.endMs,
    lastEventMs: segment.lastEventMs ?? segment.endMs,
    durationSeconds: segment.durationSeconds ?? 0,
    confidence: segment.confidence ?? "inferred",
    ignoredReason: null,
    parserConfidence: segment.confidence ?? "inferred",
    result: "not_applicable",
    resultReason: "activity:not_applicable",
    resultEligible: false,
    roundKind: "activity",
    activityKey: segment.key,
    activityMode: segment.mode,
    playerMaxKillStreak: segment.playerMaxKillStreak ?? 0,
    observedBroadcastMaxKillStreak: segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0,
    rewardEvents: segment.rewardEvents ?? 0,
    goldEarned: segment.goldEarned ?? 0,
    xpEarned: segment.xpEarned ?? 0,
    bountyClaims: segment.bountyClaims ?? 0,
    bountyGoldEarned: segment.bountyGoldEarned ?? 0,
    streakPoints: segment.streakPoints ?? 0,
    resultHint: null,
    unknownAudit: null,
    gameMode: segment.mode ?? unknownGameMode,
    startReason: segment.startReason ?? "activity",
    endReason: segment.endReason ?? "activity",
    kills: segment.kills ?? 0,
    deaths: segment.deaths ?? 0,
    bedDestroys: 0,
    selfKills: segment.selfKills ?? 0,
    selfDeaths: segment.selfDeaths ?? 0,
    selfDeathSignals: 0,
    selfBedDestroys: 0,
    joins: 0,
    leaves: 0,
    roundStarts: 0,
    roundEnds: 0,
    boundaryEvents: [],
    killers: {},
    victims: {},
    bedDestroyers: {},
    punishedPlayers: {},
    teamEliminations: {},
    bedDestroyedTeams: {},
    resultEvidence: [{
      kind: "activity_not_result_eligible",
      result: "not_applicable",
      confidence: "high",
      timestampMs: segment.startMs ?? null,
      lineNo: segment.lineNo ?? null,
      ruleSet: "report",
      ruleId: "activity_stat_round",
      activityMode: segment.mode ?? null,
    }],
    ownerBedDestroyed: false,
    ownerTeamEliminated: false,
    ownFinalDeaths: 0,
    punishedExit: null,
    ownerTeam: null,
  }));
}

function buildConfidence(rounds) {
  const summary = { high: 0, medium: 0, low: 0 };
  const byEndReason = {};
  const ignoredReasons = {};
  const examples = { high: [], medium: [], low: [] };

  for (const round of rounds) {
    const level = confidenceLevel(round);
    summary[level] += 1;
    byEndReason[round.endReason ?? "unknown"] = (byEndReason[round.endReason ?? "unknown"] ?? 0) + 1;
    const ignoredReason = getIgnoredRoundReason(round);
    if (ignoredReason) ignoredReasons[ignoredReason] = (ignoredReasons[ignoredReason] ?? 0) + 1;
    if (examples[level].length < 10) examples[level].push(summarizeRound(round));
  }

  return {
    summary,
    byEndReason: sortCountObject(byEndReason),
    ignoredReasons: sortCountObject(ignoredReasons),
    policy: {
      high: "Clear next-round boundary and reasonable duration.",
      medium: "Reasonable duration, but the end was inferred from last event or a gap.",
      low: "Too short, too long, or missing key boundaries; excluded from main totals.",
    },
    examples,
  };
}

function buildResults(events, reliableRounds) {
  const resultEvents = events.filter((event) => ["win", "loss", "round_end"].includes(event.type));
  const byRuleId = {};
  const byGameMode = {};
  const examples = [];
  const signals = {
    total: resultEvents.length,
    wins: 0,
    losses: 0,
    roundEnds: 0,
  };

  for (const event of resultEvents) {
    if (event.type === "win") signals.wins += 1;
    if (event.type === "loss") signals.losses += 1;
    if (event.type === "round_end") signals.roundEnds += 1;
    const ruleKey = `${event.ruleSet}:${event.ruleId}`;
    byRuleId[ruleKey] = (byRuleId[ruleKey] ?? 0) + 1;
    const mode = event.gameMode ?? unknownGameMode;
    byGameMode[mode] ??= { mode, label: labelGameMode(mode), total: 0, wins: 0, losses: 0, roundEnds: 0 };
    byGameMode[mode].total += 1;
    if (event.type === "win") byGameMode[mode].wins += 1;
    if (event.type === "loss") byGameMode[mode].losses += 1;
    if (event.type === "round_end") byGameMode[mode].roundEnds += 1;
    if (examples.length < 50) {
      examples.push({
        type: event.type,
        rule: ruleKey,
        gameMode: mode,
        message: event.message,
        source: event.source,
        scope: event.scope,
        filePath: event.filePath,
        lineNo: event.lineNo,
        localUser: event.localUser,
      });
    }
  }

  const roundStats = aggregateRoundStats(reliableRounds, reliableRounds);
  const knownRoundResults = roundStats.wins + roundStats.losses + roundStats.ambiguousResults;
  const resultEligibleRounds = reliableRounds.filter(isResultEligibleRound);
  const unknownHints = buildUnknownResultHints(resultEligibleRounds);
  const unknownAudit = buildUnknownAuditSummary(resultEligibleRounds.map(enrichUnknownAuditRound));

  return {
    summary: {
      reliableRounds: reliableRounds.length,
      resultEligibleRounds: roundStats.resultEligibleRounds,
      nonResultRounds: roundStats.nonResultRounds,
      knownRoundResults,
      unknownRoundResults: roundStats.unknownResults,
      wins: roundStats.wins,
      losses: roundStats.losses,
      ambiguousResults: roundStats.ambiguousResults,
      notApplicableResults: roundStats.notApplicableResults,
      winRate: roundStats.winRate,
      knownResultRate: ratio(knownRoundResults, roundStats.resultEligibleRounds),
      resultSignals: signals.total,
    },
    policy: {
      roundResults: "Dashboard win/loss uses result-eligible reliable rounds only. Continuous activity segments such as The Pit can contribute play/combat stats with result=not_applicable and do not affect win/loss/unknown coverage.",
      signalResults: "Signals include all matched win/loss/round_end chat events, even when they do not attach to a reliable round.",
    },
    signals: {
      ...signals,
      byRuleId: sortCountObject(byRuleId),
      byGameMode: Object.fromEntries(Object.entries(byGameMode).sort((a, b) => b[1].total - a[1].total)),
      examples,
    },
    unknownHints,
    unknownAudit,
    reliableRounds: roundStats,
  };
}

function enrichUnknownAuditRound(round) {
  if (normalizeResult(round.result) !== "unknown") return round;
  const resultHint = round.resultHint ?? guessUnknownResultHint(round);
  return {
    ...round,
    resultHint,
    unknownAudit: round.unknownAudit ?? buildUnknownAudit({ ...round, resultHint }),
  };
}

function buildUnknownResultHints(reliableRounds) {
  const rows = reliableRounds
    .filter((round) => normalizeResult(round.result) === "unknown")
    .map((round) => ({
      hint: guessUnknownResultHint(round),
      round,
    }))
    .sort((a, b) => hintPriority(b.hint) - hintPriority(a.hint) || a.round.startMs - b.round.startMs || a.round.lineNo - b.round.lineNo);

  return {
    total: rows.length,
    byHint: countBy(rows, (row) => row.hint.value),
    byReason: countBy(rows, (row) => row.hint.reason ?? "unknown"),
    byConfidence: countBy(rows, (row) => row.hint.confidence),
    byMode: countBy(rows, (row) => row.round.gameMode ?? unknownGameMode),
    byEndReason: countBy(rows, (row) => row.round.endReason ?? "unknown"),
    policy: "Hints are diagnostic only. They do not change round.result or win/loss totals.",
    examples: rows
      .filter((row) => row.hint.value !== "keep_unknown")
      .slice(0, 50)
      .map((row) => ({
        hint: row.hint,
        round: summarizeRound(row.round),
      })),
  };
}

function guessUnknownResultHint(round) {
  if (round.gameMode === "bedwars" && round.ownerTeam && hasObjectValues(round.teamEliminations) && !round.teamEliminations?.[round.ownerTeam]) {
    return {
      value: "probably_win",
      confidence: "low",
      reason: "owner team known and other teams were eliminated",
    };
  }
  if (round.gameMode === "bedwars" && round.selfDeaths > 0 && ["client_stop", "server_connect", "world_switch", "client_start", "crash"].includes(round.endReason)) {
    return {
      value: "probably_loss",
      confidence: "low",
      reason: "self death followed by leaving boundary",
    };
  }
  if (round.gameMode === "mega_walls" && round.selfDeaths > 0 && ["client_stop", "server_connect", "world_switch", "last_event"].includes(round.endReason)) {
    return {
      value: "probably_loss",
      confidence: "low",
      reason: "Mega Walls self death followed by leaving boundary",
    };
  }
  if (isLowEvidenceBedwarsPseudoRoundCandidate(round)) {
    return {
      value: "keep_unknown",
      confidence: "none",
      reason: "low_evidence_bedwars_pseudo_round_candidate",
    };
  }
  const nonBedwarsReason = nonBedwarsUnknownDiagnosticReason(round);
  if (nonBedwarsReason) {
    return {
      value: "keep_unknown",
      confidence: "none",
      reason: nonBedwarsReason,
    };
  }
  return {
    value: "keep_unknown",
    confidence: "none",
    reason: "no safe result evidence",
  };
}

function nonBedwarsUnknownDiagnosticReason(round) {
  if (!round || round.result !== "unknown" || round.gameMode === "bedwars") return null;
  if (isSkyWarsShortLobbyFragmentCandidate(round)) return "skywars_short_lobby_fragment_candidate";
  if (isSoloModeLastEventNoResult(round)) return "solo_mode_last_event_no_result";
  if (isMegaWallsLastEventNoResult(round)) return "mega_walls_last_event_no_result";
  if (isUnknownModeCombatFragment(round)) return "unknown_mode_combat_fragment";
  return null;
}

function isSkyWarsShortLobbyFragmentCandidate(round) {
  if (round.gameMode !== "skywars") return false;
  if ((round.durationSeconds ?? 0) >= 120) return false;
  if (!["lobby_signal", "server_connect", "client_stop"].includes(round.endReason)) return false;
  if (hasSelfAction(round)) return false;
  return !hasStrongResultEvidence(round);
}

function isSoloModeLastEventNoResult(round) {
  if (!isSoloDiagnosticMode(round.gameMode)) return false;
  if (round.endReason !== "last_event") return false;
  if (!hasCombatSignal(round)) return false;
  return !hasStrongResultEvidence(round);
}

function isMegaWallsLastEventNoResult(round) {
  if (round.gameMode !== "mega_walls") return false;
  if (round.endReason !== "last_event") return false;
  if (!hasCombatSignal(round) && !round.ownerTeam) return false;
  return !hasStrongResultEvidence(round);
}

function isUnknownModeCombatFragment(round) {
  if ((round.gameMode ?? unknownGameMode) !== unknownGameMode) return false;
  if (!hasCombatSignal(round)) return false;
  return !hasStrongResultEvidence(round);
}

function isSoloDiagnosticMode(gameMode) {
  return ["skywars", "blitz_sg", "speed_uhc", "the_walls", "tnt_run", "dropper", "duels"].includes(gameMode);
}

function hasSelfAction(round) {
  return Boolean(round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys);
}

function hasCombatSignal(round) {
  return Boolean(round.kills || round.deaths || round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys);
}

function hasStrongResultEvidence(round) {
  return (round.resultEvidence ?? []).some((item) =>
    item.result !== "unknown" &&
    item.confidence !== "low" &&
    item.confidence !== "ignored"
  );
}

function isLowEvidenceBedwarsPseudoRoundCandidate(round) {
  if (round.gameMode !== "bedwars") return false;
  if (round.result !== "unknown") return false;
  if (round.ownerTeam) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.teamEliminations) || hasObjectValues(round.bedDestroyedTeams) || hasObjectValues(round.punishedPlayers)) return false;
  if ((round.bedDestroys ?? 0) > 0) return false;
  return ["next_round", "server_connect", "client_stop", "lobby_signal", "world_switch", "crash", "last_event"].includes(round.endReason);
}

function hintPriority(hint) {
  const priorities = {
    probably_loss: 40,
    probably_win: 30,
    keep_unknown: 0,
  };
  return priorities[hint.value] ?? 0;
}

function buildAnomalies(summaries, rounds, unmatchedTemplates) {
  const ignoredRounds = rounds
    .filter((round) => !isReliableRound(round))
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .slice(0, 100)
    .map(summarizeRound);

  const longClientSessions = summaries
    .flatMap((summary) =>
      summary.clientSessions
        .filter((session) => session.durationSeconds >= LONG_SESSION_SECONDS)
        .map((session) => ({
          source: summary.source,
          scope: summary.scope,
          startAt: iso(session.startMs),
          durationSeconds: session.durationSeconds,
          duration: formatDuration(session.durationSeconds),
          confidence: session.confidence,
          endReason: session.endReason,
          startFile: session.startFile,
        })),
    )
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .slice(0, 50);

  const crashyScopes = summaries
    .filter((summary) => summary.events.crash > 0)
    .map((summary) => ({
      source: summary.source,
      scope: summary.scope,
      crashes: summary.events.crash,
      sessions: summary.clientSessions.length,
      crashPerSession: ratio(summary.events.crash, summary.clientSessions.length),
    }))
    .sort((a, b) => b.crashes - a.crashes);

  return {
    ignoredRounds,
    longClientSessions,
    crashyScopes,
    unmatchedTemplates: unmatchedTemplates.map((template) => ({
      ...template,
      category: classifyUnmatchedTemplate(template.template, template.examples ?? []),
    })),
  };
}

function buildProfile({ generatedAt, summaries, reliableRounds, byDay, byScope, accounts, overview, activity = emptyActivitySection() }) {
  const clientSessions = summaries.flatMap((summary) => summary.clientSessions.map((session) => summarizeSession(summary, session)));
  const playSegments = summaries.flatMap((summary) => summary.playSegments.map((segment) => summarizeSession(summary, segment)));
  const reliableMatches = reliableRounds;
  const playTimeline = playSegments.length ? playSegments : clientSessions;
  const firstPlayed = minBy(playTimeline, (row) => row.startMs);
  const lastPlayed = maxBy(playTimeline, (row) => row.endMs ?? row.startMs);
  const activeDays = byDay.filter((day) => day.date !== "unknown" && day.playtimeSeconds > 0);
  const multiplayerDays = activeDays.filter((day) => day.multiplayerSeconds > 0);
  const singleplayerDays = activeDays.filter((day) => day.singleplayerSeconds > 0);
  const roundDays = byDay.filter((day) => (day.rounds?.reliable ?? 0) > 0);
  const modeStats = Object.values(aggregateRoundStats(reliableRounds, reliableRounds).gameModes ?? {});
  const activityModeStats = Object.values(activity.summary.gameModes ?? {});
  const identities = buildIdentityProfile(accounts);
  const knownResults = overview.wins + overview.losses + overview.ambiguousResults;
  const winStreaks = overview.winStreaks ?? buildWinStreakSummary(reliableRounds);
  const playerMaxKillStreak = Math.max(overview.playerMaxKillStreak ?? 0, activity.summary.playerMaxKillStreak ?? 0);

  return {
    generatedAt,
    metricDefinitions: buildMetricDefinitions([
      "bestWinStreak",
      "currentWinStreak",
      "winStreaks",
      "playerMaxKillStreak",
      "observedBroadcastMaxKillStreak",
      "maxStreak",
      "bedDestroys",
      "selfBedDestroys",
      "playerBedDestroys",
      "unknownResults",
      "ambiguousResults",
      "notApplicableResults",
      "rewardEvents",
      "goldEarned",
      "xpEarned",
      "bountyClaims",
      "bountyGoldEarned",
      "streakPoints",
    ]),
    totals: {
      firstPlayedAt: firstPlayed?.startAt ?? null,
      firstPlayedDay: firstPlayed ? dateKey(firstPlayed.startMs) : null,
      lastPlayedAt: lastPlayed?.endAt ?? lastPlayed?.startAt ?? null,
      lastPlayedDay: lastPlayed ? dateKey(lastPlayed.endMs ?? lastPlayed.startMs) : null,
      localUserCount: identities.count,
      clientStarts: overview.starts,
      serverConnects: overview.connects,
      clientSessions: overview.sessions,
      playSegments: overview.playSegments,
      crashes: overview.crashes,
      activitySegments: activity.summary.segments,
      activityDurationSeconds: activity.summary.durationSeconds,
      activityDuration: activity.summary.duration,
      pitSegments: activity.summary.gameModes.the_pit?.segments ?? 0,
      pitDurationSeconds: activity.summary.gameModes.the_pit?.durationSeconds ?? 0,
      pitDuration: activity.summary.gameModes.the_pit?.duration ?? "0s",
      pitMaxStreak: activity.summary.gameModes.the_pit?.observedBroadcastMaxKillStreak ?? activity.summary.gameModes.the_pit?.maxStreak ?? 0,
      pitObservedBroadcastMaxKillStreak: activity.summary.gameModes.the_pit?.observedBroadcastMaxKillStreak ?? activity.summary.gameModes.the_pit?.maxStreak ?? 0,
      pitGoldEarned: activity.summary.gameModes.the_pit?.goldEarned ?? 0,
      pitXpEarned: activity.summary.gameModes.the_pit?.xpEarned ?? 0,
      pitBountyClaims: activity.summary.gameModes.the_pit?.bountyClaims ?? 0,
      pitBountyGoldEarned: activity.summary.gameModes.the_pit?.bountyGoldEarned ?? 0,
      activityGoldEarned: activity.summary.goldEarned ?? 0,
      activityXpEarned: activity.summary.xpEarned ?? 0,
      activityBountyClaims: activity.summary.bountyClaims ?? 0,
      activityBountyGoldEarned: activity.summary.bountyGoldEarned ?? 0,
      playerMaxKillStreak,
      bestWinStreak: winStreaks.breakUnknown.best.count,
      currentWinStreak: winStreaks.breakUnknown.current.count,
      reliableRounds: overview.reliableRounds,
      bedDestroys: overview.bedDestroys,
      selfBedDestroys: overview.selfBedDestroys,
      playerBedDestroys: overview.playerBedDestroys ?? overview.selfBedDestroys ?? 0,
      wins: overview.wins,
      losses: overview.losses,
      unknownResults: overview.unknownResults,
      ambiguousResults: overview.ambiguousResults,
      knownResults,
      winRate: overview.winRate,
      knownResultRate: overview.knownResultRate,
    },
    streaks: {
      win: winStreaks,
      playerMaxKillStreak: {
        count: playerMaxKillStreak,
      },
    },
    days: {
      longestPlaytime: summarizeDay(maxBy(activeDays, (day) => day.playtimeSeconds)),
      longestMultiplayerPlaytime: summarizeDay(maxBy(multiplayerDays, (day) => day.multiplayerSeconds)),
      longestSingleplayerPlaytime: summarizeDay(maxBy(singleplayerDays, (day) => day.singleplayerSeconds)),
      mostRounds: summarizeDay(maxBy(roundDays, (day) => day.rounds?.reliable ?? 0)),
      latestPlayed: summarizeDay(maxBy(activeDays, (day) => day.date)),
      latestLocalEnd: summarizeLocalEnd(maxBy(playTimeline, (row) => lateNightScore(row.endMs ?? row.startMs))),
      longestStreak: longestPlayStreak(activeDays),
    },
    preferences: {
      gameModeByRounds: summarizeMode(maxBy(modeStats, (mode) => mode.rounds)),
      gameModeByDuration: summarizeMode(maxBy(modeStats, (mode) => mode.durationSeconds)),
      activityModeByDuration: summarizeActivityMode(maxBy(activityModeStats, (mode) => mode.durationSeconds)),
      clientVersionByPlaytime: summarizeScope(maxBy(byScope, (scope) => scope.playtimeSeconds)),
      clientVersionByRounds: summarizeScope(maxBy(byScope, (scope) => scope.rounds?.reliable ?? 0)),
    },
    extremes: {
      longestSession: summarizeSessionExtreme(maxBy(clientSessions, (session) => session.durationSeconds)),
      shortestSession: summarizeSessionExtreme(minBy(clientSessions.filter((session) => session.durationSeconds > 0), (session) => session.durationSeconds)),
      longestPlaySegment: summarizeSessionExtreme(maxBy(playSegments, (segment) => segment.durationSeconds)),
      shortestPlaySegment: summarizeSessionExtreme(minBy(playSegments.filter((segment) => segment.durationSeconds > 0), (segment) => segment.durationSeconds)),
      longestMatch: summarizeRound(maxBy(reliableMatches, (round) => round.durationSeconds)),
      shortestMatch: summarizeRound(minBy(reliableMatches.filter((round) => round.durationSeconds > 0), (round) => round.durationSeconds)),
    },
    identities,
  };
}

function summarizeSession(summary, row) {
  return {
    source: summary.source,
    scope: summary.scope,
    localUser: row.localUser ?? "unknown",
    type: row.type ?? "client",
    startMs: row.startMs,
    endMs: row.endMs,
    startAt: iso(row.startMs),
    endAt: iso(row.endMs),
    durationSeconds: row.durationSeconds ?? 0,
    duration: formatDuration(row.durationSeconds ?? 0),
    endReason: row.endReason ?? null,
    confidence: row.confidence ?? null,
    startFile: row.startFile ?? null,
  };
}

function summarizeSessionExtreme(row) {
  if (!row) return null;
  return {
    source: row.source,
    scope: row.scope,
    localUser: row.localUser,
    type: row.type,
    startAt: row.startAt,
    endAt: row.endAt,
    durationSeconds: row.durationSeconds,
    duration: row.duration,
    endReason: row.endReason,
    confidence: row.confidence,
    startFile: row.startFile,
  };
}

function summarizeDay(day) {
  if (!day) return null;
  return {
    date: day.date,
    sessions: day.sessions,
    playSegments: day.playSegments,
    playtimeSeconds: day.playtimeSeconds,
    playtime: day.playtime,
    multiplayerSeconds: day.multiplayerSeconds,
    multiplayer: day.multiplayer,
    singleplayerSeconds: day.singleplayerSeconds,
    singleplayer: day.singleplayer,
    reliableRounds: day.rounds?.reliable ?? 0,
    wins: day.rounds?.wins ?? 0,
    losses: day.rounds?.losses ?? 0,
    unknownResults: day.rounds?.unknownResults ?? 0,
    kills: day.rounds?.kills ?? 0,
    deaths: day.rounds?.deaths ?? 0,
    selfKills: day.rounds?.selfKills ?? 0,
    selfDeaths: day.rounds?.selfDeaths ?? 0,
    selfBedDestroys: day.rounds?.selfBedDestroys ?? 0,
    playerBedDestroys: day.rounds?.playerBedDestroys ?? day.rounds?.selfBedDestroys ?? 0,
    activitySegments: day.activity?.segments ?? 0,
    activityDurationSeconds: day.activity?.durationSeconds ?? 0,
    activityDuration: day.activity?.duration ?? "0s",
    pitSegments: day.activity?.gameModes?.the_pit?.segments ?? 0,
    pitDurationSeconds: day.activity?.gameModes?.the_pit?.durationSeconds ?? 0,
    pitDuration: day.activity?.gameModes?.the_pit?.duration ?? "0s",
    pitMaxStreak: day.activity?.gameModes?.the_pit?.observedBroadcastMaxKillStreak ?? day.activity?.gameModes?.the_pit?.maxStreak ?? 0,
    pitObservedBroadcastMaxKillStreak: day.activity?.gameModes?.the_pit?.observedBroadcastMaxKillStreak ?? day.activity?.gameModes?.the_pit?.maxStreak ?? 0,
    playerMaxKillStreak: Math.max(day.rounds?.playerMaxKillStreak ?? 0, day.activity?.playerMaxKillStreak ?? 0),
    crashes: day.crashes ?? 0,
  };
}

function summarizeMode(mode) {
  if (!mode) return null;
  return {
    id: mode.id,
    label: mode.label,
    rounds: mode.rounds,
    durationSeconds: mode.durationSeconds,
    duration: mode.duration,
    wins: mode.wins,
    losses: mode.losses,
    unknownResults: mode.unknownResults,
    winRate: mode.winRate,
    kills: mode.kills,
    deaths: mode.deaths,
    playerMaxKillStreak: mode.playerMaxKillStreak ?? 0,
    selfKills: mode.selfKills,
    selfDeaths: mode.selfDeaths,
  };
}

function summarizeActivityMode(mode) {
  if (!mode) return null;
  return {
    id: mode.id,
    label: mode.label,
    segments: mode.segments,
    durationSeconds: mode.durationSeconds,
    duration: mode.duration,
    kills: mode.kills,
    deaths: mode.deaths,
    selfKills: mode.selfKills,
    selfDeaths: mode.selfDeaths,
    maxStreak: mode.maxStreak,
    observedBroadcastMaxKillStreak: mode.observedBroadcastMaxKillStreak ?? mode.maxStreak ?? 0,
    playerMaxKillStreak: mode.playerMaxKillStreak ?? 0,
    streakPoints: mode.streakPoints,
    rewardEvents: mode.rewardEvents,
    goldEarned: mode.goldEarned ?? 0,
    xpEarned: mode.xpEarned ?? 0,
    bountyClaims: mode.bountyClaims ?? 0,
    bountyGoldEarned: mode.bountyGoldEarned ?? 0,
    megastreaks: mode.megastreaks,
    modeSignals: mode.modeSignals,
  };
}

function summarizeScope(scope) {
  if (!scope) return null;
  return {
    source: scope.source,
    scope: scope.scope,
    playtimeSeconds: scope.playtimeSeconds,
    playtime: scope.playtime,
    sessions: scope.sessions,
    serverConnects: scope.connects,
    clientStarts: scope.starts,
    crashes: scope.crashes,
    reliableRounds: scope.rounds?.reliable ?? 0,
    wins: scope.rounds?.wins ?? 0,
    losses: scope.rounds?.losses ?? 0,
    unknownResults: scope.rounds?.unknownResults ?? 0,
    activitySegments: scope.activity?.segments ?? 0,
    pitDurationSeconds: scope.activity?.gameModes?.the_pit?.durationSeconds ?? 0,
    pitDuration: scope.activity?.gameModes?.the_pit?.duration ?? "0s",
  };
}

function summarizeLocalEnd(row) {
  if (!row) return null;
  const endMs = row.endMs ?? row.startMs;
  return {
    date: dateKey(endMs),
    nightOfDate: nightOfDate(endMs),
    localTime: localTimeText(endMs),
    startAt: row.startAt,
    endAt: row.endAt,
    durationSeconds: row.durationSeconds,
    duration: row.duration,
    source: row.source,
    scope: row.scope,
    localUser: row.localUser,
    type: row.type,
  };
}

function longestPlayStreak(activeDays) {
  const days = [...activeDays].sort((a, b) => a.date.localeCompare(b.date));
  let best = null;
  let current = null;

  for (const day of days) {
    if (!current || nextDateText(current.endDate) !== day.date) {
      current = {
        startDate: day.date,
        endDate: day.date,
        days: 1,
        playtimeSeconds: day.playtimeSeconds,
        reliableRounds: day.rounds?.reliable ?? 0,
      };
    } else {
      current.endDate = day.date;
      current.days += 1;
      current.playtimeSeconds += day.playtimeSeconds;
      current.reliableRounds += day.rounds?.reliable ?? 0;
    }
    if (!best || current.days > best.days || (current.days === best.days && current.playtimeSeconds > best.playtimeSeconds)) {
      best = { ...current };
    }
  }

  return best ? { ...best, playtime: formatDuration(best.playtimeSeconds) } : null;
}

function buildIdentityProfile(accounts) {
  const playtimeByUser = new Map((accounts.playtimeByUser ?? []).map((row) => [row.user, row]));
  const eventByUser = new Map((accounts.localUsers ?? []).map((row) => [row.user, row]));
  const users = [...new Set([...playtimeByUser.keys(), ...eventByUser.keys()])].sort();
  const allItems = users.map((user) => {
    const playtime = playtimeByUser.get(user) ?? {};
    const eventStats = eventByUser.get(user) ?? {};
    const rounds = eventStats.rounds ?? {};
    return {
      user,
      sessions: playtime.sessions ?? 0,
      playSegments: playtime.playSegments ?? 0,
      playtimeSeconds: playtime.playtimeSeconds ?? 0,
      playtime: formatDuration(playtime.playtimeSeconds ?? 0),
      multiplayerSeconds: playtime.multiplayerSeconds ?? 0,
      multiplayer: formatDuration(playtime.multiplayerSeconds ?? 0),
      singleplayerSeconds: playtime.singleplayerSeconds ?? 0,
      singleplayer: formatDuration(playtime.singleplayerSeconds ?? 0),
      firstSeenAt: playtime.firstSeenAt ?? null,
      lastSeenAt: playtime.lastSeenAt ?? null,
      scopes: playtime.scopes ?? [],
      scopeCount: playtime.scopeCount ?? 0,
      eventStats: {
        events: eventStats.events ?? 0,
        selfKills: eventStats.selfKills ?? 0,
        selfDeaths: eventStats.selfDeaths ?? 0,
        selfBedDestroys: eventStats.selfBedDestroys ?? 0,
        playerBedDestroys: eventStats.selfBedDestroys ?? 0,
      },
      rounds: {
        total: rounds.total ?? 0,
        reliable: rounds.reliable ?? 0,
        durationSeconds: rounds.durationSeconds ?? 0,
        duration: formatDuration(rounds.durationSeconds ?? 0),
        kills: rounds.kills ?? 0,
        deaths: rounds.deaths ?? 0,
        bedDestroys: rounds.bedDestroys ?? 0,
        selfBedDestroys: rounds.selfBedDestroys ?? 0,
        playerBedDestroys: rounds.playerBedDestroys ?? rounds.selfBedDestroys ?? 0,
        wins: rounds.wins ?? 0,
        losses: rounds.losses ?? 0,
        unknownResults: rounds.unknownResults ?? 0,
      },
    };
  }).sort((a, b) => b.playtimeSeconds - a.playtimeSeconds || b.rounds.reliable - a.rounds.reliable || a.user.localeCompare(b.user));

  const unknown = allItems.find((item) => item.user === "unknown") ?? null;
  const items = allItems.filter((item) => item.user !== "unknown");

  return {
    count: items.length,
    mostPlayed: items[0] ?? null,
    mostRounds: maxBy(items, (item) => item.rounds.reliable) ?? null,
    mostKills: maxBy(items, (item) => item.rounds.kills) ?? null,
    mostDeaths: maxBy(items, (item) => item.rounds.deaths) ?? null,
    mostWins: maxBy(items, (item) => item.rounds.wins) ?? null,
    topByPlaytime: items.slice(0, 10),
    topByRounds: topIdentities(items, (item) => item.rounds.reliable),
    topByKills: topIdentities(items, (item) => item.rounds.kills),
    topByDeaths: topIdentities(items, (item) => item.rounds.deaths),
    topByWins: topIdentities(items, (item) => item.rounds.wins),
    unknown,
    items,
  };
}

function topIdentities(items, scoreFn, limit = 10) {
  return [...items]
    .filter((item) => scoreFn(item) > 0)
    .sort((a, b) => scoreFn(b) - scoreFn(a) || b.playtimeSeconds - a.playtimeSeconds || a.user.localeCompare(b.user))
    .slice(0, limit);
}

function buildAccounts(events, reliableRounds, summaries, ownerConfig = {}) {
  const users = new Map();

  for (const event of events) {
    if (!event.localUser) continue;
    const user = getGroup(users, event.localUser, () => ({
      user: event.localUser,
      files: new Set(),
      scopes: new Set(),
      events: 0,
      selfKills: 0,
      selfDeaths: 0,
      selfBedDestroys: 0,
    }));
    user.files.add(event.filePath);
    user.scopes.add(scopeKey(event.source, event.scope));
    user.events += 1;
    if (event.self?.kill) user.selfKills += 1;
    if (event.self?.death) user.selfDeaths += 1;
    if (event.self?.bedDestroy) user.selfBedDestroys += 1;
  }

  const userRecords = [...users.values()];
  const localUsers = userRecords
    .map((user) => ({
      user: user.user,
      files: user.files.size,
      scopes: user.scopes.size,
      events: user.events,
      selfKills: user.selfKills,
      selfDeaths: user.selfDeaths,
      selfBedDestroys: user.selfBedDestroys,
    }))
    .sort((a, b) => b.events - a.events);

  const byUser = Object.fromEntries(localUsers.map((user) => [user.user, { ...user, rounds: emptyRoundStats() }]));
  for (const round of reliableRounds) {
    const candidates = Object.keys(byUser).filter((user) => {
      return round.killers[user] || round.victims[user] || round.bedDestroyers[user];
    });
    for (const user of candidates) {
      const stats = byUser[user].rounds;
      stats.total += 1;
      stats.reliable += 1;
      stats.durationSeconds += round.durationSeconds;
      stats.kills += round.killers[user] ?? 0;
      stats.deaths += round.victims[user] ?? 0;
      stats.bedDestroys += round.bedDestroyers[user] ?? 0;
      stats.selfKills += round.killers[user] ?? 0;
      stats.selfDeaths += round.victims[user] ?? 0;
      stats.selfBedDestroys += round.bedDestroyers[user] ?? 0;
      noteRoundResultStats(stats, round);
      addRoundToGameMode(stats, round);
    }
  }

  return {
    owner: buildOwnerAccount(userRecords, reliableRounds, ownerConfig),
    localUsers: localUsers.map((user) => ({
      ...user,
      rounds: finalizeRoundStats(byUser[user.user]?.rounds ?? emptyRoundStats()),
    })),
    aliases: normalizeOwnerAliases(ownerConfig.aliases),
    aliasCandidates: [],
    aliasPolicy: "All local users from Setting user lines and explicit owner.aliases config entries are treated as the same owner. No similarity-based alias detection is applied.",
    playtimeByUser: buildAccountPlaytime(summaries),
  };
}

function buildAccountPlaytime(summaries) {
  const users = new Map();
  for (const summary of summaries) {
    for (const session of summary.clientSessions) {
      const user = session.localUser ?? "unknown";
      const row = getAccountPlaytimeRow(users, user);
      row.sessions += 1;
      row.sources.add(summary.source);
      row.scopes.add(scopeKey(summary.source, summary.scope));
      row.files.add(session.startFile);
      row.runtimeSeconds += session.durationSeconds ?? 0;
      touchSeen(row, session.startMs, session.endMs);
    }
    for (const segment of summary.playSegments) {
      const user = segment.localUser ?? "unknown";
      const row = getAccountPlaytimeRow(users, user);
      row.playSegments += 1;
      row.sources.add(summary.source);
      row.scopes.add(scopeKey(summary.source, summary.scope));
      row.files.add(segment.startFile);
      row.playtimeSeconds += segment.durationSeconds ?? 0;
      if (segment.type === "singleplayer") {
        row.singleplayerSeconds += segment.durationSeconds ?? 0;
      } else {
        row.multiplayerSeconds += segment.durationSeconds ?? 0;
      }
      touchSeen(row, segment.startMs, segment.endMs);
    }
  }

  return [...users.values()]
    .map((row) => ({
      user: row.user,
      sessions: row.sessions,
      playSegments: row.playSegments,
      files: row.files.size,
      sources: [...row.sources].sort(),
      scopes: [...row.scopes].sort(),
      scopeCount: row.scopes.size,
      runtimeSeconds: row.runtimeSeconds,
      playtimeSeconds: row.playtimeSeconds,
      multiplayerSeconds: row.multiplayerSeconds,
      singleplayerSeconds: row.singleplayerSeconds,
      runtime: formatDuration(row.runtimeSeconds),
      playtime: formatDuration(row.playtimeSeconds),
      multiplayer: formatDuration(row.multiplayerSeconds),
      singleplayer: formatDuration(row.singleplayerSeconds),
      firstSeenAt: iso(row.firstSeenMs),
      lastSeenAt: iso(row.lastSeenMs),
    }))
    .sort((a, b) => b.playtimeSeconds - a.playtimeSeconds || b.runtimeSeconds - a.runtimeSeconds || a.user.localeCompare(b.user));
}

function getAccountPlaytimeRow(users, user) {
  return getGroup(users, user, () => ({
    user,
    sessions: 0,
    playSegments: 0,
    files: new Set(),
    sources: new Set(),
    scopes: new Set(),
    runtimeSeconds: 0,
    playtimeSeconds: 0,
    multiplayerSeconds: 0,
    singleplayerSeconds: 0,
    firstSeenMs: null,
    lastSeenMs: null,
  }));
}

function touchSeen(row, startMs, endMs) {
  if (startMs) row.firstSeenMs = row.firstSeenMs ? Math.min(row.firstSeenMs, startMs) : startMs;
  if (endMs) row.lastSeenMs = row.lastSeenMs ? Math.max(row.lastSeenMs, endMs) : endMs;
}

function buildOwnerAccount(userRecords, reliableRounds, ownerConfig = {}) {
  const localUsers = userRecords.map((user) => user.user).sort();
  const observedFileSet = new Set(userRecords.flatMap((user) => [...user.files]));
  const observedFileRefs = userRecords.reduce((total, user) => total + user.files.size, 0);
  const events = userRecords.reduce((total, user) => total + user.events, 0);
  const eventStats = {
    events,
    selfKills: userRecords.reduce((total, user) => total + user.selfKills, 0),
    selfDeaths: userRecords.reduce((total, user) => total + user.selfDeaths, 0),
    selfBedDestroys: userRecords.reduce((total, user) => total + user.selfBedDestroys, 0),
  };
  const roundsWithSelfEvents = reliableRounds.filter((round) => round.selfKills || round.selfDeaths || round.selfBedDestroys);
  const roundStats = emptyRoundStats();

  for (const round of roundsWithSelfEvents) {
    roundStats.total += 1;
    roundStats.reliable += 1;
    roundStats.durationSeconds += round.durationSeconds;
    roundStats.kills += round.selfKills;
    roundStats.deaths += round.selfDeaths;
    roundStats.bedDestroys += round.selfBedDestroys;
    roundStats.selfKills += round.selfKills;
    roundStats.selfDeaths += round.selfDeaths;
    roundStats.selfBedDestroys += round.selfBedDestroys;
    noteRoundResultStats(roundStats, round);
    addRoundToGameMode(roundStats, round);
  }

  return {
    id: "owner",
    displayName: ownerConfig.displayName ?? "Owner",
    mode: ownerConfig.mode ?? "all_local_users",
    localUserCount: localUsers.length,
    localUsers,
    aliases: normalizeOwnerAliases(ownerConfig.aliases),
    observedFiles: observedFileSet.size,
    observedFileRefs,
    observedEvents: eventStats.events,
    selfKills: eventStats.selfKills,
    selfDeaths: eventStats.selfDeaths,
    selfBedDestroys: eventStats.selfBedDestroys,
    playerBedDestroys: eventStats.selfBedDestroys,
    eventStats,
    rounds: finalizeRoundStats(roundStats),
  };
}

function normalizeOwnerAliases(aliases = []) {
  return [...new Set(Array.from(aliases ?? []).map((alias) => String(alias).trim()).filter(Boolean))].sort();
}

function emptyGroup(source, scope = null) {
  return {
    source,
    scope,
    scopes: scope === null ? 0 : 1,
    files: 0,
    bytes: 0,
    starts: 0,
    stops: 0,
    connects: 0,
    sessions: 0,
    runtimeSeconds: 0,
    playSegments: 0,
    playtimeSeconds: 0,
    multiplayerSeconds: 0,
    singleplayerSeconds: 0,
    chatLines: 0,
    combatSignals: 0,
    crashes: 0,
    rounds: emptyRoundStats(),
    activity: emptyActivityStats(),
  };
}

function addSummary(group, summary) {
  if (group.scope === null) group.scopes += 1;
  group.files += summary.logFiles;
  group.bytes += summary.bytes;
  group.starts += summary.events.client_start;
  group.stops += summary.events.client_stop;
  group.connects += summary.events.server_connect;
  group.sessions += summary.clientSessions.length;
  group.runtimeSeconds += sumDurations(summary.clientSessions);
  group.playSegments += summary.playSegments.length;
  group.playtimeSeconds += sumDurations(summary.playSegments);
  group.multiplayerSeconds += sumDurations(summary.playSegments.filter((segment) => segment.type === "multiplayer"));
  group.singleplayerSeconds += sumDurations(summary.playSegments.filter((segment) => segment.type === "singleplayer"));
  group.chatLines += summary.events.chat_message;
  group.combatSignals += summary.events.death_or_kill;
  group.crashes += summary.events.crash;
}

function addRoundsToGroups(groups, reliableRounds, allRounds, keyForRound) {
  for (const round of allRounds) {
    const group = groups.get(keyForRound(round));
    if (group) group.rounds.total += 1;
  }
  for (const round of reliableRounds) {
    const group = groups.get(keyForRound(round));
    if (!group) continue;
    group.rounds.reliable += 1;
    group.rounds.durationSeconds += round.durationSeconds;
    group.rounds.kills += round.kills;
    group.rounds.deaths += round.deaths;
    group.rounds.playerMaxKillStreak = Math.max(group.rounds.playerMaxKillStreak ?? 0, round.playerMaxKillStreak ?? 0);
    group.rounds.bedDestroys += round.bedDestroys;
    group.rounds.selfKills += round.selfKills;
    group.rounds.selfDeaths += round.selfDeaths;
    group.rounds.selfBedDestroys += round.selfBedDestroys;
    group.rounds[resultCountKey(round.result)] += 1;
    addRoundToGameMode(group.rounds, round);
  }
  for (const group of groups.values()) {
    group.rounds.ignored = group.rounds.total - group.rounds.reliable;
  }
}

function addActivityToGroups(groups, activitySegments, keyForSegment) {
  for (const segment of activitySegments) {
    const group = groups.get(keyForSegment(segment));
    if (!group) continue;
    group.activity ??= emptyActivityStats();
    addActivitySegmentToStats(group.activity, segment);
  }
}

function finalizeGroup(group) {
  return withDurations({
    ...group,
    sizeMb: Number((group.bytes / 1024 / 1024).toFixed(1)),
    rounds: finalizeRoundStats(group.rounds),
    activity: finalizeActivityStats(group.activity ?? emptyActivityStats()),
  });
}

function finalizeDay(date, day) {
  const result = withDurations({
    date,
    sessions: day.sessions ?? 0,
    runtimeSeconds: day.runtimeSeconds ?? 0,
    playSegments: day.playSegments ?? 0,
    playtimeSeconds: day.playtimeSeconds ?? 0,
    multiplayerSeconds: day.multiplayerSeconds ?? 0,
    singleplayerSeconds: day.singleplayerSeconds ?? 0,
    crashes: day.crashes ?? 0,
    rounds: finalizeRoundStats(day.rounds ?? emptyRoundStats()),
    activity: finalizeActivityStats(day.activity ?? emptyActivityStats()),
    matchedEvents: day.matchedEvents ?? { total: 0 },
  });
  result.rounds.duration = formatDuration(result.rounds.durationSeconds);
  return result;
}

function aggregateRoundStats(reliableRounds, allRounds) {
  const stats = emptyRoundStats();
  stats.total = allRounds.length;
  stats.reliable = reliableRounds.length;
  stats.ignored = allRounds.length - reliableRounds.length;
  for (const round of reliableRounds) {
    stats.durationSeconds += round.durationSeconds;
    stats.kills += round.kills;
    stats.deaths += round.deaths;
    stats.playerMaxKillStreak = Math.max(stats.playerMaxKillStreak ?? 0, round.playerMaxKillStreak ?? 0);
    stats.bedDestroys += round.bedDestroys;
    stats.selfKills += round.selfKills;
    stats.selfDeaths += round.selfDeaths;
    stats.selfBedDestroys += round.selfBedDestroys;
    noteRoundResultStats(stats, round);
    addRoundToGameMode(stats, round);
  }
  const finalized = finalizeRoundStats(stats);
  return {
    rounds: finalized.total,
    reliableRounds: finalized.reliable,
    ignoredRounds: finalized.ignored,
    resultEligibleRounds: finalized.resultEligible,
    nonResultRounds: finalized.nonResult,
    roundDurationSeconds: finalized.durationSeconds,
    roundDuration: finalized.duration,
    kills: finalized.kills,
    deaths: finalized.deaths,
    playerMaxKillStreak: finalized.playerMaxKillStreak,
    bedDestroys: finalized.bedDestroys,
    selfKills: finalized.selfKills,
    selfDeaths: finalized.selfDeaths,
    selfBedDestroys: finalized.selfBedDestroys,
    playerBedDestroys: finalized.playerBedDestroys,
    wins: finalized.wins,
    losses: finalized.losses,
    unknownResults: finalized.unknownResults,
    ambiguousResults: finalized.ambiguousResults,
    notApplicableResults: finalized.notApplicableResults,
    winRate: finalized.winRate,
    knownResultRate: ratio(finalized.wins + finalized.losses + finalized.ambiguousResults, finalized.resultEligible),
    gameModes: finalized.gameModes,
  };
}

function buildWinStreakSummary(rounds = []) {
  const ordered = [...rounds]
    .filter((round) => isResultEligibleRound(round) && (round.roundKind ?? "match") !== "activity")
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0) || (a.lineNo ?? 0) - (b.lineNo ?? 0));
  const breakUnknown = computeWinStreakPolicy(ordered, "break_unknown");
  const skipUnknown = computeWinStreakPolicy(ordered, "skip_unknown");
  return {
    breakUnknown,
    skipUnknown,
    break_unknown: breakUnknown,
    skip_unknown: skipUnknown,
  };
}

function computeWinStreakPolicy(rounds, policy) {
  let current = emptyWinStreakRun();
  let best = emptyWinStreakRun();

  for (const round of rounds) {
    const result = normalizeResult(round.result);
    if (result === "win") {
      current = extendWinStreakRun(current, round);
      if (current.count > best.count) best = { ...current };
    } else if (result === "loss" || policy === "break_unknown") {
      current = emptyWinStreakRun();
    }
  }

  return {
    policy,
    best,
    current,
  };
}

function emptyWinStreakRun() {
  return {
    count: 0,
    startAt: null,
    endAt: null,
    startKey: null,
    endKey: null,
  };
}

function extendWinStreakRun(run, round) {
  const count = run.count + 1;
  return {
    count,
    startAt: run.startAt ?? iso(round.startMs),
    endAt: iso(round.endMs ?? round.startMs),
    startKey: run.startKey ?? round.key ?? roundKey(round),
    endKey: round.key ?? roundKey(round),
  };
}

export function propagateServerPlayerIdentityWithinPlaySegments(rounds, summaries = []) {
  const propagatedRounds = rounds.map(cloneRoundForPropagation);
  const segments = buildPlaySegmentIdentitySources(propagatedRounds, summaries);

  for (const segment of segments) {
    const player = uniquePositiveKey(segment.serverPlayerIds);
    if (!player) continue;

    for (const round of segment.rounds) {
      if (hasObjectValues(round.ownerAliasesUsed)) continue;
      round.propagatedServerPlayerIds = { [player]: segment.serverPlayerIds[player] ?? 1 };
      round.identityPropagation = {
        source: "play_segment",
        player,
        segmentStartMs: segment.startMs,
        segmentEndMs: segment.endMs,
        evidenceRounds: segment.evidenceRounds,
      };
      round.resultEvidence ??= [];
      round.resultEvidence.push({
        kind: "owner_alias_from_play_segment",
        result: "unknown",
        confidence: "high",
        timestampMs: null,
        lineNo: null,
        ruleSet: "report",
        ruleId: "play_segment_identity_propagation",
        player,
        evidenceRounds: segment.evidenceRounds,
      });

      applyKnownServerPlayerToRound(round, player, {
        teamEvidenceKind: postIdentityOwnerTeamEvidenceKind(round, "owner_team_from_play_segment_player"),
        teamEvidenceConfidence: "medium",
      });
      applyBoundaryResultInference(round, resultBoundaryEventForRound(round, propagatedRounds));
    }
  }

  return propagatedRounds;
}

export function applyPostIdentityResultInference(rounds) {
  const inferredRounds = rounds.map(cloneRoundForPropagation);

  for (const round of inferredRounds) {
    applyPostIdentityRoundContext(round, inferredRounds);
    applyPostIdentityTerminalBoundaryInference(round, inferredRounds);
    applyBedwarsPostIdentityResultInference(round);
  }

  return inferredRounds;
}

function addPlayerKillStreakToRounds(rounds) {
  return rounds.map((round) => ({
    ...round,
    playerMaxKillStreak: computeRoundPlayerMaxKillStreak(round),
  }));
}

function computeRoundPlayerMaxKillStreak(round) {
  const identity = resolveServerPlayerIdentity(round);
  const serverPlayerId = identity.serverPlayerIdConfidence === "none" ? null : identity.serverPlayerId;
  let current = 0;
  let best = 0;
  const orderedEvents = [...(round?.events ?? [])]
    .filter((event) => event.timestampMs !== null && event.timestampMs !== undefined)
    .sort((a, b) => a.timestampMs - b.timestampMs || (a.lineNo ?? 0) - (b.lineNo ?? 0));
  for (const event of orderedEvents) {
    if (isPlayerKillEvent(event, serverPlayerId)) {
      current += 1;
      best = Math.max(best, current);
    }
    if (isPlayerDeathEvent(event, serverPlayerId)) {
      current = 0;
    }
  }
  return best;
}

function isPlayerKillEvent(event, serverPlayerId) {
  if (event?.self?.kill) return true;
  return Boolean(event?.type === "kill" && serverPlayerId && sameNormalizedPlayer(event.payload?.killer, serverPlayerId));
}

function isPlayerDeathEvent(event, serverPlayerId) {
  if (event?.type === "self_death") return true;
  if (event?.self?.death) return true;
  return Boolean(["kill", "death"].includes(event?.type) && serverPlayerId && sameNormalizedPlayer(event.payload?.victim, serverPlayerId));
}

function applyPostIdentityTerminalBoundaryInference(round, rounds) {
  if (!round || round.result !== "unknown") return;
  applyBoundaryResultInference(round, resultBoundaryEventForRound(round, rounds));
}

function applyPostIdentityRoundContext(round, rounds) {
  if (!round) return;
  const identity = resolveServerPlayerIdentity(round);
  const serverPlayerId = identity.serverPlayerId;
  if (!serverPlayerId || identity.serverPlayerIdConfidence === "none") return;

  const before = postIdentityBoundarySnapshot(round);
  applyKnownServerPlayerToRound(round, serverPlayerId, {
    teamEvidenceKind: postIdentityOwnerTeamEvidenceKind(round, "owner_team_from_known_server_player"),
    teamEvidenceConfidence: identity.serverPlayerIdSource === "launcher_user_fallback" ? "medium" : "high",
  });

  if (!before.ownerTeam && round.ownerTeam) {
    round.resultEvidence ??= [];
    round.resultEvidence.push({
      kind: "owner_alias_from_known_server_player",
      result: "unknown",
      confidence: identity.serverPlayerIdSource === "launcher_user_fallback" ? "medium" : "high",
      timestampMs: null,
      lineNo: null,
      ruleSet: "report",
      ruleId: "post_identity_owner_context",
      player: serverPlayerId,
      serverPlayerIdSource: identity.serverPlayerIdSource,
    });
  }

  if (hasNewPostIdentityBoundaryEvidence(before, round)) {
    applyBoundaryResultInference(round, resultBoundaryEventForRound(round, rounds));
  }
}

function postIdentityOwnerTeamEvidenceKind(round, baseKind) {
  return round?.gameMode && round.gameMode !== "bedwars"
    ? `${baseKind}_non_bedwars`
    : baseKind;
}

function postIdentityBoundarySnapshot(round) {
  return {
    ownerTeam: round.ownerTeam ?? null,
    selfDeaths: round.selfDeaths ?? 0,
    selfBedDestroys: round.selfBedDestroys ?? 0,
    ownerBedDestroyed: Boolean(round.ownerBedDestroyed),
    ownFinalDeaths: round.ownFinalDeaths ?? 0,
    latestSelfDeathMs: round.latestSelfDeathMs ?? null,
    latestCombatSelfDeathMs: round.latestCombatSelfDeathMs ?? null,
    latestOwnFinalDeathMs: round.latestOwnFinalDeathMs ?? null,
    latestOwnerBedDestroyedMs: round.latestOwnerBedDestroyedMs ?? null,
  };
}

function hasNewPostIdentityBoundaryEvidence(before, round) {
  if (!before.ownerTeam && round.ownerTeam) return true;
  if ((round.selfDeaths ?? 0) > before.selfDeaths) return true;
  if ((round.selfBedDestroys ?? 0) > before.selfBedDestroys) return true;
  if (!before.ownerBedDestroyed && round.ownerBedDestroyed) return true;
  if ((round.ownFinalDeaths ?? 0) > before.ownFinalDeaths) return true;
  if (timestampChanged(before.latestSelfDeathMs, round.latestSelfDeathMs)) return true;
  if (timestampChanged(before.latestCombatSelfDeathMs, round.latestCombatSelfDeathMs)) return true;
  if (timestampChanged(before.latestOwnFinalDeathMs, round.latestOwnFinalDeathMs)) return true;
  if (timestampChanged(before.latestOwnerBedDestroyedMs, round.latestOwnerBedDestroyedMs)) return true;
  return false;
}

function timestampChanged(before, after) {
  return (after ?? null) !== (before ?? null);
}

function applyBedwarsPostIdentityResultInference(round) {
  if (!round || round.result !== "unknown" || round.gameMode !== "bedwars") return;

  const identity = resolveServerPlayerIdentity(round);
  const serverPlayerId = identity.serverPlayerId;
  if (!serverPlayerId || identity.serverPlayerIdConfidence === "none") return;

  const punishmentEvent = findOwnerPunishmentEvent(round, serverPlayerId);
  if (punishmentEvent) {
    setPostIdentityRoundResult(round, "loss", "owner_punished_known_server_player", punishmentEvent, {
      player: punishmentEvent.payload?.player ?? serverPlayerId,
      serverPlayerId,
      serverPlayerIdSource: identity.serverPlayerIdSource,
    });
    return;
  }

  const winnerEvidence = findOwnerWonOnMapEvidence(round, serverPlayerId);
  if (winnerEvidence) {
    setPostIdentityRoundResult(round, "win", "owner_won_on_map_known_server_player", winnerEvidence, {
      player: winnerEvidence.winner ?? winnerEvidence.payload?.winner ?? serverPlayerId,
      winner: winnerEvidence.winner ?? winnerEvidence.payload?.winner ?? serverPlayerId,
      map: winnerEvidence.map ?? winnerEvidence.payload?.map ?? null,
      serverPlayerId,
      serverPlayerIdSource: identity.serverPlayerIdSource,
    });
  }
}

function findOwnerPunishmentEvent(round, serverPlayerId) {
  return (round.events ?? []).find((event) =>
    event.type === "player_punished" &&
    sameNormalizedPlayer(event.payload?.player, serverPlayerId)
  ) ?? null;
}

function findOwnerWonOnMapEvidence(round, serverPlayerId) {
  const evidence = (round.resultEvidence ?? []).find((item) =>
    item.kind === "external_winner_broadcast" &&
    sameNormalizedPlayer(item.winner, serverPlayerId)
  );
  if (evidence) return evidence;

  return (round.events ?? []).find((event) =>
    event.type === "round_end" &&
    event.ruleId === "zh_player_won_on_map" &&
    sameNormalizedPlayer(event.payload?.winner, serverPlayerId)
  ) ?? null;
}

function setPostIdentityRoundResult(round, result, kind, source, details = {}) {
  const reason = `post-identity:${kind}`;
  round.result = result;
  round.resultReason = reason;
  round.resultEvidence ??= [];
  round.resultEvidence.push({
    kind,
    result,
    confidence: "high",
    timestampMs: source?.timestampMs ?? null,
    lineNo: source?.lineNo ?? null,
    ruleSet: source?.ruleSet ?? "report",
    ruleId: source?.ruleId ?? kind,
    reason,
    ...details,
  });
}

function sameNormalizedPlayer(left, right) {
  const normalizedLeft = normalizeComparablePlayerName(left);
  const normalizedRight = normalizeComparablePlayerName(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeComparablePlayerName(value) {
  return normalizePlayerDisplayName(value)?.toLowerCase() ?? null;
}

function buildPlaySegmentIdentitySources(rounds, summaries) {
  const segments = [];
  for (const summary of summaries ?? []) {
    for (const playSegment of summary.playSegments ?? []) {
      if (playSegment.type !== "multiplayer") continue;
      const segmentRounds = rounds.filter((round) => roundBelongsToPlaySegment(round, summary, playSegment));
      if (!segmentRounds.length) continue;

      const serverPlayerIds = {};
      const evidenceRounds = [];
      for (const round of segmentRounds) {
        const directIds = normalizePlayerIdCounts(round.ownerAliasesUsed ?? {});
        if (!hasObjectValues(directIds)) continue;
        mergeCounts(serverPlayerIds, directIds);
        evidenceRounds.push({
          lineNo: round.lineNo,
          startMs: round.startMs,
          serverPlayerIds: directIds,
        });
      }

      if (hasObjectValues(serverPlayerIds)) {
        segments.push({
          source: summary.source,
          scope: summary.scope,
          filePath: playSegment.startFile,
          startMs: playSegment.startMs,
          endMs: playSegment.endMs,
          serverPlayerIds: normalizePlayerIdCounts(serverPlayerIds),
          evidenceRounds,
          rounds: segmentRounds,
        });
      }
    }
  }
  return segments;
}

function annotateRoundsWithServerContext(rounds, summaries = [], events = [], chatLines = []) {
  const annotated = rounds.map(cloneRoundForPropagation);
  const segments = buildMultiplayerPlaySegmentRefs(summaries);
  const segmentsByRoundKey = groupPlaySegmentRefsByRoundLookupKey(segments);
  const serverHints = buildProxiedServerHints(segments, events, chatLines);
  const chatLinesByFile = groupByFile(chatLines);

  for (const round of annotated) {
    const segmentMatch = (segmentsByRoundKey.get(roundLookupKey(round)) ?? [])
      .find(({ summary, segment }) => roundBelongsToPlaySegment(round, summary, segment));
    if (segmentMatch && segmentMatch.segment.serverAddress) {
      const { segment } = segmentMatch;
      const directContext = buildDirectServerContext({
        host: segment.serverHost ?? segment.serverAddress,
        port: segment.serverPort ?? null,
        address: segment.serverAddress,
        text: segment.serverConnectMessage ?? null,
        event: {
          lineNo: segment.serverConnectLineNo ?? null,
          timestampMs: segment.startMs ?? null,
        },
      });
      Object.assign(round, proxiedOrDirectServerContext(directContext, serverHints.get(proxiedServerHintKey(segment))));
      continue;
    }

    const chatContext = inferServerContextFromChatLines(filterRowsInRound(chatLinesByFile.get(round.filePath) ?? [], round));
    Object.assign(round, chatContext ?? inferServerContextFromRound(round));
  }

  return annotated;
}

function annotateActivitySegmentWithServerContext(segment, context = {}) {
  const playSegmentsByKey = context.playSegmentsByKey ?? new Map();
  const serverHints = context.serverHints ?? new Map();
  const eventsByFile = context.eventsByFile ?? new Map();
  const chatLinesByFile = context.chatLinesByFile ?? new Map();
  const match = (playSegmentsByKey.get(roundLookupKey(segment)) ?? [])
    .find(({ summary, playSegment }) => activitySegmentBelongsToPlaySegment(segment, summary, playSegment));

  if (match?.playSegment?.serverAddress) {
    const { playSegment } = match;
    const directContext = buildDirectServerContext({
      host: playSegment.serverHost ?? playSegment.serverAddress,
      port: playSegment.serverPort ?? null,
      address: playSegment.serverAddress,
      text: playSegment.serverConnectMessage ?? null,
      event: {
        lineNo: playSegment.serverConnectLineNo ?? null,
        timestampMs: playSegment.startMs ?? null,
      },
    });
    const activityProxiedContext = inferProxiedServerContext(directContext, {
      events: filterRowsInPlaySegment(eventsByFile.get(segment.filePath) ?? [], segment),
      chatLines: filterRowsInPlaySegment(chatLinesByFile.get(segment.filePath) ?? [], segment),
    });
    return {
      ...segment,
      ...proxiedOrDirectServerContext(directContext, activityProxiedContext ?? serverHints.get(proxiedServerHintKey(playSegment))),
    };
  }

  return {
    ...segment,
    ...inferServerContextFromRound({
      ...segment,
      gameMode: segment.mode,
      events: segment.examples ?? [],
    }),
  };
}

function buildMultiplayerPlaySegmentRefs(summaries = []) {
  return summaries.flatMap((summary) =>
    (summary.playSegments ?? [])
      .filter((segment) => segment.type === "multiplayer")
      .map((segment) => ({ summary, segment, playSegment: segment }))
  );
}

function groupPlaySegmentRefsByRoundLookupKey(refs = []) {
  const grouped = new Map();
  for (const ref of refs) {
    const segment = ref.segment ?? ref.playSegment;
    if (!segment?.startFile) continue;
    const key = `${ref.summary?.source ?? ""}\0${ref.summary?.scope ?? ""}\0${segment.startFile}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ref);
  }
  return grouped;
}

function roundLookupKey(row) {
  return `${row?.source ?? ""}\0${row?.scope ?? ""}\0${row?.filePath ?? ""}`;
}

function roundBelongsToPlaySegment(round, summary, segment) {
  if (!round || !segment) return false;
  if (round.source !== summary.source || round.scope !== summary.scope) return false;
  if (segment.startFile && round.filePath !== segment.startFile) return false;
  const segmentEndMs = segment.endMs ?? Number.POSITIVE_INFINITY;
  const roundStartMs = round.startMs ?? 0;
  const roundEndMs = round.endMs ?? round.lastEventMs ?? roundStartMs;
  return roundEndMs >= segment.startMs && roundStartMs <= segmentEndMs;
}

function activitySegmentBelongsToPlaySegment(activitySegment, summary, playSegment) {
  if (!activitySegment || !playSegment) return false;
  if (activitySegment.source !== summary.source || activitySegment.scope !== summary.scope) return false;
  if (playSegment.startFile && activitySegment.filePath !== playSegment.startFile) return false;
  const playSegmentEndMs = playSegment.endMs ?? Number.POSITIVE_INFINITY;
  const activityStartMs = activitySegment.startMs ?? 0;
  const activityEndMs = activitySegment.endMs ?? activitySegment.lastEventMs ?? activityStartMs;
  return activityEndMs >= playSegment.startMs && activityStartMs <= playSegmentEndMs;
}

function buildProxiedServerHints(segments, events = [], chatLines = []) {
  const hints = new Map();
  const eventsByFile = groupByFile(events);
  const chatLinesByFile = groupByFile(chatLines);

  for (const { segment } of segments) {
    if (!segment?.serverAddress) continue;
    const directContext = buildDirectServerContext({
      host: segment.serverHost ?? segment.serverAddress,
      port: segment.serverPort ?? null,
      address: segment.serverAddress,
      text: segment.serverConnectMessage ?? null,
      event: {
        lineNo: segment.serverConnectLineNo ?? null,
        timestampMs: segment.startMs ?? null,
      },
    });
    const segmentEvents = filterRowsInPlaySegment(eventsByFile.get(segment.startFile) ?? [], segment);
    const segmentChatLines = filterRowsInPlaySegment(chatLinesByFile.get(segment.startFile) ?? [], segment);
    const proxied = inferProxiedServerContext(directContext, {
      events: segmentEvents,
      chatLines: segmentChatLines,
    });
    if (proxied) hints.set(proxiedServerHintKey(segment), proxied);
  }

  return hints;
}

function proxiedOrDirectServerContext(directContext, proxiedContext) {
  return proxiedContext ?? directContext;
}

function proxiedServerHintKey(segment) {
  return `${segment.startFile ?? ""}\0${segment.startMs ?? ""}\0${segment.endMs ?? ""}\0${segment.serverAddress ?? ""}`;
}

function filterRowsInPlaySegment(rows, segment) {
  const segmentEndMs = segment.endMs ?? Number.POSITIVE_INFINITY;
  return rows.filter((row) =>
    row?.timestampMs !== null &&
    row?.timestampMs !== undefined &&
    row.timestampMs >= segment.startMs &&
    row.timestampMs <= segmentEndMs
  );
}

function filterRowsInRound(rows, round) {
  const startMs = round.startMs ?? Number.NEGATIVE_INFINITY;
  const endMs = round.endMs ?? round.lastEventMs ?? Number.POSITIVE_INFINITY;
  return rows.filter((row) =>
    row?.timestampMs !== null &&
    row?.timestampMs !== undefined &&
    row.timestampMs >= startMs &&
    row.timestampMs <= endMs
  );
}

function groupByFile(rows = []) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    if (!row?.filePath) continue;
    if (!grouped.has(row.filePath)) grouped.set(row.filePath, []);
    grouped.get(row.filePath).push(row);
  }
  return grouped;
}

function uniquePositiveKey(counts = {}) {
  const keys = Object.keys(counts).filter((key) => counts[key] > 0);
  return keys.length === 1 ? keys[0] : null;
}

function resultBoundaryEventForRound(round, rounds) {
  const existingBoundary = [...(round.boundaryEvents ?? [])]
    .reverse()
    .find((event) => ["round_end", "session_boundary", "next_waiting_room"].includes(event.role));
  if (existingBoundary) return { ...existingBoundary, payload: existingBoundary.payload ?? {} };

  if (round.endReason === "next_round") {
    const nextRound = rounds
      .filter((candidate) =>
        candidate !== round &&
        candidate.source === round.source &&
        candidate.scope === round.scope &&
        candidate.filePath === round.filePath &&
        candidate.startMs > round.startMs
      )
      .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo)[0];
    const startBoundary = nextRound?.boundaryEvents?.[0];
    if (nextRound) {
      return {
        type: nextRound.startReason,
        timestampMs: nextRound.startMs,
        lineNo: nextRound.lineNo,
        ruleSet: startBoundary?.ruleSet ?? "report",
        ruleId: startBoundary?.ruleId ?? nextRound.startReason,
        payload: {
          seconds: startBoundary?.seconds ?? null,
        },
      };
    }
  }

  return {
    type: round.endReason ?? "last_event",
    timestampMs: round.endMs ?? round.lastEventMs ?? round.startMs,
    lineNo: round.boundaryEvents?.at(-1)?.lineNo ?? round.lineNo,
    ruleSet: "report",
    ruleId: round.endReason ?? "last_event",
    payload: {},
  };
}

function cloneRoundForPropagation(round) {
  return JSON.parse(JSON.stringify(round));
}

function buildRoundSection(rounds, reliableRounds, ignoredRounds) {
  const all = rounds.map(enrichRound);
  const byKey = new Map(all.map((round) => [round.key, round]));
  const enrichedFor = (round) => byKey.get(round.key ?? roundKey(round));
  return {
    summary: aggregateRoundStats(reliableRounds, rounds),
    reliable: reliableRounds.map(enrichedFor),
    ignored: ignoredRounds.map(enrichedFor),
    allRef: "rounds.all",
    all,
  };
}

function emptyRoundStats() {
  return {
    total: 0,
    reliable: 0,
    ignored: 0,
    resultEligible: 0,
    nonResult: 0,
    durationSeconds: 0,
    kills: 0,
    deaths: 0,
    playerMaxKillStreak: 0,
    bedDestroys: 0,
    selfKills: 0,
    selfDeaths: 0,
    selfBedDestroys: 0,
    wins: 0,
    losses: 0,
    unknownResults: 0,
    ambiguousResults: 0,
    notApplicableResults: 0,
    byGameMode: {},
  };
}

function emptyActivityStats() {
  return {
    segments: 0,
    durationSeconds: 0,
    kills: 0,
    deaths: 0,
    selfKills: 0,
    selfDeaths: 0,
    modeSignals: 0,
    maxStreak: 0,
    observedBroadcastMaxKillStreak: 0,
    playerMaxKillStreak: 0,
    streakPoints: 0,
    rewardEvents: 0,
    goldEarned: 0,
    xpEarned: 0,
    bountyClaims: 0,
    bountyGoldEarned: 0,
    megastreaks: 0,
    byGameMode: {},
  };
}

function emptyActivitySection() {
  const stats = emptyActivityStats();
  return {
    summary: finalizeActivityStats(stats),
    segments: [],
    policy: {},
  };
}

function emptyActivityModeStats() {
  return {
    segments: 0,
    durationSeconds: 0,
    kills: 0,
    deaths: 0,
    selfKills: 0,
    selfDeaths: 0,
    modeSignals: 0,
    maxStreak: 0,
    observedBroadcastMaxKillStreak: 0,
    playerMaxKillStreak: 0,
    streakPoints: 0,
    rewardEvents: 0,
    goldEarned: 0,
    xpEarned: 0,
    bountyClaims: 0,
    bountyGoldEarned: 0,
    megastreaks: 0,
  };
}

function addActivityStats(target, source = emptyActivityStats()) {
  target.segments += source.segments ?? 0;
  target.durationSeconds += source.durationSeconds ?? 0;
  target.kills += source.kills ?? 0;
  target.deaths += source.deaths ?? 0;
  target.selfKills += source.selfKills ?? 0;
  target.selfDeaths += source.selfDeaths ?? 0;
  target.modeSignals += source.modeSignals ?? 0;
  target.maxStreak = Math.max(target.maxStreak ?? 0, source.maxStreak ?? 0);
  target.observedBroadcastMaxKillStreak = Math.max(target.observedBroadcastMaxKillStreak ?? 0, source.observedBroadcastMaxKillStreak ?? source.maxStreak ?? 0);
  target.playerMaxKillStreak = Math.max(target.playerMaxKillStreak ?? 0, source.playerMaxKillStreak ?? 0);
  target.streakPoints += source.streakPoints ?? 0;
  target.rewardEvents += source.rewardEvents ?? 0;
  target.goldEarned += source.goldEarned ?? 0;
  target.xpEarned += source.xpEarned ?? 0;
  target.bountyClaims += source.bountyClaims ?? 0;
  target.bountyGoldEarned += source.bountyGoldEarned ?? 0;
  target.megastreaks += source.megastreaks ?? 0;
  mergeActivityModeStats(target.byGameMode, source.byGameMode ?? source.gameModes ?? {});
}

function addActivitySegmentToStats(stats, segment) {
  stats.segments += 1;
  stats.durationSeconds += segment.durationSeconds ?? 0;
  stats.kills += segment.kills ?? 0;
  stats.deaths += segment.deaths ?? 0;
  stats.selfKills += segment.selfKills ?? 0;
  stats.selfDeaths += segment.selfDeaths ?? 0;
  stats.modeSignals += segment.modeSignals ?? 0;
  stats.maxStreak = Math.max(stats.maxStreak ?? 0, segment.maxStreak ?? 0);
  stats.observedBroadcastMaxKillStreak = Math.max(stats.observedBroadcastMaxKillStreak ?? 0, segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0);
  stats.playerMaxKillStreak = Math.max(stats.playerMaxKillStreak ?? 0, segment.playerMaxKillStreak ?? 0);
  stats.streakPoints += segment.streakPoints ?? 0;
  stats.rewardEvents += segment.rewardEvents ?? 0;
  stats.goldEarned += segment.goldEarned ?? 0;
  stats.xpEarned += segment.xpEarned ?? 0;
  stats.bountyClaims += segment.bountyClaims ?? 0;
  stats.bountyGoldEarned += segment.bountyGoldEarned ?? 0;
  stats.megastreaks += segment.megastreaks ?? 0;

  const modeStats = getObjectGroup(stats.byGameMode, segment.mode, emptyActivityModeStats);
  modeStats.segments += 1;
  modeStats.durationSeconds += segment.durationSeconds ?? 0;
  modeStats.kills += segment.kills ?? 0;
  modeStats.deaths += segment.deaths ?? 0;
  modeStats.selfKills += segment.selfKills ?? 0;
  modeStats.selfDeaths += segment.selfDeaths ?? 0;
  modeStats.modeSignals += segment.modeSignals ?? 0;
  modeStats.maxStreak = Math.max(modeStats.maxStreak ?? 0, segment.maxStreak ?? 0);
  modeStats.observedBroadcastMaxKillStreak = Math.max(modeStats.observedBroadcastMaxKillStreak ?? 0, segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0);
  modeStats.playerMaxKillStreak = Math.max(modeStats.playerMaxKillStreak ?? 0, segment.playerMaxKillStreak ?? 0);
  modeStats.streakPoints += segment.streakPoints ?? 0;
  modeStats.rewardEvents += segment.rewardEvents ?? 0;
  modeStats.goldEarned += segment.goldEarned ?? 0;
  modeStats.xpEarned += segment.xpEarned ?? 0;
  modeStats.bountyClaims += segment.bountyClaims ?? 0;
  modeStats.bountyGoldEarned += segment.bountyGoldEarned ?? 0;
  modeStats.megastreaks += segment.megastreaks ?? 0;
}

function mergeActivityModeStats(target, source) {
  const mergeableKeys = new Set(Object.keys(emptyActivityModeStats()));
  for (const [mode, sourceStats] of Object.entries(source ?? {})) {
    const targetStats = getObjectGroup(target, mode, emptyActivityModeStats);
    for (const [key, value] of Object.entries(sourceStats)) {
      if (!mergeableKeys.has(key) || typeof value !== "number") continue;
      if (["maxStreak", "observedBroadcastMaxKillStreak", "playerMaxKillStreak"].includes(key)) {
        targetStats[key] = Math.max(targetStats[key] ?? 0, value);
      } else {
        targetStats[key] = (targetStats[key] ?? 0) + value;
      }
    }
  }
}

function finalizeActivityStats(stats) {
  const gameModes = Object.fromEntries(
    Object.entries(stats.byGameMode ?? {})
      .map(([mode, modeStats]) => [mode, finalizeActivityModeStats(mode, modeStats)])
      .sort((a, b) => b[1].durationSeconds - a[1].durationSeconds || b[1].segments - a[1].segments || a[0].localeCompare(b[0])),
  );
  const finalized = {
    ...emptyActivityStats(),
    ...stats,
    duration: formatDuration(stats.durationSeconds ?? 0),
    gameModes,
  };
  delete finalized.byGameMode;
  return finalized;
}

function finalizeActivityModeStats(mode, stats) {
  return {
    id: mode,
    label: labelGameMode(mode),
    ...emptyActivityModeStats(),
    ...stats,
    duration: formatDuration(stats.durationSeconds ?? 0),
  };
}

function addRoundStats(target, source) {
  target.total += source.total ?? 0;
  target.reliable += source.reliable ?? 0;
  target.ignored += source.ignored ?? 0;
  target.resultEligible += source.resultEligible ?? 0;
  target.nonResult += source.nonResult ?? 0;
  target.durationSeconds += source.durationSeconds ?? 0;
  target.kills += source.kills ?? 0;
  target.deaths += source.deaths ?? 0;
  target.playerMaxKillStreak = Math.max(target.playerMaxKillStreak ?? 0, source.playerMaxKillStreak ?? 0);
  target.bedDestroys += source.bedDestroys ?? 0;
  target.selfKills += source.selfKills ?? 0;
  target.selfDeaths += source.selfDeaths ?? 0;
  target.selfBedDestroys += source.selfBedDestroys ?? 0;
  target.wins += source.wins ?? 0;
  target.losses += source.losses ?? 0;
  target.unknownResults += source.unknownResults ?? 0;
  target.ambiguousResults += source.ambiguousResults ?? 0;
  target.notApplicableResults += source.notApplicableResults ?? 0;
  mergeGameModeStats(target.byGameMode, source.byGameMode ?? source.gameModes ?? {});
}

function finalizeRoundStats(stats) {
  const byGameMode = stats.byGameMode ?? {};
  const selfBedDestroys = stats.selfBedDestroys ?? 0;
  const finalized = {
    ...emptyRoundStats(),
    ...stats,
    selfBedDestroys,
    playerBedDestroys: stats.playerBedDestroys ?? selfBedDestroys,
    gameModes: finalizeGameModeStats(byGameMode),
    winRate: ratio(stats.wins ?? 0, (stats.wins ?? 0) + (stats.losses ?? 0)),
    knownResultRate: ratio((stats.wins ?? 0) + (stats.losses ?? 0) + (stats.ambiguousResults ?? 0), stats.resultEligible ?? 0),
    duration: formatDuration(stats.durationSeconds ?? 0),
  };
  delete finalized.byGameMode;
  return finalized;
}

function withDurations(row) {
  return {
    ...row,
    runtime: formatDuration(row.runtimeSeconds ?? 0),
    playtime: formatDuration(row.playtimeSeconds ?? 0),
    multiplayer: formatDuration(row.multiplayerSeconds ?? 0),
    singleplayer: formatDuration(row.singleplayerSeconds ?? 0),
  };
}

function confidenceLevel(round) {
  if (!isReliableRound(round)) return "low";
  if (round.endReason === "next_round") return "high";
  return "medium";
}

function summarizeRound(round) {
  if (!round) return null;
  const enriched = enrichRound(round);
  return {
    key: enriched.key,
    source: enriched.source,
    scope: enriched.scope,
    sessionAlias: enriched.sessionAlias,
    localUser: enriched.localUser,
    launcherUser: enriched.launcherUser,
    serverPlayerId: enriched.serverPlayerId,
    serverPlayerIds: enriched.serverPlayerIds,
    serverPlayerIdSource: enriched.serverPlayerIdSource,
    serverPlayerIdConfidence: enriched.serverPlayerIdConfidence,
    serverIdentityContext: enriched.serverIdentityContext,
    serverNetwork: enriched.serverNetwork,
    serverAddress: enriched.serverAddress,
    serverLabel: enriched.serverLabel,
    serverConfidence: enriched.serverConfidence,
    serverEvidence: enriched.serverEvidence,
    ownerAliasesUsed: enriched.ownerAliasesUsed,
    propagatedServerPlayerIds: enriched.propagatedServerPlayerIds,
    identityPropagation: enriched.identityPropagation,
    startAt: enriched.startAt,
    durationSeconds: enriched.durationSeconds,
    duration: enriched.duration,
    confidence: enriched.confidence,
    ignoredReason: enriched.ignoredReason,
    parserConfidence: enriched.parserConfidence,
    result: enriched.result,
    resultReason: enriched.resultReason,
    resultEligible: enriched.resultEligible,
    roundKind: enriched.roundKind,
    gameMode: enriched.gameMode,
    startReason: enriched.startReason,
    endReason: enriched.endReason,
    kills: enriched.kills,
    deaths: enriched.deaths,
    playerMaxKillStreak: enriched.playerMaxKillStreak,
    observedBroadcastMaxKillStreak: enriched.observedBroadcastMaxKillStreak,
    rewardEvents: enriched.rewardEvents,
    streakPoints: enriched.streakPoints,
    goldEarned: enriched.goldEarned,
    xpEarned: enriched.xpEarned,
    bountyClaims: enriched.bountyClaims,
    bountyGoldEarned: enriched.bountyGoldEarned,
    bedDestroys: enriched.bedDestroys,
    selfKills: enriched.selfKills,
    selfDeaths: enriched.selfDeaths,
    selfBedDestroys: enriched.selfBedDestroys,
    playerBedDestroys: enriched.playerBedDestroys,
    filePath: enriched.filePath,
    lineNo: enriched.lineNo,
  };
}

function enrichActivitySegment(segment) {
  const identity = resolveServerPlayerIdentity({
    ...segment,
    ownerAliasesUsed: segment.serverPlayerIdsDirect ?? {},
  });
  return {
    ...segment,
    sessionAlias: segment.localUser ?? null,
    launcherUser: identity.launcherUser,
    launcherUsers: identity.launcherUsers,
    serverPlayerId: identity.serverPlayerId,
    serverPlayerIds: identity.serverPlayerIds,
    serverPlayerIdSource: identity.serverPlayerIdSource,
    serverPlayerIdConfidence: identity.serverPlayerIdConfidence,
    serverIdentityContext: identity.serverIdentityContext,
    serverPlayerIdPolicy: identity.serverPlayerIdPolicy,
    startAt: iso(segment.startMs),
    endAt: iso(segment.endMs),
    duration: formatDuration(segment.durationSeconds ?? 0),
    label: labelGameMode(segment.mode),
  };
}

function enrichRound(round) {
  const result = normalizeResult(round.result);
  const identity = resolveServerPlayerIdentity(round);
  const serverContext = ensureServerContext(round);
  const resultHint = result === "unknown" ? guessUnknownResultHint(round) : null;
  const resultEligible = isResultEligibleRound({ ...round, result });
  const unknownAudit = result === "unknown" && resultEligible && isReliableRound(round) ? buildUnknownAudit({ ...round, result, resultHint }) : null;
  return {
    key: round.key ?? roundKey(round),
    source: round.source,
    scope: round.scope,
    sessionAlias: round.localUser ?? null,
    localUser: round.localUser ?? null,
    localUsers: round.localUsers ?? {},
    launcherUser: identity.launcherUser,
    launcherUsers: identity.launcherUsers,
    serverPlayerId: identity.serverPlayerId,
    serverPlayerIds: identity.serverPlayerIds,
    serverPlayerIdSource: identity.serverPlayerIdSource,
    serverPlayerIdConfidence: identity.serverPlayerIdConfidence,
    serverIdentityContext: identity.serverIdentityContext,
    serverPlayerIdPolicy: identity.serverPlayerIdPolicy,
    serverNetwork: serverContext.serverNetwork,
    serverAddress: serverContext.serverAddress,
    serverLabel: serverContext.serverLabel,
    serverConfidence: serverContext.serverConfidence,
    serverEvidence: serverContext.serverEvidence,
    ownerAliasesUsed: round.ownerAliasesUsed ?? {},
    propagatedServerPlayerIds: round.propagatedServerPlayerIds ?? {},
    identityPropagation: round.identityPropagation ?? null,
    startAt: iso(round.startMs),
    endAt: iso(round.endMs),
    startMs: round.startMs,
    endMs: round.endMs,
    lastEventMs: round.lastEventMs,
    durationSeconds: round.durationSeconds,
    duration: formatDuration(round.durationSeconds),
    confidence: confidenceLevel(round),
    ignoredReason: getIgnoredRoundReason(round),
    parserConfidence: round.confidence,
    result,
    resultReason: round.resultReason,
    resultEligible,
    roundKind: round.roundKind ?? "match",
    resultHint,
    unknownAudit,
    gameMode: round.gameMode ?? unknownGameMode,
    startReason: round.startReason,
    endReason: round.endReason,
    kills: round.kills,
    deaths: round.deaths,
    playerMaxKillStreak: round.playerMaxKillStreak ?? 0,
    observedBroadcastMaxKillStreak: round.observedBroadcastMaxKillStreak ?? round.maxStreak ?? 0,
    rewardEvents: round.rewardEvents ?? 0,
    streakPoints: round.streakPoints ?? 0,
    goldEarned: round.goldEarned ?? 0,
    xpEarned: round.xpEarned ?? 0,
    bountyClaims: round.bountyClaims ?? 0,
    bountyGoldEarned: round.bountyGoldEarned ?? 0,
    bedDestroys: round.bedDestroys,
    selfKills: round.selfKills,
    selfDeaths: round.selfDeaths,
    selfDeathSignals: round.selfDeathSignals ?? 0,
    selfBedDestroys: round.selfBedDestroys,
    playerBedDestroys: round.playerBedDestroys ?? round.selfBedDestroys ?? 0,
    joins: round.joins,
    leaves: round.leaves,
    roundStarts: round.roundStarts ?? 0,
    roundEnds: round.roundEnds ?? 0,
    boundaryEvents: round.boundaryEvents ?? [],
    killers: round.killers,
    victims: round.victims,
    bedDestroyers: round.bedDestroyers,
    punishedPlayers: round.punishedPlayers ?? {},
    teamEliminations: round.teamEliminations ?? {},
    bedDestroyedTeams: round.bedDestroyedTeams ?? {},
    resultEvidence: round.resultEvidence ?? [],
    ownerBedDestroyed: round.ownerBedDestroyed ?? false,
    ownerTeamEliminated: round.ownerTeamEliminated ?? false,
    ownFinalDeaths: round.ownFinalDeaths ?? 0,
    punishedExit: round.punishedExit ?? null,
    ownerTeam: round.ownerTeam ?? null,
    filePath: round.filePath,
    lineNo: round.lineNo,
  };
}

function resultCountKey(result) {
  if (result === "win") return "wins";
  if (result === "loss") return "losses";
  if (result === "ambiguous") return "ambiguousResults";
  if (result === "not_applicable") return "notApplicableResults";
  return "unknownResults";
}

function normalizeResult(result) {
  return ["win", "loss", "ambiguous", "not_applicable"].includes(result) ? result : "unknown";
}

function isResultEligibleRound(round) {
  return round?.resultEligible !== false && normalizeResult(round?.result) !== "not_applicable";
}

function noteRoundResultStats(stats, round) {
  if (isResultEligibleRound(round)) {
    stats.resultEligible += 1;
  } else {
    stats.nonResult += 1;
  }
  stats[resultCountKey(normalizeResult(round?.result))] += 1;
}

function addRoundResultCount(days, key, round) {
  addCount(days, key, isResultEligibleRound(round) ? "rounds.resultEligible" : "rounds.nonResult", 1);
  addCount(days, key, `rounds.${resultCountKey(normalizeResult(round?.result))}`, 1);
}

function addReliableRoundToGameMode(days, key, round) {
  const day = getGroup(days, key, () => ({}));
  day.rounds ??= emptyRoundStats();
  addRoundToGameMode(day.rounds, round);
}

function addRoundToGameMode(stats, round) {
  const mode = round.gameMode ?? unknownGameMode;
  stats.byGameMode ??= {};
  const modeStats = getObjectGroup(stats.byGameMode, mode, emptyGameModeStats);
  modeStats.rounds += 1;
  modeStats.durationSeconds += round.durationSeconds ?? 0;
  modeStats.kills += round.kills ?? 0;
  modeStats.deaths += round.deaths ?? 0;
  modeStats.playerMaxKillStreak = Math.max(modeStats.playerMaxKillStreak ?? 0, round.playerMaxKillStreak ?? 0);
  modeStats.bedDestroys += round.bedDestroys ?? 0;
  modeStats.selfKills += round.selfKills ?? 0;
  modeStats.selfDeaths += round.selfDeaths ?? 0;
  modeStats.selfBedDestroys += round.selfBedDestroys ?? 0;
  noteRoundResultStats(modeStats, round);
}

function emptyGameModeStats() {
  return {
    rounds: 0,
    durationSeconds: 0,
    kills: 0,
    deaths: 0,
    playerMaxKillStreak: 0,
    bedDestroys: 0,
    selfKills: 0,
    selfDeaths: 0,
    selfBedDestroys: 0,
    resultEligible: 0,
    nonResult: 0,
    wins: 0,
    losses: 0,
    unknownResults: 0,
    ambiguousResults: 0,
    notApplicableResults: 0,
  };
}

function mergeGameModeStats(target, source) {
  const mergeableKeys = new Set(Object.keys(emptyGameModeStats()));
  for (const [mode, sourceStats] of Object.entries(source ?? {})) {
    const targetStats = getObjectGroup(target, mode, emptyGameModeStats);
    for (const [key, value] of Object.entries(sourceStats)) {
      if (!mergeableKeys.has(key) || typeof value !== "number") continue;
      if (key === "playerMaxKillStreak") {
        targetStats[key] = Math.max(targetStats[key] ?? 0, value);
      } else {
        targetStats[key] = (targetStats[key] ?? 0) + value;
      }
    }
  }
}

function getObjectGroup(object, key, create) {
  object[key] ??= create();
  return object[key];
}

function finalizeGameModeStats(byGameMode) {
  return Object.fromEntries(
    Object.entries(byGameMode ?? {})
      .map(([mode, stats]) => [
        mode,
        {
          id: mode,
          label: labelGameMode(mode),
          ...stats,
          playerBedDestroys: stats.playerBedDestroys ?? stats.selfBedDestroys ?? 0,
          duration: formatDuration(stats.durationSeconds ?? 0),
          winRate: ratio(stats.wins ?? 0, (stats.wins ?? 0) + (stats.losses ?? 0)),
          knownResultRate: ratio((stats.wins ?? 0) + (stats.losses ?? 0) + (stats.ambiguousResults ?? 0), stats.resultEligible ?? 0),
        },
      ])
      .sort((a, b) => b[1].rounds - a[1].rounds || a[0].localeCompare(b[0])),
  );
}

function roundKey(round) {
  return `${round.source}\0${round.scope}\0${round.filePath}\0${round.lineNo}\0${round.startMs}`;
}

function addDuration(days, startMs, endMs, durationSeconds, path) {
  if (!startMs || !durationSeconds) return;
  let cursor = startMs;
  const finalEnd = endMs && endMs > startMs ? endMs : startMs + durationSeconds * 1000;

  while (cursor < finalEnd) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const sliceEnd = Math.min(finalEnd, nextDay.getTime());
    addCount(days, dateKey(cursor), path, Math.round((sliceEnd - cursor) / 1000));
    cursor = sliceEnd;
  }
}

function addCount(days, key, path, amount) {
  const day = getGroup(days, key, () => ({}));
  const parts = path.split(".");
  let target = day;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part];
  }
  const last = parts.at(-1);
  target[last] = (target[last] ?? 0) + amount;
}

function addMaxCount(days, key, path, value = 0) {
  const day = getGroup(days, key, () => ({}));
  const parts = path.split(".");
  let target = day;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part];
  }
  const last = parts.at(-1);
  target[last] = Math.max(target[last] ?? 0, value ?? 0);
}

function addPlainCount(target, key, amount = 1) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + amount;
}

function getGroup(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

function sortCountObject(object) {
  return Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1]));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortCountObject(counts);
}

function groupRowsBy(items, keyFn) {
  const groups = {};
  for (const item of items ?? []) {
    const key = keyFn(item) ?? "unknown";
    groups[key] ??= [];
    groups[key].push(item);
  }
  return groups;
}

function hasObjectValues(value) {
  return Object.values(value ?? {}).some((count) => count > 0);
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function scopeKey(source, scope) {
  return `${source}\0${scope}`;
}

function sumDurations(rows) {
  return rows.reduce((total, row) => total + (row.durationSeconds ?? 0), 0);
}

function sumEvents(summaries, eventType) {
  return summaries.reduce((total, summary) => total + (summary.events[eventType] ?? 0), 0);
}

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : 0;
}

function maxBy(items, scoreFn) {
  let best = null;
  let bestScore = null;
  for (const item of items ?? []) {
    const score = scoreFn(item);
    if (score === null || score === undefined || Number.isNaN(score)) continue;
    if (best === null || score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function minBy(items, scoreFn) {
  let best = null;
  let bestScore = null;
  for (const item of items ?? []) {
    const score = scoreFn(item);
    if (score === null || score === undefined || Number.isNaN(score)) continue;
    if (best === null || score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function dateKey(timestampMs) {
  if (!timestampMs) return "unknown";
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDateText(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return dateKey(date.getTime());
}

function localTimeText(timestampMs) {
  if (!timestampMs) return null;
  const date = new Date(timestampMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function nightOfDate(timestampMs) {
  if (!timestampMs) return null;
  const date = new Date(timestampMs);
  if (date.getHours() < 12) date.setDate(date.getDate() - 1);
  return dateKey(date.getTime());
}

function lateNightScore(timestampMs) {
  if (!timestampMs) return -Infinity;
  const date = new Date(timestampMs);
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  return seconds < 12 * 3600 ? seconds + 24 * 3600 : seconds;
}

function weekKey(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function categorizeUnmatchedTemplates(templates) {
  const counts = {};
  for (const template of templates) {
    const category = classifyUnmatchedTemplate(template.template, template.examples ?? []);
    counts[category] = (counts[category] ?? 0) + template.count;
  }
  return sortCountObject(counts);
}

function classifyUnmatchedTemplate(template, examples) {
  const text = `${template} ${examples.join(" ")}`.toLowerCase();
  if (/\[(?:aquavit|noteless|foodbyte)\]|(?:^|\s)(?:aquavit|noteless|foodbyte)\b/.test(text)) return "client_mod_noise";
  if (/bed|床|破坏|destroy/.test(text)) return "possible_bedwars_objective";
  if (/kill|slain|shot|killed|杀|死|void|虚空|摧毁/.test(text)) return "possible_combat";
  if (/start|开始|倒计时|winner|victory|defeat|胜|败/.test(text)) return "possible_round_state";
  if (/joined|left|加入|离开|退出/.test(text)) return "possible_presence";
  if (/coin|xp|经验|奖励|硬币|掉落/.test(text)) return "possible_reward";
  if (/settings|value|bind|toggle|module|velocity|发包|autosettings|kafix/.test(text)) return "client_mod_noise";
  if (/^<empty>$|^-+$|^=+$/.test(template)) return "separator_noise";
  return "unknown";
}

function iso(timestampMs) {
  return timestampMs ? new Date(timestampMs).toISOString() : null;
}
