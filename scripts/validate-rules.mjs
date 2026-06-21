import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadCustomRuleSets, validateRuleSetDefinition } from "../src/parser/chatRules.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const ruleValues = readRepeatedOption("--rule-file");
const rulePaths = (ruleValues.length ? ruleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));

const files = rulePaths.flatMap(expandRulePath);
const results = [];
let errors = 0;

for (const filePath of files) {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    const validationErrors = validateRuleSetDefinition(raw, filePath);
    if (validationErrors.length) {
      errors += validationErrors.length;
      results.push({ filePath, ok: false, errors: validationErrors });
    } else {
      results.push({ filePath, ok: true, id: raw.id, rules: raw.rules.length });
    }
  } catch (error) {
    errors += 1;
    results.push({ filePath, ok: false, errors: [error.message] });
  }
}

try {
  loadCustomRuleSets(rulePaths);
} catch (error) {
  errors += 1;
  results.push({ filePath: "<compile>", ok: false, errors: [error.message] });
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ ok: errors === 0, files: files.length, results }, null, 2));
} else {
  console.table(results.map((result) => ({
    filePath: result.filePath,
    ok: result.ok,
    id: result.id ?? "",
    rules: result.rules ?? "",
    errors: result.errors?.join("; ") ?? "",
  })));
}

if (errors > 0) process.exit(1);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function expandRulePath(rulePath) {
  const resolved = path.resolve(rulePath);
  const fileStat = statSync(resolved);
  if (!fileStat.isDirectory()) return [resolved];
  return readdirSync(resolved)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => path.join(resolved, fileName));
}
