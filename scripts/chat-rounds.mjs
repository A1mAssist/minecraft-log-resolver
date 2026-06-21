import { writeFile } from "node:fs/promises";
import { analyzeChatEvents } from "../src/parser/chatEventAnalyzer.mjs";
import { listRuleSets } from "../src/parser/chatRules.mjs";
import { buildRoundsByFile, isReliableRound } from "../src/parser/roundBuilder.mjs";
import { formatDuration } from "../src/parser/time.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? resolveConfigPath(configContext, args[outIndex + 1]) : null;
const topIndex = args.indexOf("--top");
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 40;
const jsonOut = args.includes("--json");
const listRules = args.includes("--list-rules");
const encodingIndex = args.indexOf("--encoding");
const encoding = encodingIndex >= 0 ? args[encodingIndex + 1] : config.encoding;
const chatCachePath = resolveConfigPath(configContext, readOption("--chat-cache") ?? config.cache.chat);
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const optionValueIndexes = new Set();
for (const optionName of ["--scope", "--out", "--top", "--encoding", "--rule", "--config", "--chat-cache", "--chat-lines-cache"]) {
  args.forEach((arg, index) => {
    if (arg === optionName) optionValueIndexes.add(index + 1);
  });
}

const scopeValues = args
  .flatMap((arg, index) => (arg === "--scope" ? [args[index + 1]] : []))
  .filter(Boolean);
const ruleValues = args
  .flatMap((arg, index) => (arg === "--rule" ? [args[index + 1]] : []))
  .filter(Boolean);
const roots = args.filter((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));
const selectedRoots = roots.length ? roots : config.roots;

if (listRules) {
  console.table(listRuleSets());
  process.exit(0);
}

if (!selectedRoots.length) {
  console.error("Usage: npm.cmd run chat:rounds -- <path-to-.minecraft> [more roots...] [--scope <scope>] [--rule <rule-set>] [--out <file>]");
  process.exit(1);
}

const eventResult = await analyzeChatEvents(selectedRoots, {
  scope: scopeValues.length ? scopeValues : null,
  ruleSets: ruleValues.length ? ruleValues : config.rules.length ? config.rules : null,
  encoding,
  customRulePaths: config.customRules.map((value) => resolveConfigPath(configContext, value)),
  cachePath: chatCachePath,
  chatLinesCachePath,
  ownerAliases: config.owner.aliases,
});
const rounds = buildRoundsByFile(eventResult.events, { ownerAliases: config.owner.aliases });
const reliableRounds = rounds.filter(isReliableRound);

const totals = {
  rounds: rounds.length,
  reliableRounds: reliableRounds.length,
  kills: reliableRounds.reduce((total, round) => total + round.kills, 0),
  deaths: reliableRounds.reduce((total, round) => total + round.deaths, 0),
  bedDestroys: reliableRounds.reduce((total, round) => total + round.bedDestroys, 0),
  selfKills: reliableRounds.reduce((total, round) => total + round.selfKills, 0),
  selfDeaths: reliableRounds.reduce((total, round) => total + round.selfDeaths, 0),
  selfBedDestroys: reliableRounds.reduce((total, round) => total + round.selfBedDestroys, 0),
  durationSeconds: reliableRounds.reduce((total, round) => total + round.durationSeconds, 0),
  ignoredRounds: rounds.length - reliableRounds.length,
};

const rawTotals = {
  kills: rounds.reduce((total, round) => total + round.kills, 0),
  deaths: rounds.reduce((total, round) => total + round.deaths, 0),
  bedDestroys: rounds.reduce((total, round) => total + round.bedDestroys, 0),
  selfKills: rounds.reduce((total, round) => total + round.selfKills, 0),
  selfDeaths: rounds.reduce((total, round) => total + round.selfDeaths, 0),
  selfBedDestroys: rounds.reduce((total, round) => total + round.selfBedDestroys, 0),
  durationSeconds: rounds.reduce((total, round) => total + round.durationSeconds, 0),
};

const payload = {
  roots: selectedRoots,
  encoding,
  ruleSets: ruleValues.length ? ruleValues : config.rules.length ? config.rules : "all",
  generatedAt: new Date().toISOString(),
  eventTotals: eventResult.totals,
  eventCounts: eventResult.counts,
  totals,
  rawTotals,
  rounds,
};

if (outPath) {
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.error(`Wrote ${outPath}`);
}

if (jsonOut) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.table({
    rounds: totals.rounds,
    reliableRounds: totals.reliableRounds,
    ignoredRounds: totals.ignoredRounds,
    duration: formatDuration(totals.durationSeconds),
    kills: totals.kills,
    deaths: totals.deaths,
    bedDestroys: totals.bedDestroys,
    selfKills: totals.selfKills,
    selfDeaths: totals.selfDeaths,
    selfBedDestroys: totals.selfBedDestroys,
  });
  console.table(
    reliableRounds.slice(0, top).map((round) => ({
      source: round.source,
      scope: round.scope,
      duration: formatDuration(round.durationSeconds),
      kills: round.kills,
      deaths: round.deaths,
      beds: round.bedDestroys,
      selfK: round.selfKills,
      selfD: round.selfDeaths,
      selfBeds: round.selfBedDestroys,
      reason: round.endReason,
      confidence: round.confidence,
    })),
  );
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
