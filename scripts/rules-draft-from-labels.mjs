import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRulePackDraftFromLabels,
  VALID_REVIEW_LABELS,
  validateLabelRows,
  validateLabelRowsAgainstReport,
} from "../src/parser/ruleEcosystem.mjs";
import { validateRuleSetDefinition } from "../src/parser/chatRules.mjs";
import { readLabelRows } from "./label-file-io.mjs";

const args = process.argv.slice(2);
const inputPath = readOption("--input");
if (!inputPath) {
  console.error("Usage: npm.cmd run rules:draft-from-labels -- --input labeling/reviewed.jsonl [--out custom-rules/user/draft.json]");
  process.exit(1);
}

const labels = await readLabelRows(inputPath);
const reportPath = readOption("--report");
const labelValidation = reportPath
  ? validateLabelRowsAgainstReport(labels, JSON.parse(await readFile(reportPath, "utf8")))
  : validateLabelRows(labels);
if (labelValidation.errors.length) {
  console.error(JSON.stringify({
    ok: false,
    error: "invalid_label_rows",
    message: "Label rows contain unsupported review labels.",
    allowed: VALID_REVIEW_LABELS,
    checkedRoundRefs: labelValidation.checkedRoundRefs ?? 0,
    errors: labelValidation.errors,
  }, null, 2));
  process.exit(1);
}
const rulePack = buildRulePackDraftFromLabels(labels, {
  id: readOption("--id") ?? undefined,
  name: readOption("--name") ?? undefined,
});
const errors = validateRuleSetDefinition(rulePack, "<draft-from-labels>");
const result = {
  ok: errors.length === 0,
  inputPath,
  labels: labels.length,
  rules: rulePack.rules.length,
  errors,
  rulePack,
};

const outPath = readOption("--out");
if (outPath) {
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(rulePack, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
