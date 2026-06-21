import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { cleanChatMessage, isClientModNoiseMessage, parseChatEvent } from "../src/parser/chatRules.mjs";
import { discoverLogFiles, discoverScopes } from "../src/parser/discovery.mjs";
import { parseLine } from "../src/parser/lineParser.mjs";
import { readLogLines } from "../src/parser/reader.mjs";
import { buildUnknownAudit, buildUnknownAuditSummary, ensureUnknownAudit, UNKNOWN_AUDIT_PRIORITIES } from "../src/report/unknownAudit.mjs";
import { ensureServerContext } from "../src/parser/serverContext.mjs";
import { VALID_REVIEW_LABELS } from "../src/parser/ruleEcosystem.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "labeling");
const prefix = readOption("--prefix") ?? "unknown-audit-current";
const limit = Number(readOption("--limit") ?? 500);
const selectedModes = new Set(readRepeatedOption("--mode"));
const selectedCategories = new Set(readRepeatedOption("--category"));
const selectedNextActions = new Set(readRepeatedOption("--next-action"));
const selectedPriorities = new Set(readRepeatedOption("--priority"));
const includeContext = hasFlag("--include-context");
const writeReviewPacket = hasFlag("--review-packet");
const writeLabelTemplate = hasFlag("--label-template");
const beforeMs = Number(readOption("--before-ms") ?? 0);
const afterMs = Number(readOption("--after-ms") ?? 120_000);
const contextLinesLimit = Number(readOption("--context-lines") ?? 80);
const selectedRoots = readRepeatedOption("--root");
const roots = selectedRoots.length ? selectedRoots : config.roots;
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);
const customRuleValues = readRepeatedOption("--custom-rule");
const customRulePaths = (customRuleValues.length ? customRuleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));
const displayEncoding = readOption("--display-encoding") ?? "utf-8";

for (const priority of selectedPriorities) {
  if (!UNKNOWN_AUDIT_PRIORITIES.includes(priority)) {
    console.error(JSON.stringify({
      ok: false,
      error: "invalid_priority",
      message: "--priority must be high, medium, or low.",
      value: priority,
      allowed: UNKNOWN_AUDIT_PRIORITIES,
    }, null, 2));
    process.exit(2);
  }
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const reliableUnknown = (report.rounds?.reliable ?? [])
  .filter((round) => round.result === "unknown")
  .map((round) => ({
    ...round,
    unknownAudit: ensureUnknownAudit(round),
  }));

const selectedRounds = reliableUnknown
  .filter((round) => !selectedModes.size || selectedModes.has(round.gameMode))
  .filter((round) => !selectedCategories.size || selectedCategories.has(round.unknownAudit?.category))
  .filter((round) => !selectedNextActions.size || selectedNextActions.has(round.unknownAudit?.nextAction))
  .filter((round) => !selectedPriorities.size || selectedPriorities.has(round.unknownAudit?.reviewPriority))
  .sort((a, b) =>
    reviewPriorityRank(a.unknownAudit.reviewPriority) - reviewPriorityRank(b.unknownAudit.reviewPriority) ||
    a.unknownAudit.category.localeCompare(b.unknownAudit.category) ||
    a.unknownAudit.nextAction.localeCompare(b.unknownAudit.nextAction) ||
    a.startMs - b.startMs ||
    a.lineNo - b.lineNo
  )
  .slice(0, limit);

let contextState = null;
if (includeContext) {
  const chatLinesResult = await collectChatLines(roots, {
    encoding: config.encoding,
    cachePath: chatLinesCachePath,
  });
  contextState = {
    totals: chatLinesResult.totals,
    linesByFile: groupBy(
      chatLinesResult.lines.filter((line) => !isClientModNoiseMessage(line.message)),
      (line) => line.filePath,
    ),
  };
}

const rows = selectedRounds.map((round, index) => buildRow(round, index, contextState));
if (includeContext && displayEncoding) {
  const displayLinesByFile = await buildDisplayLinesByFile(roots, rows, displayEncoding);
  attachDisplayText(rows, displayLinesByFile);
}

const json = {
  schema: {
    name: "minecraft-log-observatory-unknown-audit-export",
    version: 2,
  },
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt ?? null,
  review: buildReviewContract(),
  filters: {
    mode: selectedModes.size ? [...selectedModes].sort() : "all",
    category: selectedCategories.size ? [...selectedCategories].sort() : "all",
    nextAction: selectedNextActions.size ? [...selectedNextActions].sort() : "all",
    priority: selectedPriorities.size ? [...selectedPriorities].sort() : "all",
    limit,
  },
  context: {
    included: includeContext,
    privacy: includeContext
      ? "full-local: explicit --include-context may include raw chat text from local logs"
      : "privacy-safe: no raw chat context exported",
    displayEncoding: includeContext ? displayEncoding : null,
    beforeMs: includeContext ? beforeMs : 0,
    afterMs: includeContext ? afterMs : 0,
    maxLinesPerRound: includeContext ? contextLinesLimit : 0,
  },
  totals: {
    sourceUnknownReliableRounds: reliableUnknown.length,
    exported: rows.length,
    audit: buildUnknownAuditSummary(reliableUnknown),
    exportedByCategory: countBy(rows, (row) => row.unknownAudit.category),
    exportedByNextAction: countBy(rows, (row) => row.unknownAudit.nextAction),
    exportedByPriority: countBy(rows, (row) => row.unknownAudit.reviewPriority ?? "low"),
  },
  rows,
};

await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${prefix}.json`);
const jsonlPath = path.join(outDir, `${prefix}.jsonl`);
const csvPath = path.join(outDir, `${prefix}.csv`);
const packetPath = path.join(outDir, `${prefix}.review.md`);
const labelTemplatePath = path.join(outDir, `${prefix}.labels.jsonl`);
await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(csvPath, renderCsv(rows), "utf8");
if (writeReviewPacket) {
  await writeFile(packetPath, renderReviewPacket(json, rows), "utf8");
}
if (writeLabelTemplate) {
  await writeFile(labelTemplatePath, `${rows.map((row) => JSON.stringify(buildLabelTemplateRow(row))).join("\n")}\n`, "utf8");
}

console.log(JSON.stringify({
  reportPath,
  jsonPath,
  jsonlPath,
  csvPath,
  ...(writeReviewPacket ? { packetPath } : {}),
  ...(writeLabelTemplate ? { labelTemplatePath } : {}),
  exported: rows.length,
  totals: json.totals,
  context: json.context,
  ...(contextState ? { chatCache: `${contextState.totals.cacheHits}/${contextState.totals.files}` } : {}),
}, null, 2));

function buildRow(round, index, context) {
  const audit = round.unknownAudit ?? buildUnknownAudit(round);
  const server = ensureServerContext(round);
  const row = {
    id: `unknown-audit:${String(index + 1).padStart(4, "0")}`,
    roundRef: hashRound(round),
    gameMode: round.gameMode,
    source: round.source,
    scope: round.scope,
    sessionAlias: round.sessionAlias ?? round.localUser ?? null,
    startAt: round.startAt,
    endAt: round.endAt,
    durationSeconds: round.durationSeconds,
    startReason: round.startReason,
    endReason: round.endReason,
    resultHint: round.resultHint ?? null,
    unknownAudit: audit,
    serverNetwork: server.serverNetwork,
    serverAddress: server.serverAddress,
    serverLabel: server.serverLabel,
    serverConfidence: server.serverConfidence,
    serverEvidence: server.serverEvidence,
    allowedReviewLabels: VALID_REVIEW_LABELS,
    suggestedReviewLabel: suggestedReviewLabel(audit),
    message: null,
    ruleId: null,
    confidence: null,
    negativeExamples: [],
    reviewLabel: null,
    reviewNotes: null,
    reviewedAt: null,
    stats: {
      kills: round.kills ?? 0,
      deaths: round.deaths ?? 0,
      bedDestroys: round.bedDestroys ?? 0,
      selfKills: round.selfKills ?? 0,
      selfDeaths: round.selfDeaths ?? 0,
      selfDeathSignals: round.selfDeathSignals ?? 0,
      selfBedDestroys: round.selfBedDestroys ?? 0,
    },
    owner: {
      ownerTeamKnown: Boolean(round.ownerTeam),
      ownerBedDestroyed: Boolean(round.ownerBedDestroyed),
      ownerTeamEliminated: Boolean(round.ownerTeamEliminated),
      ownFinalDeaths: round.ownFinalDeaths ?? 0,
    },
    teams: {
      teamEliminations: positiveKeys(round.teamEliminations),
      bedDestroyedTeams: positiveKeys(round.bedDestroyedTeams),
    },
    evidenceKinds: audit?.features?.evidenceKinds ?? [],
    lineNo: round.lineNo ?? null,
  };
  if (context) {
    row.contextLines = contextLinesForRound(round, context);
    row.contextLineCount = row.contextLines.length;
  }
  Object.defineProperty(row, "filePath", {
    value: round.filePath,
    enumerable: false,
  });
  return row;
}

function renderCsv(rows) {
  const headers = [
    "id",
    "roundRef",
    "gameMode",
    "category",
    "nextAction",
    "reviewPriority",
    "reviewReason",
    "hintValue",
    "hintReason",
    "serverLabel",
    "serverAddress",
    "serverConfidence",
    "source",
    "scope",
    "sessionAlias",
    "startAt",
    "durationSeconds",
    "endReason",
    "ownerTeamKnown",
    "selfAction",
    "ownerBedDestroyed",
    "teamElimination",
    "evidenceKinds",
    "allowedReviewLabels",
    "suggestedReviewLabel",
    "message",
    "ruleId",
    "confidence",
    "reviewLabel",
    "reviewNotes",
    "reviewedAt",
    "contextLineCount",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(readCsvField(row, header))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function renderReviewPacket(exportJson, rows) {
  const lines = [
    "# Unknown Audit Review Packet",
    "",
    `Generated: ${exportJson.generatedAt}`,
    `Report: ${exportJson.sourceReportGeneratedAt ?? "unknown"}`,
    `Privacy: ${exportJson.context.privacy}`,
    "",
    "## Filters",
    "",
    `- mode: ${formatFilter(exportJson.filters.mode)}`,
    `- category: ${formatFilter(exportJson.filters.category)}`,
    `- nextAction: ${formatFilter(exportJson.filters.nextAction)}`,
    `- priority: ${formatFilter(exportJson.filters.priority)}`,
    `- exported: ${exportJson.totals.exported}`,
    "",
    "## Review Contract",
    "",
    `Allowed labels: ${VALID_REVIEW_LABELS.join(", ")}`,
    "",
    "Fill `reviewLabel` and `reviewNotes` in the JSONL/CSV file, then validate with:",
    "",
    "```bat",
    "npm.cmd run result:audit-labels -- --input <reviewed file>",
    "npm.cmd run rules:audit-workflow -- --input <reviewed file> --target-mode bedwars",
    "```",
    "",
    "## Rows",
    "",
  ];

  for (const [index, row] of rows.entries()) {
    lines.push(
      `### ${index + 1}. ${row.id}`,
      "",
      `- roundRef: \`${row.roundRef}\``,
      `- mode: \`${row.gameMode}\``,
      `- time: ${row.startAt ?? "unknown"} -> ${row.endAt ?? "unknown"} (${row.durationSeconds ?? "?"}s)`,
      `- endReason: \`${row.endReason ?? "unknown"}\``,
      `- server: ${row.serverLabel ?? "Unknown server"}${row.serverAddress ? ` (${row.serverAddress})` : ""}, confidence=${row.serverConfidence ?? "unknown"}`,
      `- category: \`${row.unknownAudit?.category ?? ""}\``,
      `- nextAction: \`${row.unknownAudit?.nextAction ?? ""}\``,
      `- priority: \`${row.unknownAudit?.reviewPriority ?? ""}\` - ${row.unknownAudit?.reviewReason ?? ""}`,
      `- resultHint: \`${row.resultHint?.value ?? "none"}\` / \`${row.resultHint?.reason ?? "none"}\``,
      `- suggestedReviewLabel: \`${row.suggestedReviewLabel || "(blank)"}\``,
      "",
      "Owner/team signals:",
      "",
      `- ownerTeamKnown: ${row.owner.ownerTeamKnown}`,
      `- ownerBedDestroyed: ${row.owner.ownerBedDestroyed}`,
      `- ownerTeamEliminated: ${row.owner.ownerTeamEliminated}`,
      `- ownFinalDeaths: ${row.owner.ownFinalDeaths}`,
      `- teamEliminations: ${row.teams.teamEliminations.join(", ") || "(none)"}`,
      `- bedDestroyedTeams: ${row.teams.bedDestroyedTeams.join(", ") || "(none)"}`,
      "",
      "Stats:",
      "",
      `- kills/deaths: ${row.stats.kills}/${row.stats.deaths}`,
      `- selfKills/selfDeaths/selfDeathSignals: ${row.stats.selfKills}/${row.stats.selfDeaths}/${row.stats.selfDeathSignals}`,
      `- selfBedDestroys: ${row.stats.selfBedDestroys}`,
      `- evidenceKinds: ${row.evidenceKinds.join(", ") || "(none)"}`,
      "",
      "Review fields to fill:",
      "",
      "- reviewLabel:",
      "- reviewNotes:",
      "- message:",
      "",
    );
    if (Array.isArray(row.contextLines) && row.contextLines.length) {
      lines.push("Context lines:", "");
      lines.push("| line | pos | event | text |");
      lines.push("| ---: | --- | --- | --- |");
      for (const line of row.contextLines) {
        lines.push(`| ${line.lineNo ?? ""} | ${line.position ?? ""} | ${line.matchedEvent?.type ?? ""} | ${escapeMarkdownTable(contextLinePacketText(line))} |`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildLabelTemplateRow(row) {
  const contextLines = Array.isArray(row.contextLines) ? row.contextLines : [];
  const importantMessages = contextLines
    .filter((line) => line.resultLike || line.matchedEvent?.type)
    .slice(0, 8)
    .map((line) => ({
      lineNo: line.lineNo ?? null,
      position: line.position ?? null,
      event: line.matchedEvent?.type ?? null,
      text: line.displayText ?? line.text ?? "",
    }));
  return {
    id: row.id,
    roundRef: row.roundRef,
    gameMode: row.gameMode,
    startAt: row.startAt ?? null,
    durationSeconds: row.durationSeconds ?? null,
    endReason: row.endReason ?? null,
    serverLabel: row.serverLabel ?? null,
    auditCategory: row.unknownAudit?.category ?? null,
    unknownNextAction: row.unknownAudit?.nextAction ?? null,
    reviewPriority: row.unknownAudit?.reviewPriority ?? null,
    reviewReason: row.unknownAudit?.reviewReason ?? null,
    resultHint: row.resultHint ?? null,
    suggestedReviewLabel: row.suggestedReviewLabel || null,
    allowedReviewLabels: row.allowedReviewLabels,
    reviewLabel: null,
    reviewNotes: null,
    message: null,
    ruleId: null,
    confidence: null,
    negativeExamples: [],
    owner: row.owner,
    teams: row.teams,
    stats: row.stats,
    evidenceKinds: row.evidenceKinds,
    context: {
      included: contextLines.length > 0,
      lineCount: contextLines.length,
      importantMessages,
    },
  };
}

function formatFilter(value) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "all");
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function readCsvField(row, field) {
  if (field === "category") return row.unknownAudit?.category ?? "";
  if (field === "nextAction") return row.unknownAudit?.nextAction ?? "";
  if (field === "reviewPriority") return row.unknownAudit?.reviewPriority ?? "";
  if (field === "reviewReason") return row.unknownAudit?.reviewReason ?? "";
  if (field === "hintValue") return row.resultHint?.value ?? "";
  if (field === "hintReason") return row.resultHint?.reason ?? "";
  if (field === "serverLabel") return row.serverLabel ?? "";
  if (field === "serverAddress") return row.serverAddress ?? "";
  if (field === "serverConfidence") return row.serverConfidence ?? "";
  if (field === "ownerTeamKnown") return row.unknownAudit?.features?.ownerTeamKnown ?? false;
  if (field === "selfAction") return row.unknownAudit?.features?.selfAction ?? false;
  if (field === "ownerBedDestroyed") return row.unknownAudit?.features?.ownerBedDestroyed ?? false;
  if (field === "teamElimination") return row.unknownAudit?.features?.teamElimination ?? false;
  if (field === "evidenceKinds") return row.evidenceKinds.join("|");
  if (field === "allowedReviewLabels") return row.allowedReviewLabels.join("|");
  if (field === "contextLineCount") return row.contextLineCount ?? 0;
  return row[field] ?? "";
}

function reviewPriorityRank(value) {
  if (value === "high") return 0;
  if (value === "medium") return 1;
  return 2;
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function hashRound(round) {
  return createHash("sha256")
    .update([
      round.source,
      round.scope,
      round.filePath,
      round.lineNo,
      round.startMs,
      round.endMs,
    ].map((value) => String(value ?? "")).join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function positiveKeys(value) {
  return Object.entries(value ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key]) => key)
    .sort();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildReviewContract() {
  return {
    policy: "Review labels are audit inputs only. They do not change report/store/config/rules until a generated rule pack is dry-run, enabled, and the report is refreshed.",
    allowedReviewLabels: VALID_REVIEW_LABELS,
    draftableReviewLabels: ["win", "loss", "ignore"],
    nonDraftingReviewLabels: ["keep-unknown", "new-rule-needed"],
    rowFields: {
      reviewLabel: "Fill with one allowed label after manual review.",
      reviewNotes: "Optional reviewer note explaining the decision.",
      message: "Optional exact chat text to turn win/loss/ignore labels into draft rules.",
      ruleId: "Optional stable rule id for draft generation.",
      confidence: "Optional rule confidence, usually high for promotion candidates.",
      suggestedReviewLabel: "Workflow hint only; reviewers may leave it blank or choose any allowed label.",
    },
    nextSteps: [
      "Fill reviewLabel and reviewNotes in CSV/JSONL.",
      "Validate with npm.cmd run result:audit-labels -- --input <reviewed file>.",
      "Generate and preview with npm.cmd run rules:audit-workflow -- --input <reviewed file> --target-mode bedwars.",
      "Enable only reviewed user rules that pass dry-run gates.",
    ],
  };
}

function suggestedReviewLabel(audit) {
  if (audit?.nextAction === "keep_unknown") return "keep-unknown";
  if (audit?.nextAction === "review_rule_candidate") return "new-rule-needed";
  return "";
}

function contextLinesForRound(round, context) {
  const fileLines = context.linesByFile.get(round.filePath) ?? [];
  if (!fileLines.length) return [];

  const startMs = round.startMs ?? 0;
  const boundaryMs = round.endMs ?? round.lastEventMs ?? startMs;
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

async function buildDisplayLinesByFile(roots, rows, encoding) {
  if (!encoding) return new Map();
  const requests = groupRequestedLineNumbersByFile(rows);
  if (!requests.size) return new Map();
  const filesByPath = await discoverRequestedFiles(roots, requests);
  const displayLinesByFile = new Map();
  for (const [filePath, lineNumbers] of requests.entries()) {
    const file = filesByPath.get(filePath);
    if (!file) continue;
    const lines = new Map();
    for await (const rawLine of readLogLines(file, { encoding })) {
      if (!lineNumbers.has(rawLine.lineNo)) continue;
      const parsed = parseLine(file.path, rawLine.lineNo, rawLine.text);
      lines.set(rawLine.lineNo, parsed.isChat ? parsed.message : rawLine.text.trim());
      if (lines.size >= lineNumbers.size) break;
    }
    if (lines.size) displayLinesByFile.set(filePath, lines);
  }
  return displayLinesByFile;
}

function groupRequestedLineNumbersByFile(rows) {
  const requests = new Map();
  for (const row of rows) {
    const filePath = row.filePath;
    if (!filePath) continue;
    const lineNumbers = requests.get(filePath) ?? new Set();
    for (const line of row.contextLines ?? []) {
      if (Number.isInteger(line.lineNo)) lineNumbers.add(line.lineNo);
    }
    if (lineNumbers.size) requests.set(filePath, lineNumbers);
  }
  return requests;
}

async function discoverRequestedFiles(roots, requests) {
  const wanted = new Set(requests.keys());
  const files = new Map();
  for (const root of roots) {
    const scopes = await discoverScopes(root);
    for (const scope of scopes) {
      for (const file of await discoverLogFiles(scope)) {
        if (wanted.has(file.path)) files.set(file.path, file);
      }
    }
  }
  return files;
}

function attachDisplayText(rows, displayLinesByFile) {
  for (const row of rows) {
    const displayLines = displayLinesByFile.get(row.filePath);
    if (!displayLines) continue;
    for (const line of row.contextLines ?? []) {
      const displayMessage = displayLines.get(line.lineNo);
      const displayText = chooseDisplayText(line.text, displayMessage ? cleanChatMessage(displayMessage) : null);
      if (displayText) line.displayText = displayText;
    }
  }
}

function annotateContextLine(line, startMs, boundaryMs) {
  const event = parseChatEvent(line.message, {
    ruleSets: config.rules.length ? config.rules : null,
    customRulePaths,
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

function chooseDisplayText(text, candidate) {
  if (!candidate || candidate === text) return null;
  if (!looksLikeMojibake(text) && !looksLikeQuestionMarkReplacement(text, candidate)) return null;
  if (looksLikeBrokenDecode(candidate)) return null;
  return candidate;
}

function contextLinePacketText(line) {
  if (!line?.displayText) return line?.text ?? "";
  return `${line.displayText} (raw: ${line.text ?? ""})`;
}

function looksLikeMojibake(value) {
  return /[璧峰簥鎴樹簤娓告垙灏嗗湪绉掑悗寮濮钃濋槦姝讳簡鎺夌嚎鑺遍洦搴鏈嶅姟鍣]/.test(String(value ?? ""));
}

function looksLikeBrokenDecode(value) {
  const text = String(value ?? "");
  return text.includes("\uFFFD") || /[�]/.test(text);
}

function looksLikeQuestionMarkReplacement(text, candidate) {
  const raw = String(text ?? "");
  const display = String(candidate ?? "");
  const questionMarks = raw.match(/\?/g)?.length ?? 0;
  if (questionMarks < 3) return false;
  if (!/[\u3400-\u9fff]/.test(display)) return false;
  return display.length >= raw.length - 4;
}

function isImportantContextLine(line) {
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
    "self_death",
    "kill",
    "death",
  ].includes(line.matchedEvent?.type);
}

function looksLikeResultSignal(message) {
  const text = cleanChatMessage(message).toLowerCase();
  if (/victory|defeat|winner|winners|winning team|you won|you lost|game over|placed #|you died|you survived/.test(text)) return true;
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

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function hasFlag(name) {
  return args.includes(name);
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
