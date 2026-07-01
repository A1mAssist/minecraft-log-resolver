import { discoverLogFiles, discoverMinecraftLogScopes } from "./discovery.mjs";
import { parseLine } from "./lineParser.mjs";
import { readLogLines } from "./reader.mjs";
import { getRuleSignature, isClientModNoiseMessage, parseChatEvent } from "./chatRules.mjs";
import { normalizeChatMessage } from "./chatTemplates.mjs";
import { firstKnownGameMode, inferGameModeFromText } from "./gameModes.mjs";
import { createTimestampResolver } from "./time.mjs";
import { getCachedFile, loadParseCache, saveParseCache, setCachedFile, touchCache } from "./cache.mjs";
import { collectChatLinesByFile } from "./chatLineCache.mjs";

const CHAT_EVENT_ANALYZER_SIGNATURE = "chat-events-v6";

export async function analyzeChatEvents(roots, options = {}) {
  const cache = await loadParseCache(options.cachePath);
  const started = process.hrtime.bigint();
  const ownerAliases = normalizeOwnerAliases(options.ownerAliases);
  const cacheSignature = `${CHAT_EVENT_ANALYZER_SIGNATURE}:${getRuleSignature(options.ruleSets, { customRulePaths: options.customRulePaths, inlineRulePacks: options.inlineRulePacks })}:owner=${ownerAliases.join("\0")}`;
  const events = [];
  const counts = {};
  const ruleCounts = { byRuleSet: {}, byRuleId: {}, byRulePack: {}, byRulePackId: {} };
  const unmatchedTemplates = new Map();
  const totals = { files: 0, chatLines: 0, matched: 0, cacheHits: 0, cacheMisses: 0, cacheSkippedFiles: 0, durationMs: null };
  const unmatchedLimit = options.unmatchedTemplatesLimit ?? 0;
  let filesDone = 0;
  let filesTotal = 0;
  const discoveredScopes = options.discoveredScopes
    ?? await discoverMinecraftLogScopes(roots, { scope: options.scope });
  let chatLineResult = null;
  const chatLinesByFile = options.chatLinesCachePath
    ? (
        chatLineResult = await collectChatLinesByFile(roots, {
          scope: options.scope,
          encoding: options.encoding,
          cachePath: options.chatLinesCachePath,
          discoveredScopes,
          onProgress: options.onProgress,
        })
      ).linesByFile
    : null;
  const chatEventStarted = process.hrtime.bigint();
  filesTotal = discoveredScopes.reduce((total, scope) => total + (scope.files?.length ?? 0), 0);

  for (const root of roots) {
    const scopes = discoveredScopes.filter((scope) => scope.root === root);

    for (const scope of scopes) {
      const files = scope.files ?? await discoverLogFiles(scope);
      totals.files += files.length;

      for (const file of files) {
        options.onProgress?.({
          phase: "parse",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
        const cachedResult = options.cachePath
          ? getCachedFile(cache, file, { ...options, cacheSignature })
          : null;
        const fileResult = cachedResult ?? (chatLinesByFile
          ? analyzeChatLines(scope, file, chatLinesByFile.get(file.path) ?? [], options)
          : await analyzeChatLogFile(scope, file, options));

        if (cachedResult) {
          totals.cacheHits += 1;
          totals.cacheSkippedFiles += 1;
        } else {
          totals.cacheMisses += 1;
          if (options.cachePath) setCachedFile(cache, file, fileResult, { ...options, cacheSignature });
        }

        mergeFileResult({ fileResult, events, counts, ruleCounts, unmatchedTemplates, totals, unmatchedLimit });
        filesDone += 1;
        options.onProgress?.({
          phase: "parse",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
      }
    }
  }

  touchCache(cache);
  await saveParseCache(options.cachePath, cache);
  totals.durationMs = Number((process.hrtime.bigint() - chatEventStarted) / 1_000_000n);
  const totalDurationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);

  return {
    totals,
    diagnostics: {
      parse: {
        files: totals.files,
        chatLines: totals.chatLines,
        matched: totals.matched,
        durationMs: totalDurationMs,
      },
      chatLines: chatLineResult?.totals ?? null,
      chatEvents: { ...totals },
    },
    counts,
    ruleCounts,
    unmatchedTemplates: [...unmatchedTemplates.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, unmatchedLimit),
    events,
    chatLines: chatLinesByFile ? flattenGroupedRows(chatLinesByFile) : [],
  };
}

function flattenGroupedRows(grouped) {
  const rows = [];
  for (const value of grouped.values()) rows.push(...value);
  return rows;
}

function analyzeChatLines(scope, file, chatLines, options = {}) {
  const events = [];
  const counts = {};
  const ruleCounts = { byRuleSet: {}, byRuleId: {}, byRulePack: {}, byRulePackId: {} };
  const unmatchedTemplates = new Map();
  const totals = { chatLines: 0, matched: 0 };
  const unmatchedLimit = options.unmatchedTemplatesLimit ?? 0;

  for (const chatLine of chatLines) {
    const message = chatLine.message;
    if (!message) continue;
    if (isClientModNoiseMessage(message)) continue;

    totals.chatLines += 1;
    const event = parseChatEvent(message, { ruleSets: options.ruleSets, customRulePaths: options.customRulePaths, inlineRulePacks: options.inlineRulePacks });
    if (!event) {
      if (unmatchedLimit > 0) addUnmatchedTemplate(unmatchedTemplates, scope, message);
      continue;
    }

    totals.matched += 1;
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    ruleCounts.byRuleSet[event.ruleSet] = (ruleCounts.byRuleSet[event.ruleSet] ?? 0) + 1;
    const ruleKey = `${event.ruleSet}:${event.ruleId}`;
    ruleCounts.byRuleId[ruleKey] = (ruleCounts.byRuleId[ruleKey] ?? 0) + 1;
    const rulePack = event.rulePack ?? event.ruleSet;
    ruleCounts.byRulePack[rulePack] = (ruleCounts.byRulePack[rulePack] ?? 0) + 1;
    const rulePackKey = `${rulePack}:${event.ruleId}`;
    ruleCounts.byRulePackId[rulePackKey] = (ruleCounts.byRulePackId[rulePackKey] ?? 0) + 1;
    events.push({
      source: scope.source,
      scope: scope.scope,
      filePath: file.path,
      lineNo: chatLine.lineNo,
      timeText: chatLine.timeText,
      timestampMs: chatLine.timestampMs,
      localUser: chatLine.localUser,
      gameMode: firstKnownGameMode(event.payload?.gameMode, inferGameModeFromText(message, scope.scope, scope.source)),
      self: annotateSelf(event, chatLine.localUser, options.ownerAliases),
      ...event,
    });
  }

  return {
    totals,
    counts,
    ruleCounts,
    unmatchedTemplates: [...unmatchedTemplates.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(unmatchedLimit * 4, unmatchedLimit)),
    events,
  };
}

async function analyzeChatLogFile(scope, file, options = {}) {
  const timestampResolver = createTimestampResolver(file);
  const events = [];
  const counts = {};
  const ruleCounts = { byRuleSet: {}, byRuleId: {}, byRulePack: {}, byRulePackId: {} };
  const unmatchedTemplates = new Map();
  const totals = { chatLines: 0, matched: 0 };
  const unmatchedLimit = options.unmatchedTemplatesLimit ?? 0;
  let localUser = null;

  for await (const rawLine of readLogLines(file, { encoding: options.encoding })) {
    if (rawLine.text.includes("Setting user:")) {
      const parsed = parseLine(file.path, rawLine.lineNo, rawLine.text);
      localUser = extractLocalUser(parsed.message);
    }

    if (!rawLine.text.includes("[CHAT]") && file.kind !== "chat") continue;
    const parsed = parseLine(file.path, rawLine.lineNo, rawLine.text);
    const message = parsed.isChat ? parsed.message : rawLine.text.trim();
    if (!message) continue;
    if (isClientModNoiseMessage(message)) continue;

    totals.chatLines += 1;
    const event = parseChatEvent(message, { ruleSets: options.ruleSets, customRulePaths: options.customRulePaths, inlineRulePacks: options.inlineRulePacks });
    if (!event) {
      if (unmatchedLimit > 0) addUnmatchedTemplate(unmatchedTemplates, scope, message);
      continue;
    }

    totals.matched += 1;
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    ruleCounts.byRuleSet[event.ruleSet] = (ruleCounts.byRuleSet[event.ruleSet] ?? 0) + 1;
    const ruleKey = `${event.ruleSet}:${event.ruleId}`;
    ruleCounts.byRuleId[ruleKey] = (ruleCounts.byRuleId[ruleKey] ?? 0) + 1;
    const rulePack = event.rulePack ?? event.ruleSet;
    ruleCounts.byRulePack[rulePack] = (ruleCounts.byRulePack[rulePack] ?? 0) + 1;
    const rulePackKey = `${rulePack}:${event.ruleId}`;
    ruleCounts.byRulePackId[rulePackKey] = (ruleCounts.byRulePackId[rulePackKey] ?? 0) + 1;
    events.push({
      source: scope.source,
      scope: scope.scope,
      filePath: file.path,
      lineNo: rawLine.lineNo,
      timeText: parsed.timeText,
      timestampMs: timestampResolver.resolve(parsed.timeText),
      localUser,
      gameMode: firstKnownGameMode(event.payload?.gameMode, inferGameModeFromText(message, scope.scope, scope.source)),
      self: annotateSelf(event, localUser, options.ownerAliases),
      ...event,
    });
  }

  return {
    totals,
    counts,
    ruleCounts,
    unmatchedTemplates: [...unmatchedTemplates.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(unmatchedLimit * 4, unmatchedLimit)),
    events,
  };
}

function mergeFileResult({ fileResult, events, counts, ruleCounts, unmatchedTemplates, totals, unmatchedLimit }) {
  totals.chatLines += fileResult.totals.chatLines;
  totals.matched += fileResult.totals.matched;
  mergeCounts(counts, fileResult.counts);
  mergeCounts(ruleCounts.byRuleSet, fileResult.ruleCounts.byRuleSet);
  mergeCounts(ruleCounts.byRuleId, fileResult.ruleCounts.byRuleId);
  mergeCounts(ruleCounts.byRulePack, fileResult.ruleCounts.byRulePack);
  mergeCounts(ruleCounts.byRulePackId, fileResult.ruleCounts.byRulePackId);
  events.push(...fileResult.events);

  if (unmatchedLimit > 0) {
    for (const template of fileResult.unmatchedTemplates) {
      mergeUnmatchedTemplate(unmatchedTemplates, template);
    }
  }
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function extractLocalUser(message) {
  const match = message.match(/Setting user:\s*(?<user>\S+)/);
  return match?.groups?.user ?? null;
}

export function annotateSelf(event, localUser, ownerAliases = []) {
  const ownerNames = new Set([localUser, ...normalizeOwnerAliases(ownerAliases)].filter(Boolean).map(normalizeOwnerName));
  if (!ownerNames.size) return {};
  const payload = event.payload ?? {};
  return {
    kill: event.type === "kill" && ownerNames.has(normalizeOwnerName(payload.killer)),
    death: ["kill", "death"].includes(event.type) && ownerNames.has(normalizeOwnerName(payload.victim)),
    bedDestroy: event.type === "bed_destroy" && ownerNames.has(normalizeOwnerName(payload.player)),
  };
}

function normalizeOwnerAliases(aliases = []) {
  return [...new Set(Array.from(aliases ?? []).map((alias) => String(alias).trim()).filter(Boolean))].sort();
}

function normalizeOwnerName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function addUnmatchedTemplate(templates, scope, message) {
  const template = normalizeChatMessage(message);
  const key = `${scope.source}\0${scope.scope}\0${template}`;
  const current = templates.get(key) ?? {
    source: scope.source,
    scope: scope.scope,
    template,
    count: 0,
    examples: [],
  };
  current.count += 1;
  if (current.examples.length < 3 && !current.examples.includes(message)) {
    current.examples.push(message);
  }
  templates.set(key, current);
}

function mergeUnmatchedTemplate(templates, template) {
  const key = `${template.source}\0${template.scope}\0${template.template}`;
  const current = templates.get(key) ?? {
    source: template.source,
    scope: template.scope,
    template: template.template,
    count: 0,
    examples: [],
  };
  current.count += template.count;
  for (const example of template.examples ?? []) {
    if (current.examples.length >= 3) break;
    if (!current.examples.includes(example)) current.examples.push(example);
  }
  templates.set(key, current);
}
