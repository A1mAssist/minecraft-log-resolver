export const UNKNOWN_SERVER_CONTEXT = Object.freeze({
  serverNetwork: null,
  serverAddress: null,
  serverLabel: "未知服务器",
  serverConfidence: "unknown",
  serverEvidence: Object.freeze({
    source: "unknown",
  }),
});

export function parseServerConnectMessage(message = "") {
  const match = String(message).match(/Connecting to\s+(?<host>[^,\s]+)(?:,\s*(?<port>\d+))?/i);
  if (!match?.groups?.host) return null;
  const host = normalizeHost(match.groups.host);
  if (!host) return null;
  const port = match.groups.port ? Number(match.groups.port) : null;
  return {
    host,
    port: Number.isInteger(port) ? port : null,
    address: formatAddress(host, Number.isInteger(port) ? port : null),
  };
}

export function buildDirectServerContext({ host, port = null, address = null, event = null, text = null } = {}) {
  const normalizedHost = normalizeHost(host ?? address);
  if (!normalizedHost) return unknownServerContext();
  const serverAddress = formatAddress(normalizedHost, port);
  const knownServer = classifyKnownServer(normalizedHost);
  const evidence = compactEvidence("server_connect", event, text);

  if (knownServer) {
    return {
      serverNetwork: knownServer.network,
      serverAddress,
      serverLabel: knownServer.label,
      serverConfidence: "direct",
      serverEvidence: evidence,
    };
  }

  if (isLocalProxyHost(normalizedHost)) {
    return {
      serverNetwork: null,
      serverAddress,
      serverLabel: "本地代理 / 未知服务器",
      serverConfidence: "direct",
      serverEvidence: evidence,
    };
  }

  return {
    serverNetwork: null,
    serverAddress,
    serverLabel: serverAddress,
    serverConfidence: "direct",
    serverEvidence: evidence,
  };
}

export function inferProxiedServerContext(baseContext, { events = [], chatLines = [] } = {}) {
  if (!isLocalProxyContext(baseContext)) return null;
  const templateHint = inferServerHintFromItems(events, "chat_template");
  if (templateHint) return proxiedContext(baseContext, templateHint);
  const chatHint = inferServerHintFromChatLines(chatLines);
  if (chatHint) return proxiedContext(baseContext, chatHint);
  return null;
}

export function inferServerContextFromChatLines(chatLines = []) {
  const hint = inferServerHintFromChatLines(chatLines);
  return hint ? contextFromHint(hint) : null;
}

export function inferServerContextFromRound(round = {}) {
  const direct = directContextFromRound(round);
  if (direct) return direct;
  const template = inferFromChatTemplates(round);
  if (template) return template;
  const scope = inferFromScopeHint(round);
  if (scope) return scope;
  return unknownServerContext();
}

export function ensureServerContext(row = {}) {
  if (row.serverLabel && row.serverConfidence && row.serverEvidence) {
    return {
      serverNetwork: row.serverNetwork ?? null,
      serverAddress: row.serverAddress ?? null,
      serverLabel: row.serverLabel,
      serverConfidence: row.serverConfidence,
      serverEvidence: normalizeEvidence(row.serverEvidence),
    };
  }
  return inferServerContextFromRound(row);
}

export function unknownServerContext() {
  return {
    serverNetwork: UNKNOWN_SERVER_CONTEXT.serverNetwork,
    serverAddress: UNKNOWN_SERVER_CONTEXT.serverAddress,
    serverLabel: UNKNOWN_SERVER_CONTEXT.serverLabel,
    serverConfidence: UNKNOWN_SERVER_CONTEXT.serverConfidence,
    serverEvidence: { ...UNKNOWN_SERVER_CONTEXT.serverEvidence },
  };
}

function directContextFromRound(round) {
  if (round.serverAddress && round.serverConfidence === "direct") {
    return buildDirectServerContext({
      host: round.serverAddress,
      port: round.serverPort ?? null,
      event: round.serverEvidence,
      text: round.serverEvidence?.text ?? null,
    });
  }

  const connectEvent = (round.events ?? []).find((event) => event.type === "server_connect" && (event.payload?.serverAddress || event.payload?.serverHost));
  if (!connectEvent) return null;
  return buildDirectServerContext({
    host: connectEvent.payload.serverHost ?? connectEvent.payload.serverAddress,
    port: connectEvent.payload.serverPort ?? null,
    address: connectEvent.payload.serverAddress ?? null,
    event: connectEvent,
    text: connectEvent.message ?? connectEvent.payload?.message ?? null,
  });
}

function inferFromChatTemplates(round) {
  for (const item of [...(round.events ?? []), ...(round.resultEvidence ?? [])]) {
    const hint = serverHintFromTemplateItem(item);
    if (hint) return contextFromHint(hint);
  }
  return null;
}

function inferFromScopeHint(round) {
  const text = `${round.source ?? ""} ${round.scope ?? ""}`.toLowerCase();
  if (/(auroranetease|netease|huayuting|hua\s*yu\s*ting|sadhyt|sad_hyt|hyt[-_ ]|hytsense)/i.test(text)) {
    return {
      serverNetwork: "NetEase",
      serverAddress: null,
      serverLabel: "NetEase / AuroraNetease_Clients",
      serverConfidence: "inferred",
      serverEvidence: {
        source: "scope_hint",
        text: "AuroraNetease_Clients",
      },
    };
  }
  if (/hypixel/i.test(text)) {
    return {
      serverNetwork: "Hypixel",
      serverAddress: null,
      serverLabel: "Hypixel",
      serverConfidence: "inferred",
      serverEvidence: {
        source: "scope_hint",
        text: "hypixel",
      },
    };
  }
  return null;
}

function classifyKnownServer(host) {
  const text = normalizeHost(host);
  if (!text) return null;
  if (isHypixelHost(text)) return { network: "Hypixel", label: "Hypixel" };
  if (isHuayutingHost(text)) return { network: "NetEase", label: "花雨庭" };
  if (text === "42.186.61.162") return { network: "粘土云", label: "粘土云" };
  if (text === "42.186.64.241") return { network: "小蜜蜂", label: "小蜜蜂" };
  if (/^(?:a\.)?polars\.cc$/i.test(text)) return { network: "HmXix", label: "HmXix" };
  if (/^mc32\.rhymc\.com$/i.test(text)) return { network: "反作弊测试服务器", label: "反作弊测试服务器" };
  if (/testserver\.loyisa\.cn/i.test(text)) return { network: "Loyisa's Test Server", label: "Loyisa's Test Server" };
  if (/remiaft/i.test(text)) return { network: "Remiaft", label: "Remiaft" };
  if (/(^|[.-])mcyc([.-]|$)/i.test(text)) return { network: "游戏世界", label: "游戏世界" };
  return null;
}

function serverHintFromTemplateText(text) {
  const value = String(text ?? "");
  if (/布吉岛/i.test(value)) return { network: "布吉岛", label: "布吉岛" };
  if (/hmxix|黑客服/i.test(value)) return { network: "HmXix", label: "HmXix" };
  if (/小蜜蜂/i.test(value)) return { network: "小蜜蜂", label: "小蜜蜂" };
  if (/testserver|loyisa/i.test(value)) return { network: "Loyisa's Test Server", label: "Loyisa's Test Server" };
  if (/remiaft/i.test(value)) return { network: "Remiaft", label: "Remiaft" };
  if (/(^|[.:_-])mcyc([.:_-]|$)|gameworld|game_world/i.test(value)) return { network: "游戏世界", label: "游戏世界" };
  if (/claycloud|zhantu|粘土|黏土/i.test(value)) return { network: "粘土云", label: "粘土云" };
  if (/hypixel|(^|[.:_-])hyp([.:_-]|$)/i.test(value)) return { network: "Hypixel", label: "Hypixel" };
  if (isHuayutingProxyBackendText(value)) return { network: "NetEase", label: "花雨庭" };
  if (/zh_hyt|huayuting|hua\s*yu\s*ting|hyt|netease|花雨庭|网易|\[战墙\]|^战墙$/i.test(value)) return { network: "NetEase", label: /hyt|huayuting|花雨庭|\[战墙\]|^战墙$/i.test(value) ? "花雨庭" : "NetEase" };
  return null;
}

function serverHintFromTemplateItem(item) {
  const ruleText = `${item.ruleSet ?? ""}:${item.ruleId ?? ""}`;
  const hint = serverHintFromTemplateText(`${ruleText} ${item.message ?? ""}`);
  if (!hint) return null;
  return {
    ...hint,
    evidence: compactEvidence("chat_template", item, ruleText),
  };
}

function inferServerHintFromItems(items, evidenceSource) {
  for (const item of items ?? []) {
    const hint = evidenceSource === "chat_template"
      ? serverHintFromTemplateItem(item)
      : serverHintFromChatText(item?.message ?? item?.text ?? "");
    if (hint) return hint;
  }
  return null;
}

function inferServerHintFromChatLines(chatLines = []) {
  for (const line of chatLines) {
    const hint = serverHintFromChatText(line?.message ?? "");
    if (!hint) continue;
    return {
      ...hint,
      evidence: compactEvidence("chat_text", line, hint.evidenceText ?? line.message),
    };
  }
  return null;
}

function serverHintFromChatText(message) {
  const text = cleanServerHintText(message);
  if (!text) return null;
  const hostServer = classifyKnownServer(text);
  if (hostServer) return { network: hostServer.network, label: hostServer.label, evidenceText: matchedEvidenceText(message, hostServer.label) };
  const templateHint = serverHintFromTemplateText(text);
  if (!templateHint) return null;
  return {
    ...templateHint,
    evidenceText: matchedEvidenceText(message, templateHint.label),
  };
}

function contextFromHint(hint) {
  return {
    serverNetwork: hint.network,
    serverAddress: null,
    serverLabel: hint.label,
    serverConfidence: "inferred",
    serverEvidence: normalizeEvidence(hint.evidence ?? { source: "unknown" }),
  };
}

function proxiedContext(baseContext, hint) {
  return {
    serverNetwork: hint.network,
    serverAddress: baseContext.serverAddress ?? null,
    serverLabel: hint.label,
    serverConfidence: "inferred",
    serverEvidence: normalizeEvidence(hint.evidence ?? { source: "unknown" }),
  };
}

function isHuayutingHost(text) {
  return text === "59.111.137.99"
    || text === "169.254.233.196"
    || text === "mc.aisu.site"
    || /hytpc/i.test(text)
    || /neteasehyt|huayuting|hua-?yu-?ting|(^|[.-])hyt([.-]|$)/i.test(text);
}

function isHuayutingProxyBackendText(text) {
  return /\b\d*sw-solo\d+\b/i.test(String(text ?? ""));
}

function isHypixelHost(text) {
  return /(^|\.)hypixel\.net$|hypixel|(^|[.-])hyp([.-]|$)/i.test(text);
}

function isLocalProxyHost(host) {
  const text = normalizeHost(host);
  if (!text) return false;
  if (["localhost", "::1", "[::1]", "0.0.0.0"].includes(text)) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(text)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(text)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(text)) return true;
  const private172 = text.match(/^172\.(?<second>\d{1,3})(?:\.\d{1,3}){2}$/);
  if (private172) {
    const second = Number(private172.groups.second);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isLocalProxyContext(context) {
  if (!context || context.serverConfidence !== "direct") return false;
  if (context.serverLabel !== "本地代理 / 未知服务器") return false;
  return isLocalProxyHost(context.serverAddress);
}

function normalizeHost(value) {
  const raw = String(value ?? "").trim().replace(/,+$/, "");
  if (!raw) return null;
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const withoutPath = withoutProtocol.split(/[/?#]/)[0];
  if (!withoutPath) return null;
  if (withoutPath.startsWith("[") && withoutPath.includes("]")) return withoutPath.slice(1, withoutPath.indexOf("]")).toLowerCase();
  return withoutPath.replace(/:(\d+)$/, "").replace(/\.$/, "").toLowerCase();
}

function cleanServerHintText(value) {
  return String(value ?? "")
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchedEvidenceText(rawMessage, fallback) {
  const text = cleanServerHintText(rawMessage);
  if (!text) return fallback;
  const matches = [
    "Hypixel",
    "花雨庭",
    "网易",
    "NetEase",
    "HYT",
    "HuayuTing",
    "sw-solo",
    "布吉岛",
    "HmXix",
    "黑客服",
    "小蜜蜂",
    "Remiaft",
    "mcyc",
    "游戏世界",
    "粘土云",
    "粘土",
    "反作弊测试服务器",
    "Loyisa",
    "testserver",
  ];
  const hit = matches.find((item) => text.toLowerCase().includes(item.toLowerCase()));
  return hit ?? text.slice(0, 120);
}

function formatAddress(host, port = null) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return null;
  const numericPort = Number(port);
  if (Number.isInteger(numericPort) && numericPort > 0 && numericPort !== 25565) return `${normalizedHost}:${numericPort}`;
  return normalizedHost;
}

function compactEvidence(source, event = null, text = null) {
  return normalizeEvidence({
    source,
    ...(text ? { text: String(text) } : {}),
    ...(event?.lineNo !== undefined && event?.lineNo !== null ? { lineNo: event.lineNo } : {}),
    ...(event?.timestampMs !== undefined && event?.timestampMs !== null ? { timestampMs: event.timestampMs } : {}),
  });
}

function normalizeEvidence(evidence = {}) {
  const source = ["server_connect", "scoreboard", "chat_template", "chat_text", "scope_hint", "unknown"].includes(evidence.source)
    ? evidence.source
    : "unknown";
  return {
    source,
    ...(evidence.text ? { text: String(evidence.text) } : {}),
    ...(evidence.lineNo !== undefined && evidence.lineNo !== null ? { lineNo: evidence.lineNo } : {}),
    ...(evidence.timestampMs !== undefined && evidence.timestampMs !== null ? { timestampMs: evidence.timestampMs } : {}),
  };
}
