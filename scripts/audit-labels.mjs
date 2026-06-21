import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { buildLabelReviewSummary } from "../src/parser/ruleEcosystem.mjs";
import { readLabelRows } from "./label-file-io.mjs";

const args = process.argv.slice(2);
const inputPath = readOption("--input");
if (!inputPath) {
  console.error("Usage: npm.cmd run result:audit-labels -- --input labeling/reviewed.jsonl [--report report-combined.json] [--out artifacts/audit-labels-summary.json]");
  process.exit(1);
}

const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const resolvedInputPath = resolveConfigPath(configContext, inputPath);
const labels = await readLabelRows(resolvedInputPath);
const validateRoundRefs = !hasFlag("--no-validate-round-refs");
const reportPath = readOption("--report");
const report = validateRoundRefs
  ? JSON.parse(await readFile(resolveConfigPath(configContext, reportPath ?? configContext.config.outputs.report), "utf8"))
  : null;
const summary = buildLabelReviewSummary(labels, {
  validateRoundRefs,
  report,
  sampleLimit: Number(readOption("--sample-limit") ?? 25),
});

const result = {
  ...summary,
  inputPath: resolvedInputPath,
  sourceReport: validateRoundRefs ? resolveConfigPath(configContext, reportPath ?? configContext.config.outputs.report) : null,
};

const outPath = readOption("--out");
if (outPath) {
  const resolvedOutPath = resolveConfigPath(configContext, outPath);
  await mkdir(path.dirname(resolvedOutPath), { recursive: true });
  await writeFile(resolvedOutPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  ok: result.ok,
  inputPath: result.inputPath,
  totalRows: result.totalRows,
  labeledRows: result.labeledRows,
  checkedRoundRefs: result.checkedRoundRefs,
  errors: result.errors.length,
  byLabel: result.byLabel,
  byCategory: result.byCategory,
  candidates: result.candidates,
  missingRuleTextRows: result.missingRuleTextRows,
  writes: result.writes,
}, null, 2));

if (!result.ok) process.exit(1);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}
