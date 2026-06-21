import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "mlo-rule-quality-"));
try {
  const firstPath = path.join(tempDir, "baseline-first.json");
  const secondPath = path.join(tempDir, "baseline-second.json");
  const first = runBaseline(["--out", firstPath, "--history-dir", path.join(tempDir, "history")]);
  assert.equal(first.status, 0, first.stderr);
  const firstBaseline = JSON.parse(await readFile(firstPath, "utf8"));
  assert.equal(firstBaseline.schema?.name, "minecraft-log-observatory-rule-quality-baseline");
  assert.equal(firstBaseline.schema?.version, 1);
  assert.equal(firstBaseline.privacy, "privacy-safe");
  assert.equal(firstBaseline.quality.totalRules, 169);
  assert.equal(firstBaseline.quality.hitRules + firstBaseline.quality.zeroHitRules, firstBaseline.quality.totalRules);
  assert.ok(Array.isArray(firstBaseline.quality.zeroHitRulesList));
  assert.ok(Array.isArray(firstBaseline.quality.resultImpactRules));
  assert.ok(Array.isArray(firstBaseline.quality.boundaryImpactRules));
  assert.equal(firstBaseline.comparison.available, false);
  assert.equal(firstBaseline.comparison.warning.code, "previous_rule_quality_baseline_missing");

  const second = runBaseline([
    "--out",
    secondPath,
    "--previous",
    firstPath,
    "--history-dir",
    path.join(tempDir, "history"),
  ]);
  assert.equal(second.status, 0, second.stderr);
  const secondBaseline = JSON.parse(await readFile(secondPath, "utf8"));
  assert.equal(secondBaseline.comparison.available, true);
  assert.equal(secondBaseline.comparison.warning, null);
  assert.equal(secondBaseline.comparison.deltas.totalRules.delta, 0);
  assert.equal(secondBaseline.comparison.deltas.zeroHitRules.delta, 0);
  assert.ok(Array.isArray(secondBaseline.comparison.regressions));
  assert.ok(Array.isArray(secondBaseline.comparison.improvements));
  assert.ok(Array.isArray(secondBaseline.comparison.changedRules));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("rule quality baseline tests passed");

function runBaseline(args) {
  return spawnSync(process.execPath, ["scripts/rules-quality-baseline.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
