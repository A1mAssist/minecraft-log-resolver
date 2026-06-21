export const unknownGameMode = "unknown";

const gameModeDefinitions = [
  ["bedwars", "Bed Wars", [/bed\s*wars?/i, /\bBW\b/i, /起床战争|床战|起床/i]],
  ["skywars", "SkyWars", [/sky\s*wars?/i, /\bSW\b/i, /空岛战争|空岛/i]],
  ["duels", "Duels", [/\bduels?\b/i, /决斗/i]],
  ["bridge", "The Bridge", [/\bthe\s+bridge\b/i, /\bbridge\s+duels?\b/i, /战桥|搭桥/i]],
  ["speed_uhc", "Speed UHC", [/speed\s*uhc/i, /速度\s*UHC|极速\s*UHC|速战极限生存/i]],
  ["uhc", "UHC", [/\bUHC\b/i, /极限生存冠军|超极限生存/i]],
  ["blitz_sg", "Blitz Survival Games", [/blitz(?:\s+survival\s+games?)?/i, /\bBSG\b/i, /闪电饥饿游戏/i]],
  ["survival_games", "Survival Games", [/survival\s+games?/i, /饥饿游戏/i]],
  ["murder_mystery", "Murder Mystery", [/murder\s+mystery/i, /密室杀手|谋杀之谜/i]],
  ["build_battle", "Build Battle", [/build\s+battle/i, /建筑大师|建筑比赛/i]],
  ["tnt_run", "TNT Run", [/\bTNT\s+Run\b/i, /TNT跑酷/i]],
  ["tnt_tag", "TNT Tag", [/\bTNT\s+Tag\b/i, /TNT标签|TNT捉人/i]],
  ["bow_spleef", "Bow Spleef", [/bow\s+spleef/i, /掘战游戏|弓箭掘战/i]],
  ["quakecraft", "Quakecraft", [/quakecraft|quake\s+craft/i, /雷神之锤/i]],
  ["paintball", "Paintball", [/paintball/i, /彩弹射击/i]],
  ["mega_walls", "Mega Walls", [/mega\s+walls/i, /超级战墙/i]],
  ["the_walls", "The Walls", [/\bthe\s+walls\b/i, /战墙/i]],
  ["warlords", "Warlords", [/warlords/i, /战争领主/i]],
  ["cops_and_crims", "Cops and Crims", [/cops\s+(?:and|n)\s+crims/i, /\bCVC\b/i, /警匪大战/i]],
  ["arcade", "Arcade", [/arcade\s+games?/i, /街机游戏/i]],
  ["mini_walls", "Mini Walls", [/mini\s+walls/i, /迷你战墙/i]],
  ["zombies", "Zombies", [/\bzombies\b/i, /僵尸末日|僵尸/i]],
  ["party_games", "Party Games", [/party\s+games?/i, /派对游戏/i]],
  ["dragon_wars", "Dragon Wars", [/dragon\s+wars/i, /龙战争/i]],
  ["capture_the_wool", "Capture the Wool", [/capture\s+the\s+wool|\bCTW\b/i, /夺羊毛/i]],
  ["dropper", "Dropper", [/\bdropper\b/i, /坠落挑战|落体/i]],
  ["hide_and_seek", "Hide and Seek", [/hide\s+and\s+seek/i, /躲猫猫/i]],
  ["skyblock", "SkyBlock", [/sky\s*block/i, /空岛生存/i]],
  ["the_pit", "The Pit", [/\bthe\s+pit\b|\bpit\b/i, /天坑乱斗/i]],
  ["smp", "SMP", [/\bSMP\b/i, /生存服务器|多人生存/i]],
  ["singleplayer", "Singleplayer", [/singleplayer/i, /单人游戏|单人存档/i]],
];

const definitionById = new Map(gameModeDefinitions.map(([id, label, patterns]) => [id, { id, label, patterns }]));

export function listGameModes() {
  return gameModeDefinitions.map(([id, label]) => ({ id, label }));
}

export function normalizeGameMode(value) {
  if (!value) return unknownGameMode;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    bw: "bedwars",
    bed_wars: "bedwars",
    sw: "skywars",
    sky_wars: "skywars",
    bridge_duel: "bridge",
    bridge_duels: "bridge",
    speeduhc: "speed_uhc",
    speed_uhc: "speed_uhc",
    bsg: "blitz_sg",
    blitz: "blitz_sg",
    walls: "the_walls",
    thewalls: "the_walls",
    murder: "murder_mystery",
    cvc: "cops_and_crims",
    cops_n_crims: "cops_and_crims",
    pit: "the_pit",
  };
  return definitionById.has(normalized) ? normalized : aliases[normalized] ?? normalized;
}

export function labelGameMode(mode) {
  const normalized = normalizeGameMode(mode);
  return definitionById.get(normalized)?.label ?? titleize(normalized);
}

export function inferGameModeFromEvent(event) {
  return firstKnownGameMode(
    event?.payload?.gameMode,
    inferGameModeFromText(event?.message),
    inferGameModeFromText(event?.scope),
    inferGameModeFromText(event?.source),
  );
}

export function inferGameModeFromText(...texts) {
  const text = texts.filter(Boolean).join(" ");
  if (!text) return unknownGameMode;
  for (const [id, , patterns] of gameModeDefinitions) {
    if (patterns.some((pattern) => pattern.test(text))) return id;
  }
  return unknownGameMode;
}

export function firstKnownGameMode(...modes) {
  for (const mode of modes) {
    const normalized = normalizeGameMode(mode);
    if (normalized && normalized !== unknownGameMode) return normalized;
  }
  return unknownGameMode;
}

function titleize(value) {
  if (!value || value === unknownGameMode) return "Unknown";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
