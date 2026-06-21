import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "artifacts");
const outPath = readOption("--out") ? resolveConfigPath(configContext, readOption("--out")) : path.join(outDir, "rule-quality-baseline-current.json");
const historyDir = resolveConfigPath(configContext, readOption("--history-dir") ?? "artifacts/rule-quality-history");
const previousPath = readOption("--previous") ? resolveConfigPath(configContext, readOption("--previous")) : outPath;

const report = JSON.parse(await readFile(reportPath, "utf8"));
const quality = report.rules?.quality;
if (!quality || typeof quality !== "object") {
  console.error(`Report does not include rules.quality: ${reportPath}`);
  process.exit(1);
}

const previousBaseline = await readJsonOptional(previousPath);
const currentCore = buildRuleQualityCore(report, quality);
const result = {
  ok: true,
  schema: {
    name: "minecraft-log-observatory-rule-quality-baseline",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  privacy: "privacy-safe",
  inputs: {
    report: {
      generatedAt: report.generatedAt ?? null,
      schema: report.schema ?? null,
    },
    selectedRuleSets: report.selectedRuleSets ?? null,
  },
  quality: currentCore,
  comparison: compareRuleQualityBaselines(currentCore, previousBaseline?.quality ?? null),
};

await archiveExistingBaseline(outPath, historyDir);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outPath,
  previousPath,
  summary: {
    totalRules: currentCore.totalRules,
    hitRules: currentCore.hitRules,
    zeroHitRules: currentCore.zeroHitRules,
    duplicatePatterns: currentCore.duplicatePatterns,
  },
  comparison: {
    available: result.comparison.available,
    warning: result.comparison.warning?.code ?? null,
    regressions: result.comparison.regressions.length,
    improvements: result.comparison.improvements.length,
  },
}, null, 2));

function buildRuleQualityCore(report, quality) {
  return {
    reportGeneratedAt: report.generatedAt ?? null,
    selectedRuleSets: report.selectedRuleSets ?? null,
    totalRules: quality.totalRules ?? 0,
    hitRules: quality.hitRules ?? 0,
    zeroHitRules: quality.zeroHitRules ?? 0,
    byRiskGroup: quality.byRiskGroup ?? {},
    byType: quality.byType ?? {},
    byRuleSet: quality.byRuleSet ?? {},
    duplicatePatterns: Array.isArray(quality.duplicatePatterns) ? quality.duplicatePatterns.length : 0,
    duplicatePatternSamples: (quality.duplicatePatterns ?? []).slice(0, 20),
    topHitRules: compactRules(quality.topHitRules, 25),
    zeroHitRulesList: compactRules(quality.zeroHitSamples, 200),
    resultImpactRules: compactRules(quality.resultImpactRules, 100),
    boundaryImpactRules: compactRules(quality.boundaryImpactRules, 100),
  };
}

function compactRules(rows = [], limit = 50) {
  return rows.slice(0, limit).map((row) => ({
    key: row.key,
    ruleSet: row.ruleSet,
    ruleId: row.ruleId,
    type: row.type,
    hitCount: row.hitCount,
    riskGroup: row.riskGroup,
    impact: row.impact ?? null,
  }));
}

function compareRuleQualityBaselines(current, previous) {
  if (!previous) {
    return {
      available: false,
      warning: {
        code: "previous_rule_quality_baseline_missing",
        message: "No previous rule quality baseline is available for comparison.",
      },
      deltas: {},
      regressions: [],
      improvements: [],
      changedRules: [],
    };
  }

  const deltas = {
    totalRules: numericDelta(current.totalRules, previous.totalRules),
    hitRules: numericDelta(current.hitRules, previous.hitRules),
    zeroHitRules: numericDelta(current.zeroHitRules, previous.zeroHitRules),
    duplicatePatterns: numericDelta(current.duplicatePatterns, previous.duplicatePatterns),
    experimentalRules: numericDelta(current.byRiskGroup?.experimental, previous.byRiskGroup?.experimental),
    safeResultRules: numericDelta(current.byRiskGroup?.safe_result, previous.byRiskGroup?.safe_result),
    boundaryOnlyRules: numericDelta(current.byRiskGroup?.boundary_only, previous.byRiskGroup?.boundary_only),
    diagnosticOnlyRules: numericDelta(current.byRiskGroup?.diagnostic_only, previous.byRiskGroup?.diagnostic_only),
  };
  const currentRules = rulesByKey(current);
  const previousRules = rulesByKey(previous);
  const changedRules = [...new Set([...Object.keys(currentRules), ...Object.keys(previousRules)])]
    .sort()
    .flatMap((key) => {
      const before = previousRules[key] ?? null;
      const after = currentRules[key] ?? null;
      if (!before) return [{ key, change: "added", before: null, after }];
      if (!after) return [{ key, change: "removed", before, after: null }];
      if ((before.hitCount ?? 0) === (after.hitCount ?? 0) && before.riskGroup === after.riskGroup) return [];
      return [{
        key,
        change: "changed",
        before: { hitCount: before.hitCount ?? 0, riskGroup: before.riskGroup },
        after: { hitCount: after.hitCount ?? 0, riskGroup: after.riskGroup },
      }];
    })
    .slice(0, 200);

  const regressions = [];
  const improvements = [];
  if ((deltas.zeroHitRules.delta ?? 0) > 0) regressions.push(regression("zero_hit_rules_increased", "Zero-hit rule count increased.", deltas.zeroHitRules));
  if ((deltas.duplicatePatterns.delta ?? 0) > 0) regressions.push(regression("duplicate_patterns_increased", "Duplicate rule pattern count increased.", deltas.duplicatePatterns));
  if ((deltas.experimentalRules.delta ?? 0) > 0) regressions.push(regression("experimental_rules_increased", "Experimental-risk rule count increased.", deltas.experimentalRules));
  if ((deltas.zeroHitRules.delta ?? 0) < 0) improvements.push(regression("zero_hit_rules_decreased", "Zero-hit rule count decreased.", deltas.zeroHitRules));
  if ((deltas.hitRules.delta ?? 0) > 0) improvements.push(regression("hit_rules_increased", "Hit rule count increased.", deltas.hitRules));
  if ((deltas.duplicatePatterns.delta ?? 0) < 0) improvements.push(regression("duplicate_patterns_decreased", "Duplicate rule pattern count decreased.", deltas.duplicatePatterns));

  return {
    available: true,
    warning: null,
    deltas,
    regressions,
    improvements,
    changedRules,
  };
}

function rulesByKey(baseline) {
  const rows = [
    ...(baseline.topHitRules ?? []),
    ...(baseline.zeroHitRulesList ?? []),
    ...(baseline.resultImpactRules ?? []),
    ...(baseline.boundaryImpactRules ?? []),
  ];
  const byKey = {};
  for (const row of rows) {
    if (!row?.key) continue;
    byKey[row.key] = row;
  }
  return byKey;
}

function numericDelta(current, previous) {
  const currentNumber = Number.isFinite(current) ? current : null;
  const previousNumber = Number.isFinite(previous) ? previous : null;
  return {
    current: currentNumber,
    previous: previousNumber,
    delta: currentNumber !== null && previousNumber !== null ? currentNumber - previousNumber : null,
  };
}

function regression(code, message, delta) {
  return { code, message, delta };
}

async function archiveExistingBaseline(filePath, targetDir) {
  if (hasFlag("--no-history")) return null;
  try {
    const existing = JSON.parse(await readFile(filePath, "utf8"));
    const generatedAt = String(existing.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
    await mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `rule-quality-baseline-${generatedAt}.json`);
    await copyFile(filePath, targetPath);
    return targetPath;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}
