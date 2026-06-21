import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeMinecraftRoots } from "../src/parser/analyzer.mjs";
import { analyzeChatEvents } from "../src/parser/chatEventAnalyzer.mjs";
import { buildRoundsByFile } from "../src/parser/roundBuilder.mjs";
import { buildReport, createReportSummary } from "../src/report/reportBuilder.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outPath = resolveConfigPath(configContext, readOption("--out") ?? config.outputs.report);
const summaryOutPath = resolveConfigPath(configContext, readOption("--summary-out") ?? config.outputs.summary);
const unmatchedOutPath = readOption("--unmatched-out")
  ? resolveConfigPath(configContext, readOption("--unmatched-out"))
  : null;
const cachePath = resolveConfigPath(configContext, readOption("--cache") ?? config.cache.parse);
const chatCachePath = resolveConfigPath(configContext, readOption("--chat-cache") ?? config.cache.chat);
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);
const encoding = readOption("--encoding") ?? config.encoding;
const unmatchedTemplatesLimit = Number(readOption("--unmatched") ?? config.unmatchedTemplatesLimit);
const scopeValues = readRepeatedOption("--scope");
const ruleValues = readRepeatedOption("--rule");
const selectedScopes = scopeValues.length ? scopeValues : config.scopes;
const selectedRules = ruleValues.length ? ruleValues : config.rules;
const customRuleValues = readRepeatedOption("--custom-rule");
const customRulePaths = (customRuleValues.length ? customRuleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));

const optionValueIndexes = new Set();
for (const optionName of ["--scope", "--rule", "--custom-rule", "--out", "--summary-out", "--unmatched-out", "--cache", "--chat-cache", "--chat-lines-cache", "--encoding", "--unmatched", "--config"]) {
  args.forEach((arg, index) => {
    if (arg === optionName) optionValueIndexes.add(index + 1);
  });
}

const cliRoots = args.filter((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));
const roots = cliRoots.length ? cliRoots : config.roots;

if (!roots.length) {
  console.error("Usage: npm.cmd run report -- <path-to-.minecraft> [more roots...] [--scope <scope>] [--rule <rule-set>] [--out <file>]");
  process.exit(1);
}

await maybeDelayForRefreshTest();
maybeFailForRefreshTest();

console.error("Analyzing sessions and playtime...");
emitProgress({ phase: "scan", message: "Analyzing sessions and playtime", percent: 10 });
const summaries = await analyzeMinecraftRoots(roots, {
  scope: selectedScopes.length ? selectedScopes : null,
  cachePath,
  encoding,
  onProgress: emitProgress,
});

console.error("Analyzing chat events and rule coverage...");
emitProgress({ phase: "parse", message: "Analyzing chat events and rule coverage", percent: 35 });
const eventResult = await analyzeChatEvents(roots, {
  scope: selectedScopes.length ? selectedScopes : null,
  ruleSets: selectedRules.length ? selectedRules : null,
  customRulePaths,
  encoding,
  unmatchedTemplatesLimit,
  cachePath: chatCachePath,
  chatLinesCachePath,
  ownerAliases: config.owner.aliases,
  onProgress: emitProgress,
});

console.error("Building rounds and final report...");
emitProgress({ phase: "build_report", message: "Building rounds and final report", percent: 65, currentFile: null });
const rounds = buildRoundsByFile([...eventResult.events, ...buildRoundTransitionEvents(summaries)], { ownerAliases: config.owner.aliases });
const report = buildReport({
  roots,
  encoding,
  ruleSets: selectedRules.length ? selectedRules : null,
  customRulePaths,
  owner: config.owner,
  summaries,
  eventResult,
  rounds,
});
const summary = createReportSummary(report);

await writeJson(outPath, report);
console.error(`Wrote ${outPath}`);
emitProgress({ phase: "build_report", message: `Wrote ${outPath}`, percent: 75, currentFile: null });

if (summaryOutPath) {
  await writeJson(summaryOutPath, summary);
  console.error(`Wrote ${summaryOutPath}`);
  emitProgress({ phase: "build_report", message: `Wrote ${summaryOutPath}`, percent: 80, currentFile: null });
}

if (unmatchedOutPath) {
  await writeJson(unmatchedOutPath, buildUnmatchedDebugExport(report));
  console.error(`Wrote ${unmatchedOutPath}`);
  emitProgress({ phase: "build_report", message: `Wrote ${unmatchedOutPath}`, percent: 82, currentFile: null });
}

if (jsonOut) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.table(summary.overview);
  console.table(summary.confidence);
  console.table(summary.topScopes);
  console.table(summary.topDays);
  console.table(summary.anomalies.crashyScopes);
  console.table(summary.anomalies.unmatchedTemplates);
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function emitProgress(progress) {
  if (!jsonOut) return;
  console.error(`@@MLO_PROGRESS@@${JSON.stringify(progress)}`);
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

async function maybeDelayForRefreshTest() {
  const delayMs = Number(process.env.MLO_REPORT_TEST_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 30000)));
}

function maybeFailForRefreshTest() {
  if (process.env.MLO_REPORT_TEST_FAIL !== "1") return;
  console.error("MLO_REPORT_TEST_FAIL requested; failing report refresh.");
  process.exit(1);
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function buildUnmatchedDebugExport(report) {
  const templates = report.anomalies.unmatchedTemplates.map((template) => ({
    ...template,
    priority: priorityForTemplate(template),
    ruleDraft: buildRuleDraft(template),
  }));

  return {
    generatedAt: report.generatedAt,
    roots: report.roots,
    encoding: report.encoding,
    selectedRuleSets: report.selectedRuleSets,
    categories: report.rules.topUnmatchedByCategory ?? report.rules.unmatchedByCategory,
    templates: templates.sort((a, b) => b.priority - a.priority || b.count - a.count),
  };
}

function buildRoundTransitionEvents(summaries) {
  return summaries.flatMap((summary) => summary.transitionEvents ?? []);
}

function priorityForTemplate(template) {
  const categoryWeight = {
    possible_combat: 100,
    possible_bedwars_objective: 95,
    possible_round_state: 90,
    possible_presence: 55,
    possible_reward: 25,
    unknown: 10,
    separator_noise: 0,
    client_mod_noise: 0,
  };
  return (categoryWeight[template.category] ?? 10) + Math.min(50, Math.floor(template.count / 100));
}

function buildRuleDraft(template) {
  const suggestedTypes = {
    possible_combat: ["kill", "death"],
    possible_bedwars_objective: ["bed_destroy", "team_eliminated"],
    possible_round_state: ["round_start", "round_win", "round_loss"],
    possible_presence: ["player_join", "player_leave"],
    possible_reward: ["reward"],
    client_mod_noise: [],
    separator_noise: [],
    unknown: [],
  }[template.category] ?? [];

  return {
    suggestedTypes,
    patternHint: templateToRegexHint(template.template),
    notes: notesForTemplate(template),
  };
}

function templateToRegexHint(template) {
  const counts = {};
  let cursor = 0;
  let pattern = "";
  for (const match of template.matchAll(/<player>|<num>|<heart>|<item>|<empty>/g)) {
    pattern += escapeRegex(template.slice(cursor, match.index));
    pattern += patternForToken(match[0], counts);
    cursor = match.index + match[0].length;
  }
  pattern += escapeRegex(template.slice(cursor));
  return `^${pattern}$`;
}

function patternForToken(token, counts) {
  const tokenNames = {
    "<player>": "player",
    "<num>": "number",
    "<heart>": "hearts",
    "<item>": "item",
  };
  if (token === "<empty>") return "\\s*";

  const baseName = tokenNames[token] ?? "value";
  counts[baseName] = (counts[baseName] ?? 0) + 1;
  const name = counts[baseName] === 1 ? baseName : `${baseName}${counts[baseName]}`;
  const body = token === "<num>" ? "\\d+" : token === "<heart>" ? "[0-9.]+" : ".+?";
  return `(?<${name}>${body})`;
}

function notesForTemplate(template) {
  if (template.category === "client_mod_noise" || template.category === "separator_noise") {
    return ["Probably ignore unless this message marks a real gameplay boundary."];
  }
  if (template.category.startsWith("possible_")) {
    return ["Review examples before promoting this into a global rule.", "Prefer named capture groups only for values used by stats."];
  }
  return ["No obvious rule type inferred yet."];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
