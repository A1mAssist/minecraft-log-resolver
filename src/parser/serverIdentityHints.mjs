import { normalizePlayerDisplayName } from "../report/playerIdentity.mjs";

const TASK_PROGRESS_KILL_ALIAS_WINDOW_MS = 3 * 1000;

export function buildServerIdentityHintsByFile(events) {
  const grouped = new Map();
  for (const event of events ?? []) {
    const key = fileKey(event);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  const hintsByFile = new Map();
  for (const [key, fileEvents] of grouped) {
    const hints = buildServerIdentityHints(fileEvents);
    if (hints.length) hintsByFile.set(key, hints);
  }
  return hintsByFile;
}

export function buildServerIdentityHints(events) {
  const ordered = [...(events ?? [])]
    .filter((event) => event.timestampMs !== null && event.timestampMs !== undefined)
    .sort((a, b) => a.timestampMs - b.timestampMs || eventSortPriority(a) - eventSortPriority(b) || a.lineNo - b.lineNo);

  const hints = [];
  let currentSegment = null;
  const recentKills = [];

  function ensureSegment(event) {
    if (!currentSegment) {
      currentSegment = {
        source: event.source,
        scope: event.scope,
        filePath: event.filePath,
        startMs: event.timestampMs,
        endMs: Number.POSITIVE_INFINITY,
        players: {},
        evidence: [],
      };
    }
    return currentSegment;
  }

  function closeSegment(event) {
    if (!currentSegment) return;
    currentSegment.endMs = event.timestampMs;
    maybeAddHint(hints, currentSegment);
    currentSegment = null;
  }

  for (const event of ordered) {
    if (isSegmentBoundary(event)) {
      closeSegment(event);
      recentKills.length = 0;
      if (event.type === "server_connect") ensureSegment(event);
      continue;
    }

    if (event.type === "kill") {
      recentKills.push(event);
      trimRecentKills(recentKills, event.timestampMs);
    }

    const playerEvidence = playerEvidenceFromEvent(event, recentKills);
    if (playerEvidence) {
      const segment = ensureSegment(event);
      addPlayerEvidence(segment, playerEvidence.player, event, playerEvidence.kind, playerEvidence.details);
    }
  }

  if (currentSegment) maybeAddHint(hints, currentSegment);
  return hints;
}

export function serverPlayerIdForEvent(event, hints = []) {
  const matching = hints.filter((hint) =>
    hint.player &&
    hint.source === event.source &&
    hint.scope === event.scope &&
    hint.filePath === event.filePath &&
    event.timestampMs >= hint.startMs &&
    event.timestampMs <= hint.endMs
  );
  if (matching.length !== 1) return null;
  return matching[0].player;
}

export function annotateSelfWithServerPlayer(event, serverPlayerId) {
  if (!serverPlayerId) return event.self ?? {};
  const payload = event.payload ?? {};
  return {
    ...(event.self ?? {}),
    kill: Boolean(event.self?.kill || (event.type === "kill" && samePlayer(payload.killer, serverPlayerId))),
    death: Boolean(event.self?.death || (["kill", "death"].includes(event.type) && samePlayer(payload.victim, serverPlayerId))),
    bedDestroy: Boolean(event.self?.bedDestroy || (event.type === "bed_destroy" && samePlayer(payload.player, serverPlayerId))),
  };
}

function playerEvidenceFromEvent(event, recentKills) {
  if (isMapRatingPrompt(event) && event.payload?.player) {
    return {
      kind: "map_rating_prompt",
      player: event.payload.player,
      details: { map: event.payload?.map ?? null },
    };
  }

  if (isKillTaskProgress(event)) {
    const killEvent = findRecentKillBeforeEvent(recentKills, event);
    if (killEvent?.payload?.killer) {
      return {
        kind: "kill_task_progress",
        player: killEvent.payload.killer,
        details: {
          task: event.payload?.task ?? null,
          killLineNo: killEvent.lineNo ?? null,
        },
      };
    }
  }

  return null;
}

function maybeAddHint(hints, segment) {
  const player = uniquePositiveKey(segment.players);
  if (!player) return;
  hints.push({
    source: segment.source,
    scope: segment.scope,
    filePath: segment.filePath,
    startMs: segment.startMs,
    endMs: segment.endMs,
    player,
    evidence: segment.evidence,
  });
}

function addPlayerEvidence(segment, rawPlayer, event, kind, details = {}) {
  const player = normalizePlayerDisplayName(rawPlayer);
  if (!player) return;
  segment.players[player] = (segment.players[player] ?? 0) + 1;
  segment.evidence.push({
    kind,
    player,
    timestampMs: event.timestampMs,
    lineNo: event.lineNo,
    ruleSet: event.ruleSet ?? null,
    ruleId: event.ruleId ?? null,
    ...details,
  });
}

function findRecentKillBeforeEvent(recentKills, event) {
  for (let index = recentKills.length - 1; index >= 0; index -= 1) {
    const candidate = recentKills[index];
    if (candidate.timestampMs > event.timestampMs) continue;
    if (candidate.timestampMs === event.timestampMs && candidate.lineNo >= event.lineNo) continue;
    if (event.timestampMs - candidate.timestampMs > TASK_PROGRESS_KILL_ALIAS_WINDOW_MS) return null;
    return candidate;
  }
  return null;
}

function trimRecentKills(recentKills, timestampMs) {
  while (recentKills.length && timestampMs - recentKills[0].timestampMs > TASK_PROGRESS_KILL_ALIAS_WINDOW_MS) {
    recentKills.shift();
  }
}

function isSegmentBoundary(event) {
  return ["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash"].includes(event.type);
}

function isMapRatingPrompt(event) {
  return event?.ruleId === "zh_hyt_map_rating_prompt";
}

function isKillTaskProgress(event) {
  return event?.type === "task_progress" && /击杀任务|鍑绘潃浠诲姟/.test(String(event.payload?.task ?? ""));
}

function samePlayer(left, right) {
  const normalizedLeft = normalizePlayerDisplayName(left)?.toLowerCase() ?? null;
  const normalizedRight = normalizePlayerDisplayName(right)?.toLowerCase() ?? null;
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function uniquePositiveKey(counts = {}) {
  const keys = Object.keys(counts).filter((key) => counts[key] > 0);
  return keys.length === 1 ? keys[0] : null;
}

function fileKey(event) {
  if (!event?.source || !event?.scope || !event?.filePath) return null;
  return `${event.source}\0${event.scope}\0${event.filePath}`;
}

function eventSortPriority(event) {
  if (event.type === "server_connect") return 0;
  if (event.type === "kill") return 10;
  if (event.type === "task_progress") return 20;
  if (event.type === "round_end") return 30;
  if (isSegmentBoundary(event)) return 90;
  return 50;
}
