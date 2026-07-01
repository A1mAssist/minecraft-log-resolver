import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

export const DEFAULT_STORE_READ_BASELINE_TABLES = ["reliableRounds", "ignoredRounds", "byDay"];

export async function readRefreshHistoryFromPath(refreshHistoryPath) {
  try {
    const data = JSON.parse(await readFile(refreshHistoryPath, "utf8"));
    if (!Array.isArray(data)) {
      return {
        items: [],
        warning: refreshHistoryWarning(
          "refresh_history_invalid_schema",
          "Refresh history must be an array and was ignored. Run a refresh to regenerate it.",
        ),
      };
    }
    return {
      items: normalizeRefreshHistory(data),
      warning: null,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [], warning: null };
    if (error instanceof SyntaxError) {
      return {
        items: [],
        warning: refreshHistoryWarning(
          "refresh_history_invalid_json",
          "Refresh history JSON is corrupt and was ignored. Run a refresh to regenerate it.",
        ),
      };
    }
    return {
      items: [],
      warning: refreshHistoryWarning(
        "refresh_history_unreadable",
        "Refresh history could not be read and was ignored.",
        { errorCode: error.code ?? null },
      ),
    };
  }
}

export function summarizeRefreshHistory(items) {
  const summary = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastCancelledAt: null,
    lastErrorCategory: null,
    averageDurationMs: null,
    averagePhaseDurationsMs: {},
  };
  const durationValues = [];
  const phaseValues = {};
  for (const item of items) {
    if (item.status === "succeeded") {
      summary.succeeded += 1;
      summary.lastSucceededAt ??= item.finishedAt ?? null;
    } else if (item.status === "cancelled") {
      summary.cancelled += 1;
      summary.lastCancelledAt ??= item.finishedAt ?? null;
    } else if (item.status === "failed") {
      summary.failed += 1;
      summary.lastFailedAt ??= item.finishedAt ?? null;
      summary.lastErrorCategory ??= item.errorCategory ?? null;
    }
    summary.lastStartedAt ??= item.startedAt ?? null;
    summary.lastFinishedAt ??= item.finishedAt ?? null;
    if (Number.isFinite(item.durationMs)) durationValues.push(item.durationMs);
    for (const [phase, durationMs] of Object.entries(item.phaseDurationsMs ?? {})) {
      if (!Number.isFinite(durationMs)) continue;
      phaseValues[phase] ??= [];
      phaseValues[phase].push(durationMs);
    }
  }
  summary.averageDurationMs = averageFinite(durationValues);
  summary.averagePhaseDurationsMs = Object.fromEntries(
    Object.keys(phaseValues)
      .sort()
      .map((phase) => [phase, averageFinite(phaseValues[phase])]),
  );
  return summary;
}

export function buildRefreshPerformanceBaseline(items, warning = null) {
  const succeeded = items.filter((item) => item.status === "succeeded");
  const latestSucceeded = succeeded[0] ?? null;
  const phaseStats = summarizePhaseDurations(succeeded);
  const bottleneckPhase = Object.values(phaseStats)
    .filter((item) => Number.isFinite(item.averageMs))
    .sort((a, b) => b.averageMs - a.averageMs || a.phase.localeCompare(b.phase))[0] ?? null;
  return {
    sampleSize: succeeded.length,
    latestSucceededAt: latestSucceeded?.finishedAt ?? null,
    latestDurationMs: latestSucceeded?.durationMs ?? null,
    averageDurationMs: averageFinite(succeeded.map((item) => item.durationMs)),
    phaseStats,
    bottleneckPhase,
    notes: succeeded.length
      ? [
          "Averages use successful refresh jobs only.",
          "Use this baseline before considering SQLite or other storage changes.",
          ...(warning ? [`Refresh history warning: ${warning.code}.`] : []),
        ]
      : [
          warning ? `Refresh history warning: ${warning.code}.` : "Run a successful refresh to collect a local performance baseline.",
        ],
  };
}

export async function buildStorePerformanceBaseline({ storeDir, manifestPath, statusStore = {} }) {
  const explicitReady = typeof statusStore.ready === "boolean";
  const output = {
    ready: Boolean(statusStore.ready),
    generatedAt: statusStore.generatedAt ?? null,
    reportGeneratedAt: statusStore.reportGeneratedAt ?? null,
    reportMatchesStore: statusStore.reportMatchesStore ?? null,
    outOfSync: Boolean(statusStore.outOfSync),
    jsonError: statusStore.jsonError ?? null,
    manifestErrorReason: statusStore.manifestErrorReason ?? null,
    fileErrorReason: statusStore.fileErrorReason ?? null,
    missingFiles: statusStore.missingFiles ?? [],
    declaredFiles: 0,
    jsonlTables: 0,
    totalBytes: null,
    totalJsonlRows: null,
    largestFiles: [],
    tables: [],
  };

  const manifestResult = await readStoreManifestBaseline(manifestPath);
  if (manifestResult.warning) {
    if (manifestResult.warning.code === "store_manifest_invalid_json") output.jsonError ??= manifestResult.warning.message;
    if (manifestResult.warning.code === "store_manifest_invalid_schema") output.manifestErrorReason ??= manifestResult.warning.reason;
    return output;
  }

  const manifest = manifestResult.manifest;
  output.generatedAt ??= manifest.generatedAt ?? null;
  output.reportGeneratedAt ??= manifest.reportGeneratedAt ?? null;
  const files = await collectStoreFiles(storeDir, manifest);
  const existingBytes = files.map((file) => file.bytes).filter(Number.isFinite);
  const jsonlRows = files.map((file) => file.rows).filter(Number.isFinite);
  output.declaredFiles = files.length;
  output.jsonlTables = files.filter((file) => file.kind === "jsonl").length;
  output.totalBytes = existingBytes.length ? existingBytes.reduce((total, bytes) => total + bytes, 0) : null;
  output.totalJsonlRows = jsonlRows.length ? jsonlRows.reduce((total, rows) => total + rows, 0) : null;
  output.largestFiles = [...files]
    .filter((file) => Number.isFinite(file.bytes))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, 10);
  output.tables = files
    .filter((file) => file.kind === "jsonl")
    .sort((a, b) => (b.rows ?? -1) - (a.rows ?? -1) || (b.bytes ?? -1) - (a.bytes ?? -1) || a.name.localeCompare(b.name));
  if (!output.fileErrorReason && files.some((file) => !file.exists)) output.fileErrorReason = "missing_files";
  if (!output.missingFiles.length) output.missingFiles = files.filter((file) => !file.exists).map((file) => ({ name: file.name, file: file.file }));
  output.ready = explicitReady
    ? Boolean(output.ready && !output.fileErrorReason)
    : Boolean(!output.jsonError && !output.manifestErrorReason && !output.fileErrorReason);
  return output;
}

export async function buildCachePerformanceBaseline({ cacheFiles }) {
  const entries = {};
  for (const file of cacheFiles) {
    entries[file.name] = await cacheFileStatus(file.name, file.path);
  }
  const files = Object.values(entries);
  const existing = files.filter((file) => file.exists && Number.isFinite(file.bytes));
  return {
    ready: existing.length === files.length,
    files: entries,
    existingFiles: existing.length,
    totalFiles: files.length,
    totalBytes: existing.length ? existing.reduce((total, file) => total + file.bytes, 0) : 0,
    missing: files.filter((file) => !file.exists).map((file) => file.name),
  };
}

export async function measureStoreReadBaseline({
  storeDir,
  manifestPath,
  tables = DEFAULT_STORE_READ_BASELINE_TABLES,
  offset = 0,
  limit = 100,
} = {}) {
  const manifestResult = await readStoreManifestBaseline(manifestPath);
  if (manifestResult.warning) {
    return emptyStoreReadBaseline([manifestResult.warning]);
  }

  const rows = [];
  const warnings = [];
  const manifest = manifestResult.manifest;
  const root = path.resolve(storeDir);
  for (const table of tables) {
    const fileName = manifest.files?.[table];
    if (!fileName || !fileName.endsWith(".jsonl")) {
      warnings.push({ code: "store_table_not_declared", table });
      rows.push(emptyTableRead(table, "not_declared"));
      continue;
    }
    const filePath = path.resolve(root, fileName);
    if (!isSameOrInside(filePath, root)) {
      warnings.push({ code: "store_table_path_invalid", table });
      rows.push(emptyTableRead(table, "invalid_path"));
      continue;
    }

    const started = process.hrtime.bigint();
    try {
      const page = await readJsonlPage(filePath, {
        offset,
        limit,
        stopAfterPage: Number.isFinite(manifest.counts?.[table]),
      });
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      rows.push({
        table,
        ready: true,
        warning: null,
        offset,
        limit,
        returned: page.items.length,
        declaredRows: Number.isFinite(manifest.counts?.[table]) ? manifest.counts[table] : null,
        scannedLines: page.scannedLines,
        durationMs,
      });
    } catch (error) {
      const code = error.code === "ENOENT"
        ? "store_table_not_ready"
        : error instanceof SyntaxError
          ? "store_table_invalid_jsonl"
          : "store_table_unreadable";
      warnings.push({ code, table });
      rows.push(emptyTableRead(table, code));
    }
  }

  const readyRows = rows.filter((row) => row.ready);
  const slowest = [...readyRows].sort((a, b) => b.durationMs - a.durationMs || a.table.localeCompare(b.table))[0] ?? null;
  return {
    sampleSize: readyRows.length,
    tables: rows,
    slowestTable: slowest?.table ?? null,
    slowestReadMs: slowest?.durationMs ?? null,
    averageReadMs: averageFinite(readyRows.map((row) => row.durationMs)),
    averageScannedLines: averageFinite(readyRows.map((row) => row.scannedLines)),
    warnings,
    recommendation: readyRows.length ? "jsonl_store_read_baseline_collected" : "store_not_ready",
  };
}

export function summarizeStoreReadMetrics(items) {
  const byTable = {};
  for (const item of items) {
    byTable[item.table] ??= {
      table: item.table,
      reads: 0,
      averageMs: null,
      maxMs: null,
      averageScannedLines: null,
    };
    const bucket = byTable[item.table];
    bucket.reads += 1;
    bucket._durationMs ??= [];
    bucket._scannedLines ??= [];
    bucket._durationMs.push(item.durationMs);
    bucket._scannedLines.push(item.scannedLines);
  }
  const tables = Object.values(byTable)
    .map((bucket) => {
      const durationValues = bucket._durationMs;
      const scannedValues = bucket._scannedLines;
      delete bucket._durationMs;
      delete bucket._scannedLines;
      return {
        ...bucket,
        averageMs: averageFinite(durationValues),
        maxMs: durationValues.length ? Math.max(...durationValues) : null,
        averageScannedLines: averageFinite(scannedValues),
      };
    })
    .sort((a, b) => b.reads - a.reads || (b.maxMs ?? -1) - (a.maxMs ?? -1) || a.table.localeCompare(b.table));
  const slowest = [...tables].sort((a, b) => (b.maxMs ?? -1) - (a.maxMs ?? -1) || a.table.localeCompare(b.table))[0] ?? null;
  return {
    sampleSize: items.length,
    tables,
    slowestTable: slowest?.table ?? null,
    slowestReadMs: slowest?.maxMs ?? null,
  };
}

export function buildPerformanceRecommendations({
  baseline,
  store,
  storeReads,
  storeReadBaseline,
  cache,
  historyWarning,
  needsRefresh,
  refreshReasons,
}) {
  const recommendations = [];
  if (historyWarning) {
    recommendations.push({
      code: "repair_refresh_history",
      severity: "info",
      message: "Run a refresh to regenerate the derived refresh-history baseline.",
      details: {
        warning: historyWarning.code,
      },
    });
  }
  if (needsRefresh) {
    recommendations.push({
      code: "refresh_needed",
      severity: "info",
      message: "Regenerate derived report and store outputs before judging backend performance.",
      details: {
        reasons: refreshReasons,
      },
    });
  }
  if (!historyWarning && baseline.sampleSize === 0) {
    recommendations.push({
      code: "collect_refresh_baseline",
      severity: "info",
      message: "Run at least one successful refresh to collect local timing baselines.",
      details: {
        sampleSize: baseline.sampleSize,
      },
    });
  }
  if (!store.ready) {
    recommendations.push({
      code: "store_not_ready",
      severity: "info",
      message: "Regenerate the split report store before judging JSONL read performance.",
      details: {
        manifestErrorReason: store.manifestErrorReason ?? null,
        fileErrorReason: store.fileErrorReason ?? null,
      },
    });
  }
  const bottleneck = baseline.bottleneckPhase;
  if (bottleneck && Number.isFinite(bottleneck.averageMs) && bottleneck.averageMs >= 30000) {
    recommendations.push({
      code: "investigate_refresh_bottleneck",
      severity: "notice",
      message: "A refresh phase is slow enough to inspect before changing storage.",
      details: {
        phase: bottleneck.phase,
        averageMs: bottleneck.averageMs,
      },
    });
  }
  const storeBytes = Number.isFinite(store.totalBytes) ? store.totalBytes : 0;
  const storeRows = Number.isFinite(store.totalJsonlRows) ? store.totalJsonlRows : 0;
  const storeSizeNeedsReview = storeBytes >= 250 * 1024 * 1024 || storeRows >= 1_000_000;
  if (storeSizeNeedsReview) {
    recommendations.push({
      code: "review_split_store_limits",
      severity: "notice",
      message: "The split JSONL store is large enough to review table-read latency before considering SQLite.",
      details: {
        totalBytes: store.totalBytes,
        totalJsonlRows: store.totalJsonlRows,
      },
    });
  }
  const recentSlowestReadMs = Number.isFinite(storeReads?.slowestReadMs) ? storeReads.slowestReadMs : null;
  const baselineSlowestReadMs = Number.isFinite(storeReadBaseline?.slowestReadMs) ? storeReadBaseline.slowestReadMs : null;
  const slowestReadMs = Math.max(recentSlowestReadMs ?? 0, baselineSlowestReadMs ?? 0);
  const readLatencyNeedsReview = slowestReadMs >= 1000;
  if (readLatencyNeedsReview) {
    recommendations.push({
      code: "review_store_table_read_latency",
      severity: "notice",
      message: "JSONL store table reads are slow enough to inspect before considering SQLite.",
      details: {
        recentSampleSize: storeReads?.sampleSize ?? 0,
        baselineSampleSize: storeReadBaseline?.sampleSize ?? 0,
        slowestTable: storeReads?.slowestTable ?? storeReadBaseline?.slowestTable ?? null,
        slowestReadMs,
      },
    });
  }
  const missingCaches = cache.totalFiles > 0 && cache.existingFiles < cache.totalFiles;
  if (missingCaches) {
    recommendations.push({
      code: "warm_missing_caches",
      severity: "info",
      message: "Run a refresh to rebuild missing derived cache files.",
      details: {
        existingFiles: cache.existingFiles,
        totalFiles: cache.totalFiles,
        missing: cache.missing,
      },
    });
  }
  const jsonlStoreHealthy = !historyWarning
    && !needsRefresh
    && baseline.sampleSize > 0
    && store.ready
    && !storeSizeNeedsReview
    && !readLatencyNeedsReview
    && !missingCaches;
  if (jsonlStoreHealthy) {
    recommendations.push({
      code: "jsonl_store_ok",
      severity: "info",
      message: "Current split JSONL store size and read latency do not show a need for SQLite.",
      details: {
        sampleSize: baseline.sampleSize,
        totalBytes: store.totalBytes,
        totalJsonlRows: store.totalJsonlRows,
        storeReadBaselineSampleSize: storeReadBaseline?.sampleSize ?? 0,
      },
    });
  }
  return recommendations;
}

export function comparePerformanceBaselines(current, previous, options = {}) {
  const currentOk = isObjectRecord(current);
  const previousOk = isObjectRecord(previous);
  if (!currentOk || !previousOk) {
    return {
      available: false,
      warning: {
        code: previousOk ? "current_baseline_missing" : "previous_baseline_missing",
        message: previousOk ? "Current performance baseline is missing or invalid." : "No previous performance baseline is available for comparison.",
      },
      deltas: {},
      regressions: [],
    };
  }

  const thresholds = {
    refreshDurationRatio: Number.isFinite(options.refreshDurationRatio) ? options.refreshDurationRatio : 1.5,
    storeReadMsRatio: Number.isFinite(options.storeReadMsRatio) ? options.storeReadMsRatio : 2,
    storeBytesRatio: Number.isFinite(options.storeBytesRatio) ? options.storeBytesRatio : 1.5,
    minimumMsDelta: Number.isFinite(options.minimumMsDelta) ? options.minimumMsDelta : 250,
  };
  const deltas = {
    refreshAverageDurationMs: numericDelta(current.baseline?.averageDurationMs, previous.baseline?.averageDurationMs),
    refreshLatestDurationMs: numericDelta(current.baseline?.latestDurationMs, previous.baseline?.latestDurationMs),
    storeTotalBytes: numericDelta(current.store?.totalBytes, previous.store?.totalBytes),
    storeTotalJsonlRows: numericDelta(current.store?.totalJsonlRows, previous.store?.totalJsonlRows),
    storeReadSlowestMs: numericDelta(current.storeReadBaseline?.slowestReadMs, previous.storeReadBaseline?.slowestReadMs),
    storeReadAverageMs: numericDelta(current.storeReadBaseline?.averageReadMs, previous.storeReadBaseline?.averageReadMs),
  };
  const phaseDeltas = {};
  const phases = new Set([
    ...Object.keys(current.baseline?.phaseStats ?? {}),
    ...Object.keys(previous.baseline?.phaseStats ?? {}),
  ]);
  for (const phase of [...phases].sort()) {
    phaseDeltas[phase] = numericDelta(
      current.baseline?.phaseStats?.[phase]?.averageMs,
      previous.baseline?.phaseStats?.[phase]?.averageMs,
    );
  }

  const regressions = [
    regressionIf("refresh_average_duration_regressed", "notice", deltas.refreshAverageDurationMs, thresholds.refreshDurationRatio, thresholds.minimumMsDelta),
    regressionIf("store_read_slowest_regressed", "notice", deltas.storeReadSlowestMs, thresholds.storeReadMsRatio, thresholds.minimumMsDelta),
    regressionIf("store_size_grew", "info", deltas.storeTotalBytes, thresholds.storeBytesRatio, 0),
    ...Object.entries(phaseDeltas)
      .map(([phase, delta]) => regressionIf("refresh_phase_regressed", "notice", delta, thresholds.refreshDurationRatio, thresholds.minimumMsDelta, { phase }))
      .filter(Boolean),
  ].filter(Boolean);

  return {
    available: true,
    warning: null,
    comparedAt: new Date().toISOString(),
    previousGeneratedAt: previous.generatedAt ?? null,
    currentGeneratedAt: current.generatedAt ?? null,
    thresholds,
    deltas,
    phaseDeltas,
    regressions,
    summary: {
      regressed: regressions.length > 0,
      regressionCount: regressions.length,
    },
  };
}

export async function writeJsonIfRequested(outputPath, data) {
  if (!outputPath) return null;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return outputPath;
}

function numericDelta(current, previous) {
  const hasCurrent = Number.isFinite(current);
  const hasPrevious = Number.isFinite(previous);
  const delta = hasCurrent && hasPrevious ? current - previous : null;
  return {
    current: hasCurrent ? current : null,
    previous: hasPrevious ? previous : null,
    delta,
    ratio: hasCurrent && hasPrevious && previous !== 0 ? current / previous : null,
  };
}

function regressionIf(code, severity, delta, ratioThreshold, minimumDelta, extra = {}) {
  if (!delta || !Number.isFinite(delta.current) || !Number.isFinite(delta.previous)) return null;
  const ratioExceeded = Number.isFinite(delta.ratio) && delta.ratio >= ratioThreshold;
  const deltaExceeded = Number.isFinite(delta.delta) && delta.delta >= minimumDelta;
  if (!ratioExceeded || !deltaExceeded) return null;
  return {
    code,
    severity,
    ...extra,
    current: delta.current,
    previous: delta.previous,
    delta: delta.delta,
    ratio: delta.ratio,
  };
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readStoreManifestBaseline(manifestPath) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const validation = validateStoreManifestBaseline(manifest);
    if (!validation.ok) {
      return {
        manifest: null,
        warning: {
          code: "store_manifest_invalid_schema",
          reason: validation.reason,
          message: validation.message,
        },
      };
    }
    return { manifest, warning: null };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        manifest: null,
        warning: {
          code: "store_not_ready",
          message: "Store manifest is missing. Run a refresh or store export first.",
        },
      };
    }
    if (error instanceof SyntaxError) {
      return {
        manifest: null,
        warning: {
          code: "store_manifest_invalid_json",
          message: error.message,
        },
      };
    }
    return {
      manifest: null,
      warning: {
        code: "store_manifest_unreadable",
        message: "Store manifest could not be read.",
        errorCode: error.code ?? null,
      },
    };
  }
}

function validateStoreManifestBaseline(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, reason: "not_object", message: "Store manifest must be an object." };
  }
  if (!manifest.schema || manifest.schema.name !== "minecraft-log-observatory-store") {
    return { ok: false, reason: "invalid_schema", message: "Store manifest has an unsupported schema." };
  }
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    return { ok: false, reason: "missing_files", message: "Store manifest files must be an object." };
  }
  if (!manifest.counts || typeof manifest.counts !== "object" || Array.isArray(manifest.counts)) {
    return { ok: false, reason: "missing_counts", message: "Store manifest counts must be an object." };
  }
  return { ok: true };
}

async function collectStoreFiles(storeDir, manifest) {
  const root = path.resolve(storeDir);
  const files = [];
  for (const [name, fileName] of Object.entries(manifest.files ?? {})) {
    if (!isSafeRelativeFileName(fileName)) continue;
    const filePath = path.resolve(root, fileName);
    if (!isSameOrInside(filePath, root)) continue;
    const file = await checkFile(filePath);
    const jsonl = String(fileName).endsWith(".jsonl");
    files.push({
      name,
      file: fileName,
      kind: jsonl ? "jsonl" : "json",
      exists: Boolean(file.exists && file.type === "file"),
      bytes: file.exists && file.type === "file" ? file.bytes : null,
      rows: jsonl && Number.isFinite(manifest.counts?.[name]) ? manifest.counts[name] : null,
    });
  }
  return files;
}

async function cacheFileStatus(name, filePath) {
  const file = await checkFile(filePath);
  return {
    name,
    exists: Boolean(file.exists && file.type === "file"),
    bytes: file.exists && file.type === "file" ? file.bytes : null,
    modifiedAt: file.modifiedAt ?? null,
  };
}

async function checkFile(filePath) {
  try {
    const info = await stat(filePath);
    return {
      exists: true,
      type: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other",
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, type: null, bytes: null, modifiedAt: null };
    return { exists: false, type: null, bytes: null, modifiedAt: null, errorCode: error.code ?? null };
  }
}

async function readJsonlPage(filePath, options) {
  const items = [];
  let total = 0;
  let scannedLines = 0;
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    scannedLines += 1;
    if (total >= options.offset && items.length < options.limit) {
      items.push(JSON.parse(line));
    }
    total += 1;
    if (options.stopAfterPage && items.length >= options.limit) break;
  }
  return { total, scannedLines, items };
}

function normalizeRefreshHistory(items) {
  return items.map((item) => {
    const filesDone = item.filesDone ?? item.files?.done ?? 0;
    const filesTotal = item.filesTotal ?? item.files?.total ?? 0;
    return {
      ...item,
      status: item.status ?? refreshStatus(item.phase),
      failurePhase: item.failurePhase ?? null,
      percent: item.percent ?? (item.phase === "done" ? 100 : 0),
      filesDone,
      filesTotal,
      files: {
        done: filesDone,
        total: filesTotal,
      },
      durationMs: item.durationMs ?? durationBetweenMs(item.startedAt, item.finishedAt),
      phaseDurationsMs: item.phaseDurationsMs ?? phaseDurationsMs(item.phaseTimings ?? {}),
      cancelRequested: Boolean(item.cancelRequested),
      errorCategory: item.errorCategory ?? classifyRefreshError(item),
      logTail: Array.isArray(item.logTail) ? item.logTail : [],
    };
  });
}

function summarizePhaseDurations(items) {
  const phases = {};
  for (const item of items) {
    for (const [phase, durationMs] of Object.entries(item.phaseDurationsMs ?? {})) {
      if (!Number.isFinite(durationMs)) continue;
      phases[phase] ??= [];
      phases[phase].push(durationMs);
    }
  }
  return Object.fromEntries(
    Object.keys(phases)
      .sort()
      .map((phase) => {
        const values = phases[phase];
        return [phase, {
          phase,
          samples: values.length,
          minMs: Math.min(...values),
          averageMs: averageFinite(values),
          maxMs: Math.max(...values),
        }];
      }),
  );
}

function phaseDurationsMs(phaseTimings) {
  const durations = {};
  for (const [phase, timing] of Object.entries(phaseTimings ?? {})) {
    const duration = durationBetweenMs(timing?.startedAt, timing?.finishedAt);
    if (Number.isFinite(duration)) durations[phase] = duration;
  }
  return durations;
}

function refreshStatus(phase) {
  if (phase === "done") return "succeeded";
  if (phase === "cancelled") return "cancelled";
  if (phase === "failed") return "failed";
  return "running";
}

function classifyRefreshError(item) {
  if (item.errorCategory) return item.errorCategory;
  if (item.cancelRequested || item.phase === "cancelled") return "cancelled";
  if (item.exitCode && item.exitCode !== 0) return "process_exit";
  if (item.error) return "error";
  return null;
}

function durationBetweenMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null;
  return finish - start;
}

function refreshHistoryWarning(code, message, extra = {}) {
  return {
    code,
    message,
    ...extra,
  };
}

function emptyStoreReadBaseline(warnings = []) {
  return {
    sampleSize: 0,
    tables: [],
    slowestTable: null,
    slowestReadMs: null,
    averageReadMs: null,
    averageScannedLines: null,
    warnings,
    recommendation: "store_not_ready",
  };
}

function emptyTableRead(table, warning) {
  return {
    table,
    ready: false,
    warning,
    offset: 0,
    limit: 0,
    returned: 0,
    declaredRows: null,
    scannedLines: 0,
    durationMs: null,
  };
}

function averageFinite(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return Math.round(finite.reduce((total, value) => total + value, 0) / finite.length);
}

function isSafeRelativeFileName(fileName) {
  if (typeof fileName !== "string" || !fileName) return false;
  if (fileName.includes("\0")) return false;
  if (path.isAbsolute(fileName) || path.posix.isAbsolute(fileName) || path.win32.isAbsolute(fileName)) return false;
  const normalized = path.posix.normalize(fileName.replace(/\\/g, "/"));
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}

function isSameOrInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
