import { writeFile } from "node:fs/promises";
import { analyzeChatEvents } from "../src/parser/chatEventAnalyzer.mjs";
import { listRuleSets } from "../src/parser/chatRules.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? resolveConfigPath(configContext, args[outIndex + 1]) : null;
const topIndex = args.indexOf("--top");
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 80;
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
  console.error("Usage: npm.cmd run chat:events -- <path-to-.minecraft> [more roots...] [--scope <scope>] [--rule <rule-set>] [--out <file>]");
  process.exit(1);
}

const result = await analyzeChatEvents(selectedRoots, {
  scope: scopeValues.length ? scopeValues : null,
  ruleSets: ruleValues.length ? ruleValues : config.rules.length ? config.rules : null,
  encoding,
  customRulePaths: config.customRules.map((value) => resolveConfigPath(configContext, value)),
  cachePath: chatCachePath,
  chatLinesCachePath,
  ownerAliases: config.owner.aliases,
});

const payload = {
  roots: selectedRoots,
  encoding,
  ruleSets: ruleValues.length ? ruleValues : config.rules.length ? config.rules : "all",
  generatedAt: new Date().toISOString(),
  totals: result.totals,
  counts: result.counts,
  events: result.events,
};

if (outPath) {
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.error(`Wrote ${outPath}`);
}

if (jsonOut) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(
    `Files: ${result.totals.files}, chat lines: ${result.totals.chatLines}, matched: ${result.totals.matched}, event cache: ${result.totals.cacheHits}/${result.totals.files}`,
  );
  console.table(result.counts);
  console.table(
    result.events.slice(0, top).map((event) => ({
      source: event.source,
      scope: event.scope,
      type: event.type,
      ruleSet: event.ruleSet,
      time: event.timeText,
      payload: JSON.stringify(event.payload),
      message: event.message.slice(0, 120),
    })),
  );
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
