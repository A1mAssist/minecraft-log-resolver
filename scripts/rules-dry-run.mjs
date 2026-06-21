import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReportApiContext } from "../src/api/reportApi.mjs";
import { runRulesDryRun } from "../src/parser/ruleEcosystem.mjs";
import { resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const context = await createReportApiContext(readOption("--config") ?? undefined);
const rulePackPath = readOption("--rule-pack");
let rulePackId = readOption("--rule-pack-id");
const targetMode = readOption("--target-mode");
const full = args.includes("--full");
let rulePack = null;

if (rulePackPath) {
  if (rulePackId) {
    console.error("Use either --rule-pack <id-or-path> or --rule-pack-id <id>, not both.");
    process.exit(2);
  }
  const managedPath = path.join(context.userRulePacksPath, `${rulePackPath}.json`);
  if (isManagedRulePackId(rulePackPath) && await fileExists(managedPath)) {
    rulePackId = rulePackPath;
  } else {
    const filePath = resolveConfigPath(context.configContext, rulePackPath);
    rulePack = JSON.parse(await readFile(filePath, "utf8"));
  }
}

const result = await runRulesDryRun(context, { rulePack, rulePackId, targetMode, full });
const outPath = readOption("--out");
if (outPath) {
  const resolvedOutPath = resolveConfigPath(context.configContext, outPath);
  await mkdir(path.dirname(resolvedOutPath), { recursive: true });
  await writeFile(resolvedOutPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function isManagedRulePackId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
