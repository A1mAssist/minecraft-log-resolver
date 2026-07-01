import { discoverLogFiles, discoverMinecraftLogScopes } from "./discovery.mjs";
import { parseLine } from "./lineParser.mjs";
import { readLogLines } from "./reader.mjs";
import { createTimestampResolver } from "./time.mjs";
import { getCachedFile, loadParseCache, saveParseCache, setCachedFile, touchCache } from "./cache.mjs";

const CHAT_LINE_CACHE_SIGNATURE = "chat-lines-v2";

export async function collectChatLines(roots, options = {}) {
  const result = await collectChatLinesByFile(roots, options);
  return {
    totals: result.totals,
    lines: flattenChatLineGroups(result.linesByFile),
  };
}

export async function collectChatLinesByFile(roots, options = {}) {
  const cache = await loadParseCache(options.cachePath);
  const started = process.hrtime.bigint();
  const totals = {
    roots: roots.length,
    scopes: 0,
    files: 0,
    chatLines: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheSkippedFiles: 0,
    durationMs: null,
  };
  const linesByFile = new Map();
  let filesDone = 0;
  let filesTotal = 0;
  const discoveredScopes = options.discoveredScopes
    ?? await discoverMinecraftLogScopes(roots, { scope: options.scope });
  totals.scopes = discoveredScopes.length;
  totals.files = discoveredScopes.reduce((total, scope) => total + (scope.files?.length ?? 0), 0);
  filesTotal = totals.files;

  for (const root of roots) {
    const scopes = discoveredScopes.filter((scope) => scope.root === root);

    for (const scope of scopes) {
      const files = scope.files ?? await discoverLogFiles(scope);
      for (const file of files) {
        options.onProgress?.({
          phase: "extract_chat_lines",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
        const cachedResult = options.cachePath
          ? getCachedFile(cache, file, {
              encoding: options.encoding,
              cacheSignature: CHAT_LINE_CACHE_SIGNATURE,
            })
          : null;
        const fileResult = compactFileResult(cachedResult ?? (await extractChatLinesFromFile(scope, file, options)));

        if (cachedResult) {
          totals.cacheHits += 1;
          totals.cacheSkippedFiles += 1;
          if (fileResult !== cachedResult) {
            setCachedFile(cache, file, fileResult, {
              encoding: options.encoding,
              cacheSignature: CHAT_LINE_CACHE_SIGNATURE,
            });
          }
        } else {
          totals.cacheMisses += 1;
          if (options.cachePath) {
            setCachedFile(cache, file, fileResult, {
              encoding: options.encoding,
              cacheSignature: CHAT_LINE_CACHE_SIGNATURE,
            });
          }
        }

        totals.chatLines += fileResult.lines.length;
        linesByFile.set(file.path, enrichChatLines(scope, file, fileResult.lines));
        filesDone += 1;
        options.onProgress?.({
          phase: "extract_chat_lines",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
      }
    }
  }

  touchCache(cache);
  await saveParseCache(options.cachePath, cache);
  totals.durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  return { totals, linesByFile };
}

async function extractChatLinesFromFile(scope, file, options = {}) {
  const timestampResolver = createTimestampResolver(file);
  const lines = [];
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

    lines.push({
      lineNo: rawLine.lineNo,
      timeText: parsed.timeText,
      timestampMs: timestampResolver.resolve(parsed.timeText),
      localUser,
      message,
    });
  }

  return { lines };
}

function compactFileResult(fileResult) {
  if (!fileResult?.lines) return { lines: [] };
  let changed = false;
  const lines = fileResult.lines.map((line) => {
    if ("source" in line || "scope" in line || "filePath" in line) changed = true;
    return {
      lineNo: line.lineNo,
      timeText: line.timeText,
      timestampMs: line.timestampMs,
      localUser: line.localUser,
      message: line.message,
    };
  });
  return changed ? { lines } : fileResult;
}

function enrichChatLines(scope, file, lines) {
  return lines.map((line) => ({
    source: scope.source,
    scope: scope.scope,
    filePath: file.path,
    ...line,
  }));
}

function flattenChatLineGroups(linesByFile) {
  const lines = [];
  for (const group of linesByFile.values()) lines.push(...group);
  return lines;
}

function extractLocalUser(message) {
  const match = message.match(/Setting user:\s*(?<user>\S+)/);
  return match?.groups?.user ?? null;
}
