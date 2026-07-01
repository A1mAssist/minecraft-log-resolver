import { spawn } from "node:child_process";
import path from "node:path";
import { loadAppConfig, resolveConfigPath, resolveStoreDir } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configOption = readOption("--config");
const configContext = await loadAppConfig(configOption ?? undefined);
const config = configContext.config;
const configPath = configContext.path;
const reportPath = resolveConfigPath(configContext, readOption("--out") ?? config.outputs.report);
const summaryPath = resolveConfigPath(configContext, readOption("--summary-out") ?? config.outputs.summary);
const storeDir = readOption("--store-out-dir")
  ? resolveConfigPath(configContext, readOption("--store-out-dir"))
  : resolveStoreDir(configContext);
const performanceOut = readOption("--performance-out")
  ? resolveConfigPath(configContext, readOption("--performance-out"))
  : path.join(resolveConfigPath(configContext, "artifacts"), "performance-baseline-current.json");

await runNode("scripts/report.mjs", [
  "--config",
  configPath,
  "--out",
  reportPath,
  "--summary-out",
  summaryPath,
]);

await runNode("scripts/export-store.mjs", [
  "--config",
  configPath,
  "--report",
  reportPath,
  "--out-dir",
  storeDir,
]);

await runNode("scripts/performance-baseline.mjs", [
  "--config",
  configPath,
  "--out",
  performanceOut,
]);

console.log(JSON.stringify({
  ok: true,
  reportPath,
  summaryPath,
  storeDir,
  performanceOut,
}, null, 2));

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function runNode(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${script} exited with code ${code}.`));
    });
  });
}
