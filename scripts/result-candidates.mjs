import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { normalizeChatMessage } from "../src/parser/chatTemplates.mjs";
import { isClientModNoiseMessage, parseChatEvent } from "../src/parser/chatRules.mjs";
import { inferGameModeFromText } from "../src/parser/gameModes.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outPath = resolveConfigPath(configContext, readOption("--out") ?? "result-candidates.json");
const limit = Number(readOption("--limit") ?? 300);
const roots = readRepeatedOption("--root");
const selectedRoots = roots.length ? roots : config.roots;
const selectedScopes = readRepeatedOption("--scope");
const scopeFilter = selectedScopes.length ? new Set(selectedScopes) : null;
const customRuleValues = readRepeatedOption("--custom-rule");
const customRulePaths = (customRuleValues.length ? customRuleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const candidates = new Map();
const matchedEvents = {};
const totals = {
  roots: selectedRoots.length,
  scopes: 0,
  files: 0,
  chatLines: 0,
  candidateLines: 0,
  chatLineCacheHits: 0,
  chatLineCacheMisses: 0,
};

const chatLinesResult = await collectChatLines(selectedRoots, {
  scope: scopeFilter ? selectedScopes : null,
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});

totals.scopes = chatLinesResult.totals.scopes;
totals.files = chatLinesResult.totals.files;
totals.chatLines = chatLinesResult.totals.chatLines;
totals.chatLineCacheHits = chatLinesResult.totals.cacheHits;
totals.chatLineCacheMisses = chatLinesResult.totals.cacheMisses;

for (const chatLine of chatLinesResult.lines) {
  if (isClientModNoiseMessage(chatLine.message)) continue;
  scanChatLine(chatLine);
}

const rows = [...candidates.values()]
  .sort((a, b) => b.priority - a.priority || b.count - a.count)
  .slice(0, limit);

const result = {
  generatedAt: new Date().toISOString(),
  roots: selectedRoots,
  encoding: config.encoding,
  totals,
  matchedEvents,
  categories: countBy(rows, "category", "count"),
  modes: countBy(rows, "gameMode", "count"),
  candidates: rows,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ outPath, totals, categories: result.categories, modes: result.modes }, null, 2));

function scanChatLine(chatLine) {
  const message = chatLine.message;
  const cleaned = cleanMessage(message);
  const template = normalizeChatMessage(cleaned);
  if (!looksLikeResultCandidate(template)) return;

  totals.candidateLines += 1;
  const event = parseChatEvent(message, {
    ruleSets: config.rules.length ? config.rules : null,
    customRulePaths,
  });
  if (event) matchedEvents[event.type] = (matchedEvents[event.type] ?? 0) + 1;

  const category = classifyCandidate(template);
  const gameMode = inferGameModeFromText(cleaned, chatLine.scope, chatLine.source);
  const key = `${category}\0${chatLine.source}\0${chatLine.scope}\0${template}`;
  const current = candidates.get(key) ?? {
    category,
    gameMode,
    source: chatLine.source,
    scope: chatLine.scope,
    template,
    count: 0,
    matchedType: event?.type ?? null,
    matchedRule: event ? `${event.ruleSet}:${event.ruleId}` : null,
    priority: priority(category, event?.type),
    examples: [],
  };
  current.count += 1;
  current.priority += Math.min(1, current.count / 1000);
  if (current.examples.length < 5 && !current.examples.includes(cleaned)) {
    current.examples.push(cleaned);
  }
  candidates.set(key, current);
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function cleanMessage(message) {
  return message
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeResultCandidate(message) {
  return /victory|defeat|winner|winners|winning team|you won|you lost|you lose|game over|placed #|you placed|you died|you survived|survivors|seekers|hiders|murderer|innocents|draw|tie|胜利|失败|获胜|胜者|赢家|赢了|输了|战败|游戏结束|排名|第\s*\d+\s*名/i.test(message);
}

function classifyCandidate(message) {
  if (/victory|you won|you survived|胜利|获胜|赢了/i.test(message)) return "explicit_win";
  if (/defeat|you lost|you lose|你输了|失败|战败/i.test(message)) return "explicit_loss";
  if (/winner|winners|winning team|胜者|赢家|获胜者|获胜队伍/i.test(message)) return "winner_announcement";
  if (/game over|游戏结束/i.test(message)) return "game_over";
  if (/placed #|you placed|排名|第\s*\d+\s*名/i.test(message)) return "placement";
  if (/you died|murderer|innocents|survivors|seekers|hiders/i.test(message)) return "role_result";
  if (/draw|tie|平局/i.test(message)) return "draw";
  return "unknown_result_signal";
}

function priority(category, matchedType) {
  const weights = {
    explicit_win: 100,
    explicit_loss: 100,
    winner_announcement: 80,
    game_over: 70,
    placement: 65,
    role_result: 60,
    draw: 50,
    unknown_result_signal: 10,
  };
  return (weights[category] ?? 10) + (matchedType ? 5 : 0);
}

function countBy(rows, key, valueKey) {
  const counts = {};
  for (const row of rows) {
    counts[row[key] ?? "unknown"] = (counts[row[key] ?? "unknown"] ?? 0) + (row[valueKey] ?? 1);
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}
