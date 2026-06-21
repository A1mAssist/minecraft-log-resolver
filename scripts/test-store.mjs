import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const storeDir = process.argv[2] ?? path.resolve("data", "report-store");
const manifest = JSON.parse(await readFile(path.join(storeDir, "manifest.json"), "utf8"));

assert.equal(manifest.schema?.name, "minecraft-log-observatory-store");
assert.equal(manifest.schema?.version, 1);
assert.ok(manifest.reportGeneratedAt, "reportGeneratedAt is required");
assert.ok(manifest.files.profile, "profile file is required");
assert.ok(manifest.files.metricDefinitions, "metric definitions file is required");
assert.ok(manifest.files.activity, "activity file is required");
assert.ok(manifest.files.activitySegments, "activity segments file is required");
assert.ok(manifest.files.reliableRounds, "reliable rounds file is required");
assert.ok(manifest.files.scopesIndex, "scopes index file is required");

const overview = JSON.parse(await readFile(path.join(storeDir, manifest.files.overview), "utf8"));
assert.ok(Number.isFinite(overview.sessions), "overview.sessions must be numeric");
assert.ok(Number.isFinite(overview.playerMaxKillStreak), "overview.playerMaxKillStreak must be numeric");
assert.ok(overview.winStreaks?.breakUnknown, "overview.winStreaks.breakUnknown is required");
assert.ok(overview.winStreaks?.skipUnknown, "overview.winStreaks.skipUnknown is required");

const profile = JSON.parse(await readFile(path.join(storeDir, manifest.files.profile), "utf8"));
const metricDefinitions = JSON.parse(await readFile(path.join(storeDir, manifest.files.metricDefinitions), "utf8"));
const activity = JSON.parse(await readFile(path.join(storeDir, manifest.files.activity), "utf8"));
const scopesIndex = JSON.parse(await readFile(path.join(storeDir, manifest.files.scopesIndex), "utf8"));
const accountsIndex = JSON.parse(await readFile(path.join(storeDir, manifest.files.accountsIndex), "utf8"));
const modesIndex = JSON.parse(await readFile(path.join(storeDir, manifest.files.modesIndex), "utf8"));
const reliableRounds = await readJsonl(path.join(storeDir, manifest.files.reliableRounds));
const ignoredRounds = await readJsonl(path.join(storeDir, manifest.files.ignoredRounds));
const activitySegments = await readJsonl(path.join(storeDir, manifest.files.activitySegments));
const byDay = await readJsonl(path.join(storeDir, manifest.files.byDay));

assert.equal(metricDefinitions.playerMaxKillStreak.scope, "player");
assert.equal(metricDefinitions.observedBroadcastMaxKillStreak.scope, "observed_server_chat");
assert.equal(metricDefinitions.playerBedDestroys.scope, "player");
assert.equal(metricDefinitions.goldEarned.unit, "gold");
assert.equal(metricDefinitions.xpEarned.unit, "xp");
assert.equal(metricDefinitions.bountyClaims.scope, "player");
assert.equal(metricDefinitions.bountyGoldEarned.unit, "gold");
assert.equal(reliableRounds.length, manifest.counts.reliableRounds);
assert.equal(ignoredRounds.length, manifest.counts.ignoredRounds);
assert.ok(reliableRounds.every((round) =>
  round.playerBedDestroys === (round.selfBedDestroys ?? 0) &&
  typeof round.playerMaxKillStreak === "number" &&
  typeof round.rewardEvents === "number" &&
  typeof round.streakPoints === "number" &&
  typeof round.goldEarned === "number" &&
  typeof round.xpEarned === "number" &&
  typeof round.bountyClaims === "number" &&
  typeof round.bountyGoldEarned === "number" &&
  "serverNetwork" in round &&
  "serverAddress" in round &&
  typeof round.serverLabel === "string" &&
  ["direct", "inferred", "unknown"].includes(round.serverConfidence) &&
  round.serverEvidence &&
  typeof round.serverEvidence.source === "string"
), "reliable round store rows must include server display fields");
const pitReliableRound = reliableRounds.find((round) => round.roundKind === "activity" && round.gameMode === "the_pit");
if (pitReliableRound) {
  assert.equal(pitReliableRound.result, "not_applicable");
  assert.equal(pitReliableRound.resultEligible, false);
  assert.equal(typeof pitReliableRound.rewardEvents, "number");
  assert.equal(typeof pitReliableRound.streakPoints, "number");
  assert.equal(typeof pitReliableRound.goldEarned, "number");
  assert.equal(typeof pitReliableRound.xpEarned, "number");
  assert.equal(typeof pitReliableRound.bountyClaims, "number");
  assert.equal(typeof pitReliableRound.bountyGoldEarned, "number");
}
assert.equal(activitySegments.length, manifest.counts.activitySegments);
assert.ok(activitySegments.every((segment) =>
  typeof segment.playerMaxKillStreak === "number" &&
  typeof segment.observedBroadcastMaxKillStreak === "number" &&
  typeof segment.rewardEvents === "number" &&
  typeof segment.goldEarned === "number" &&
  typeof segment.xpEarned === "number" &&
  typeof segment.bountyClaims === "number" &&
  typeof segment.bountyGoldEarned === "number"
), "activity segment rows must include player and observed-broadcast streak fields");
assert.equal(byDay.length, manifest.counts.byDay);
assert.equal(accountsIndex.length, manifest.counts.accounts + 1);
assert.equal(modesIndex.length, manifest.counts.modes);
assert.equal(new Set(modesIndex.map((mode) => mode.id)).size, modesIndex.length, "mode index ids must be unique");
assert.ok(modesIndex.every((mode) => typeof mode.modeId === "string" && ["round", "activity"].includes(mode.kind)), "mode index rows must include modeId and kind");
const pitRoundMode = modesIndex.find((mode) => mode.id === "round:the_pit");
const bedwarsRoundMode = modesIndex.find((mode) => mode.id === "round:bedwars");
if (bedwarsRoundMode) {
  assert.equal(bedwarsRoundMode.playerBedDestroys, bedwarsRoundMode.selfBedDestroys);
  assert.equal(typeof bedwarsRoundMode.playerMaxKillStreak, "number");
}
if (pitRoundMode) {
  assert.equal(pitRoundMode.kind, "round");
  assert.equal(pitRoundMode.modeId, "the_pit");
  assert.equal(pitRoundMode.resultEligible, 0);
  assert.equal(pitRoundMode.notApplicableResults, pitRoundMode.rounds);
}
const pitActivityMode = modesIndex.find((mode) => mode.id === "activity:the_pit");
if (pitActivityMode) {
  assert.equal(typeof pitActivityMode.playerMaxKillStreak, "number");
  assert.equal(typeof pitActivityMode.observedBroadcastMaxKillStreak, "number");
  assert.equal(typeof pitActivityMode.rewardEvents, "number");
  assert.equal(typeof pitActivityMode.goldEarned, "number");
  assert.equal(typeof pitActivityMode.xpEarned, "number");
  assert.equal(typeof pitActivityMode.bountyClaims, "number");
  assert.equal(typeof pitActivityMode.bountyGoldEarned, "number");
}
assert.ok(scopesIndex.length > 0, "scopes index must not be empty");
assert.ok(profile.totals, "profile.totals is required");
assert.ok(profile.streaks?.win?.breakUnknown, "profile win streaks are required");
assert.equal(typeof profile.streaks?.playerMaxKillStreak?.count, "number");
assert.ok(profile.days, "profile.days is required");
assert.ok(profile.preferences, "profile.preferences is required");
assert.ok(profile.identities, "profile.identities is required");
assert.ok(activity.summary, "activity.summary is required");
assert.equal(typeof activity.summary.playerMaxKillStreak, "number");
assert.equal(typeof activity.summary.observedBroadcastMaxKillStreak, "number");
assert.equal(typeof activity.summary.rewardEvents, "number");
assert.equal(typeof activity.summary.goldEarned, "number");
assert.equal(typeof activity.summary.xpEarned, "number");
assert.equal(typeof activity.summary.bountyClaims, "number");
assert.equal(typeof activity.summary.bountyGoldEarned, "number");

console.log(`store tests passed: ${storeDir}`);

async function readJsonl(filePath) {
  const text = await readFile(filePath, "utf8");
  return text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}
