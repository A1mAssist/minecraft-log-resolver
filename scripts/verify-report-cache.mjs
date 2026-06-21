import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const sampleScopes = [
  "SilenceFix",
  "SadHyt-1.8.9-Forge 11.15.1.2318-OptiFine_M5",
];

const reportPath = "report-cache-verify.json";
const summaryPath = "report-cache-verify-summary.json";
const chatCachePath = ".cache/chat-event-cache-verify.json";

await rm(chatCachePath, { force: true });

runReport();
let first = await readSummary();
assert.equal(first.overview.chatCacheHits, 0, "first run should be cold");
assert.ok(first.overview.chatCacheMisses > 0, "first run should create chat cache entries");

runReport();
let second = await readSummary();
assert.ok(second.overview.chatCacheHits > 0, "second run should reuse chat cache");
assert.equal(second.overview.chatCacheMisses, 0, "second run should be fully warm");

console.log(
  `report cache verification passed: ${second.overview.chatCacheHits}/${second.overview.chatCacheHits + second.overview.chatCacheMisses}`,
);

function runReport() {
  const args = [
    "scripts/report.mjs",
    ...sampleScopes.flatMap((scope) => ["--scope", scope]),
    "--out",
    reportPath,
    "--summary-out",
    summaryPath,
    "--chat-cache",
    chatCachePath,
    "--unmatched",
    "10",
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    throw new Error(`report command failed with exit code ${result.status}`);
  }
}

async function readSummary() {
  return JSON.parse(await readFile(summaryPath, "utf8"));
}
