import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { cleanChatMessage, isClientModNoiseMessage, parseChatEvent } from "../src/parser/chatRules.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { normalizePlayerDisplayName, resolveServerPlayerIdentity } from "../src/report/playerIdentity.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "labeling");
const prefix = readOption("--prefix") ?? "unknown-result-by-end-5-current";
const perGroup = Number(readOption("--per-group") ?? 5);
const beforeMs = Number(readOption("--before-ms") ?? 30_000);
const afterMs = Number(readOption("--after-ms") ?? 120_000);
const selectedHintReasons = new Set(readRepeatedOption("--hint-reason"));
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);
const customRulePaths = (config.customRules ?? []).map((value) => resolveConfigPath(configContext, value));

const report = JSON.parse(await readFile(reportPath, "utf8"));
const chatLinesResult = await collectChatLines(config.roots, {
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});
const reviewLines = chatLinesResult.lines.filter((line) => !isClientModNoiseMessage(line.message));
const linesByFile = groupBy(reviewLines, (line) => line.filePath);

const unknownRounds = (report.rounds?.reliable ?? [])
  .filter((round) => round.result === "unknown")
  .filter((round) => !selectedHintReasons.size || selectedHintReasons.has(readHintReason(round)))
  .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo);
const byEndReason = groupBy(unknownRounds, (round) => round.endReason ?? "unknown");
const endGroups = [...byEndReason.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const rows = [];
const markdown = [
  "# Unknown Result Samples By End Reason",
  "",
  `Source report generatedAt: ${report.generatedAt}`,
  `Chat cache: ${chatLinesResult.totals.cacheHits}/${chatLinesResult.totals.files}`,
  `Selected hint reasons: ${selectedHintReasons.size ? [...selectedHintReasons].sort().join(", ") : "all"}`,
  "",
  `Each endReason has up to ${perGroup} reliable unknown-result round samples. Samples prioritize self/team/objective/result-like evidence for manual review.`,
  "Legend: `*` result-like line from the unknown round, `A` after-boundary context line (not part of this round).",
  "",
];

for (const [endReason, rounds] of endGroups) {
  markdown.push(`## ${endReason} (${rounds.length})`, "");
  for (const [index, round] of pickSamples(rounds, perGroup).entries()) {
    const row = buildRow(round, endReason, index);
    rows.push(row);
    markdown.push(...renderRow(row), "");
  }
}

await mkdir(outDir, { recursive: true });
const mdPath = path.join(outDir, `${prefix}.md`);
const jsonPath = path.join(outDir, `${prefix}.json`);
await writeFile(mdPath, markdown.join("\n"), "utf8");
await writeFile(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt,
  selectedHintReasons: selectedHintReasons.size ? [...selectedHintReasons].sort() : "all",
  totals: Object.fromEntries(endGroups.map(([key, value]) => [key, value.length])),
  byHintReason: countBy(unknownRounds, readHintReason),
  rows,
}, null, 2), "utf8");

console.log(JSON.stringify({
  reportPath,
  mdPath,
  jsonPath,
  samples: rows.length,
  groups: Object.fromEntries(endGroups.map(([key, value]) => [key, value.length])),
  byHintReason: countBy(unknownRounds, readHintReason),
  chatCache: `${chatLinesResult.totals.cacheHits}/${chatLinesResult.totals.files}`,
}, null, 2));

function buildRow(round, endReason, index) {
  const identity = readIdentity(round);
  return {
    id: `${endReason}:${String(index + 1).padStart(2, "0")}`,
    key: round.key,
    source: round.source,
    scope: round.scope,
    sessionAlias: round.sessionAlias ?? round.localUser ?? null,
    launcherUser: identity.launcherUser,
    serverPlayerId: identity.serverPlayerId,
    serverPlayerIds: identity.serverPlayerIds,
    serverPlayerIdSource: identity.serverPlayerIdSource,
    serverPlayerIdConfidence: identity.serverPlayerIdConfidence,
    serverIdentityContext: identity.serverIdentityContext,
    ownerAliasesUsed: round.ownerAliasesUsed ?? {},
    mode: round.gameMode,
    startAt: round.startAt,
    endAt: round.endAt,
    durationSeconds: round.durationSeconds,
    startReason: round.startReason,
    endReason: round.endReason,
    resultHint: round.resultHint ?? null,
    stats: {
      kills: round.kills,
      deaths: round.deaths,
      bedDestroys: round.bedDestroys,
      selfKills: round.selfKills,
      selfDeaths: round.selfDeaths,
      selfDeathSignals: round.selfDeathSignals ?? 0,
      selfBedDestroys: round.selfBedDestroys,
    },
    evidence: summarizeEvidence(round),
    filePath: round.filePath,
    lineNo: round.lineNo,
    keyLines: contextForRound(round, identity.serverPlayerId),
  };
}

function renderRow(row) {
  const lines = [
    `### ${row.id} ${row.mode} ${row.durationSeconds}s`,
    `- time: ${row.startAt} -> ${row.endAt}`,
    `- source/scope: ${row.source} / ${row.scope}`,
    `- session alias: ${row.sessionAlias ?? "unknown"}; launcher user: ${row.launcherUser ?? row.sessionAlias ?? "unknown"}; server player id: ${row.serverPlayerId ?? "unknown"} (${row.serverPlayerIdConfidence}, ${row.serverPlayerIdSource}); server ids: ${formatAliasCounts(row.serverPlayerIds)}`,
    `- boundary: ${row.startReason} -> ${row.endReason}`,
    `- resultHint: ${row.resultHint?.value ?? "unknown"} / ${row.resultHint?.confidence ?? "unknown"} / ${row.resultHint?.reason ?? "unknown"}`,
    `- stats: kills=${row.stats.kills}, deaths=${row.stats.deaths}, beds=${row.stats.bedDestroys}, selfKills=${row.stats.selfKills}, selfDeaths=${row.stats.selfDeaths}, selfDeathSignals=${row.stats.selfDeathSignals ?? 0}, selfBeds=${row.stats.selfBedDestroys}`,
    `- evidence: ${row.evidence}`,
    `- file: ${row.filePath}`,
    "",
    "```text",
  ];
  for (const line of row.keyLines) {
    const marker = line.afterBoundary ? "A" : (isActionableResultLine(line) ? "*" : " ");
    const rule = line.event ? ` [${line.event.rule}]` : "";
    lines.push(`${marker} L${String(line.lineNo).padStart(7, " ")} ${line.timeText ?? ""} ${line.text}${rule}`);
  }
  lines.push("```");
  return lines;
}

function pickSamples(rounds, limit) {
  return [...rounds]
    .sort((a, b) => sampleScore(b) - sampleScore(a) || (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0) || a.startMs - b.startMs)
    .slice(0, limit);
}

function sampleScore(round) {
  let value = 0;
  if (round.selfBedDestroys) value += 80;
  if (round.selfKills) value += 60;
  if (round.selfDeaths) value += 60;
  if (round.selfDeathSignals) value += 50;
  if (round.ownerTeam) value += 40;
  if (round.ownerBedDestroyed) value += 40;
  if (Object.keys(round.teamEliminations ?? {}).length) value += 30;
  if (Object.keys(round.bedDestroyedTeams ?? {}).length) value += 25;
  if (round.resultEvidence?.length) value += 20;
  if (round.kills || round.deaths || round.bedDestroys) value += 15;
  return value + Math.min(round.durationSeconds ?? 0, 1200) / 100;
}

function contextForRound(round, serverPlayerId = null) {
  const fileLines = linesByFile.get(round.filePath) ?? [];
  const startMs = round.startMs ?? 0;
  const boundaryMs = round.endMs ?? round.lastEventMs ?? startMs;
  const annotated = fileLines
    .filter((line) => line.timestampMs >= Math.max(0, startMs - beforeMs) && line.timestampMs <= boundaryMs + afterMs)
    .map((line) => annotateLine(line, serverPlayerId));

  const selected = new Map();
  const inRound = annotated.filter((line) => line.timestampMs >= startMs && line.timestampMs <= boundaryMs);
  for (const line of inRound.slice(0, 8)) selected.set(line.lineNo, line);
  for (const line of inRound.slice(-12)) selected.set(line.lineNo, line);
  for (const line of annotated) {
    if (isImportantLine(line, boundaryMs)) selected.set(line.lineNo, line);
  }
  for (const line of annotated.filter((line) => line.timestampMs > boundaryMs).slice(0, 12)) {
    selected.set(line.lineNo, { ...line, afterBoundary: true });
  }
  return [...selected.values()].sort((a, b) => a.lineNo - b.lineNo);
}

function annotateLine(line, serverPlayerId = null) {
  const event = parseChatEvent(line.message, {
    ruleSets: config.rules.length ? config.rules : null,
    customRulePaths,
  });
  const ignoredWinnerOnMap = isIgnoredWinnerOnMapEvent(event, serverPlayerId);
  return {
    lineNo: line.lineNo,
    timeText: line.timeText,
    timestampMs: line.timestampMs,
    text: cleanChatMessage(line.message),
    event: event ? {
      type: event.type,
      rule: `${event.ruleSet}:${event.ruleId}`,
      payload: event.payload,
    } : null,
    resultLike: !ignoredWinnerOnMap && looksLikeResultSignal(line.message),
    ignoredWinnerOnMap,
  };
}

function isImportantLine(line, boundaryMs) {
  if (line.timestampMs > boundaryMs) return false;
  if (line.ignoredWinnerOnMap) return false;
  if (line.resultLike) return true;
  return [
    "win",
    "loss",
    "round_end",
    "team_eliminated",
    "bed_destroy",
    "player_punished",
    "round_start",
    "round_countdown",
    "game_mode",
    "server_connect",
  ].includes(line.event?.type);
}

function summarizeEvidence(round) {
  const evidence = [];
  if (round.ownerTeam) evidence.push(`ownerTeam=${round.ownerTeam}`);
  if (round.ownerBedDestroyed) evidence.push("ownerBedDestroyed=true");
  if (round.ownFinalDeaths) evidence.push(`ownFinalDeaths=${round.ownFinalDeaths}`);
  if (Object.keys(round.teamEliminations ?? {}).length) evidence.push(`teamEliminations=${JSON.stringify(round.teamEliminations)}`);
  if (Object.keys(round.bedDestroyedTeams ?? {}).length) evidence.push(`bedDestroyedTeams=${JSON.stringify(round.bedDestroyedTeams)}`);
  if (round.resultEvidence?.length) evidence.push(`resultEvidence=${round.resultEvidence.map((item) => item.kind ?? item.type ?? "evidence").join(",")}`);
  return evidence.length ? evidence.join("; ") : "none";
}

function looksLikeResultSignal(message) {
  const text = cleanChatMessage(message).toLowerCase();
  if (/victory|defeat|winner|winners|winning team|you won|you lost|game over|placed #/.test(text)) return true;
  return [
    "\u80dc\u5229",
    "\u83b7\u80dc",
    "\u5931\u8d25",
    "\u8f93\u4e86",
    "\u8d62\u4e86",
    "\u53d6\u5f97\u4e86\u4e00\u573a\u6e38\u620f\u7684\u80dc\u5229",
    "\u83b7\u5f97\u80dc\u5229",
  ].some((needle) => text.includes(needle));
}

function isActionableResultLine(line) {
  if (line.ignoredWinnerOnMap) return false;
  return line.resultLike || ["win", "loss", "round_end"].includes(line.event?.type);
}

function isIgnoredWinnerOnMapEvent(event, serverPlayerId) {
  if (event?.ruleSet !== "game-state" || event?.ruleId !== "zh_player_won_on_map") return false;
  return !sameNormalizedPlayer(event.payload?.winner, serverPlayerId);
}

function sameNormalizedPlayer(left, right) {
  const normalizedLeft = normalizePlayerDisplayName(left)?.toLowerCase() ?? null;
  const normalizedRight = normalizePlayerDisplayName(right)?.toLowerCase() ?? null;
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function readHintReason(round) {
  return round.resultHint?.reason ?? "unknown";
}

function formatAliasCounts(counts) {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => count > 0);
  return entries.length ? entries.map(([name, count]) => `${name} x${count}`).join(", ") : "none";
}

function readIdentity(round) {
  if ("serverPlayerId" in round) {
    return {
      launcherUser: round.launcherUser ?? round.localUser ?? round.sessionAlias ?? null,
      serverPlayerId: round.serverPlayerId ?? null,
      serverPlayerIds: round.serverPlayerIds ?? {},
      serverPlayerIdSource: round.serverPlayerIdSource ?? "unknown",
      serverPlayerIdConfidence: round.serverPlayerIdConfidence ?? "unknown",
      serverIdentityContext: round.serverIdentityContext ?? "unknown",
    };
  }
  return resolveServerPlayerIdentity(round);
}
