import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath, resolveStoreDir } from "../src/config/appConfig.mjs";
import {
  buildCachePerformanceBaseline,
  buildPerformanceRecommendations,
  buildRefreshPerformanceBaseline,
  buildStorePerformanceBaseline,
  comparePerformanceBaselines,
  measureStoreReadBaseline,
  readRefreshHistoryFromPath,
  summarizeRefreshHistory,
} from "../src/diagnostics/performanceBaseline.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const config = configContext.config;
const dataDir = resolveConfigPath(configContext, config.app?.dataDir ?? "data");
const storeDir = resolveStoreDir(configContext);
const manifestPath = path.join(storeDir, "manifest.json");
const refreshHistoryPath = resolveConfigPath(configContext, ".cache/refresh-history.json");
const reportPath = resolveConfigPath(configContext, config.outputs.report);
const summaryPath = resolveConfigPath(configContext, config.outputs.summary);
const outDir = resolveConfigPath(configContext, readOption("--out-dir") ?? "artifacts");
const outPath = readOption("--out") ? resolveConfigPath(configContext, readOption("--out")) : path.join(outDir, "performance-baseline-current.json");
const historyDir = resolveConfigPath(configContext, readOption("--history-dir") ?? "artifacts/performance-history");
const previousPath = readOption("--previous")
  ? resolveConfigPath(configContext, readOption("--previous"))
  : outPath;
const tables = readRepeatedOption("--table");
const limit = Number(readOption("--limit") ?? 100);

const refreshHistory = await readRefreshHistoryFromPath(refreshHistoryPath);
const baseline = buildRefreshPerformanceBaseline(refreshHistory.items, refreshHistory.warning);
const store = await buildStorePerformanceBaseline({ storeDir, manifestPath });
const storeReadBaseline = await measureStoreReadBaseline({
  storeDir,
  manifestPath,
  tables: tables.length ? tables : undefined,
  limit,
});
const cache = await buildCachePerformanceBaseline({
  cacheFiles: [
    { name: "parse", path: resolveConfigPath(configContext, config.cache.parse) },
    { name: "chat", path: resolveConfigPath(configContext, config.cache.chat) },
    { name: "chatLines", path: resolveConfigPath(configContext, config.cache.chatLines) },
  ],
});
const outputs = {
  report: await jsonFileSummary(reportPath),
  summary: await jsonFileSummary(summaryPath),
};
const needsRefresh = !outputs.report.exists || !outputs.summary.exists || !store.ready;
const refreshReasons = [
  ...(!outputs.report.exists ? ["report_not_ready"] : []),
  ...(!outputs.summary.exists ? ["summary_not_ready"] : []),
  ...(!store.ready ? ["store_not_ready"] : []),
];
const previousBaseline = await readJsonOptional(previousPath);

const result = {
  ok: true,
  schema: {
    name: "minecraft-log-observatory-performance-baseline",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  privacy: "privacy-safe",
  inputs: {
    report: outputs.report,
    summary: outputs.summary,
    store: {
      ready: store.ready,
      manifestFile: "manifest.json",
    },
    refreshHistory: {
      present: refreshHistory.items.length > 0,
      warning: refreshHistory.warning,
    },
  },
  refreshHistory: {
    total: refreshHistory.items.length,
    warning: refreshHistory.warning,
    summary: summarizeRefreshHistory(refreshHistory.items),
  },
  baseline,
  store,
  storeReadBaseline,
  cache,
  needsRefresh,
  refreshReasons,
  comparison: comparePerformanceBaselines(
    {
      baseline,
      store,
      storeReadBaseline,
      generatedAt: new Date().toISOString(),
    },
    previousBaseline,
  ),
  recommendations: buildPerformanceRecommendations({
    baseline,
    store,
    storeReads: { sampleSize: 0, tables: [], slowestTable: null, slowestReadMs: null },
    storeReadBaseline,
    cache,
    historyWarning: refreshHistory.warning,
    needsRefresh,
    refreshReasons,
  }),
};

await archiveExistingBaseline(outPath, historyDir);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outPath,
  previousPath,
  summary: {
    sampleSize: baseline.sampleSize,
    needsRefresh,
    refreshReasons,
  },
  baseline: {
    sampleSize: baseline.sampleSize,
    bottleneckPhase: baseline.bottleneckPhase?.phase ?? null,
  },
  store: {
    ready: store.ready,
    declaredFiles: store.declaredFiles,
    totalBytes: store.totalBytes,
    totalJsonlRows: store.totalJsonlRows,
  },
  storeReadBaseline: {
    sampleSize: storeReadBaseline.sampleSize,
    slowestTable: storeReadBaseline.slowestTable,
    slowestReadMs: storeReadBaseline.slowestReadMs,
  },
  comparison: {
    available: result.comparison.available,
    regressions: result.comparison.regressions?.length ?? 0,
    warning: result.comparison.warning?.code ?? null,
  },
  recommendations: result.recommendations.map((item) => item.code),
}, null, 2));

async function jsonFileSummary(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    let generatedAt = null;
    let schema = null;
    try {
      const parsed = JSON.parse(text);
      generatedAt = parsed.generatedAt ?? null;
      schema = parsed.schema ?? null;
    } catch {
      return {
        exists: true,
        bytes: Buffer.byteLength(text, "utf8"),
        generatedAt: null,
        schema: null,
        jsonError: "invalid_json",
      };
    }
    return {
      exists: true,
      bytes: Buffer.byteLength(text, "utf8"),
      generatedAt,
      schema,
      jsonError: null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        exists: false,
        bytes: null,
        generatedAt: null,
        schema: null,
        jsonError: null,
      };
    }
    return {
      exists: false,
      bytes: null,
      generatedAt: null,
      schema: null,
      jsonError: "unreadable",
    };
  }
}

async function archiveExistingBaseline(filePath, targetDir) {
  if (hasFlag("--no-history")) return null;
  try {
    const existing = JSON.parse(await readFile(filePath, "utf8"));
    const generatedAt = String(existing.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
    await mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `performance-baseline-${generatedAt}.json`);
    await copyFile(filePath, targetPath);
    return targetPath;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readRepeatedOption(name) {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : [])).filter(Boolean);
}

function hasFlag(name) {
  return args.includes(name);
}
