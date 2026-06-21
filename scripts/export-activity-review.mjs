import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { ensureServerContext } from "../src/parser/serverContext.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "labeling");
const prefix = readOption("--prefix") ?? "activity-review-current";
const limit = readPositiveIntOption("--limit", 500);
const exampleLimit = readPositiveIntOption("--example-limit", 20);
const selectedModes = new Set(readRepeatedOption("--mode"));
const selectedServerLabels = new Set(readRepeatedOption("--server-label"));
const minDuration = readOptionalNumberOption("--min-duration");
const includeExamples = hasFlag("--include-examples");
const requireReward = hasFlag("--has-reward");
const requireDiagnostic = hasFlag("--has-diagnostic");
const requireOwnerId = hasFlag("--has-owner-id");
const sort = readOption("--sort") ?? "start";

const allowedSorts = new Set(["start", "duration_desc", "reward_desc", "diagnostic"]);
if (!allowedSorts.has(sort)) {
  console.error(JSON.stringify({
    ok: false,
    error: "invalid_sort",
    message: "--sort must be one of start, duration_desc, reward_desc, or diagnostic.",
    value: sort,
    allowed: [...allowedSorts],
  }, null, 2));
  process.exit(2);
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const activitySegments = report.activity?.segments ?? [];
const rows = activitySegments
  .map(buildRow)
  .filter((row) => !selectedModes.size || selectedModes.has(row.mode))
  .filter((row) => !selectedServerLabels.size || selectedServerLabels.has(row.serverLabel))
  .filter((row) => minDuration === null || row.durationSeconds >= minDuration)
  .filter((row) => !requireReward || row.reviewFlags.hasReward)
  .filter((row) => !requireDiagnostic || row.reviewFlags.hasDiagnostic)
  .filter((row) => !requireOwnerId || row.reviewFlags.hasOwnerId)
  .sort(compareRows)
  .slice(0, limit)
  .map((row, index) => ({ ...row, id: `activity-review:${String(index + 1).padStart(4, "0")}` }));

const json = {
  schema: {
    name: "minecraft-log-observatory-activity-review-export",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  sourceReportGeneratedAt: report.generatedAt ?? null,
  filters: {
    mode: selectedModes.size ? [...selectedModes].sort() : "all",
    serverLabel: selectedServerLabels.size ? [...selectedServerLabels].sort() : "all",
    minDuration,
    hasReward: requireReward,
    hasDiagnostic: requireDiagnostic,
    hasOwnerId: requireOwnerId,
    sort,
    limit,
  },
  privacy: includeExamples
    ? "full-local: includes activity examples from the local report, including chat text already stored in derived report data"
    : "privacy-safe: no local file paths or raw activity examples are exported; server/player identity summaries from the report are retained",
  source: {
    reportOnly: true,
    rawLogRead: false,
    writesReport: false,
    writesStore: false,
    writesConfig: false,
  },
  totals: buildTotals(rows, activitySegments),
  rows,
};

await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${prefix}.json`);
const jsonlPath = path.join(outDir, `${prefix}.jsonl`);
const csvPath = path.join(outDir, `${prefix}.csv`);
await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(csvPath, renderCsv(rows), "utf8");

console.log(JSON.stringify({
  reportPath,
  jsonPath,
  jsonlPath,
  csvPath,
  exported: rows.length,
  totals: json.totals,
  privacy: json.privacy,
}, null, 2));

function buildRow(segment) {
  const server = ensureServerContext(segment);
  const diagnosticRules = diagnosticRuleIds(segment);
  const row = {
    id: null,
    segmentRef: hashSegment(segment),
    mode: segment.mode ?? "unknown",
    label: segment.label ?? segment.mode ?? "Unknown",
    source: segment.source ?? null,
    scope: segment.scope ?? null,
    sessionAlias: segment.sessionAlias ?? segment.localUser ?? null,
    startAt: segment.startAt ?? null,
    endAt: segment.endAt ?? null,
    durationSeconds: segment.durationSeconds ?? 0,
    duration: segment.duration ?? null,
    confidence: segment.confidence ?? null,
    startReason: segment.startReason ?? null,
    endReason: segment.endReason ?? null,
    serverNetwork: server.serverNetwork,
    serverAddress: server.serverAddress,
    serverLabel: server.serverLabel,
    serverConfidence: server.serverConfidence,
    serverEvidence: server.serverEvidence,
    identity: {
      serverPlayerId: segment.serverPlayerId ?? null,
      serverPlayerIds: segment.serverPlayerIds ?? {},
      serverPlayerIdSource: segment.serverPlayerIdSource ?? "none",
      serverPlayerIdConfidence: segment.serverPlayerIdConfidence ?? "none",
      serverIdentityContext: segment.serverIdentityContext ?? null,
      serverPlayerIdPolicy: segment.serverPlayerIdPolicy ?? null,
      localUsers: segment.localUsers ?? {},
    },
    stats: {
      modeSignals: segment.modeSignals ?? 0,
      kills: segment.kills ?? 0,
      deaths: segment.deaths ?? 0,
      selfKills: segment.selfKills ?? 0,
      selfDeaths: segment.selfDeaths ?? 0,
      playerMaxKillStreak: segment.playerMaxKillStreak ?? 0,
      observedBroadcastMaxKillStreak: segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0,
      maxStreak: segment.maxStreak ?? 0,
      rewardEvents: segment.rewardEvents ?? 0,
      goldEarned: segment.goldEarned ?? 0,
      xpEarned: segment.xpEarned ?? 0,
      bountyClaims: segment.bountyClaims ?? 0,
      bountyGoldEarned: segment.bountyGoldEarned ?? 0,
      streakPoints: segment.streakPoints ?? 0,
      megastreaks: segment.megastreaks ?? 0,
    },
    rules: {
      counts: segment.rules ?? {},
      totalHits: Object.values(segment.rules ?? {}).reduce((total, count) => total + Number(count ?? 0), 0),
      diagnosticRuleIds: diagnosticRules,
    },
    reviewFlags: {
      hasReward: hasRewardSignal(segment),
      hasDiagnostic: diagnosticRules.length > 0,
      hasOwnerId: hasOwnerId(segment),
      hasPlayerKillStreak: Number(segment.playerMaxKillStreak ?? 0) > 0,
      hasBroadcastKillStreak: Number(segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0) > 0,
    },
    reviewNotes: null,
    reviewedAt: null,
  };

  if (includeExamples) {
    row.examples = (segment.examples ?? []).slice(0, exampleLimit).map((example) => ({
      lineNo: example.lineNo ?? null,
      timeText: example.timeText ?? null,
      type: example.type ?? null,
      rule: example.rule ?? null,
      message: example.message ?? null,
      payload: example.payload ?? null,
    }));
    row.exampleCount = segment.examples?.length ?? 0;
  }

  return row;
}

function compareRows(left, right) {
  if (sort === "duration_desc") {
    return right.durationSeconds - left.durationSeconds || chronological(left, right);
  }
  if (sort === "reward_desc") {
    return rewardScore(right) - rewardScore(left) || chronological(left, right);
  }
  if (sort === "diagnostic") {
    return Number(right.reviewFlags.hasDiagnostic) - Number(left.reviewFlags.hasDiagnostic)
      || right.rules.diagnosticRuleIds.length - left.rules.diagnosticRuleIds.length
      || chronological(left, right);
  }
  return chronological(left, right);
}

function chronological(left, right) {
  return Date.parse(left.startAt ?? "") - Date.parse(right.startAt ?? "")
    || left.segmentRef.localeCompare(right.segmentRef);
}

function rewardScore(row) {
  return Number(row.stats.rewardEvents ?? 0)
    + Number(row.stats.goldEarned ?? 0)
    + Number(row.stats.xpEarned ?? 0)
    + Number(row.stats.streakPoints ?? 0);
}

function buildTotals(rows, allSegments) {
  return {
    sourceActivitySegments: allSegments.length,
    exported: rows.length,
    byMode: countBy(rows, (row) => row.mode),
    byServerLabel: countBy(rows, (row) => row.serverLabel),
    byServerConfidence: countBy(rows, (row) => row.serverConfidence),
    byOwnerIdConfidence: countBy(rows, (row) => row.identity.serverPlayerIdConfidence),
    withRewards: rows.filter((row) => row.reviewFlags.hasReward).length,
    withDiagnostics: rows.filter((row) => row.reviewFlags.hasDiagnostic).length,
    withOwnerId: rows.filter((row) => row.reviewFlags.hasOwnerId).length,
    maxPlayerKillStreak: Math.max(0, ...rows.map((row) => row.stats.playerMaxKillStreak ?? 0)),
    maxObservedBroadcastKillStreak: Math.max(0, ...rows.map((row) => row.stats.observedBroadcastMaxKillStreak ?? 0)),
    rewardEvents: sumBy(rows, (row) => row.stats.rewardEvents),
    goldEarned: sumBy(rows, (row) => row.stats.goldEarned),
    xpEarned: sumBy(rows, (row) => row.stats.xpEarned),
    bountyClaims: sumBy(rows, (row) => row.stats.bountyClaims),
    bountyGoldEarned: sumBy(rows, (row) => row.stats.bountyGoldEarned),
  };
}

function renderCsv(rows) {
  const headers = [
    "id",
    "segmentRef",
    "mode",
    "label",
    "serverLabel",
    "serverAddress",
    "serverConfidence",
    "serverEvidenceSource",
    "source",
    "scope",
    "sessionAlias",
    "startAt",
    "endAt",
    "durationSeconds",
    "startReason",
    "endReason",
    "serverPlayerId",
    "serverPlayerIdConfidence",
    "serverPlayerIdSource",
    "kills",
    "deaths",
    "selfKills",
    "selfDeaths",
    "playerMaxKillStreak",
    "observedBroadcastMaxKillStreak",
    "rewardEvents",
    "goldEarned",
    "xpEarned",
    "bountyClaims",
    "bountyGoldEarned",
    "streakPoints",
    "megastreaks",
    "ruleHits",
    "diagnosticRuleIds",
    "hasReward",
    "hasDiagnostic",
    "hasOwnerId",
    "reviewNotes",
    "reviewedAt",
  ];
  return `${[
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(readCsvField(row, header))).join(",")),
  ].join("\n")}\n`;
}

function readCsvField(row, field) {
  if (field === "serverEvidenceSource") return row.serverEvidence?.source ?? "";
  if (field === "serverPlayerId") return row.identity.serverPlayerId ?? "";
  if (field === "serverPlayerIdConfidence") return row.identity.serverPlayerIdConfidence ?? "";
  if (field === "serverPlayerIdSource") return row.identity.serverPlayerIdSource ?? "";
  if (field === "kills") return row.stats.kills;
  if (field === "deaths") return row.stats.deaths;
  if (field === "selfKills") return row.stats.selfKills;
  if (field === "selfDeaths") return row.stats.selfDeaths;
  if (field === "playerMaxKillStreak") return row.stats.playerMaxKillStreak;
  if (field === "observedBroadcastMaxKillStreak") return row.stats.observedBroadcastMaxKillStreak;
  if (field === "rewardEvents") return row.stats.rewardEvents;
  if (field === "goldEarned") return row.stats.goldEarned;
  if (field === "xpEarned") return row.stats.xpEarned;
  if (field === "bountyClaims") return row.stats.bountyClaims;
  if (field === "bountyGoldEarned") return row.stats.bountyGoldEarned;
  if (field === "streakPoints") return row.stats.streakPoints;
  if (field === "megastreaks") return row.stats.megastreaks;
  if (field === "ruleHits") return row.rules.totalHits;
  if (field === "diagnosticRuleIds") return row.rules.diagnosticRuleIds.join("|");
  if (field === "hasReward") return row.reviewFlags.hasReward;
  if (field === "hasDiagnostic") return row.reviewFlags.hasDiagnostic;
  if (field === "hasOwnerId") return row.reviewFlags.hasOwnerId;
  return row[field] ?? "";
}

function hasRewardSignal(segment) {
  return Number(segment.rewardEvents ?? 0) > 0
    || Number(segment.goldEarned ?? 0) > 0
    || Number(segment.xpEarned ?? 0) > 0
    || Number(segment.bountyClaims ?? 0) > 0
    || Number(segment.bountyGoldEarned ?? 0) > 0
    || Number(segment.streakPoints ?? 0) > 0;
}

function hasOwnerId(segment) {
  return Boolean(segment.serverPlayerId && segment.serverPlayerIdConfidence !== "none");
}

function diagnosticRuleIds(segment) {
  const fromRules = Object.keys(segment.rules ?? {}).filter(isDiagnosticRuleId);
  const fromExamples = (segment.examples ?? [])
    .filter((example) => example.type === "activity_diagnostic" || isDiagnosticRuleId(example.rule))
    .map((example) => example.rule)
    .filter(Boolean);
  return [...new Set([...fromRules, ...fromExamples])].sort();
}

function isDiagnosticRuleId(value) {
  return /activity_diagnostic|bounty|prestige|minor_event|renown|level_up/i.test(String(value ?? ""));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sumBy(items, valueFn) {
  return Number(items.reduce((total, item) => total + Number(valueFn(item) ?? 0), 0).toFixed(2));
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function hashSegment(segment) {
  return createHash("sha256")
    .update([
      segment.key,
      segment.source,
      segment.scope,
      segment.filePath,
      segment.lineNo,
      segment.startMs,
      segment.endMs,
    ].map((value) => String(value ?? "")).join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function readPositiveIntOption(name, fallback) {
  const raw = readOption(name);
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    console.error(JSON.stringify({
      ok: false,
      error: "invalid_positive_integer",
      message: `${name} must be a positive integer.`,
      option: name,
      value: raw,
    }, null, 2));
    process.exit(2);
  }
  return Number(raw);
}

function readOptionalNumberOption(name) {
  const raw = readOption(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(JSON.stringify({
      ok: false,
      error: "invalid_number",
      message: `${name} must be a non-negative number.`,
      option: name,
      value: raw,
    }, null, 2));
    process.exit(2);
  }
  return value;
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
