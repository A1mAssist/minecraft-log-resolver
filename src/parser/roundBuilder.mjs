const MAX_ROUND_SECONDS = 60 * 60;
const MIN_ROUND_SECONDS = 10;
const STARTED_WITHOUT_GAMEPLAY_SECONDS = 120;
const RECENT_MODE_WINDOW_MS = 90 * 1000;
const PENDING_TEAM_ASSIGNMENT_WINDOW_MS = 10 * 60 * 1000;
const PUNISHMENT_EXIT_WINDOW_MS = 10 * 60 * 1000;
const FINAL_DEATH_EXIT_WINDOW_MS = 10 * 60 * 1000;
const BED_DEATH_EXIT_WINDOW_MS = 10 * 60 * 1000;
const SELF_DEATH_EXIT_WINDOW_MS = 3 * 60 * 1000;
const ROUND_END_RESULT_GRACE_MS = 10 * 1000;
const TASK_PROGRESS_KILL_ALIAS_WINDOW_MS = 3 * 1000;
const SHORT_UNOWNED_BEDWARS_NO_RESULT_EVIDENCE_SECONDS = 360;
const SHORT_UNOWNED_BEDWARS_LAST_EVENT_NO_RESULT_EVIDENCE_SECONDS = 180;
const SHORT_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS = 1;
const LOW_EVIDENCE_UNOWNED_BEDWARS_PSEUDO_FRAGMENT_SECONDS = 45 * 60;
const MEDIUM_LOW_EVIDENCE_UNOWNED_BEDWARS_PSEUDO_FRAGMENT_SECONDS = 50 * 60;
const MEDIUM_LOW_EVIDENCE_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS = 12;
const SHORT_UNOWNED_BEDWARS_PUNISHMENT_MAX_COMBAT_EVENTS = 3;
const SHORT_UNOWNED_SOLO_LOBBY_FRAGMENT_SECONDS = 90;
const RESULT_BOUNDARY_TYPES = new Set([
  "round_countdown",
  "round_start",
  "world_switch",
  "client_start",
  "client_stop",
  "server_connect",
  "player_left",
  "singleplayer_stop",
  "crash",
  "lobby_signal",
]);
const SESSION_BOUNDARY_TYPES = new Set(["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash"]);
const SOFT_LOBBY_SIGNAL_REASONS = new Set(["returning_lobby", "unread_mail"]);
const BEDWARS_FOUR_TEAM_UNIVERSE = ["red", "blue", "green", "yellow"];
const BEDWARS_EIGHT_TEAM_UNIVERSE = ["red", "blue", "green", "yellow", "aqua", "white", "pink", "gray"];
const BEDWARS_TEAM_UNIVERSES = [
  BEDWARS_FOUR_TEAM_UNIVERSE,
  BEDWARS_EIGHT_TEAM_UNIVERSE,
  ["red", "blue", "green", "yellow", "aqua", "white", "purple", "gray"],
  ["red", "blue", "green", "yellow", "aqua", "white", "purple", "orange"],
];
const NON_ROUND_GAME_MODES = new Set(["the_pit", "skyblock", "smp"]);

import { firstKnownGameMode, inferGameModeFromEvent, inferGameModeFromText, unknownGameMode } from "./gameModes.mjs";
import { annotateSelfWithServerPlayer, buildServerIdentityHintsByFile, serverPlayerIdForEvent } from "./serverIdentityHints.mjs";

export function buildRounds(chatEvents, options = {}) {
  const serverIdentityHints = options.serverIdentityHints ?? [];
  const ordered = chatEvents
    .filter((event) => event.timestampMs !== null)
    .map((event) => applyServerIdentityHint(event, serverIdentityHints))
    .sort((a, b) => a.timestampMs - b.timestampMs || eventSortPriority(a) - eventSortPriority(b) || a.lineNo - b.lineNo);
  const ownerLocalUsers = new Set(Array.from(options.ownerLocalUsers ?? []).filter(Boolean).map((user) => user.toLowerCase()));

  const rounds = [];
  let current = null;
  let pendingSoftStart = null;
  let pendingTeamAssignment = null;
  let recentModeEvent = null;

  function isHardRoundBoundary(event) {
    if (event.type === "round_start") return true;
    return event.type === "round_countdown" && Number(event.payload.seconds) === 10;
  }

  function isSoftRoundBoundary(event) {
    return event.type === "world_switch";
  }

  function isSessionBoundary(event) {
    return isSessionBoundaryEvent(event);
  }

  function closeRound(endMs, reason) {
    if (!current) return;
    current.endMs = endMs;
    current.endReason = reason;
    current.durationSeconds = Math.max(0, Math.round((endMs - current.startMs) / 1000));
    current.confidence = current.durationSeconds <= MAX_ROUND_SECONDS ? "inferred" : "low";
    rounds.push(current);
    current = null;
  }

  for (const event of ordered) {
    if (event.type === "game_mode" && isRoundGameMode(inferEventMode(event))) {
      recentModeEvent = event;
    }

    if (current?.pendingResult && shouldClosePendingResultBefore(current, event)) {
      closeRound(current.pendingResult.timestampMs, "result");
    }

    if (current?.pendingRoundEnd && shouldClosePendingRoundEndBefore(current, event)) {
      closeRound(current.pendingRoundEnd.timestampMs, "round_end");
    }

    if (isHardRoundBoundary(event)) {
      if (current && event.timestampMs > current.startMs) {
        if (shouldReplaceWaitingCandidate(current, event)) {
          pendingSoftStart = null;
          pendingTeamAssignment ??= summarizeTeamAssignmentFromRound(current);
          current = createRound(event);
          if (applyPendingTeamAssignment(current, pendingTeamAssignment, event)) pendingTeamAssignment = null;
          applyRecentMode(current, recentModeEvent, event);
          continue;
        }
        if (shouldMergeBoundaryIntoCurrent(current, event)) {
          noteRoundIdentity(current, event);
          recordRoundEvent(current, event);
          current.lastEventMs = event.timestampMs;
          current.gameMode = firstKnownGameMode(current.gameMode, firstKnownRoundGameMode(inferEventMode(event), inferGameModeFromRuleSet(event)));
          if (event.type === "round_start") current.roundStarts += 1;
          current.boundaryEvents.push(summarizeBoundaryEvent(event, "merge"));
          continue;
        }
        const gapSeconds = Math.round((event.timestampMs - current.startMs) / 1000);
        applyBoundaryResultInference(current, event);
        const reason = gapSeconds > MAX_ROUND_SECONDS ? "gap" : "next_round";
        closeRound(reason === "gap" ? current.lastEventMs : resolveNextRoundEndMs(current), reason);
      }
      pendingSoftStart = null;
      current = createRound(event);
      if (applyPendingTeamAssignment(current, pendingTeamAssignment, event)) pendingTeamAssignment = null;
      applyRecentMode(current, recentModeEvent, event);
      continue;
    }

    if (isSoftRoundBoundary(event)) {
      if (current && event.timestampMs > current.startMs) {
        const gapSeconds = Math.round((event.timestampMs - current.startMs) / 1000);
        applyBoundaryResultInference(current, event);
        closeRound(gapSeconds > MAX_ROUND_SECONDS ? current.lastEventMs : event.timestampMs, gapSeconds > MAX_ROUND_SECONDS ? "gap" : "world_switch");
      }

      const switchedMode = firstKnownRoundGameMode(inferEventMode(event));
      if (switchedMode !== unknownGameMode) {
        pendingSoftStart = null;
        current = createRound(event);
        if (applyPendingTeamAssignment(current, pendingTeamAssignment, event)) pendingTeamAssignment = null;
        applyRecentMode(current, recentModeEvent, event);
      } else {
        pendingSoftStart = event;
        current = null;
      }
      continue;
    }

    if (isSessionBoundary(event)) {
      if (current && event.timestampMs > current.startMs) {
        noteRoundIdentity(current, event);
        recordRoundEvent(current, event);
        current.boundaryEvents.push(summarizeBoundaryEvent(event, "session_boundary"));
        if (shouldInferPunishedExitLoss(current, event)) {
          setRoundResult(current, "loss", `inferred-owner-punished-exit:session:${event.type}`);
          current.punishedExit = {
            type: event.type,
            timestampMs: event.timestampMs,
            lineNo: event.lineNo,
            secondsAfterPunishment: Math.round((event.timestampMs - current.latestPunishmentMs) / 1000),
            player: current.latestPunishedPlayer,
          };
          closeRound(event.timestampMs, "session_transition_after_punishment");
        } else {
          applyBoundaryResultInference(current, event);
          closeRound(event.timestampMs, event.type);
        }
      }
      pendingSoftStart = null;
      pendingTeamAssignment = null;
      continue;
    }

    if (!current && event.type === "team_assignment") {
      pendingTeamAssignment = summarizeTeamAssignment(event);
      continue;
    }

    if (!current && pendingSoftStart && canStartFromSoftBoundary(event)) {
      current = createRound(pendingSoftStart);
      current.gameMode = firstKnownGameMode(current.gameMode, firstKnownRoundGameMode(inferEventMode(event), inferGameModeFromRuleSet(event)));
      if (applyPendingTeamAssignment(current, pendingTeamAssignment, event)) pendingTeamAssignment = null;
      applyRecentMode(current, recentModeEvent, event);
      pendingSoftStart = null;
    }

    if (isNonRoundGameModeEvent(event)) {
      pendingSoftStart = null;
      recentModeEvent = null;
      continue;
    }

    if (!current) continue;
    if (event.timestampMs < current.startMs) continue;

    const gapSeconds = Math.round((event.timestampMs - current.lastEventMs) / 1000);
    if (gapSeconds > MAX_ROUND_SECONDS) {
      closeRound(current.lastEventMs, "gap");
      continue;
    }

    if (isNextWaitingRoomJoinBoundary(current, event)) {
      current.boundaryEvents.push(summarizeBoundaryEvent(event, "next_waiting_room"));
      applyBoundaryResultInference(current, event);
      closeRound(resolveNextRoundEndMs(current), "next_round");
      continue;
    }

    current.lastEventMs = event.timestampMs;
    noteRoundIdentity(current, event);
    recordRoundEvent(current, event);
    current.gameMode = firstKnownGameMode(current.gameMode, firstKnownRoundGameMode(inferGameModeFromEvent(event), inferGameModeFromRuleSet(event)));
    notePostPunishmentGameplay(current, event);
    notePostSelfDeathOwnerGameplay(current, event);

    if (event.type === "kill") {
      noteGameplayEvent(current, event);
      current.kills += 1;
      if (event.self?.kill) current.selfKills += 1;
      if (event.self?.death) {
        current.selfDeaths += 1;
        current.latestSelfDeathMs = event.timestampMs;
        current.latestCombatSelfDeathMs = event.timestampMs;
        current.postSelfDeathOwnerGameplaySignals = 0;
      }
      inferOwnerTeamFromCombat(current, event);
      noteOwnFinalDeath(current, event);
      inferOwnerBedSelfEliminationLoss(current, event);
      addCount(current.killers, event.payload.killer);
      addCount(current.victims, event.payload.victim);
    } else if (event.type === "death") {
      noteGameplayEvent(current, event);
      current.deaths += 1;
      if (event.self?.death) {
        current.selfDeaths += 1;
        current.latestSelfDeathMs = event.timestampMs;
        current.latestCombatSelfDeathMs = event.timestampMs;
        current.postSelfDeathOwnerGameplaySignals = 0;
      }
      inferOwnerTeamFromCombat(current, event);
      noteOwnFinalDeath(current, event);
      inferOwnerBedSelfEliminationLoss(current, event);
      addCount(current.victims, event.payload.victim);
    } else if (event.type === "self_death") {
      noteGameplayEvent(current, event);
      current.selfDeathSignals += 1;
      noteSelfDeathSignal(current, event);
      inferOwnerBedSelfEliminationLoss(current, event);
    } else if (event.type === "team_chat") {
      setOwnerTeamFromTeamChatChannel(current, event);
      inferOwnerBedSpectatorChatLoss(current, event);
    } else if (event.type === "bed_destroy") {
      noteGameplayEvent(current, event);
      current.bedDestroys += 1;
      if (event.self?.bedDestroy) current.selfBedDestroys += 1;
      const destroyedTeam = normalizeTeam(event.payload?.team);
      if (destroyedTeam) addCount(current.bedDestroyedTeams, destroyedTeam);
      if (destroyedTeam && current.ownerTeam && destroyedTeam === current.ownerTeam) {
        current.ownerBedDestroyed = true;
        current.latestOwnerBedDestroyedMs = event.timestampMs;
        addResultEvidence(current, "owner_bed_destroyed", "loss", "low", event);
      }
      addCount(current.bedDestroyers, event.payload.player ?? "<unknown>");
    } else if (event.type === "team_eliminated") {
      noteGameplayEvent(current, event);
      const eliminatedTeam = normalizeTeam(event.payload?.team);
      addCount(current.teamEliminations, eliminatedTeam ?? event.payload?.team ?? "<unknown>");
      if (eliminatedTeam && current.ownerTeam && eliminatedTeam === current.ownerTeam) {
        current.ownerTeamEliminated = true;
        setRoundResult(current, "loss", `team-eliminated:${event.ruleSet}:${event.ruleId}`, {
          kind: "owner_team_eliminated",
          confidence: "high",
          event,
        });
        closeRound(event.timestampMs, "owner_team_eliminated");
      }
    } else if (event.type === "player_join") {
      current.joins += 1;
    } else if (event.type === "player_leave") {
      current.leaves += 1;
    } else if (event.type === "task_progress") {
      applyTaskProgressIdentityEvidence(current, event);
    } else if (event.type === "player_punished") {
      noteGameplayEvent(current, event);
      addCount(current.punishedPlayers, event.payload.player);
      current.latestPunishmentMs = event.timestampMs;
      current.latestPunishedPlayer = event.payload.player ?? null;
      current.postPunishmentGameplaySignals = 0;
      const punishedMatchesHint = sameHintPlayer(event.payload.player, event.serverPlayerIdHint);
      const ownerPunished = isOwnerPlayer(event.payload.player, event.localUser, ownerLocalUsers) || punishedMatchesHint;
      if (ownerPunished) {
        addCount(current.ownerAliasesUsed, event.payload.player ?? event.localUser ?? "<unknown>");
        setRoundResult(current, "loss", `owner-punished:${event.ruleSet}:${event.ruleId}`, {
          kind: punishedMatchesHint ? "owner_punished_server_identity_hint" : "result",
          event,
          details: punishedMatchesHint ? { serverPlayerIdHint: event.serverPlayerIdHint } : {},
        });
        current.gameMode = firstKnownGameMode(current.gameMode, firstKnownRoundGameMode(inferGameModeFromEvent(event), inferGameModeFromRuleSet(event)));
        closeRound(event.timestampMs, "owner_punished");
      }
    } else if (event.type === "game_mode") {
      current.gameMode = firstKnownGameMode(firstKnownRoundGameMode(event.payload?.gameMode, inferGameModeFromEvent(event)), current.gameMode);
    } else if (event.type === "team_assignment") {
      if (hasGameplaySignal(current)) {
        pendingTeamAssignment = summarizeTeamAssignment(event);
      } else {
        setOwnerTeamFromAssignment(current, event);
      }
    } else if (event.type === "win" || event.type === "loss") {
      noteGameplayEvent(current, event);
      applyRoundResult(current, event);
    } else if (event.type === "round_end") {
      if (isExternalWinnerBroadcast(event, ownerLocalUsers)) {
        addResultEvidence(current, "external_winner_broadcast", "unknown", "ignored", event, {
          winner: event.payload?.winner ?? null,
          map: event.payload?.map ?? null,
        });
        continue;
      }
      noteGameplayEvent(current, event);
      current.roundEnds += 1;
      current.boundaryEvents.push(summarizeBoundaryEvent(event, "round_end"));
      if (current.pendingResult && current.result !== "unknown") {
        continue;
      }
      const shouldClose = applyInferredRoundEndResult(current, event, ownerLocalUsers);
      if (shouldClose) {
        closeRound(event.timestampMs, "round_end");
      } else {
        current.pendingRoundEnd = summarizeBoundaryEvent(event, "pending_round_end");
      }
    }
  }

  const lastEvent = ordered.at(-1);
  if (current && lastEvent) {
    applyBoundaryResultInference(current, lastEvent);
    if (current.pendingResult) {
      closeRound(current.pendingResult.timestampMs, "result");
    } else if (current.pendingRoundEnd) {
      closeRound(current.pendingRoundEnd.timestampMs, "round_end");
    } else {
      closeRound(current.lastEventMs ?? lastEvent.timestampMs, "last_event");
    }
  }

  return rounds;
}

export function buildRoundsByFile(chatEvents, options = {}) {
  const groups = new Map();
  const serverIdentityHintsByFile = options.serverIdentityHintsByFile ?? buildServerIdentityHintsByFile(chatEvents);
  const ownerLocalUsers = new Set(chatEvents.map((event) => event.localUser).filter(Boolean));
  for (const alias of [...Array.from(options.ownerLocalUsers ?? []), ...Array.from(options.ownerAliases ?? [])]) {
    if (alias) ownerLocalUsers.add(alias);
  }
  for (const event of chatEvents) {
    const key = `${event.source}\0${event.scope}\0${event.filePath}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  return [...groups.values()]
    .flatMap((events) => buildRounds(events, {
      ownerLocalUsers,
      serverIdentityHints: serverIdentityHintsByFile.get(groupKeyForEvents(events)) ?? [],
    }))
    .sort((a, b) => a.startMs - b.startMs || a.lineNo - b.lineNo);
}

function groupKeyForEvents(events) {
  const event = events?.[0];
  return event ? groupKeyForEvent(event) : null;
}

function groupKeyForEvent(event) {
  return `${event.source}\0${event.scope}\0${event.filePath}`;
}

function applyServerIdentityHint(event, hints) {
  const serverPlayerId = serverPlayerIdForEvent(event, hints);
  if (!serverPlayerId) return event;
  return {
    ...event,
    serverPlayerIdHint: serverPlayerId,
    self: annotateSelfWithServerPlayer(event, serverPlayerId),
  };
}

export function isReliableRound(round) {
  return getIgnoredRoundReason(round) === null;
}

export function getIgnoredRoundReason(round) {
  if (isTestServerRound(round)) return "test_server";
  if (round.resultEligible === false || round.result === "not_applicable") return null;
  if (round.durationSeconds < MIN_ROUND_SECONDS) return "too_short";
  if (round.durationSeconds > MAX_ROUND_SECONDS) return "too_long";
  if (round.confidence === "low") return "parser_low_confidence";
  if (isShortUnownedCombatRound(round)) return "short_unowned_combat";
  if (isStartedWithoutGameplayRound(round)) return "started_without_gameplay";
  if (isShortUnownedBedwarsNoResultEvidenceRound(round)) return "short_unowned_bedwars_no_result_evidence";
  if (isLowEvidenceUnownedBedwarsPseudoFragmentRound(round)) return "low_evidence_unowned_bedwars_pseudo_fragment";
  if (isMediumLowEvidenceUnownedBedwarsPseudoFragmentRound(round)) return "medium_low_evidence_unowned_bedwars_pseudo_fragment";
  if (isShortUnownedBedwarsNonOwnerPunishmentNoiseRound(round)) return "short_unowned_bedwars_non_owner_punishment_noise";
  if (isShortUnownedSoloLobbyFragmentRound(round)) return "short_unowned_solo_lobby_fragment";
  if (!hasReliableRoundSignal(round)) {
    return isWaitingOnlyRound(round) ? "waiting_only" : "no_reliable_signal";
  }
  return null;
}

function isTestServerRound(round) {
  const text = [
    round.serverAddress,
    round.serverHost,
    round.serverLabel,
    round.serverNetwork,
    round.source,
    round.scope,
    round.serverEvidence?.text,
  ].filter(Boolean).join(" ").toLowerCase();
  return /(^|[.\-_\s:/])test(?:server)?([.\-_\s:/]|$)|mc32\.rhymc\.com|反作弊测试服务器/i.test(text);
}

function createRound(event) {
  const inferredMode = firstKnownRoundGameMode(
    inferEventMode(event),
    inferGameModeFromRuleSet(event),
    inferGameModeFromText(event.scope, event.source),
  );

  return {
    source: event.source,
    scope: event.scope,
    localUser: event.localUser ?? null,
    localUsers: event.localUser ? { [event.localUser]: 1 } : {},
    ownerAliasesUsed: {},
    startMs: event.timestampMs,
    endMs: null,
    lastEventMs: event.timestampMs,
    lastGameplayMs: null,
    durationSeconds: 0,
    confidence: "partial",
    endReason: null,
    startReason: event.type,
    result: "unknown",
    resultReason: null,
    gameMode: inferredMode,
    filePath: event.filePath,
    lineNo: event.lineNo,
    kills: 0,
    deaths: 0,
    bedDestroys: 0,
    selfKills: 0,
    selfDeaths: 0,
    selfDeathSignals: 0,
    selfBedDestroys: 0,
    playerMaxKillStreak: 0,
    joins: 0,
    leaves: 0,
    roundStarts: event.type === "round_start" ? 1 : 0,
    roundEnds: 0,
    boundaryEvents: [summarizeBoundaryEvent(event, "start")],
    killers: {},
    victims: {},
    bedDestroyers: {},
    punishedPlayers: {},
    teamEliminations: {},
    bedDestroyedTeams: {},
    resultEvidence: [],
    ownerBedDestroyed: false,
    ownerTeamEliminated: false,
    ownFinalDeaths: 0,
    latestOwnFinalDeathMs: null,
    latestSelfDeathMs: null,
    latestCombatSelfDeathMs: null,
    latestOwnerBedDestroyedMs: null,
    latestPunishmentMs: null,
    latestPunishedPlayer: null,
    postPunishmentGameplaySignals: 0,
    postSelfDeathOwnerGameplaySignals: 0,
    punishedExit: null,
    ownerTeam: null,
    pendingResult: null,
    pendingRoundEnd: null,
    events: [compactRoundEvent(event)],
  };
}

function hasReliableRoundSignal(round) {
  if (round.result !== "unknown") return true;
  if (round.roundStarts > 0) return true;
  if (round.kills || round.deaths || round.bedDestroys) return true;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return true;
  if (hasObjectValues(round.punishedPlayers)) return true;
  if (hasObjectValues(round.teamEliminations)) return true;
  return false;
}

function hasGameplaySignal(round) {
  if (round.result !== "unknown") return true;
  if (round.kills || round.deaths || round.bedDestroys) return true;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return true;
  if (hasObjectValues(round.punishedPlayers)) return true;
  if (hasObjectValues(round.teamEliminations)) return true;
  return false;
}

function hasRealGameplaySignal(round) {
  if (round.result !== "unknown") return true;
  if (round.kills || round.deaths || round.bedDestroys) return true;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return true;
  if (hasObjectValues(round.punishedPlayers)) return true;
  if (hasObjectValues(round.teamEliminations)) return true;
  return false;
}

function isStartedWithoutGameplayRound(round) {
  const startedByCountdown = round.startReason === "round_countdown" && round.roundStarts > 0;
  const startedDirectly = round.startReason === "round_start";
  return (
    (startedByCountdown || startedDirectly) &&
    round.result === "unknown" &&
    !hasRealGameplaySignal(round) &&
    round.durationSeconds < STARTED_WITHOUT_GAMEPLAY_SECONDS
  );
}

function isShortUnownedCombatRound(round) {
  return (
    round.startReason === "round_countdown" &&
    round.result === "unknown" &&
    !round.roundStarts &&
    !round.ownerTeam &&
    (round.kills > 0 || round.deaths > 0) &&
    !round.selfKills &&
    !round.selfDeaths &&
    !round.selfDeathSignals &&
    !round.selfBedDestroys &&
    !round.bedDestroys &&
    !hasObjectValues(round.teamEliminations) &&
    !hasObjectValues(round.punishedPlayers) &&
    round.durationSeconds < STARTED_WITHOUT_GAMEPLAY_SECONDS
  );
}

function isShortUnownedBedwarsNoResultEvidenceRound(round) {
  if (round.gameMode !== "bedwars") return false;
  if (round.result !== "unknown") return false;
  if (!["next_round", "server_connect", "client_stop", "lobby_signal", "world_switch", "crash", "last_event"].includes(round.endReason)) {
    return false;
  }
  const maxSeconds = round.endReason === "last_event"
    ? SHORT_UNOWNED_BEDWARS_LAST_EVENT_NO_RESULT_EVIDENCE_SECONDS
    : SHORT_UNOWNED_BEDWARS_NO_RESULT_EVIDENCE_SECONDS;
  if (round.durationSeconds >= maxSeconds) return false;
  if (round.ownerTeam) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.teamEliminations) || hasObjectValues(round.bedDestroyedTeams) || hasObjectValues(round.punishedPlayers)) return false;
  if (hasStrongResultEvidence(round)) return false;
  if (round.bedDestroys > 0) return false;

  const combatEvents = (round.kills ?? 0) + (round.deaths ?? 0);
  return combatEvents <= SHORT_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS && hasBedwarsPseudoRoundSignal(round, combatEvents);
}

function hasBedwarsPseudoRoundSignal(round, combatEvents) {
  if (combatEvents > 0) return true;
  return (round.resultEvidence ?? []).some((item) =>
    item.kind === "external_winner_broadcast" && item.confidence === "ignored"
  );
}

function isLowEvidenceUnownedBedwarsPseudoFragmentRound(round) {
  if (round.gameMode !== "bedwars") return false;
  if (round.result !== "unknown") return false;
  if (!["server_connect", "client_stop", "world_switch", "last_event"].includes(round.endReason)) return false;
  if ((round.durationSeconds ?? 0) >= LOW_EVIDENCE_UNOWNED_BEDWARS_PSEUDO_FRAGMENT_SECONDS) return false;
  if (round.ownerTeam) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.teamEliminations) || hasObjectValues(round.bedDestroyedTeams) || hasObjectValues(round.punishedPlayers)) return false;
  if (hasStrongResultEvidence(round)) return false;
  if (hasOwnerSpecificRoundEvidence(round)) return false;
  if (hasAnyOwnerIdentityEvidence(round)) return false;
  if ((round.bedDestroys ?? 0) > 0) return false;

  const combatEvents = (round.kills ?? 0) + (round.deaths ?? 0);
  return combatEvents > 0 && combatEvents <= SHORT_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS;
}

function hasAnyOwnerIdentityEvidence(round) {
  return (round.resultEvidence ?? []).some((item) => item.kind !== "external_winner_broadcast");
}

function isMediumLowEvidenceUnownedBedwarsPseudoFragmentRound(round) {
  if (round.gameMode !== "bedwars") return false;
  if (round.result !== "unknown") return false;
  if (!["next_round", "server_connect", "client_stop", "world_switch"].includes(round.endReason)) return false;
  if ((round.durationSeconds ?? 0) >= MEDIUM_LOW_EVIDENCE_UNOWNED_BEDWARS_PSEUDO_FRAGMENT_SECONDS) return false;
  if (round.ownerTeam) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.teamEliminations) || hasObjectValues(round.bedDestroyedTeams) || hasObjectValues(round.punishedPlayers)) return false;
  if (hasStrongResultEvidence(round)) return false;
  if (hasAnyOwnerIdentityEvidence(round)) return false;
  if ((round.bedDestroys ?? 0) > 0) return false;

  const combatEvents = (round.kills ?? 0) + (round.deaths ?? 0);
  return combatEvents > SHORT_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS &&
    combatEvents <= MEDIUM_LOW_EVIDENCE_UNOWNED_BEDWARS_MAX_COMBAT_EVENTS;
}

function isShortUnownedBedwarsNonOwnerPunishmentNoiseRound(round) {
  if (round.gameMode !== "bedwars") return false;
  if (round.result !== "unknown") return false;
  if (round.durationSeconds >= STARTED_WITHOUT_GAMEPLAY_SECONDS) return false;
  if (!["next_round", "last_event"].includes(round.endReason)) return false;
  if (round.ownerTeam) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.teamEliminations)) return false;
  if (round.bedDestroys > 0) return false;

  const combatEvents = (round.kills ?? 0) + (round.deaths ?? 0);
  if (combatEvents > SHORT_UNOWNED_BEDWARS_PUNISHMENT_MAX_COMBAT_EVENTS) return false;
  if (hasStrongResultEvidence(round)) return false;

  const punishedPlayers = Object.entries(round.punishedPlayers ?? {})
    .filter(([, count]) => count > 0)
    .map(([player]) => player);
  if (!punishedPlayers.length) return false;
  if (punishedPlayers.some((player) => isLikelyOwnerPlayer(round, player))) return false;

  return (round.resultEvidence ?? []).every((item) =>
    item.kind === "external_winner_broadcast" && item.confidence === "ignored"
  );
}

function isShortUnownedSoloLobbyFragmentRound(round) {
  if (!isSoloWinnerLossMode(round.gameMode)) return false;
  if (round.result !== "unknown") return false;
  if (round.durationSeconds >= SHORT_UNOWNED_SOLO_LOBBY_FRAGMENT_SECONDS) return false;
  if (!["lobby_signal", "server_connect", "client_stop"].includes(round.endReason)) return false;
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return false;
  if (round.ownerTeam || round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return false;
  if (hasObjectValues(round.punishedPlayers) || hasObjectValues(round.teamEliminations) || hasObjectValues(round.bedDestroyedTeams)) return false;
  if (hasStrongResultEvidence(round)) return false;
  return !hasOwnerSpecificRoundEvidence(round);
}

function hasOwnerSpecificRoundEvidence(round) {
  if (round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys) return true;
  if (round.ownerTeam || round.ownerBedDestroyed || round.ownerTeamEliminated || round.ownFinalDeaths || round.latestOwnFinalDeathMs) return true;
  return (round.resultEvidence ?? []).some((item) =>
    item.kind !== "owner_alias_from_play_segment" &&
    item.kind !== "external_winner_broadcast"
  );
}

function isLikelyOwnerPlayer(round, player) {
  const normalizedPlayer = normalizeWinnerText(player);
  if (!normalizedPlayer) return false;
  const candidates = [
    round.localUser,
    ...Object.keys(round.localUsers ?? {}),
    ...Object.keys(round.ownerAliasesUsed ?? {}),
    round.serverPlayerId,
    ...Object.keys(round.serverPlayerIds ?? {}),
  ];
  return candidates.some((candidate) => samePlayer(candidate, normalizedPlayer));
}

function hasStrongResultEvidence(round) {
  return (round.resultEvidence ?? []).some((item) =>
    item.result !== "unknown" &&
    item.confidence !== "low" &&
    item.confidence !== "ignored"
  );
}

function isWaitingOnlyRound(round) {
  return (
    round.startReason === "round_countdown" &&
    !round.roundStarts &&
    round.result === "unknown" &&
    !hasGameplaySignal(round)
  );
}

function shouldMergeBoundaryIntoCurrent(round, event) {
  if (event.type === "round_countdown" && Number(event.payload?.seconds) === 10 && !hasReliableRoundSignal(round)) {
    return !round.roundEnds;
  }

  if (event.type === "round_start" && round.startReason === "round_countdown" && !hasGameplaySignal(round)) {
    return true;
  }

  return false;
}

function shouldReplaceWaitingCandidate(round, event) {
  return (
    event.type === "round_countdown" &&
    Number(event.payload?.seconds) === 10 &&
    round.startReason === "round_countdown" &&
    !round.roundStarts &&
    !round.roundEnds &&
    !hasGameplaySignal(round)
  );
}

function shouldInferPunishedExitLoss(round, event) {
  if (round.result !== "unknown") return false;
  if (!round.latestPunishmentMs) return false;
  if (round.postPunishmentGameplaySignals > 0) return false;

  const punishedPlayers = Object.entries(round.punishedPlayers ?? {}).filter(([, count]) => count > 0);
  if (punishedPlayers.length !== 1) return false;

  const elapsedMs = event.timestampMs - round.latestPunishmentMs;
  if (elapsedMs < 0 || elapsedMs > PUNISHMENT_EXIT_WINDOW_MS) return false;

  return isResultBoundaryEvent(event);
}

function isSessionBoundaryEvent(event) {
  if (!event) return false;
  if (SESSION_BOUNDARY_TYPES.has(event.type)) return true;
  if (event.type === "lobby_signal") return !isSoftLobbySignal(event);
  return false;
}

function isResultBoundaryEvent(event) {
  if (!event || !RESULT_BOUNDARY_TYPES.has(event.type)) return false;
  return event.type !== "lobby_signal" || !isSoftLobbySignal(event);
}

function isSyntheticLastEventBoundary(event) {
  return event?.type === "last_event" && event.ruleSet === "report";
}

function isSoftLobbySignal(event) {
  return event?.type === "lobby_signal" && SOFT_LOBBY_SIGNAL_REASONS.has(event.payload?.reason);
}

function notePostPunishmentGameplay(round, event) {
  if (!round.latestPunishmentMs || event.timestampMs <= round.latestPunishmentMs) return;
  if (["kill", "death", "self_death", "bed_destroy", "win", "loss", "round_end", "round_start"].includes(event.type)) {
    round.postPunishmentGameplaySignals += 1;
  }
}

function notePostSelfDeathOwnerGameplay(round, event) {
  if (!round.latestCombatSelfDeathMs || event.timestampMs <= round.latestCombatSelfDeathMs) return;
  if (event.self?.kill || event.self?.bedDestroy) {
    round.postSelfDeathOwnerGameplaySignals += 1;
    return;
  }
  if (
    event.type === "team_chat" &&
    (
      sameHintPlayer(event.payload?.player, event.serverPlayerIdHint) ||
      samePlayer(event.payload?.player, normalizeWinnerText(event.localUser))
    )
  ) {
    round.postSelfDeathOwnerGameplaySignals += 1;
  }
}

function noteRoundIdentity(round, event) {
  if (!round || !event) return;
  if (event.localUser) {
    round.localUser ??= event.localUser;
    addCount(round.localUsers, event.localUser);
  }
  for (const alias of ownerAliasesFromEvent(event)) {
    addCount(round.ownerAliasesUsed, alias);
  }
}

function ownerAliasesFromEvent(event) {
  const aliases = [];
  if (event.self?.kill && event.payload?.killer) aliases.push(event.payload.killer);
  if (event.self?.death && event.payload?.victim) aliases.push(event.payload.victim);
  if (event.self?.bedDestroy && event.payload?.player) aliases.push(event.payload.player);
  if (isMapRatingPrompt(event) && event.payload?.player) aliases.push(event.payload.player);
  return aliases.filter(Boolean);
}

function recordRoundEvent(round, event) {
  if (!round || !event) return;
  round.events ??= [];
  round.events.push(compactRoundEvent(event));
}

function compactRoundEvent(event) {
  return {
    type: event.type,
    timestampMs: event.timestampMs,
    lineNo: event.lineNo,
    ruleSet: event.ruleSet ?? null,
    rulePack: event.rulePack ?? null,
    ruleId: event.ruleId ?? null,
    message: event.type === "server_connect" ? event.message ?? null : null,
    payload: event.payload ?? {},
    self: event.self ?? {},
    serverPlayerIdHint: event.serverPlayerIdHint ?? null,
  };
}

function noteGameplayEvent(round, event) {
  if (!round || event.timestampMs === null || event.timestampMs === undefined) return;
  round.lastGameplayMs = event.timestampMs;
}

function resolveNextRoundEndMs(round) {
  return round.lastGameplayMs ?? round.lastEventMs;
}

export function applyBoundaryResultInference(round, boundaryEvent) {
  if (!round || round.result !== "unknown") return;
  if (shouldInferOwnFinalDeathLoss(round, boundaryEvent)) {
    setRoundResult(round, "loss", `inferred-own-final-death-exit:${boundaryEvent.ruleSet}:${boundaryEvent.type}`, {
      kind: "own_final_death_then_boundary",
      confidence: "medium",
      event: boundaryEvent,
      details: {
        secondsAfterFinalDeath: Math.round((boundaryEvent.timestampMs - round.latestOwnFinalDeathMs) / 1000),
      },
    });
    return;
  }
  if (shouldInferOwnerBedDeathLoss(round, boundaryEvent)) {
    setRoundResult(round, "loss", `inferred-owner-bed-death-exit:${boundaryEvent.ruleSet}:${boundaryEvent.type}`, {
      kind: "owner_bed_broken_then_self_death_boundary",
      confidence: "medium",
      event: boundaryEvent,
      details: {
        secondsAfterSelfDeath: Math.round((boundaryEvent.timestampMs - round.latestSelfDeathMs) / 1000),
      },
    });
    return;
  }
  if (shouldInferBedwarsSelfDeathExitLoss(round, boundaryEvent)) {
    const boundaryType = bedwarsSelfDeathBoundaryType(boundaryEvent);
    setRoundResult(round, "loss", `inferred-bedwars-self-death-exit:${boundaryEvent.ruleSet}:${boundaryType}`, {
      kind: "bedwars_self_death_then_boundary",
      confidence: "medium",
      event: boundaryEvent,
      details: {
        secondsAfterSelfDeath: Math.round((boundaryEvent.timestampMs - round.latestCombatSelfDeathMs) / 1000),
        boundaryType,
      },
    });
    return;
  }
  if (shouldInferMegaWallsQuitLoss(round, boundaryEvent)) {
    setRoundResult(round, "loss", `inferred-mega-walls-quit:${boundaryEvent.ruleSet}:${boundaryEvent.ruleId ?? boundaryEvent.type}`, {
      kind: "mega_walls_quit_boundary",
      confidence: "medium",
      event: boundaryEvent,
      details: {
        boundaryType: boundaryEvent.type,
        boundaryReason: boundaryEvent.payload?.reason ?? null,
        destination: boundaryEvent.payload?.destination ?? null,
      },
    });
    return;
  }
  if (shouldInferZombiesSelfDeathExitLoss(round, boundaryEvent)) {
    setRoundResult(round, "loss", `inferred-zombies-self-death-exit:${boundaryEvent.ruleSet}:${boundaryEvent.type}`, {
      kind: "zombies_self_death_then_boundary",
      confidence: "medium",
      event: boundaryEvent,
      details: {
        selfDeaths: round.selfDeaths ?? 0,
        boundaryType: boundaryEvent.type,
        secondsAfterSelfDeath: round.latestCombatSelfDeathMs
          ? Math.round((boundaryEvent.timestampMs - round.latestCombatSelfDeathMs) / 1000)
          : null,
      },
    });
    return;
  }
  const teamEliminationWin = buildBedwarsTeamEliminationWinInference(round, boundaryEvent);
  if (teamEliminationWin) {
    setRoundResult(round, "win", `inferred-all-enemy-teams-eliminated:${boundaryEvent.ruleSet}:${boundaryEvent.type}`, {
      kind: "all_enemy_teams_eliminated",
      confidence: "high",
      event: boundaryEvent,
      details: teamEliminationWin,
    });
    return;
  }
  const lowConfidenceTeamEliminationWin = buildBedwarsLowConfidenceTeamEliminationWinInference(round, boundaryEvent);
  if (lowConfidenceTeamEliminationWin) {
    setRoundResult(round, "win", `inferred-owner-team-survived-team-elims-low-confidence:${boundaryEvent.ruleSet}:${boundaryEvent.type}`, {
      kind: "owner_team_survived_team_eliminations_low_confidence",
      confidence: "low",
      event: boundaryEvent,
      details: lowConfidenceTeamEliminationWin,
    });
  }
}

function shouldInferOwnFinalDeathLoss(round, boundaryEvent) {
  if (round.gameMode !== "bedwars") return false;
  if (!round.latestOwnFinalDeathMs) return false;
  if (!isResultBoundaryEvent(boundaryEvent)) {
    return false;
  }

  const elapsedMs = boundaryEvent.timestampMs - round.latestOwnFinalDeathMs;
  return elapsedMs >= 0 && elapsedMs <= FINAL_DEATH_EXIT_WINDOW_MS;
}

function shouldInferOwnerBedDeathLoss(round, boundaryEvent) {
  if (round.gameMode !== "bedwars") return false;
  if (!round.ownerBedDestroyed || !round.latestOwnerBedDestroyedMs || !round.latestSelfDeathMs) return false;
  if (round.latestSelfDeathMs < round.latestOwnerBedDestroyedMs) return false;
  if (!isResultBoundaryEvent(boundaryEvent)) {
    return false;
  }

  const elapsedMs = boundaryEvent.timestampMs - round.latestSelfDeathMs;
  return elapsedMs >= 0 && elapsedMs <= BED_DEATH_EXIT_WINDOW_MS;
}

function inferOwnerBedSelfEliminationLoss(round, event) {
  if (round.result !== "unknown") return false;
  if (round.gameMode !== "bedwars") return false;
  if (!round.ownerBedDestroyed || round.latestOwnerBedDestroyedMs === null || round.latestOwnerBedDestroyedMs === undefined) return false;
  if (!isExplicitSelfEliminationEvent(event)) return false;
  if (event.timestampMs < round.latestOwnerBedDestroyedMs) return false;

  setRoundResult(round, "loss", `inferred-owner-bed-self-eliminated:${event.ruleSet}:${event.ruleId}`, {
    kind: "owner_bed_destroyed_then_self_elimination",
    confidence: "high",
    event,
    details: {
      secondsAfterBedDestroyed: Math.round((event.timestampMs - round.latestOwnerBedDestroyedMs) / 1000),
    },
  });
  round.pendingResult = summarizeResultEvent(event, "loss", 50);
  round.pendingRoundEnd = null;
  return true;
}

function inferOwnerBedSpectatorChatLoss(round, event) {
  if (round.result !== "unknown") return false;
  if (round.gameMode !== "bedwars") return false;
  if (!round.ownerBedDestroyed || round.latestOwnerBedDestroyedMs === null || round.latestOwnerBedDestroyedMs === undefined) return false;
  if (event.type !== "team_chat") return false;
  if (!isOwnerTeamChatEvent(event)) return false;
  if (!isSpectatorChatTeam(event.payload?.team)) return false;
  if (event.timestampMs < round.latestOwnerBedDestroyedMs) return false;

  setRoundResult(round, "loss", `inferred-owner-bed-spectator-chat-eliminated:${event.ruleSet}:${event.ruleId}`, {
    kind: "owner_bed_destroyed_then_owner_spectator_chat",
    confidence: "high",
    event,
    details: {
      secondsAfterBedDestroyed: Math.round((event.timestampMs - round.latestOwnerBedDestroyedMs) / 1000),
      team: event.payload?.team ?? null,
      player: event.payload?.player ?? null,
    },
  });
  round.pendingResult = summarizeResultEvent(event, "loss", 50);
  round.pendingRoundEnd = null;
  return true;
}

function isExplicitSelfEliminationEvent(event) {
  if (event.type === "self_death") return true;
  return (event.type === "kill" || event.type === "death") && Boolean(event.self?.death);
}

function isOwnerTeamChatEvent(event) {
  return (
    sameHintPlayer(event.payload?.player, event.serverPlayerIdHint) ||
    samePlayer(event.payload?.player, normalizeWinnerText(event.localUser))
  );
}

function isSpectatorChatTeam(value) {
  const text = normalizeWinnerText(value).replace(/[\s:：|,，!！.。-]+/g, "");
  return ["旁观者", "观察者", "spectator", "spectators", "observer", "observers"].includes(text);
}

function shouldInferBedwarsSelfDeathExitLoss(round, boundaryEvent) {
  if (round.gameMode !== "bedwars") return false;
  if (!round.latestCombatSelfDeathMs) return false;
  if (round.postSelfDeathOwnerGameplaySignals > 0) return false;
  if (!isBedwarsSelfDeathExitBoundary(boundaryEvent)) return false;

  const elapsedMs = boundaryEvent.timestampMs - round.latestCombatSelfDeathMs;
  return elapsedMs >= 0 && elapsedMs <= SELF_DEATH_EXIT_WINDOW_MS;
}

function isBedwarsSelfDeathExitBoundary(boundaryEvent) {
  const boundaryType = bedwarsSelfDeathBoundaryType(boundaryEvent);
  if (boundaryType === "last_event") return isSyntheticLastEventBoundary(boundaryEvent);
  if (boundaryType === "lobby_signal") return isResultBoundaryEvent(boundaryEvent);
  return ["next_round", "server_connect", "client_stop", "crash", "world_switch"].includes(boundaryType);
}

function bedwarsSelfDeathBoundaryType(boundaryEvent) {
  if (!boundaryEvent) return null;
  if (isSyntheticLastEventBoundary(boundaryEvent)) return "last_event";
  if (boundaryEvent.type === "round_countdown" || boundaryEvent.type === "round_start") return "next_round";
  return boundaryEvent.type;
}

function shouldInferMegaWallsQuitLoss(round, boundaryEvent) {
  if (round.gameMode !== "mega_walls") return false;
  if (!hasMegaWallsPlayedSignal(round)) return false;
  if (isSyntheticLastEventBoundary(boundaryEvent)) {
    return hasRecentCombatSelfDeathBeforeBoundary(round, boundaryEvent, SELF_DEATH_EXIT_WINDOW_MS);
  }
  if (boundaryEvent.type === "lobby_signal") {
    return !isSoftLobbySignal(boundaryEvent);
  }
  if (SESSION_BOUNDARY_TYPES.has(boundaryEvent.type)) {
    return true;
  }
  if (boundaryEvent.type === "world_switch") {
    return true;
  }
  if (isNextWaitingRoomJoinBoundary(round, boundaryEvent)) {
    return true;
  }
  return false;
}

function shouldInferZombiesSelfDeathExitLoss(round, boundaryEvent) {
  if (round.gameMode !== "zombies") return false;
  if ((round.selfDeaths ?? 0) <= 0 && !round.latestCombatSelfDeathMs) return false;
  if (!isResultBoundaryEvent(boundaryEvent) && !isSyntheticLastEventBoundary(boundaryEvent)) return false;
  if (round.latestCombatSelfDeathMs) {
    return hasRecentCombatSelfDeathBeforeBoundary(round, boundaryEvent, FINAL_DEATH_EXIT_WINDOW_MS);
  }
  return ["world_switch", "lobby_signal", "server_connect", "client_stop", "crash", "last_event"].includes(boundaryEvent.type);
}

function hasRecentCombatSelfDeathBeforeBoundary(round, boundaryEvent, windowMs) {
  if (!round.latestCombatSelfDeathMs) return false;
  const elapsedMs = boundaryEvent.timestampMs - round.latestCombatSelfDeathMs;
  return elapsedMs >= 0 && elapsedMs <= windowMs;
}

function hasMegaWallsPlayedSignal(round) {
  if (!round || round.result !== "unknown") return false;
  if (round.kills > 0 || round.deaths > 0 || round.selfKills > 0 || round.selfDeaths > 0 || round.selfDeathSignals > 0) return true;
  if (round.lastGameplayMs && round.lastGameplayMs > round.startMs) return true;
  return false;
}

function isNextWaitingRoomJoinBoundary(round, event) {
  if (!round || !event) return false;
  if (round.gameMode !== "mega_walls") return false;
  if (!hasMegaWallsPlayedSignal(round)) return false;
  if (event.type !== "player_join") return false;
  return Number(event.payload?.maxPlayers) === 100;
}

function buildBedwarsTeamEliminationWinInference(round, boundaryEvent) {
  if (round.gameMode !== "bedwars") return null;
  if (!isResultBoundaryEvent(boundaryEvent)) return null;
  if (!round.ownerTeam || !isKnownBedwarsTeam(round.ownerTeam)) return null;
  if (round.ownerTeamEliminated || round.ownFinalDeaths > 0 || round.latestOwnFinalDeathMs) return null;

  const eliminated = normalizedTeamCounts(round.teamEliminations);
  const beds = normalizedTeamCounts(round.bedDestroyedTeams);
  if (eliminated.unknown.length || beds.unknown.length) return null;
  if (!eliminated.known.size || eliminated.known.has(round.ownerTeam)) return null;

  const universe = bedwarsTeamUniverse(round.ownerTeam, eliminated.known, beds.known);
  if (!universe) return null;

  const enemyTeams = universe.filter((team) => team !== round.ownerTeam);
  if (!enemyTeams.every((team) => eliminated.known.has(team))) return null;

  return {
    ownerTeam: round.ownerTeam,
    enemyTeams,
    eliminatedTeams: [...eliminated.known].sort(),
    bedDestroyedTeams: [...beds.known].sort(),
    teamUniverse: universe,
    boundaryType: boundaryEvent.type,
  };
}

function buildBedwarsLowConfidenceTeamEliminationWinInference(round, boundaryEvent) {
  if (round.gameMode !== "bedwars") return null;
  if (!isResultBoundaryEvent(boundaryEvent)) return null;
  if (!round.ownerTeam || !isKnownBedwarsTeam(round.ownerTeam)) return null;
  if (round.ownerTeamEliminated || round.ownFinalDeaths > 0 || round.latestOwnFinalDeathMs) return null;
  if ((round.selfDeathSignals ?? 0) > 0) return null;

  const eliminated = normalizedTeamCounts(round.teamEliminations);
  const beds = normalizedTeamCounts(round.bedDestroyedTeams);
  if (!eliminated.known.size || eliminated.known.has(round.ownerTeam)) return null;

  return {
    ownerTeam: round.ownerTeam,
    eliminatedTeams: [...eliminated.known].sort(),
    bedDestroyedTeams: [...beds.known].sort(),
    boundaryType: boundaryEvent.type,
  };
}

function bedwarsTeamUniverse(ownerTeam, eliminatedTeams, bedDestroyedTeams) {
  const observed = new Set([ownerTeam, ...eliminatedTeams, ...bedDestroyedTeams]);
  const matchingUniverses = BEDWARS_TEAM_UNIVERSES.filter((universe) =>
    universe.includes(ownerTeam) && [...observed].every((team) => universe.includes(team)),
  );
  return matchingUniverses.sort((a, b) => a.length - b.length)[0] ?? null;
}

function isKnownBedwarsTeam(team) {
  return BEDWARS_TEAM_UNIVERSES.some((universe) => universe.includes(team));
}

function normalizedTeamCounts(counts) {
  const known = new Set();
  const unknown = [];
  for (const [team, count] of Object.entries(counts ?? {})) {
    if (!count) continue;
    const normalized = normalizeTeam(team);
    if (normalized) {
      known.add(normalized);
    } else {
      unknown.push(team);
    }
  }
  return { known, unknown };
}

function isExternalWinnerBroadcast(event, ownerLocalUsers) {
  if (event.ruleId !== "zh_player_won_on_map") return false;
  const winner = event.payload?.winner?.toLowerCase();
  if (!winner) return false;
  if (sameHintPlayer(event.payload?.winner, event.serverPlayerIdHint)) return false;
  return !winnerIncludesOwnerName(winner, event.localUser, ownerLocalUsers);
}

function inferOwnerTeamFromCombat(round, event) {
  if (round.ownerTeam) return;
  const team = event.self?.kill
    ? normalizeTeam(event.payload?.killerTeam)
    : event.self?.death
      ? normalizeTeam(event.payload?.victimTeam)
      : null;
  if (!team) return;
  round.ownerTeam = team;
  addResultEvidence(round, "owner_team_from_combat", "unknown", "medium", event, { team });
}

function noteOwnFinalDeath(round, event) {
  if (!event.self?.death) return;
  if (!isFinalDeathEvent(event)) return;
  round.ownFinalDeaths += 1;
  round.latestOwnFinalDeathMs = event.timestampMs;
  addResultEvidence(round, "own_final_death", "loss", "medium", event);
}

function noteSelfDeathSignal(round, event) {
  round.latestSelfDeathMs = event.timestampMs;
  addResultEvidence(round, "self_death_signal", "loss", "medium", event);
}

function isFinalDeathEvent(event) {
  return Boolean(event.payload?.finalDeath) || ["zh_final_destroy", "en_final_kill_by"].includes(event.ruleId);
}

function addResultEvidence(round, kind, result, confidence, event, details = {}) {
  round.resultEvidence ??= [];
  round.resultEvidence.push({
    kind,
    result,
    confidence,
    timestampMs: event?.timestampMs ?? null,
    lineNo: event?.lineNo ?? null,
    ruleSet: event?.ruleSet ?? null,
    ruleId: event?.ruleId ?? null,
    ...details,
  });
}

function summarizeBoundaryEvent(event, role) {
  return {
    role,
    type: event.type,
    timestampMs: event.timestampMs,
    lineNo: event.lineNo,
    ruleSet: event.ruleSet ?? null,
    rulePack: event.rulePack ?? null,
    ruleId: event.ruleId ?? null,
    ...(event.type === "server_connect" ? { text: event.message ?? null, payload: event.payload ?? {} } : {}),
    seconds: event.payload?.seconds ?? null,
    gameMode: firstKnownRoundGameMode(inferEventMode(event), inferGameModeFromRuleSet(event)),
  };
}

function summarizeResultEvent(event, result, priority) {
  return {
    type: event.type,
    result,
    timestampMs: event.timestampMs,
    lineNo: event.lineNo,
    ruleSet: event.ruleSet ?? null,
    rulePack: event.rulePack ?? null,
    ruleId: event.ruleId ?? null,
    priority,
  };
}

function summarizeTeamAssignment(event) {
  const team = normalizeTeam(event.payload?.team ?? event.payload?.teamStart);
  if (!team) return null;
  return {
    team,
    timestampMs: event.timestampMs,
    lineNo: event.lineNo,
    source: event.source,
    scope: event.scope,
    filePath: event.filePath,
    ruleSet: event.ruleSet ?? null,
    rulePack: event.rulePack ?? null,
    ruleId: event.ruleId ?? null,
  };
}

function summarizeTeamAssignmentFromRound(round) {
  if (!round?.ownerTeam) return null;
  const evidence = [...(round.resultEvidence ?? [])]
    .reverse()
    .find((item) => item.kind === "owner_team_from_assignment" && item.team === round.ownerTeam);
  return {
    team: round.ownerTeam,
    timestampMs: evidence?.timestampMs ?? round.startMs,
    lineNo: evidence?.lineNo ?? round.lineNo,
    source: round.source,
    scope: round.scope,
    filePath: round.filePath,
    ruleSet: evidence?.ruleSet ?? null,
    ruleId: evidence?.ruleId ?? null,
  };
}

function applyPendingTeamAssignment(round, pending, boundaryEvent) {
  if (!round || !pending || !boundaryEvent) return false;
  if (pending.timestampMs > boundaryEvent.timestampMs) return false;
  if (boundaryEvent.timestampMs - pending.timestampMs > PENDING_TEAM_ASSIGNMENT_WINDOW_MS) return false;
  if (pending.source !== boundaryEvent.source || pending.scope !== boundaryEvent.scope || pending.filePath !== boundaryEvent.filePath) return false;
  round.ownerTeam = pending.team;
  addResultEvidence(round, "owner_team_from_assignment", "unknown", "high", {
    timestampMs: pending.timestampMs,
    lineNo: pending.lineNo,
    ruleSet: pending.ruleSet,
    rulePack: pending.rulePack ?? null,
    ruleId: pending.ruleId,
  }, { team: pending.team });
  return true;
}

function setOwnerTeamFromAssignment(round, event) {
  const team = normalizeTeam(event.payload?.team ?? event.payload?.teamStart);
  if (!team) return;
  round.ownerTeam = team;
  addResultEvidence(round, "owner_team_from_assignment", "unknown", "high", event, { team });
}

function setOwnerTeamFromTeamChatChannel(round, event) {
  if (!round || round.ownerTeam) return false;
  if (event.type !== "team_chat") return false;
  if (event.payload?.chatScope !== "team") return false;

  const team = normalizeTeam(event.payload?.team);
  if (!team) return false;

  round.ownerTeam = team;
  addResultEvidence(round, "owner_team_from_team_chat_channel", "unknown", "high", event, {
    team,
    player: event.payload?.player ?? null,
  });
  syncOwnerBedDestroyedFromKnownTeam(round);
  return true;
}

function syncOwnerBedDestroyedFromKnownTeam(round) {
  if (!round?.ownerTeam) return;
  for (const event of round.events ?? []) {
    if (event.type !== "bed_destroy") continue;
    const destroyedTeam = normalizeTeam(event.payload?.team);
    if (destroyedTeam && destroyedTeam === round.ownerTeam) {
      round.ownerBedDestroyed = true;
      round.latestOwnerBedDestroyedMs = maxTimestamp(round.latestOwnerBedDestroyedMs, event.timestampMs);
      addResultEvidence(round, "owner_bed_destroyed", "loss", "low", event);
    }
  }
}

function canStartFromSoftBoundary(event) {
  if (!["game_mode", "round_start", "round_countdown"].includes(event.type)) return false;
  return isRoundGameMode(firstKnownGameMode(inferEventMode(event), inferGameModeFromRuleSet(event)));
}

function inferEventMode(event) {
  return firstKnownGameMode(
    inferGameModeFromEvent(event),
    inferGameModeFromText(event?.payload?.destination),
  );
}

function applyRecentMode(round, recentModeEvent, boundaryEvent) {
  if (!round || !recentModeEvent || !boundaryEvent) return;
  if (recentModeEvent.timestampMs > boundaryEvent.timestampMs) return;
  if (boundaryEvent.timestampMs - recentModeEvent.timestampMs > RECENT_MODE_WINDOW_MS) return;
  round.gameMode = firstKnownGameMode(round.gameMode, firstKnownRoundGameMode(inferEventMode(recentModeEvent), inferGameModeFromRuleSet(recentModeEvent)));
}

function isRoundGameMode(mode) {
  const normalized = firstKnownGameMode(mode);
  return normalized !== unknownGameMode && !NON_ROUND_GAME_MODES.has(normalized);
}

function isNonRoundGameModeEvent(event) {
  if (["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash", "world_switch"].includes(event.type)) {
    return false;
  }
  const mode = firstKnownGameMode(inferEventMode(event), inferGameModeFromRuleSet(event));
  return mode !== unknownGameMode && NON_ROUND_GAME_MODES.has(mode);
}

function firstKnownRoundGameMode(...modes) {
  const normalized = firstKnownGameMode(...modes);
  return isRoundGameMode(normalized) ? normalized : unknownGameMode;
}

function applyRoundResult(round, event) {
  const nextResult = event.type === "win" ? "win" : "loss";
  const priority = resultEventPriority(event);
  if (round.pendingResult && round.result === nextResult && priority < (round.pendingResult.priority ?? 0)) {
    addResultEvidence(round, "result", nextResult, "high", event, { reason: `${event.ruleSet}:${event.ruleId}`, superseded: true });
    applyResultEventGameMode(round, event);
    return;
  }

  setRoundResult(round, nextResult, `${event.ruleSet}:${event.ruleId}`, { event });
  applyResultEventGameMode(round, event);
  round.pendingResult = summarizeResultEvent(event, nextResult, priority);
  round.pendingRoundEnd = null;
}

function applyResultEventGameMode(round, event) {
  const eventMode = firstKnownRoundGameMode(inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
  if (isModeCorrectingPersonalResult(event, eventMode)) {
    round.gameMode = eventMode;
    return;
  }
  round.gameMode = firstKnownGameMode(round.gameMode, eventMode);
}

function isModeCorrectingPersonalResult(event, eventMode) {
  if (eventMode === unknownGameMode) return false;
  return ["zh_skywars_elo_gain", "zh_skywars_elo_loss", "zh_skywars_map_elo_win"].includes(event.ruleId);
}

function applyInferredRoundEndResult(round, event, ownerLocalUsers = new Set()) {
  if (isMapRatingPrompt(event)) {
    applyMapRatingIdentityEvidence(round, event);
    let shouldClose = false;
    if (shouldInferMapRatingPromptLoss(round, event)) {
      setRoundResult(round, "loss", `inferred-self-death-exit:${event.ruleSet}:${event.ruleId}`, {
        kind: "self_death_then_map_rating_prompt",
        confidence: "medium",
        event,
        details: {
          player: event.payload?.player ?? null,
          secondsAfterSelfDeath: Math.round((event.timestampMs - round.latestCombatSelfDeathMs) / 1000),
        },
      });
      shouldClose = true;
    }
    round.gameMode = firstKnownGameMode(round.gameMode, inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    return shouldClose;
  }

  const placement = Number(event.payload?.placement);
  if (Number.isInteger(placement) && placement > 0) {
    if (placement === 1) {
      setRoundResult(round, "win", `placement:${event.ruleSet}:${event.ruleId}`);
      round.gameMode = firstKnownGameMode(round.gameMode, inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    } else if (isEliminationMode(round.gameMode)) {
      setRoundResult(round, "loss", `placement:${event.ruleSet}:${event.ruleId}`);
      round.gameMode = firstKnownGameMode(round.gameMode, inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    }
    return true;
  }

  const winner = event.payload?.winner?.toLowerCase();
  const winnerMatchesHint = sameHintPlayer(event.payload?.winner, event.serverPlayerIdHint);
  if (winner && (winnerIncludesOwnerName(winner, event.localUser, ownerLocalUsers) || winnerMatchesHint)) {
    addCount(round.ownerAliasesUsed, event.payload?.winner ?? event.localUser ?? "<unknown>");
    setRoundResult(round, "win", `inferred:${event.ruleSet}:${event.ruleId}`, {
      kind: winnerMatchesHint ? "owner_won_on_map_server_identity_hint" : "result",
      event,
      details: winnerMatchesHint ? {
        serverPlayerIdHint: event.serverPlayerIdHint,
        winner: event.payload?.winner ?? null,
        map: event.payload?.map ?? null,
      } : {},
    });
    round.gameMode = firstKnownGameMode(round.gameMode, inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    return true;
  }

  if (event.ruleId === "zh_player_won_on_map") {
    return false;
  }

  const winningTeam = normalizeTeam(event.payload?.winner);
  if (winningTeam && round.ownerTeam && shouldApplyTeamWinnerResult(round)) {
    setRoundResult(round, winningTeam === round.ownerTeam ? "win" : "loss", `team:${event.ruleSet}:${event.ruleId}`);
    round.gameMode = firstKnownGameMode(
      round.gameMode,
      isTrustedBedwarsTeamWin(event) ? "bedwars" : unknownGameMode,
      inferGameModeFromEvent(event),
      inferGameModeFromRuleSet(event),
    );
    return true;
  }

  if (isTrustedBedwarsTeamWin(event)) {
    setRoundResult(round, "win", `inferred:${event.ruleSet}:${event.ruleId}`);
    round.gameMode = firstKnownGameMode(round.gameMode, "bedwars", inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    return true;
  }

  if (winner && isSoloWinnerLossMode(round.gameMode) && isWinnerAnnouncement(event)) {
    setRoundResult(round, "loss", `inferred:${event.ruleSet}:${event.ruleId}`);
    round.gameMode = firstKnownGameMode(round.gameMode, inferGameModeFromEvent(event), inferGameModeFromRuleSet(event));
    return true;
  }

  if (winner === "players") {
    setRoundResult(round, "win", `inferred:${event.ruleSet}:${event.ruleId}`);
    round.gameMode = firstKnownGameMode(round.gameMode, "zombies", inferGameModeFromEvent(event));
    return true;
  }

  if (event.ruleId === "game_over" && round.gameMode === "zombies") {
    setRoundResult(round, "loss", `inferred:${event.ruleSet}:${event.ruleId}`);
    return true;
  }

  return false;
}

function shouldApplyTeamWinnerResult(round) {
  if (round.gameMode === "bedwars") return true;
  return (round.resultEvidence ?? []).some((item) =>
    item.kind === "owner_team_from_assignment" &&
    item.team === round.ownerTeam
  );
}

function isMapRatingPrompt(event) {
  return event?.ruleId === "zh_hyt_map_rating_prompt";
}

function applyMapRatingIdentityEvidence(round, event) {
  const player = event.payload?.player;
  if (!round || !player) return;
  addResultEvidence(round, "owner_alias_from_map_rating_prompt", "unknown", "high", event, { player });
  applyKnownServerPlayerToRound(round, player, {
    teamEvidenceKind: "owner_team_from_map_rating_player",
    teamEvidenceConfidence: "medium",
  });
}

function applyTaskProgressIdentityEvidence(round, event) {
  if (!isKillTaskProgress(event)) return;
  const killEvent = findRecentKillBeforeEvent(round, event);
  const player = killEvent?.payload?.killer;
  if (!player) return;

  addCount(round.ownerAliasesUsed, player);
  addResultEvidence(round, "owner_alias_from_kill_task_progress", "unknown", "high", event, {
    player,
    task: event.payload?.task ?? null,
    progress: `${event.payload?.current ?? "?"}/${event.payload?.total ?? "?"}`,
    killLineNo: killEvent.lineNo ?? null,
    killRuleSet: killEvent.ruleSet ?? null,
    killRuleId: killEvent.ruleId ?? null,
  });
  applyKnownServerPlayerToRound(round, player, {
    teamEvidenceKind: "owner_team_from_kill_task_progress",
    teamEvidenceConfidence: "high",
  });
}

function isKillTaskProgress(event) {
  return event?.type === "task_progress" && /击杀任务/.test(String(event.payload?.task ?? ""));
}

function findRecentKillBeforeEvent(round, event) {
  const events = round?.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate === event || candidate.type === "task_progress") continue;
    if (candidate.timestampMs > event.timestampMs) continue;
    if (candidate.timestampMs === event.timestampMs && candidate.lineNo >= event.lineNo) continue;
    if (candidate.type !== "kill") continue;
    if (event.timestampMs - candidate.timestampMs > TASK_PROGRESS_KILL_ALIAS_WINDOW_MS) return null;
    return candidate;
  }
  return null;
}

export function applyKnownServerPlayerToRound(round, player, options = {}) {
  const normalizedPlayer = normalizeWinnerText(player);
  if (!normalizedPlayer) return;

  let selfKills = 0;
  let selfDeaths = 0;
  let selfBedDestroys = 0;
  let latestSelfDeathMs = null;
  let latestCombatSelfDeathMs = null;
  let latestOwnFinalDeathMs = null;
  let ownerTeam = round.ownerTeam ?? null;
  let ownerTeamSourceEvent = null;
  const selfActionTimes = [];

  for (const event of round.events ?? []) {
    const payload = event.payload ?? {};
    const killerIsSelf = samePlayer(payload.killer, normalizedPlayer);
    const victimIsSelf = samePlayer(payload.victim, normalizedPlayer);
    const bedDestroyerIsSelf = samePlayer(payload.player, normalizedPlayer);

    if (event.type === "kill") {
      if (killerIsSelf) {
        selfKills += 1;
        selfActionTimes.push(event.timestampMs);
        if (!ownerTeam) {
          ownerTeam = normalizeTeam(payload.killerTeam);
          if (ownerTeam) ownerTeamSourceEvent = event;
        }
      }
      if (victimIsSelf) {
        selfDeaths += 1;
        latestSelfDeathMs = maxTimestamp(latestSelfDeathMs, event.timestampMs);
        latestCombatSelfDeathMs = maxTimestamp(latestCombatSelfDeathMs, event.timestampMs);
        if (!ownerTeam) {
          ownerTeam = normalizeTeam(payload.victimTeam);
          if (ownerTeam) ownerTeamSourceEvent = event;
        }
        if (payload.finalDeath || ["zh_final_destroy", "en_final_kill_by"].includes(event.ruleId)) {
          latestOwnFinalDeathMs = maxTimestamp(latestOwnFinalDeathMs, event.timestampMs);
        }
      }
    } else if (event.type === "death" && victimIsSelf) {
      selfDeaths += 1;
      latestSelfDeathMs = maxTimestamp(latestSelfDeathMs, event.timestampMs);
      latestCombatSelfDeathMs = maxTimestamp(latestCombatSelfDeathMs, event.timestampMs);
      if (!ownerTeam) {
        ownerTeam = normalizeTeam(payload.victimTeam);
        if (ownerTeam) ownerTeamSourceEvent = event;
      }
    } else if (event.type === "bed_destroy" && bedDestroyerIsSelf) {
      selfBedDestroys += 1;
      selfActionTimes.push(event.timestampMs);
    } else if (event.type === "team_chat" && samePlayer(payload.player, normalizedPlayer)) {
      selfActionTimes.push(event.timestampMs);
      if (!ownerTeam) {
        ownerTeam = normalizeTeam(payload.team);
        if (ownerTeam) ownerTeamSourceEvent = event;
      }
    }
  }

  round.selfKills = Math.max(round.selfKills ?? 0, selfKills);
  round.selfDeaths = Math.max(round.selfDeaths ?? 0, selfDeaths);
  round.selfBedDestroys = Math.max(round.selfBedDestroys ?? 0, selfBedDestroys);
  round.latestSelfDeathMs = maxTimestamp(round.latestSelfDeathMs, latestSelfDeathMs);
  round.latestCombatSelfDeathMs = maxTimestamp(round.latestCombatSelfDeathMs, latestCombatSelfDeathMs);
  round.latestOwnFinalDeathMs = maxTimestamp(round.latestOwnFinalDeathMs, latestOwnFinalDeathMs);
  if (latestOwnFinalDeathMs) round.ownFinalDeaths = Math.max(round.ownFinalDeaths ?? 0, 1);

  if (ownerTeam && !round.ownerTeam) {
    round.ownerTeam = ownerTeam;
    addResultEvidence(round, options.teamEvidenceKind ?? "owner_team_from_known_player", "unknown", options.teamEvidenceConfidence ?? "medium", ownerTeamSourceEvent, {
      team: ownerTeam,
      player,
      sourceEventType: ownerTeamSourceEvent?.type ?? null,
      sourceRuleSet: ownerTeamSourceEvent?.ruleSet ?? null,
      sourceRuleId: ownerTeamSourceEvent?.ruleId ?? null,
    });
  }

  if (round.ownerTeam) {
    for (const event of round.events ?? []) {
      if (event.type !== "bed_destroy") continue;
      const destroyedTeam = normalizeTeam(event.payload?.team);
      if (destroyedTeam && destroyedTeam === round.ownerTeam) {
        round.ownerBedDestroyed = true;
        round.latestOwnerBedDestroyedMs = maxTimestamp(round.latestOwnerBedDestroyedMs, event.timestampMs);
        addResultEvidence(round, "owner_bed_destroyed", "loss", "low", event);
      }
    }
  }

  const latestDeath = round.latestCombatSelfDeathMs;
  if (latestDeath) {
    round.postSelfDeathOwnerGameplaySignals = selfActionTimes.filter((timestampMs) => timestampMs > latestDeath).length;
  }
}

function shouldInferMapRatingPromptLoss(round, event) {
  if (round.gameMode !== "bedwars") return false;
  if (!round.latestCombatSelfDeathMs) return false;
  if (round.postSelfDeathOwnerGameplaySignals > 0) return false;
  const elapsedMs = event.timestampMs - round.latestCombatSelfDeathMs;
  return elapsedMs >= 0 && elapsedMs <= SELF_DEATH_EXIT_WINDOW_MS;
}

function samePlayer(value, normalizedPlayer) {
  return Boolean(value) && normalizeWinnerText(value) === normalizedPlayer;
}

function maxTimestamp(left, right) {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return left;
  return Math.max(left, right);
}

function shouldClosePendingRoundEndBefore(round, event) {
  const pending = round.pendingRoundEnd;
  if (!pending) return false;
  if (event.timestampMs <= pending.timestampMs) return false;
  const elapsedMs = event.timestampMs - pending.timestampMs;
  if ((event.type === "win" || event.type === "loss") && elapsedMs <= ROUND_END_RESULT_GRACE_MS) {
    return false;
  }
  if (elapsedMs > ROUND_END_RESULT_GRACE_MS) return true;
  if (event.type === "round_countdown" || event.type === "round_start" || event.type === "world_switch") return true;
  if (isSessionBoundaryEvent(event)) return true;
  return false;
}

function shouldClosePendingResultBefore(round, event) {
  const pending = round.pendingResult;
  if (!pending) return false;
  if (event.timestampMs <= pending.timestampMs) return false;
  const elapsedMs = event.timestampMs - pending.timestampMs;
  if ((event.type === "win" || event.type === "loss" || event.type === "round_end") && elapsedMs <= ROUND_END_RESULT_GRACE_MS) {
    return false;
  }
  if (event.type === "player_punished" && (pending.priority ?? 0) >= 50) return true;
  if (elapsedMs > ROUND_END_RESULT_GRACE_MS) return true;
  if (event.type === "game_mode") return true;
  if (event.type === "round_countdown" || event.type === "round_start" || event.type === "world_switch") return true;
  if (isSessionBoundaryEvent(event)) return true;
  return false;
}

function isEliminationMode(gameMode) {
  return ["skywars", "blitz_sg", "speed_uhc", "the_walls", "tnt_run", "dropper"].includes(gameMode);
}

function isSoloWinnerLossMode(gameMode) {
  return ["skywars", "blitz_sg", "speed_uhc", "the_walls", "tnt_run", "dropper", "duels"].includes(gameMode);
}

function isWinnerAnnouncement(event) {
  return [
    "winner_announcement",
    "winner_announcement_dash",
    "hypixel_duel_winner_line",
    "zh_winner_announcement",
    "zh_winner_plain",
  ].includes(event.ruleId);
}

function isTrustedBedwarsTeamWin(event) {
  return ["zh_bedwars_team_win", "zh_team_win_pipe", "zh_winning_team", "zh_color_winning_team"].includes(event.ruleId);
}

function resultEventPriority(event) {
  if (isDirectClientResult(event)) return 100;
  if (isRewardResult(event)) return 10;
  return 50;
}

function isDirectClientResult(event) {
  return [
    "victory_title",
    "you_won",
    "you_won_click_here",
    "you_won_fight",
    "zh_win",
    "defeat_title",
    "you_lost",
    "you_lost_fight",
    "you_died_play_again",
    "you_died_spectate_compass",
    "you_died_now_spectator",
    "zh_you_died_play_again",
    "you_permanently_died_play_again",
    "zh_you_permanently_died_play_again",
    "zh_you_died_spectate_compass",
    "you_were_eliminated",
    "zh_loss",
    "zh_clay_round_loss",
    "zh_you_eliminated",
    "zh_skywars_map_elo_win",
  ].includes(event.ruleId);
}

function isRewardResult(event) {
  return [
    "zh_bedwars_win_reward",
    "zh_skywars_win_reward",
    "en_skywars_experience_win_reward",
    "zh_generic_coin_win_reward",
    "en_generic_coin_win_reward",
  ].includes(event.ruleId);
}

function setRoundResult(round, nextResult, reason, evidence = null) {
  if (round.result !== "unknown" && round.result !== nextResult) {
    round.result = "ambiguous";
  } else {
    round.result = nextResult;
  }
  round.resultReason = reason;
  addResultEvidence(
    round,
    evidence?.kind ?? "result",
    nextResult,
    evidence?.confidence ?? "high",
    evidence?.event ?? null,
    { reason, ...(evidence?.details ?? {}) },
  );
}

function inferGameModeFromRuleSet(event) {
  if (event?.ruleSet === "bedwars") return "bedwars";
  return unknownGameMode;
}

function winnerIncludesOwnerName(winner, localUser, ownerLocalUsers) {
  const normalizedWinner = normalizeWinnerText(winner);
  const winnerParts = winner
    .split(/[,，、\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const candidates = [localUser, ...ownerLocalUsers]
    .filter(Boolean)
    .map((user) => String(user).trim().toLowerCase())
    .filter(Boolean);

  for (const user of candidates) {
    if (winnerParts.includes(user)) return true;
    if (normalizedWinner.includes(normalizeWinnerText(user))) return true;
  }
  return false;
}

function isOwnerPlayer(player, localUser, ownerLocalUsers) {
  if (!player) return false;
  const normalizedPlayer = normalizeWinnerText(player);
  return [localUser, ...ownerLocalUsers]
    .filter(Boolean)
    .some((user) => normalizeWinnerText(user) === normalizedPlayer);
}

function sameHintPlayer(player, serverPlayerIdHint) {
  if (!player || !serverPlayerIdHint) return false;
  return normalizeWinnerText(player) === normalizeWinnerText(serverPlayerIdHint);
}

function normalizeWinnerText(value) {
  return String(value ?? "")
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .toLowerCase()
    .trim();
}

function normalizeTeam(value) {
  if (!value) return null;
  const text = String(value)
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[\s:：|,，!！.。-]+/g, "")
    .replace(/色|队伍|之队|队|team|the/g, "")
    .trim();
  const aliases = {
    red: "red",
    红: "red",
    blue: "blue",
    蓝: "blue",
    green: "green",
    绿: "green",
    yellow: "yellow",
    黄: "yellow",
    aqua: "aqua",
    cyan: "aqua",
    青: "aqua",
    white: "white",
    白: "white",
    pink: "pink",
    粉: "pink",
    gray: "gray",
    grey: "gray",
    灰: "gray",
    purple: "purple",
    紫: "purple",
    orange: "orange",
    橙: "orange",
  };
  return aliases[text] ?? null;
}

function addCount(target, key) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function hasObjectValues(value) {
  return Object.values(value ?? {}).some((count) => count > 0);
}

function eventSortPriority(event) {
  if (event.type === "win" || event.type === "loss") return 1;
  if (event.type === "round_end") return 2;
  if (event.type === "round_countdown" || event.type === "round_start" || event.type === "world_switch") return 3;
  if (["client_start", "client_stop", "server_connect", "player_left", "singleplayer_stop", "crash", "lobby_signal"].includes(event.type)) return 4;
  return 0;
}
