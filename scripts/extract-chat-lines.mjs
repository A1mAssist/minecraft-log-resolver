import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { collectChatLines } from "../src/parser/chatLineCache.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outValue = readOption("--out");
const outPath = outValue ? resolveConfigPath(configContext, outValue) : null;
const roots = readRepeatedOption("--root");
const selectedRoots = roots.length ? roots : config.roots;
const selectedScopes = readRepeatedOption("--scope");
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const result = await collectChatLines(selectedRoots, {
  scope: selectedScopes.length ? selectedScopes : null,
  encoding: config.encoding,
  cachePath: chatLinesCachePath,
});

if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const out = createWriteStream(outPath, { encoding: "utf8" });
  for (const line of result.lines) {
    out.write(`${JSON.stringify(line)}\n`);
  }
  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.on("error", reject);
  });
}

console.log(
  JSON.stringify(
    {
      outPath,
      totals: result.totals,
      cache: `${result.totals.cacheHits}/${result.totals.files}`,
    },
    null,
    2,
  ),
);

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}
