import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath } from "../src/config/appConfig.mjs";

const fixtureDir = path.resolve(".cache", "test-config");
const fixturePath = path.join(fixtureDir, "observatory.config.json");
const localFixturePath = path.join(fixtureDir, "observatory.local.json");

await mkdir(fixtureDir, { recursive: true });
await writeFile(
  fixturePath,
  JSON.stringify(
    {
      roots: ["D:/example/.minecraft"],
      encoding: "utf8",
      customRules: ["rules"],
      unmatchedTemplatesLimit: 7,
      cache: {
        chat: "cache/chat.json",
      },
      outputs: {
        report: "out/report.json",
      },
      owner: {
        displayName: "Test Owner",
        aliases: ["ServerNick"],
      },
      app: {
        dataDir: "data",
        skinProxyEnabled: true,
      },
      localConfig: "observatory.local.json",
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(
  localFixturePath,
  JSON.stringify(
    {
      roots: ["D:/local/.minecraft"],
      owner: {
        aliases: ["LocalNick"],
      },
      app: {
        dataDir: "D:/local/observatory-data",
      },
    },
    null,
    2,
  ),
  "utf8",
);

try {
  const context = await loadAppConfig(fixturePath);

  assert.equal(context.path, fixturePath);
  assert.equal(context.dir, fixtureDir);
  assert.equal(context.localPath, localFixturePath);
  assert.equal(context.localExists, true);
  assert.deepEqual(
    context.layers.map((layer) => layer.kind),
    ["default", "config", "local"],
  );
  assert.deepEqual(context.config.roots, ["D:/local/.minecraft"]);
  assert.equal(context.config.encoding, "utf8");
  assert.deepEqual(context.config.customRules, ["rules"]);
  assert.equal(context.config.unmatchedTemplatesLimit, 7);
  assert.equal(context.config.cache.parse, ".cache/parse-cache.json");
  assert.equal(context.config.cache.chat, "cache/chat.json");
  assert.equal(context.config.cache.chatLines, ".cache/chat-lines-cache.json");
  assert.equal(context.config.outputs.report, "out/report.json");
  assert.equal(context.config.outputs.summary, "report-combined-summary.json");
  assert.equal(context.config.owner.mode, "all_local_users");
  assert.equal(context.config.owner.displayName, "Test Owner");
  assert.deepEqual(context.config.owner.aliases, ["LocalNick"]);
  assert.equal(context.config.app.dataDir, "D:/local/observatory-data");
  assert.equal(context.config.app.skinProxyEnabled, true);
  assert.equal(resolveConfigPath(context, context.config.cache.chat), path.join(fixtureDir, "cache", "chat.json"));
  assert.equal(resolveConfigPath(context, "relative.json"), path.join(fixtureDir, "relative.json"));
  assert.equal(resolveConfigPath(context, "D:/absolute/report.json"), "D:/absolute/report.json");

  console.log("config tests passed");
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}
