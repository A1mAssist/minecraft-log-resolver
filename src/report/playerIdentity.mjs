export function resolveServerPlayerIdentity(row = {}) {
  const launcherUser = row.launcherUser ?? row.localUser ?? row.sessionAlias ?? null;
  const launcherUsers = normalizeCountObject(row.launcherUsers ?? row.localUsers ?? (launcherUser ? { [launcherUser]: 1 } : {}));
  const directServerPlayerIds = normalizePlayerIdCounts(row.ownerAliasesUsed ?? row.directServerPlayerIds ?? {});
  const existingServerPlayerIds = normalizePlayerIdCounts(row.serverPlayerIds ?? {});
  const propagatedServerPlayerIds = normalizePlayerIdCounts(row.propagatedServerPlayerIds ?? {});
  const explicitCounts = hasCounts(directServerPlayerIds) ? directServerPlayerIds : existingServerPlayerIds;
  const explicitBest = bestCountKey(explicitCounts);
  const propagatedBest = bestCountKey(propagatedServerPlayerIds);
  const context = inferServerIdentityContext(row);

  if (explicitBest) {
    const candidateCount = Object.keys(explicitCounts).length;
    return {
      launcherUser,
      launcherUsers,
      serverPlayerId: explicitBest,
      serverPlayerIds: explicitCounts,
      serverPlayerIdSource: "direct_self_event",
      serverPlayerIdConfidence: candidateCount === 1 ? "high" : "medium",
      serverIdentityContext: context,
      serverPlayerIdPolicy: "server_chat_self_evidence",
    };
  }

  if (propagatedBest) {
    const candidateCount = Object.keys(propagatedServerPlayerIds).length;
    return {
      launcherUser,
      launcherUsers,
      serverPlayerId: propagatedBest,
      serverPlayerIds: propagatedServerPlayerIds,
      serverPlayerIdSource: "play_segment_propagation",
      serverPlayerIdConfidence: candidateCount === 1 ? "high" : "medium",
      serverIdentityContext: context,
      serverPlayerIdPolicy: "server_chat_self_evidence_propagated_within_play_segment",
    };
  }

  if (launcherUser && shouldUseLauncherUserFallback(row, context)) {
    const normalizedLauncherUser = normalizePlayerDisplayName(launcherUser) ?? launcherUser;
    return {
      launcherUser,
      launcherUsers,
      serverPlayerId: normalizedLauncherUser,
      serverPlayerIds: { [normalizedLauncherUser]: launcherUsers[launcherUser] ?? 1 },
      serverPlayerIdSource: "launcher_user_fallback",
      serverPlayerIdConfidence: "medium",
      serverIdentityContext: context,
      serverPlayerIdPolicy: "launcher_user_used_outside_localserver_context",
    };
  }

  return {
    launcherUser,
    launcherUsers,
    serverPlayerId: null,
    serverPlayerIds: {},
    serverPlayerIdSource: context === "localserver_likely" ? "none_localserver_requires_self_evidence" : "none",
    serverPlayerIdConfidence: "none",
    serverIdentityContext: context,
    serverPlayerIdPolicy: context === "localserver_likely" ? "localserver_context_requires_direct_evidence" : "no_identity_evidence",
  };
}

export function noteServerPlayerIdFromEvent(target, event) {
  for (const name of serverPlayerNamesFromEvent(event)) {
    addPlayerIdCount(target, name);
  }
}

export function serverPlayerNamesFromEvent(event = {}) {
  const names = [];
  if (event.self?.kill && event.payload?.killer) names.push(event.payload.killer);
  if (event.self?.death && event.payload?.victim) names.push(event.payload.victim);
  if (event.self?.bedDestroy && event.payload?.player) names.push(event.payload.player);
  return names;
}

export function normalizePlayerIdCounts(counts = {}) {
  const normalized = {};
  for (const [name, count] of Object.entries(counts ?? {})) {
    addPlayerIdCount(normalized, name, count);
  }
  return sortCountObject(normalized);
}

export function normalizePlayerDisplayName(value) {
  let text = String(value ?? "")
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .trim();
  if (!text) return null;
  text = text
    .replace(/^(?:\[[^\]]+\]\s*)+/, "")
    .replace(/\s*\[(?:\u2764|\u2665)\s*\d+\]\s*$/u, "")
    .replace(/\s+\([^)]*\)\s*$/, "")
    .trim();
  return text || null;
}

export function inferServerIdentityContext(row = {}) {
  const text = `${row.source ?? ""} ${row.scope ?? ""} ${row.filePath ?? ""}`.toLowerCase();
  if (/(auroranetease|netease|网易|huayuting|hua\s*yu\s*ting|花雨庭|sadhyt|sad_hyt|hyt[-_ ]|hytsense)/i.test(text)) {
    return "localserver_likely";
  }
  if (/hypixel/i.test(text)) return "launcher_alt_likely";
  return "launcher_alt_likely";
}

function shouldUseLauncherUserFallback(row, context) {
  if (context === "localserver_likely") return false;
  return Boolean(row.launcherUser ?? row.localUser ?? row.sessionAlias);
}

function addPlayerIdCount(target, rawName, amount = 1) {
  const name = normalizePlayerDisplayName(rawName);
  if (!name) return;
  const numericAmount = Number(amount);
  target[name] = (target[name] ?? 0) + (Number.isFinite(numericAmount) ? numericAmount : 1);
}

function normalizeCountObject(counts = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(counts ?? {})) {
    if (!key) continue;
    const amount = Number(value);
    normalized[key] = (normalized[key] ?? 0) + (Number.isFinite(amount) ? amount : 1);
  }
  return sortCountObject(normalized);
}

function bestCountKey(counts = {}) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function hasCounts(counts = {}) {
  return Object.values(counts).some((count) => count > 0);
}

function sortCountObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}
