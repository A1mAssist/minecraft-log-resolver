import { analyzeMinecraftRoots } from "../src/parser/analyzer.mjs";
import { formatDuration } from "../src/parser/time.mjs";
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
const cacheIndex = args.indexOf("--cache");
const cachePath = cacheIndex >= 0 ? args[cacheIndex + 1] : "C:\\Users\\18366\\Documents\\Codex\\2026-05-11\\minecraft-log-session-code\\.cache\\parse-cache.json";
const encodingIndex = args.indexOf("--encoding");
const encoding = encodingIndex >= 0 ? args[encodingIndex + 1] : "utf-8";
const scopeValues = args
  .flatMap((arg, index) => (arg === "--scope" ? [args[index + 1]] : []))
  .filter(Boolean);

const optionValueIndexes = new Set();
for (const optionName of ["--scope", "--out", "--cache", "--encoding"]) {
  args.forEach((arg, index) => {
    if (arg === optionName) optionValueIndexes.add(index + 1);
  });
}

const roots = args.filter((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));

if (!roots.length) {
  console.error("Usage: npm.cmd run analyze -- <path-to-.minecraft> [more roots...] [--scope <scope>] [--json] [--out <file>]");
  process.exit(1);
}

const summaries = await analyzeMinecraftRoots(roots, {
  scope: scopeValues.length ? scopeValues : null,
  cachePath,
  encoding,
});

const rows = summaries.map((summary) => {
  const runtimeSeconds = summary.clientSessions.reduce((total, session) => total + session.durationSeconds, 0);
  const playSeconds = summary.playSegments.reduce((total, segment) => total + segment.durationSeconds, 0);
  const multiplayerSeconds = summary.playSegments
    .filter((segment) => segment.type === "multiplayer")
    .reduce((total, segment) => total + segment.durationSeconds, 0);
  const singleplayerSeconds = summary.playSegments
    .filter((segment) => segment.type === "singleplayer")
    .reduce((total, segment) => total + segment.durationSeconds, 0);

  return {
    source: summary.source,
    scope: summary.scope,
    files: summary.logFiles,
    mb: (summary.bytes / 1024 / 1024).toFixed(1),
    starts: summary.events.client_start,
    stops: summary.events.client_stop,
    connects: summary.events.server_connect,
    joined: summary.events.player_joined,
    sessions: summary.clientSessions.length,
    runtime: formatDuration(runtimeSeconds),
    segments: summary.playSegments.length,
    playtime: formatDuration(playSeconds),
    multiplayer: formatDuration(multiplayerSeconds),
    singleplayer: formatDuration(singleplayerSeconds),
    chat: summary.events.chat_message,
    combat: summary.events.death_or_kill,
    crash: summary.events.crash,
    cache: `${summary.cache.hits}/${summary.cache.hits + summary.cache.misses}`,
  };
});

const payload = { roots, cachePath, encoding, generatedAt: new Date().toISOString(), summaries };

if (outPath) {
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.error(`Wrote ${outPath}`);
}

if (jsonOut) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.table(rows);
}
