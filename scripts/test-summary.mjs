import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const summaryPath = process.argv[2] ?? "report-combined-summary.json";
const summary = JSON.parse(await readFile(summaryPath, "utf8"));

assert.equal(summary.schema?.name, "minecraft-log-observatory-summary");
assert.equal(summary.schema?.version, 1);
assert.equal(summary.schema?.reportSchema?.name, "minecraft-log-observatory-report");
assert.ok(summary.generatedAt, "generatedAt is required");
assert.ok(summary.overview, "overview is required");
assert.ok(summary.rounds, "rounds is required");
assert.ok(summary.profile, "profile is required");
assert.ok(summary.accounts, "accounts is required");
assert.ok(summary.anomalies, "anomalies is required");
assert.equal(summary.overview.playerBedDestroys, summary.overview.selfBedDestroys);
assert.equal(typeof summary.overview.activityBountyClaims, "number");
assert.equal(typeof summary.overview.activityBountyGoldEarned, "number");
assert.equal(typeof summary.overview.pitBountyClaims, "number");
assert.equal(typeof summary.overview.pitBountyGoldEarned, "number");
assert.equal(summary.rounds.playerBedDestroys, summary.rounds.selfBedDestroys);
assert.equal(summary.profile.totals.playerBedDestroys, summary.profile.totals.selfBedDestroys);
assert.equal(summary.overview.activityBountyClaims, summary.profile.totals.activityBountyClaims);
assert.equal(summary.overview.activityBountyGoldEarned, summary.profile.totals.activityBountyGoldEarned);
assert.equal(summary.overview.pitBountyClaims, summary.profile.totals.pitBountyClaims);
assert.equal(summary.overview.pitBountyGoldEarned, summary.profile.totals.pitBountyGoldEarned);

console.log(`summary schema tests passed: ${summaryPath}`);
