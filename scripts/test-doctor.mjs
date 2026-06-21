import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtureDir = path.resolve(".cache", "test-doctor");
const rootDir = path.join(fixtureDir, "client", ".minecraft");
const logDir = path.join(rootDir, "logs");
const configPath = path.join(fixtureDir, "observatory.config.json");
const localConfigPath = path.join(fixtureDir, "observatory.local.json");

await rm(fixtureDir, { recursive: true, force: true });
await mkdir(logDir, { recursive: true });
await writeFile(path.join(logDir, "latest.log"), "[00:00:00] [Client thread/INFO]: hello\n", "utf8");
await writeFile(
  configPath,
  JSON.stringify(
    {
      roots: [],
      localConfig: "observatory.local.json",
      outputs: {
        report: "report.json",
        summary: "summary.json",
      },
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(
  localConfigPath,
  JSON.stringify(
    {
      roots: [rootDir],
      owner: {
        aliases: ["LocalNick"],
      },
      app: {
        dataDir: "derived-data",
      },
    },
    null,
    2,
  ),
  "utf8",
);
const storeDir = path.join(fixtureDir, "derived-data", "report-store");
const refreshHistoryPath = path.join(fixtureDir, ".cache", "refresh-history.json");
await mkdir(storeDir, { recursive: true });
await writeFile(
  path.join(storeDir, "manifest.json"),
  JSON.stringify(
    {
      schema: {
        name: "minecraft-log-observatory-store",
        version: 1,
      },
      generatedAt: "2026-01-01T00:00:00.000Z",
      reportGeneratedAt: "2026-01-01T00:00:00.000Z",
      files: {
        byDay: "by-day.jsonl",
        reliableRounds: "rounds-reliable.jsonl",
      },
      counts: {
        byDay: 1,
        reliableRounds: 0,
      },
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(path.join(storeDir, "by-day.jsonl"), "{\"date\":\"2026-01-01\"}\n", "utf8");
await mkdir(path.join(fixtureDir, ".cache"), { recursive: true });
await writeFile(path.join(fixtureDir, ".cache", "parse-cache.json"), "{}", "utf8");
await writeFile(path.join(fixtureDir, ".cache", "chat-event-cache.json"), "{}", "utf8");
await writeFile(path.join(fixtureDir, ".cache", "chat-lines-cache.json"), "{}", "utf8");
await writeFile(
  refreshHistoryPath,
  JSON.stringify(
    [
      {
        id: "refresh-1",
        status: "succeeded",
        phase: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:10.000Z",
        durationMs: 10000,
        phaseDurationsMs: {
          scan: 1000,
          parse: 3000,
          build_report: 2000,
          export_store: 4000,
        },
        logTail: [`parsed ${rootDir}\\logs\\latest.log`],
      },
    ],
    null,
    2,
  ),
  "utf8",
);

try {
  const safe = JSON.parse(await runDoctor(["--config", configPath, "--json"]));
  assert.equal(safe.schema.name, "minecraft-log-observatory-doctor");
  assert.equal(safe.privacy, "privacy-safe");
  assert.equal(safe.config.path.redacted, true);
  assert.equal(safe.config.roots[0].root.redacted, true);
  assert.equal(safe.config.ownerAliases[0].redacted, true);
  assert.equal(safe.outputs.store.filesReady, false);
  assert.equal(safe.outputs.store.missingFiles[0].name, "reliableRounds");
  assert.equal(safe.outputs.store.missingFiles[0].file, "rounds-reliable.jsonl");
  assert.equal(safe.outputs.store.missingFiles[0].reason, "missing");
  assert.equal(safe.performance.store.ready, false);
  assert.equal(safe.performance.store.declaredFiles, 2);
  assert.equal(safe.performance.store.totalJsonlRows, 1);
  assert.ok(Number.isFinite(safe.performance.store.totalBytes));
  assert.ok(safe.performance.store.tables.some((table) => table.name === "byDay" && table.rows === 1));
  assert.equal(safe.performance.cache.ready, true);
  assert.equal(safe.performance.cache.totalFiles, 3);
  assert.equal(safe.performance.cache.existingFiles, 3);
  assert.ok(Number.isFinite(safe.performance.cache.totalBytes));
  assert.equal(safe.performance.refreshHistory.total, 1);
  assert.equal(safe.performance.baseline.sampleSize, 1);
  assert.equal(safe.performance.baseline.latestDurationMs, 10000);
  assert.equal(safe.performance.baseline.phaseStats.export_store.averageMs, 4000);
  assert.equal(safe.performance.baseline.bottleneckPhase.phase, "export_store");
  assert.ok(safe.performance.recommendations.some((item) => item.code === "refresh_needed"));
  assert.equal(safe.needsRefresh, true);
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(escapeRegex(rootDir)));
  assert.doesNotMatch(JSON.stringify(safe), /LocalNick/);

  const full = JSON.parse(await runDoctor(["--config", configPath, "--json", "--full"]));
  assert.equal(full.privacy, "full-local");
  assert.equal(full.config.path, configPath);
  assert.equal(full.config.roots[0].root, rootDir);
  assert.deepEqual(full.config.ownerAliases, ["LocalNick"]);

  const bundle = JSON.parse(await runDoctor(["--config", configPath, "--package"]));
  assert.equal(bundle.schema.name, "minecraft-log-observatory-doctor-package");
  assert.equal(bundle.privacy, "privacy-safe");
  assert.equal(bundle.manifest.kind, "doctor-package");
  assert.ok(bundle.manifest.excluded.includes("raw_minecraft_logs"));
  assert.equal(bundle.privacyAudit.checked, true);
  assert.equal(bundle.privacyAudit.safe, true);
  assert.equal(bundle.privacyAudit.issueCount, 0);
  assert.ok(bundle.privacyAudit.checks.includes("forbidden_keys"));
  assert.equal(bundle.containsRawLogs, false);
  assert.equal(bundle.containsRawChat, false);
  assert.equal(bundle.checks.config.roots[0].root.redacted, true);
  assert.equal(bundle.checks.performance.baseline.sampleSize, 1);
  assert.equal(bundle.checks.performance.baseline.bottleneckPhase.phase, "export_store");
  assert.equal(bundle.checks.performance.store.totalJsonlRows, 1);
  assert.equal(bundle.checks.performance.cache.ready, true);
  assert.ok(bundle.checks.performance.recommendations.some((item) => item.code === "refresh_needed"));
  assertNoForbiddenKeys(bundle, ["currentFile", "log", "logTail"]);
  assert.doesNotMatch(JSON.stringify(bundle), new RegExp(escapeRegex(rootDir)));
  assert.doesNotMatch(JSON.stringify(bundle), /LocalNick/);

  const fullBundle = JSON.parse(await runDoctor(["--config", configPath, "--package", "--full"]));
  assert.equal(fullBundle.privacy, "full-local");
  assert.equal(fullBundle.manifest.contains.localPaths, true);
  assert.equal(fullBundle.privacyAudit.checked, false);
  assert.equal(fullBundle.privacyAudit.safe, false);

  await writeFile(refreshHistoryPath, "{ broken refresh history", "utf8");
  const corruptSafe = JSON.parse(await runDoctor(["--config", configPath, "--json"]));
  assert.equal(corruptSafe.performance.refreshHistory.total, 0);
  assert.equal(corruptSafe.performance.refreshHistory.warning.code, "refresh_history_invalid_json");
  assert.equal(corruptSafe.performance.baseline.sampleSize, 0);
  assert.ok(corruptSafe.performance.warnings.some((warning) => warning.code === "refresh_history_invalid_json"));
  assert.ok(corruptSafe.performance.recommendations.some((item) => item.code === "repair_refresh_history"));
  assert.doesNotMatch(JSON.stringify(corruptSafe), new RegExp(escapeRegex(rootDir)));
  assert.doesNotMatch(JSON.stringify(corruptSafe), /LocalNick/);

  const corruptBundle = JSON.parse(await runDoctor(["--config", configPath, "--package"]));
  assert.equal(corruptBundle.checks.performance.refreshHistory.warning.code, "refresh_history_invalid_json");
  assert.ok(corruptBundle.checks.performance.recommendations.some((item) => item.code === "repair_refresh_history"));
  assert.equal(corruptBundle.privacyAudit.safe, true);
  assertNoForbiddenKeys(corruptBundle, ["currentFile", "log", "logTail"]);
  assert.doesNotMatch(JSON.stringify(corruptBundle), new RegExp(escapeRegex(rootDir)));
  assert.doesNotMatch(JSON.stringify(corruptBundle), /LocalNick/);

  console.log("doctor tests passed");
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function runDoctor(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/doctor.mjs", ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoForbiddenKeys(value, forbiddenKeys, pathParts = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, forbiddenKeys, [...pathParts, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      forbiddenKeys.some((blocked) => blocked.toLowerCase() === key.toLowerCase()),
      false,
      `Forbidden key ${key} found at ${[...pathParts, key].join(".")}`,
    );
    assertNoForbiddenKeys(child, forbiddenKeys, [...pathParts, key]);
  }
}
