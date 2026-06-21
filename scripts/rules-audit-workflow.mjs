import path from "node:path";
import { createReportApiContext } from "../src/api/reportApi.mjs";
import { resolveConfigPath } from "../src/config/appConfig.mjs";
import { runAuditLabelWorkflow } from "../src/parser/auditWorkflow.mjs";
import { readLabelRows } from "./label-file-io.mjs";

const args = process.argv.slice(2);
const inputPath = readOption("--input");
if (!inputPath) {
  console.error("Usage: npm.cmd run rules:audit-workflow -- --input labeling/reviewed.jsonl [--target-mode bedwars] [--out-dir artifacts/unknown-audit-workflows] [--prefix reviewed-bedwars]");
  process.exit(2);
}

const context = await createReportApiContext(readOption("--config") ?? undefined);
const resolvedInputPath = resolveConfigPath(context.configContext, inputPath);
const labels = await readLabelRows(resolvedInputPath);
const outDir = resolveConfigPath(context.configContext, readOption("--out-dir") ?? path.join("artifacts", "unknown-audit-workflows"));
const result = await runAuditLabelWorkflow(context, labels, {
  id: readOption("--id") ?? undefined,
  name: readOption("--name") ?? undefined,
  targetMode: readOption("--target-mode") ?? undefined,
  full: hasFlag("--full"),
  skipDryRun: hasFlag("--skip-dry-run"),
  validateRoundRefs: !hasFlag("--no-validate-round-refs"),
  writeArtifacts: true,
  outDir,
  prefix: readOption("--prefix") ?? undefined,
});

console.log(JSON.stringify({
  ok: result.ok,
  status: result.workflow?.status,
  inputPath: resolvedInputPath,
  rows: result.input.rows,
  labelErrors: result.labelSummary?.errors?.length ?? 0,
  missingRuleTextRows: result.labelSummary?.candidates?.missingRuleTextRows ?? 0,
  draftRules: result.draft?.rules ?? 0,
  dryRunStatus: result.dryRun?.promotionGate?.status ?? null,
  roundChanges: result.dryRun?.roundChanges?.total ?? null,
  risks: (result.dryRun?.risks ?? []).map((risk) => risk.code),
  artifactSummary: result.artifactSummary ?? null,
  artifacts: result.artifacts,
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
