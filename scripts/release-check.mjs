import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath, resolveStoreDir } from "../src/config/appConfig.mjs";
import { readLabelRows } from "./label-file-io.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const storeDir = readOption("--store-dir")
  ? resolveConfigPath(configContext, readOption("--store-dir"))
  : resolveStoreDir(configContext);
const performancePath = resolveConfigPath(configContext, readOption("--performance") ?? path.join("artifacts", "performance-baseline-current.json"));
const labelTemplatePath = resolveConfigPath(configContext, readOption("--label-template") ?? path.join("labeling", "unknown-audit-bedwars-high-review.labels.jsonl"));
const strict = hasFlag("--strict");
const full = hasFlag("--full");

const failures = [];
const warnings = [];
const report = await readJson(reportPath, "report", failures);
const storeManifest = await readJson(path.join(storeDir, "manifest.json"), "store manifest", failures);
const performance = await readJson(performancePath, "performance baseline", failures);
const labelRows = await readLabels(labelTemplatePath, failures);

if (report) checkReport(report, failures);
if (report && storeManifest) checkStore(report, storeManifest, failures, warnings);
if (performance) checkPerformance(performance, failures, warnings);
if (report && labelRows) checkLabelTemplate(report, labelRows, failures, warnings);

if (strict && warnings.length) {
  for (const warning of warnings) failures.push({ ...warning, severity: "error", promotedFromWarning: true });
}

const result = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  privacy: full ? "full-local" : "privacy-safe",
  strict,
  inputs: {
    reportPath: formatPath(reportPath),
    storeDir: formatPath(storeDir),
    performancePath: formatPath(performancePath),
    labelTemplatePath: formatPath(labelTemplatePath),
  },
  summary: {
    reportGeneratedAt: report?.generatedAt ?? null,
    storeGeneratedAt: storeManifest?.generatedAt ?? null,
    storeReportGeneratedAt: storeManifest?.reportGeneratedAt ?? null,
    performanceGeneratedAt: performance?.generatedAt ?? null,
    reliableRounds: report?.results?.summary?.reliableRounds ?? null,
    resultEligibleRounds: report?.results?.summary?.resultEligibleRounds ?? null,
    unknownResults: report?.results?.summary?.unknownRoundResults ?? null,
    ambiguousResults: report?.results?.summary?.ambiguousResults ?? null,
    bedwarsUnknown: report?.rounds?.summary?.gameModes?.bedwars?.unknownResults ?? null,
    thePit: summarizeMode(report?.rounds?.summary?.gameModes?.the_pit),
    performanceRecommendations: (performance?.recommendations ?? []).map((item) => item.code ?? item),
    labelRows: Array.isArray(labelRows) ? labelRows.length : null,
  },
  gates: {
    ambiguousResultsZero: failures.every((failure) => failure.code !== "ambiguous_results_nonzero"),
    thePitNonResult: failures.every((failure) => !failure.code.startsWith("the_pit_")),
    storeMatchesReport: failures.every((failure) => failure.code !== "store_report_mismatch"),
    jsonlStoreOk: failures.every((failure) => failure.code !== "jsonl_store_not_ok"),
    labelTemplateValid: failures.every((failure) => !failure.code.startsWith("label_template_")),
  },
  failures: failures.map(sanitizeIssue),
  warnings: warnings.map(sanitizeIssue),
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

async function readJson(filePath, label, failuresOut) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    failuresOut.push({
      code: `${safeCode(label)}_unreadable`,
      message: `Could not read ${label}.`,
      path: formatPath(filePath),
      detail: error.code ?? error.message,
    });
    return null;
  }
}

async function readLabels(filePath, failuresOut) {
  try {
    return await readLabelRows(filePath);
  } catch (error) {
    failuresOut.push({
      code: "label_template_unreadable",
      message: "Could not read label template.",
      path: formatPath(filePath),
      detail: error.code ?? error.message,
    });
    return null;
  }
}

function checkReport(report, failuresOut) {
  const summary = report.results?.summary ?? {};
  if (summary.ambiguousResults !== 0) {
    failuresOut.push({
      code: "ambiguous_results_nonzero",
      message: "Release gate requires ambiguousResults === 0.",
      value: summary.ambiguousResults,
    });
  }
  const pit = report.rounds?.summary?.gameModes?.the_pit;
  if (!pit) {
    failuresOut.push({ code: "the_pit_missing", message: "The Pit mode summary is required for release gate verification." });
    return;
  }
  if ((pit.resultEligible ?? 0) !== 0) {
    failuresOut.push({ code: "the_pit_result_eligible", message: "The Pit must not be result-eligible.", value: pit.resultEligible });
  }
  if ((pit.notApplicableResults ?? 0) !== (pit.rounds ?? 0)) {
    failuresOut.push({
      code: "the_pit_not_applicable_mismatch",
      message: "The Pit notApplicableResults must equal rounds.",
      notApplicableResults: pit.notApplicableResults,
      rounds: pit.rounds,
    });
  }
  if ((pit.unknownResults ?? 0) !== 0) {
    failuresOut.push({ code: "the_pit_unknown_nonzero", message: "The Pit must not contribute unknown results.", value: pit.unknownResults });
  }
}

function checkStore(report, manifest, failuresOut, warningsOut) {
  if (manifest.schema?.name !== "minecraft-log-observatory-store") {
    failuresOut.push({ code: "store_schema_invalid", message: "Store manifest schema name is invalid.", value: manifest.schema?.name });
  }
  if (manifest.reportGeneratedAt !== report.generatedAt) {
    failuresOut.push({
      code: "store_report_mismatch",
      message: "Store manifest must match the current report generatedAt.",
      storeReportGeneratedAt: manifest.reportGeneratedAt ?? null,
      reportGeneratedAt: report.generatedAt ?? null,
    });
  }
  const reliable = report.results?.summary?.reliableRounds;
  if (Number.isFinite(reliable) && manifest.counts?.reliableRounds !== reliable) {
    failuresOut.push({
      code: "store_reliable_round_count_mismatch",
      message: "Store reliable round count must match report.",
      storeReliableRounds: manifest.counts?.reliableRounds,
      reportReliableRounds: reliable,
    });
  }
  if (!manifest.files?.reliableRounds || !manifest.files?.activitySegments || !manifest.files?.profile) {
    warningsOut.push({
      code: "store_manifest_missing_expected_tables",
      severity: "warning",
      message: "Store manifest is missing one or more frontend-critical files.",
    });
  }
}

function checkPerformance(performance, failuresOut, warningsOut) {
  const codes = (performance.recommendations ?? []).map((item) => item.code ?? item);
  if (!codes.includes("jsonl_store_ok")) {
    failuresOut.push({
      code: "jsonl_store_not_ok",
      message: "Current performance recommendation must include jsonl_store_ok before release.",
      recommendations: codes,
    });
  }
  if (performance.needsRefresh) {
    failuresOut.push({
      code: "performance_needs_refresh",
      message: "Performance baseline reports derived data needs refresh.",
      refreshReasons: performance.refreshReasons ?? [],
    });
  }
  if ((performance.comparison?.regressions?.length ?? 0) > 0) {
    warningsOut.push({
      code: "performance_regressions_present",
      severity: "warning",
      message: "Performance baseline has comparison regressions that should be reviewed.",
      count: performance.comparison.regressions.length,
    });
  }
}

function checkLabelTemplate(report, rows, failuresOut, warningsOut) {
  if (!Array.isArray(rows) || rows.length === 0) {
    failuresOut.push({ code: "label_template_empty", message: "High-priority label template must contain at least one row." });
    return;
  }
  const knownRefs = new Set(
    (report.rounds?.reliable ?? [])
      .filter((round) => round.result === "unknown")
      .map((round) => round.roundRef ?? hashRoundLikeExport(round))
      .filter(Boolean),
  );
  const stale = rows.filter((row) => row?.roundRef && !knownRefs.has(row.roundRef));
  if (stale.length) {
    failuresOut.push({
      code: "label_template_stale_round_refs",
      message: "Label template contains stale or unknown roundRef values.",
      count: stale.length,
      samples: stale.slice(0, 5).map((row) => row.roundRef),
    });
  }
  const invalidLabelRows = rows.filter((row) => row.reviewLabel !== null && row.reviewLabel !== "" && row.reviewLabel !== undefined);
  if (invalidLabelRows.length) {
    warningsOut.push({
      code: "label_template_already_labeled",
      severity: "warning",
      message: "Label template already contains reviewed labels.",
      count: invalidLabelRows.length,
    });
  }
  const missingFields = rows.filter((row) => !row.roundRef || !row.auditCategory || !row.reviewPriority || !Array.isArray(row.allowedReviewLabels));
  if (missingFields.length) {
    failuresOut.push({
      code: "label_template_missing_required_fields",
      message: "Label template rows must include roundRef, auditCategory, reviewPriority, and allowedReviewLabels.",
      count: missingFields.length,
    });
  }
}

function summarizeMode(mode) {
  if (!mode) return null;
  return {
    rounds: mode.rounds ?? null,
    resultEligible: mode.resultEligible ?? null,
    notApplicableResults: mode.notApplicableResults ?? null,
    unknownResults: mode.unknownResults ?? null,
  };
}

function sanitizeIssue(issue) {
  if (!issue || typeof issue !== "object") return issue;
  const next = { ...issue };
  if ("path" in next) next.path = formatPath(next.path);
  return next;
}

function formatPath(filePath) {
  if (full) return filePath;
  const relative = path.relative(configContext.dir, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return {
    redacted: true,
    basename: path.basename(filePath),
  };
}

function hashRoundLikeExport(round) {
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

function safeCode(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}
