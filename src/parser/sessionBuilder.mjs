const MAX_REASONABLE_SESSION_SECONDS = 18 * 3600;
const MAX_REASONABLE_SEGMENT_SECONDS = 10 * 3600;

function durationSeconds(startMs, endMs) {
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function isReasonable(startMs, endMs, maxSeconds) {
  return startMs !== null && endMs !== null && durationSeconds(startMs, endMs) <= maxSeconds;
}

export function buildTimeline(events) {
  const ordered = events
    .filter((event) => event.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs || a.lineNo - b.lineNo);

  const clientSessions = [];
  const playSegments = [];
  let currentSession = null;
  let currentSegment = null;
  let pendingConnect = null;

  function closeSegment(endEvent, reason) {
    if (!currentSegment) return;
    const endMs = endEvent.timestampMs;
    currentSegment.endMs = endMs;
    currentSegment.endReason = reason;
    currentSegment.durationSeconds = durationSeconds(currentSegment.startMs, endMs);
    currentSegment.confidence = isReasonable(currentSegment.startMs, endMs, MAX_REASONABLE_SEGMENT_SECONDS)
      ? "inferred"
      : "low";
    playSegments.push(currentSegment);
    currentSegment = null;
  }

  function closeSession(endEvent, reason) {
    if (!currentSession) return;
    if (currentSegment) closeSegment(endEvent, reason);
    const endMs = endEvent.timestampMs;
    currentSession.endMs = endMs;
    currentSession.endReason = reason;
    currentSession.durationSeconds = durationSeconds(currentSession.startMs, endMs);
    currentSession.confidence = isReasonable(currentSession.startMs, endMs, MAX_REASONABLE_SESSION_SECONDS)
      ? "exact"
      : "low";
    clientSessions.push(currentSession);
    currentSession = null;
  }

  for (const event of ordered) {
    if (event.type === "client_start") {
      if (currentSession) closeSession(event, "next_client_start");
      currentSession = {
        scope: event.scope,
        localUser: event.localUser ?? null,
        startMs: event.timestampMs,
        endMs: null,
        durationSeconds: 0,
        confidence: "partial",
        endReason: null,
        startFile: event.filePath,
      };
      pendingConnect = null;
      continue;
    }

    if (!currentSession && ["server_connect", "player_joined", "chat_message"].includes(event.type)) {
      currentSession = {
        scope: event.scope,
        localUser: event.localUser ?? null,
        startMs: event.timestampMs,
        endMs: null,
        durationSeconds: 0,
        confidence: "partial",
        endReason: null,
        startFile: event.filePath,
      };
    }

    if (event.type === "server_connect") {
      pendingConnect = event;
      if (!currentSegment) {
        currentSegment = {
          scope: event.scope,
          localUser: event.localUser ?? currentSession?.localUser ?? null,
          type: "multiplayer",
          startMs: event.timestampMs,
          endMs: null,
          durationSeconds: 0,
          confidence: "partial",
          endReason: null,
          startFile: event.filePath,
          serverAddress: event.payload?.serverAddress ?? null,
          serverHost: event.payload?.serverHost ?? null,
          serverPort: event.payload?.serverPort ?? null,
          serverConnectLineNo: event.lineNo ?? null,
          serverConnectMessage: event.message ?? null,
        };
      } else {
        currentSegment.serverAddress ??= event.payload?.serverAddress ?? null;
        currentSegment.serverHost ??= event.payload?.serverHost ?? null;
        currentSegment.serverPort ??= event.payload?.serverPort ?? null;
        currentSegment.serverConnectLineNo ??= event.lineNo ?? null;
        currentSegment.serverConnectMessage ??= event.message ?? null;
      }
      continue;
    }

    if (event.type === "player_joined") {
      if (!currentSegment) {
        currentSegment = {
          scope: event.scope,
          localUser: event.localUser ?? currentSession?.localUser ?? null,
          type: pendingConnect ? "multiplayer" : "singleplayer",
          startMs: pendingConnect?.timestampMs ?? event.timestampMs,
          endMs: null,
          durationSeconds: 0,
          confidence: "partial",
          endReason: null,
          startFile: event.filePath,
          serverAddress: pendingConnect?.payload?.serverAddress ?? null,
          serverHost: pendingConnect?.payload?.serverHost ?? null,
          serverPort: pendingConnect?.payload?.serverPort ?? null,
          serverConnectLineNo: pendingConnect?.lineNo ?? null,
          serverConnectMessage: pendingConnect?.message ?? null,
        };
      }
      pendingConnect = null;
      continue;
    }

    if (event.type === "player_left" || event.type === "singleplayer_stop") {
      closeSegment(event, event.type);
      pendingConnect = null;
      continue;
    }

    if (event.type === "client_stop") {
      closeSession(event, "client_stop");
      pendingConnect = null;
      continue;
    }

    if (event.type === "crash") {
      closeSession(event, "crash");
      pendingConnect = null;
    }
  }

  const lastEvent = ordered.at(-1);
  if (lastEvent) {
    if (currentSegment) closeSegment(lastEvent, "last_event");
    if (currentSession) closeSession(lastEvent, "last_event");
  }

  return { clientSessions, playSegments };
}
