import { discoverLogFiles, discoverScopes } from "./discovery.mjs";
import { eventTypes, extractEvents, hasEventSignal } from "./events.mjs";
import { parseLine } from "./lineParser.mjs";
import { readLogLines } from "./reader.mjs";
import { buildTimeline } from "./sessionBuilder.mjs";
import { createTimestampResolver } from "./time.mjs";
import { getCachedFile, loadParseCache, saveParseCache, setCachedFile, touchCache } from "./cache.mjs";

function emptyEvents() {
  return Object.fromEntries(eventTypes.map((type) => [type, 0]));
}

export async function analyzeMinecraftRoot(root, options = {}) {
  const scopeFilter = options.scope ? new Set(options.scope) : null;
  let scopes = await discoverScopes(root);
  if (scopeFilter) {
    scopes = scopes.filter((scope) => scopeFilter.has(scope.scope));
  }
  const summaries = [];

  for (const scope of scopes) {
    const files = await discoverLogFiles(scope);
    options.onFilesDiscovered?.(files.length);
    const summary = {
      root: scope.root,
      source: scope.source,
      scope: scope.scope,
      logFiles: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      latestModifiedMs: files.reduce((latest, file) => Math.max(latest, file.modifiedMs), 0),
      events: emptyEvents(),
      clientSessions: [],
      playSegments: [],
      transitionEvents: [],
      cache: { hits: 0, misses: 0 },
    };

    for (const file of files) {
      options.onFileStart?.(file, scope);
      const cachedResult = options.cache ? getCachedFile(options.cache, file, options) : null;
      const fileResult = cachedResult ?? (await analyzeLogFile(file, options));
      if (cachedResult) {
        summary.cache.hits += 1;
      } else {
        summary.cache.misses += 1;
        if (options.cache) setCachedFile(options.cache, file, fileResult, options);
      }

      for (const eventType of eventTypes) {
        summary.events[eventType] += fileResult.events[eventType] ?? 0;
      }
      summary.clientSessions.push(...fileResult.clientSessions);
      summary.playSegments.push(...fileResult.playSegments);
      summary.transitionEvents.push(...(fileResult.transitionEvents ?? []));
      options.onFileDone?.(file, scope);
    }

    summaries.push(summary);
  }

  return summaries.sort((a, b) => b.events.chat_message - a.events.chat_message);
}

export async function analyzeMinecraftRoots(roots, options = {}) {
  const cache = await loadParseCache(options.cachePath);
  const cacheSignature = "session-local-user-v4";
  const allSummaries = [];
  let filesDone = 0;
  let filesTotal = 0;
  for (const root of roots) {
    const summaries = await analyzeMinecraftRoot(root, {
      ...options,
      cache,
      cacheSignature,
      onFilesDiscovered: (count) => {
        filesTotal += count;
      },
      onFileStart: (file) => {
        options.onProgress?.({
          phase: "scan",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
      },
      onFileDone: (file) => {
        filesDone += 1;
        options.onProgress?.({
          phase: "scan",
          currentFile: file.path,
          filesDone,
          filesTotal,
        });
      },
    });
    allSummaries.push(...summaries);
  }
  touchCache(cache);
  await saveParseCache(options.cachePath, cache);
  return allSummaries.sort((a, b) => b.events.chat_message - a.events.chat_message);
}

async function analyzeLogFile(file, options = {}) {
  const timestampResolver = createTimestampResolver(file);
  const fileEvents = [];
  const transitionEvents = [];
  const events = emptyEvents();
  let localUser = null;

  for await (const rawLine of readLogLines(file, { encoding: options.encoding })) {
    if (!hasEventSignal(rawLine.text)) continue;
    const parsedLine = parseLine(file.path, rawLine.lineNo, rawLine.text);
    if (parsedLine.message.includes("Setting user:")) {
      localUser = extractLocalUser(parsedLine.message);
    }
    for (const event of extractEvents(file.scope, parsedLine)) {
      events[event.type] += 1;
      const enrichedEvent = {
        ...event,
        source: file.source,
        localUser,
        timestampMs: timestampResolver.resolve(event.timeText),
      };
      fileEvents.push(enrichedEvent);
      if (isRoundTransitionEvent(enrichedEvent)) {
        transitionEvents.push(compactTransitionEvent(enrichedEvent));
      }
    }
  }

  const timeline = buildTimeline(fileEvents);
  return {
    events,
    localUser,
    clientSessions: timeline.clientSessions,
    playSegments: timeline.playSegments,
    transitionEvents,
  };
}

function isRoundTransitionEvent(event) {
  return [
    "client_start",
    "client_stop",
    "server_connect",
    "player_left",
    "singleplayer_stop",
    "crash",
  ].includes(event.type);
}

function compactTransitionEvent(event) {
  return {
    source: event.source,
    scope: event.scope,
    filePath: event.filePath,
    lineNo: event.lineNo,
    timeText: event.timeText,
    timestampMs: event.timestampMs,
    localUser: event.localUser,
    type: event.type,
    message: event.message,
    payload: event.payload ?? {},
    self: {},
    ruleSet: "session",
    ruleId: event.type,
    gameMode: "unknown",
  };
}

function extractLocalUser(message) {
  const match = message.match(/Setting user:\s*(?<user>\S+)/);
  return match?.groups?.user ?? null;
}
