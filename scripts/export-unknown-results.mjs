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
const prefix = readOption("--prefix") ?? "unknown-result-rounds";
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "labeling");
const limit = Number(readOption("--limit") ?? 200);
const contextAfterMs = Number(readOption("--after-ms") ?? 20_000);
const edgeLinesPerRound = Number(readOption("--edge-lines") ?? 40);
const afterLinesLimit = Number(readOption("--after-lines") ?? 20);
const selectedModes = new Set(readRepeatedOption("--mode"));
const selectedHintReasons = new Set(readRepeatedOption("--hint-reason"));
const selectedRoots = readRepeatedOption("--root");
const roots = selectedRoots.length ? selectedRoots : config.roots;
const customRuleValues = readRepeatedOption("--custom-rule");
const customRulePaths = (customRuleValues.length ? customRuleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const rounds = (report.rounds?.reliable ?? [])
  .filter((round) => round.result === "unknown")
  .filter((round) => !selectedModes.size || selectedModes.has(round.gameMode))
  .filter((round) => !selectedHintReasons.size || selectedHintReasons.has(readHintReason(round)))
  .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo)
  .slice(0, limit);

const chatLinesResult = await collectChatLines(roots, {
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});

const reviewLines = chatLinesResult.lines.filter((line) => !isClientModNoiseMessage(line.message));
const linesByFile = groupBy(reviewLines, (line) => line.filePath);
const rows = rounds.map((round, index) => buildRow(round, index));
const jsonPath = path.join(outDir, `${prefix}.json`);
const jsonlPath = path.join(outDir, `${prefix}.jsonl`);
const mdPath = path.join(outDir, `${prefix}.md`);

await mkdir(outDir, { recursive: true });
await writeFile(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  selectedHintReasons: selectedHintReasons.size ? [...selectedHintReasons].sort() : "all",
  totals: buildTotals(rows),
  rows,
}, null, 2), "utf8");
await writeFile(jsonlPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
await writeFile(mdPath, renderMarkdown(rows), "utf8");

console.log(JSON.stringify({
  reportPath,
  jsonPath,
  jsonlPath,
  mdPath,
  exported: rows.length,
  totals: buildTotals(rows),
  selectedHintReasons: selectedHintReasons.size ? [...selectedHintReasons].sort() : "all",
  chatCache: `${chatLinesResult.totals.cacheHits}/${chatLinesResult.totals.files}`,
}, null, 2));

function buildRow(round, index) {
  const identity = readIdentity(round);
  const fileLines = linesByFile.get(round.filePath) ?? [];
  const startMs = round.startMs ?? 0;
  const boundaryMs = round.endMs ?? round.lastEventMs ?? startMs;
  const windowEndMs = boundaryMs + contextAfterMs;
  const inWindow = fileLines.filter((line) => line.timestampMs >= startMs && line.timestampMs <= windowEndMs);
  const annotatedWindow = inWindow.map((line) => annotateLine(line, identity.serverPlayerId));
  const roundLines = annotatedWindow.filter((line) => isRoundLine(line, round, boundaryMs));
  const afterLines = annotatedWindow.filter((line) => !isRoundLine(line, round, boundaryMs));

  return {
    id: `unknown-result:${String(index + 1).padStart(3, "0")}`,
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
    resultHint: round.resultHint ?? null,
    kills: round.kills,
    deaths: round.deaths,
    bedDestroys: round.bedDestroys,
    selfKills: round.selfKills,
    selfDeaths: round.selfDeaths,
    selfBedDestroys: round.selfBedDestroys,
    ownerTeam: round.ownerTeam,
    filePath: round.filePath,
    lineNo: round.lineNo,
    candidateLines: roundLines.filter(isActionableResultLine),
    lines: selectDisplayLines(roundLines),
    afterLines: selectAfterLines(afterLines),
  };
}

function annotateLine(line, serverPlayerId = null) {
  const event = parseChatEvent(line.message, {
    ruleSets: config.rules.length ? config.rules : null,
    customRulePaths,
  });
  const cleaned = cleanChatMessage(line.message);
  const ignoredWinnerOnMap = isIgnoredWinnerOnMapEvent(event, serverPlayerId);
  return {
    timestampMs: line.timestampMs,
    lineNo: line.lineNo,
    timeText: line.timeText,
    text: cleaned,
    resultLike: !ignoredWinnerOnMap && looksLikeResultSignal(cleaned),
    ignoredWinnerOnMap,
    matchedEvent: event ? {
      type: event.type,
      rule: `${event.ruleSet}:${event.ruleId}`,
      payload: event.payload,
    } : null,
  };
}

function looksLikeResultSignal(message) {
  return /victory|defeat|winner|winners|winning team|you won|you lost|you lose|game over|placed #|you placed|you died|you survived|survivors|seekers|hiders|murderer|innocents|draw|tie|胜利|失败|获胜|赢家|赢了|输了|战败|游戏结束|排名|第\s*\d+\s*名|鑳滃埄|澶辫触|鑾疯儨|鑳滆€厊璧㈠|璧簡|杈撲簡|鎴樿触|娓告垙缁撴潫|鎺掑悕|绗\s*\d+\s*鍚?/i.test(message);
}

function buildTotals(rows) {
  return {
    rounds: rows.length,
    byMode: countBy(rows, "gameMode"),
    byEndReason: countBy(rows, "endReason"),
    byHintReason: countBy(rows, (row) => row.resultHint?.reason ?? "unknown"),
    withCandidateLines: rows.filter((row) => row.candidateLines.length > 0).length,
  };
}

function selectDisplayLines(lines) {
  const selected = new Map();
  for (const line of lines.slice(0, edgeLinesPerRound)) selected.set(line.lineNo, line);
  for (const line of lines.slice(-edgeLinesPerRound)) selected.set(line.lineNo, line);
  for (const line of lines.filter(isActionableResultLine)) selected.set(line.lineNo, line);
  return [...selected.values()].sort((a, b) => a.lineNo - b.lineNo);
}

function selectAfterLines(lines) {
  return lines.slice(0, afterLinesLimit);
}

function isActionableResultLine(line) {
  if (line.ignoredWinnerOnMap) return false;
  return line.resultLike || ["win", "loss", "round_end"].includes(line.matchedEvent?.type);
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

function isRoundLine(line, round, boundaryMs) {
  if (line.timestampMs < boundaryMs) return true;
  if (line.timestampMs > boundaryMs) return false;

  if (["next_round", "world_switch", "gap"].includes(round.endReason)) return false;
  return true;
}

function renderMarkdown(rows) {
  const lines = [
    "# Unknown Result Rounds",
    "",
    "这些是可靠局里胜负仍然 unknown 的局。每局保留了 round 时间窗内的聊天行，`candidateLines` 是疑似结算文本。",
    "",
    "标注格式建议：`unknown-result:001 = win/loss/keep-unknown`，也可以补一句原因。",
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.id}`);
    lines.push("");
    lines.push(`- mode: ${row.gameMode}`);
    lines.push(`- source/scope: ${row.source} / ${row.scope}`);
    lines.push(`- session alias: ${row.sessionAlias ?? "unknown"}; launcher user: ${row.launcherUser ?? row.sessionAlias ?? "unknown"}; server player id: ${row.serverPlayerId ?? "unknown"} (${row.serverPlayerIdConfidence}, ${row.serverPlayerIdSource}); server ids: ${formatAliasCounts(row.serverPlayerIds)}`);
    lines.push(`- start/end: ${row.startAt} -> ${row.endAt}`);
    lines.push(`- duration: ${row.durationSeconds}s`);
    lines.push(`- reason: ${row.startReason} -> ${row.endReason}`);
    lines.push(`- resultHint: ${row.resultHint?.value ?? "unknown"} / ${row.resultHint?.confidence ?? "unknown"} / ${row.resultHint?.reason ?? "unknown"}`);
    lines.push(`- stats: kills=${row.kills}, deaths=${row.deaths}, beds=${row.bedDestroys}, selfKills=${row.selfKills}, selfDeaths=${row.selfDeaths}, selfBeds=${row.selfBedDestroys}`);
    lines.push(`- file: ${row.filePath}`);
    lines.push("");
    lines.push("```text");
    for (const line of row.lines) {
      const marker = isActionableResultLine(line) ? "*" : " ";
      const rule = line.matchedEvent ? ` [${line.matchedEvent.rule}]` : "";
      lines.push(`${marker} L${String(line.lineNo).padStart(7, " ")} ${line.timeText ?? ""} ${line.text}${rule}`);
    }
    lines.push("```");
    if (row.afterLines.length) {
      lines.push("");
      lines.push("After boundary context:");
      lines.push("");
      lines.push("```text");
      for (const line of row.afterLines) {
        const rule = line.matchedEvent ? ` [${line.matchedEvent.rule}]` : "";
        lines.push(`  L${String(line.lineNo).padStart(7, " ")} ${line.timeText ?? ""} ${line.text}${rule}`);
      }
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
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

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
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

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = typeof key === "function" ? key(row) : row[key];
    counts[value ?? "unknown"] = (counts[value ?? "unknown"] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function readHintReason(round) {
  return round.resultHint?.reason ?? "unknown";
}
