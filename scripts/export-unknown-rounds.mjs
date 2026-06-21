import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { readLogLines } from "../src/parser/reader.mjs";

const args = process.argv.slice(2);
const context = await loadAppConfig(readOption("--config") ?? undefined);
const config = context.config;
const reportPath = resolveConfigPath(context, readOption("--report") ?? config.outputs?.report ?? "report-combined.json");
const outDir = resolveMaybeRelative(readOption("--out-dir") ?? "labeling", process.cwd());
const prefix = readOption("--prefix") ?? "unknown-mode-remaining";
const radiusBefore = Number(readOption("--before") ?? 55);
const radiusAfter = Number(readOption("--after") ?? 120);
const encoding = readOption("--encoding") ?? config.encoding;

const report = JSON.parse(await readFile(reportPath, "utf8"));
const reliableKeys = new Set(report.rounds.reliable.map(roundKey));
const rounds = report.rounds.all
  .filter((round) => round.gameMode === "unknown")
  .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo);

const contexts = new Map();
const grouped = new Map();
for (const round of rounds) {
  if (!grouped.has(round.filePath)) grouped.set(round.filePath, []);
  grouped.get(round.filePath).push(round);
  contexts.set(roundKey(round), []);
}

for (const [filePath, fileRounds] of grouped) {
  const ranges = fileRounds.map((round) => ({
    round,
    start: Math.max(1, Number(round.lineNo || 1) - radiusBefore),
    end: Number(round.lineNo || 1) + radiusAfter,
  }));
  await readFileRanges(filePath, ranges, contexts, { encoding });
}

const rows = rounds.map((round, index) => ({
  id: `unknown:${String(index + 1).padStart(3, "0")}`,
  set: reliableKeys.has(roundKey(round)) ? "reliable" : "ignored",
  source: round.source,
  scope: round.scope,
  startAt: new Date(round.startMs).toISOString(),
  endAt: new Date(round.endMs).toISOString(),
  durationSeconds: round.durationSeconds,
  confidence: round.confidence,
  result: round.result,
  startReason: round.startReason,
  endReason: round.endReason,
  stats: {
    kills: round.kills,
    deaths: round.deaths,
    bedDestroys: round.bedDestroys,
    selfKills: round.selfKills,
    selfDeaths: round.selfDeaths,
    selfBedDestroys: round.selfBedDestroys,
    joins: round.joins,
    leaves: round.leaves,
  },
  filePath: round.filePath,
  lineNo: round.lineNo,
  context: contexts.get(roundKey(round)) ?? [],
}));

await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${prefix}.json`);
const jsonlPath = path.join(outDir, `${prefix}.jsonl`);
const mdPath = path.join(outDir, `${prefix}.md`);
await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");
await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(mdPath, renderMarkdown(rows), "utf8");

console.log(JSON.stringify({
  total: rows.length,
  reliable: rows.filter((row) => row.set === "reliable").length,
  ignored: rows.filter((row) => row.set === "ignored").length,
  encoding,
  files: { markdown: mdPath, json: jsonPath, jsonl: jsonlPath },
}, null, 2));

async function readFileRanges(filePath, ranges, contexts, options) {
  if (!filePath) return;
  const maxEnd = Math.max(...ranges.map((range) => range.end));
  const file = {
    path: filePath,
    kind: filePath.endsWith(".gz") ? "gzip" : "text",
  };

  for await (const line of readLogLines(file, { encoding: options.encoding })) {
    if (line.lineNo > maxEnd) break;
    const active = ranges.filter((range) => line.lineNo >= range.start && line.lineNo <= range.end);
    if (!active.length) continue;
    const parsed = parseChatLine(line.text);
    if (!parsed.isChat) continue;
    for (const range of active) {
      contexts.get(roundKey(range.round)).push({
        lineNo: line.lineNo,
        time: parsed.time,
        marker: line.lineNo === range.round.lineNo ? "*" : " ",
        text: parsed.message,
      });
    }
  }
}

function parseChatLine(text) {
  const match = text.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[[^\]]+\]:\s+(?:\[CHAT\]\s*)?(.*)$/);
  if (!match) return { isChat: false, time: null, message: text };
  return { isChat: text.includes("[CHAT]"), time: match[1], message: match[2] ?? "" };
}

function renderMarkdown(rows) {
  const lines = [
    "# Remaining Unknown Mode Rounds",
    "",
    `Generated from ${path.basename(reportPath)} at ${new Date().toISOString()}.`,
    "",
    `Total: ${rows.length}`,
    `Reliable: ${rows.filter((row) => row.set === "reliable").length}`,
    `Ignored: ${rows.filter((row) => row.set === "ignored").length}`,
    "",
    "直接回我编号和判断即可，比如：`unknown:003 = bedwars` 或 `unknown:004 ignore`。",
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.id} [${row.set}] ${row.source} / ${row.scope}`);
    lines.push("");
    lines.push(`- start: ${row.startAt}`);
    lines.push(`- end: ${row.endAt}`);
    lines.push(`- duration: ${formatDuration(row.durationSeconds)}`);
    lines.push(`- confidence: ${row.confidence}`);
    lines.push(`- result: ${row.result}`);
    lines.push(`- reason: ${row.startReason} -> ${row.endReason}`);
    lines.push(`- stats: kills=${row.stats.kills}, deaths=${row.stats.deaths}, beds=${row.stats.bedDestroys}, selfKills=${row.stats.selfKills}, selfDeaths=${row.stats.selfDeaths}`);
    lines.push(`- file: ${row.filePath}`);
    lines.push(`- line: ${row.lineNo}`);
    lines.push("");
    lines.push("```text");
    for (const item of row.context) {
      lines.push(`${item.marker} L${String(item.lineNo).padStart(7, " ")} ${item.time ?? "--:--:--"} ${item.text}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function formatDuration(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function roundKey(round) {
  return [round.source, round.scope, round.filePath, round.startMs, round.lineNo].join("\0");
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function resolveMaybeRelative(value, baseDir) {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}
