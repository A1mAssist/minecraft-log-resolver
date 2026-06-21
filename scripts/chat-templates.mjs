import { writeFile } from "node:fs/promises";
import { analyzeChatTemplates } from "../src/parser/chatTemplates.mjs";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? resolveConfigPath(configContext, args[outIndex + 1]) : null;
const topIndex = args.indexOf("--top");
const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 80;
const jsonOut = args.includes("--json");
const limitIndex = args.indexOf("--limit-per-file");
const limitPerFile = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const encodingIndex = args.indexOf("--encoding");
const encoding = encodingIndex >= 0 ? args[encodingIndex + 1] : config.encoding;
const chatLinesCachePath = resolveConfigPath(configContext, readOption("--chat-lines-cache") ?? config.cache.chatLines);

const optionValueIndexes = new Set();
for (const optionName of ["--scope", "--out", "--top", "--limit-per-file", "--encoding", "--config", "--chat-lines-cache"]) {
  args.forEach((arg, index) => {
    if (arg === optionName) optionValueIndexes.add(index + 1);
  });
}

const scopeValues = args
  .flatMap((arg, index) => (arg === "--scope" ? [args[index + 1]] : []))
  .filter(Boolean);
const roots = args.filter((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));
const selectedRoots = roots.length ? roots : config.roots;

if (!selectedRoots.length) {
  console.error(
    "Usage: npm.cmd run chat:templates -- <path-to-.minecraft> [more roots...] [--scope <scope>] [--top 80] [--json] [--out <file>]",
  );
  process.exit(1);
}

const result = await analyzeChatTemplates(selectedRoots, {
  scope: scopeValues.length ? scopeValues : null,
  limitPerFile,
  encoding,
  chatLinesCachePath,
});

const payload = {
  roots: selectedRoots,
  generatedAt: new Date().toISOString(),
  totals: result.totals,
  encoding,
  templates: result.templates,
};

if (outPath) {
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.error(`Wrote ${outPath}`);
}

if (jsonOut) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(
    `Files: ${result.totals.files}, chat lines: ${result.totals.chatLines}, sampled: ${result.totals.sampledLines}, chat cache: ${result.totals.chatLineCacheHits}/${result.totals.files}`,
  );
  console.table(
    result.templates.slice(0, top).map((row) => ({
      source: row.source,
      scope: row.scope,
      category: row.category,
      count: row.count,
      template: row.template.slice(0, 120),
      example: row.examples[0]?.slice(0, 120) ?? "",
    })),
  );
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
