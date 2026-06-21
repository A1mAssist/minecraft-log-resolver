import assert from "node:assert/strict";
import { parseLine } from "../src/parser/lineParser.mjs";
import { createTimestampResolver, inferFileBaseDate, parseTimeOfDay } from "../src/parser/time.mjs";
import { applyBoundaryResultInference, buildRounds, buildRoundsByFile, getIgnoredRoundReason, isReliableRound } from "../src/parser/roundBuilder.mjs";
import { annotateSelf } from "../src/parser/chatEventAnalyzer.mjs";
import { buildServerIdentityHints } from "../src/parser/serverIdentityHints.mjs";
import { buildTimeline } from "../src/parser/sessionBuilder.mjs";
import { applyPostIdentityResultInference, buildActivity, buildReport, propagateServerPlayerIdentityWithinPlaySegments } from "../src/report/reportBuilder.mjs";
import { resolveServerPlayerIdentity } from "../src/report/playerIdentity.mjs";
import { buildDirectServerContext, inferProxiedServerContext, inferServerContextFromChatLines, parseServerConnectMessage } from "../src/parser/serverContext.mjs";
import { buildUnknownAudit, buildUnknownAuditSummary } from "../src/report/unknownAudit.mjs";

testLineParser();
testTimeHelpers();
testServerContext();
testSessionBuilder();
testServerIdentityHints();
testRoundBuilder();
testActivityBuilder();
testStreakMetrics();
testPlaySegmentIdentityPropagation();
testPostIdentityResultInference();
testUnknownAudit();
testPlayerIdentity();

console.log("core parser tests passed");

function testLineParser() {
  const parsed = parseLine("latest.log", 42, "[12:34:56] [Client thread/INFO]: [CHAT] 起床战争>> 游戏开始 ...");
  assert.equal(parsed.timeText, "12:34:56");
  assert.equal(parsed.isChat, true);
  assert.equal(parsed.message, "起床战争>> 游戏开始 ...");

  const plain = parseLine("latest.log", 43, "[01:02:03] [Client thread/INFO]: Setting user: Steve");
  assert.equal(plain.timeText, "01:02:03");
  assert.equal(plain.isChat, false);
  assert.equal(plain.message, "Setting user: Steve");

  const raw = parseLine("!CHAT0101_00_00.log", 1, "raw chat text");
  assert.equal(raw.timeText, null);
  assert.equal(raw.message, "raw chat text");
}

function testTimeHelpers() {
  assert.equal(parseTimeOfDay("01:02:03"), 3723);
  assert.equal(parseTimeOfDay("bad"), null);

  const datedFile = {
    path: "D:/logs/2024-03-16-1.log.gz",
    modifiedMs: new Date(2026, 0, 1).getTime(),
  };
  assert.deepEqual(inferFileBaseDate(datedFile), {
    year: 2024,
    month: 3,
    day: 16,
    source: "filename",
  });

  const resolver = createTimestampResolver(datedFile);
  const beforeMidnight = resolver.resolve("23:59:59");
  const afterMidnight = resolver.resolve("00:00:01");
  assert.equal(afterMidnight - beforeMidnight, 2000);
}

function testServerContext() {
  assert.deepEqual(parseServerConnectMessage("Connecting to mc.hypixel.net, 25565"), {
    host: "mc.hypixel.net",
    port: 25565,
    address: "mc.hypixel.net",
  });

  const hypixel = buildDirectServerContext({ host: "mc.hypixel.net", port: 25565, event: { lineNo: 7, timestampMs: 123 }, text: "Connecting to mc.hypixel.net, 25565" });
  assert.equal(hypixel.serverNetwork, "Hypixel");
  assert.equal(hypixel.serverAddress, "mc.hypixel.net");
  assert.equal(hypixel.serverLabel, "Hypixel");
  assert.equal(hypixel.serverConfidence, "direct");
  assert.equal(hypixel.serverEvidence.source, "server_connect");
  assert.equal(hypixel.serverEvidence.lineNo, 7);

  const netease = buildDirectServerContext({ host: "neteasehyt.liunian.pro", port: 25565 });
  assert.equal(netease.serverNetwork, "NetEase");
  assert.equal(netease.serverLabel, "花雨庭");

  const hytIp = buildDirectServerContext({ host: "59.111.137.99", port: 25565 });
  assert.equal(hytIp.serverNetwork, "NetEase");
  assert.equal(hytIp.serverAddress, "59.111.137.99");
  assert.equal(hytIp.serverLabel, "花雨庭");

  const hytPc = buildDirectServerContext({ host: "hytpc.mc.netease.com", port: 25565 });
  assert.equal(hytPc.serverNetwork, "NetEase");
  assert.equal(hytPc.serverAddress, "hytpc.mc.netease.com");
  assert.equal(hytPc.serverLabel, "花雨庭");

  const clayCloud = buildDirectServerContext({ host: "42.186.61.162", port: 25565 });
  assert.equal(clayCloud.serverNetwork, "粘土云");
  assert.equal(clayCloud.serverAddress, "42.186.61.162");
  assert.equal(clayCloud.serverLabel, "粘土云");

  const beeServer = buildDirectServerContext({ host: "42.186.64.241", port: 25565 });
  assert.equal(beeServer.serverNetwork, "小蜜蜂");
  assert.equal(beeServer.serverAddress, "42.186.64.241");
  assert.equal(beeServer.serverLabel, "小蜜蜂");

  const hmxix = buildDirectServerContext({ host: "a.polars.cc", port: 31001 });
  assert.equal(hmxix.serverNetwork, "HmXix");
  assert.equal(hmxix.serverAddress, "a.polars.cc:31001");
  assert.equal(hmxix.serverLabel, "HmXix");

  const hytAccelerator = buildDirectServerContext({ host: "mc.aisu.site", port: 57358 });
  assert.equal(hytAccelerator.serverNetwork, "NetEase");
  assert.equal(hytAccelerator.serverAddress, "mc.aisu.site:57358");
  assert.equal(hytAccelerator.serverLabel, "花雨庭");

  const rhymcTest = buildDirectServerContext({ host: "mc32.rhymc.com", port: 36419 });
  assert.equal(rhymcTest.serverNetwork, "反作弊测试服务器");
  assert.equal(rhymcTest.serverAddress, "mc32.rhymc.com:36419");
  assert.equal(rhymcTest.serverLabel, "反作弊测试服务器");

  const hypAccelerator = buildDirectServerContext({ host: "8sc81idb4jgn2.ld0qg7mt.hyp.su", port: 25565 });
  assert.equal(hypAccelerator.serverNetwork, "Hypixel");
  assert.equal(hypAccelerator.serverAddress, "8sc81idb4jgn2.ld0qg7mt.hyp.su");
  assert.equal(hypAccelerator.serverLabel, "Hypixel");

  const remiaft = buildDirectServerContext({ host: "mc.remiaft.com", port: 1337 });
  assert.equal(remiaft.serverNetwork, "Remiaft");
  assert.equal(remiaft.serverAddress, "mc.remiaft.com:1337");
  assert.equal(remiaft.serverLabel, "Remiaft");

  const mcyc = buildDirectServerContext({ host: "mcyc.win", port: 25565 });
  assert.equal(mcyc.serverNetwork, "游戏世界");
  assert.equal(mcyc.serverAddress, "mcyc.win");
  assert.equal(mcyc.serverLabel, "游戏世界");

  const testServer = buildDirectServerContext({ host: "testserver.loyisa.cn", port: 1337 });
  assert.equal(testServer.serverNetwork, "Loyisa's Test Server");
  assert.equal(testServer.serverAddress, "testserver.loyisa.cn:1337");
  assert.equal(testServer.serverLabel, "Loyisa's Test Server");

  const localProxy = buildDirectServerContext({ host: "127.0.0.1", port: 25565 });
  assert.equal(localProxy.serverNetwork, null);
  assert.equal(localProxy.serverAddress, "127.0.0.1");
  assert.equal(localProxy.serverLabel, "本地代理 / 未知服务器");

  const proxiedHyt = inferProxiedServerContext(localProxy, {
    events: [{ ruleSet: "game-state", ruleId: "zh_hyt_welcome", lineNo: 8, timestampMs: 456 }],
  });
  assert.equal(proxiedHyt.serverNetwork, "NetEase");
  assert.equal(proxiedHyt.serverAddress, "127.0.0.1");
  assert.equal(proxiedHyt.serverLabel, "花雨庭");
  assert.equal(proxiedHyt.serverConfidence, "inferred");
  assert.equal(proxiedHyt.serverEvidence.source, "chat_template");

  const proxiedHypixel = inferProxiedServerContext(buildDirectServerContext({ host: "192.168.31.215", port: 25565 }), {
    chatLines: [{ message: "Welcome to Hypixel SkyWars", lineNo: 9, timestampMs: 789 }],
  });
  assert.equal(proxiedHypixel.serverNetwork, "Hypixel");
  assert.equal(proxiedHypixel.serverAddress, "192.168.31.215");
  assert.equal(proxiedHypixel.serverLabel, "Hypixel");
  assert.equal(proxiedHypixel.serverEvidence.source, "chat_text");

  const proxiedBujidao = inferProxiedServerContext(buildDirectServerContext({ host: "localhost", port: 25565 }), {
    chatLines: [{ message: "布吉岛>>今天你还没有签到哦~(/qd 或者点击NPC打开)", lineNo: 10, timestampMs: 790 }],
  });
  assert.equal(proxiedBujidao.serverNetwork, "布吉岛");
  assert.equal(proxiedBujidao.serverAddress, "localhost");
  assert.equal(proxiedBujidao.serverLabel, "布吉岛");
  assert.equal(proxiedBujidao.serverEvidence.source, "chat_text");

  const chatOnlyHyt = inferServerContextFromChatLines([
    { message: "[花雨庭] 您有1封未读邮件，按M键查看", lineNo: 11, timestampMs: 791 },
  ]);
  assert.equal(chatOnlyHyt.serverNetwork, "NetEase");
  assert.equal(chatOnlyHyt.serverAddress, null);
  assert.equal(chatOnlyHyt.serverLabel, "花雨庭");
  assert.equal(chatOnlyHyt.serverConfidence, "inferred");
  assert.equal(chatOnlyHyt.serverEvidence.source, "chat_text");

  const chatOnlyHmxix = inferServerContextFromChatLines([
    { message: "您好，欢迎来到 HmXix(黑客服) 。", lineNo: 12, timestampMs: 792 },
  ]);
  assert.equal(chatOnlyHmxix.serverNetwork, "HmXix");
  assert.equal(chatOnlyHmxix.serverLabel, "HmXix");

  const clayClientNoise = inferProxiedServerContext(buildDirectServerContext({ host: "10.0.0.2", port: 25565 }), {
    chatLines: [{ message: "Clay-1.12.2 client loaded", lineNo: 10, timestampMs: 888 }],
  });
  assert.equal(clayClientNoise, null);

  const directNotOverridden = inferProxiedServerContext(hypixel, {
    chatLines: [{ message: "花雨庭祝你游戏愉快", lineNo: 10, timestampMs: 999 }],
  });
  assert.equal(directNotOverridden, null);

  const unknownHost = buildDirectServerContext({ host: "example.org", port: 25566 });
  assert.equal(unknownHost.serverNetwork, null);
  assert.equal(unknownHost.serverAddress, "example.org:25566");
  assert.equal(unknownHost.serverLabel, "example.org:25566");

  const testServerRound = buildRounds([
    event("server_connect", 10_000, 1, {}, "D:/logs/testserver.log", {}, "LauncherUser", "session", "server_connect"),
    event("round_start", 11_000, 2, {}, "D:/logs/testserver.log", {}, "LauncherUser", "bedwars", "round_start"),
  ]);
  testServerRound[0].serverAddress = "testserver.loyisa.cn:1337";
  testServerRound[0].serverLabel = "Loyisa's Test Server";
  assert.equal(getIgnoredRoundReason(testServerRound[0]), "test_server");
  assert.equal(isReliableRound(testServerRound[0]), false);

  const rhymcTestServerRound = buildRounds([
    event("server_connect", 10_000, 1, {}, "D:/logs/rhymc.log", {}, "LauncherUser", "session", "server_connect"),
    event("round_start", 11_000, 2, {}, "D:/logs/rhymc.log", {}, "LauncherUser", "bedwars", "round_start"),
  ]);
  rhymcTestServerRound[0].serverAddress = "mc32.rhymc.com:36419";
  rhymcTestServerRound[0].serverLabel = "反作弊测试服务器";
  assert.equal(getIgnoredRoundReason(rhymcTestServerRound[0]), "test_server");
}

function testSessionBuilder() {
  const filePath = "D:/logs/account-switch.log";
  const timeline = buildTimeline([
    timelineEvent("client_start", 0, 1, filePath, "FirstUser"),
    timelineEvent("server_connect", 10_000, 2, filePath, "FirstUser", { serverHost: "mc.hypixel.net", serverPort: 25565, serverAddress: "mc.hypixel.net" }),
    timelineEvent("player_joined", 20_000, 3, filePath, "FirstUser"),
    timelineEvent("client_start", 60_000, 4, filePath, "SecondUser"),
    timelineEvent("server_connect", 70_000, 5, filePath, "SecondUser"),
    timelineEvent("player_joined", 80_000, 6, filePath, "SecondUser"),
    timelineEvent("client_stop", 120_000, 7, filePath, "SecondUser"),
  ]);

  assert.equal(timeline.clientSessions.length, 2);
  assert.equal(timeline.clientSessions[0].localUser, "FirstUser");
  assert.equal(timeline.clientSessions[0].endReason, "next_client_start");
  assert.equal(timeline.clientSessions[0].durationSeconds, 60);
  assert.equal(timeline.clientSessions[1].localUser, "SecondUser");
  assert.equal(timeline.clientSessions[1].endReason, "client_stop");
  assert.equal(timeline.playSegments.length, 2);
  assert.equal(timeline.playSegments[0].localUser, "FirstUser");
  assert.equal(timeline.playSegments[0].endReason, "next_client_start");
  assert.equal(timeline.playSegments[0].serverAddress, "mc.hypixel.net");
  assert.equal(timeline.playSegments[0].serverHost, "mc.hypixel.net");
  assert.equal(timeline.playSegments[1].localUser, "SecondUser");
}

function testServerIdentityHints() {
  const filePath = "D:/logs/pre-identity-bedwars.log";
  const events = [
    event("server_connect", 0, 1, {}, filePath, {}, "LauncherUser", "session", "server_connect"),
    event("round_countdown", 10_000, 2, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event("player_punished", 50_000, 3, { player: "ServerNick", reason: "abnormal_behavior_ban" }, filePath, {}, "LauncherUser", "game-state", "zh_player_punished_for_abnormal_behavior"),
    event("round_countdown", 80_000, 4, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event("kill", 90_000, 5, { killer: "ServerNick", killerTeam: "Green", victim: "Enemy", victimTeam: "Red" }, filePath, {}, "LauncherUser", "bedwars", "zh_kill_team"),
    event("task_progress", 90_000, 6, { current: "22", total: "150", task: "击杀任务", period: "每周" }, filePath, {}, "LauncherUser", "game-state", "zh_task_progress_update"),
  ];

  const hints = buildServerIdentityHints(events);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].player, "ServerNick");

  const rounds = buildRoundsByFile(events);
  assert.equal(rounds[0].result, "loss");
  assert.equal(rounds[0].resultReason, "owner-punished:game-state:zh_player_punished_for_abnormal_behavior");
  assert.equal(rounds[0].ownerAliasesUsed.ServerNick, 1);
  assert.ok(rounds[0].resultEvidence.some((item) => item.kind === "owner_punished_server_identity_hint" && item.serverPlayerIdHint === "ServerNick"));
  assert.equal(rounds[1].ownerAliasesUsed.ServerNick, 2);
  assert.equal(rounds[1].selfKills, 1);

  const winnerRounds = buildRoundsByFile([
    event("server_connect", 0, 1, {}, filePath, {}, "LauncherUser", "session", "server_connect"),
    event("round_countdown", 10_000, 2, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event("round_end", 60_000, 3, { winner: "ServerNick", map: "Cake" }, filePath, {}, "LauncherUser", "game-state", "zh_player_won_on_map"),
    event("round_countdown", 80_000, 4, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event("round_end", 90_000, 5, { gameMode: "bedwars", player: "ServerNick", map: "Cake" }, filePath, {}, "LauncherUser", "game-state", "zh_hyt_map_rating_prompt"),
  ]);
  assert.equal(winnerRounds[0].result, "win");
  assert.equal(winnerRounds[0].resultReason, "inferred:game-state:zh_player_won_on_map");
  assert.ok(winnerRounds[0].resultEvidence.some((item) => item.kind === "owner_won_on_map_server_identity_hint" && item.winner === "ServerNick"));
}

function testRoundBuilder() {
  const fileA = "D:/logs/a.log";
  const fileB = "D:/logs/b.log";
  const events = [
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }),
    event("death", 120_000, 3, { victim: "Owner" }, fileA, { death: true }),
    event("bed_destroy", 180_000, 4, { player: "Owner", team: "Blue" }, fileA, { bedDestroy: true }),
    event("win", 300_000, 5, {}, fileA),
    event("round_countdown", 360_000, 6, { seconds: "10" }, fileA),
    event("round_countdown", 10_000, 1, { seconds: "10" }, fileB),
    event("kill", 70_000, 2, { killer: "Other", victim: "Enemy" }, fileB),
  ];

  const rounds = buildRounds(events.filter((item) => item.filePath === fileA));
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].durationSeconds, 300);
  assert.equal(rounds[0].kills, 1);
  assert.equal(rounds[0].deaths, 1);
  assert.equal(rounds[0].bedDestroys, 1);
  assert.equal(rounds[0].selfKills, 1);
  assert.equal(rounds[0].selfDeaths, 1);
  assert.equal(rounds[0].selfBedDestroys, 1);
  assert.equal(rounds[0].result, "win");
  assert.equal(rounds[0].endReason, "result");
  assert.equal(rounds[0].gameMode, "bedwars");
  assert.equal(isReliableRound(rounds[0]), true);

  const byFile = buildRoundsByFile(events);
  assert.equal(byFile.length, 3);
  assert.equal(byFile.some((round) => round.filePath === fileB), true);

  const byFileAliasWinnerRound = buildRoundsByFile(
    [
      event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "LocalUser"),
      event("round_end", 60_000, 2, { winner: "ServerNick", map: "TestMap" }, fileA, {}, "LocalUser"),
    ],
    { ownerAliases: ["ServerNick"] },
  )[0];
  assert.equal(byFileAliasWinnerRound.result, "win");

  assert.deepEqual(
    annotateSelf({ type: "kill", payload: { killer: "ServerNick", victim: "Enemy" } }, "LocalUser", ["ServerNick"]),
    { kill: true, death: false, bedDestroy: false },
  );
  assert.deepEqual(
    annotateSelf({ type: "bed_destroy", payload: { player: "ServerNick" } }, "LocalUser", ["ServerNick"]),
    { kill: false, death: false, bedDestroy: true },
  );

  const tinyRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_countdown", 1000, 2, { seconds: "10" }, fileA),
  ])[0];
  assert.equal(isReliableRound(tinyRound), false);

  const waitingOnlyRound = buildRounds([
    neutralEvent("game_mode", 0, 1, { gameMode: "bedwars" }, fileA, {}, "Owner", "game-state", "bedwars_mode"),
    neutralEvent("round_countdown", 10_000, 2, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("player_join", 20_000, 3, { player: "A", players: "4" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
  ])[0];
  assert.equal(waitingOnlyRound.gameMode, "bedwars");
  assert.equal(isReliableRound(waitingOnlyRound), false);

  const repeatedCountdownRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("round_countdown", 15_000, 2, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("game_mode", 30_000, 3, { gameMode: "bedwars" }, fileA, {}, "Owner", "game-state", "bedwars_mode"),
  ])[0];
  assert.equal(repeatedCountdownRound.durationSeconds, 15);
  assert.equal(repeatedCountdownRound.gameMode, "bedwars");
  assert.equal(repeatedCountdownRound.startMs, 15_000);
  assert.equal(isReliableRound(repeatedCountdownRound), false);
  assert.equal(getIgnoredRoundReason(repeatedCountdownRound), "waiting_only");

  const waitingCandidateThenRealGameRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("player_join", 5_000, 2, { player: "A", players: "4" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    neutralEvent("round_countdown", 60_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("round_start", 70_000, 4, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_cages_opened"),
    neutralEvent("kill", 90_000, 5, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
  ])[0];
  assert.equal(waitingCandidateThenRealGameRound.startMs, 60_000);
  assert.equal(waitingCandidateThenRealGameRound.durationSeconds, 30);
  assert.equal(waitingCandidateThenRealGameRound.gameMode, "skywars");
  assert.deepEqual(
    waitingCandidateThenRealGameRound.boundaryEvents.map((item) => `${item.role}:${item.type}:${item.lineNo}`),
    ["start:round_countdown:3", "merge:round_start:4"],
  );
  assert.equal(isReliableRound(waitingCandidateThenRealGameRound), true);

  const startedWithoutGameplayRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    neutralEvent("round_countdown", 50_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.equal(startedWithoutGameplayRound.durationSeconds, 10);
  assert.equal(getIgnoredRoundReason(startedWithoutGameplayRound), "started_without_gameplay");

  const longerStartedWithoutGameplayRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    neutralEvent("player_join", 96_000, 3, { player: "Other", players: "8" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    neutralEvent("round_countdown", 130_000, 4, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.equal(longerStartedWithoutGameplayRound.durationSeconds, 96);
  assert.equal(getIgnoredRoundReason(longerStartedWithoutGameplayRound), "started_without_gameplay");

  const directStartWithoutGameplayRound = buildRounds([
    neutralEvent("round_start", 0, 1, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    neutralEvent("player_join", 86_000, 2, { player: "Other", players: "8" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    neutralEvent("round_countdown", 130_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.equal(directStartWithoutGameplayRound.durationSeconds, 86);
  assert.equal(getIgnoredRoundReason(directStartWithoutGameplayRound), "started_without_gameplay");

  const shortStartedRoundWithGameplay = buildRounds([
    neutralEvent("round_start", 0, 1, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    neutralEvent("kill", 40_000, 2, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    neutralEvent("round_countdown", 80_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortStartedRoundWithGameplay), "started_without_gameplay");

  const nextRoundEndsAtLastGameplayRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("kill", 60_000, 2, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    neutralEvent("player_join", 120_000, 3, { player: "A", players: "4" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    neutralEvent("round_countdown", 180_000, 4, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.equal(nextRoundEndsAtLastGameplayRound.endMs, 60_000);
  assert.equal(nextRoundEndsAtLastGameplayRound.durationSeconds, 60);

  const shortUnownedCombatRound = buildRounds([
    neutralEvent("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("kill", 20_000, 2, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "minecraft-combat", "player_killed"),
    neutralEvent("round_countdown", 80_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
  ])[0];
  assert.equal(shortUnownedCombatRound.durationSeconds, 20);
  assert.equal(getIgnoredRoundReason(shortUnownedCombatRound), "short_unowned_combat");

  const shortUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 40_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
    event("round_countdown", 90_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.equal(getIgnoredRoundReason(shortUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");

  const mediumUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 150_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
    event("server_connect", 170_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(mediumUnownedBedwarsNoResultEvidenceRound.durationSeconds, 170);
  assert.equal(getIgnoredRoundReason(mediumUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");

  const mediumExtendedUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 300_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
    event("server_connect", 359_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(mediumExtendedUnownedBedwarsNoResultEvidenceRound.durationSeconds, 359);
  assert.equal(getIgnoredRoundReason(mediumExtendedUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");

  const longUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 300_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
    event("server_connect", 360_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(longUnownedBedwarsNoResultEvidenceRound.durationSeconds, 360);
  assert.notEqual(getIgnoredRoundReason(longUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");
  assert.equal(getIgnoredRoundReason(longUnownedBedwarsNoResultEvidenceRound), "low_evidence_unowned_bedwars_pseudo_fragment");

  const extendedLowEvidenceBedwarsPseudoFragment = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("kill", 1_200_000, 3, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "bedwars", "zh_kill_team"),
    event("client_stop", 2_690_000, 4, {}, fileA, {}, "Owner", "session", "client_stop"),
  ])[0];
  assert.equal(extendedLowEvidenceBedwarsPseudoFragment.durationSeconds, 2690);
  assert.equal(getIgnoredRoundReason(extendedLowEvidenceBedwarsPseudoFragment), "low_evidence_unowned_bedwars_pseudo_fragment");

  const extendedBedwarsPseudoFragmentWithOwnerEvidence = {
    ...extendedLowEvidenceBedwarsPseudoFragment,
    resultEvidence: [
      {
        kind: "owner_alias_from_play_segment",
        result: "unknown",
        confidence: "medium",
      },
    ],
  };
  assert.notEqual(getIgnoredRoundReason(extendedBedwarsPseudoFragmentWithOwnerEvidence), "low_evidence_unowned_bedwars_pseudo_fragment");

  const lowEvidenceLastEventBedwarsPseudoFragment = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 250_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
  ])[0];
  assert.equal(getIgnoredRoundReason(lowEvidenceLastEventBedwarsPseudoFragment), "low_evidence_unowned_bedwars_pseudo_fragment");

  const mediumLowEvidenceBedwarsPseudoFragment = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    ...Array.from({ length: 12 }, (_, index) =>
      event(index % 2 === 0 ? "kill" : "death", 20_000 + index * 5_000, 3 + index, {
        killer: `Other${index}`,
        victim: `Enemy${index}`,
      }, fileA, {}, "Owner", "bedwars", "zh_kill_team")
    ),
    event("round_countdown", 160_000, 20, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.equal(getIgnoredRoundReason(mediumLowEvidenceBedwarsPseudoFragment), "medium_low_evidence_unowned_bedwars_pseudo_fragment");

  const mediumLowEvidenceBedwarsPseudoFragmentWithBedDestroy = {
    ...mediumLowEvidenceBedwarsPseudoFragment,
    bedDestroys: 1,
    bedDestroyedTeams: { red: 1 },
  };
  assert.notEqual(getIgnoredRoundReason(mediumLowEvidenceBedwarsPseudoFragmentWithBedDestroy), "medium_low_evidence_unowned_bedwars_pseudo_fragment");

  const strongerCombatBedwarsRound = {
    ...mediumLowEvidenceBedwarsPseudoFragment,
    kills: 13,
    deaths: 0,
  };
  assert.notEqual(getIgnoredRoundReason(strongerCombatBedwarsRound), "medium_low_evidence_unowned_bedwars_pseudo_fragment");

  const mediumLowEvidenceLastEventBedwarsFragment = {
    ...mediumLowEvidenceBedwarsPseudoFragment,
    endReason: "last_event",
  };
  assert.notEqual(getIgnoredRoundReason(mediumLowEvidenceLastEventBedwarsFragment), "medium_low_evidence_unowned_bedwars_pseudo_fragment");

  const lastEventUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 150_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
  ])[0];
  assert.equal(lastEventUnownedBedwarsNoResultEvidenceRound.endReason, "last_event");
  assert.equal(getIgnoredRoundReason(lastEventUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");

  const longLastEventUnownedBedwarsNoResultEvidenceRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 180_000, 3, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
  ])[0];
  assert.equal(longLastEventUnownedBedwarsNoResultEvidenceRound.endReason, "last_event");
  assert.equal(longLastEventUnownedBedwarsNoResultEvidenceRound.durationSeconds, 180);
  assert.notEqual(getIgnoredRoundReason(longLastEventUnownedBedwarsNoResultEvidenceRound), "short_unowned_bedwars_no_result_evidence");

  const shortUnownedBedwarsNonOwnerPunishmentNoiseRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("player_punished", 10_000, 2, { player: "Other" }, fileA, {}, "Owner", "game-state", "zh_abnormal_behavior_ban"),
    event("round_end", 11_000, 3, { winner: "SomeoneElse", map: "Other Map" }, fileA, {}, "Owner", "game-state", "zh_player_won_on_map"),
    event("round_countdown", 70_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.equal(getIgnoredRoundReason(shortUnownedBedwarsNonOwnerPunishmentNoiseRound), "short_unowned_bedwars_non_owner_punishment_noise");

  const shortUnownedBedwarsLastEventPunishmentNoiseRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("kill", 20_000, 3, { killer: "OtherA", victim: "OtherB" }, fileA, {}, "Owner", "bedwars", "zh_final_destroy"),
    event("death", 24_000, 4, { victim: "OtherC" }, fileA, {}, "Owner", "bedwars", "zh_void_death"),
    event("kill", 28_000, 5, { killer: "OtherD", victim: "OtherE" }, fileA, {}, "Owner", "bedwars", "zh_final_destroy"),
    event("player_punished", 37_000, 6, { player: "OtherA" }, fileA, {}, "Owner", "game-state", "zh_abnormal_behavior_ban"),
  ])[0];
  assert.equal(shortUnownedBedwarsLastEventPunishmentNoiseRound.endReason, "last_event");
  assert.equal(getIgnoredRoundReason(shortUnownedBedwarsLastEventPunishmentNoiseRound), "short_unowned_bedwars_non_owner_punishment_noise");

  const shortUnownedBedwarsPunishmentWithSelfActionRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("kill", 20_000, 3, { killer: "Owner", victim: "Other" }, fileA, { kill: true }, "Owner", "bedwars", "zh_final_destroy"),
    event("player_punished", 37_000, 4, { player: "Other" }, fileA, {}, "Owner", "game-state", "zh_abnormal_behavior_ban"),
    event("round_countdown", 70_000, 5, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsPunishmentWithSelfActionRound), "short_unowned_bedwars_non_owner_punishment_noise");

  const shortBedwarsOwnerPunishedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("player_punished", 10_000, 2, { player: "Owner" }, fileA, {}, "Owner", "game-state", "zh_abnormal_behavior_ban"),
    event("round_countdown", 70_000, 3, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.equal(shortBedwarsOwnerPunishedRound.result, "loss");
  assert.notEqual(getIgnoredRoundReason(shortBedwarsOwnerPunishedRound), "short_unowned_bedwars_non_owner_punishment_noise");

  const shortUnownedBedwarsWithOwnerTeamRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("team_assignment", 5_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("round_start", 10_000, 3, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("death", 40_000, 4, { victim: "Other", victimTeam: "Red" }, fileA, {}, "Owner", "bedwars", "zh_death_team"),
    event("round_countdown", 90_000, 5, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsWithOwnerTeamRound), "short_unowned_bedwars_no_result_evidence");

  const shortUnownedBedwarsWithSelfActionRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("kill", 40_000, 3, { killer: "Owner", victim: "Other", killerTeam: "Blue" }, fileA, { kill: true }, "Owner", "bedwars", "zh_kill_team"),
    event("round_countdown", 90_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsWithSelfActionRound), "short_unowned_bedwars_no_result_evidence");

  const shortUnownedBedwarsWithBedDestroyRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("bed_destroy", 40_000, 3, { player: "Other", team: "Red" }, fileA, {}, "Owner", "bedwars", "zh_bed_destroy"),
    event("round_countdown", 90_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsWithBedDestroyRound), "short_unowned_bedwars_no_result_evidence");

  const shortUnownedBedwarsWithTeamEliminationRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("team_eliminated", 40_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("round_countdown", 90_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsWithTeamEliminationRound), "short_unowned_bedwars_no_result_evidence");

  const shortUnownedBedwarsWithOwnerBedDestroyedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("team_assignment", 5_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("round_start", 10_000, 3, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("bed_destroy", 40_000, 4, { player: "Other", team: "Blue" }, fileA, {}, "Owner", "bedwars", "zh_bed_destroy"),
    event("round_countdown", 90_000, 5, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
  ])[0];
  assert.equal(shortUnownedBedwarsWithOwnerBedDestroyedRound.ownerBedDestroyed, true);
  assert.notEqual(getIgnoredRoundReason(shortUnownedBedwarsWithOwnerBedDestroyedRound), "short_unowned_bedwars_no_result_evidence");

  const externalBroadcastOnlyBedwarsPseudoRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown"),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("round_end", 150_000, 3, { winner: "OtherPlayer", map: "Cake" }, fileA, {}, "Owner", "game-state", "zh_player_won_on_map"),
    event("server_connect", 170_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(externalBroadcastOnlyBedwarsPseudoRound.result, "unknown");
  assert.ok(externalBroadcastOnlyBedwarsPseudoRound.resultEvidence.some((item) => item.kind === "external_winner_broadcast" && item.confidence === "ignored"));
  assert.equal(getIgnoredRoundReason(externalBroadcastOnlyBedwarsPseudoRound), "short_unowned_bedwars_no_result_evidence");

  const bedwarsPseudoRoundHintReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      {
        ...postIdentityRound({
          startMs: 0,
          endMs: 400_000,
          lastEventMs: 380_000,
          durationSeconds: 400,
          endReason: "server_connect",
          lineNo: 1,
        }),
        kills: 13,
        deaths: 1,
        bedDestroys: 0,
        selfKills: 0,
        selfDeaths: 0,
        selfDeathSignals: 0,
        selfBedDestroys: 0,
        roundStarts: 1,
        roundEnds: 0,
        joins: 0,
        leaves: 0,
        killers: {},
        victims: { Other: 1, Enemy: 13 },
        bedDestroyers: {},
        teamEliminations: {},
        bedDestroyedTeams: {},
        ownerBedDestroyed: false,
        ownerTeamEliminated: false,
        ownFinalDeaths: 0,
        latestOwnFinalDeathMs: null,
        boundaryEvents: [],
      },
    ],
  });
  assert.equal(bedwarsPseudoRoundHintReport.rounds.reliable[0].resultHint.value, "keep_unknown");
  assert.equal(bedwarsPseudoRoundHintReport.rounds.reliable[0].resultHint.reason, "low_evidence_bedwars_pseudo_round_candidate");
  assert.equal(bedwarsPseudoRoundHintReport.rounds.reliable[0].unknownAudit.category, "bedwars_low_evidence_pseudo_candidate");
  assert.equal(bedwarsPseudoRoundHintReport.rounds.reliable[0].unknownAudit.nextAction, "label_sample");
  assert.equal(bedwarsPseudoRoundHintReport.results.unknownHints.byReason.low_evidence_bedwars_pseudo_round_candidate, 1);
  assert.equal(bedwarsPseudoRoundHintReport.results.unknownAudit.byCategory.bedwars_low_evidence_pseudo_candidate, 1);

  const serverContextReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [
      {
        source: "TestSource",
        scope: "BedWars TestScope",
        logFiles: 1,
        bytes: 100,
        events: { client_start: 0, client_stop: 0, server_connect: 1, chat_message: 0, death_or_kill: 0, crash: 0 },
        clientSessions: [],
        playSegments: [
          {
            scope: "BedWars TestScope",
            localUser: "LauncherUser",
            type: "multiplayer",
            startMs: 0,
            endMs: 200_000,
            durationSeconds: 200,
            startFile: "D:/logs/post-identity-bedwars.log",
            serverHost: "mc.hypixel.net",
            serverAddress: "mc.hypixel.net",
            serverPort: 25565,
            serverConnectLineNo: 12,
            serverConnectMessage: "Connecting to mc.hypixel.net, 25565",
          },
          {
            scope: "BedWars TestScope",
            localUser: "LauncherUser",
            type: "multiplayer",
            startMs: 500_000,
            endMs: 650_000,
            durationSeconds: 150,
            startFile: "D:/logs/proxy-hyt.log",
            serverHost: "127.0.0.1",
            serverAddress: "127.0.0.1",
            serverPort: 25565,
            serverConnectLineNo: 20,
            serverConnectMessage: "Connecting to 127.0.0.1, 25565",
          },
          {
            scope: "BedWars TestScope",
            localUser: "LauncherUser",
            type: "multiplayer",
            startMs: 700_000,
            endMs: 850_000,
            durationSeconds: 150,
            startFile: "D:/logs/proxy-hypixel.log",
            serverHost: "192.168.31.215",
            serverAddress: "192.168.31.215",
            serverPort: 25565,
            serverConnectLineNo: 30,
            serverConnectMessage: "Connecting to 192.168.31.215, 25565",
          },
        ],
      },
    ],
    eventResult: {
      ...emptyEventResult(),
      events: [
        {
          source: "TestSource",
          scope: "BedWars TestScope",
          filePath: "D:/logs/proxy-hyt.log",
          lineNo: 25,
          timestampMs: 510_000,
          type: "game_mode",
          ruleSet: "game-state",
          ruleId: "zh_hyt_welcome",
          payload: {},
          self: {},
        },
      ],
      chatLines: [
        {
          source: "TestSource",
          scope: "BedWars TestScope",
          filePath: "D:/logs/proxy-hypixel.log",
          lineNo: 35,
          timestampMs: 710_000,
          message: "Welcome to Hypixel Bed Wars",
        },
        {
          source: "TestSource",
          scope: "BedWars TestScope",
          filePath: "D:/logs/post-identity-bedwars.log",
          lineNo: 15,
          timestampMs: 20_000,
          message: "花雨庭祝你游戏愉快",
        },
      ],
    },
    rounds: [
      reportRound({ source: "TestSource", scope: "BedWars TestScope", filePath: "D:/logs/post-identity-bedwars.log", startMs: 10_000, endMs: 120_000 }),
      reportRound({ source: "TestSource", scope: "BedWars TestScope", filePath: "D:/logs/proxy-hyt.log", startMs: 520_000, endMs: 600_000, lineNo: 3 }),
      reportRound({ source: "TestSource", scope: "BedWars TestScope", filePath: "D:/logs/proxy-hypixel.log", startMs: 720_000, endMs: 800_000, lineNo: 4 }),
      reportRound({ source: "AuroraNetease_Clients", scope: "SadHyt-1.8.9", filePath: "D:/logs/netease.log", startMs: 300_000, endMs: 420_000, lineNo: 2 }),
    ],
  });
  assert.equal(serverContextReport.rounds.reliable[0].serverNetwork, "Hypixel");
  assert.equal(serverContextReport.rounds.reliable[0].serverAddress, "mc.hypixel.net");
  assert.equal(serverContextReport.rounds.reliable[0].serverLabel, "Hypixel");
  assert.equal(serverContextReport.rounds.reliable[0].serverEvidence.source, "server_connect");
  assert.equal(serverContextReport.rounds.reliable[1].serverNetwork, "NetEase");
  assert.equal(serverContextReport.rounds.reliable[1].serverAddress, "127.0.0.1");
  assert.equal(serverContextReport.rounds.reliable[1].serverLabel, "花雨庭");
  assert.equal(serverContextReport.rounds.reliable[1].serverConfidence, "inferred");
  assert.equal(serverContextReport.rounds.reliable[1].serverEvidence.source, "chat_template");
  assert.equal(serverContextReport.rounds.reliable[2].serverNetwork, "Hypixel");
  assert.equal(serverContextReport.rounds.reliable[2].serverAddress, "192.168.31.215");
  assert.equal(serverContextReport.rounds.reliable[2].serverLabel, "Hypixel");
  assert.equal(serverContextReport.rounds.reliable[2].serverConfidence, "inferred");
  assert.equal(serverContextReport.rounds.reliable[2].serverEvidence.source, "chat_text");
  assert.equal(serverContextReport.rounds.reliable[3].serverNetwork, "NetEase");
  assert.equal(serverContextReport.rounds.reliable[3].serverAddress, null);
  assert.equal(serverContextReport.rounds.reliable[3].serverLabel, "NetEase / AuroraNetease_Clients");
  assert.equal(serverContextReport.rounds.reliable[3].serverEvidence.source, "scope_hint");

  const nonBedwarsHintReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      reportRound({ gameMode: "skywars", durationSeconds: 100, endReason: "lobby_signal", kills: 3, deaths: 1, resultEvidence: [{ kind: "owner_alias_from_play_segment", result: "unknown", confidence: "high" }] }),
      reportRound({ gameMode: "skywars", durationSeconds: 370, endReason: "last_event", kills: 4, deaths: 5, startMs: 500_000, endMs: 870_000, lineNo: 2 }),
      reportRound({ gameMode: "mega_walls", durationSeconds: 1641, endReason: "last_event", kills: 23, deaths: 2, ownerTeam: "red", startMs: 1_000_000, endMs: 2_641_000, lineNo: 3 }),
      reportRound({ gameMode: "unknown", durationSeconds: 250, endReason: "next_round", kills: 2, deaths: 0, startMs: 3_000_000, endMs: 3_250_000, lineNo: 4 }),
    ],
  });
  const nonBedwarsHintReasons = nonBedwarsHintReport.rounds.reliable.map((round) => round.resultHint.reason);
  assert.deepEqual(nonBedwarsHintReasons, [
    "skywars_short_lobby_fragment_candidate",
    "solo_mode_last_event_no_result",
    "mega_walls_last_event_no_result",
    "unknown_mode_combat_fragment",
  ]);
  assert.equal(nonBedwarsHintReport.results.unknownHints.byReason.skywars_short_lobby_fragment_candidate, 1);
  assert.equal(nonBedwarsHintReport.results.unknownHints.byReason.solo_mode_last_event_no_result, 1);
  assert.equal(nonBedwarsHintReport.results.unknownHints.byReason.mega_walls_last_event_no_result, 1);
  assert.equal(nonBedwarsHintReport.results.unknownHints.byReason.unknown_mode_combat_fragment, 1);
  assert.ok(nonBedwarsHintReport.rounds.reliable.every((round) => round.resultHint.value === "keep_unknown"));
  assert.equal(nonBedwarsHintReport.results.unknownAudit.byCategory.non_bedwars_remaining_unknown, 4);
  assert.ok(nonBedwarsHintReport.rounds.reliable.every((round) => round.unknownAudit.category === "non_bedwars_remaining_unknown"));

  const recentModeRound = buildRounds([
    neutralEvent("game_mode", 0, 1, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    neutralEvent("player_join", 10_000, 2, { player: "A", players: "4" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    neutralEvent("round_countdown", 25_000, 3, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("kill", 60_000, 4, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
  ])[0];
  assert.equal(recentModeRound.gameMode, "mini_walls");
  assert.equal(recentModeRound.startReason, "round_countdown");
  assert.equal(isReliableRound(recentModeRound), true);

  const countdownToStartRound = buildRounds([
    neutralEvent("game_mode", 0, 1, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    neutralEvent("round_countdown", 10_000, 2, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    neutralEvent("round_start", 20_000, 3, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_cages_opened"),
    neutralEvent("kill", 40_000, 4, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
  ]);
  assert.equal(countdownToStartRound.length, 1);
  assert.equal(countdownToStartRound[0].startReason, "round_countdown");
  assert.equal(countdownToStartRound[0].durationSeconds, 30);
  assert.equal(countdownToStartRound[0].gameMode, "skywars");
  assert.equal(countdownToStartRound[0].roundStarts, 1);
  assert.equal(isReliableRound(countdownToStartRound[0]), true);

  const shortSkywarsLobbyFragmentRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("round_start", 10_000, 3, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_cages_opened"),
    event("kill", 40_000, 4, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "minecraft-combat", "player_killed"),
    event("lobby_signal", 65_000, 5, { reason: "unclaimed_leveling_reward" }, fileA, {}, "Owner", "game-state", "english_unclaimed_leveling_reward"),
  ])[0];
  assert.equal(shortSkywarsLobbyFragmentRound.gameMode, "skywars");
  assert.equal(shortSkywarsLobbyFragmentRound.result, "unknown");
  assert.equal(getIgnoredRoundReason(shortSkywarsLobbyFragmentRound), "short_unowned_solo_lobby_fragment");

  const shortSkywarsSelfActionRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("round_start", 10_000, 3, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_cages_opened"),
    event("kill", 40_000, 4, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("lobby_signal", 65_000, 5, { reason: "unclaimed_leveling_reward" }, fileA, {}, "Owner", "game-state", "english_unclaimed_leveling_reward"),
  ])[0];
  assert.equal(shortSkywarsSelfActionRound.gameMode, "skywars");
  assert.notEqual(getIgnoredRoundReason(shortSkywarsSelfActionRound), "short_unowned_solo_lobby_fragment");

  const skywarsLastEventUnknownRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("kill", 200_000, 3, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "minecraft-combat", "player_killed"),
  ])[0];
  assert.equal(skywarsLastEventUnknownRound.gameMode, "skywars");
  assert.equal(skywarsLastEventUnknownRound.endReason, "last_event");
  assert.equal(isReliableRound(skywarsLastEventUnknownRound), true);

  const megaWallsLastEventUnknownRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "mega_walls" }, fileA, {}, "Owner", "game-state", "mega_walls_mode"),
    event("kill", 10 * 60_000, 3, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "minecraft-combat", "player_killed"),
  ])[0];
  assert.equal(megaWallsLastEventUnknownRound.gameMode, "mega_walls");
  assert.equal(megaWallsLastEventUnknownRound.endReason, "last_event");
  assert.equal(isReliableRound(megaWallsLastEventUnknownRound), true);

  const gapRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 2 * 60 * 60 * 1000, 2, { killer: "A", victim: "B" }, fileA),
  ])[0];
  assert.equal(gapRound.endReason, "gap");
  assert.equal(isReliableRound(gapRound), false);

  const selfWinnerRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { winner: "Owner", map: "虚空农庄" }, fileA),
  ])[0];
  assert.equal(selfWinnerRound.result, "win");
  assert.equal(selfWinnerRound.resultReason, "inferred:bedwars:test_rule");

  const aliasWinnerRound = buildRounds(
    [
      event("round_countdown", 0, 1, { seconds: "10" }, fileA),
      event("round_end", 60_000, 2, { winner: "AltOwner", map: "TestMap" }, fileA, {}, "Owner"),
    ],
    { ownerLocalUsers: ["AltOwner"] },
  )[0];
  assert.equal(aliasWinnerRound.result, "win");

  const multiWinnerRound = buildRounds(
    [
      event("round_countdown", 0, 1, { seconds: "10" }, fileA),
      event("round_end", 60_000, 2, { winner: "Teammate与AltOwner", map: "TestMap" }, fileA, {}, "Owner"),
    ],
    { ownerLocalUsers: ["AltOwner"] },
  )[0];
  assert.equal(multiWinnerRound.result, "win");
  assert.equal(multiWinnerRound.resultReason, "inferred:bedwars:test_rule");

  const broadcastWinnerRounds = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { winner: "OtherPlayer", map: "虚空农庄" }, fileA, {}, "Owner", "game-state", "zh_player_won_on_map"),
    event("round_countdown", 120_000, 3, { seconds: "10" }, fileA),
  ]);
  assert.equal(broadcastWinnerRounds.length, 1);
  assert.equal(broadcastWinnerRounds[0].result, "unknown");
  assert.equal(broadcastWinnerRounds[0].endReason, "last_event");
  assert.equal(broadcastWinnerRounds[0].roundEnds, 0);
  assert.equal(getIgnoredRoundReason(broadcastWinnerRounds[0]), "too_short");

  const teamWinnerRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Red" }, fileA),
    event("round_end", 60_000, 3, { winner: "Red" }, fileA),
  ])[0];
  assert.equal(teamWinnerRound.ownerTeam, "red");
  assert.equal(teamWinnerRound.result, "win");
  assert.equal(teamWinnerRound.resultReason, "team:bedwars:test_rule");

  const localizedTeamWinnerRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "蓝" }, fileA, {}, "Owner", "game-state", "zh_team_assignment"),
    event("round_end", 60_000, 3, { winner: "蓝之队队" }, fileA, {}, "Owner", "game-state", "zh_bedwars_team_win"),
  ])[0];
  assert.equal(localizedTeamWinnerRound.ownerTeam, "blue");
  assert.equal(localizedTeamWinnerRound.result, "win");
  assert.equal(localizedTeamWinnerRound.resultReason, "team:game-state:zh_bedwars_team_win");

  const hytBedwarsTeamWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { winner: "黄" }, fileA, {}, "Owner", "game-state", "zh_bedwars_team_win"),
  ])[0];
  assert.equal(hytBedwarsTeamWinRound.result, "win");
  assert.equal(hytBedwarsTeamWinRound.resultReason, "inferred:game-state:zh_bedwars_team_win");
  assert.equal(hytBedwarsTeamWinRound.gameMode, "bedwars");

  const clayPipeTeamWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { winner: "蓝队" }, fileA, {}, "Owner", "game-state", "zh_team_win_pipe"),
  ])[0];
  assert.equal(clayPipeTeamWinRound.result, "win");
  assert.equal(clayPipeTeamWinRound.resultReason, "inferred:game-state:zh_team_win_pipe");

  const hytWinningTeamRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { winner: "红" }, fileA, {}, "Owner", "game-state", "zh_winning_team"),
  ])[0];
  assert.equal(hytWinningTeamRound.result, "win");
  assert.equal(hytWinningTeamRound.resultReason, "inferred:game-state:zh_winning_team");

  const placementWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_end", 60_000, 2, { placement: "1" }, fileA, {}, "Owner", "game-state", "you_placed"),
  ])[0];
  assert.equal(placementWinRound.result, "win");
  assert.equal(placementWinRound.resultReason, "placement:game-state:you_placed");

  const skywarsPlacementLossRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("round_end", 60_000, 3, { placement: "2" }, fileA, {}, "Owner", "game-state", "you_placed"),
  ])[0];
  assert.equal(skywarsPlacementLossRound.result, "loss");
  assert.equal(skywarsPlacementLossRound.resultReason, "placement:game-state:you_placed");

  const teamLossRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { teamStart: "BLUE" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("round_end", 60_000, 3, { winner: "Red" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
  ])[0];
  assert.equal(teamLossRound.ownerTeam, "blue");
  assert.equal(teamLossRound.result, "loss");
  assert.equal(teamLossRound.resultReason, "team:game-state:english_winning_team");

  const teamFromCombatRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 10_000, 2, { killer: "Owner", killerTeam: "Blue", victim: "Enemy", victimTeam: "Red" }, fileA, { kill: true }, "Owner", "bedwars", "zh_kill_team"),
    event("round_end", 60_000, 3, { winner: "Blue" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
  ])[0];
  assert.equal(teamFromCombatRound.ownerTeam, "blue");
  assert.equal(teamFromCombatRound.result, "win");
  assert.equal(teamFromCombatRound.resultReason, "team:game-state:english_winning_team");

  const teamAssignmentBeforeCountdownRound = buildRounds([
    event("team_assignment", 0, 1, { team: "紫" }, fileA, {}, "Owner", "game-state", "zh_team_assignment"),
    event("round_countdown", 10_000, 2, { seconds: "10" }, fileA),
    event("round_end", 60_000, 3, { winner: "紫" }, fileA, {}, "Owner", "game-state", "zh_color_winning_team"),
  ])[0];
  assert.equal(teamAssignmentBeforeCountdownRound.ownerTeam, "purple");
  assert.equal(teamAssignmentBeforeCountdownRound.result, "win");
  assert.equal(teamAssignmentBeforeCountdownRound.resultReason, "team:game-state:zh_color_winning_team");

  const ownerTeamFromTeamChatChannelRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("team_chat", 30_000, 3, { team: "Yellow", player: "Teammate", message: "push", chatScope: "team" }, fileA, {}, "Owner", "bedwars", "zh_team_channel_chat"),
    event("server_connect", 90_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerTeamFromTeamChatChannelRound.ownerTeam, "yellow");
  assert.equal(ownerTeamFromTeamChatChannelRound.result, "unknown");
  assert.ok(ownerTeamFromTeamChatChannelRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_team_chat_channel" &&
    item.team === "yellow"
  ));

  const allChatChannelDoesNotSetOwnerTeamRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("team_chat", 30_000, 3, { team: "Yellow", player: "Other", message: "global", chatScope: "all" }, fileA, {}, "Owner", "bedwars", "zh_all_channel_chat"),
    event("server_connect", 90_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(allChatChannelDoesNotSetOwnerTeamRound.ownerTeam, null);
  assert.equal(allChatChannelDoesNotSetOwnerTeamRound.result, "unknown");

  const nonBedwarsTeamChatDoesNotDriveTeamWinnerRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("team_chat", 30_000, 3, { team: "Green", player: "Teammate", message: "push", chatScope: "team" }, fileA, {}, "Owner", "game-state", "generic_hypixel_team_chat"),
    event("round_end", 60_000, 4, { winner: "Green" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
    event("player_join", 80_000, 5, { player: "LobbyPlayer" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
  ])[0];
  assert.equal(nonBedwarsTeamChatDoesNotDriveTeamWinnerRound.ownerTeam, "green");
  assert.equal(nonBedwarsTeamChatDoesNotDriveTeamWinnerRound.result, "unknown");
  assert.equal(nonBedwarsTeamChatDoesNotDriveTeamWinnerRound.endReason, "round_end");

  const nonBedwarsTeamAssignmentStillDrivesTeamWinnerRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("team_assignment", 20_000, 3, { team: "Green" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("round_end", 60_000, 4, { winner: "Green" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
  ])[0];
  assert.equal(nonBedwarsTeamAssignmentStillDrivesTeamWinnerRound.ownerTeam, "green");
  assert.equal(nonBedwarsTeamAssignmentStillDrivesTeamWinnerRound.result, "win");
  assert.equal(nonBedwarsTeamAssignmentStillDrivesTeamWinnerRound.resultReason, "team:game-state:english_winning_team");

  const ownerTeamFromTeamChatBackfillsOwnerBedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("bed_destroy", 30_000, 3, { team: "Yellow", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("team_chat", 40_000, 4, { team: "Yellow", player: "Teammate", message: "bed gone", chatScope: "team" }, fileA, {}, "Owner", "bedwars", "zh_team_channel_chat"),
    event("server_connect", 90_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerTeamFromTeamChatBackfillsOwnerBedRound.ownerTeam, "yellow");
  assert.equal(ownerTeamFromTeamChatBackfillsOwnerBedRound.ownerBedDestroyed, true);
  assert.ok(ownerTeamFromTeamChatBackfillsOwnerBedRound.resultEvidence.some((item) => item.kind === "owner_bed_destroyed"));

  const ownerTeamFromTeamChatTeamElimWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("round_start", 10_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "bedwars", "zh_round_start"),
    event("team_chat", 30_000, 3, { team: "Green", player: "Teammate", message: "push", chatScope: "team" }, fileA, {}, "Owner", "bedwars", "zh_team_channel_chat"),
    event("team_eliminated", 60_000, 4, { team: "Red" }, fileA, {}, "Owner", "bedwars", "zh_team_eliminated"),
    event("server_connect", 90_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerTeamFromTeamChatTeamElimWinRound.ownerTeam, "green");
  assert.equal(ownerTeamFromTeamChatTeamElimWinRound.result, "win");
  assert.equal(ownerTeamFromTeamChatTeamElimWinRound.resultReason, "inferred-owner-team-survived-team-elims-low-confidence:session:server_connect");

  const nextRoundTeamAssignmentAfterGameplayRounds = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 5_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("kill", 20_000, 3, { killer: "Owner", killerTeam: "Blue", victim: "Enemy", victimTeam: "Red" }, fileA, { kill: true }, "Owner", "bedwars", "zh_kill_team"),
    event("team_assignment", 70_000, 4, { team: "Orange" }, fileA, {}, "Owner", "game-state", "zh_team_assignment"),
    event("round_countdown", 80_000, 5, { seconds: "10" }, fileA),
    event("round_end", 130_000, 6, { winner: "Orange" }, fileA, {}, "Owner", "game-state", "zh_color_winning_team"),
  ]);
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds.length, 2);
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds[0].ownerTeam, "blue");
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds[0].result, "unknown");
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds[1].ownerTeam, "orange");
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds[1].result, "win");
  assert.equal(nextRoundTeamAssignmentAfterGameplayRounds[1].resultReason, "team:game-state:zh_color_winning_team");

  const delayedDirectWinAfterTeamSummary = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("round_end", 60_000, 3, { winner: "Yellow" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
    event("win", 61_000, 4, {}, fileA, {}, "Owner", "game-state", "you_won_click_here"),
  ])[0];
  assert.equal(delayedDirectWinAfterTeamSummary.gameMode, "mini_walls");
  assert.equal(delayedDirectWinAfterTeamSummary.result, "win");
  assert.equal(delayedDirectWinAfterTeamSummary.resultReason, "game-state:you_won_click_here");
  assert.equal(delayedDirectWinAfterTeamSummary.endReason, "result");

  const unresolvedTeamSummaryRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("round_end", 60_000, 3, { winner: "Yellow" }, fileA, {}, "Owner", "game-state", "english_winning_team"),
    event("player_join", 80_000, 4, { player: "LobbyPlayer" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
  ])[0];
  assert.equal(unresolvedTeamSummaryRound.result, "unknown");
  assert.equal(unresolvedTeamSummaryRound.endReason, "round_end");
  assert.equal(unresolvedTeamSummaryRound.durationSeconds, 60);

  const ownerTeamEliminatedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("death", 10_000, 2, { victim: "Owner", victimTeam: "Blue" }, fileA, { death: true }, "Owner", "bedwars", "zh_death_team"),
    event("team_eliminated", 60_000, 3, { team: "Blue" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
  ])[0];
  assert.equal(ownerTeamEliminatedRound.ownerTeam, "blue");
  assert.equal(ownerTeamEliminatedRound.result, "loss");
  assert.equal(ownerTeamEliminatedRound.endReason, "owner_team_eliminated");

  const finalDeathThenNextRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Enemy", victim: "Owner", victimTeam: "Blue", finalDeath: true }, fileA, { death: true }, "Owner", "bedwars", "en_final_kill_by"),
    event("round_countdown", 120_000, 3, { seconds: "10" }, fileA),
  ])[0];
  assert.equal(finalDeathThenNextRound.result, "loss");
  assert.equal(finalDeathThenNextRound.resultReason, "inferred-own-final-death-exit:bedwars:round_countdown");

  const ownerBedBrokenThenDeathRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("bed_destroy", 30_000, 3, { team: "Blue", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("death", 60_000, 4, { victim: "Owner", victimTeam: "Blue" }, fileA, { death: true }, "Owner", "bedwars", "zh_death_team"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerBedBrokenThenDeathRound.result, "loss");
  assert.equal(ownerBedBrokenThenDeathRound.resultReason, "inferred-owner-bed-self-eliminated:bedwars:zh_death_team");
  assert.equal(ownerBedBrokenThenDeathRound.endReason, "result");
  assert.equal(ownerBedBrokenThenDeathRound.endMs, 60_000);
  assert.ok(ownerBedBrokenThenDeathRound.resultEvidence.some((item) => item.kind === "owner_bed_destroyed_then_self_elimination"));

  const ghostAloneThenExitRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("self_death", 60_000, 3, {}, fileA, {}, "Owner", "game-state", "you_are_now_ghost"),
    event("server_connect", 120_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ghostAloneThenExitRound.result, "unknown");
  assert.equal(ghostAloneThenExitRound.selfDeathSignals, 1);

  const ownerBedBrokenWithoutDeathRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("bed_destroy", 30_000, 3, { team: "Blue", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("server_connect", 120_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerBedBrokenWithoutDeathRound.result, "unknown");
  assert.equal(ownerBedBrokenWithoutDeathRound.ownerBedDestroyed, true);

  const combatDeathThenNextGameRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Enemy", victim: "Owner", victimTeam: "Yellow" }, fileA, { death: true }, "Owner", "bedwars", "zh_kill_team"),
    event("server_connect", 120_000, 3, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(combatDeathThenNextGameRound.result, "loss");
  assert.equal(combatDeathThenNextGameRound.resultReason, "inferred-bedwars-self-death-exit:session:server_connect");
  assert.equal(combatDeathThenNextGameRound.localUser, "Owner");
  assert.equal(combatDeathThenNextGameRound.ownerAliasesUsed.Owner, 1);
  assert.ok(combatDeathThenNextGameRound.resultEvidence.some((item) =>
    item.kind === "bedwars_self_death_then_boundary" &&
    item.boundaryType === "server_connect"
  ));

  const combatDeathThenNextRoundBoundaryRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Enemy", victim: "Owner", victimTeam: "Yellow" }, fileA, { death: true }, "Owner", "bedwars", "zh_kill_team"),
    event("round_countdown", 120_000, 3, { seconds: "10" }, fileA),
  ])[0];
  assert.equal(combatDeathThenNextRoundBoundaryRound.result, "loss");
  assert.equal(combatDeathThenNextRoundBoundaryRound.resultReason, "inferred-bedwars-self-death-exit:bedwars:next_round");
  assert.ok(combatDeathThenNextRoundBoundaryRound.resultEvidence.some((item) =>
    item.kind === "bedwars_self_death_then_boundary" &&
    item.boundaryType === "next_round"
  ));

  const combatDeathThenCrashRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Enemy", victim: "Owner", victimTeam: "Yellow" }, fileA, { death: true }, "Owner", "bedwars", "zh_kill_team"),
    event("crash", 120_000, 3, {}, fileA, {}, "Owner", "session", "crash"),
  ])[0];
  assert.equal(combatDeathThenCrashRound.result, "loss");
  assert.equal(combatDeathThenCrashRound.resultReason, "inferred-bedwars-self-death-exit:session:crash");

  const hytMapRatingLossRound = buildRounds([
    event("round_start", 0, 1, { gameMode: "bedwars" }, fileA, {}, "LauncherUser", "bedwars", "zh_round_start_named"),
    event(
      "kill",
      60_000,
      2,
      { killer: "Enemy", killerTeam: "绿之队", victim: "sdherthy", victimTeam: "蓝之队" },
      fileA,
      {},
      "LauncherUser",
      "bedwars",
      "zh_kill_team",
    ),
    event("bed_destroy", 61_000, 3, { player: "Enemy", team: "蓝之队" }, fileA, {}, "LauncherUser", "bedwars", "zh_bed_destroy"),
    event(
      "round_end",
      66_000,
      4,
      { gameMode: "bedwars", player: "sdherthy", map: "方块长城" },
      fileA,
      {},
      "LauncherUser",
      "game-state",
      "zh_hyt_map_rating_prompt",
    ),
  ])[0];
  assert.equal(hytMapRatingLossRound.result, "loss");
  assert.equal(hytMapRatingLossRound.resultReason, "inferred-self-death-exit:game-state:zh_hyt_map_rating_prompt");
  assert.equal(hytMapRatingLossRound.ownerAliasesUsed.sdherthy, 1);
  assert.equal(hytMapRatingLossRound.selfDeaths, 1);
  assert.equal(hytMapRatingLossRound.ownerTeam, "blue");
  assert.equal(hytMapRatingLossRound.ownerBedDestroyed, true);

  const hytMapRatingThenTeamWinRound = buildRounds([
    event("round_start", 0, 1, { gameMode: "bedwars" }, fileA, {}, "LauncherUser", "bedwars", "zh_round_start_named"),
    event(
      "kill",
      60_000,
      2,
      { killer: "sdherthy", killerTeam: "Yellow", victim: "Enemy", victimTeam: "Red" },
      fileA,
      {},
      "LauncherUser",
      "bedwars",
      "zh_kill_team",
    ),
    event(
      "round_end",
      66_000,
      3,
      { gameMode: "bedwars", player: "sdherthy", map: "Cake" },
      fileA,
      {},
      "LauncherUser",
      "game-state",
      "zh_hyt_map_rating_prompt",
    ),
    event(
      "round_end",
      67_000,
      4,
      { winner: "Yellow" },
      fileA,
      {},
      "LauncherUser",
      "game-state",
      "zh_bedwars_team_win",
    ),
  ])[0];
  assert.equal(hytMapRatingThenTeamWinRound.result, "win");
  assert.equal(hytMapRatingThenTeamWinRound.resultReason, "team:game-state:zh_bedwars_team_win");
  assert.equal(hytMapRatingThenTeamWinRound.endReason, "round_end");
  assert.equal(hytMapRatingThenTeamWinRound.endMs, 67_000);
  assert.equal(hytMapRatingThenTeamWinRound.ownerAliasesUsed.sdherthy, 1);
  assert.equal(hytMapRatingThenTeamWinRound.ownerTeam, "yellow");

  const killTaskProgressIdentityRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event(
      "kill",
      60_000,
      2,
      { killer: "Delta1337", killerTeam: "Green", victim: "Enemy", victimTeam: "Red" },
      fileA,
      {},
      "LauncherUser",
      "bedwars",
      "zh_kill_team",
    ),
    event(
      "task_progress",
      60_000,
      3,
      { current: "22", total: "150", task: "击杀任务", period: "每周" },
      fileA,
      {},
      "LauncherUser",
      "game-state",
      "zh_task_progress_update",
    ),
  ])[0];
  assert.equal(killTaskProgressIdentityRound.ownerAliasesUsed.Delta1337, 1);
  assert.equal(killTaskProgressIdentityRound.selfKills, 1);
  assert.equal(killTaskProgressIdentityRound.ownerTeam, "green");
  assert.ok(killTaskProgressIdentityRound.resultEvidence.some((item) => item.kind === "owner_alias_from_kill_task_progress" && item.player === "Delta1337"));

  const combatDeathThenOwnerActionRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("kill", 60_000, 2, { killer: "Enemy", victim: "Owner", victimTeam: "Yellow" }, fileA, { death: true }, "Owner", "bedwars", "zh_kill_team"),
    event("kill", 90_000, 3, { killer: "Owner", victim: "Enemy", killerTeam: "Yellow" }, fileA, { kill: true }, "Owner", "bedwars", "zh_kill_team"),
    event("server_connect", 120_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(combatDeathThenOwnerActionRound.result, "unknown");

  const combatDeathThenOwnerTeamChatRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      endReason: "server_connect",
      endMs: 130_000,
      boundaryEvents: [
        { role: "session_boundary", type: "server_connect", timestampMs: 130_000, lineNo: 5, ruleSet: "session", ruleId: "server_connect" },
      ],
      events: [
        compactTestEvent("death", 60_000, 2, { victim: "ServerNick", victimTeam: "Blue" }, "bedwars", "zh_death_team"),
        compactTestEvent("team_chat", 90_000, 3, { player: "ServerNick", team: "Blue", message: "still here" }, "bedwars", "zh_team_chat"),
      ],
    }),
  ])[0];
  assert.equal(combatDeathThenOwnerTeamChatRound.result, "unknown");

  const ownerBedBrokenThenGhostRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("bed_destroy", 30_000, 3, { team: "Blue", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("self_death", 60_000, 4, {}, fileA, {}, "Owner", "game-state", "you_are_now_ghost"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerBedBrokenThenGhostRound.result, "loss");
  assert.equal(ownerBedBrokenThenGhostRound.resultReason, "inferred-owner-bed-self-eliminated:game-state:you_are_now_ghost");
  assert.equal(ownerBedBrokenThenGhostRound.endReason, "result");
  assert.equal(ownerBedBrokenThenGhostRound.endMs, 60_000);
  assert.ok(ownerBedBrokenThenGhostRound.resultEvidence.some((item) => item.kind === "owner_bed_destroyed_then_self_elimination"));

  const ownerBedBrokenThenSpectatorChatRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("bed_destroy", 30_000, 3, { team: "Blue", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("team_chat", 60_000, 4, { team: "旁观者", player: "Owner", message: "66" }, fileA, {}, "Owner", "bedwars", "zh_team_chat"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(ownerBedBrokenThenSpectatorChatRound.result, "loss");
  assert.equal(ownerBedBrokenThenSpectatorChatRound.resultReason, "inferred-owner-bed-spectator-chat-eliminated:bedwars:zh_team_chat");
  assert.equal(ownerBedBrokenThenSpectatorChatRound.endReason, "result");
  assert.ok(ownerBedBrokenThenSpectatorChatRound.resultEvidence.some((item) => item.kind === "owner_bed_destroyed_then_owner_spectator_chat"));

  const spectatorChatWithoutOwnerBedBrokenRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_chat", 60_000, 3, { team: "旁观者", player: "Owner", message: "still here" }, fileA, {}, "Owner", "bedwars", "zh_team_chat"),
    event("server_connect", 120_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(spectatorChatWithoutOwnerBedBrokenRound.result, "unknown");

  const otherSpectatorChatAfterOwnerBedBrokenRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("bed_destroy", 30_000, 3, { team: "Blue", player: "Enemy" }, fileA, {}, "Owner", "bedwars", "en_bed_destroy"),
    event("team_chat", 60_000, 4, { team: "旁观者", player: "Other", message: "66" }, fileA, {}, "Owner", "bedwars", "zh_team_chat"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(otherSpectatorChatAfterOwnerBedBrokenRound.result, "unknown");

  const allEnemyTeamsEliminatedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 70_000, 4, { team: "Green" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 80_000, 5, { team: "Yellow" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("server_connect", 120_000, 6, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(allEnemyTeamsEliminatedRound.result, "win");
  assert.equal(allEnemyTeamsEliminatedRound.resultReason, "inferred-all-enemy-teams-eliminated:session:server_connect");

  const partialEnemyTeamsEliminatedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("server_connect", 120_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(partialEnemyTeamsEliminatedRound.result, "win");
  assert.equal(partialEnemyTeamsEliminatedRound.resultReason, "inferred-owner-team-survived-team-elims-low-confidence:session:server_connect");
  assert.ok(partialEnemyTeamsEliminatedRound.resultEvidence.some((item) => item.kind === "owner_team_survived_team_eliminations_low_confidence"));

  const teamEliminationWithGhostSignalRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("self_death", 70_000, 4, {}, fileA, {}, "Owner", "game-state", "you_are_now_ghost"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(teamEliminationWithGhostSignalRound.result, "unknown");
  assert.equal(teamEliminationWithGhostSignalRound.selfDeathSignals, 1);
  assert.ok(!teamEliminationWithGhostSignalRound.resultEvidence.some((item) => item.kind === "owner_team_survived_team_eliminations_low_confidence"));

  const customTeamUniverseRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 70_000, 4, { team: "Green" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 80_000, 5, { team: "Yellow" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 90_000, 6, { team: "Purple" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("server_connect", 120_000, 7, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(customTeamUniverseRound.result, "win");
  assert.equal(customTeamUniverseRound.resultReason, "inferred-owner-team-survived-team-elims-low-confidence:session:server_connect");

  const teamEliminationWithoutOwnerTeamRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_eliminated", 60_000, 2, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("server_connect", 120_000, 3, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(teamEliminationWithoutOwnerTeamRound.result, "unknown");

  const selfDeathBeatsLowConfidenceTeamWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Blue" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("death", 70_000, 4, { victim: "Owner", victimTeam: "Blue" }, fileA, { death: true }, "Owner", "bedwars", "zh_death_team"),
    event("server_connect", 120_000, 5, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(selfDeathBeatsLowConfidenceTeamWinRound.result, "loss");
  assert.equal(selfDeathBeatsLowConfidenceTeamWinRound.resultReason, "inferred-bedwars-self-death-exit:session:server_connect");

  const hytEnemyTeamsEliminatedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("team_assignment", 10_000, 2, { team: "Orange" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("team_eliminated", 60_000, 3, { team: "Red" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 70_000, 4, { team: "Blue" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 80_000, 5, { team: "Green" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 90_000, 6, { team: "Yellow" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 100_000, 7, { team: "Aqua" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 110_000, 8, { team: "White" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("team_eliminated", 120_000, 9, { team: "Purple" }, fileA, {}, "Owner", "bedwars", "en_team_eliminated"),
    event("server_connect", 150_000, 10, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(hytEnemyTeamsEliminatedRound.ownerTeam, "orange");
  assert.equal(hytEnemyTeamsEliminatedRound.result, "win");
  assert.equal(hytEnemyTeamsEliminatedRound.resultReason, "inferred-all-enemy-teams-eliminated:session:server_connect");

  const sameSecondExplicitWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("round_end", 60_000, 3, { winner: "OtherPlayer" }, fileA, {}, "Owner", "game-state", "winner_announcement_dash"),
    event("win", 60_000, 4, {}, fileA, {}, "Owner", "game-state", "you_won_click_here"),
  ])[0];
  assert.equal(sameSecondExplicitWinRound.result, "win");
  assert.equal(sameSecondExplicitWinRound.resultReason, "game-state:you_won_click_here");

  const rewardThenExplicitWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("kill", 59_000, 3, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("win", 60_000, 4, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "en_skywars_experience_win_reward"),
    event("kill", 60_000, 5, { killer: "Owner", victim: "LastEnemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("round_end", 60_000, 6, { winner: "Owner" }, fileA, {}, "Owner", "game-state", "winner_announcement_dash"),
    event("win", 60_000, 7, {}, fileA, {}, "Owner", "game-state", "you_won_click_here"),
    event("round_countdown", 70_000, 8, { seconds: "10" }, fileA),
  ])[0];
  assert.equal(rewardThenExplicitWinRound.result, "win");
  assert.equal(rewardThenExplicitWinRound.resultReason, "game-state:you_won_click_here");
  assert.equal(rewardThenExplicitWinRound.endReason, "result");
  assert.equal(rewardThenExplicitWinRound.kills, 2);

  const tokenWinRewardRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 5_000, 2, { gameMode: "bedwars" }, fileA, {}, "Owner", "game-state", "bedwars_mode"),
    event("win", 60_000, 3, {}, fileA, {}, "Owner", "game-state", "en_generic_token_win_reward"),
    event("round_countdown", 70_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
  ])[0];
  assert.equal(tokenWinRewardRound.result, "win");
  assert.equal(tokenWinRewardRound.resultReason, "game-state:en_generic_token_win_reward");
  assert.equal(tokenWinRewardRound.gameMode, "bedwars");
  assert.equal(tokenWinRewardRound.endReason, "result");

  const skywarsEloGainRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
    event("win", 60_000, 2, { gameMode: "skywars", map: "遗迹之轮", eloDelta: "+7" }, fileA, {}, "Owner", "game-state", "zh_skywars_elo_gain"),
    event("round_countdown", 70_000, 3, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
  ])[0];
  assert.equal(skywarsEloGainRound.result, "win");
  assert.equal(skywarsEloGainRound.resultReason, "game-state:zh_skywars_elo_gain");
  assert.equal(skywarsEloGainRound.gameMode, "skywars");
  assert.equal(skywarsEloGainRound.endReason, "result");

  const skywarsMapEloWinRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
    event("round_end", 60_000, 2, { winner: "Other", map: "钻石之心" }, fileA, {}, "Owner", "game-state", "zh_player_won_on_map"),
    event("win", 61_000, 3, { gameMode: "skywars", map: "钻石之心", eloDelta: "+25" }, fileA, {}, "Owner", "game-state", "zh_skywars_map_elo_win"),
    event("round_countdown", 80_000, 4, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
  ])[0];
  assert.equal(skywarsMapEloWinRound.result, "win");
  assert.equal(skywarsMapEloWinRound.resultReason, "game-state:zh_skywars_map_elo_win");
  assert.equal(skywarsMapEloWinRound.gameMode, "skywars");
  assert.equal(skywarsMapEloWinRound.endReason, "result");

  const skywarsMapEloWinThenPunishmentRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
    event("win", 60_000, 2, { gameMode: "skywars", map: "钻石之心", eloDelta: "+25" }, fileA, {}, "Owner", "game-state", "zh_skywars_map_elo_win"),
    event("player_punished", 61_000, 3, { player: "Owner", reason: "abnormal_behavior_ban" }, fileA, {}, "Owner", "game-state", "zh_player_punished_for_abnormal_behavior"),
  ])[0];
  assert.equal(skywarsMapEloWinThenPunishmentRound.result, "win");
  assert.equal(skywarsMapEloWinThenPunishmentRound.resultReason, "game-state:zh_skywars_map_elo_win");
  assert.equal(skywarsMapEloWinThenPunishmentRound.endReason, "result");

  const skywarsEloLossRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
    event("loss", 60_000, 2, { gameMode: "skywars", map: "像素沼泽", eloDelta: "-8" }, fileA, {}, "Owner", "game-state", "zh_skywars_elo_loss"),
    event("round_countdown", 70_000, 3, { seconds: "10" }, fileA, {}, "Owner", "bedwars", "zh_countdown_plain"),
  ])[0];
  assert.equal(skywarsEloLossRound.result, "loss");
  assert.equal(skywarsEloLossRound.resultReason, "game-state:zh_skywars_elo_loss");
  assert.equal(skywarsEloLossRound.gameMode, "skywars");
  assert.equal(skywarsEloLossRound.endReason, "result");

  const soloWinnerLossRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 5_000, 2, { gameMode: "skywars" }, fileA, {}, "Owner", "game-state", "skywars_mode"),
    event("round_end", 60_000, 3, { winner: "OtherPlayer" }, fileA, {}, "Owner", "game-state", "winner_announcement_dash"),
  ])[0];
  assert.equal(soloWinnerLossRound.result, "loss");
  assert.equal(soloWinnerLossRound.resultReason, "inferred:game-state:winner_announcement_dash");

  const duelWinnerLossRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "duels", duelMode: "MegaWalls" }, fileA, {}, "Owner", "game-state", "hypixel_named_duel_mode"),
    event("kill", 25_000, 3, { killer: "Opponent", victim: "Owner" }, fileA, { death: true }, "Owner", "bedwars", "en_kill_by"),
    event("round_end", 26_000, 4, { gameMode: "duels", winner: "Opponent" }, fileA, {}, "Owner", "game-state", "hypixel_duel_winner_line"),
  ])[0];
  assert.equal(duelWinnerLossRound.gameMode, "duels");
  assert.equal(duelWinnerLossRound.result, "loss");
  assert.equal(duelWinnerLossRound.resultReason, "inferred:game-state:hypixel_duel_winner_line");

  const otherPunishedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("player_punished", 60_000, 2, { player: "OtherPlayer", reason: "abnormal_behavior_ban" }, fileA, {}, "Owner", "game-state", "zh_player_punished_for_abnormal_behavior"),
    event("round_countdown", 120_000, 3, { seconds: "10" }, fileA),
  ])[0];
  assert.equal(otherPunishedRound.result, "unknown");
  assert.equal(otherPunishedRound.punishedPlayers.OtherPlayer, 1);

  const ownerPunishedRound = buildRounds(
    [
      event("round_countdown", 0, 1, { seconds: "10" }, fileA),
      event("player_punished", 60_000, 2, { player: "AltOwner", reason: "abnormal_behavior_ban" }, fileA, {}, "Owner", "game-state", "zh_player_punished_for_abnormal_behavior"),
    ],
    { ownerLocalUsers: ["AltOwner"] },
  )[0];
  assert.equal(ownerPunishedRound.result, "loss");
  assert.equal(ownerPunishedRound.endReason, "owner_punished");
  assert.equal(ownerPunishedRound.resultReason, "owner-punished:game-state:zh_player_punished_for_abnormal_behavior");

  const punishedExitRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("player_punished", 60_000, 2, { player: "NickedOwner", reason: "abnormal_behavior_ban" }, fileA, {}, "Owner", "game-state", "zh_player_punished_for_abnormal_behavior"),
    event("server_connect", 5 * 60_000, 3, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(punishedExitRound.result, "loss");
  assert.equal(punishedExitRound.endReason, "session_transition_after_punishment");
  assert.equal(punishedExitRound.resultReason, "inferred-owner-punished-exit:session:server_connect");
  assert.equal(punishedExitRound.punishedExit.player, "NickedOwner");

  const otherPunishedContinuedRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("player_punished", 60_000, 2, { player: "OtherPlayer", reason: "abnormal_behavior_ban" }, fileA, {}, "Owner", "game-state", "zh_player_punished_for_abnormal_behavior"),
    event("kill", 70_000, 3, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("server_connect", 5 * 60_000, 4, {}, fileA, {}, "Owner", "session", "server_connect"),
  ])[0];
  assert.equal(otherPunishedContinuedRound.result, "unknown");
  assert.equal(otherPunishedContinuedRound.endReason, "server_connect");

  const megaWallsLobbyQuitRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "mega_walls" }, fileA, {}, "Owner", "game-state", "mega_walls_mode"),
    event("team_assignment", 15_000, 3, { team: "Green" }, fileA, {}, "Owner", "game-state", "english_team_assignment"),
    event("kill", 20_000, 4, { killer: "Owner", victim: "Enemy", killerTeam: "Green" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("lobby_signal", 60_000, 5, { reason: "lobby_teleport", seconds: "3" }, fileA, {}, "Owner", "game-state", "english_lobby_teleport"),
  ])[0];
  assert.equal(megaWallsLobbyQuitRound.result, "loss");
  assert.equal(megaWallsLobbyQuitRound.endReason, "lobby_signal");
  assert.equal(megaWallsLobbyQuitRound.resultReason, "inferred-mega-walls-quit:game-state:english_lobby_teleport");

  const claySoftLobbyThenExplicitLossRounds = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_zh_game_countdown"),
    event("kill", 60_000, 2, { killer: "Other", victim: "Enemy" }, fileA, {}, "Owner", "minecraft-combat", "slain_by"),
    event("lobby_signal", 120_000, 3, { reason: "returning_lobby" }, fileA, {}, "Owner", "game-state", "zh_returning_lobby"),
    event("round_countdown", 180_000, 4, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_zh_game_countdown"),
    event("self_death", 220_000, 5, {}, fileA, {}, "Owner", "game-state", "zh_clay_now_spectator"),
    event("loss", 220_000, 6, {}, fileA, {}, "Owner", "game-state", "zh_clay_round_loss"),
  ]);
  assert.equal(claySoftLobbyThenExplicitLossRounds.length, 2);
  assert.equal(claySoftLobbyThenExplicitLossRounds[0].endReason, "next_round");
  assert.equal(claySoftLobbyThenExplicitLossRounds[1].result, "loss");
  assert.equal(claySoftLobbyThenExplicitLossRounds[1].resultReason, "game-state:zh_clay_round_loss");

  const megaWallsNextGameQuitRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "mega_walls" }, fileA, {}, "Owner", "game-state", "mega_walls_mode"),
    event("death", 20_000, 3, { victim: "Owner", victimTeam: "Green" }, fileA, { death: true }, "Owner", "minecraft-combat", "player_died"),
    event("world_switch", 90_000, 4, { destination: "mega35B" }, fileA, {}, "Owner", "game-state", "english_world_switch"),
  ])[0];
  assert.equal(megaWallsNextGameQuitRound.result, "loss");
  assert.equal(megaWallsNextGameQuitRound.endReason, "world_switch");
  assert.equal(megaWallsNextGameQuitRound.resultReason, "inferred-mega-walls-quit:game-state:english_world_switch");

  const megaWallsWaitingRoomNextRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("player_join", 1_000, 2, { player: "Other", players: "62", maxPlayers: "100" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
    event("game_mode", 10_000, 3, { gameMode: "mega_walls" }, fileA, {}, "Owner", "game-state", "mega_walls_mode"),
    event("kill", 20_000, 4, { killer: "Owner", victim: "Enemy" }, fileA, { kill: true }, "Owner", "minecraft-combat", "player_killed"),
    event("player_join", 120_000, 5, { player: "Owner", players: "13", maxPlayers: "100" }, fileA, {}, "Owner", "game-state", "generic_en_player_join_count"),
  ])[0];
  assert.equal(megaWallsWaitingRoomNextRound.result, "loss");
  assert.equal(megaWallsWaitingRoomNextRound.endReason, "next_round");
  assert.equal(megaWallsWaitingRoomNextRound.endMs, 20_000);
  assert.equal(megaWallsWaitingRoomNextRound.joins, 1);
  assert.equal(megaWallsWaitingRoomNextRound.resultReason, "inferred-mega-walls-quit:game-state:generic_en_player_join_count");
  assert.equal(megaWallsWaitingRoomNextRound.boundaryEvents.at(-1).role, "next_waiting_room");

  const zombiesSelfDeathWorldSwitchRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "zombies" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("kill", 60_000, 3, { victim: "Owner", killer: "Zombie" }, fileA, { death: true }, "Owner", "minecraft-combat", "generic_player_kill"),
    event("world_switch", 120_000, 4, { destination: "mini65BR" }, fileA, {}, "Owner", "game-state", "english_world_switch"),
  ])[0];
  assert.equal(zombiesSelfDeathWorldSwitchRound.gameMode, "zombies");
  assert.equal(zombiesSelfDeathWorldSwitchRound.result, "loss");
  assert.equal(zombiesSelfDeathWorldSwitchRound.resultReason, "inferred-zombies-self-death-exit:game-state:world_switch");
  assert.ok(zombiesSelfDeathWorldSwitchRound.resultEvidence.some((item) => item.kind === "zombies_self_death_then_boundary"));

  const zombiesNoSelfDeathWorldSwitchRound = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA, {}, "Owner", "game-state", "generic_en_game_countdown"),
    event("game_mode", 10_000, 2, { gameMode: "zombies" }, fileA, {}, "Owner", "game-state", "arcade_mode"),
    event("kill", 60_000, 3, { victim: "Other", killer: "Zombie" }, fileA, {}, "Owner", "minecraft-combat", "generic_player_kill"),
    event("world_switch", 120_000, 4, { destination: "mini65BR" }, fileA, {}, "Owner", "game-state", "english_world_switch"),
  ])[0];
  assert.equal(zombiesNoSelfDeathWorldSwitchRound.result, "unknown");

  const worldSwitchRounds = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "zh_mini_walls_mode"),
    event("world_switch", 60_000, 3, { destination: "起床战争大厅" }, fileA, {}, "Owner", "game-state", "zh_world_switch"),
    event("game_mode", 70_000, 4, { gameMode: "bedwars" }, fileA, {}, "Owner", "game-state", "bedwars_mode"),
  ]);
  assert.equal(worldSwitchRounds.length, 2);
  assert.equal(worldSwitchRounds[0].endReason, "world_switch");
  assert.equal(worldSwitchRounds[0].gameMode, "mini_walls");
  assert.equal(worldSwitchRounds[1].startReason, "world_switch");
  assert.equal(worldSwitchRounds[1].gameMode, "bedwars");

  const softUnknownSwitchRounds = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, fileA),
    event("game_mode", 10_000, 2, { gameMode: "mini_walls" }, fileA, {}, "Owner", "game-state", "zh_mini_walls_mode"),
    event("world_switch", 60_000, 3, { destination: "Somewhere" }, fileA, {}, "Owner", "game-state", "zh_world_switch"),
    event("game_mode", 70_000, 4, { gameMode: "bedwars" }, fileA, {}, "Owner", "game-state", "bedwars_mode"),
  ]);
  assert.equal(softUnknownSwitchRounds.length, 2);
  assert.equal(softUnknownSwitchRounds[0].endReason, "world_switch");
  assert.equal(softUnknownSwitchRounds[1].startReason, "world_switch");
  assert.equal(softUnknownSwitchRounds[1].gameMode, "bedwars");
}

function testActivityBuilder() {
  const filePath = "D:/logs/hyt-pit.log";
  const hytPitEvents = [
    event("game_mode", 0, 1, { gameMode: "the_pit" }, filePath, {}, "灰色染料", "game-state", "zh_hyt_pit_room_invite"),
    event("kill", 10_000, 2, { gameMode: "the_pit", killer: "灰色染料", victim: "eyelles" }, filePath, { kill: true }, "灰色染料", "game-state", "zh_hyt_pit_kill_by_attacker"),
    event("game_mode", 20_000, 3, { gameMode: "the_pit", player: "灰色染料", streak: "5" }, filePath, {}, "灰色染料", "game-state", "zh_hyt_pit_kill_streak"),
    event("game_mode", 25_000, 4, { gameMode: "the_pit", points: "10" }, filePath, {}, "灰色染料", "game-state", "pit_streak_points"),
    event("game_mode", 27_000, 5, { gameMode: "the_pit" }, filePath, {}, "灰色染料", "game-state", "pit_death_streak_reward"),
    event("server_connect", 30_000, 6, {}, filePath, {}, "灰色染料", "session", "server_connect"),
  ];

  const activity = buildActivity([], hytPitEvents);
  assert.equal(activity.summary.segments, 1);
  assert.equal(activity.summary.gameModes.the_pit.segments, 1);
  assert.equal(activity.summary.gameModes.the_pit.kills, 1);
  assert.equal(activity.summary.gameModes.the_pit.selfKills, 1);
  assert.equal(activity.summary.gameModes.the_pit.maxStreak, 5);
  assert.equal(activity.summary.gameModes.the_pit.streakPoints, 10);
  assert.equal(activity.summary.gameModes.the_pit.rewardEvents, 2);
  assert.equal(activity.segments[0].rewardEvents, 2);
  assert.equal(activity.segments[0].endReason, "server_connect");
  assert.equal(activity.segments[0].serverPlayerId, hytPitEvents[1].payload.killer);
  assert.equal(activity.segments[0].serverPlayerIdConfidence, "high");
  assert.equal(activity.segments[0].serverPlayerIdSource, "direct_self_event");
  assert.equal(buildRounds(hytPitEvents).length, 0);

  const rewardActivity = buildActivity([], [
    event("game_mode", 0, 1, { gameMode: "the_pit" }, "D:/logs/pit-reward.log", {}, "Owner", "game-state", "pit_battle_entered"),
    event("game_mode", 5_000, 2, { gameMode: "the_pit", gold: "50", xp: "100" }, "D:/logs/pit-reward.log", {}, "Owner", "game-state", "pit_death_streak_reward"),
    event("client_stop", 10_000, 3, {}, "D:/logs/pit-reward.log", {}, "Owner", "session", "client_stop"),
  ]);
  assert.equal(rewardActivity.summary.rewardEvents, 1);
  assert.equal(rewardActivity.summary.goldEarned, 50);
  assert.equal(rewardActivity.summary.xpEarned, 100);
  assert.equal(rewardActivity.summary.gameModes.the_pit.goldEarned, 50);
  assert.equal(rewardActivity.summary.gameModes.the_pit.xpEarned, 100);
  assert.equal(rewardActivity.segments[0].goldEarned, 50);
  assert.equal(rewardActivity.segments[0].xpEarned, 100);

  const economyActivity = buildActivity([], [
    event("game_mode", 0, 1, { gameMode: "the_pit" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_battle_entered"),
    event("activity_reward", 5_000, 2, { gameMode: "the_pit", rewardKind: "kill", gold: "14.00", xp: "16" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_kill_reward"),
    event("activity_reward", 6_000, 3, { gameMode: "the_pit", rewardKind: "assist", gold: "3.70", xp: "2" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_assist_reward"),
    event("activity_reward", 7_000, 4, { gameMode: "the_pit", rewardKind: "gold_pickup", gold: "2.00" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_gold_pickup"),
    event("activity_reward", 8_000, 5, { gameMode: "the_pit", rewardKind: "free_xp", xp: "13" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_free_xp"),
    event("activity_reward", 9_000, 6, { gameMode: "the_pit", rewardKind: "summary", gold: "2,058", xp: "330" }, "D:/logs/pit-economy.log", {}, "Owner", "game-state", "pit_personal_rewards_summary"),
    event("server_connect", 10_000, 7, {}, "D:/logs/pit-economy.log", {}, "Owner", "session", "server_connect"),
  ]);
  assert.equal(economyActivity.summary.rewardEvents, 5);
  assert.equal(economyActivity.summary.kills, 0);
  assert.equal(economyActivity.summary.goldEarned, 2077.7);
  assert.equal(economyActivity.summary.xpEarned, 361);
  assert.equal(economyActivity.summary.bountyClaims, 0);
  assert.equal(economyActivity.summary.bountyGoldEarned, 0);
  assert.equal(economyActivity.summary.gameModes.the_pit.goldEarned, 2077.7);
  assert.equal(economyActivity.summary.gameModes.the_pit.xpEarned, 361);
  assert.equal(economyActivity.summary.gameModes.the_pit.bountyClaims, 0);
  assert.equal(economyActivity.summary.gameModes.the_pit.bountyGoldEarned, 0);
  assert.equal(economyActivity.segments[0].rewardEvents, 5);
  assert.equal(economyActivity.segments[0].goldEarned, 2077.7);
  assert.equal(economyActivity.segments[0].xpEarned, 361);
  assert.equal(economyActivity.segments[0].bountyClaims, 0);
  assert.equal(economyActivity.segments[0].bountyGoldEarned, 0);

  const bountyClaimActivity = buildActivity([], [
    event("game_mode", 0, 1, { gameMode: "the_pit" }, "D:/logs/pit-bounty-owner.log", {}, "Owner", "game-state", "pit_battle_entered"),
    event("activity_diagnostic", 5_000, 2, { gameMode: "the_pit", diagnosticKind: "bounty_claimed", gold: "900", killer: "Owner", victim: "Other" }, "D:/logs/pit-bounty-owner.log", { kill: true }, "Owner", "game-state", "pit_bounty_claimed"),
    event("activity_diagnostic", 6_000, 3, { gameMode: "the_pit", diagnosticKind: "bounty_claimed", gold: "300", killer: "Other", victim: "Owner" }, "D:/logs/pit-bounty-owner.log", {}, "Owner", "game-state", "pit_bounty_claimed"),
    event("activity_diagnostic", 7_000, 4, { gameMode: "the_pit", diagnosticKind: "bounty_created", gold: "100", player: "Owner" }, "D:/logs/pit-bounty-owner.log", {}, "Owner", "game-state", "pit_bounty_created"),
    event("server_connect", 10_000, 5, {}, "D:/logs/pit-bounty-owner.log", {}, "Owner", "session", "server_connect"),
  ]);
  assert.equal(bountyClaimActivity.summary.rewardEvents, 0);
  assert.equal(bountyClaimActivity.summary.bountyClaims, 1);
  assert.equal(bountyClaimActivity.summary.bountyGoldEarned, 900);
  assert.equal(bountyClaimActivity.summary.goldEarned, 900);
  assert.equal(bountyClaimActivity.summary.gameModes.the_pit.bountyClaims, 1);
  assert.equal(bountyClaimActivity.summary.gameModes.the_pit.bountyGoldEarned, 900);
  assert.equal(bountyClaimActivity.segments[0].bountyClaims, 1);
  assert.equal(bountyClaimActivity.segments[0].bountyGoldEarned, 900);
  assert.equal(bountyClaimActivity.segments[0].goldEarned, 900);

  const diagnosticActivity = buildActivity([], [
    event("activity_diagnostic", 0, 1, { gameMode: "the_pit", diagnosticKind: "bounty_created", gold: "100", level: "106", player: "ZapDragon" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "pit_bounty_created"),
    event("activity_diagnostic", 5_000, 2, { gameMode: "the_pit", diagnosticKind: "bounty_bump", gold: "300", level: "103", player: "RiseThePit" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "pit_bounty_bump"),
    event("activity_diagnostic", 6_000, 3, { gameMode: "the_pit", diagnosticKind: "bounty_claimed", gold: "3,950", killer: "xpfly", victim: "RiseThePit" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "pit_bounty_claimed"),
    event("activity_diagnostic", 7_000, 4, { gameMode: "the_pit", diagnosticKind: "prestige_broadcast", player: "Earthicelord", prestige: "prestige I" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "pit_prestige_broadcast"),
    event("activity_diagnostic", 8_000, 5, { gameMode: "the_pit", diagnosticKind: "minor_event_rewards_active", area: "Temple", eventName: "2X REWARDS", minutes: "4" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "zh_pit_minor_event_rewards_active"),
    event("activity_diagnostic", 9_000, 6, { gameMode: "the_pit", diagnosticKind: "level_up", fromLevel: "40", toLevel: "41" }, "D:/logs/pit-diagnostics.log", {}, "Owner", "game-state", "pit_level_up"),
    event("server_connect", 10_000, 7, {}, "D:/logs/pit-diagnostics.log", {}, "Owner", "session", "server_connect"),
  ]);
  assert.equal(diagnosticActivity.summary.segments, 1);
  assert.equal(diagnosticActivity.summary.gameModes.the_pit.segments, 1);
  assert.equal(diagnosticActivity.summary.rewardEvents, 0);
  assert.equal(diagnosticActivity.summary.goldEarned, 0);
  assert.equal(diagnosticActivity.summary.xpEarned, 0);
  assert.equal(diagnosticActivity.summary.playerMaxKillStreak, 0);
  assert.equal(diagnosticActivity.summary.observedBroadcastMaxKillStreak, 0);
  assert.equal(diagnosticActivity.segments[0].modeSignals, 6);
  assert.equal(diagnosticActivity.segments[0].rewardEvents, 0);
  assert.equal(diagnosticActivity.segments[0].goldEarned, 0);
  assert.equal(diagnosticActivity.segments[0].xpEarned, 0);
  assert.equal(diagnosticActivity.segments[0].examples[0].type, "activity_diagnostic");
  assert.ok(diagnosticActivity.segments[0].examples.some((example) => example.rule === "game-state:pit_level_up"));

  const rewardMirrorRound = buildReport({
    roots: [],
    encoding: "utf8",
    summaries: [],
    eventResult: { events: [
      event("game_mode", 0, 1, { gameMode: "the_pit" }, "D:/logs/pit-reward-report.log", {}, "Owner", "game-state", "pit_battle_entered"),
      event("game_mode", 5_000, 2, { gameMode: "the_pit", gold: "50", xp: "100" }, "D:/logs/pit-reward-report.log", {}, "Owner", "game-state", "pit_death_streak_reward"),
      event("client_stop", 10_000, 3, {}, "D:/logs/pit-reward-report.log", {}, "Owner", "session", "client_stop"),
    ], chatLines: [], counts: {}, ruleCounts: {}, totals: { chatLines: 0, matched: 0, files: 0 } },
    rounds: [],
  }).rounds.reliable[0];
  assert.equal(rewardMirrorRound.roundKind, "activity");
  assert.equal(rewardMirrorRound.result, "not_applicable");
  assert.equal(rewardMirrorRound.rewardEvents, 1);
  assert.equal(rewardMirrorRound.goldEarned, 50);
  assert.equal(rewardMirrorRound.xpEarned, 100);

  const proxiedPitActivity = buildActivity(
    [
      {
        source: "TestSource",
        scope: "BedWars TestScope",
        playSegments: [
          {
            type: "multiplayer",
            startMs: 500_000,
            endMs: 650_000,
            startFile: filePath,
            serverHost: "127.0.0.1",
            serverAddress: "127.0.0.1",
            serverPort: 25565,
            serverConnectLineNo: 20,
            serverConnectMessage: "Connecting to 127.0.0.1, 25565",
          },
        ],
      },
    ],
    [
      event("kill", 520_000, 21, { gameMode: "the_pit", killer: "Owner", victim: "Enemy" }, filePath, { kill: true }, "Owner", "game-state", "zh_hyt_pit_kill_by_attacker"),
    ],
  );
  assert.equal(proxiedPitActivity.segments[0].serverNetwork, "NetEase");
  assert.equal(proxiedPitActivity.segments[0].serverAddress, "127.0.0.1");
  assert.equal(proxiedPitActivity.segments[0].serverLabel, "\u82b1\u96e8\u5ead");
  assert.equal(proxiedPitActivity.segments[0].serverConfidence, "inferred");
  assert.equal(proxiedPitActivity.segments[0].serverEvidence.source, "chat_template");

  const genericCountdownBeforePit = buildRounds([
    event("round_countdown", 0, 1, { seconds: "10" }, filePath, {}, "灰色染料", "bedwars", "zh_countdown_plain"),
    event("kill", 10_000, 2, { gameMode: "the_pit", killer: "灰色染料", victim: "eyelles" }, filePath, { kill: true }, "灰色染料", "game-state", "zh_hyt_pit_kill_by_attacker"),
    event("game_mode", 20_000, 3, { gameMode: "the_pit", player: "灰色染料", streak: "5" }, filePath, {}, "灰色染料", "game-state", "zh_hyt_pit_kill_streak"),
    event("server_connect", 30_000, 4, {}, filePath, {}, "灰色染料", "session", "server_connect"),
  ]);
  assert.equal(genericCountdownBeforePit.length, 1);
  assert.equal(genericCountdownBeforePit[0].kills, 0);
  assert.equal(genericCountdownBeforePit[0].gameMode, "bedwars");
  assert.equal(isReliableRound(genericCountdownBeforePit[0]), false);
}

function testStreakMetrics() {
  const winLossReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      reportRound({ result: "win", resultReason: "test:win", startMs: 10_000, endMs: 120_000, lineNo: 1 }),
      reportRound({ result: "win", resultReason: "test:win", startMs: 130_000, endMs: 240_000, lineNo: 2 }),
      reportRound({ result: "loss", resultReason: "test:loss", startMs: 250_000, endMs: 360_000, lineNo: 3 }),
      reportRound({ result: "win", resultReason: "test:win", startMs: 370_000, endMs: 480_000, lineNo: 4 }),
    ],
  });
  assert.equal(winLossReport.profile.streaks.win.breakUnknown.best.count, 2);
  assert.equal(winLossReport.profile.streaks.win.breakUnknown.current.count, 1);
  assert.equal(winLossReport.profile.streaks.win.break_unknown.best.count, 2);
  assert.equal(winLossReport.profile.totals.bestWinStreak, 2);
  assert.equal(winLossReport.profile.totals.currentWinStreak, 1);

  const unknownStrategyReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      reportRound({ result: "win", resultReason: "test:win", startMs: 10_000, endMs: 120_000, lineNo: 1 }),
      reportRound({ result: "unknown", resultReason: null, startMs: 130_000, endMs: 240_000, lineNo: 2 }),
      reportRound({ result: "win", resultReason: "test:win", startMs: 250_000, endMs: 360_000, lineNo: 3 }),
    ],
  });
  assert.equal(unknownStrategyReport.profile.streaks.win.breakUnknown.best.count, 1);
  assert.equal(unknownStrategyReport.profile.streaks.win.breakUnknown.current.count, 1);
  assert.equal(unknownStrategyReport.profile.streaks.win.skipUnknown.best.count, 2);
  assert.equal(unknownStrategyReport.profile.streaks.win.skipUnknown.current.count, 2);
  assert.equal(unknownStrategyReport.profile.streaks.win.skip_unknown.best.count, 2);

  const pitIgnoredForWinStreakReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: {
      ...emptyEventResult(),
      events: [
        event("game_mode", 150_000, 10, { gameMode: "the_pit" }, "D:/logs/pit-streak.log", {}, "Owner", "game-state", "zh_hyt_pit_room_invite"),
        event("server_connect", 170_000, 11, {}, "D:/logs/pit-streak.log", {}, "Owner", "session", "server_connect"),
      ],
    },
    rounds: [
      reportRound({ result: "win", resultReason: "test:win", startMs: 10_000, endMs: 120_000, lineNo: 1 }),
      reportRound({ result: "win", resultReason: "test:win", startMs: 250_000, endMs: 360_000, lineNo: 2 }),
    ],
  });
  assert.equal(pitIgnoredForWinStreakReport.rounds.summary.gameModes.the_pit.notApplicableResults, 1);
  assert.equal(pitIgnoredForWinStreakReport.profile.streaks.win.breakUnknown.best.count, 2);
  assert.equal(pitIgnoredForWinStreakReport.profile.streaks.win.breakUnknown.current.count, 2);

  const roundKillStreakReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      reportRound({
        result: "win",
        resultReason: "test:win",
        gameMode: "duels",
        startMs: 10_000,
        endMs: 120_000,
        lineNo: 1,
        kills: 3,
        deaths: 1,
        selfKills: 3,
        selfDeaths: 1,
        events: [
          event("kill", 20_000, 2, { killer: "Owner", victim: "Enemy1" }, "D:/logs/duels-streak.log", { kill: true }, "Owner", "minecraft-combat", "generic_player_kill"),
          event("kill", 30_000, 3, { killer: "Owner", victim: "Enemy2" }, "D:/logs/duels-streak.log", { kill: true }, "Owner", "minecraft-combat", "generic_player_kill"),
          event("death", 40_000, 4, { victim: "Owner" }, "D:/logs/duels-streak.log", { death: true }, "Owner", "minecraft-combat", "generic_player_death"),
          event("kill", 50_000, 5, { killer: "Owner", victim: "Enemy3" }, "D:/logs/duels-streak.log", { kill: true }, "Owner", "minecraft-combat", "generic_player_kill"),
        ],
      }),
    ],
  });
  assert.equal(roundKillStreakReport.rounds.reliable[0].playerMaxKillStreak, 2);
  assert.equal(roundKillStreakReport.rounds.summary.gameModes.duels.playerMaxKillStreak, 2);
  assert.equal(roundKillStreakReport.profile.streaks.playerMaxKillStreak.count, 2);

  const identityKillStreakReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: emptyEventResult(),
    rounds: [
      reportRound({
        result: "win",
        resultReason: "test:win",
        gameMode: "bedwars",
        startMs: 10_000,
        endMs: 120_000,
        lineNo: 1,
        ownerAliasesUsed: { ServerNick: 1 },
        events: [
          event("kill", 20_000, 2, { killer: "ServerNick", victim: "Enemy1" }, "D:/logs/identity-streak.log", {}, "LauncherUser", "bedwars", "zh_kill_team"),
          event("kill", 30_000, 3, { killer: "ServerNick", victim: "Enemy2" }, "D:/logs/identity-streak.log", {}, "LauncherUser", "bedwars", "zh_kill_team"),
          event("death", 40_000, 4, { victim: "ServerNick" }, "D:/logs/identity-streak.log", {}, "LauncherUser", "bedwars", "zh_death_team"),
          event("kill", 50_000, 5, { killer: "ServerNick", victim: "Enemy3" }, "D:/logs/identity-streak.log", {}, "LauncherUser", "bedwars", "zh_kill_team"),
        ],
      }),
    ],
  });
  assert.equal(identityKillStreakReport.rounds.reliable[0].playerMaxKillStreak, 2);

  const pitActivityStreakReport = buildReport({
    roots: [],
    encoding: "utf8",
    ruleSets: [],
    customRulePaths: [],
    owner: {},
    summaries: [],
    eventResult: {
      ...emptyEventResult(),
      events: [
        event("game_mode", 0, 1, { gameMode: "the_pit" }, "D:/logs/pit-streak.log", {}, "Owner", "game-state", "zh_hyt_pit_room_invite"),
        event("kill", 10_000, 2, { gameMode: "the_pit", killer: "Owner", victim: "Enemy1" }, "D:/logs/pit-streak.log", { kill: true }, "Owner", "game-state", "zh_hyt_pit_kill_by_attacker"),
        event("kill", 20_000, 3, { gameMode: "the_pit", killer: "Owner", victim: "Enemy2" }, "D:/logs/pit-streak.log", { kill: true }, "Owner", "game-state", "zh_hyt_pit_kill_by_attacker"),
        event("death", 30_000, 4, { gameMode: "the_pit", victim: "Owner" }, "D:/logs/pit-streak.log", { death: true }, "Owner", "minecraft-combat", "generic_player_death"),
        event("kill", 40_000, 5, { gameMode: "the_pit", killer: "Owner", victim: "Enemy3" }, "D:/logs/pit-streak.log", { kill: true }, "Owner", "game-state", "zh_hyt_pit_kill_by_attacker"),
        event("game_mode", 50_000, 6, { gameMode: "the_pit", player: "OtherPlayer", streak: "630" }, "D:/logs/pit-streak.log", {}, "Owner", "game-state", "zh_hyt_pit_kill_streak"),
        event("server_connect", 60_000, 7, {}, "D:/logs/pit-streak.log", {}, "Owner", "session", "server_connect"),
      ],
    },
    rounds: [],
  });
  assert.equal(pitActivityStreakReport.activity.segments[0].playerMaxKillStreak, 2);
  assert.equal(pitActivityStreakReport.activity.segments[0].observedBroadcastMaxKillStreak, 630);
  assert.equal(pitActivityStreakReport.activity.summary.gameModes.the_pit.playerMaxKillStreak, 2);
  assert.equal(pitActivityStreakReport.activity.summary.gameModes.the_pit.observedBroadcastMaxKillStreak, 630);
  assert.equal(pitActivityStreakReport.profile.streaks.playerMaxKillStreak.count, 2);
}

function testPlaySegmentIdentityPropagation() {
  const filePath = "D:/logs/play-segment-bedwars.log";
  const rounds = buildRounds([
    event("round_countdown", 10_000, 1, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event(
      "kill",
      20_000,
      2,
      { killer: "ServerNick", killerTeam: "Green", victim: "Enemy", victimTeam: "Red" },
      filePath,
      {},
      "LauncherUser",
      "bedwars",
      "zh_kill_team",
    ),
    event("round_countdown", 80_000, 3, { seconds: "10" }, filePath, {}, "LauncherUser", "bedwars", "zh_countdown"),
    event(
      "kill",
      90_000,
      4,
      { killer: "ServerNick", killerTeam: "Green", victim: "Enemy2", victimTeam: "Red" },
      filePath,
      {},
      "LauncherUser",
      "bedwars",
      "zh_kill_team",
    ),
    event(
      "task_progress",
      90_000,
      5,
      { current: "22", total: "150", task: "击杀任务", period: "每周" },
      filePath,
      {},
      "LauncherUser",
      "game-state",
      "zh_task_progress_update",
    ),
  ]);
  const propagated = propagateServerPlayerIdentityWithinPlaySegments(rounds, [
    {
      source: "TestSource",
      scope: "BedWars TestScope",
      playSegments: [
        {
          type: "multiplayer",
          startMs: 0,
          endMs: 120_000,
          startFile: filePath,
        },
      ],
    },
  ]);

  assert.equal(rounds[0].ownerAliasesUsed.ServerNick, undefined);
  assert.equal(propagated[0].propagatedServerPlayerIds.ServerNick, 1);
  assert.equal(propagated[0].selfKills, 1);
  assert.equal(propagated[0].ownerTeam, "green");
  assert.equal(propagated[0].identityPropagation.player, "ServerNick");
  assert.ok(propagated[0].resultEvidence.some((item) => item.kind === "owner_alias_from_play_segment" && item.player === "ServerNick"));

  const firstIdentity = resolveServerPlayerIdentity(propagated[0]);
  assert.equal(firstIdentity.serverPlayerId, "ServerNick");
  assert.equal(firstIdentity.serverPlayerIdSource, "play_segment_propagation");

  assert.equal(propagated[1].ownerAliasesUsed.ServerNick, 1);
  assert.deepEqual(propagated[1].propagatedServerPlayerIds ?? {}, {});
}

function testPostIdentityResultInference() {
  const punishedRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      punishedPlayers: { ServerNick: 1 },
      events: [
        compactTestEvent("round_countdown", 10_000, 1, { seconds: "10" }, "bedwars", "zh_countdown"),
        compactTestEvent("player_punished", 60_000, 2, { player: "ServerNick", reason: "abnormal_behavior_ban" }, "game-state", "zh_player_punished_for_abnormal_behavior"),
      ],
    }),
  ])[0];
  assert.equal(punishedRound.result, "loss");
  assert.equal(punishedRound.resultReason, "post-identity:owner_punished_known_server_player");
  assert.ok(punishedRound.resultEvidence.some((item) => item.kind === "owner_punished_known_server_player" && item.player === "ServerNick"));

  const ownerWonRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      resultEvidence: [
        {
          kind: "external_winner_broadcast",
          result: "unknown",
          confidence: "ignored",
          timestampMs: 60_000,
          lineNo: 2,
          ruleSet: "game-state",
          ruleId: "zh_player_won_on_map",
          winner: "ServerNick",
          map: "Cake",
        },
      ],
    }),
  ])[0];
  assert.equal(ownerWonRound.result, "win");
  assert.equal(ownerWonRound.resultReason, "post-identity:owner_won_on_map_known_server_player");
  assert.ok(ownerWonRound.resultEvidence.some((item) => item.kind === "owner_won_on_map_known_server_player" && item.winner === "ServerNick" && item.map === "Cake"));

  const otherWonRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      resultEvidence: [
        {
          kind: "external_winner_broadcast",
          result: "unknown",
          confidence: "ignored",
          timestampMs: 60_000,
          lineNo: 2,
          ruleSet: "game-state",
          ruleId: "zh_player_won_on_map",
          winner: "OtherPlayer",
          map: "Cake",
        },
      ],
    }),
  ])[0];
  assert.equal(otherWonRound.result, "unknown");
  assert.ok(otherWonRound.resultEvidence.some((item) => item.kind === "external_winner_broadcast" && item.winner === "OtherPlayer"));

  const ownerTeamFromKnownServerPlayerRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      events: [
        compactTestEvent("kill", 60_000, 2, { killer: "ServerNick", killerTeam: "Green", victim: "Enemy", victimTeam: "Red" }, "bedwars", "zh_kill_team"),
      ],
    }),
  ])[0];
  assert.equal(ownerTeamFromKnownServerPlayerRound.result, "unknown");
  assert.equal(ownerTeamFromKnownServerPlayerRound.ownerTeam, "green");
  assert.equal(ownerTeamFromKnownServerPlayerRound.selfKills, 1);
  assert.ok(ownerTeamFromKnownServerPlayerRound.resultEvidence.some((item) => item.kind === "owner_team_from_known_server_player" && item.team === "green"));

  const nonBedwarsOwnerTeamFromKnownServerPlayerRound = applyPostIdentityResultInference([
    postIdentityRound({
      gameMode: "mega_walls",
      propagatedServerPlayerIds: { ServerNick: 1 },
      events: [
        compactTestEvent("kill", 60_000, 2, { killer: "ServerNick", killerTeam: "Blue", victim: "Enemy", victimTeam: "Red" }, "mega_walls", "zh_kill_team"),
      ],
    }),
  ])[0];
  assert.equal(nonBedwarsOwnerTeamFromKnownServerPlayerRound.result, "unknown");
  assert.equal(nonBedwarsOwnerTeamFromKnownServerPlayerRound.ownerTeam, "blue");
  assert.equal(nonBedwarsOwnerTeamFromKnownServerPlayerRound.selfKills, 1);
  assert.ok(nonBedwarsOwnerTeamFromKnownServerPlayerRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_known_server_player_non_bedwars" &&
    item.team === "blue" &&
    item.sourceRuleSet === "mega_walls"
  ));

  const knownResultNonBedwarsOwnerTeamRound = applyPostIdentityResultInference([
    postIdentityRound({
      gameMode: "mega_walls",
      result: "win",
      resultReason: "game-state:victory_title",
      propagatedServerPlayerIds: { ServerNick: 1 },
      events: [
        compactTestEvent("death", 60_000, 2, { victim: "ServerNick", victimTeam: "Red" }, "mega_walls", "zh_death_team"),
      ],
    }),
  ])[0];
  assert.equal(knownResultNonBedwarsOwnerTeamRound.result, "win");
  assert.equal(knownResultNonBedwarsOwnerTeamRound.resultReason, "game-state:victory_title");
  assert.equal(knownResultNonBedwarsOwnerTeamRound.ownerTeam, "red");
  assert.equal(knownResultNonBedwarsOwnerTeamRound.selfDeaths, 1);
  assert.ok(knownResultNonBedwarsOwnerTeamRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_known_server_player_non_bedwars" &&
    item.team === "red"
  ));

  const nonBedwarsOwnerTeamFromGenericTeamChatRound = applyPostIdentityResultInference([
    postIdentityRound({
      gameMode: "mini_walls",
      propagatedServerPlayerIds: { ServerNick: 1 },
      endReason: "round_end",
      endMs: 120_000,
      boundaryEvents: [
        { role: "round_end", type: "round_end", timestampMs: 120_000, lineNo: 6, ruleSet: "game-state", ruleId: "english_winning_team" },
      ],
      events: [
        compactTestEvent("team_chat", 60_000, 2, { player: "ServerNick", team: "Green", message: "push", chatScope: "team" }, "game-state", "generic_hypixel_team_chat"),
        compactTestEvent("round_end", 120_000, 6, { winner: "Green" }, "game-state", "english_winning_team"),
      ],
    }),
  ])[0];
  assert.equal(nonBedwarsOwnerTeamFromGenericTeamChatRound.ownerTeam, "green");
  assert.equal(nonBedwarsOwnerTeamFromGenericTeamChatRound.result, "unknown");
  assert.ok(nonBedwarsOwnerTeamFromGenericTeamChatRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_known_server_player_non_bedwars" &&
    item.team === "green" &&
    item.sourceRuleSet === "game-state" &&
    item.sourceRuleId === "generic_hypixel_team_chat"
  ));

  const nonBedwarsTeamWinnerDoesNotInferRound = applyPostIdentityResultInference([
    postIdentityRound({
      gameMode: "mini_walls",
      propagatedServerPlayerIds: { ServerNick: 1 },
      endReason: "round_end",
      endMs: 120_000,
      boundaryEvents: [
        { role: "round_end", type: "round_end", timestampMs: 120_000, lineNo: 6, ruleSet: "game-state", ruleId: "english_winning_team" },
      ],
      events: [
        compactTestEvent("kill", 60_000, 2, { killer: "ServerNick", killerTeam: "Green", victim: "Enemy", victimTeam: "Red" }, "mini_walls", "zh_kill_team"),
        compactTestEvent("round_end", 120_000, 6, { winner: "Green" }, "game-state", "english_winning_team"),
      ],
    }),
  ])[0];
  assert.equal(nonBedwarsTeamWinnerDoesNotInferRound.ownerTeam, "green");
  assert.equal(nonBedwarsTeamWinnerDoesNotInferRound.result, "unknown");
  assert.ok(!nonBedwarsTeamWinnerDoesNotInferRound.resultEvidence.some((item) =>
    item.kind === "result" &&
    item.result === "win" &&
    item.ruleId === "english_winning_team"
  ));

  const ownerTeamFromKnownServerPlayerTeamChatRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      endReason: "server_connect",
      endMs: 120_000,
      boundaryEvents: [
        { role: "session_boundary", type: "server_connect", timestampMs: 120_000, lineNo: 6, ruleSet: "session", ruleId: "server_connect" },
      ],
      teamEliminations: { red: 1 },
      events: [
        compactTestEvent("team_chat", 60_000, 2, { player: "ServerNick", team: "Green", message: "hello" }, "bedwars", "zh_team_chat"),
      ],
    }),
  ])[0];
  assert.equal(ownerTeamFromKnownServerPlayerTeamChatRound.ownerTeam, "green");
  assert.equal(ownerTeamFromKnownServerPlayerTeamChatRound.result, "win");
  assert.equal(ownerTeamFromKnownServerPlayerTeamChatRound.resultReason, "inferred-owner-team-survived-team-elims-low-confidence:session:server_connect");
  assert.ok(ownerTeamFromKnownServerPlayerTeamChatRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_known_server_player" &&
    item.team === "green" &&
    item.sourceEventType === "team_chat"
  ));

  const ownerTeamFromEnglishHypixelTeamChatRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { Prisma1337: 1 },
      events: [
        compactTestEvent("team_chat", 60_000, 2, { player: "Prisma1337", team: "BLUE", message: "666" }, "bedwars", "en_hypixel_team_chat"),
      ],
    }),
  ])[0];
  assert.equal(ownerTeamFromEnglishHypixelTeamChatRound.ownerTeam, "blue");
  assert.equal(ownerTeamFromEnglishHypixelTeamChatRound.result, "unknown");
  assert.ok(ownerTeamFromEnglishHypixelTeamChatRound.resultEvidence.some((item) =>
    item.kind === "owner_team_from_known_server_player" &&
    item.team === "blue" &&
    item.sourceRuleId === "en_hypixel_team_chat"
  ));

  const selfDeathFromKnownServerPlayerRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      endReason: "server_connect",
      endMs: 180_000,
      boundaryEvents: [
        { role: "session_boundary", type: "server_connect", timestampMs: 180_000, lineNo: 6, ruleSet: "session", ruleId: "server_connect" },
      ],
      events: [
        compactTestEvent("death", 60_000, 2, { victim: "ServerNick", victimTeam: "Blue" }, "bedwars", "zh_death_team"),
      ],
    }),
  ])[0];
  assert.equal(selfDeathFromKnownServerPlayerRound.result, "loss");
  assert.equal(selfDeathFromKnownServerPlayerRound.resultReason, "inferred-bedwars-self-death-exit:session:server_connect");
  assert.equal(selfDeathFromKnownServerPlayerRound.selfDeaths, 1);
  assert.equal(selfDeathFromKnownServerPlayerRound.ownerTeam, "blue");
  assert.ok(selfDeathFromKnownServerPlayerRound.resultEvidence.some((item) => item.kind === "bedwars_self_death_then_boundary"));

  const probablyLossHintRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      resultHint: {
        value: "probably_loss",
        confidence: "low",
        reason: "self death followed by leaving boundary",
      },
    }),
  ])[0];
  assert.equal(probablyLossHintRound.result, "unknown");

  const factualSelfDeathBoundaryRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      selfDeaths: 1,
      latestCombatSelfDeathMs: 60_000,
      endReason: "server_connect",
      resultHint: {
        value: "probably_loss",
        confidence: "low",
        reason: "self death followed by leaving boundary",
      },
    }),
  ])[0];
  assert.equal(factualSelfDeathBoundaryRound.result, "loss");
  assert.equal(factualSelfDeathBoundaryRound.resultReason, "inferred-bedwars-self-death-exit:report:server_connect");

  const bedwarsLastEventSelfDeathRound = postIdentityRound({
    selfDeaths: 1,
    latestCombatSelfDeathMs: 60_000,
  });
  applyBoundaryResultInference(bedwarsLastEventSelfDeathRound, {
    type: "last_event",
    timestampMs: 90_000,
    lineNo: 4,
    ruleSet: "report",
    ruleId: "last_event",
    payload: {},
  });
  assert.equal(bedwarsLastEventSelfDeathRound.result, "loss");
  assert.equal(bedwarsLastEventSelfDeathRound.resultReason, "inferred-bedwars-self-death-exit:report:last_event");
  assert.ok(bedwarsLastEventSelfDeathRound.resultEvidence.some((item) =>
    item.kind === "bedwars_self_death_then_boundary" &&
    item.boundaryType === "last_event"
  ));

  const megaWallsLastEventSelfDeathRound = postIdentityRound({
    gameMode: "mega_walls",
    selfDeaths: 1,
    latestCombatSelfDeathMs: 60_000,
  });
  applyBoundaryResultInference(megaWallsLastEventSelfDeathRound, {
    type: "last_event",
    timestampMs: 90_000,
    lineNo: 4,
    ruleSet: "report",
    ruleId: "last_event",
    payload: {},
  });
  assert.equal(megaWallsLastEventSelfDeathRound.result, "loss");
  assert.equal(megaWallsLastEventSelfDeathRound.resultReason, "inferred-mega-walls-quit:report:last_event");

  const megaWallsStaleLastEventSelfDeathRound = postIdentityRound({
    gameMode: "mega_walls",
    selfDeaths: 1,
    latestCombatSelfDeathMs: 60_000,
  });
  applyBoundaryResultInference(megaWallsStaleLastEventSelfDeathRound, {
    type: "last_event",
    timestampMs: 10 * 60_000,
    lineNo: 4,
    ruleSet: "report",
    ruleId: "last_event",
    payload: {},
  });
  assert.equal(megaWallsStaleLastEventSelfDeathRound.result, "unknown");

  const probablyWinHintRound = applyPostIdentityResultInference([
    postIdentityRound({
      propagatedServerPlayerIds: { ServerNick: 1 },
      ownerTeam: "green",
      teamEliminations: { red: 1 },
      resultHint: {
        value: "probably_win",
        confidence: "low",
        reason: "owner team known and other teams were eliminated",
      },
    }),
  ])[0];
  assert.equal(probablyWinHintRound.result, "unknown");
}

function testUnknownAudit() {
  const noSafe = {
    result: "unknown",
    gameMode: "bedwars",
    resultHint: { value: "keep_unknown", confidence: "none", reason: "no safe result evidence" },
    endReason: "next_round",
    durationSeconds: 240,
    kills: 1,
    deaths: 2,
    resultEvidence: [],
  };
  const lowEvidence = {
    result: "unknown",
    gameMode: "bedwars",
    resultHint: { value: "keep_unknown", confidence: "none", reason: "low_evidence_bedwars_pseudo_round_candidate" },
    endReason: "server_connect",
    durationSeconds: 160,
  };
  const selfDeathBoundary = {
    result: "unknown",
    gameMode: "bedwars",
    resultHint: { value: "probably_loss", confidence: "low", reason: "self death followed by leaving boundary" },
    selfDeaths: 1,
    endReason: "crash",
  };
  const teamWinReview = {
    result: "unknown",
    gameMode: "bedwars",
    resultHint: { value: "probably_win", confidence: "low", reason: "owner team known and other teams were eliminated" },
    ownerTeam: "blue",
    teamEliminations: { red: 1 },
  };
  const nonBedwars = {
    result: "unknown",
    gameMode: "unknown",
    resultHint: { value: "keep_unknown", confidence: "none", reason: "unknown_mode_combat_fragment" },
    kills: 2,
  };

  assert.equal(buildUnknownAudit(noSafe).category, "bedwars_no_safe_result_evidence");
  assert.equal(buildUnknownAudit(noSafe).nextAction, "label_sample");
  assert.equal(buildUnknownAudit(noSafe).reviewPriority, "low");
  assert.equal(buildUnknownAudit(lowEvidence).category, "bedwars_low_evidence_pseudo_candidate");
  assert.equal(buildUnknownAudit(lowEvidence).reviewPriority, "medium");
  assert.equal(buildUnknownAudit(selfDeathBoundary).category, "bedwars_self_death_boundary_review");
  assert.equal(buildUnknownAudit(selfDeathBoundary).nextAction, "review_owner_identity");
  assert.equal(buildUnknownAudit(selfDeathBoundary).reviewPriority, "high");
  assert.equal(buildUnknownAudit(teamWinReview).category, "bedwars_team_win_low_confidence_review");
  assert.equal(buildUnknownAudit(teamWinReview).features.teamElimination, true);
  assert.equal(buildUnknownAudit(teamWinReview).reviewPriority, "high");
  assert.equal(buildUnknownAudit(nonBedwars).category, "non_bedwars_remaining_unknown");
  assert.equal(buildUnknownAudit(nonBedwars).nextAction, "review_rule_candidate");
  assert.equal(buildUnknownAudit(nonBedwars).reviewPriority, "medium");
  assert.equal(buildUnknownAudit({ result: "win", gameMode: "bedwars" }), null);

  const summary = buildUnknownAuditSummary([noSafe, lowEvidence, selfDeathBoundary, teamWinReview, nonBedwars, { result: "win", gameMode: "bedwars" }]);
  assert.equal(summary.total, 5);
  assert.equal(summary.byCategory.bedwars_no_safe_result_evidence, 1);
  assert.equal(summary.byCategory.bedwars_low_evidence_pseudo_candidate, 1);
  assert.equal(summary.byCategory.bedwars_self_death_boundary_review, 1);
  assert.equal(summary.byCategory.bedwars_team_win_low_confidence_review, 1);
  assert.equal(summary.byCategory.non_bedwars_remaining_unknown, 1);
  assert.equal(summary.byPriority.high, 2);
  assert.equal(summary.byPriority.medium, 2);
  assert.equal(summary.byPriority.low, 1);
}

function testPlayerIdentity() {
  const directIdentity = resolveServerPlayerIdentity({
    source: "Hypixel",
    localUser: "LauncherAlt",
    ownerAliasesUsed: {
      "[MVP] Prisma1337": 1,
    },
  });
  assert.equal(directIdentity.launcherUser, "LauncherAlt");
  assert.equal(directIdentity.serverPlayerId, "Prisma1337");
  assert.deepEqual(directIdentity.serverPlayerIds, { Prisma1337: 1 });
  assert.equal(directIdentity.serverPlayerIdConfidence, "high");
  assert.equal(directIdentity.serverPlayerIdSource, "direct_self_event");

  const hytLocalserverIdentity = resolveServerPlayerIdentity({
    source: "AuroraNetease",
    scope: "HuaYuTing BedWars",
    filePath: "D:/Games/AuroraNetease_Clients/.minecraft/logs/latest.log",
    localUser: "LocalProxyUser",
  });
  assert.equal(hytLocalserverIdentity.serverIdentityContext, "localserver_likely");
  assert.equal(hytLocalserverIdentity.serverPlayerId, null);
  assert.deepEqual(hytLocalserverIdentity.serverPlayerIds, {});
  assert.equal(hytLocalserverIdentity.serverPlayerIdConfidence, "none");
  assert.equal(hytLocalserverIdentity.serverPlayerIdSource, "none_localserver_requires_self_evidence");

  const launcherFallbackIdentity = resolveServerPlayerIdentity({
    source: "Hypixel",
    scope: "1.8.9",
    localUser: "HypixelAlt",
  });
  assert.equal(launcherFallbackIdentity.serverIdentityContext, "launcher_alt_likely");
  assert.equal(launcherFallbackIdentity.serverPlayerId, "HypixelAlt");
  assert.deepEqual(launcherFallbackIdentity.serverPlayerIds, { HypixelAlt: 1 });
  assert.equal(launcherFallbackIdentity.serverPlayerIdConfidence, "medium");
  assert.equal(launcherFallbackIdentity.serverPlayerIdSource, "launcher_user_fallback");
}

function event(type, timestampMs, lineNo, payload, filePath, self = {}, localUser = "Owner", ruleSet = null, ruleId = null) {
  return {
    source: "TestSource",
    scope: "BedWars TestScope",
    filePath,
    lineNo,
    type,
    timestampMs,
    payload,
    self,
    localUser,
    ruleSet: ruleSet ?? (type === "win" ? "game-state" : "bedwars"),
    ruleId: ruleId ?? (type === "win" ? "victory_title" : "test_rule"),
    message: type === "win" ? "VICTORY!" : "",
  };
}

function postIdentityRound(overrides = {}) {
  return {
    source: "TestSource",
    scope: "BedWars TestScope",
    filePath: "D:/logs/post-identity-bedwars.log",
    lineNo: 1,
    localUser: "LauncherUser",
    localUsers: { LauncherUser: 1 },
    ownerAliasesUsed: {},
    propagatedServerPlayerIds: {},
    startMs: 10_000,
    endMs: 120_000,
    durationSeconds: 110,
    confidence: "inferred",
    result: "unknown",
    resultReason: null,
    gameMode: "bedwars",
    ownerTeam: null,
    punishedPlayers: {},
    resultEvidence: [],
    events: [],
    ...overrides,
  };
}

function reportRound(overrides = {}) {
  const startMs = overrides.startMs ?? 10_000;
  const durationSeconds = overrides.durationSeconds ?? 110;
  return {
    ...postIdentityRound({
      startMs,
      endMs: overrides.endMs ?? startMs + durationSeconds * 1000,
      lastEventMs: overrides.lastEventMs ?? overrides.endMs ?? startMs + durationSeconds * 1000,
      durationSeconds,
      lineNo: overrides.lineNo ?? 1,
      ...overrides,
    }),
    kills: overrides.kills ?? 0,
    deaths: overrides.deaths ?? 0,
    bedDestroys: overrides.bedDestroys ?? 0,
    selfKills: overrides.selfKills ?? 0,
    selfDeaths: overrides.selfDeaths ?? 0,
    selfDeathSignals: overrides.selfDeathSignals ?? 0,
    selfBedDestroys: overrides.selfBedDestroys ?? 0,
    roundStarts: overrides.roundStarts ?? 1,
    roundEnds: overrides.roundEnds ?? 0,
    joins: overrides.joins ?? 0,
    leaves: overrides.leaves ?? 0,
    killers: overrides.killers ?? {},
    victims: overrides.victims ?? {},
    bedDestroyers: overrides.bedDestroyers ?? {},
    punishedPlayers: overrides.punishedPlayers ?? {},
    teamEliminations: overrides.teamEliminations ?? {},
    bedDestroyedTeams: overrides.bedDestroyedTeams ?? {},
    ownerBedDestroyed: overrides.ownerBedDestroyed ?? false,
    ownerTeamEliminated: overrides.ownerTeamEliminated ?? false,
    ownFinalDeaths: overrides.ownFinalDeaths ?? 0,
    latestOwnFinalDeathMs: overrides.latestOwnFinalDeathMs ?? null,
    boundaryEvents: overrides.boundaryEvents ?? [],
  };
}

function compactTestEvent(type, timestampMs, lineNo, payload, ruleSet, ruleId) {
  return {
    type,
    timestampMs,
    lineNo,
    ruleSet,
    ruleId,
    payload,
    self: {},
  };
}

function emptyEventResult() {
  return {
    events: [],
    counts: {},
    ruleCounts: {
      byRuleSet: {},
      byRuleId: {},
    },
    totals: {
      chatLines: 0,
      matched: 0,
      files: 0,
      cacheHits: 0,
      cacheMisses: 0,
    },
    unmatchedTemplates: [],
  };
}

function neutralEvent(...args) {
  return {
    ...event(...args),
    scope: "Neutral TestScope",
  };
}

function timelineEvent(type, timestampMs, lineNo, filePath, localUser, payload = {}) {
  return {
    type,
    scope: "Timeline TestScope",
    filePath,
    lineNo,
    timestampMs,
    localUser,
    payload,
    message: payload.serverAddress ? `Connecting to ${payload.serverAddress}, ${payload.serverPort ?? 25565}` : "",
  };
}
