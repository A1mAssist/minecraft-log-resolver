import { readFile } from "node:fs/promises";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { buildLabelReviewReadiness, buildLabelReviewSummary } from "../src/parser/ruleEcosystem.mjs";
import { readLabelRows } from "./label-file-io.mjs";

const args = process.argv.slice(2);
const inputPath = readOption("--input");
if (!inputPath) {
  console.error("Usage: npm.cmd run result:audit-status -- --input labeling/reviewed.jsonl [--report report-combined.json] [--no-validate-round-refs]");
  process.exit(2);
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
  sampleLimit: Number(readOption("--sample-limit") ?? 10),
});

const readiness = buildLabelReviewReadiness(summary);
const result = {
  ok: summary.ok,
  generatedAt: new Date().toISOString(),
  privacy: "privacy-safe",
  inputPath: formatPath(resolvedInputPath, configContext.dir),
  sourceReport: validateRoundRefs ? formatPath(resolveConfigPath(configContext, reportPath ?? configContext.config.outputs.report), configContext.dir) : null,
  status: readiness.status,
  nextStep: readiness.nextStep,
  blocked: readiness.blocked,
  blockingReason: readiness.blockingReason,
  requiresHumanInput: readiness.requiresHumanInput,
  canDraftRules: readiness.canDraftRules,
  canRunDryRun: readiness.canRunDryRun,
  canArchive: readiness.canArchive,
  nextCommand: readiness.nextCommand,
  readyForWorkflow: readiness.readyForWorkflow,
  workflowRecommended: readiness.workflowRecommended,
  counts: {
    totalRows: summary.totalRows,
    labeledRows: summary.labeledRows,
    unlabeledRows: summary.unlabeledRows,
    actionableRows: summary.candidates.actionableRows,
    draftableRuleRows: summary.candidates.draftableRuleRows,
    missingRuleTextRows: summary.candidates.missingRuleTextRows,
    errors: summary.errors.length,
  },
  byLabel: summary.byLabel,
  byCategory: summary.byCategory,
  byNextAction: summary.byNextAction,
  nextActions: readiness.nextActions,
  errors: summary.errors.slice(0, 10),
  missingRuleTextRows: summary.missingRuleTextRows,
  writes: {
    report: false,
    store: false,
    config: false,
    rules: false,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function formatPath(filePath, root) {
  const relative = root ? relativePath(root, filePath) : null;
  return relative ?? filePath;
}

function relativePath(root, target) {
  const relative = target.startsWith(root) ? target.slice(root.length).replace(/^[/\\]/, "") : "";
  if (!relative || relative.startsWith("..")) return null;
  return relative.replaceAll("\\", "/");
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}
