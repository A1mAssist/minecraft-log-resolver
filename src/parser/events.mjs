import { parseServerConnectMessage } from "./serverContext.mjs";

const deathOrKillPattern =
  / was slain| was shot| was killed| died| blew up| hit the ground| fell from| burned to death| drowned| went up in flames| was blown up| starved to death| suffocated| tried to swim in lava/i;

export const eventTypes = [
  "client_start",
  "client_stop",
  "server_connect",
  "player_joined",
  "player_left",
  "singleplayer_stop",
  "chat_message",
  "death_or_kill",
  "crash",
];

const signalNeedles = [
  "[chat]",
  "setting user:",
  "stopping!",
  "stopping server",
  "stopping singleplayer",
  "connecting to ",
  "joined the game",
  "left the game",
  "lost connection",
  "crash report",
  "reported exception",
  "exception in thread",
  "game crashed",
];

export function hasEventSignal(rawText) {
  const lower = rawText.toLowerCase();
  return signalNeedles.some((needle) => lower.includes(needle));
}

export function extractEvents(scope, line) {
  const base = {
    scope,
    filePath: line.filePath,
    lineNo: line.lineNo,
    timeText: line.timeText,
    message: line.message,
  };

  if (line.isChat) {
    const events = [{ ...base, type: "chat_message" }];
    if (deathOrKillPattern.test(line.message)) events.push({ ...base, type: "death_or_kill" });
    return events;
  }

  if (line.message.includes("Setting user:")) return [{ ...base, type: "client_start" }];
  if (/Stopping singleplayer/i.test(line.message)) return [{ ...base, type: "singleplayer_stop" }];
  if (/Stopping!|Stopping server/i.test(line.message)) return [{ ...base, type: "client_stop" }];
  if (line.message.includes("Connecting to ")) {
    const server = parseServerConnectMessage(line.message);
    return [{
      ...base,
      type: "server_connect",
      payload: server ? {
        serverHost: server.host,
        serverPort: server.port,
        serverAddress: server.address,
      } : {},
    }];
  }
  if (line.message.includes("joined the game")) return [{ ...base, type: "player_joined" }];
  if (line.message.includes("left the game") || line.message.includes("lost connection")) return [{ ...base, type: "player_left" }];
  if (/Crash report|Reported exception|Exception in thread|Game crashed/i.test(line.message)) return [{ ...base, type: "crash" }];

  return [];
}
