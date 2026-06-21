import { collectChatLines } from "./chatLineCache.mjs";
import { isClientModNoiseMessage } from "./chatNoise.mjs";

const colorCodePattern = /(?:\u00a7|&)[0-9a-fk-or]/gi;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g;
const numberPattern = /(?<![A-Za-z_])[-+]?\d+(?:\.\d+)?%?/g;
const repeatedSpacePattern = /\s+/g;

const playerLikePattern =
  /\b(?!You\b|BedWars\b|SkyWars\b|Murder\b|Mystery\b|Victory\b|Defeat\b|Kills?\b|Deaths?\b|Final\b|Assist\b|Coins?\b|XP\b|Level\b|was\b|slain\b|shot\b|killed\b|by\b|using\b|fell\b|void\b|left\b|joined\b|game\b)[A-Za-z_][A-Za-z0-9_]{2,16}\b/gi;

const tokens = {
  uuid: "\uE001",
  ip: "\uE002",
  heart: "\uE003",
  star: "\uE004",
  num: "\uE005",
  player: "\uE006",
};

const noisyPrefixPatterns = [
  /^\[[^\]]+\]\s*/,
  /^[-=]+\s*/,
  /^>\s*/,
];

export function normalizeChatMessage(message) {
  let normalized = message
    .replace(colorCodePattern, "")
    .replace(uuidPattern, tokens.uuid)
    .replace(ipPattern, tokens.ip)
    .replace(/[❤♥]/g, tokens.heart)
    .replace(/[✫✪★☆]/g, tokens.star)
    .replace(/[➜»]/g, " ")
    .replace(/[|]/g, " | ");

  for (const prefix of noisyPrefixPatterns) {
    normalized = normalized.replace(prefix, "");
  }

  normalized = normalized
    .replace(numberPattern, tokens.num)
    .replace(playerLikePattern, tokens.player)
    .replaceAll(tokens.uuid, "<uuid>")
    .replaceAll(tokens.ip, "<ip>")
    .replaceAll(tokens.heart, "<heart>")
    .replaceAll(tokens.star, "<star>")
    .replaceAll(tokens.num, "<num>")
    .replaceAll(tokens.player, "<player>")
    .replace(repeatedSpacePattern, " ")
    .trim();

  return normalized || "<empty>";
}

export function classifyTemplate(template) {
  const lower = template.toLowerCase();
  if (/victory|winner|winners|you won|胜利|获胜|赢了/.test(lower)) return "round_win";
  if (/defeat|game over|you died|失败|输了|死亡/.test(lower)) return "round_loss";
  if (/starting in|game starts|游戏开始|开始倒计时|秒后开始|倒计时/.test(lower)) return "round_start";
  if (/killed by|was slain|was shot|final kill|击杀|杀死|被.*杀|摧毁|彻底摧毁|破坏/.test(lower)) return "combat";
  if (/coins?|experience|xp|karma|reward|奖励|硬币|经验/.test(lower)) return "reward";
  if (/joined|left|加入|退出|进入|离开/.test(lower)) return "presence";
  if (/map|mode|地图|模式/.test(lower)) return "metadata";
  return "other";
}

export async function analyzeChatTemplates(roots, options = {}) {
  const limitPerFile = options.limitPerFile ?? Infinity;
  const templates = new Map();
  const chatLinesResult = await collectChatLines(roots, {
    scope: options.scope,
    encoding: options.encoding,
    cachePath: options.chatLinesCachePath,
  });
  const totals = {
    files: chatLinesResult.totals.files,
    chatLines: chatLinesResult.totals.chatLines,
    sampledLines: 0,
    chatLineCacheHits: chatLinesResult.totals.cacheHits,
    chatLineCacheMisses: chatLinesResult.totals.cacheMisses,
  };
  const sampledByFile = new Map();

  for (const chatLine of chatLinesResult.lines) {
    if (isClientModNoiseMessage(chatLine.message)) continue;
    const sampledFromFile = sampledByFile.get(chatLine.filePath) ?? 0;
    if (sampledFromFile >= limitPerFile) continue;
    sampledByFile.set(chatLine.filePath, sampledFromFile + 1);
    totals.sampledLines += 1;

    const template = normalizeChatMessage(chatLine.message);
    const key = `${chatLine.source}\u0000${chatLine.scope}\u0000${template}`;
    const current = templates.get(key) ?? {
      source: chatLine.source,
      scope: chatLine.scope,
      template,
      category: classifyTemplate(template),
      count: 0,
      examples: [],
    };

    current.count += 1;
    if (current.examples.length < 3 && !current.examples.includes(chatLine.message)) {
      current.examples.push(chatLine.message);
    }
    templates.set(key, current);
  }

  const rows = [...templates.values()].sort((a, b) => b.count - a.count);
  return { totals, templates: rows };
}
