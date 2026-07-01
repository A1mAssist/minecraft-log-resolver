import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { cleanChatMessage, parseChatEvent } from "../src/parser/chatRules.mjs";
import { discoverLogFiles, discoverScopes } from "../src/parser/discovery.mjs";
import { ensureServerContext } from "../src/parser/serverContext.mjs";

const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "labeling");
const prefix = readOption("--prefix") ?? "server-unknown-current";
const limit = readPositiveIntOption("--limit", 500);
const selectedModes = new Set(readRepeatedOption("--mode"));
const selectedRoots = readRepeatedOption("--root");
const roots = selectedRoots.length ? selectedRoots : config.roots;
const includeRounds = !hasFlag("--activity-only");
const includeActivity = !hasFlag("--rounds-only");
const beforeMs = Number(readOption("--before-ms") ?? 0);
const afterMs = Number(readOption("--after-ms") ?? 120_000);
const contextLinesLimit = Number(readOption("--context-lines") ?? 80);
const displayEncoding = readOption("--display-encoding") ?? "utf-8";
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const rows = [];

if (includeRounds) {
  for (const round of report.rounds?.reliable ?? []) {
    const server = ensureServerContext(round);
    if (!isUnknownServer(server)) continue;
    rows.push(buildRow(round, server, "round"));
  }
}

if (includeActivity) {
  for (const segment of report.activity?.segments ?? []) {
    const server = ensureServerContext(segment);
    if (!isUnknownServer(server)) continue;
    rows.push(buildRow(segment, server, "activity"));
  }
}

const filteredRows = rows
  .filter((row) => !selectedModes.size || selectedModes.has(row.mode))
  .sort((a, b) => a.mode.localeCompare(b.mode) || a.serverLabel.localeCompare(b.serverLabel) || a.startMs - b.startMs || a.lineNo - b.lineNo)
  .slice(0, limit)
  .map((row, index) => ({ ...row, id: `server-unknown:${String(index + 1).padStart(4, "0")}` }));

let contextState = null;
if (displayEncoding) {
  const chatLinesResult = await collectChatLines(roots, {
    encoding: config.encoding,
    cachePath: chatLinesCachePath,
  });
  contextState = {
    linesByFile: groupBy(
      chatLinesResult.lines.filter((line) => line.message && !isClientNoise(line.message)),
      (line) => line.filePath,
    ),
  };
  for (const row of filteredRows) {
    row.contextLines = contextLinesForRow(row, contextState);
    row.contextLineCount = row.contextLines.length;
  }
}

const json = {
  schema: {
    name: "minecraft-log-observatory-server-unknown-export",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt ?? null,
  filters: {
    mode: selectedModes.size ? [...selectedModes].sort() : "all",
    includeRounds,
    includeActivity,
    limit,
    beforeMs,
    afterMs,
    contextLinesLimit,
    displayEncoding,
  },
  totals: {
    sourceUnknownRows: rows.length,
    exported: filteredRows.length,
    byKind: countBy(filteredRows, (row) => row.kind),
    byMode: countBy(filteredRows, (row) => row.mode),
    byLabel: countBy(filteredRows, (row) => row.serverLabel),
  },
  rows: filteredRows,
};

await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${prefix}.json`);
const jsonlPath = path.join(outDir, `${prefix}.jsonl`);
const csvPath = path.join(outDir, `${prefix}.csv`);
const mdPath = path.join(outDir, `${prefix}.md`);
await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
await writeFile(jsonlPath, `${filteredRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(csvPath, renderCsv(filteredRows), "utf8");
await writeFile(mdPath, renderMarkdown(filteredRows), "utf8");

console.log(JSON.stringify({
  reportPath,
  jsonPath,
  jsonlPath,
  csvPath,
  mdPath,
  exported: filteredRows.length,
  totals: json.totals,
}, null, 2));

function buildRow(item, server, kind) {
  return {
    kind,
    mode: item.gameMode ?? item.mode ?? item.activityMode ?? "unknown",
    source: item.source ?? null,
    scope: item.scope ?? null,
    sessionAlias: item.sessionAlias ?? item.localUser ?? null,
    startMs: item.startMs ?? null,
    endMs: item.endMs ?? null,
    durationSeconds: item.durationSeconds ?? 0,
    lineNo: item.lineNo ?? null,
    filePath: item.filePath ?? null,
    serverNetwork: server.serverNetwork,
    serverAddress: server.serverAddress,
    serverLabel: server.serverLabel,
    serverConfidence: server.serverConfidence,
    serverEvidence: server.serverEvidence,
    result: item.result ?? null,
    resultHint: item.resultHint ?? null,
  };
}

function isUnknownServer(server) {
  return server?.serverLabel === "未知服务器" || server?.serverLabel === "本地代理 / 未知服务器" || server?.serverConfidence === "unknown";
}

function contextLinesForRow(row, context) {
  const fileLines = context.linesByFile.get(row.filePath) ?? [];
  if (!fileLines.length) return [];

  const startMs = row.startMs ?? 0;
  const boundaryMs = row.endMs ?? row.lastEventMs ?? startMs;
  const windowStartMs = Math.max(0, startMs - beforeMs);
  const windowEndMs = boundaryMs + afterMs;
  const inWindow = fileLines
    .filter((line) => line.timestampMs >= windowStartMs && line.timestampMs <= windowEndMs)
    .map((line) => annotateContextLine(line, startMs, boundaryMs));

  const selected = new Map();
  for (const line of inWindow.filter((line) => line.position === "in_round").slice(0, 10)) selected.set(line.lineNo, line);
  for (const line of inWindow.filter((line) => line.position === "in_round").slice(-14)) selected.set(line.lineNo, line);
  for (const line of inWindow.filter(isImportantContextLine)) selected.set(line.lineNo, line);
  for (const line of inWindow.filter((line) => line.position === "after_boundary").slice(0, 14)) selected.set(line.lineNo, line);
  for (const line of inWindow.filter((line) => line.position === "before_round").slice(-6)) selected.set(line.lineNo, line);

  return [...selected.values()]
    .sort((a, b) => a.lineNo - b.lineNo)
    .slice(0, Math.max(0, contextLinesLimit));
}

function annotateContextLine(line, startMs, boundaryMs) {
  const event = parseChatEvent(line.message, {
    ruleSets: config.rules.length ? config.rules : null,
    customRulePaths: config.customRules.map((value) => resolveConfigPath(configContext, value)),
  });
  const text = cleanChatMessage(line.message);
  return {
    lineNo: line.lineNo,
    timeText: line.timeText,
    timestampMs: line.timestampMs,
    position: line.timestampMs < startMs ? "before_round" : line.timestampMs > boundaryMs ? "after_boundary" : "in_round",
    text,
    resultLike: looksLikeResultSignal(text),
    matchedEvent: event ? {
      type: event.type,
      ruleSet: event.ruleSet,
      ruleId: event.ruleId,
      payload: event.payload,
    } : null,
  };
}

function renderMarkdown(rows) {
  const lines = [
    "# Server Unknowns",
    "",
    "以下条目在当前 report 里仍然无法稳定识别 serverLabel/serverNetwork。",
    "",
  ];

  for (const row of rows) {
    lines.push(
      `## ${row.id}`,
      "",
      `- kind: ${row.kind}`,
      `- mode: ${row.mode}`,
      `- source/scope: ${row.source ?? "unknown"} / ${row.scope ?? "unknown"}`,
      `- time: ${row.startMs ?? "unknown"} -> ${row.endMs ?? "unknown"}`,
      `- server: ${row.serverLabel ?? "Unknown server"}${row.serverAddress ? ` (${row.serverAddress})` : ""}, confidence=${row.serverConfidence ?? "unknown"}`,
      `- result: ${row.result ?? "unknown"}`,
      "",
    );
    if (Array.isArray(row.contextLines) && row.contextLines.length) {
      lines.push("```text");
      for (const line of row.contextLines) {
        const rule = line.matchedEvent ? ` [${line.matchedEvent.ruleSet}:${line.matchedEvent.ruleId}]` : "";
        lines.push(`${line.position === "in_round" ? "*" : " "} L${String(line.lineNo).padStart(6, " ")} ${line.timeText ?? ""} ${line.text}${rule}`);
      }
      lines.push("```", "");
    }
  }

  return `${lines.join("\n")}\n`;
}

function looksLikeResultSignal(message) {
  return /victory|defeat|winner|winners|winning team|you won|you lost|you lose|game over|placed #|you placed|you died|you survived|survivors|seekers|hiders|murderer|innocents|draw|tie|鑳滃埄|澶辫触|鑾疯儨|璧㈠|璧簡|杈撲簡|鎴樿触|娓告垙缁撴潫|鎺掑悕|绗?/i.test(message);
}

function isImportantContextLine(line) {
  return line.resultLike || line.matchedEvent?.type || line.position !== "in_round";
}

function isClientNoise(message) {
  return /^\s*$/.test(String(message ?? ""));
}

function groupBy(rows, fn) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const key = fn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function renderCsv(rows) {
  const headers = ["kind", "mode", "source", "scope", "sessionAlias", "startMs", "endMs", "durationSeconds", "lineNo", "filePath", "serverLabel", "serverAddress", "serverConfidence", "result", "resultHintReason"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(readField(row, header))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function readField(row, field) {
  if (field === "resultHintReason") return row.resultHint?.reason ?? "";
  return row[field] ?? "";
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function countBy(rows, fn) {
  const counts = new Map();
  for (const row of rows) counts.set(fn(row), (counts.get(fn(row)) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function readRepeatedOption(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (value && !String(value).startsWith("--")) values.push(value);
  }
  return values;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readPositiveIntOption(name, fallback) {
  const value = Number(readOption(name) ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
