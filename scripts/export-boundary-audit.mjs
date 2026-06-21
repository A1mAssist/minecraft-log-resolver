import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const context = await loadAppConfig(readOption("--config") ?? undefined);
const config = context.config;
const reportPath = resolveConfigPath(context, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(context, readOption("--out-dir") ?? "labeling");
const prefix = readOption("--prefix") ?? "boundary-audit";
const limit = Number(readOption("--limit") ?? 200);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const rows = (report.rounds?.all ?? [])
  .map((round) => ({ round, reasons: boundaryReasons(round), score: boundaryScore(round) }))
  .filter((row) => row.reasons.length)
  .sort((a, b) => b.score - a.score || b.round.durationSeconds - a.round.durationSeconds || a.round.startMs - b.round.startMs)
  .slice(0, limit)
  .map((row, index) => formatRow(row, index));

await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${prefix}.json`);
const mdPath = path.join(outDir, `${prefix}.md`);
await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), reportPath, totals: buildTotals(rows), rows }, null, 2), "utf8");
await writeFile(mdPath, renderMarkdown(rows), "utf8");

console.log(JSON.stringify({ reportPath, jsonPath, mdPath, totals: buildTotals(rows) }, null, 2));

function boundaryReasons(round) {
  const reasons = [];
  const events = round.boundaryEvents ?? [];
  const starts = events.filter((event) => event.role === "start");
  const merges = events.filter((event) => event.role === "merge");
  const roundStart = events.find((event) => event.type === "round_start");
  const start = events[0];

  if (round.startReason === "round_countdown" && round.roundStarts > 0 && start && roundStart) {
    const deltaSeconds = Math.round((roundStart.timestampMs - start.timestampMs) / 1000);
    if (deltaSeconds > 45) reasons.push(`countdown_to_start_gap_${deltaSeconds}s`);
  }
  if (starts.length > 1) reasons.push(`multiple_starts_${starts.length}`);
  if (merges.length > 2) reasons.push(`many_boundary_merges_${merges.length}`);
  if (round.endReason === "next_round" && round.result === "unknown") reasons.push("next_round_without_result");
  if (round.endReason === "last_event" && round.result === "unknown") reasons.push("last_event_without_result");
  if (round.endReason === "world_switch" && round.result === "unknown") reasons.push("world_switch_without_result");
  if (round.durationSeconds < 60 && hasGameplay(round)) reasons.push("short_gameplay_round");
  if (round.durationSeconds > 1800 && round.result === "unknown") reasons.push("long_unknown_round");
  if (round.ignoredReason === "waiting_only") reasons.push("ignored_waiting_only");
  if (round.ignoredReason && round.ignoredReason !== "waiting_only") reasons.push(`ignored_${round.ignoredReason}`);

  return reasons;
}

function boundaryScore(round) {
  const weights = {
    next_round_without_result: 50,
    last_event_without_result: 35,
    world_switch_without_result: 35,
    short_gameplay_round: 30,
    long_unknown_round: 30,
    ignored_waiting_only: 20,
  };
  return boundaryReasons(round).reduce((total, reason) => total + (weights[reason] ?? 15), 0);
}

function formatRow(row, index) {
  const round = row.round;
  return {
    id: `boundary:${String(index + 1).padStart(3, "0")}`,
    score: row.score,
    reasons: row.reasons,
    set: round.ignoredReason ? "ignored" : "reliable",
    source: round.source,
    scope: round.scope,
    gameMode: round.gameMode,
    result: round.result,
    ignoredReason: round.ignoredReason,
    startAt: round.startAt,
    endAt: round.endAt,
    durationSeconds: round.durationSeconds,
    duration: round.duration,
    startReason: round.startReason,
    endReason: round.endReason,
    roundStarts: round.roundStarts,
    roundEnds: round.roundEnds,
    kills: round.kills,
    deaths: round.deaths,
    bedDestroys: round.bedDestroys,
    selfKills: round.selfKills,
    selfDeaths: round.selfDeaths,
    selfBedDestroys: round.selfBedDestroys,
    boundaryEvents: round.boundaryEvents ?? [],
    filePath: round.filePath,
    lineNo: round.lineNo,
  };
}

function renderMarkdown(rows) {
  const lines = [
    "# Boundary Audit",
    "",
    `Generated at ${new Date().toISOString()}.`,
    "",
    "This file lists rounds whose boundaries deserve review. It is not saying every row is wrong; it points at segments where the parser had to infer more than usual.",
    "",
    `Total exported: ${rows.length}`,
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.id} [${row.set}] ${row.gameMode} ${row.result}`);
    lines.push("");
    lines.push(`- score: ${row.score}`);
    lines.push(`- reasons: ${row.reasons.join(", ")}`);
    lines.push(`- source/scope: ${row.source} / ${row.scope}`);
    lines.push(`- time: ${row.startAt} -> ${row.endAt} (${row.duration})`);
    lines.push(`- boundary: ${row.startReason} -> ${row.endReason}, starts=${row.roundStarts}, ends=${row.roundEnds}`);
    lines.push(`- stats: kills=${row.kills}, deaths=${row.deaths}, beds=${row.bedDestroys}, selfKills=${row.selfKills}, selfDeaths=${row.selfDeaths}, selfBeds=${row.selfBedDestroys}`);
    lines.push(`- file: ${row.filePath}:${row.lineNo}`);
    lines.push("");
    lines.push("```text");
    for (const event of row.boundaryEvents) {
      const time = event.timestampMs ? new Date(event.timestampMs).toISOString().slice(11, 19) : "--:--:--";
      const rule = event.ruleSet && event.ruleId ? `${event.ruleSet}:${event.ruleId}` : "no-rule";
      const seconds = event.seconds ? ` seconds=${event.seconds}` : "";
      lines.push(`${event.role.padEnd(9)} L${String(event.lineNo ?? "").padStart(7, " ")} ${time} ${event.type} ${rule}${seconds} mode=${event.gameMode}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function buildTotals(rows) {
  return {
    rows: rows.length,
    bySet: countBy(rows, "set"),
    byReason: rows.reduce((acc, row) => {
      for (const reason of row.reasons) acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
    byMode: countBy(rows, "gameMode"),
  };
}

function hasGameplay(round) {
  return Boolean(round.kills || round.deaths || round.bedDestroys || round.selfKills || round.selfDeaths || round.selfBedDestroys);
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key] ?? "unknown"] = (counts[row[key] ?? "unknown"] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
