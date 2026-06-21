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
const prefix = readOption("--prefix") ?? "unknown-result-by-hint-current";
const perGroup = Number(readOption("--per-group") ?? 8);
const beforeMs = Number(readOption("--before-ms") ?? 30_000);
const afterMs = Number(readOption("--after-ms") ?? 180_000);
const selectedHints = new Set(readRepeatedOption("--hint"));
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
  .filter((round) => !selectedHints.size || selectedHints.has(readHintValue(round)))
  .filter((round) => !selectedHintReasons.size || selectedHintReasons.has(readHintReason(round)))
  .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo);
const byHint = groupBy(unknownRounds, readHintValue);
const hintGroups = [...byHint.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const allRows = [];
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt,
  reportPath,
  selectedHints: selectedHints.size ? [...selectedHints].sort() : "all",
  selectedHintReasons: selectedHintReasons.size ? [...selectedHintReasons].sort() : "all",
  perGroup,
  groups: {},
  reasonGroups: {},
  files: {},
  chatCache: {
    files: chatLinesResult.totals.files,
    hits: chatLinesResult.totals.cacheHits,
    misses: chatLinesResult.totals.cacheMisses,
  },
};

await mkdir(outDir, { recursive: true });

for (const [hint, rounds] of hintGroups) {
  const rows = pickSamples(rounds, perGroup).map((round, index) => buildRow(round, hint, index));
  allRows.push(...rows);
  manifest.groups[hint] = rounds.length;
  manifest.files[hint] = {
    markdown: `${prefix}-${safeName(hint)}.md`,
    json: `${prefix}-${safeName(hint)}.json`,
  };

  await writeFile(path.join(outDir, manifest.files[hint].markdown), renderHintMarkdown(hint, rounds.length, rows), "utf8");
  await writeFile(path.join(outDir, manifest.files[hint].json), JSON.stringify({
    generatedAt: manifest.generatedAt,
    sourceReportGeneratedAt: report.generatedAt,
    hint,
    total: rounds.length,
    samples: rows.length,
    rows,
  }, null, 2), "utf8");
}

const mdPath = path.join(outDir, `${prefix}.md`);
const jsonPath = path.join(outDir, `${prefix}.json`);
manifest.reasonGroups = countBy(unknownRounds, readHintReason);
await writeFile(mdPath, renderIndexMarkdown(manifest, allRows), "utf8");
await writeFile(jsonPath, JSON.stringify({ ...manifest, rows: allRows }, null, 2), "utf8");

console.log(JSON.stringify({
  reportPath,
  mdPath,
  jsonPath,
  samples: allRows.length,
  groups: manifest.groups,
  files: manifest.files,
  chatCache: `${chatLinesResult.totals.cacheHits}/${chatLinesResult.totals.files}`,
}, null, 2));

function buildRow(round, hint, index) {
  const identity = readIdentity(round);
  const row = {
    id: `${hint}:${String(index + 1).padStart(2, "0")}`,
    hint: round.resultHint ?? { value: hint },
    round: summarizeRound(round, identity),
    keyLines: contextForRound(round, identity.serverPlayerId),
  };
  return row;
}

function renderIndexMarkdown(index, rows) {
  const lines = [
    "# Unknown Result Samples By Hint",
    "",
    `Source report generatedAt: ${index.sourceReportGeneratedAt}`,
    `Chat cache: ${index.chatCache.hits}/${index.chatCache.files}`,
    "",
    "This export is diagnostic only. Hints do not change official win/loss totals.",
    "",
    "## Reason Groups",
    "",
  ];

  for (const [reason, count] of Object.entries(index.reasonGroups)) {
    lines.push(`- ${reason}: ${count} rounds`);
  }

  lines.push(
    "",
    "## Groups",
    "",
  );

  for (const [hint, count] of Object.entries(index.groups)) {
    const files = index.files[hint];
    lines.push(`- ${hint}: ${count} rounds, samples in \`${files.markdown}\``);
  }

  lines.push("", "## Sample Index", "");
  for (const row of rows) {
    lines.push(`- ${row.id}: ${row.round.gameMode}, ${row.round.startAt}, ${row.round.source} / ${row.round.scope}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderHintMarkdown(hint, total, rows) {
  const lines = [
    `# Unknown Result Hint: ${hint}`,
    "",
    `Source report generatedAt: ${report.generatedAt}`,
    `Total matching reliable unknown rounds: ${total}`,
    `Samples: ${rows.length}`,
    "",
    "Legend: `*` result-like line from the unknown round, `A` after-boundary context line (not part of this round).",
    "",
  ];

  for (const row of rows) {
    lines.push(...renderRow(row), "");
  }
  return lines.join("\n");
}

function renderRow(row) {
  const round = row.round;
  const lines = [
    `## ${row.id} ${round.gameMode} ${round.durationSeconds}s`,
    `- hint: ${row.hint.value} / ${row.hint.confidence ?? "unknown"} / ${row.hint.reason ?? "unknown"}`,
    `- time: ${round.startAt} -> ${round.endAt}`,
    `- source/scope: ${round.source} / ${round.scope}`,
    `- session alias: ${round.sessionAlias ?? "unknown"}; launcher user: ${round.launcherUser ?? round.sessionAlias ?? "unknown"}; server player id: ${round.serverPlayerId ?? "unknown"} (${round.serverPlayerIdConfidence}, ${round.serverPlayerIdSource}); server ids: ${formatAliasCounts(round.serverPlayerIds)}`,
    `- boundary: ${round.startReason} -> ${round.endReason}`,
    `- owner: team=${round.ownerTeam ?? "unknown"}, bedDestroyed=${round.ownerBedDestroyed}, teamEliminated=${round.ownerTeamEliminated}, finalDeaths=${round.ownFinalDeaths}`,
    `- stats: kills=${round.kills}, deaths=${round.deaths}, beds=${round.bedDestroys}, selfKills=${round.selfKills}, selfDeaths=${round.selfDeaths}, selfDeathSignals=${round.selfDeathSignals ?? 0}, selfBeds=${round.selfBedDestroys}`,
    `- teams: eliminated=${JSON.stringify(round.teamEliminations)}, beds=${JSON.stringify(round.bedDestroyedTeams)}`,
    `- resultEvidence: ${round.resultEvidence.length ? JSON.stringify(round.resultEvidence) : "none"}`,
    `- file: ${round.filePath}`,
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

function summarizeRound(round, identity = readIdentity(round)) {
  return {
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
    gameMode: round.gameMode,
    startAt: round.startAt,
    endAt: round.endAt,
    startMs: round.startMs,
    endMs: round.endMs,
    durationSeconds: round.durationSeconds,
    duration: round.duration,
    confidence: round.confidence,
    result: round.result,
    resultReason: round.resultReason,
    resultHint: round.resultHint ?? null,
    startReason: round.startReason,
    endReason: round.endReason,
    ownerTeam: round.ownerTeam ?? null,
    ownerBedDestroyed: round.ownerBedDestroyed ?? false,
    ownerTeamEliminated: round.ownerTeamEliminated ?? false,
    ownFinalDeaths: round.ownFinalDeaths ?? 0,
    punishedExit: round.punishedExit ?? null,
    kills: round.kills,
    deaths: round.deaths,
    bedDestroys: round.bedDestroys,
    selfKills: round.selfKills,
    selfDeaths: round.selfDeaths,
    selfDeathSignals: round.selfDeathSignals ?? 0,
    selfBedDestroys: round.selfBedDestroys,
    teamEliminations: round.teamEliminations ?? {},
    bedDestroyedTeams: round.bedDestroyedTeams ?? {},
    punishedPlayers: round.punishedPlayers ?? {},
    resultEvidence: round.resultEvidence ?? [],
    boundaryEvents: round.boundaryEvents ?? [],
    filePath: round.filePath,
    lineNo: round.lineNo,
  };
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
  for (const line of inRound.slice(0, 10)) selected.set(line.lineNo, line);
  for (const line of inRound.slice(-14)) selected.set(line.lineNo, line);
  for (const line of annotated) {
    if (isImportantLine(line, boundaryMs)) selected.set(line.lineNo, line);
  }
  for (const line of annotated.filter((line) => line.timestampMs > boundaryMs).slice(0, 14)) {
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

function readHintValue(round) {
  return round.resultHint?.value ?? "missing_hint";
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

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "unknown";
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
