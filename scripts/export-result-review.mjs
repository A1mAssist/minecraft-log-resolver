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
const prefix = readOption("--prefix") ?? "result-review-current";
const limit = Number(readOption("--limit") ?? 120);
const afterMs = Number(readOption("--after-ms") ?? 120_000);
const selectedModes = new Set(readRepeatedOption("--mode"));
const selectedHintReasons = new Set(readRepeatedOption("--hint-reason"));
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);
const customRulePaths = (config.customRules ?? []).map((value) => resolveConfigPath(configContext, value));

const report = JSON.parse(await readFile(reportPath, "utf8"));
const rounds = (report.rounds?.reliable ?? [])
  .filter((round) => round.result === "unknown")
  .filter((round) => !selectedModes.size || selectedModes.has(round.gameMode))
  .filter((round) => !selectedHintReasons.size || selectedHintReasons.has(readHintReason(round)))
  .sort((a, b) => hintPriority(b) - hintPriority(a) || a.startMs - b.startMs || a.lineNo - b.lineNo)
  .slice(0, limit);

const chatLinesResult = await collectChatLines(config.roots, {
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});

const reviewLines = chatLinesResult.lines.filter((line) => !isClientModNoiseMessage(line.message));
const linesByFile = groupBy(reviewLines, (line) => line.filePath);
const rows = rounds.map((round, index) => buildReviewRow(round, index));

await mkdir(outDir, { recursive: true });
const txtPath = path.join(outDir, `${prefix}.txt`);
const jsonPath = path.join(outDir, `${prefix}.json`);
await writeFile(txtPath, renderText(rows), "utf8");
await writeFile(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  selectedHintReasons: selectedHintReasons.size ? [...selectedHintReasons].sort() : "all",
  totals: buildTotals(rows),
  rows,
}, null, 2), "utf8");

console.log(JSON.stringify({
  reportPath,
  txtPath,
  jsonPath,
  exported: rows.length,
  totals: buildTotals(rows),
  chatCache: `${chatLinesResult.totals.cacheHits}/${chatLinesResult.totals.files}`,
}, null, 2));

function buildReviewRow(round, index) {
  const identity = readIdentity(round);
  const fileLines = linesByFile.get(round.filePath) ?? [];
  const startMs = round.startMs ?? 0;
  const endMs = round.endMs ?? round.lastEventMs ?? startMs;
  const windowEndMs = endMs + afterMs;
  const annotated = fileLines
    .filter((line) => line.timestampMs >= startMs && line.timestampMs <= windowEndMs)
    .map((line) => annotateLine(line, identity.serverPlayerId));
  const important = selectImportantLines(annotated, endMs);
  const hint = guessResult(round, important);

  return {
    id: `review:${String(index + 1).padStart(3, "0")}`,
    hint,
    hintReason: readHintReason(round),
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
    durationSeconds: round.durationSeconds,
    startReason: round.startReason,
    endReason: round.endReason,
    ownerTeam: round.ownerTeam,
    stats: {
      kills: round.kills,
      deaths: round.deaths,
      bedDestroys: round.bedDestroys,
      selfKills: round.selfKills,
      selfDeaths: round.selfDeaths,
      selfBedDestroys: round.selfBedDestroys,
    },
    teams: {
      eliminated: round.teamEliminations ?? {},
      bedsDestroyed: round.bedDestroyedTeams ?? {},
      ownerBedDestroyed: round.ownerBedDestroyed ?? false,
    },
    filePath: round.filePath,
    lineNo: round.lineNo,
    keyLines: important,
  };
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

function selectImportantLines(lines, endMs) {
  const selected = new Map();
  for (const line of lines.slice(0, 8)) selected.set(line.lineNo, line);
  for (const line of lines.filter((line) => line.timestampMs <= endMs).slice(-12)) selected.set(line.lineNo, line);
  for (const line of lines) {
    if (isImportantLine(line, endMs)) selected.set(line.lineNo, line);
  }
  for (const line of lines.filter((line) => line.timestampMs > endMs).slice(0, 12)) {
    selected.set(line.lineNo, { ...line, afterBoundary: true });
  }
  return [...selected.values()].sort((a, b) => a.lineNo - b.lineNo);
}

function isImportantLine(line, endMs) {
  if (line.timestampMs > endMs) return false;
  if (line.ignoredWinnerOnMap) return false;
  if (line.resultLike) return true;
  return ["win", "loss", "round_end", "team_eliminated", "bed_destroy", "player_punished", "round_start", "game_mode"].includes(line.event?.type);
}

function guessResult(round, lines) {
  const resultLines = lines.filter((line) => !line.afterBoundary && !line.ignoredWinnerOnMap && ["win", "loss", "round_end"].includes(line.event?.type));
  if (round.gameMode === "bedwars" && round.ownerTeam && hasCount(round.teamEliminations) && !round.teamEliminations?.[round.ownerTeam]) {
    return { value: "probably_win", confidence: "low", reason: "owner team known and other teams were eliminated" };
  }
  if (round.gameMode === "bedwars" && round.selfDeaths > 0 && ["client_stop", "server_connect", "world_switch", "client_start", "crash"].includes(round.endReason)) {
    return { value: "probably_loss", confidence: "low", reason: "self death followed by leaving boundary" };
  }
  if (round.gameMode === "mega_walls" && round.selfDeaths > 0 && ["client_stop", "server_connect", "world_switch", "last_event"].includes(round.endReason)) {
    return { value: "probably_loss", confidence: "low", reason: "Mega Walls self death followed by leaving boundary" };
  }
  if (resultLines.length) {
    return { value: "review_result_text", confidence: "manual", reason: "result-like text exists but resolver kept unknown" };
  }
  return { value: "keep_unknown", confidence: "none", reason: "no safe result evidence" };
}

function hintPriority(round) {
  if (round.gameMode === "bedwars" && round.selfDeaths > 0) return 40;
  if (round.gameMode === "bedwars" && hasCount(round.teamEliminations)) return 35;
  if (round.gameMode === "mega_walls") return 30;
  if (round.endReason !== "next_round") return 20;
  return 0;
}

function renderText(rows) {
  const lines = [
    "# Result Review",
    "",
    "Legend: `A` marks after-boundary context; it is not part of the reviewed unknown round.",
    "",
    "格式：hint 是机器建议，不计入主统计；key lines 是需要人工看的关键行。",
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.id} ${row.hint.value} (${row.hint.confidence})`);
    lines.push(`- reason: ${row.hint.reason}`);
    lines.push(`- report hint reason: ${row.hintReason}`);
    lines.push(`- mode/source/scope: ${row.gameMode} / ${row.source} / ${row.scope}`);
    lines.push(`- session alias: ${row.sessionAlias ?? "unknown"}; launcher user: ${row.launcherUser ?? row.sessionAlias ?? "unknown"}; server player id: ${row.serverPlayerId ?? "unknown"} (${row.serverPlayerIdConfidence}, ${row.serverPlayerIdSource}); server ids: ${formatAliasCounts(row.serverPlayerIds)}`);
    lines.push(`- time: ${row.startAt} -> ${row.endAt} (${row.durationSeconds}s)`);
    lines.push(`- boundary: ${row.startReason} -> ${row.endReason}`);
    lines.push(`- ownerTeam: ${row.ownerTeam ?? "unknown"}`);
    lines.push(`- stats: kills=${row.stats.kills}, deaths=${row.stats.deaths}, beds=${row.stats.bedDestroys}, selfKills=${row.stats.selfKills}, selfDeaths=${row.stats.selfDeaths}, selfBeds=${row.stats.selfBedDestroys}`);
    lines.push(`- teams: eliminated=${JSON.stringify(row.teams.eliminated)}, beds=${JSON.stringify(row.teams.bedsDestroyed)}, ownerBedDestroyed=${row.teams.ownerBedDestroyed}`);
    lines.push(`- file: ${row.filePath}`);
    lines.push("");
    lines.push("```text");
    for (const line of row.keyLines) {
      const marker = line.afterBoundary ? "A" : (isActionableResultLine(line) ? "*" : " ");
      const rule = line.event ? ` [${line.event.rule}]` : "";
      lines.push(`${marker} L${String(line.lineNo).padStart(7, " ")} ${line.timeText ?? ""} ${line.text}${rule}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function buildTotals(rows) {
  return {
    rows: rows.length,
    byHint: countBy(rows, (row) => row.hint.value),
    byHintReason: countBy(rows, (row) => row.hintReason),
    byMode: countBy(rows, (row) => row.gameMode),
    byEndReason: countBy(rows, (row) => row.endReason),
  };
}

function looksLikeResultSignal(message) {
  return /victory|defeat|winner|winners|winning team|you won|you lost|game over|placed #|胜利|获胜|失败|输了|赢了|取得了一场游戏的胜利|获得胜利/i.test(cleanChatMessage(message));
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

function hasCount(value) {
  return Object.values(value ?? {}).some((count) => count > 0);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
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

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function readHintReason(round) {
  return round.resultHint?.reason ?? "unknown";
}
