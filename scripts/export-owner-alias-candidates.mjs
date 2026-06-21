import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { cleanChatMessage, isClientModNoiseMessage, parseChatEvent } from "../src/parser/chatRules.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";
import { normalizePlayerDisplayName, resolveServerPlayerIdentity } from "../src/report/playerIdentity.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? config.outputs.report);
const outPath = resolveConfigPath(configContext, readOption("--out") ?? "labeling/owner-alias-candidates.json");
const mdPath = resolveConfigPath(configContext, readOption("--md-out") ?? siblingMarkdownPath(outPath));
const limit = Number(readOption("--limit") ?? 80);
const selectedModes = new Set(readRepeatedOption("--mode"));
const roots = readRepeatedOption("--root");
const selectedRoots = roots.length ? roots : config.roots;
const customRuleValues = readRepeatedOption("--custom-rule");
const customRulePaths = (customRuleValues.length ? customRuleValues : config.customRules).map((value) => resolveConfigPath(configContext, value));
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const knownOwnerNames = new Set([
  ...(report.accounts?.owner?.localUsers ?? []),
  ...(report.accounts?.owner?.aliases ?? []),
].map(normalizeName));
const unknownRounds = (report.rounds?.reliable ?? [])
  .filter((round) => round.result === "unknown")
  .filter((round) => !selectedModes.size || selectedModes.has(round.gameMode));

const chatLinesResult = await collectChatLines(selectedRoots, {
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});
const linesByFile = groupBy(chatLinesResult.lines, (line) => line.filePath);
const candidates = new Map();

for (const round of unknownRounds) {
  const identity = readIdentity(round);
  const fileLines = linesByFile.get(round.filePath) ?? [];
  const endMs = round.endMs ?? round.lastEventMs ?? round.startMs;
  const windowLines = fileLines.filter((line) => line.timestampMs >= round.startMs && line.timestampMs <= endMs + 20_000);
  for (const line of windowLines) {
    if (isClientModNoiseMessage(line.message)) continue;
    const event = parseChatEvent(line.message, {
      ruleSets: config.rules.length ? config.rules : null,
      customRulePaths,
    });
    if (!event) continue;

    const cleaned = cleanChatMessage(line.message);
    if (event.type === "round_end" && event.ruleId === "zh_player_won_on_map" && sameNormalizedPlayer(event.payload?.winner, identity.serverPlayerId)) {
      addCandidate(event.payload?.winner, "winner_on_map", round, line, cleaned);
    }
    if (event.type === "kill" && event.payload?.killer) {
      addCandidate(event.payload.killer, "killer_in_unknown_round", round, line, cleaned, 0.25);
    }
    if (event.type === "bed_destroy" && event.payload?.player) {
      addCandidate(event.payload.player, "bed_destroyer_in_unknown_round", round, line, cleaned, 0.5);
    }
  }
}

for (const line of chatLinesResult.lines) {
  if (isClientModNoiseMessage(line.message)) continue;
  for (const name of extractOwnChatNames(cleanChatMessage(line.message))) {
    addCandidate(name, "own_chat_name", null, line, cleanChatMessage(line.message), 2);
  }
}

const rows = [...candidates.values()]
  .map((row) => ({
    ...row,
    score: Number((row.score + Math.min(row.evidence.length, 10) * 0.1).toFixed(2)),
    sources: [...row.sources].sort(),
    scopes: [...row.scopes].sort(),
    files: [...row.files].sort(),
  }))
  .sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name))
  .slice(0, limit);

const result = {
  generatedAt: new Date().toISOString(),
  reportPath,
  selectedModes: selectedModes.size ? [...selectedModes] : "all",
  knownOwnerNames: [...knownOwnerNames].sort(),
  totals: {
    unknownRounds: unknownRounds.length,
    candidates: rows.length,
    chatLineCache: {
      files: chatLinesResult.totals.files,
      hits: chatLinesResult.totals.cacheHits,
      misses: chatLinesResult.totals.cacheMisses,
    },
  },
  policy: "This export is diagnostic only. Add confirmed names to owner.aliases manually; no similarity-based alias detection is applied.",
  candidates: rows,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
await mkdir(path.dirname(mdPath), { recursive: true });
await writeFile(mdPath, renderMarkdown(result), "utf8");
console.log(JSON.stringify({ outPath, mdPath, totals: result.totals }, null, 2));

function addCandidate(name, reason, round, line, text, scoreWeight = 1) {
  const cleanName = normalizeDisplayName(name);
  const normalized = normalizeName(cleanName);
  if (!normalized || knownOwnerNames.has(normalized)) return;
  if (isLowSignalName(cleanName)) return;

  const current = candidates.get(normalized) ?? {
    name: cleanName,
    normalized,
    count: 0,
    score: 0,
    reasons: {},
    sources: new Set(),
    scopes: new Set(),
    files: new Set(),
    evidence: [],
  };
  current.count += 1;
  current.score += scoreWeight;
  current.reasons[reason] = (current.reasons[reason] ?? 0) + 1;
  if (line?.source) current.sources.add(line.source);
  if (line?.scope) current.scopes.add(line.scope);
  if (line?.filePath) current.files.add(line.filePath);
  if (current.evidence.length < 8) {
    current.evidence.push({
      reason,
      source: line?.source ?? round?.source ?? null,
      scope: line?.scope ?? round?.scope ?? null,
      filePath: line?.filePath ?? round?.filePath ?? null,
      lineNo: line?.lineNo ?? null,
      timeText: line?.timeText ?? null,
      roundKey: round?.key ?? null,
      roundMode: round?.gameMode ?? null,
      text,
    });
  }
  candidates.set(normalized, current);
}

function extractOwnChatNames(text) {
  const names = [];
  const teamMatch = text.match(/^<[^>]+?队[>?]?(?<name>[A-Za-z0-9_]{3,16})[:>]/);
  if (teamMatch?.groups?.name) names.push(teamMatch.groups.name);
  const plainMatch = text.match(/^<(?<name>[A-Za-z0-9_]{3,16})>/);
  if (plainMatch?.groups?.name) names.push(plainMatch.groups.name);
  const parenthesizedMatch = text.match(/^\(\d+\)\s*<(?<name>[A-Za-z0-9_]{3,16})>/);
  if (parenthesizedMatch?.groups?.name) names.push(parenthesizedMatch.groups.name);
  return names;
}

function normalizeDisplayName(value) {
  return String(value ?? "")
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

function normalizeName(value) {
  return normalizeDisplayName(value).toLowerCase();
}

function sameNormalizedPlayer(left, right) {
  const normalizedLeft = normalizePlayerDisplayName(left)?.toLowerCase() ?? null;
  const normalizedRight = normalizePlayerDisplayName(right)?.toLowerCase() ?? null;
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function readIdentity(round) {
  if ("serverPlayerId" in round) {
    return {
      serverPlayerId: round.serverPlayerId ?? null,
    };
  }
  return resolveServerPlayerIdentity(round);
}

function isLowSignalName(name) {
  if (!name) return true;
  if (name.length > 32) return true;
  if (/^(?:red|blue|green|yellow|aqua|white|pink|gray|grey|players?)$/i.test(name)) return true;
  if (/^[红蓝绿黄青白粉灰]色?/.test(name)) return true;
  if (/[<>]|>>|经验|硬币|队伍|胜利|失败|地图/.test(name)) return true;
  return false;
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function siblingMarkdownPath(filePath) {
  return filePath.replace(/\.json$/i, ".md");
}

function renderMarkdown(result) {
  const lines = [
    "# Owner Alias Candidates",
    "",
    `Generated at: ${result.generatedAt}`,
    `Unknown rounds scanned: ${result.totals.unknownRounds}`,
    `Candidates exported: ${result.totals.candidates}`,
    `Chat cache: ${result.totals.chatLineCache.hits}/${result.totals.chatLineCache.files}`,
    "",
    result.policy,
    "",
  ];

  for (const [index, candidate] of result.candidates.entries()) {
    lines.push(`## ${index + 1}. ${candidate.name}`);
    lines.push(`- score: ${candidate.score}`);
    lines.push(`- count: ${candidate.count}`);
    lines.push(`- reasons: ${JSON.stringify(candidate.reasons)}`);
    lines.push(`- scopes: ${candidate.scopes.slice(0, 5).join(", ") || "none"}`);
    lines.push("");
    lines.push("```text");
    for (const evidence of candidate.evidence) {
      lines.push(`L${String(evidence.lineNo ?? "").padStart(7, " ")} ${evidence.timeText ?? ""} [${evidence.reason}] ${evidence.text}`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
