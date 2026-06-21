import assert from "node:assert/strict";
import { isClientModNoiseMessage, listRuleSetDetails, listRuleSets, parseChatEvent } from "../src/parser/chatRules.mjs";

const expectedRuleSetIds = [
  "game-state",
  "bedwars",
  "skywars",
  "duels",
  "mega_walls",
  "mini_walls",
  "the_pit",
  "blitz_sg",
  "bridge",
  "build_battle",
  "hide_and_seek",
  "murder_mystery",
  "speed_uhc",
  "the_walls",
  "uhc",
  "minecraft-combat",
];
const ruleQualityZeroHitFixtureKeys = new Set();
const ruleSetIds = listRuleSets().map((ruleSet) => ruleSet.id);
assert.deepEqual(ruleSetIds, expectedRuleSetIds);
assertBundledRulePackSplit();

assertEvent(
  "起床战争>> Alice[❤20] (红之队)杀死了 Bob (蓝之队)!",
  "kill",
  "bedwars",
  { killer: "Alice", killerTeam: "红之队", victim: "Bob", victimTeam: "蓝之队" },
);

assertEvent(
  "Steve was knocked into the void by Alex. FINAL KILL!",
  "kill",
  "bedwars",
  { killer: "Alex", victim: "Steve", finalDeath: true },
);

assertEvent(
  "起床战争>> Alice (红之队)破坏了 蓝之队的床！",
  "bed_destroy",
  "bedwars",
  { player: "Alice", team: "蓝之队" },
);

assertEvent(
  "BED DESTRUCTION > Red Bed was destroyed by Steve!",
  "bed_destroy",
  "bedwars",
  { player: "Steve", team: "Red" },
);
assertEvent(
  "[8✫] [BLUE] [MVP] Prisma1337: 666",
  "team_chat",
  "bedwars",
  { team: "BLUE", player: "Prisma1337", message: "666" },
);

assertEvent("[\u961f\u4f0d] <\u9ec4\u4e4b\u961f>\u5976\u5e0c: hi", "team_chat", "bedwars", {
  team: "\u9ec4\u4e4b\u961f",
  player: "\u5976\u5e0c",
  message: "hi",
  chatScope: "team",
});
assertEvent("[\u5168\u90e8] <\u9ec4\u4e4b\u961f>\u5976\u5e0c: hi", "team_chat", "bedwars", {
  team: "\u9ec4\u4e4b\u961f",
  player: "\u5976\u5e0c",
  message: "hi",
  chatScope: "all",
});

assertEvent(
  "Alex was slain by Steve using [Diamond Sword]",
  "kill",
  "minecraft-combat",
  { killer: "Steve", victim: "Alex" },
);
assertEvent(
  "DairyStraw43228 was shot and killed by thelittletwo",
  "kill",
  "minecraft-combat",
  { killer: "thelittletwo", victim: "DairyStraw43228" },
);

assertEvent("VICTORY!", "win", "game-state", {});
assertEvent("DEFEAT!", "loss", "game-state", {});
assertEvent("[IRC] helper: hello", "ignore", "game-state", {});
assertEvent("§e? §f[§4§l最强王者§f] §6support §e邀请您加入 §6§l起床战争-幸运方块 §e房间 §b§l点击这里 §e加入！", "ignore", "game-state", {});
assertEvent("玩家 win我 一出场就已经震撼到了全服!  ? 魅力值+99", "ignore", "game-state", {});
assertEvent("段位系统 >> 恭喜玩家 lesson4_ 在起床战争-幸运方块模式中段位提升到了 荣耀黄金IV", "ignore", "game-state", {});
assertEvent("神壕vooly(MVP+) 低调的骑着黄金独角神兽来到了服务器", "ignore", "game-state", {});
assertEvent("玩家 8zip_ 在本局游戏中行为异常, 已被踢出游戏并封禁处罚", "player_punished", "game-state", { player: "8zip_", reason: "abnormal_behavior_ban" });
assertEvent("玩家8zip_在本局游戏中行为异常，已被踢出游戏并封禁处罚。", "player_punished", "game-state", { player: "8zip_", reason: "abnormal_behavior_ban" });
assertEvent("? 玩家8zip_在本局游戏中行为异常, 已被踢出游戏并封禁处罚", "player_punished", "game-state", { player: "8zip_", reason: "abnormal_behavior_ban" });
assertEvent("➤ 玩家BaiZhiJun_fc在本局游戏中行为异常, 已被踢出游戏并封禁处罚", "player_punished", "game-state", { player: "BaiZhiJun_fc", reason: "abnormal_behavior_ban" });
assertEvent("You were eliminated!", "loss", "game-state", {});
assertEvent("You died! Want to play again? Click here!", "loss", "game-state", {});
assertEvent("You died, use your compass to spectate players!", "loss", "game-state", {});
assertEvent("You have died! You are now a spectator.", "loss", "game-state", {});
assertEvent("You are now a ghost.", "self_death", "game-state", {});
assertEvent("You have permanently died! Want to play again? Click here!", "loss", "game-state", {});
assertEvent("你死了！ 想再来一局吗？ 点击这里！", "loss", "game-state", {});
assertEvent("你已经永久死亡了！想再来一局吗？ 点击这里！", "loss", "game-state", {});
assertEvent("你死了，用你的指南针来观察剩余的玩家！", "loss", "game-state", {});
assertEvent("Clay | 你现在是观察者，可以使用快捷栏中的物品操作", "self_death", "game-state", {});
assertEvent("Clay | 很遗憾，你输掉了本场比赛", "loss", "game-state", {});
assertEvent("You placed #2!", "round_end", "game-state", { placement: "2" });
assertEvent("Winners - schwulerfisch12, Maxilation13", "round_end", "game-state", { winner: "schwulerfisch12, Maxilation13" });
assertEvent("游戏将在5秒后开始！", "round_countdown", "game-state", { seconds: "5" });
assertEvent("Clay | 游戏将在 10 秒 后开始", "round_countdown", "game-state", { seconds: "10" });
assertEvent("The game starts in 1 second!", "round_countdown", "game-state", { seconds: "1" });
assertEvent("[UHC] 游戏将在 80 秒后开始", "round_countdown", "game-state", { gameMode: "uhc", seconds: "80" });
assertEvent("Speed UHC", "game_mode", "game-state", { gameMode: "speed_uhc" });
assertEvent("速度 UHC", "game_mode", "game-state", { gameMode: "speed_uhc" });
assertEvent("极速UHC", "game_mode", "game-state", { gameMode: "speed_uhc" });
assertEvent("速战极限生存", "game_mode", "game-state", { gameMode: "speed_uhc" });
assertEvent("正在前往起床战争大厅！", "world_switch", "game-state", { destination: "起床战争大厅" });
assertEvent("Sending you to mini658F!", "world_switch", "game-state", { destination: "mini658F" });
assertEvent("Teleporting you to the lobby in 3 seconds... Right-click again to cancel the teleport!", "lobby_signal", "game-state", { reason: "lobby_teleport", seconds: "3" });
assertEvent("正在返回大厅", "lobby_signal", "game-state", { reason: "returning_lobby" });
assertEvent("Clay | 正在返回大厅。", "lobby_signal", "game-state", { reason: "returning_lobby" });
assertEvent("你有 2 封未读邮件.", "lobby_signal", "game-state", { reason: "unread_mail", mails: "2" });
assertEvent("You have 1 unclaimed leveling reward!", "lobby_signal", "game-state", { reason: "leveling_reward", rewards: "1" });
assertEvent(">>> [MVP++] D0CCH1 joined the lobby! <<<", "lobby_signal", "game-state", { reason: "player_joined_lobby", player: "D0CCH1" });
assertEvent("Prisma1337 has joined (1/12)!", "player_join", "game-state", { player: "Prisma1337", players: "1", maxPlayers: "12" });
assertEvent("VvatoV加入了游戏（2/8）！", "player_join", "game-state", { player: "VvatoV", players: "2", maxPlayers: "8" });
assertEvent("You are on Red Team!", "team_assignment", "game-state", { team: "Red" });
assertEvent("The game has started! You're on team BLUE, the walls will fall down in 10 minutes.", "team_assignment", "game-state", { teamStart: "BLUE" });
assertEvent("你加入了Red一方！", "team_assignment", "game-state", { team: "Red" });
assertEvent("起床战争>> 你成功加入了 蓝之队队", "team_assignment", "game-state", { team: "蓝" });
assertEvent("起床战争>> 你成功加入了 紫之队队", "team_assignment", "game-state", { team: "紫" });
assertEvent("[BLUE] Prisma1337: push left", "team_chat", "game-state", { team: "BLUE", player: "Prisma1337", message: "push left", chatScope: "team" });
assertEvent("胜利队伍: 红", "round_end", "game-state", { winner: "红" });
assertEvent("获胜队伍: 橙之队队", "round_end", "game-state", { winner: "橙" });
assertEvent("Winning Team - Blue", "round_end", "game-state", { winner: "Blue" });
assertEvent("起床战争 >> 恭喜! 绿之队 获得胜利!", "round_end", "game-state", { gameMode: "bedwars", winner: "绿" });
assertEvent("起床战争>> 恭喜 ！橙之队队获得胜利!", "round_end", "game-state", { gameMode: "bedwars", winner: "橙" });
assertEvent("起床战争", "game_mode", "game-state", { gameMode: "bedwars" });
assertEvent("SkyWars Doubles", "game_mode", "game-state", { gameMode: "skywars" });
assertEvent("空岛战争", "game_mode", "game-state", { gameMode: "skywars" });
assertEvent("保护你的床并摧毁敌人的床。收集铁锭，金锭，绿宝石和钻石", "game_mode", "game-state", { gameMode: "bedwars" });
assertEvent("你现在在动物队！", "game_mode", "game-state", { gameMode: "hide_and_seek" });
assertEvent("你现在伪装成猪了！", "game_mode", "game-state", { gameMode: "hide_and_seek" });
assertEvent("迷你战墙", "game_mode", "game-state", { gameMode: "mini_walls" });
assertEvent("siminq杀死了Blue的迷你凋灵！", "game_mode", "game-state", { gameMode: "mini_walls" });
assertEvent("保护你们团队的迷你凋灵并杀掉其他玩家来获得胜利。", "game_mode", "game-state", { gameMode: "mini_walls" });
assertEvent("只要你的迷你凋灵活着，你就可以重生！", "game_mode", "game-state", { gameMode: "mini_walls" });
assertEvent("超级战墙", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("+25起床战争经验（时长奖励）", "game_mode", "game-state", { gameMode: "bedwars" });
assertEvent("[起床战争] + 50 经验", "game_mode", "game-state", { gameMode: "bedwars" });
assertEvent("+50 空岛战争经验! (存活奖励)", "game_mode", "game-state", { gameMode: "skywars" });
assertEvent("[空岛战争] + 50 经验", "game_mode", "game-state", { gameMode: "skywars" });
assertEvent("[天空之战] + 30 等级经验", "game_mode", "game-state", { gameMode: "skywars" });
assertEvent("+25超级战墙经验（时长奖励）", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("花雨庭>> You won the fight!", "win", "game-state", { gameMode: "duels" });
assertEvent("花雨庭>> You lost the fight.", "loss", "game-state", { gameMode: "duels" });
assertEvent("MegaWalls Duel", "game_mode", "game-state", { gameMode: "duels", duelMode: "MegaWalls" });
assertEvent("[MVP] Prisma1337 [MVP++] blazing_lord WINNER!", "round_end", "game-state", { gameMode: "duels", winner: "blazing_lord" });
assertEvent("+50 空岛战争经验! (胜利)", "win", "game-state", { gameMode: "skywars" });
assertEvent("+10 SkyWars Experience (Win)", "win", "game-state", { gameMode: "skywars" });
assertEvent("在刚刚 遗迹之轮 地图的战斗中你空岛分的变化(+7 Elo)", "win", "game-state", { gameMode: "skywars", map: "遗迹之轮", eloDelta: "+7" });
assertEvent("在刚刚 像素沼泽 地图的战斗中你空岛分的变化(-8 Elo)", "loss", "game-state", { gameMode: "skywars", map: "像素沼泽", eloDelta: "-8" });
assertEvent("你在地图钻石之心中赢得了 (+25 Elo)", "win", "game-state", { gameMode: "skywars", map: "钻石之心", eloDelta: "+25" });
assertEvent("+45 coins! (Win)", "win", "game-state", {});
assertEvent("+368 coins! (Suhzie's Network Booster) (Win)", "win", "game-state", {});
assertEvent("+45 tokens! (Win)", "win", "game-state", {});
assertNoEvent("+9 tokens! (Time Played)");
assertEvent("任务系统 >任务进度更新22/150[击杀任务·每周]", "task_progress", "game-state", { current: "22", total: "150", task: "击杀任务", period: "每周" });
assertEvent("起床战争>> 恭喜 ！绿之队队获得胜利!", "round_end", "game-state", { gameMode: "bedwars", winner: "绿" });
assertEvent("Prisma1337 在地图 虚空农庄 中取得了一场游戏的胜利", "round_end", "game-state", { winner: "Prisma1337", map: "虚空农庄" });

assertEvent("The Pit", "game_mode", "game-state", { gameMode: "the_pit" });
assertEvent("You have entered the Battle Pit. Good Luck!", "game_mode", "game-state", { gameMode: "the_pit" });
assertEvent("§e? §f[§c战神§f] §6鸯颜 §e邀请您加入 §6§l天坑乱斗 §e房间 §b§l点击这里 §e加入！", "game_mode", "game-state", { gameMode: "the_pit" });
assertEvent("STREAK! of 150 kills by [103] GansyaDEkansya", "game_mode", "game-state", { gameMode: "the_pit", streak: "150", level: "103", player: "GansyaDEkansya" });
assertEvent("连杀！ [96] CarbsGG达到了20连杀", "game_mode", "game-state", { gameMode: "the_pit", streak: "20", level: "96", player: "CarbsGG" });
assertEvent("MEGASTREAK! [83] MaisDetendToi activated OVERDRIVE!", "game_mode", "game-state", { gameMode: "the_pit", level: "83", player: "MaisDetendToi", megastreak: "OVERDRIVE" });
assertEvent("DEATH STREAK! You gained +50g and +100 XP", "game_mode", "game-state", { gameMode: "the_pit", gold: "50", xp: "100" });
assertEvent("+10 Streak Points (Kill)", "game_mode", "game-state", { gameMode: "the_pit", points: "10" });
assertEvent("§a§lKILL! §7on §9[§4§l82§9] §a_Boomknuffelaar §b+16XP §6+§614.00g", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "kill", xp: "16", gold: "14.00" });
assertEvent("§a§lDOUBLE KILL! §7on §7[§4§l80§7] §balexxxxxxxxx__ §b+11XP §6+§610.00g", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "kill", xp: "11", gold: "10.00" });
assertEvent("§a§lASSIST! §732% on §6[§910§6] §bds90 §b+2XP §6+§63.70g", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "assist", xp: "2", gold: "3.70" });
assertEvent("GOLD PICKUP! from the ground 2.00g", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "gold_pickup", gold: "2.00" });
assertEvent("FREE XP! for participation +13XP", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "free_xp", xp: "13" });
assertEvent("§6§lYour rewards: §b+330XP §6+§62,058g", "activity_reward", "game-state", { gameMode: "the_pit", rewardKind: "summary", xp: "330", gold: "2,058" });
assertEvent("PIT LEVEL UP! [40] ➟ [41]", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "level_up", fromLevel: "40", toLevel: "41" });
assertEvent("LTubeMC was killed by _____4cm_____! 1 KILL STREAK!", "kill", "game-state", { gameMode: "the_pit", victim: "LTubeMC", killer: "_____4cm_____", streak: "1" });
assertEvent("Fairy_Destroyer is on a 5 KILL STREAK!", "game_mode", "game-state", { gameMode: "the_pit", player: "Fairy_Destroyer", streak: "5" });
assertEvent("BOUNTY! of 100g on [106] ZapDragon for high streak", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "bounty_created", gold: "100", level: "106", player: "ZapDragon" });
assertEvent("BOUNTY! bump 300g on [103] RiseThePit for high streak", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "bounty_bump", gold: "300", level: "103", player: "RiseThePit" });
assertEvent("BOUNTY CLAIMED! [3] xpfly killed [104] RiseThePit for 3,950g", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "bounty_claimed", killerLevel: "3", killer: "xpfly", victimLevel: "104", victim: "RiseThePit", gold: "3,950" });
assertEvent("PRESTIGE! Earthicelord unlocked prestige I, gg!", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "prestige_broadcast", player: "Earthicelord", prestige: "prestige I" });
assertEvent("\u5c0f\u578b\u4e71\u6597\u4e8b\u4ef6\uff01 \u5e99\u5b87\u533a\u57df\u6b63\u5728\u8fdb\u884c2X REWARDS\uff0c\u8fd8\u52694\u5206\u949f", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "minor_event_rewards_active", area: "\u5e99\u5b87", eventName: "2X REWARDS", minutes: "4" });
assertEvent("\u5e99\u5b87\u533a\u57df\u7684\u5c0f\u578b\u4e71\u6597\u4e8b\u4ef6\uff012X REWARDS\u5df2\u7ed3\u675f", "activity_diagnostic", "game-state", { gameMode: "the_pit", diagnosticKind: "minor_event_rewards_ended", area: "\u5e99\u5b87", eventName: "2X REWARDS" });
assertNoEvent("[MVP++] 3BillionBerries unlocked Creeper Prestige I, gg!");
assertEvent("花雨庭 >>灰色染料 击杀了eyelles !", "kill", "game-state", { gameMode: "the_pit", killer: "灰色染料", victim: "eyelles" });
assertEvent("你好sdherthy 请为游戏地图《方块长城》进行点评。", "round_end", "game-state", { gameMode: "bedwars", player: "sdherthy", map: "方块长城" });
assertEvent("花雨庭 >>Lord1314 被 一个小皇鸭击杀!", "kill", "game-state", { gameMode: "the_pit", killer: "一个小皇鸭", victim: "Lord1314" });
assertEvent("花雨庭 >>一个小皇鸭 完成了 5 连杀!", "game_mode", "game-state", { gameMode: "the_pit", player: "一个小皇鸭", streak: "5" });
assertEvent("黑凤梨_ 被击杀,击杀者: swsorry", "kill", "game-state", { gameMode: "the_pit", victim: "黑凤梨_", killer: "swsorry", deathCause: "击杀" });
assertEvent("雨淋湿的我 被射杀,击杀者: 百以众丶小号", "kill", "game-state", { gameMode: "the_pit", victim: "雨淋湿的我", killer: "百以众丶小号", deathCause: "射杀" });
assertEvent("削菠萝的中年苍鹰 输了一场饮酒比赛,击杀者: A1mAssistt", "kill", "game-state", { gameMode: "the_pit", victim: "削菠萝的中年苍鹰", killer: "A1mAssistt", deathCause: "输了一场饮酒比赛" });
assertEvent("<黄之队>奶希: 天坑关门了？？", "team_chat", "bedwars", { team: "黄之队", player: "奶希", message: "天坑关门了？？" });
assertNoEvent("Clay | 萌小麦落泪 被 王半仙1145 击杀");

assertEvent("You have 6 minutes until the walls fall down!", "game_mode", "game-state", { gameMode: "mega_walls", minutes: "6" });
assertEvent("Mega Walls", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("巨墙将在6分钟后倒塌。", "game_mode", "game-state", { gameMode: "mega_walls", minutes: "6" });
assertEvent("摧毁敌方凋灵并消灭其他所有队伍！", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("You broke your protected chest", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("You cannot modify the castles!", "game_mode", "game-state", { gameMode: "mega_walls" });
assertEvent("Cages opened! FIGHT!", "round_start", "game-state", { gameMode: "skywars" });
assertEvent("Blitz Survival Games", "game_mode", "game-state", { gameMode: "blitz_sg" });
assertEvent("闪电饥饿游戏", "game_mode", "game-state", { gameMode: "blitz_sg" });
assertEvent("The Walls", "game_mode", "game-state", { gameMode: "the_walls" });
assertEvent("[战墙] > FoFtasd11aa加入了战墙！(4/48)", "game_mode", "game-state", { gameMode: "the_walls" });
assertEvent("The Blitz Star will be released in 3 minutes!", "game_mode", "game-state", { gameMode: "blitz_sg", minutes: "3" });
assert.equal(isClientModNoiseMessage("§b[AquaVit]§d发包数量不正常!当前发包频率26/s"), true);
assert.equal(isClientModNoiseMessage("[Noteless]Deleted HYT Bot:XIaoGuqs"), true);
assert.equal(isClientModNoiseMessage("[FoodByte] Module Speed toggled"), true);
assert.equal(isClientModNoiseMessage("起床战争>> Alice[❤20] (红之队)杀死了 Bob (蓝之队)!"), false);
assertNoEvent("[Noteless]Deleted HYT Bot:XIaoGuqs");

runQualityDrivenRuleFixtures();
assertCurrentZeroHitRuleFixturesCovered();

console.log("chat rule smoke tests passed");

function runQualityDrivenRuleFixtures() {
  const directResultFixtures = [
    ["VICTORY!", "game-state", "victory_title", "win", {}],
    ["DEFEAT!", "game-state", "defeat_title", "loss", {}],
    ["You won!", "game-state", "you_won", "win", {}],
    ["You lost!", "game-state", "you_lost", "loss", {}],
    ["You won! Want to play again? Click here!", "game-state", "you_won_click_here", "win", {}],
    ["You won the fight!", "game-state", "you_won_fight", "win", { gameMode: "duels" }],
    ["You lost the fight.", "game-state", "you_lost_fight", "loss", { gameMode: "duels" }],
    ["You died! Want to play again? Click here!", "game-state", "you_died_play_again", "loss", {}],
    ["You have permanently died! Want to play again? Click here!", "game-state", "you_permanently_died_play_again", "loss", {}],
    ["You are now a ghost.", "game-state", "you_are_now_ghost", "self_death", {}],
    ["You placed #2!", "game-state", "you_placed", "round_end", { placement: "2" }],
    ["Winner: Prisma1337", "game-state", "winner_announcement", "round_end", { winner: "Prisma1337" }],
    ["Winning Team - Blue", "game-state", "english_winning_team", "round_end", { winner: "Blue" }],
    ["+45 coins! (Win)", "game-state", "en_generic_coin_win_reward", "win", {}],
    ["+45 tokens! (Win)", "game-state", "en_generic_token_win_reward", "win", {}],
    ["+10 SkyWars Experience (Win)", "game-state", "en_skywars_experience_win_reward", "win", { gameMode: "skywars" }],
  ];

  const bedwarsFixtures = [
    [
      "Steve was knocked into the void by Alex. FINAL KILL!",
      "bedwars",
      "en_final_kill_by",
      "kill",
      { victim: "Steve", killer: "Alex", finalDeath: true },
    ],
    ["Steve fell into the void.", "bedwars", "en_bedwars_death", "death", { victim: "Steve" }],
    ["BED DESTRUCTION > Red Bed was destroyed by Steve!", "bedwars", "en_bed_destroy", "bed_destroy", { team: "Red", player: "Steve" }],
    ["TEAM ELIMINATED > Blue Team has been eliminated!", "bedwars", "en_team_eliminated", "team_eliminated", { team: "Blue" }],
    ["[8] [BLUE] [MVP] Prisma1337: 666", "bedwars", "en_hypixel_team_chat", "team_chat", { team: "BLUE", player: "Prisma1337" }],
  ];

  const boundaryFixtures = [
    ["Prisma1337 has joined (1/12)!", "game-state", "generic_en_player_join_count", "player_join", { player: "Prisma1337", players: "1", maxPlayers: "12" }],
    [">>> [MVP++] D0CCH1 joined the lobby! <<<", "game-state", "english_player_joined_lobby", "lobby_signal", { reason: "player_joined_lobby", player: "D0CCH1" }],
    ["The game starts in 1 second!", "game-state", "generic_en_game_countdown", "round_countdown", { seconds: "1" }],
    [
      "Teleporting you to the lobby in 3 seconds... Right-click again to cancel the teleport!",
      "game-state",
      "english_lobby_teleport",
      "lobby_signal",
      { reason: "lobby_teleport", seconds: "3" },
    ],
    ["You are on Red Team!", "game-state", "english_team_assignment", "team_assignment", { team: "Red" }],
    ["[BLUE] Prisma1337: push left", "game-state", "generic_hypixel_team_chat", "team_chat", { team: "BLUE", player: "Prisma1337", message: "push left", chatScope: "team" }],
    ["Cages opened! FIGHT!", "game-state", "skywars_cages_opened", "round_start", { gameMode: "skywars" }],
    ["STREAK! of 150 kills by [103] GansyaDEkansya", "game-state", "pit_streak_broadcast", "game_mode", { gameMode: "the_pit", streak: "150", level: "103", player: "GansyaDEkansya" }],
    ["+10 Streak Points (Kill)", "game-state", "pit_streak_points", "game_mode", { gameMode: "the_pit", points: "10" }],
  ];

  for (const fixture of [...directResultFixtures, ...bedwarsFixtures, ...boundaryFixtures]) {
    assertRuleEvent(...fixture);
  }
  runLowHitRuleFixtures();
  runRulePackOwnershipFixtures();

  assertNoEvent("+9 tokens! (Time Played)");
  assertNoEvent("+45 coins! (Time Played)");
  assertNoEvent("+10 SkyWars Experience (Time Played)");
  assertNoEvent("Winner board opens in 5 seconds");
  assertNoEvent("Cages opened! Shop!");
  assertNoEvent("STREAK! 150 kills by [103] GansyaDEkansya");
  assertNoEvent("+10 Streak Points (Assist)");
  assertNoEvent("[BLUE] System message without colon");
  assertNotRuleEvent("[BLUE] Prisma1337 joined the lobby!", "game-state", "generic_hypixel_team_chat");
  assertNoEvent("[Noteless]Deleted HYT Bot:XIaoGuqs");
}

function runLowHitRuleFixtures() {
  const defaultFixtures = [
    ["Duels", "game-state", "duels_mode", "game_mode", { gameMode: "duels" }],
    ["Duel", "game-state", "duels_mode", "game_mode", { gameMode: "duels" }],
    ["Bridge Duels", "game-state", "bridge_mode", "game_mode", { gameMode: "bridge" }],
    ["Build Battle", "game-state", "build_battle_mode", "game_mode", { gameMode: "build_battle" }],
    ["Build Battle Teams", "game-state", "build_battle_mode", "game_mode", { gameMode: "build_battle" }],
    ["SkyWars Ranked", "game-state", "skywars_mode", "game_mode", { gameMode: "skywars" }],
    ["\u80dc\u5229\uff01", "game-state", "zh_win", "win", {}],
    ["\u4f60\u8d62\u4e86", "game-state", "zh_win", "win", {}],
    ["\u5931\u8d25\uff01", "game-state", "zh_loss", "loss", {}],
    ["\u6e38\u620f\u5931\u8d25", "game-state", "zh_loss", "loss", {}],
    ["\u4f60\u6b7b\u4e86\uff01 \u60f3\u518d\u6765\u4e00\u5c40\u5417\uff1f \u70b9\u51fb\u8fd9\u91cc\uff01", "game-state", "zh_you_died_play_again", "loss", {}],
    ["\u4f60\u5df2\u7ecf\u6c38\u4e45\u6b7b\u4ea1\u4e86\uff01\u60f3\u518d\u6765\u4e00\u5c40\u5417\uff1f \u70b9\u51fb\u8fd9\u91cc\uff01", "game-state", "zh_you_permanently_died_play_again", "loss", {}],
    ["\u4f60\u6b7b\u4e86\uff0c\u7528\u4f60\u7684\u6307\u5357\u9488\u6765\u89c2\u5bdf\u5269\u4f59\u7684\u73a9\u5bb6\uff01", "game-state", "zh_you_died_spectate_compass", "loss", {}],
    ["Clay | \u4f60\u73b0\u5728\u662f\u89c2\u5bdf\u8005\uff0c\u53ef\u4ee5\u4f7f\u7528\u5feb\u6377\u680f\u4e2d\u7684\u7269\u54c1\u64cd\u4f5c\uff01", "game-state", "zh_clay_now_spectator", "self_death", {}],
    ["Clay | \u5f88\u9057\u61be\uff0c\u4f60\u8f93\u6389\u4e86\u672c\u573a\u6bd4\u8d5b\uff01", "game-state", "zh_clay_round_loss", "loss", {}],
    ["\u4f60\u6392\u540d #2\uff01", "game-state", "zh_placement", "round_end", { placement: "2" }],
    ["\u83b7\u80dc\u8005\uff1aTeam Rocket", "game-state", "zh_winner_announcement", "round_end", { winner: "Team Rocket" }],
    ["\u80dc\u5229\u8005 Team Rocket", "game-state", "zh_winner_plain", "round_end", { winner: "Team Rocket" }],
    ["\u80dc\u5229\u961f\u4f0d\uff1aTeam Rocket", "game-state", "zh_winning_team", "round_end", { winner: "Team Rocket" }],
    ["[\u7a7a\u5c9b\u6218\u4e89] + 50 \u7ecf\u9a8c", "game-state", "zh_skywars_bracket_experience_reward", "game_mode", { gameMode: "skywars" }],
    ["+25\u8d85\u7ea7\u6218\u5899\u7ecf\u9a8c\uff08\u65f6\u957f\u5956\u52b1\uff09", "game-state", "zh_mega_walls_experience_reward", "game_mode", { gameMode: "mega_walls" }],
    ["+25\u8ff7\u4f60\u6218\u5899\u7ecf\u9a8c\uff08\u65f6\u957f\u5956\u52b1\uff09", "game-state", "zh_mini_walls_experience_reward", "game_mode", { gameMode: "mini_walls" }],
    ["\u8d77\u5e8a\u6218\u4e89>> \u84dd\u961f\u7684\u5e8a\u88ab\u7834\u574f\uff01", "bedwars", "zh_bed_destroyed", "bed_destroy", { team: "\u84dd\u961f" }],
  ];
  const scopedFixtures = [
    ["The game starts in 5 seconds!", "bedwars", "en_countdown", "round_countdown", { seconds: "5" }, { ruleSets: ["bedwars"] }],
    ["VICTORY!", "bedwars", "en_victory", "win", {}, { ruleSets: ["bedwars"] }],
    ["SkyWars Ranked", "game-state", "skywars_mode", "game_mode", { gameMode: "skywars" }],
    ["The Pit", "game-state", "pit_mode", "game_mode", { gameMode: "the_pit" }],
    ["MegaWalls Duel", "game-state", "hypixel_named_duel_mode", "game_mode", { gameMode: "duels", duelMode: "MegaWalls" }],
    ["SkyWars Ranked", "skywars", "skywars_mode", "game_mode", { gameMode: "skywars" }, { ruleSets: ["skywars"] }],
  ];

  for (const fixture of [...defaultFixtures, ...scopedFixtures]) {
    assertRuleEvent(...fixture);
  }

  const compatSkywars = parseChatEvent("SkyWars Ranked", { ruleSets: ["game-state"] });
  assert.equal(compatSkywars?.ruleSet, "game-state");
  assert.equal(compatSkywars?.rulePack, "skywars");
  assert.equal(compatSkywars?.ruleId, "skywars_mode");

  const defaultSkywars = parseChatEvent("SkyWars Ranked");
  assert.equal(defaultSkywars?.ruleSet, "game-state");
  assert.equal(defaultSkywars?.rulePack, "skywars");
  assert.equal(defaultSkywars?.legacyRuleSet, "game-state");
  assert.equal(defaultSkywars?.ruleId, "skywars_mode");

  const directSkywars = parseChatEvent("SkyWars Ranked", { ruleSets: ["skywars"] });
  assert.equal(directSkywars?.ruleSet, "skywars");
  assert.equal(directSkywars?.rulePack, "skywars");
  assert.equal(directSkywars?.legacyRuleSet, "game-state");
  assert.equal(directSkywars?.ruleId, "skywars_mode");

  assertNoEvent("Build failed with 3 errors");
  assertNoEvent("Bridge connection timed out");
  assertNoEvent("Duel request sent to Steve");
  assertNoEvent("You won the fight preview!");
  assertNoEvent("You lost the fight against lag compensation.");
  assertNoEvent("Build Battle report submitted");
  assertNoEvent("SkyWars Experience Shop");
  assertNoEvent("钻石之心 是我最喜欢的空岛战争地图");
  assertNoEvent("在刚刚 钻石之心 地图散步了一圈");
  assertNoEvent("你在地图钻石之心中赢得了掌声");
  assertNoEvent("+45 tokens! (Time Played)");
  assertNoEvent("\u5931\u8d25\u539f\u56e0\uff1a\u961f\u53cb\u79bb\u5f00");
  assertNoEvent("\u80dc\u5229\u961f\u4f0d");
}

function runRulePackOwnershipFixtures() {
  const migratedDefaultFixtures = [
    ["Bed Wars", "game-state", "bedwars", "bedwars_mode", "game_mode", { gameMode: "bedwars" }],
    ["BED DESTRUCTION > Red Bed was destroyed by Steve!", "bedwars", "bedwars", "en_bed_destroy", "bed_destroy", { team: "Red", player: "Steve" }],
    ["TEAM ELIMINATED > Blue Team has been eliminated!", "bedwars", "bedwars", "en_team_eliminated", "team_eliminated", { team: "Blue" }],
    ["SkyWars Ranked", "game-state", "skywars", "skywars_mode", "game_mode", { gameMode: "skywars" }],
    ["Cages opened! FIGHT!", "game-state", "skywars", "skywars_cages_opened", "round_start", { gameMode: "skywars" }],
    ["+10 SkyWars Experience (Win)", "game-state", "skywars", "en_skywars_experience_win_reward", "win", { gameMode: "skywars" }],
    ["Duels", "game-state", "duels", "duels_mode", "game_mode", { gameMode: "duels" }],
    ["MegaWalls Duel", "game-state", "duels", "hypixel_named_duel_mode", "game_mode", { gameMode: "duels", duelMode: "MegaWalls" }],
    ["[MVP] Prisma1337 [MVP++] blazing_lord WINNER!", "game-state", "duels", "hypixel_duel_winner_line", "round_end", { gameMode: "duels", winner: "blazing_lord" }],
    ["Bridge Duels", "game-state", "bridge", "bridge_mode", "game_mode", { gameMode: "bridge" }],
    ["Build Battle Teams", "game-state", "build_battle", "build_battle_mode", "game_mode", { gameMode: "build_battle" }],
    ["Mega Walls", "game-state", "mega_walls", "mega_walls_mode", "game_mode", { gameMode: "mega_walls" }],
    ["You have 6 minutes until the walls fall down!", "game-state", "mega_walls", "mega_walls_walls_fall_timer", "game_mode", { gameMode: "mega_walls", minutes: "6" }],
    ["\u8ff7\u4f60\u6218\u5899", "game-state", "mini_walls", "zh_mini_walls_mode", "game_mode", { gameMode: "mini_walls" }],
    ["The Pit", "game-state", "the_pit", "pit_mode", "game_mode", { gameMode: "the_pit" }],
    ["Blitz Survival Games", "game-state", "blitz_sg", "blitz_sg_mode", "game_mode", { gameMode: "blitz_sg" }],
    ["\u4f60\u73b0\u5728\u5728\u52a8\u7269\u961f\uff01", "game-state", "hide_and_seek", "zh_hide_and_seek_animal_team", "game_mode", { gameMode: "hide_and_seek" }],
    ["Murder Mystery", "game-state", "murder_mystery", "murder_mystery_mode", "game_mode", { gameMode: "murder_mystery" }],
    ["Speed UHC", "game-state", "speed_uhc", "speed_uhc_mode", "game_mode", { gameMode: "speed_uhc" }],
    ["The Walls", "game-state", "the_walls", "the_walls_mode", "game_mode", { gameMode: "the_walls" }],
    ["[UHC] \u6e38\u620f\u5c06\u5728 80 \u79d2\u540e\u5f00\u59cb", "game-state", "uhc", "uhc_zh_bracket_countdown", "round_countdown", { gameMode: "uhc", seconds: "80" }],
  ];

  for (const fixture of migratedDefaultFixtures) {
    assertRulePackEvent(...fixture);
  }

  const directModeFixtures = [
    ...migratedDefaultFixtures,
    ["The game starts in 5 seconds!", "bedwars", "bedwars", "en_countdown", "round_countdown", { seconds: "5" }],
  ];

  for (const [message, _legacyRuleSet, rulePack, ruleId, type, payload] of directModeFixtures) {
    assertRulePackEvent(message, rulePack, rulePack, ruleId, type, payload, { ruleSets: [rulePack] });
  }

  const commonEvent = parseChatEvent("VICTORY!");
  assert.equal(commonEvent?.ruleSet, "game-state");
  assert.equal(commonEvent?.rulePack, "game-state");
  assert.equal(commonEvent?.ruleId, "victory_title");

  const combatEvent = parseChatEvent("Alex was slain by Steve using [Diamond Sword]");
  assert.equal(combatEvent?.ruleSet, "minecraft-combat");
  assert.equal(combatEvent?.rulePack, "minecraft-combat");
  assert.equal(combatEvent?.ruleId, "slain_by");
}

function assertBundledRulePackSplit() {
  const allowedModeByRulePack = new Map([
    ["game-state", new Set()],
    ["minecraft-combat", new Set()],
    ["bedwars", new Set(["bedwars"])],
    ["skywars", new Set(["skywars"])],
    ["duels", new Set(["duels"])],
    ["mega_walls", new Set(["mega_walls"])],
    ["mini_walls", new Set(["mini_walls"])],
    ["the_pit", new Set(["the_pit"])],
    ["blitz_sg", new Set(["blitz_sg"])],
    ["bridge", new Set(["bridge"])],
    ["build_battle", new Set(["build_battle"])],
    ["hide_and_seek", new Set(["hide_and_seek"])],
    ["murder_mystery", new Set(["murder_mystery"])],
    ["speed_uhc", new Set(["speed_uhc"])],
    ["the_walls", new Set(["the_walls"])],
    ["uhc", new Set(["uhc"])],
  ]);

  for (const ruleSet of listRuleSetDetails()) {
    assert.ok(allowedModeByRulePack.has(ruleSet.id), `unexpected bundled rule pack ${ruleSet.id}`);
    const allowedModes = allowedModeByRulePack.get(ruleSet.id);
    for (const rule of ruleSet.rules) {
      const gameMode = rule.payload?.gameMode;
      if (!gameMode) continue;
      assert.ok(
        allowedModes.has(gameMode),
        `${ruleSet.id}:${rule.id} declares payload.gameMode=${gameMode}; mode rules must live in their own pack`,
      );
    }
  }
}

function assertEvent(message, type, ruleSet, payload) {
  const event = parseChatEvent(message);
  assert.equal(event?.type, type);
  assert.equal(event?.ruleSet, ruleSet);
  for (const [key, value] of Object.entries(payload)) {
    assert.equal(event.payload[key], value);
  }
}

function assertNoEvent(message) {
  assert.equal(parseChatEvent(message), null);
}

function assertNotRuleEvent(message, rulePack, ruleId) {
  const event = parseChatEvent(message);
  assert.notEqual(`${event?.rulePack ?? event?.ruleSet}:${event?.ruleId}`, `${rulePack}:${ruleId}`, message);
}

function assertRuleEvent(message, ruleSet, ruleId, type, payload, options = {}) {
  const event = parseChatEvent(message, options);
  assert.equal(event?.ruleSet, ruleSet, message);
  assert.equal(event?.ruleId, ruleId, message);
  assert.equal(event?.type, type, message);
  ruleQualityZeroHitFixtureKeys.add(`${event.rulePack ?? event.ruleSet}:${event.ruleId}`);
  for (const [key, value] of Object.entries(payload)) {
    assert.equal(event.payload[key], value, `${message} payload.${key}`);
  }
}

function assertRulePackEvent(message, ruleSet, rulePack, ruleId, type, payload, options = {}) {
  const event = parseChatEvent(message, options);
  assert.equal(event?.ruleSet, ruleSet, message);
  assert.equal(event?.rulePack, rulePack, message);
  assert.equal(event?.ruleId, ruleId, message);
  assert.equal(event?.type, type, message);
  ruleQualityZeroHitFixtureKeys.add(`${event.rulePack}:${event.ruleId}`);
  for (const [key, value] of Object.entries(payload)) {
    assert.equal(event.payload[key], value, `${message} payload.${key}`);
  }
}

function assertCurrentZeroHitRuleFixturesCovered() {
  const currentZeroHitKeys = [
    "bedwars:en_countdown",
    "bedwars:en_victory",
    "bedwars:zh_bed_destroyed",
    "bridge:bridge_mode",
    "build_battle:build_battle_mode",
    "duels:duels_mode",
    "game-state:defeat_title",
    "game-state:victory_title",
    "game-state:you_lost",
    "game-state:you_placed",
    "game-state:you_won",
    "game-state:zh_placement",
    "game-state:zh_win",
    "game-state:zh_winner_announcement",
    "game-state:zh_winning_team",
    "mega_walls:zh_mega_walls_experience_reward",
    "mini_walls:zh_mini_walls_experience_reward",
    "skywars:zh_skywars_bracket_experience_reward",
  ];

  const missing = currentZeroHitKeys.filter((key) => !ruleQualityZeroHitFixtureKeys.has(key));
  assert.deepEqual(missing, [], "current rules.quality.zeroHitSamples must have rule-id-locked fixtures");
}
