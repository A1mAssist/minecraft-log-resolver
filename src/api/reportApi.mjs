import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { TextDecoder } from "node:util";
import path from "node:path";
import {
  loadAppConfig,
  resolveConfigPath,
  resolveDataDir,
  resolveStoreDir,
  writeLocalAppConfig,
} from "../config/appConfig.mjs";
import { listRuleSets, loadCustomRuleSets, parseChatEvent, validateRuleSetDefinition } from "../parser/chatRules.mjs";
import { discoverLogFiles, discoverScopes } from "../parser/discovery.mjs";
import { inferGameModeFromText } from "../parser/gameModes.mjs";
import { readLogLines } from "../parser/reader.mjs";
import { buildBundledRuleManifest, buildCustomRuleManifest } from "../parser/customRuleManifest.mjs";
import {
  backupExistingUserRulePack,
  buildRuleDoctor,
  buildLabelReviewReadiness,
  buildLabelReviewSummary,
  buildRulePackDraftFromLabels,
  buildRulePackInventory,
  labelDecision,
  listRulePackBackups,
  listUserRulePackMetadata,
  restoreRulePackBackup,
  runRulesDryRun,
  VALID_REVIEW_LABELS,
  validateLabelRows,
  validateLabelRowsAgainstReport,
} from "../parser/ruleEcosystem.mjs";
import { runAuditLabelWorkflow } from "../parser/auditWorkflow.mjs";
import { buildDiagnosticsPackageManifest, buildPrivacyAudit } from "../diagnostics/privacyAudit.mjs";
import {
  buildPerformanceRecommendations as buildDiagnosticPerformanceRecommendations,
  buildRefreshPerformanceBaseline,
  comparePerformanceBaselines,
  measureStoreReadBaseline,
  summarizeRefreshHistory as summarizeDiagnosticRefreshHistory,
} from "../diagnostics/performanceBaseline.mjs";
import {
  buildUnknownAudit,
  buildUnknownAuditSummary,
  ensureUnknownAudit,
  ensureUnknownAuditSummary,
  isAllowedUnknownAuditCategory,
  isAllowedUnknownAuditNextAction,
  isAllowedUnknownAuditPriority,
  UNKNOWN_AUDIT_CATEGORIES,
  UNKNOWN_AUDIT_NEXT_ACTIONS,
  UNKNOWN_AUDIT_PRIORITIES,
} from "../report/unknownAudit.mjs";
import { buildMetricDefinitions } from "../report/metricDefinitions.mjs";
import { ensureServerContext } from "../parser/serverContext.mjs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const skinImageMaxBytes = 4 * 1024 * 1024;
const minecraftUserPattern = /^[A-Za-z0-9_]{1,16}$/;
const minecraftUuidPattern = /^[a-f0-9-]{32,36}$/i;
const reservedApiOutputDirs = new Set([".agents", ".codex", ".git", "custom-rules", "docs", "node_modules", "scripts", "src"]);
const reservedApiOutputRootFiles = new Set(["package.json", "package-lock.json"]);
const reportSchemaName = "minecraft-log-observatory-report";
const summarySchemaName = "minecraft-log-observatory-summary";
const storeManifestSchemaName = "minecraft-log-observatory-store";
const defaultProductionCorsOrigin = "http://127.0.0.1:5173";
const privacySafeDiagnosticsForbiddenKeys = ["currentFile", "log", "logTail"];
const requiredStoreFiles = [
  "overview",
  "summary",
  "profile",
  "activity",
  "activitySegments",
  "reliableRounds",
  "ignoredRounds",
  "byDay",
];

export async function createReportApiContext(configPath) {
  const configContext = await loadAppConfig(configPath);
  const context = {
    configPath,
    configContext,
    refreshProcess: null,
    refreshHistoryWrite: null,
    refresh: {
      id: null,
      running: false,
      phase: "idle",
      percent: 0,
      currentFile: null,
      filesDone: 0,
      filesTotal: 0,
      stagingDir: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      cancelRequested: false,
      error: null,
      log: [],
    },
    system: {
      openDirectoryPicker: openWindowsDirectoryPicker,
    },
  };
  context.apiJsonCache = createApiJsonCache();
  setContextPaths(context, configContext);
  return context;
}

export async function handleReportApiRequest(context, request) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  try {
    if (method === "OPTIONS") return jsonResponse(204, null);
    if (url.pathname === "/api/app/status") return await appStatusResponse(context, method);
    if (url.pathname === "/api/system/select-directory") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => selectDirectoryResponse(context, method, body));
    if (url.pathname === "/api/config") return await routeJsonObjectBody(method, ["PUT"], request.body, (body) => configResponse(context, method, body));
    if (url.pathname === "/api/config/validate-roots") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => validateRootsResponse(context, method, body));
    if (url.pathname === "/api/refresh/cancel") return await refreshCancelResponse(context, method);
    if (url.pathname === "/api/refresh/preflight") return await refreshPreflightResponse(context, method);
    if (url.pathname === "/api/data/cleanup") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => cleanupResponse(context, method, body));
    if (url.pathname === "/api/rules/test") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => ruleTestResponse(context, method, body));
    if (url.pathname === "/api/rules/draft") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => ruleDraftResponse(method, body));
    if (url.pathname === "/api/unknown-audit/labels") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => unknownAuditLabelsResponse(context, method, body));
    if (url.pathname === "/api/unknown-audit/status") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => unknownAuditStatusResponse(context, method, body));
    if (url.pathname === "/api/unknown-audit/label-sets") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => unknownAuditLabelSetsResponse(context, method, body));
    if (url.pathname.startsWith("/api/unknown-audit/label-sets/")) return await routeJsonObjectBody(method, ["PUT"], request.body, (body) => unknownAuditLabelSetResponse(context, method, url.pathname, body));
    if (url.pathname === "/api/rules/draft-from-labels") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => ruleDraftFromLabelsResponse(context, method, body));
    if (url.pathname === "/api/rules/validate") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => ruleValidateResponse(method, body));
    if (url.pathname === "/api/rules/dry-run") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => rulesDryRunResponse(context, method, body));
    if (url.pathname === "/api/rules/audit-workflow") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => rulesAuditWorkflowResponse(context, method, body));
    if (url.pathname === "/api/rules/doctor") return await rulesDoctorResponse(context, method);
    if (url.pathname === "/api/rules/audit") return await rulesAuditResponse(context, method);
    if (url.pathname === "/api/rule-packs/user/enable") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => userRulePackEnableResponse(context, method, body));
    if (url.pathname === "/api/rule-packs/user/backups") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => userRulePackBackupsResponse(context, method, body));
    if (url.pathname === "/api/rule-packs/user/restore") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => userRulePackRestoreResponse(context, method, body));
    if (url.pathname === "/api/rule-packs/user") return await routeJsonObjectBody(method, ["POST"], request.body, (body) => userRulePacksResponse(context, method, body));
    if (url.pathname.startsWith("/api/rule-packs/user/")) return await userRulePackResponse(context, method, url.pathname);
    if (url.pathname === "/api/refresh") return await refreshResponse(context, method);
    if (method !== "GET") return errorResponse(405, "method_not_allowed", "Use GET for read-only API endpoints.");
    if (url.pathname === "/api/diagnostics/package") return await diagnosticsPackageResponse(context, url);
    if (url.pathname === "/api/share/package") return await sharePackageResponse(context, url);
    if (url.pathname === "/api/diagnostics") return await diagnosticsResponse(context, url);
    if (url.pathname === "/api/skin") return await skinTextureResponse(context, url);
    if (url.pathname === "/api/minecraft-profile") return await minecraftProfileResponse(context, url);
    if (url.pathname === "/api/health") return await healthResponse(context);
    if (url.pathname === "/api/metrics/definitions") return await metricDefinitionsResponse(context);
    if (url.pathname === "/api/report") return jsonResponse(200, withMetricAliases(await readReport(context)));
    if (url.pathname === "/api/summary") return jsonResponse(200, ensureSummaryApiFields(withMetricAliases(await readSummary(context))));
    if (url.pathname === "/api/profile") return await profileResponse(context);
    if (url.pathname === "/api/activity") return await activityResponse(context, url);
    if (url.pathname === "/api/rounds") return await roundsResponse(context, url);
    if (url.pathname === "/api/modes") return await modesResponse(context);
    if (url.pathname === "/api/results") return await resultsResponse(context);
    if (url.pathname === "/api/result-candidates") return await resultCandidatesResponse(context, url);
    if (url.pathname === "/api/refresh/history") return await refreshHistoryResponse(context);
    if (url.pathname === "/api/performance") return await performanceResponse(context);
    if (url.pathname === "/api/accounts") return await accountsResponse(context);
    if (url.pathname === "/api/accounts/playtime") return await accountsPlaytimeResponse(context, url);
    if (url.pathname.startsWith("/api/accounts/")) return await accountDetailResponse(context, url);
    if (url.pathname === "/api/sources") return await sourcesResponse(context, url);
    if (url.pathname === "/api/scopes") return await scopesResponse(context, url);
    if (url.pathname === "/api/days") return await daysResponse(context, url);
    if (url.pathname === "/api/rules") return await rulesResponse(context);
    if (url.pathname === "/api/rule-packs") return await rulePacksResponse(context);
    if (url.pathname === "/api/rule-packs/validate") return await validateRulePacksResponse(context);
    if (url.pathname === "/api/store") return await storeResponse(context);
    if (url.pathname === "/api/store/table") return await storeTableResponse(context, url);
    if (url.pathname === "/api/timeseries") return await timeSeriesResponse(context, url);
    if (url.pathname === "/api/unmatched") return await unmatchedResponse(context);
    return errorResponse(404, "not_found", "API endpoint was not found.");
  } catch (error) {
    return apiExceptionResponse(context, error);
  }
}

async function routeJsonObjectBody(method, bodyMethods, body, route) {
  if (!bodyMethods.includes(method)) return await route(body);
  const parsed = jsonObjectBodyOrResponse(body);
  if (parsed.response) return parsed.response;
  return await route(parsed.body);
}

function jsonObjectBodyOrResponse(body) {
  const value = body === undefined ? {} : body;
  if (!isObjectRecord(value)) {
    return {
      response: errorResponse(400, "invalid_request_body", "Request body must be a JSON object.", {
        expected: "object",
        received: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      }),
    };
  }
  return {
    body: value,
  };
}

function apiExceptionResponse(context, error) {
  if (error.code === "ENOENT") {
    return errorResponse(503, "report_not_ready", "Run npm run report before starting or querying the API.");
  }
  if (error.code === "REPORT_INVALID_JSON") {
    return errorResponse(503, "report_invalid_json", "Report JSON is corrupt. Refresh to regenerate the report.", {
      reportPath: context.reportPath,
      details: error.details ?? error.message,
    });
  }
  if (error.code === "REPORT_INVALID_SCHEMA") {
    return errorResponse(503, "report_invalid_schema", "Report JSON has an unsupported shape. Refresh to regenerate the report.", {
      reportPath: context.reportPath,
      reason: error.reason,
      details: error.details ?? error.message,
    });
  }
  if (error.code === "SUMMARY_INVALID_JSON") {
    return errorResponse(503, "summary_invalid_json", "Summary JSON is corrupt. Refresh to regenerate the summary.", {
      summaryPath: context.summaryPath,
      details: error.details ?? error.message,
    });
  }
  if (error.code === "SUMMARY_INVALID_SCHEMA") {
    return errorResponse(503, "summary_invalid_schema", "Summary JSON has an unsupported shape. Refresh to regenerate the summary.", {
      summaryPath: context.summaryPath,
      reason: error.reason,
      details: error.details ?? error.message,
    });
  }
  return errorResponse(500, "internal_error", error.message);
}

function setContextPaths(context, configContext) {
  context.configContext = configContext;
  context.reportPath = resolveConfigPath(configContext, configContext.config.outputs.report);
  context.summaryPath = resolveConfigPath(configContext, configContext.config.outputs.summary);
  context.unmatchedPath = resolveConfigPath(configContext, "unmatched-debug.json");
  context.resultCandidatesPath = resolveConfigPath(configContext, "result-candidates.json");
  context.dataDir = resolveDataDir(configContext);
  context.storeDir = resolveStoreDir(configContext);
  context.storeManifestPath = path.join(context.storeDir, "manifest.json");
  context.refreshHistoryPath = resolveConfigPath(configContext, ".cache/refresh-history.json");
  context.ruleAuditPath = path.join(context.dataDir, "rules-audit-history.json");
  context.unknownAuditLabelSetsPath = path.join(context.dataDir, "unknown-audit-label-sets");
  context.storeReadMetricsPath = path.join(context.dataDir, "store-read-metrics.json");
  context.performanceBaselinePath = resolveConfigPath(configContext, "artifacts/performance-baseline-current.json");
  context.userRulePacksPath = resolveConfigPath(configContext, "custom-rules/user");
}

async function reloadContext(context) {
  const configContext = await loadAppConfig(context.configPath);
  setContextPaths(context, configContext);
  clearApiJsonCache(context, "config_reloaded");
}

export async function sendApiResponse(nodeResponse, apiResponse) {
  const body = serializeApiBody(apiResponse.body);
  nodeResponse.writeHead(apiResponse.status, {
    ...responseHeaders(),
    ...apiResponse.headers,
    "Content-Length": body.length,
  });
  nodeResponse.end(body);
}

function responseHeaders() {
  if (!isProductionApiMode()) return jsonHeaders;
  return {
    ...jsonHeaders,
    "Access-Control-Allow-Origin": productionCorsOrigin(),
  };
}

function isProductionApiMode() {
  return process.env.NODE_ENV === "production" || process.env.MLO_API_ENV === "production";
}

function productionCorsOrigin() {
  const configured = process.env.MLO_API_CORS_ORIGIN;
  return isLocalHttpOrigin(configured) ? configured : defaultProductionCorsOrigin;
}

function isLocalHttpOrigin(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function serializeApiBody(body) {
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(JSON.stringify(body, null, 2), "utf8");
}

async function appStatusResponse(context, method) {
  if (method !== "GET") return errorResponse(405, "method_not_allowed", "Use GET for app status.");
  const config = context.configContext.config;
  const reportFile = await checkFile(context.reportPath);
  const summaryFile = await checkFile(context.summaryPath);
  const storeFile = await checkFile(context.storeManifestPath);
  const reportRead = reportFile.exists ? await readJsonForStatus(context, context.reportPath, { kind: "report" }) : { data: null, error: null };
  const summaryRead = summaryFile.exists ? await readJsonForStatus(context, context.summaryPath, { kind: "summary" }) : { data: null, error: null };
  const storeRead = storeFile.exists ? await readJsonForStatus(context, context.storeManifestPath, { kind: "store_manifest" }) : { data: null, error: null };
  const report = reportRead.data;
  const reportValidation = report ? validateReportShape(report) : { ok: false, reason: null, message: null };
  const summaryValidation = summaryRead.data ? validateSummaryShape(summaryRead.data) : { ok: false, reason: null, message: null };
  const store = storeRead.data;
  const storeManifestValidation = store ? validateStoreManifestShape(store) : { ok: false, reason: null, message: null };
  const storeFilesValidation = store ? await validateStoreFilesForStatus(context, store, storeManifestValidation) : { ok: false, reason: null, message: null, files: [] };
  const configSignature = buildConfigSignature(context);
  const reportSignature = report ? buildReportSignature(report) : null;
  const storeReportGeneratedAt = store?.reportGeneratedAt ?? null;
  const reportReady = Boolean(reportFile.exists && summaryFile.exists && report && summaryRead.data && reportValidation.ok && summaryValidation.ok);
  const storeReady = Boolean(storeFile.exists && store && storeManifestValidation.ok && storeFilesValidation.ok);
  const storeOutOfSync = Boolean(reportReady && storeReady && storeReportGeneratedAt !== report?.generatedAt);
  const reportMatchesStore = reportReady && storeReady ? !storeOutOfSync : null;
  const configChanged = Boolean(reportReady && reportSignature !== configSignature);
  const refreshReasons = refreshNeededReasons({
    reportReady,
    storeReady,
    configChanged,
    storeReportGeneratedAt,
    reportGeneratedAt: report?.generatedAt ?? null,
    reportJsonError: reportRead.error,
    summaryJsonError: summaryRead.error,
    reportSchemaError: reportValidation.reason,
    summarySchemaError: summaryValidation.reason,
    storeJsonError: storeRead.error,
    storeManifestError: storeManifestValidation.reason,
    storeFileError: storeFilesValidation.reason,
  });
  const firstRun = config.roots.length === 0;
  const setup = buildSetupStatus({
    firstRun,
    reportReady,
    storeReady,
    configChanged,
    refreshReasons,
    refresh: context.refresh,
  });
  const recovery = buildRecoveryStatus({
    firstRun,
    refreshReasons,
    refresh: context.refresh,
    setup,
    reportValidation,
    summaryValidation,
    storeManifestValidation,
    storeFilesValidation,
  });

  return jsonResponse(200, {
    ok: true,
    firstRun,
    ready: setup.state === "ready" && setup.dataReady,
    needsRefresh: refreshReasons.length > 0,
    refreshReasons,
    setup,
    recovery,
    app: publicAppRuntimeStatus(context),
    project: {
      configPath: context.configContext.path,
      localConfigPath: context.configContext.localPath,
      localConfigExists: context.configContext.localExists,
      dataDir: context.dataDir,
      roots: config.roots,
      rootCount: config.roots.length,
      ownerAliases: config.owner.aliases ?? [],
      customRules: config.customRules ?? [],
    },
    report: {
      ready: reportReady,
      path: context.reportPath,
      summaryPath: context.summaryPath,
      generatedAt: report?.generatedAt ?? null,
      schema: report?.schema ?? null,
      jsonError: reportRead.error,
      summaryJsonError: summaryRead.error,
      schemaError: reportValidation.message,
      schemaErrorReason: reportValidation.reason,
      summarySchemaError: summaryValidation.message,
      summarySchemaErrorReason: summaryValidation.reason,
    },
    store: {
      ready: storeReady,
      manifestPath: context.storeManifestPath,
      generatedAt: store?.generatedAt ?? null,
      reportGeneratedAt: storeReportGeneratedAt,
      reportMatchesStore,
      outOfSync: storeOutOfSync,
      jsonError: storeRead.error,
      manifestError: storeManifestValidation.message,
      manifestErrorReason: storeManifestValidation.reason,
      fileError: storeFilesValidation.message,
      fileErrorReason: storeFilesValidation.reason,
      missingFiles: storeFilesValidation.files,
    },
    refresh: publicRefresh(context.refresh),
  });
}

async function configResponse(context, method, body = {}) {
  if (method === "GET") {
    return jsonResponse(200, {
      effective: publicConfig(context.configContext.config),
      paths: {
        configPath: context.configContext.path,
        localConfigPath: context.configContext.localPath,
        localConfigExists: context.configContext.localExists,
        dataDir: context.dataDir,
        storeDir: context.storeDir,
      },
      writable: {
        target: "localConfig",
        fields: ["roots", "owner.aliases", "owner.displayName", "customRules", "app.dataDir", "app.skinProxyEnabled", "outputs.report", "outputs.summary"],
      },
    });
  }
  if (method !== "PUT") return errorResponse(405, "method_not_allowed", "Use GET or PUT for local config.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot update local config while a refresh job is running.");

  const sanitized = await sanitizeLocalConfigPatch(context, body);
  if (sanitized.errors.length) {
    return errorResponse(400, "invalid_config", "Local config contains unsupported or invalid values.", { errors: sanitized.errors });
  }

  const localConfigSafety = validateLocalConfigWriteTarget(context);
  if (!localConfigSafety.ok) {
    return errorResponse(400, "unsafe_local_config_path", "The configured local overlay path is not writable by the local API policy.", {
      reason: localConfigSafety.reason,
      localConfigPath: context.configContext.localPath,
    });
  }

  await writeLocalAppConfig(context.configContext, sanitized.config);
  await reloadContext(context);
  await ensureProductDirectories(context);
  return jsonResponse(200, {
    ok: true,
    localConfigPath: context.configContext.localPath,
    effective: publicConfig(context.configContext.config),
  });
}

async function selectDirectoryResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to open the local directory picker.");
  if ("validate" in body && typeof body.validate !== "boolean") {
    return errorResponse(400, "invalid_select_directory_request", "validate must be true or false when provided.", {
      errors: [{ field: "validate", error: "expected_boolean" }],
    });
  }
  if ("encoding" in body && (typeof body.encoding !== "string" || !body.encoding.trim())) {
    return errorResponse(400, "invalid_select_directory_request", "encoding must be a non-empty string when provided.", {
      errors: [{ field: "encoding", error: "expected_non_empty_string" }],
    });
  }
  let encoding = context.configContext.config.encoding;
  if ("encoding" in body) {
    const requestedEncoding = body.encoding.trim();
    if (!isSupportedTextEncoding(requestedEncoding)) {
      return errorResponse(400, "invalid_select_directory_request", "encoding is not supported.", {
        errors: [{ field: "encoding", error: "unsupported_encoding" }],
      });
    }
    encoding = requestedEncoding;
  }
  if (process.platform !== "win32") {
    return errorResponse(501, "directory_picker_unsupported", "The local directory picker is only available on Windows desktop.");
  }

  try {
    const selectedPath = await context.system.openDirectoryPicker();
    if (!selectedPath) {
      return jsonResponse(200, {
        ok: false,
        cancelled: true,
      });
    }
    const response = {
      ok: true,
      path: selectedPath,
    };
    if (body.validate === true) {
      response.validation = await validateLogRoots(context, [selectedPath], { encoding });
    }
    return jsonResponse(200, {
      ...response,
    });
  } catch (error) {
    return errorResponse(500, "directory_picker_failed", error.message || "The local directory picker failed.");
  }
}

function openWindowsDirectoryPicker() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select your .minecraft folder or a launcher root that contains logs'",
    "$dialog.ShowNewFolderButton = $false",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Write-Output $dialog.SelectedPath }",
  ].join("; ");

  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: false,
      timeout: 120000,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          resolve("");
          return;
        }
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function ensureProductDirectories(context) {
  await mkdir(context.dataDir, { recursive: true });
  if ((context.configContext.config.customRules ?? []).some(isUserRulePackPath)) {
    await mkdir(context.userRulePacksPath, { recursive: true });
  }
}

function isUserRulePackPath(value) {
  return path.normalize(value).replaceAll("\\", "/") === "custom-rules/user";
}

async function validateRootsResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to validate roots.");
  const errors = [];
  let encoding = context.configContext.config.encoding;
  if (!("roots" in body)) {
    errors.push({ field: "roots", error: "required" });
  } else if (!Array.isArray(body.roots) || !body.roots.every((value) => typeof value === "string")) {
    errors.push({ field: "roots", error: "expected_string_array" });
  }
  if ("encoding" in body && (typeof body.encoding !== "string" || !body.encoding.trim())) {
    errors.push({ field: "encoding", error: "expected_non_empty_string" });
  } else if ("encoding" in body) {
    const requestedEncoding = body.encoding.trim();
    if (!isSupportedTextEncoding(requestedEncoding)) {
      errors.push({ field: "encoding", error: "unsupported_encoding" });
    } else {
      encoding = requestedEncoding;
    }
  }
  if (errors.length) {
    return errorResponse(400, "invalid_validate_roots_request", "Root validation request is invalid.", { errors });
  }
  const result = await validateLogRoots(context, body.roots, { encoding });
  return jsonResponse(result.ok ? 200 : 400, result);
}

async function buildRefreshPreflight(context) {
  const startedAt = new Date().toISOString();
  const appStatus = (await appStatusResponse(context, "GET")).body;
  const rootValidation = await validateLogRoots(context, context.configContext.config.roots, {
    encoding: context.configContext.config.encoding,
  });
  let ruleDoctor;
  try {
    ruleDoctor = await buildRuleDoctor(context);
  } catch (error) {
    ruleDoctor = {
      ok: false,
      inventory: null,
      issues: [preflightIssue("invalid_rule_pack_config", "Configured custom rule packs could not be loaded.", {
        details: error.message,
        errorCode: error.code ?? null,
        severity: "error",
      })],
    };
  }
  const writeTargetValidation = validateRefreshWriteTargets(context);
  const blocking = [];
  const warnings = [];

  if (context.refresh.running) {
    blocking.push(preflightIssue("refresh_running", "Refresh is already running.", { refreshId: context.refresh.id }));
  }
  if (!context.configContext.config.roots.length) {
    blocking.push(preflightIssue("no_roots", "Configure at least one Minecraft log root before refreshing."));
  }
  if (!rootValidation.ok) {
    blocking.push(preflightIssue("invalid_roots", "One or more configured Minecraft log roots are not refreshable.", {
      roots: rootValidation.roots.filter((root) => !root.valid),
    }));
  }
  if (!ruleDoctor.ok) {
    blocking.push(preflightIssue("rule_doctor_errors", "Rule doctor found blocking rule-pack errors.", {
      issues: ruleDoctor.issues.filter((issue) => issue.severity === "error"),
    }));
  }
  if (!writeTargetValidation.ok) {
    blocking.push(preflightIssue("unsafe_refresh_outputs", "Refresh output targets are not safe writable derived-data paths.", {
      errors: writeTargetValidation.errors,
    }));
  }
  if (appStatus.needsRefresh) {
    warnings.push(preflightIssue("refresh_needed", "Current derived data needs refresh.", {
      reasons: appStatus.refreshReasons ?? [],
    }));
  }
  for (const issue of ruleDoctor.issues.filter((item) => item.severity !== "error")) {
    warnings.push(preflightIssue(`rule_${issue.code}`, issue.message, {
      rulePackId: issue.rulePackId,
      severity: issue.severity,
    }));
  }

  const canRefresh = blocking.length === 0;
  return {
    ok: canRefresh,
    canRefresh,
    generatedAt: startedAt,
    checked: {
      roots: rootValidation.total,
      logFiles: rootValidation.logFiles,
      rules: {
        ok: ruleDoctor.ok,
        issues: ruleDoctor.issues.length,
        inventory: ruleDoctor.inventory,
      },
      writeTargets: {
        ok: writeTargetValidation.ok,
      },
      appStatus: {
        setupState: appStatus.setup?.state ?? null,
        ready: Boolean(appStatus.ready),
        needsRefresh: Boolean(appStatus.needsRefresh),
        refreshReasons: appStatus.refreshReasons ?? [],
      },
    },
    blocking,
    warnings,
    recommendedAction: canRefresh ? "run_refresh" : "fix_blocking_issues",
  };
}

function preflightIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

async function diagnosticsResponse(context, url) {
  const fullQuery = readBooleanQuery(url, "full", false);
  if (fullQuery.response) return fullQuery.response;
  const full = fullQuery.value;
  const appStatus = (await appStatusResponse(context, "GET")).body;
  const config = context.configContext.config;
  const roots = await validateLogRoots(context, config.roots, { encoding: config.encoding, redact: !full });
  const report = await checkJsonFile(context.reportPath);
  const summary = await checkJsonFile(context.summaryPath);
  const store = await checkJsonFile(context.storeManifestPath);
  const cache = {
    parse: await checkFile(resolveConfigPath(context.configContext, config.cache.parse)),
    chat: await checkFile(resolveConfigPath(context.configContext, config.cache.chat)),
    chatLines: await checkFile(resolveConfigPath(context.configContext, config.cache.chatLines)),
  };
  const dataDir = await checkFile(context.dataDir);
  const diagnostic = {
    ok: true,
    privacy: full ? "full-local" : "privacy-safe",
    generatedAt: new Date().toISOString(),
    node: {
      version: process.version,
    },
    config: {
      path: full ? context.configContext.path : redactPath(context.configContext.path),
      localPath: full ? context.configContext.localPath : redactPath(context.configContext.localPath),
      localExists: context.configContext.localExists,
      encoding: config.encoding,
      rootCount: config.roots.length,
      roots,
      app: {
        dataDir: full ? context.dataDir : redactPath(context.dataDir),
        skinProxyEnabled: config.app?.skinProxyEnabled !== false,
      },
    },
    outputs: {
      report: diagnosticReportOutput(report, appStatus.report, { full }),
      summary: diagnosticSummaryOutput(summary, appStatus.report, { full }),
      store: diagnosticStoreOutput(store, appStatus.store, { full }),
      dataDir: full ? dataDir : redactFileCheck(dataDir),
    },
    cache: full ? cache : Object.fromEntries(Object.entries(cache).map(([key, value]) => [key, redactFileCheck(value)])),
    setup: appStatus.setup,
    needsRefresh: appStatus.needsRefresh,
    refreshReasons: appStatus.refreshReasons,
    refresh: full ? publicRefresh(context.refresh) : privacySafeRefresh(context.refresh),
  };
  diagnostic.ready = appStatus.ready;
  if (!full) {
    diagnostic.privacyAudit = buildPrivacyAudit(diagnostic, {
      knownSensitiveValues: diagnosticsSensitiveValues(context),
      forbiddenKeys: privacySafeDiagnosticsForbiddenKeys,
    });
    if (!diagnostic.privacyAudit.safe) return privacyAuditFailureResponse(diagnostic.privacyAudit);
  }
  return jsonResponse(200, diagnostic);
}

function isSupportedTextEncoding(encoding) {
  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

async function diagnosticsPackageResponse(context, url) {
  const fullQuery = readBooleanQuery(url, "full", false);
  if (fullQuery.response) return fullQuery.response;
  const full = fullQuery.value;
  const diagnosticsResult = await diagnosticsResponse(context, new URL(`/api/diagnostics?full=${full}`, "http://127.0.0.1"));
  if (!full && diagnosticsResult.status >= 400) return diagnosticsResult;
  const diagnostics = diagnosticsResult.body;
  const appStatus = (await appStatusResponse(context, "GET")).body;
  const refreshHistoryBody = (await refreshHistoryResponse(context)).body;
  const refreshHistory = full ? refreshHistoryBody : privacySafeRefreshHistoryResponse(refreshHistoryBody);
  const performance = (await performanceResponse(context)).body;
  const rulePackValidation = (await validateRulePacksResponse(context)).body;
  const userRulePacks = (await listUserRulePacksResponse(context)).body;
  const ruleAudit = (await rulesAuditResponse(context, "GET")).body;
  const sources = [
    "/api/app/status",
    "/api/diagnostics",
    "/api/refresh/history",
    "/api/performance",
    "/api/rule-packs/validate",
    "/api/rule-packs/user",
    "/api/rules/audit",
  ];
  const rawPackage = {
    schema: {
      name: "minecraft-log-observatory-diagnostics-package",
      version: 1,
    },
    generatedAt: new Date().toISOString(),
    privacy: full ? "full-local" : "privacy-safe",
    manifest: buildDiagnosticsPackageManifest({
      kind: "api-diagnostics-package",
      privacy: full ? "full-local" : "privacy-safe",
      sources,
      contents: [
        { key: "appStatus", description: "First-run state, current project config paths, report/store readiness, and refresh status." },
        { key: "diagnostics", description: "Root validation, output/cache file checks, runtime node version, and current refresh state." },
        { key: "refreshHistory", description: "Recent refresh outcomes with phase, duration, and failure category." },
        { key: "performance", description: "Refresh timing baseline, split-store size/row metadata, and derived cache file status." },
        { key: "rulePacks.configuredValidation", description: "Validation result for configured bundled/custom rule packs." },
        { key: "rulePacks.user", description: "Metadata and validation errors for project-managed user rule packs." },
        { key: "rulePacks.audit", description: "Recent privacy-safe rule lifecycle actions." },
      ],
    }),
    containsRawLogs: false,
    containsRawChat: false,
    sources,
    appStatus,
    diagnostics,
    refreshHistory,
    performance,
    rulePacks: {
      configuredValidation: rulePackValidation,
      user: userRulePacks,
      audit: ruleAudit,
    },
    notes: [
      "This package is intended for troubleshooting backend setup and refresh issues.",
      "It does not include raw Minecraft logs, chat lines, full reports, or split report-store rows.",
      full ? "Full-local mode may include local filesystem paths." : "Privacy-safe mode redacts local paths and configured owner aliases.",
    ],
  };
  if (full) {
    rawPackage.privacyAudit = buildPrivacyAudit(rawPackage, { full: true });
    return jsonResponse(200, rawPackage);
  }
  const safePackage = sanitizeDiagnosticsPackage(rawPackage);
  safePackage.privacyAudit = buildPrivacyAudit(safePackage, {
    knownSensitiveValues: diagnosticsSensitiveValues(context),
    forbiddenKeys: privacySafeDiagnosticsForbiddenKeys,
  });
  if (!safePackage.privacyAudit.safe) return privacyAuditFailureResponse(safePackage.privacyAudit);
  return jsonResponse(200, safePackage);
}

async function sharePackageResponse(context, url) {
  const report = await readReport(context);
  const identitiesQuery = readBooleanQuery(url, "identities", true);
  if (identitiesQuery.response) return identitiesQuery.response;
  const includeIdentityLeaderboard = identitiesQuery.value;
  const sharePackage = buildSharePackage(report, { includeIdentityLeaderboard });
  sharePackage.privacyAudit = buildPrivacyAudit(sharePackage, {
    knownSensitiveValues: diagnosticsSensitiveValues(context),
    forbiddenKeys: privacySafeDiagnosticsForbiddenKeys,
  });
  if (!sharePackage.privacyAudit.safe) return privacyAuditFailureResponse(sharePackage.privacyAudit);
  return jsonResponse(200, sharePackage);
}

function privacyAuditFailureResponse(privacyAudit) {
  return errorResponse(500, "privacy_audit_failed", "Privacy-safe package generation failed audit; package content was not returned.", {
    privacyAudit,
  });
}

function refreshRunningWriteResponse(context, message) {
  return errorResponse(409, "refresh_running", message, { refresh: publicRefresh(context.refresh) });
}

function buildSharePackage(report, options = {}) {
  const normalizedReport = withMetricAliases(report);
  const modes = Object.values(normalizedReport.rounds?.summary?.gameModes ?? {})
    .map((mode) => pickFields(mode, ["id", "label", "rounds", "durationSeconds", "duration", "bedDestroys", "selfBedDestroys", "playerBedDestroys", "wins", "losses", "unknownResults", "winRate"]))
    .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
  const activityModes = Object.values(normalizedReport.activity?.summary?.gameModes ?? {})
    .map((mode) => pickFields(mode, ["id", "label", "segments", "durationSeconds", "duration", "kills", "deaths", "selfKills", "selfDeaths", "maxStreak", "observedBroadcastMaxKillStreak", "playerMaxKillStreak", "streakPoints", "rewardEvents", "goldEarned", "xpEarned", "bountyClaims", "bountyGoldEarned", "megastreaks"]))
    .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0));
  const identities = options.includeIdentityLeaderboard
    ? anonymizeIdentityRows(normalizedReport.profile?.identities?.topByPlaytime ?? normalizedReport.profile?.identities?.items ?? [])
    : [];

  return {
    schema: {
      name: "minecraft-log-observatory-share-package",
      version: 1,
    },
    generatedAt: new Date().toISOString(),
    reportGeneratedAt: normalizedReport.generatedAt,
    privacy: "share-safe",
    manifest: buildDiagnosticsPackageManifest({
      kind: "share-package",
      privacy: "share-safe",
      sources: ["/api/share/package"],
      contents: [
        { key: "player", description: "Anonymous local-player aggregate metadata." },
        { key: "overview", description: "Aggregate playtime, round, combat, result, and crash totals." },
        { key: "results", description: "Aggregate result coverage and win/loss rates." },
        { key: "activity", description: "Aggregate continuous-mode activity totals." },
        { key: "profile", description: "Share-safe profile highlights with source/user/path fields removed." },
        { key: "modes", description: "Game-mode aggregate rows." },
        { key: "activityModes", description: "Continuous activity-mode aggregate rows." },
        { key: "identities", description: "Optional anonymized identity leaderboard rows." },
      ],
    }),
    containsRawLogs: false,
    containsRawChat: false,
    containsLocalPaths: false,
    containsLocalUserNames: false,
    anonymizedIdentities: true,
    player: {
      label: "Player",
      localUserCount: normalizedReport.accounts?.owner?.localUserCount ?? normalizedReport.profile?.totals?.localUserCount ?? 0,
      aliasCount: normalizedReport.accounts?.aliases?.length ?? 0,
    },
    overview: pickFields(normalizedReport.overview ?? {}, [
      "sessions",
      "runtimeSeconds",
      "runtime",
      "playtimeSeconds",
      "playtime",
      "multiplayerSeconds",
      "multiplayer",
      "singleplayerSeconds",
      "singleplayer",
      "reliableRounds",
      "roundDurationSeconds",
      "roundDuration",
      "kills",
      "deaths",
      "bedDestroys",
      "selfKills",
      "selfDeaths",
      "selfBedDestroys",
      "playerBedDestroys",
      "playerMaxKillStreak",
      "activityGoldEarned",
      "activityXpEarned",
      "activityBountyClaims",
      "activityBountyGoldEarned",
      "pitGoldEarned",
      "pitXpEarned",
      "pitBountyClaims",
      "pitBountyGoldEarned",
      "bestWinStreak",
      "currentWinStreak",
      "wins",
      "losses",
      "unknownResults",
      "ambiguousResults",
      "winRate",
      "knownResultRate",
      "crashes",
    ]),
    results: pickFields(normalizedReport.results?.summary ?? {}, [
      "rounds",
      "reliableRounds",
      "knownRoundResults",
      "unknownRoundResults",
      "ambiguousRoundResults",
      "wins",
      "losses",
      "winRate",
      "knownResultRate",
    ]),
    activity: pickFields(normalizedReport.activity?.summary ?? {}, [
      "segments",
      "durationSeconds",
      "duration",
      "kills",
      "deaths",
      "selfKills",
      "selfDeaths",
      "maxStreak",
      "observedBroadcastMaxKillStreak",
      "playerMaxKillStreak",
      "streakPoints",
      "rewardEvents",
      "goldEarned",
      "xpEarned",
      "bountyClaims",
      "bountyGoldEarned",
      "megastreaks",
    ]),
    profile: {
      totals: pickFields(normalizedReport.profile?.totals ?? {}, [
        "firstPlayedAt",
        "lastPlayedAt",
        "localUserCount",
        "clientStarts",
        "serverConnects",
        "clientSessions",
        "playSegments",
        "crashes",
        "reliableRounds",
        "bedDestroys",
        "selfBedDestroys",
        "playerBedDestroys",
        "playerMaxKillStreak",
        "activityGoldEarned",
        "activityXpEarned",
        "activityBountyClaims",
        "activityBountyGoldEarned",
        "pitGoldEarned",
        "pitXpEarned",
        "pitBountyClaims",
        "pitBountyGoldEarned",
        "bestWinStreak",
        "currentWinStreak",
        "knownResults",
        "wins",
        "losses",
        "unknownResults",
        "winRate",
      ]),
      streaks: {
        win: sanitizeShareWinStreaks(normalizedReport.profile?.streaks?.win ?? normalizedReport.overview?.winStreaks ?? null),
        playerMaxKillStreak: normalizedReport.profile?.streaks?.playerMaxKillStreak ?? {
          count: normalizedReport.profile?.totals?.playerMaxKillStreak ?? normalizedReport.overview?.playerMaxKillStreak ?? 0,
        },
      },
      days: pickNestedSummaries(normalizedReport.profile?.days ?? {}, ["longestPlaytime", "longestMultiplayerPlaytime", "longestSingleplayerPlaytime", "mostRounds", "latestPlayed", "longestStreak"]),
      preferences: {
        gameModeByRounds: normalizedReport.profile?.preferences?.gameModeByRounds ?? null,
        gameModeByDuration: normalizedReport.profile?.preferences?.gameModeByDuration ?? null,
        activityModeByDuration: normalizedReport.profile?.preferences?.activityModeByDuration ?? null,
      },
      extremes: pickNestedSummaries(normalizedReport.profile?.extremes ?? {}, ["longestSession", "shortestSession", "longestPlaySegment", "shortestPlaySegment", "longestMatch", "shortestMatch"]),
    },
    modes,
    activityModes,
    identities,
  };
}

function sanitizeShareWinStreaks(streaks) {
  if (!streaks || typeof streaks !== "object") return null;
  return {
    breakUnknown: sanitizeShareWinStreakPolicy(streaks.breakUnknown ?? streaks.break_unknown),
    skipUnknown: sanitizeShareWinStreakPolicy(streaks.skipUnknown ?? streaks.skip_unknown),
    break_unknown: sanitizeShareWinStreakPolicy(streaks.break_unknown ?? streaks.breakUnknown),
    skip_unknown: sanitizeShareWinStreakPolicy(streaks.skip_unknown ?? streaks.skipUnknown),
  };
}

function sanitizeShareWinStreakPolicy(policy) {
  if (!policy || typeof policy !== "object") return null;
  return {
    policy: policy.policy ?? null,
    best: { count: policy.best?.count ?? 0 },
    current: { count: policy.current?.count ?? 0 },
  };
}

function pickFields(source, fields) {
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]));
}

function pickNestedSummaries(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, sanitizeShareNestedSummary(source[field])]));
}

const shareNestedBlockedKeys = new Set([
  "key",
  "startkey",
  "endkey",
  "sourcekey",
  "scopekey",
  "source",
  "scope",
  "sources",
  "scopes",
  "filepath",
  "startfile",
  "localuser",
  "user",
  "sessionalias",
  "launcheruser",
  "launcherusers",
  "serverplayerid",
  "serverplayerids",
  "serverplayeridsource",
  "serverplayeridconfidence",
  "serveridentitycontext",
  "serverplayeridpolicy",
  "owneraliasesused",
  "propagatedserverplayerids",
  "identitypropagation",
  "uuid",
  "uuids",
  "minecraftuuid",
  "minecraftuuids",
  "playeruuid",
  "playeruuids",
]);

function sanitizeShareNestedSummary(value) {
  if (!value || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(sanitizeShareNestedSummary);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isBlockedShareNestedKey(key))
      .map(([key, item]) => [key, sanitizeShareNestedSummary(item)]),
  );
}

function isBlockedShareNestedKey(key) {
  return shareNestedBlockedKeys.has(String(key).toLowerCase());
}

function anonymizeIdentityRows(rows) {
  return rows.slice(0, 10).map((row, index) => ({
    id: `identity-${index + 1}`,
    label: `Identity ${index + 1}`,
    playtimeSeconds: row.playtimeSeconds ?? 0,
    playtime: row.playtime ?? "0s",
    sessions: row.sessions ?? 0,
    playSegments: row.playSegments ?? 0,
    reliableRounds: row.rounds?.reliable ?? 0,
    wins: row.rounds?.wins ?? 0,
    losses: row.rounds?.losses ?? 0,
    unknownResults: row.rounds?.unknownResults ?? 0,
    kills: row.rounds?.kills ?? 0,
    deaths: row.rounds?.deaths ?? 0,
    bedDestroys: row.rounds?.bedDestroys ?? 0,
    selfBedDestroys: row.rounds?.selfBedDestroys ?? 0,
    playerBedDestroys: row.rounds?.playerBedDestroys ?? row.rounds?.selfBedDestroys ?? 0,
    winRate: row.rounds?.winRate ?? 0,
  }));
}

async function cleanupResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to clean derived data.");
  if ("scope" in body && typeof body.scope !== "string") {
    return errorResponse(400, "invalid_cleanup_scope", "Cleanup scope must be cache, report, store, or all_derived.", {
      allowed: ["cache", "report", "store", "all_derived"],
    });
  }
  const scope = body.scope ?? "cache";
  const dryRun = body.dryRun ?? false;
  const allowedScopes = ["cache", "report", "store", "all_derived"];
  if (!allowedScopes.includes(scope)) {
    return errorResponse(400, "invalid_cleanup_scope", "Cleanup scope must be cache, report, store, or all_derived.", { allowed: allowedScopes });
  }
  if (typeof dryRun !== "boolean") {
    return errorResponse(400, "invalid_cleanup_dry_run", "cleanup dryRun must be a boolean when provided.");
  }
  if (context.refresh.running) {
    return refreshRunningWriteResponse(context, "Cannot clean derived data while a refresh job is running.");
  }

  const targets = cleanupTargets(context, scope);
  const planned = [];
  const skipped = [];
  for (const target of targets) {
    const safety = validateDerivedTarget(context, target.path);
    if (!safety.ok) {
      skipped.push({ kind: target.kind, path: target.path, reason: safety.reason });
      continue;
    }
    try {
      const file = await checkFile(target.path);
      planned.push({
        ...target,
        exists: Boolean(file.exists),
        type: file.type ?? null,
        bytes: file.exists && file.type === "file" ? file.bytes : null,
      });
    } catch (error) {
      skipped.push({ kind: target.kind, path: target.path, reason: error.message });
    }
  }
  if (dryRun) {
    return jsonResponse(200, {
      ok: true,
      scope,
      dryRun: true,
      planned,
      skipped,
      note: "Dry run only; no derived report/cache/store/history files were removed.",
    });
  }

  const removed = [];
  for (const target of planned) {
    try {
      await rm(target.path, { recursive: true, force: true });
      removed.push(target);
    } catch (error) {
      skipped.push({ kind: target.kind, path: target.path, reason: error.message });
    }
  }
  clearApiJsonCache(context, "cleanup");
  return jsonResponse(200, {
    ok: true,
    scope,
    dryRun: false,
    planned,
    removed,
    skipped,
    note: "Only derived report/cache/store/history files are eligible for cleanup; configured Minecraft roots are never deleted.",
  });
}

async function healthResponse(context) {
  const report = await readReport(context);
  return jsonResponse(200, {
    ok: true,
    schema: report.schema,
    generatedAt: report.generatedAt,
    reportPath: context.reportPath,
    summaryPath: context.summaryPath,
    overview: {
      files: report.overview.files,
      scopes: report.overview.scopes,
      reliableRounds: report.overview.reliableRounds,
      chatCache: report.rules.cache,
    },
  });
}

async function metricDefinitionsResponse(context) {
  const appStatus = (await appStatusResponse(context, "GET")).body;
  return jsonResponse(200, {
    generatedAt: new Date().toISOString(),
    source: "static_backend_contract",
    reportReady: Boolean(appStatus.report?.ready),
    metricDefinitions: buildMetricDefinitions(),
  });
}

async function skinTextureResponse(context, url) {
  // The skin proxy may contact Mojang or a remote HTTPS texture URL. Keep it explicit for offline/privacy-first builds.
  if (context.configContext.config.app?.skinProxyEnabled === false) {
    return errorResponse(403, "skin_proxy_disabled", "Remote skin proxy is disabled in local config.");
  }
  const kind = url.searchParams.get("kind") ?? "auto";
  const source = url.searchParams.get("source")?.trim() ?? "";
  if (!source) {
    return errorResponse(400, "missing_skin_source", "Provide source as a Minecraft name, UUID, or HTTPS skin PNG URL.");
  }

  try {
    const resolved = await resolveSkinTextureSource(source, kind);
    const skinResponse = await fetch(resolved.url, {
      headers: {
        "Accept": "image/png,image/*;q=0.8,*/*;q=0.5",
        "User-Agent": "Minecraft Log Resolver/0.1",
      },
    });

    if (!skinResponse.ok) {
      return errorResponse(skinResponse.status === 404 ? 404 : 502, "skin_texture_unavailable", `Skin texture request failed with ${skinResponse.status}.`, { kind: resolved.kind });
    }

    const contentType = skinResponse.headers.get("content-type") ?? "image/png";
    const buffer = Buffer.from(await skinResponse.arrayBuffer());
    if (buffer.length > skinImageMaxBytes) {
      return errorResponse(413, "skin_texture_too_large", "Skin texture exceeds the local preview size limit.");
    }

    return binaryResponse(200, buffer, {
      "Content-Type": contentType.includes("image/") ? contentType : "image/png",
      "Cache-Control": "public, max-age=300",
      "X-Skin-Source-Kind": resolved.kind,
    });
  } catch (error) {
    return errorResponse(error.status ?? 400, error.code ?? "invalid_skin_source", error.message);
  }
}

async function minecraftProfileResponse(context, url) {
  if (context.configContext.config.app?.skinProxyEnabled === false) {
    return errorResponse(403, "minecraft_profile_disabled", "Remote Minecraft profile lookup is disabled in local config.");
  }

  const username = url.searchParams.get("username")?.trim() ?? "";
  if (!username) {
    return errorResponse(400, "missing_minecraft_username", "Provide username as a Minecraft player name.");
  }
  if (!minecraftUserPattern.test(username)) {
    return errorResponse(400, "invalid_minecraft_username", "Minecraft player names must be 1-16 letters, numbers, or underscores.");
  }

  try {
    const profile = await lookupMinecraftProfileByName(username);
    const texture = await resolveMojangSkinTexture(profile.id);
    return jsonResponse(200, {
      ok: true,
      requestedUsername: username,
      name: profile.name,
      id: profile.id,
      uuid: profile.id,
      skinUrl: texture.skinUrl,
      capeUrl: texture.capeUrl,
      model: texture.model,
      textureTimestamp: texture.timestamp,
      source: {
        profile: "api.minecraftservices.com",
        textures: "sessionserver.mojang.com",
        skin: "textures.minecraft.net",
      },
    }, {
      "Cache-Control": "public, max-age=300",
    });
  } catch (error) {
    return errorResponse(error.status ?? 502, error.code ?? "minecraft_profile_unavailable", error.message);
  }
}

async function resolveSkinTextureSource(source, kind) {
  const normalizedKind = kind.toLowerCase();
  if (!["auto", "player", "uuid", "url"].includes(normalizedKind)) {
    throw apiError(400, "invalid_skin_kind", "Skin source kind must be auto, player, uuid, or url.");
  }

  if (normalizedKind === "url" || (normalizedKind === "auto" && looksLikeUrl(source))) {
    return { kind: "url", url: validateSkinImageUrl(source) };
  }

  if (normalizedKind === "uuid" || (normalizedKind === "auto" && minecraftUuidPattern.test(source))) {
    return { kind: "uuid", url: await resolveMojangSkinUrl(normalizeUuid(source)) };
  }

  if (normalizedKind === "player" || normalizedKind === "auto") {
    if (!minecraftUserPattern.test(source)) {
      throw apiError(400, "invalid_player_name", "Minecraft player names must be 1-16 letters, numbers, or underscores.");
    }
    const profile = await lookupMinecraftProfileByName(source);
    return { kind: "player", url: await resolveMojangSkinUrl(profile.id) };
  }

  throw apiError(400, "invalid_skin_source", "Skin source could not be resolved.");
}

async function lookupMinecraftProfileByName(username) {
  const profileResponse = await fetch(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(username)}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Minecraft Log Resolver/0.1",
    },
  });

  if (profileResponse.status === 204 || profileResponse.status === 404) {
    throw apiError(404, "minecraft_profile_not_found", "Minecraft Services did not return a profile for that player name.");
  }
  if (profileResponse.status === 429) {
    throw apiError(429, "minecraft_profile_rate_limited", "Minecraft Services rate-limited the profile lookup. Try again later.");
  }
  if (!profileResponse.ok) {
    throw apiError(502, "minecraft_profile_unavailable", `Minecraft Services profile request failed with ${profileResponse.status}.`);
  }

  const profile = await profileResponse.json();
  if (!profile?.id || !profile?.name) {
    throw apiError(404, "minecraft_profile_not_found", "Minecraft Services did not return a usable profile.");
  }
  return {
    id: normalizeUuid(profile.id),
    name: profile.name,
  };
}

async function resolveMojangSkinUrl(uuid) {
  return (await resolveMojangSkinTexture(uuid)).skinUrl;
}

async function resolveMojangSkinTexture(uuid) {
  const profileResponse = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Minecraft Log Resolver/0.1",
    },
  });
  if (profileResponse.status === 204 || profileResponse.status === 404) {
    throw apiError(404, "skin_profile_not_found", "Mojang did not return skin texture metadata for that UUID.");
  }
  if (profileResponse.status === 429) {
    throw apiError(429, "mojang_texture_rate_limited", "Mojang rate-limited the skin texture lookup. Try again later.");
  }
  if (!profileResponse.ok) {
    throw apiError(502, "mojang_texture_unavailable", `Mojang texture request failed with ${profileResponse.status}.`);
  }

  const profile = await profileResponse.json();
  const textures = profile.properties?.find((property) => property.name === "textures")?.value;
  if (!textures) throw apiError(404, "skin_texture_missing", "Mojang profile has no skin texture property.");

  const decoded = JSON.parse(Buffer.from(textures, "base64").toString("utf8"));
  const skinUrl = decoded.textures?.SKIN?.url;
  if (!skinUrl) throw apiError(404, "skin_texture_missing", "Mojang profile has no skin texture URL.");
  const capeUrl = decoded.textures?.CAPE?.url ? validateSkinImageUrl(decoded.textures.CAPE.url) : null;
  const model = decoded.textures?.SKIN?.metadata?.model === "slim" ? "slim" : "classic";
  return {
    skinUrl: validateSkinImageUrl(skinUrl),
    capeUrl,
    model,
    timestamp: decoded.timestamp ?? null,
  };
}

function validateSkinImageUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol === "http:" && parsed.hostname === "textures.minecraft.net") {
    parsed.protocol = "https:";
  }
  if (parsed.protocol !== "https:") {
    throw apiError(400, "invalid_skin_url", "Remote skin URLs must use HTTPS.");
  }
  return parsed.toString();
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeUuid(value) {
  const clean = value.replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(clean)) {
    throw apiError(400, "invalid_uuid", "Minecraft UUID must be 32 hexadecimal characters, with or without dashes.");
  }
  return clean;
}

function apiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function roundsResponse(context, url) {
  const report = await readReport(context);
  const set = url.searchParams.get("set") ?? "reliable";
  if (!["reliable", "ignored", "all"].includes(set)) {
    return errorResponse(400, "invalid_round_set", "Round set must be reliable, ignored, or all.", { allowed: ["reliable", "ignored", "all"] });
  }

  const filterResult = readRoundsFilters(url);
  if (filterResult.response) return filterResult.response;
  const filters = filterResult.filters;
  const reliableKeys = set === "all" ? new Set((report.rounds.reliable ?? []).map((round) => round.key).filter(Boolean)) : null;
  const rows = (report.rounds[set] ?? []).map((round) => ensureRoundApiFields(round, { reliable: set === "reliable" || reliableKeys?.has(round.key) })).filter((round) => {
    if (filters.mode && round.gameMode !== filters.mode) return false;
    if (filters.result && round.result !== filters.result) return false;
    if (filters.resultHint && round.resultHint?.value !== filters.resultHint) return false;
    if (filters.resultHintReason && round.resultHint?.reason !== filters.resultHintReason) return false;
    if (filters.unknownAuditCategory && round.unknownAudit?.category !== filters.unknownAuditCategory) return false;
    if (filters.unknownNextAction && round.unknownAudit?.nextAction !== filters.unknownNextAction) return false;
    if (filters.unknownReviewPriority && round.unknownAudit?.reviewPriority !== filters.unknownReviewPriority) return false;
    if (filters.source && round.source !== filters.source) return false;
    if (filters.scope && round.scope !== filters.scope) return false;
    if (filters.dateFrom && round.startAt?.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && round.startAt?.slice(0, 10) > filters.dateTo) return false;
    if (filters.minDuration !== null && round.durationSeconds < filters.minDuration) return false;
    if (filters.maxDuration !== null && round.durationSeconds > filters.maxDuration) return false;
    if (filters.hasKnownResult !== null && isKnownResultRound(round) !== filters.hasKnownResult) return false;
    return true;
  });
  const pagination = readPagination(url, 100, 1000);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  return jsonResponse(200, {
    set,
    filters,
    total: rows.length,
    offset,
    limit,
    items: rows.slice(offset, offset + limit),
    summary: report.rounds.summary,
  });
}

async function modesResponse(context) {
  const report = await readReport(context);
  const gameModes = withPlayerBedDestroyAliases(report.rounds.summary.gameModes ?? {});
  return jsonResponse(200, {
    total: Object.keys(gameModes).length,
    metricDefinitions: buildMetricDefinitions([
      "bedDestroys",
      "selfBedDestroys",
      "playerBedDestroys",
      "playerMaxKillStreak",
      "observedBroadcastMaxKillStreak",
      "maxStreak",
      "resultEligible",
      "notApplicableResults",
      "unknownResults",
      "ambiguousResults",
      "rewardEvents",
      "goldEarned",
      "xpEarned",
      "streakPoints",
    ]),
    items: gameModes,
  });
}

async function resultsResponse(context) {
  const report = await readReport(context);
  return jsonResponse(200, {
    ...report.results,
    unknownAudit: ensureUnknownAuditSummary(
      report.results?.unknownAudit,
      (report.rounds?.reliable ?? []).map((round) => ensureRoundApiFields(round, { reliable: true })),
    ),
  });
}

async function profileResponse(context) {
  const report = await readReport(context);
  return jsonResponse(200, ensureProfileApiFields(withMetricAliases(report.profile)));
}

async function activityResponse(context, url) {
  const report = await readReport(context);
  const mode = url.searchParams.get("mode");
  const rows = (report.activity?.segments ?? [])
    .map(ensureActivityApiFields)
    .filter((segment) => !mode || segment.mode === mode);
  const pagination = readPagination(url, 100, 1000);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  return jsonResponse(200, {
    summary: withMetricAliases(report.activity?.summary ?? { segments: 0, gameModes: {} }),
    policy: report.activity?.policy ?? {},
    metricDefinitions: buildMetricDefinitions([
      "playerMaxKillStreak",
      "observedBroadcastMaxKillStreak",
      "maxStreak",
      "rewardEvents",
      "goldEarned",
      "xpEarned",
      "bountyClaims",
      "bountyGoldEarned",
      "streakPoints",
      "notApplicableResults",
    ]),
    filters: { mode },
    total: rows.length,
    offset,
    limit,
    items: rows.slice(offset, offset + limit),
  });
}

async function resultCandidatesResponse(context, url) {
  const candidates = await readJson(context, context.resultCandidatesPath, { kind: "result_candidates" });
  const category = url.searchParams.get("category");
  const mode = url.searchParams.get("mode");
  const rows = (candidates.candidates ?? []).filter((candidate) => {
    if (category && candidate.category !== category) return false;
    if (mode && candidate.gameMode !== mode) return false;
    return true;
  });
  const pagination = readPagination(url, 50, 500);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  return jsonResponse(200, {
    generatedAt: candidates.generatedAt,
    totals: candidates.totals,
    categories: candidates.categories,
    modes: candidates.modes,
    filters: { category, mode },
    total: rows.length,
    offset,
    limit,
    items: rows.slice(offset, offset + limit),
  });
}

function readRoundsFilters(url) {
  const errors = [];
  const filters = {
    mode: url.searchParams.get("mode"),
    result: url.searchParams.get("result"),
    resultHint: url.searchParams.get("resultHint"),
    resultHintReason: url.searchParams.get("resultHintReason"),
    unknownAuditCategory: url.searchParams.get("unknownAuditCategory"),
    unknownNextAction: url.searchParams.get("unknownNextAction"),
    unknownReviewPriority: url.searchParams.get("unknownReviewPriority"),
    source: url.searchParams.get("source"),
    scope: url.searchParams.get("scope"),
    dateFrom: readDateQuery(url, "dateFrom", errors),
    dateTo: readDateQuery(url, "dateTo", errors),
    minDuration: readNumberQuery(url, "minDuration", errors),
    maxDuration: readNumberQuery(url, "maxDuration", errors),
    hasKnownResult: readBooleanQueryValue(url, "hasKnownResult", null, errors),
  };
  if (filters.minDuration !== null && filters.maxDuration !== null && filters.minDuration > filters.maxDuration) {
    errors.push({ field: "duration", error: "min_must_be_lte_max" });
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.push({ field: "date", error: "from_must_be_lte_to" });
  }
  if (!isAllowedUnknownAuditCategory(filters.unknownAuditCategory)) {
    errors.push({ field: "unknownAuditCategory", error: "unknown_value", allowed: UNKNOWN_AUDIT_CATEGORIES });
  }
  if (!isAllowedUnknownAuditNextAction(filters.unknownNextAction)) {
    errors.push({ field: "unknownNextAction", error: "unknown_value", allowed: UNKNOWN_AUDIT_NEXT_ACTIONS });
  }
  if (!isAllowedUnknownAuditPriority(filters.unknownReviewPriority)) {
    errors.push({ field: "unknownReviewPriority", error: "unknown_value", allowed: UNKNOWN_AUDIT_PRIORITIES });
  }
  if (errors.length) {
    return {
      response: errorResponse(400, "invalid_rounds_query", "Round filter query parameters are invalid.", { errors }),
    };
  }
  return { filters };
}

function isKnownResultRound(round) {
  return round?.resultEligible !== false && ["win", "loss", "ambiguous"].includes(round?.result);
}

function ensureRoundApiFields(round, options = {}) {
  if (!round) return round;
  const serverContext = ensureServerContext(round);
  const withServer = {
    ...round,
    playerBedDestroys: round.playerBedDestroys ?? round.selfBedDestroys ?? 0,
    playerMaxKillStreak: round.playerMaxKillStreak ?? 0,
    observedBroadcastMaxKillStreak: round.observedBroadcastMaxKillStreak ?? round.maxStreak ?? 0,
    rewardEvents: round.rewardEvents ?? 0,
    streakPoints: round.streakPoints ?? 0,
    goldEarned: round.goldEarned ?? 0,
    xpEarned: round.xpEarned ?? 0,
    bountyClaims: round.bountyClaims ?? 0,
    bountyGoldEarned: round.bountyGoldEarned ?? 0,
    serverNetwork: serverContext.serverNetwork,
    serverAddress: serverContext.serverAddress,
    serverLabel: serverContext.serverLabel,
    serverConfidence: serverContext.serverConfidence,
    serverEvidence: serverContext.serverEvidence,
  };
  if (withServer.result !== "unknown" || !options.reliable) return withServer;
  return {
    ...withServer,
    unknownAudit: ensureUnknownAudit(withServer),
  };
}

function ensureActivityApiFields(segment) {
  if (!segment) return segment;
  return {
    ...segment,
    observedBroadcastMaxKillStreak: segment.observedBroadcastMaxKillStreak ?? segment.maxStreak ?? 0,
    playerMaxKillStreak: segment.playerMaxKillStreak ?? 0,
    rewardEvents: segment.rewardEvents ?? 0,
    goldEarned: segment.goldEarned ?? 0,
    xpEarned: segment.xpEarned ?? 0,
    bountyClaims: segment.bountyClaims ?? 0,
    bountyGoldEarned: segment.bountyGoldEarned ?? 0,
    streakPoints: segment.streakPoints ?? 0,
  };
}

function ensureSummaryApiFields(summary) {
  if (!summary || typeof summary !== "object") return summary;
  return {
    ...summary,
    metricDefinitions: mergeMetricDefinitions(summary.metricDefinitions, buildMetricDefinitions()),
  };
}

function ensureProfileApiFields(profile) {
  if (!profile || typeof profile !== "object") return profile;
  return {
    ...profile,
    metricDefinitions: mergeMetricDefinitions(profile.metricDefinitions, buildMetricDefinitions([
      "bestWinStreak",
      "currentWinStreak",
      "winStreaks",
      "playerMaxKillStreak",
      "observedBroadcastMaxKillStreak",
      "maxStreak",
      "bedDestroys",
      "selfBedDestroys",
      "playerBedDestroys",
      "unknownResults",
      "ambiguousResults",
      "notApplicableResults",
      "rewardEvents",
      "goldEarned",
      "xpEarned",
      "bountyClaims",
      "bountyGoldEarned",
      "streakPoints",
    ])),
  };
}

function mergeMetricDefinitions(existing, defaults) {
  return {
    ...(defaults ?? {}),
    ...(existing ?? {}),
  };
}

function withPlayerBedDestroyAliases(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withPlayerBedDestroyAliases);
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withPlayerBedDestroyAliases(item)]));
  if (!("playerBedDestroys" in result) && typeof result.selfBedDestroys === "number") {
    result.playerBedDestroys = result.selfBedDestroys;
  }
  return result;
}

function withMetricAliases(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withMetricAliases);
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withMetricAliases(item)]));
  if (!("playerBedDestroys" in result) && typeof result.selfBedDestroys === "number") {
    result.playerBedDestroys = result.selfBedDestroys;
  }
  if (!("observedBroadcastMaxKillStreak" in result) && typeof result.maxStreak === "number") {
    result.observedBroadcastMaxKillStreak = result.maxStreak;
  }
  if (!("rewardEvents" in result) && hasCombatMetricShape(result)) {
    result.rewardEvents = 0;
  }
  if (!("goldEarned" in result) && hasCombatMetricShape(result)) {
    result.goldEarned = 0;
  }
  if (!("xpEarned" in result) && hasCombatMetricShape(result)) {
    result.xpEarned = 0;
  }
  if (!("bountyClaims" in result) && hasCombatMetricShape(result)) {
    result.bountyClaims = 0;
  }
  if (!("bountyGoldEarned" in result) && hasCombatMetricShape(result)) {
    result.bountyGoldEarned = 0;
  }
  if (!("playerMaxKillStreak" in result) && hasCombatMetricShape(result)) {
    result.playerMaxKillStreak = 0;
  }
  if (result.totals && !result.streaks) {
    result.streaks = {
      win: result.winStreaks ?? defaultWinStreaksFromTotals(result.totals),
      playerMaxKillStreak: { count: result.totals.playerMaxKillStreak ?? 0 },
    };
  }
  return result;
}

function defaultWinStreaksFromTotals(totals = {}) {
  const breakUnknown = {
    policy: "break_unknown",
    best: defaultWinStreakRun(totals.bestWinStreak ?? 0),
    current: defaultWinStreakRun(totals.currentWinStreak ?? 0),
  };
  const skipUnknown = {
    policy: "skip_unknown",
    best: defaultWinStreakRun(totals.bestWinStreak ?? 0),
    current: defaultWinStreakRun(totals.currentWinStreak ?? 0),
  };
  return {
    breakUnknown,
    skipUnknown,
    break_unknown: breakUnknown,
    skip_unknown: skipUnknown,
  };
}

function defaultWinStreakRun(count = 0) {
  return {
    count: Number(count) || 0,
    startAt: null,
    endAt: null,
    startKey: null,
    endKey: null,
  };
}

function hasCombatMetricShape(value) {
  return ["kills", "deaths", "selfKills", "selfDeaths", "maxStreak", "rounds", "segments"].some((key) => typeof value[key] === "number");
}

function readDaysFilters(url) {
  const errors = [];
  const filters = {
    dateFrom: readDateQuery(url, "dateFrom", errors),
    dateTo: readDateQuery(url, "dateTo", errors),
  };
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.push({ field: "date", error: "from_must_be_lte_to" });
  }
  if (errors.length) {
    return {
      response: errorResponse(400, "invalid_days_query", "Day filter query parameters are invalid.", { errors }),
    };
  }
  return { filters };
}

async function refreshResponse(context, method) {
  if (method === "GET") return jsonResponse(200, publicRefresh(context.refresh));
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use GET or POST for refresh.");
  if (context.refresh.running) {
    return errorResponse(409, "refresh_already_running", "A refresh job is already running.", { refresh: publicRefresh(context.refresh) });
  }
  const writeTargetValidation = validateRefreshWriteTargets(context);
  if (!writeTargetValidation.ok) {
    return errorResponse(400, "unsafe_refresh_outputs", "Refresh output targets are not safe writable derived-data paths.", {
      errors: writeTargetValidation.errors,
    });
  }
  const preflight = await buildRefreshPreflight(context);
  if (!preflight.canRefresh) {
    return errorResponse(400, "refresh_preflight_failed", "Refresh preflight found blocking issues.", { preflight });
  }

  const refresh = {
    id: `refresh-${Date.now()}`,
    running: true,
    phase: "scan",
    percent: 5,
    currentFile: null,
    filesDone: 0,
    filesTotal: 0,
    stagingDir: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    cancelRequested: false,
    error: null,
    log: [],
  };
  refresh.phaseTimings = createPhaseTimings(refresh.phase, refresh.startedAt);
  refresh.stagingDir = path.join(resolveConfigPath(context.configContext, ".cache"), "refresh", refresh.id);
  refresh.stagedReportPath = `${context.reportPath}.${refresh.id}.tmp`;
  refresh.stagedSummaryPath = `${context.summaryPath}.${refresh.id}.tmp`;
  refresh.stagedUnmatchedPath = `${context.unmatchedPath}.${refresh.id}.tmp`;
  refresh.stagedStoreDir = path.join(path.dirname(context.storeDir), `.refresh-${refresh.id}-report-store`);
  context.refresh = refresh;

  runRefreshReportPhase(context, refresh);

  return jsonResponse(202, { ok: true, refresh: publicRefresh(refresh) });
}

async function refreshPreflightResponse(context, method) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST for refresh preflight.");
  return jsonResponse(200, await buildRefreshPreflight(context));
}

async function refreshCancelResponse(context, method) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to cancel refresh.");
  if (!context.refresh.running) {
    return jsonResponse(200, { ok: true, refresh: publicRefresh(context.refresh), message: "No refresh job is running." });
  }
  context.refresh.cancelRequested = true;
  transitionRefreshPhase(context.refresh, "cancelling");
  context.refresh.error = "Cancellation requested.";
  if (context.refreshProcess) {
    context.refreshProcess.kill();
  }
  return jsonResponse(202, { ok: true, refresh: publicRefresh(context.refresh) });
}

function runRefreshReportPhase(context, refresh) {
  const child = spawn(process.execPath, [
    "scripts/report.mjs",
    "--config",
    context.configContext.path,
    "--out",
    refresh.stagedReportPath,
    "--summary-out",
    refresh.stagedSummaryPath,
    "--unmatched-out",
    refresh.stagedUnmatchedPath,
    "--json",
  ], {
    cwd: process.cwd(),
    windowsHide: true,
  });
  context.refreshProcess = child;

  child.stdout.on("data", (chunk) => appendRefreshLog(refresh, chunk));
  child.stderr.on("data", (chunk) => appendRefreshLog(refresh, chunk));
  child.on("error", (error) => {
    finalizeRefresh(context, refresh, {
      phase: "failed",
      exitCode: null,
      error: error.message,
    });
  });
  child.on("exit", (code) => {
    if (refresh.cancelRequested) {
      finalizeRefresh(context, refresh, {
        phase: "cancelled",
        exitCode: code,
        error: "Refresh cancelled.",
      });
      return;
    }
    if (code !== 0) {
      finalizeRefresh(context, refresh, {
        phase: "failed",
        exitCode: code,
        error: `Report refresh exited with code ${code}.`,
      });
      return;
    }
    runRefreshStorePhase(context, refresh);
  });
}

function runRefreshStorePhase(context, refresh) {
  transitionRefreshPhase(refresh, "export_store");
  refresh.percent = 85;
  const child = spawn(process.execPath, ["scripts/export-store.mjs", "--config", context.configContext.path, "--report", refresh.stagedReportPath, "--out-dir", refresh.stagedStoreDir], {
    cwd: process.cwd(),
    windowsHide: true,
  });
  context.refreshProcess = child;
  child.stdout.on("data", (chunk) => appendRefreshLog(refresh, chunk));
  child.stderr.on("data", (chunk) => appendRefreshLog(refresh, chunk));
  child.on("error", (error) => {
    finalizeRefresh(context, refresh, {
      phase: "failed",
      exitCode: null,
      error: error.message,
    });
  });
  child.on("exit", (code) => {
    if (refresh.cancelRequested) {
      finalizeRefresh(context, refresh, {
        phase: "cancelled",
        exitCode: code,
        error: "Refresh cancelled.",
      });
      return;
    }
    if (code !== 0) {
      finalizeRefresh(context, refresh, {
        phase: "failed",
        exitCode: code,
        error: `Store export exited with code ${code}.`,
      });
      return;
    }
    transitionRefreshPhase(refresh, "commit");
    commitStagedRefresh(context, refresh)
      .then(() => {
        finalizeRefresh(context, refresh, {
          phase: "done",
          exitCode: code,
          error: null,
        });
      })
      .catch((error) => {
        finalizeRefresh(context, refresh, {
          phase: "failed",
          exitCode: code,
          error: `Could not commit refreshed outputs: ${error.message}`,
        });
      });
  });
}

function finalizeRefresh(context, refresh, result) {
  if (context.refresh !== refresh || !refresh.running) return;
  const failurePhase = result.phase === "failed" ? refresh.phase : null;
  const finishedAt = new Date().toISOString();
  finishActiveRefreshPhase(refresh, finishedAt);
  refresh.running = false;
  refresh.phase = result.phase;
  refresh.percent = result.phase === "done" ? 100 : refresh.percent;
  refresh.finishedAt = finishedAt;
  refresh.exitCode = result.exitCode;
  refresh.error = result.error;
  refresh.failurePhase = failurePhase;
  refresh.errorCategory = classifyRefreshError(refresh);
  context.refreshProcess = null;
  const historyWrite = appendRefreshHistory(context, refresh);
  context.refreshHistoryWrite = historyWrite;
  historyWrite.finally(() => {
    if (context.refreshHistoryWrite === historyWrite) context.refreshHistoryWrite = null;
  });
  cleanupRefreshStaging(refresh).catch(() => {});
}

async function commitStagedRefresh(context, refresh) {
  const moves = [
    { kind: "report", from: refresh.stagedReportPath, to: context.reportPath },
    { kind: "summary", from: refresh.stagedSummaryPath, to: context.summaryPath },
    { kind: "unmatched_debug", from: refresh.stagedUnmatchedPath, to: context.unmatchedPath },
    { kind: "store", from: refresh.stagedStoreDir, to: context.storeDir },
  ];
  for (const move of moves) {
    const safety = validateDerivedTarget(context, move.to);
    if (!safety.ok) {
      throw new Error(`Refusing to commit ${move.kind} to unsafe target (${safety.reason}): ${move.to}`);
    }
  }
  await commitMovesWithRollback(moves, refresh.id);
  clearApiJsonCache(context, "refresh_committed");
}

async function commitMovesWithRollback(moves, refreshId) {
  const completed = [];
  try {
    for (const move of moves) {
      await commitMove(move, refreshId);
      completed.push(move);
    }
  } catch (error) {
    await rollbackMoves(completed.reverse());
    throw error;
  } finally {
    for (const move of moves) {
      if (move.backupPath) await rm(move.backupPath, { recursive: true, force: true });
    }
  }
}

async function commitMove(move, refreshId) {
  if (!(await pathExists(move.from))) {
    throw new Error(`Missing staged ${move.kind}: ${move.from}`);
  }
  await mkdir(path.dirname(move.to), { recursive: true });
  move.backupPath = `${move.to}.${refreshId}.bak`;
  move.hadExisting = await pathExists(move.to);
  await rm(move.backupPath, { recursive: true, force: true });
  try {
    if (move.hadExisting) await rename(move.to, move.backupPath);
    await rename(move.from, move.to);
  } catch (error) {
    await rm(move.to, { recursive: true, force: true });
    if (move.hadExisting && (await pathExists(move.backupPath))) {
      await rename(move.backupPath, move.to);
    }
    throw error;
  }
}

async function rollbackMoves(moves) {
  for (const move of moves) {
    try {
      await rm(move.to, { recursive: true, force: true });
      if (move.hadExisting && move.backupPath && (await pathExists(move.backupPath))) {
        await rename(move.backupPath, move.to);
      }
    } catch {
      // Best effort rollback; the refresh result still reports the original commit failure.
    }
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function cleanupRefreshStaging(refresh) {
  await Promise.all([
    refresh.stagedReportPath ? rm(refresh.stagedReportPath, { recursive: true, force: true }) : null,
    refresh.stagedSummaryPath ? rm(refresh.stagedSummaryPath, { recursive: true, force: true }) : null,
    refresh.stagedUnmatchedPath ? rm(refresh.stagedUnmatchedPath, { recursive: true, force: true }) : null,
    refresh.stagedStoreDir ? rm(refresh.stagedStoreDir, { recursive: true, force: true }) : null,
    refresh.stagingDir ? rm(refresh.stagingDir, { recursive: true, force: true }) : null,
  ].filter(Boolean));
}

async function ruleTestResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to test one chat rule message.");
  if (!body?.message) return errorResponse(400, "message_required", "Provide a chat message to test.");
  const customRulePathResult = readRequestCustomRulePaths(context, body.customRulePaths);
  if (customRulePathResult.response) return customRulePathResult.response;
  const customRulePaths = customRulePathResult.paths;
  const ruleSetResult = readRequestRuleSets(body.ruleSets, customRulePaths);
  if (ruleSetResult.response) return ruleSetResult.response;
  let event;
  try {
    event = parseChatEvent(body.message, {
      ruleSets: ruleSetResult.ruleSets,
      customRulePaths,
    });
  } catch (error) {
    return invalidRulePackConfigResponse(customRulePaths, error);
  }
  return jsonResponse(200, {
    matched: Boolean(event),
    event,
    inferredGameMode: inferGameModeFromText(body.message),
  });
}

async function ruleDraftResponse(method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to draft a rule from one chat message.");
  if (!body?.message) return errorResponse(400, "message_required", "Provide a chat message to draft a rule.");
  const type = body.type ?? "round_end";
  const gameMode = body.gameMode ?? inferGameModeFromText(body.message);
  return jsonResponse(200, {
    rule: {
      id: body.id ?? draftRuleId(type, body.message),
      type,
      pattern: messageToPattern(body.message),
      ...(gameMode && gameMode !== "unknown" ? { payload: { gameMode } } : {}),
    },
    notes: [
      "Review the generated regex before adding it to a rule pack.",
      "Replace player names, map names, or other changing text with named groups only when the value is useful.",
    ],
  });
}

async function ruleValidateResponse(method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to validate one inline rule pack.");
  const errors = validateRuleSetDefinition(body, "<request>");
  return jsonResponse(errors.length ? 400 : 200, {
    ok: errors.length === 0,
    ...(errors.length ? { error: "invalid_rule_pack", message: "Rule pack validation failed." } : {}),
    errors,
  });
}

async function unknownAuditLabelsResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to validate reviewed unknown-audit labels.");
  const labels = Array.isArray(body.labels) ? body.labels : Array.isArray(body.rows) ? body.rows : null;
  if (!labels) return errorResponse(400, "invalid_label_rows", "labels or rows must be an array.");
  const summary = buildLabelReviewSummary(labels, {
    validateRoundRefs: body.validateRoundRefs !== false,
    report: body.validateRoundRefs === false ? null : await readReportIfAvailableForLabelValidation(context),
    sampleLimit: Number.isInteger(body.sampleLimit) ? Math.max(0, Math.min(body.sampleLimit, 100)) : undefined,
  });
  const readiness = buildLabelReviewReadiness(summary);
  if (!summary.ok) {
    return errorResponse(400, "invalid_label_rows", "Reviewed label rows contain invalid labels or stale round refs.", {
      allowed: VALID_REVIEW_LABELS,
      summary,
      readiness,
      checkedRoundRefs: summary.checkedRoundRefs,
      errors: summary.errors,
    });
  }
  return jsonResponse(200, {
    ok: true,
    status: readiness.status,
    readyForWorkflow: readiness.readyForWorkflow,
    workflowRecommended: readiness.workflowRecommended,
    readiness,
    ...summary,
  });
}

async function unknownAuditStatusResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to inspect reviewed unknown-audit label readiness.");
  const labels = Array.isArray(body.labels) ? body.labels : Array.isArray(body.rows) ? body.rows : null;
  if (!labels) return errorResponse(400, "invalid_label_rows", "labels or rows must be an array.");
  const summary = buildLabelReviewSummary(labels, {
    validateRoundRefs: body.validateRoundRefs !== false,
    report: body.validateRoundRefs === false ? null : await readReportIfAvailableForLabelValidation(context),
    sampleLimit: Number.isInteger(body.sampleLimit) ? Math.max(0, Math.min(body.sampleLimit, 100)) : undefined,
  });
  const readiness = buildLabelReviewReadiness(summary);
  return jsonResponse(summary.ok ? 200 : 400, {
    ok: summary.ok,
    ...(summary.ok ? {} : {
      error: "invalid_label_rows",
      message: "Reviewed label rows contain invalid labels or stale round refs.",
    }),
    status: readiness.status,
    nextStep: readiness.nextStep,
    blocked: readiness.blocked,
    blockingReason: readiness.blockingReason,
    requiresHumanInput: readiness.requiresHumanInput,
    canDraftRules: readiness.canDraftRules,
    canRunDryRun: readiness.canRunDryRun,
    canArchive: readiness.canArchive,
    nextCommand: readiness.nextCommand,
    readyForWorkflow: readiness.readyForWorkflow,
    workflowRecommended: readiness.workflowRecommended,
    counts: {
      totalRows: summary.totalRows,
      labeledRows: summary.labeledRows,
      unlabeledRows: summary.unlabeledRows,
      actionableRows: summary.candidates.actionableRows,
      draftableRuleRows: summary.candidates.draftableRuleRows,
      missingRuleTextRows: summary.candidates.missingRuleTextRows,
      errors: summary.errors.length,
    },
    byLabel: summary.byLabel,
    byCategory: summary.byCategory,
    byNextAction: summary.byNextAction,
    nextActions: readiness.nextActions,
    errors: summary.errors,
    missingRuleTextRows: summary.missingRuleTextRows,
    writes: summary.writes,
  });
}

async function unknownAuditLabelSetsResponse(context, method, body = {}) {
  if (method === "GET") return listUnknownAuditLabelSetsResponse(context);
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use GET or POST for local unknown-audit label sets.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot save unknown-audit label sets while a refresh job is running.");
  return writeUnknownAuditLabelSetResponse(context, body, { create: true });
}

async function unknownAuditLabelSetResponse(context, method, pathname, body = {}) {
  const id = readUnknownAuditLabelSetRouteId(pathname);
  if (!id) return errorResponse(400, "invalid_label_set_id", "Provide one unknown-audit label set id.");
  if (!isManagedLabelSetId(id)) return invalidManagedLabelSetIdResponse();
  if (method === "GET") return readUnknownAuditLabelSetResponse(context, id);
  if (method === "PUT") {
    if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot save unknown-audit label sets while a refresh job is running.");
    return writeUnknownAuditLabelSetResponse(context, { ...body, id }, { create: false });
  }
  if (method === "DELETE") return deleteUnknownAuditLabelSetResponse(context, id);
  return errorResponse(405, "method_not_allowed", "Use GET, PUT, or DELETE for one local unknown-audit label set.");
}

async function listUnknownAuditLabelSetsResponse(context) {
  const items = [];
  try {
    const entries = await readdir(context.unknownAuditLabelSetsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -".json".length);
      if (!isManagedLabelSetId(id)) continue;
      const filePath = path.join(context.unknownAuditLabelSetsPath, entry.name);
      const metadata = await readUnknownAuditLabelSetMetadata(context, id, filePath);
      items.push(metadata);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.id.localeCompare(b.id));
  return jsonResponse(200, {
    ok: true,
    total: items.length,
    policy: "Local label sets are derived review drafts. They do not change report/store/config/rules and can be regenerated or deleted.",
    items,
  });
}

async function readUnknownAuditLabelSetResponse(context, id) {
  const resolved = resolveUnknownAuditLabelSetFileOrResponse(context, id);
  if (resolved.response) return resolved.response;
  const { safeId, filePath } = resolved.value;
  let data;
  try {
    data = await readJson(context, filePath, { kind: "unknown_audit_label_set" });
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(404, "label_set_not_found", "Unknown-audit label set was not found.", { id: safeId });
    if (error instanceof SyntaxError) return errorResponse(503, "label_set_invalid_json", "Unknown-audit label set JSON is corrupt.", { id: safeId });
    throw error;
  }
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.labels) ? data.labels : [];
  const summary = buildLabelReviewSummary(rows, {
    validateRoundRefs: data.validateRoundRefs !== false,
    report: data.validateRoundRefs === false ? null : await readReportIfAvailableForLabelValidation(context),
  });
  const readiness = buildLabelReviewReadiness(summary);
  return jsonResponse(200, {
    ok: true,
    ...normalizeUnknownAuditLabelSet(data, safeId),
    filePath,
    rows,
    labels: rows,
    summary,
    readiness,
    writes: unknownAuditLabelSetWrites(),
  });
}

async function writeUnknownAuditLabelSetResponse(context, body = {}, options = {}) {
  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
  if (!isManagedLabelSetId(id)) return invalidManagedLabelSetIdResponse();
  const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(body.labels) ? body.labels : null;
  if (!rows) return errorResponse(400, "invalid_label_rows", "rows or labels must be an array.");
  const validateRoundRefs = body.validateRoundRefs !== false;
  const summary = buildLabelReviewSummary(rows, {
    validateRoundRefs,
    report: validateRoundRefs ? await readReportIfAvailableForLabelValidation(context) : null,
    sampleLimit: Number.isInteger(body.sampleLimit) ? Math.max(0, Math.min(body.sampleLimit, 100)) : undefined,
  });
  const readiness = buildLabelReviewReadiness(summary);
  if (!summary.ok) {
    return errorResponse(400, "invalid_label_rows", "Reviewed label rows contain invalid labels or stale round refs.", {
      allowed: VALID_REVIEW_LABELS,
      summary,
      readiness,
      checkedRoundRefs: summary.checkedRoundRefs,
      errors: summary.errors,
    });
  }

  const resolved = resolveUnknownAuditLabelSetFileOrResponse(context, id);
  if (resolved.response) return resolved.response;
  const { filePath, safeId } = resolved.value;
  const now = new Date().toISOString();
  const existing = options.create ? null : await readJsonOptional(context, filePath, { kind: "unknown_audit_label_set" });
  const labelSet = {
    schema: {
      name: "minecraft-log-observatory-unknown-audit-label-set",
      version: 1,
    },
    id: safeId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing?.title ?? safeId,
    description: typeof body.description === "string" ? body.description : existing?.description ?? "",
    source: sanitizeLabelSetSource(body.source ?? existing?.source),
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
    updatedAt: now,
    validateRoundRefs,
    rows,
    review: {
      allowedReviewLabels: VALID_REVIEW_LABELS,
      readiness: readiness.status,
      nextStep: readiness.nextStep,
    },
    writes: unknownAuditLabelSetWrites(),
  };
  await mkdir(context.unknownAuditLabelSetsPath, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(labelSet, null, 2)}\n`, "utf8");
  invalidateApiJsonCachePath(context, filePath);
  return jsonResponse(200, {
    ok: true,
    ...normalizeUnknownAuditLabelSet(labelSet, safeId),
    filePath,
    rows,
    labels: rows,
    summary,
    readiness,
    writes: unknownAuditLabelSetWrites(),
    note: "Saved label sets are local derived review drafts only. Run /api/unknown-audit/status or /api/rules/audit-workflow before changing rules.",
  });
}

async function deleteUnknownAuditLabelSetResponse(context, id) {
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot delete unknown-audit label sets while a refresh job is running.");
  const resolved = resolveUnknownAuditLabelSetFileOrResponse(context, id);
  if (resolved.response) return resolved.response;
  const { safeId, filePath } = resolved.value;
  try {
    await rm(filePath, { force: true });
    invalidateApiJsonCachePath(context, filePath);
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(404, "label_set_not_found", "Unknown-audit label set was not found.", { id: safeId });
    throw error;
  }
  return jsonResponse(200, {
    ok: true,
    id: safeId,
    filePath,
    deleted: true,
    writes: unknownAuditLabelSetWrites(),
  });
}

async function ruleDraftFromLabelsResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to draft a rule pack from reviewed labels.");
  const labels = Array.isArray(body.labels) ? body.labels : Array.isArray(body.rows) ? body.rows : null;
  if (!labels) return errorResponse(400, "invalid_label_rows", "labels or rows must be an array.");
  const labelValidation = body.validateRoundRefs === false
    ? validateLabelRows(labels)
    : validateLabelRowsAgainstReport(labels, await readReportIfAvailableForLabelValidation(context));
  if (labelValidation.errors.length) {
    return errorResponse(400, "invalid_label_rows", "Label rows contain unsupported review labels.", {
      allowed: VALID_REVIEW_LABELS,
      checkedRoundRefs: labelValidation.checkedRoundRefs ?? 0,
      errors: labelValidation.errors,
    });
  }
  const decisions = countByValues(labels, (item) => labelDecision(item) ?? "unlabeled");
  const rulePack = buildRulePackDraftFromLabels(labels, {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
  });
  const errors = validateRuleSetDefinition(rulePack, "<draft-from-labels>");
  return jsonResponse(errors.length ? 400 : 200, {
    ok: errors.length === 0,
    rulePack,
    rules: rulePack.rules.length,
    errors,
    workflow: {
      sourceRows: labels.length,
      checkedRoundRefs: labelValidation.checkedRoundRefs ?? 0,
      decisions,
      nextActions: [
        "Review generated regex patterns and examples.",
        "Validate the draft with POST /api/rules/validate.",
        "Preview impact with POST /api/rules/dry-run.",
        "Save to POST /api/rule-packs/user only after dry-run risks are acceptable.",
      ],
    },
    notes: [
      "Drafts from labels must be reviewed and dry-run before enabling.",
      "Only labels with win/loss/ignore decisions and message text produce draft rules.",
    ],
  });
}

async function readReportIfAvailableForLabelValidation(context) {
  try {
    return await readReport(context);
  } catch {
    return {};
  }
}

async function rulesDoctorResponse(context, method) {
  if (method !== "GET") return errorResponse(405, "method_not_allowed", "Use GET for rule doctor.");
  return jsonResponse(200, await buildRuleDoctor(context));
}

async function rulesDryRunResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to preview rule changes.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot dry-run rules while a refresh job is running.");
  if (body.rulePack !== undefined) {
    const errors = validateRuleSetDefinition(body.rulePack, "<request.rulePack>");
    if (errors.length) return errorResponse(400, "invalid_rule_pack", "Rule pack validation failed.", { errors });
  }
  if (body.rulePackId !== undefined && !isManagedRulePackId(body.rulePackId)) return invalidManagedRulePackIdResponse();
  if (body.rulePackId !== undefined) {
    const resolvedRulePack = resolveUserRulePackFileOrResponse(context, body.rulePackId);
    if (resolvedRulePack.response) return resolvedRulePack.response;
    try {
      await stat(resolvedRulePack.value.filePath);
    } catch (error) {
      if (error.code === "ENOENT") return errorResponse(404, "rule_pack_not_found", "User rule pack was not found.", { id: resolvedRulePack.value.safeId });
      throw error;
    }
  }
  const result = await runRulesDryRun(context, {
    rulePack: body.rulePack,
    rulePackId: body.rulePackId,
    targetMode: typeof body.targetMode === "string" && body.targetMode.trim() ? body.targetMode.trim() : null,
    full: body.full === true,
  });
  await appendRuleAudit(context, {
    action: "dry_run",
    rulePackId: body.rulePackId ?? body.rulePack?.id ?? null,
    result: result.ok ? "passed" : "risk",
    details: {
      roundChanges: result.roundChanges?.total ?? 0,
      risks: (result.risks ?? []).map((risk) => risk.code),
      ambiguousDelta: result.summary?.delta?.ambiguousResults ?? null,
      unknownDelta: result.summary?.delta?.unknownResults ?? null,
    },
  });
  return jsonResponse(200, result);
}

async function rulesAuditWorkflowResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to run reviewed-label audit workflow.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot run rule audit workflow while a refresh job is running.");
  const labels = Array.isArray(body.labels) ? body.labels : Array.isArray(body.rows) ? body.rows : null;
  if (!labels) return errorResponse(400, "invalid_label_rows", "labels or rows must be an array.");
  const result = await runAuditLabelWorkflow(context, labels, {
    id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
    targetMode: typeof body.targetMode === "string" && body.targetMode.trim() ? body.targetMode.trim() : undefined,
    full: body.full === true,
    skipDryRun: body.skipDryRun === true,
    validateRoundRefs: body.validateRoundRefs !== false,
    sampleLimit: Number.isInteger(body.sampleLimit) ? Math.max(0, Math.min(body.sampleLimit, 100)) : undefined,
    writeArtifacts: false,
  });
  await appendRuleAudit(context, {
    action: "audit_workflow",
    rulePackId: result.draft?.rulePack?.id ?? body.id ?? null,
    result: result.ok ? result.workflow?.status ?? "succeeded" : "failed",
    details: {
      labels: labels.length,
      draftRules: result.draft?.rules ?? 0,
      dryRunStatus: result.dryRun?.promotionGate?.status ?? null,
      roundChanges: result.dryRun?.roundChanges?.total ?? null,
      risks: (result.dryRun?.risks ?? []).map((risk) => risk.code),
    },
  });
  if (!result.ok) {
    return errorResponse(400, "invalid_audit_workflow", "Reviewed label workflow could not be completed.", result);
  }
  return jsonResponse(200, result);
}

async function userRulePacksResponse(context, method, body = {}) {
  if (method === "GET") return listUserRulePacksResponse(context);
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use GET or POST for project-managed user rule packs.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot save user rule packs while a refresh job is running.");

  const errors = validateRuleSetDefinition(body, "<request>");
  if (errors.length) {
    return errorResponse(400, "invalid_rule_pack", "Rule pack validation failed.", { errors });
  }
  if (!isManagedRulePackId(body.id)) {
    return invalidManagedRulePackIdResponse();
  }

  const resolvedRulePack = resolveUserRulePackFileOrResponse(context, body.id);
  if (resolvedRulePack.response) return resolvedRulePack.response;

  await mkdir(context.userRulePacksPath, { recursive: true });
  const { filePath } = resolvedRulePack.value;
  const backup = await backupExistingUserRulePack(context, body.id, filePath);
  await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  invalidateApiJsonCachePath(context, filePath);
  await appendRuleAudit(context, {
    action: backup ? "save_overwrite" : "save_create",
    rulePackId: body.id,
    result: "succeeded",
    details: {
      rules: Array.isArray(body.rules) ? body.rules.length : 0,
      backupId: backup?.id ?? null,
    },
  });
  return jsonResponse(200, {
    ok: true,
    id: body.id,
    filePath,
    backup,
    activeAfterConfigured: "Add custom-rules/user or this file path to customRules before report refresh if you want it loaded by default.",
  });
}

async function listUserRulePacksResponse(context) {
  const metadata = await listUserRulePackMetadata(context);
  const enabled = enabledCustomRulePathSet(context);
  return jsonResponse(200, {
    ...metadata,
    items: metadata.items.map((item) => ({
      ...compactRulePackMetadata(item),
      enabled: isUserRulePackEnabled(context, item.id, enabled),
    })),
  });
}

async function userRulePackResponse(context, method, pathname) {
  const id = readUserRulePackRouteId(pathname);
  if (!id) return errorResponse(400, "invalid_rule_pack_id", "Provide one user rule pack id.");
  if (!isManagedRulePackId(id)) return invalidManagedRulePackIdResponse();
  if (method === "GET") return readUserRulePackResponse(context, id);
  if (method === "DELETE") return deleteUserRulePackResponse(context, id);
  return errorResponse(405, "method_not_allowed", "Use GET or DELETE for one project-managed user rule pack.");
}

async function readUserRulePackResponse(context, id) {
  const resolvedRulePack = resolveUserRulePackFileOrResponse(context, id);
  if (resolvedRulePack.response) return resolvedRulePack.response;
  const { safeId, filePath } = resolvedRulePack.value;
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(404, "rule_pack_not_found", "User rule pack was not found.", { id: safeId });
    throw error;
  }

  let rulePack = null;
  let errors = [];
  try {
    rulePack = JSON.parse(text);
    errors = validateRuleSetDefinition(rulePack, filePath);
  } catch (error) {
    errors = [error.message];
  }

  return jsonResponse(200, {
    ok: true,
    id: rulePack?.id ?? safeId,
    requestedId: id,
    filePath,
    rulePack,
    name: rulePack?.name,
    rules: Array.isArray(rulePack?.rules) ? rulePack.rules.length : 0,
    enabled: isUserRulePackEnabled(context, rulePack?.id ?? safeId),
    valid: errors.length === 0,
    errors,
  });
}

async function deleteUserRulePackResponse(context, id) {
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot delete user rule packs while a refresh job is running.");
  const resolvedRulePack = resolveUserRulePackFileOrResponse(context, id);
  if (resolvedRulePack.response) return resolvedRulePack.response;
  const { safeId, filePath } = resolvedRulePack.value;
  try {
    await rm(filePath);
    invalidateApiJsonCachePath(context, filePath);
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(404, "rule_pack_not_found", "User rule pack was not found.", { id: safeId });
    throw error;
  }
  await appendRuleAudit(context, {
    action: "delete",
    rulePackId: safeId,
    result: "succeeded",
  });
  return jsonResponse(200, {
    ok: true,
    id: safeId,
    filePath,
    deleted: true,
  });
}

async function userRulePackEnableResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to enable or disable a user rule pack.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot change rule pack enabled state while a refresh job is running.");
  if (!isManagedRulePackId(body.id)) return invalidManagedRulePackIdResponse();
  if (typeof body.enabled !== "boolean") return errorResponse(400, "invalid_rule_pack_enabled", "enabled must be true or false.");

  const resolvedRulePack = resolveUserRulePackFileOrResponse(context, body.id);
  if (resolvedRulePack.response) return resolvedRulePack.response;
  try {
    await stat(resolvedRulePack.value.filePath);
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(404, "rule_pack_not_found", "User rule pack was not found.", { id: resolvedRulePack.value.safeId });
    throw error;
  }

  const existing = (await readJsonOptional(context, context.configContext.localPath, { kind: "local_config" })) ?? {};
  const current = uniqueStrings([...(existing.customRules ?? context.configContext.config.customRules ?? [])]);
  const dirEntry = "custom-rules/user";
  const fileEntry = `custom-rules/user/${body.id}.json`;
  let nextCustomRules;
  if (body.enabled) {
    nextCustomRules = current.includes(dirEntry) ? current : uniqueStrings([...current, fileEntry]);
  } else {
    nextCustomRules = current.filter((item) => item !== fileEntry && item !== dirEntry);
  }

  const patchResult = await sanitizeLocalConfigPatch(context, { customRules: nextCustomRules });
  if (patchResult.response) return patchResult.response;
  const localConfigSafety = validateLocalConfigWriteTarget(context);
  if (!localConfigSafety.ok) {
    return errorResponse(400, "unsafe_local_config_path", "The configured local overlay path is not writable by the local API policy.", {
      reason: localConfigSafety.reason,
      localConfigPath: context.configContext.localPath,
    });
  }
  await writeLocalAppConfig(context.configContext, patchResult.config);
  await reloadContext(context);
  await appendRuleAudit(context, {
    action: body.enabled ? "enable" : "disable",
    rulePackId: body.id,
    result: "succeeded",
    details: {
      customRules: context.configContext.config.customRules ?? [],
    },
  });
  return jsonResponse(200, {
    ok: true,
    id: body.id,
    enabled: body.enabled,
    customRules: context.configContext.config.customRules ?? [],
    note: "Refresh is required before enabled rule changes affect report statistics.",
  });
}

async function userRulePackBackupsResponse(context, method, body = {}) {
  if (!["GET", "POST"].includes(method)) return errorResponse(405, "method_not_allowed", "Use GET or POST to list user rule pack backups.");
  if (body.id !== undefined && !isManagedRulePackId(body.id)) return invalidManagedRulePackIdResponse();
  return jsonResponse(200, await listRulePackBackups(context, body.id ?? null));
}

async function userRulePackRestoreResponse(context, method, body = {}) {
  if (method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST to restore a user rule pack backup.");
  if (context.refresh.running) return refreshRunningWriteResponse(context, "Cannot restore user rule packs while a refresh job is running.");
  if (!isManagedRulePackId(body.id)) return invalidManagedRulePackIdResponse();
  if (typeof body.backupId !== "string" || !body.backupId.trim()) return errorResponse(400, "invalid_rule_pack_backup", "backupId is required.");
  const result = await restoreRulePackBackup(context, body.id, body.backupId.trim());
  if (!result.ok && result.error === "backup_not_found") return errorResponse(404, "rule_pack_backup_not_found", "Rule pack backup was not found.", { id: body.id, backupId: body.backupId });
  if (!result.ok) return errorResponse(400, result.error, "Rule pack backup could not be restored.", { errors: result.errors ?? [] });
  clearApiJsonCache(context, "rule_pack_restored");
  await appendRuleAudit(context, {
    action: "restore",
    rulePackId: body.id,
    result: "succeeded",
    details: {
      backupId: body.backupId.trim(),
      currentBackupId: result.currentBackup?.id ?? null,
    },
  });
  return jsonResponse(200, result);
}

async function rulesAuditResponse(context, method) {
  if (method !== "GET") return errorResponse(405, "method_not_allowed", "Use GET for rule audit history.");
  const history = await readRuleAuditHistory(context);
  return jsonResponse(200, {
    ok: true,
    total: history.items.length,
    retention: {
      maxItems: 100,
    },
    warning: history.warning,
    latest: history.items[0] ?? null,
    items: history.items,
  });
}

async function refreshHistoryResponse(context) {
  const history = await readRefreshHistory(context);
  const items = history.items;
  return jsonResponse(200, {
    total: items.length,
    retention: {
      maxItems: 50,
    },
    warning: history.warning,
    summary: summarizeDiagnosticRefreshHistory(items),
    latest: items[0] ?? null,
    items,
  });
}

async function readRuleAuditHistory(context) {
  try {
    const data = await readJson(context, context.ruleAuditPath, { kind: "rule_audit_history" });
    if (!Array.isArray(data)) {
      return {
        items: [],
        warning: refreshHistoryWarning(
          "rule_audit_history_invalid_schema",
          "Rule audit history must be an array and was ignored.",
        ),
      };
    }
    return {
      items: normalizeRuleAuditHistory(data),
      warning: null,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { items: [], warning: null };
    if (error instanceof SyntaxError) {
      return {
        items: [],
        warning: refreshHistoryWarning(
          "rule_audit_history_invalid_json",
          "Rule audit history JSON is corrupt and was ignored.",
        ),
      };
    }
    return {
      items: [],
      warning: refreshHistoryWarning(
        "rule_audit_history_unreadable",
        "Rule audit history could not be read and was ignored.",
        { errorCode: error.code ?? null },
      ),
    };
  }
}

async function appendRuleAudit(context, entry) {
  try {
    let history = [];
    try {
      const parsed = JSON.parse(await readFile(context.ruleAuditPath, "utf8"));
      history = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    history.unshift(normalizeRuleAuditEntry({
      id: `rule-audit-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...entry,
    }));
    history = history.slice(0, 100);
    await mkdir(path.dirname(context.ruleAuditPath), { recursive: true });
    await writeFile(context.ruleAuditPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    invalidateApiJsonCachePath(context, context.ruleAuditPath);
  } catch {
    // Rule audit history is diagnostic; never fail the user operation because it could not be written.
  }
}

function normalizeRuleAuditHistory(items) {
  return Array.isArray(items) ? items.map(normalizeRuleAuditEntry).filter(Boolean) : [];
}

function normalizeRuleAuditEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return {
    id: typeof item.id === "string" ? item.id : `rule-audit-${Date.now()}`,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
    action: typeof item.action === "string" ? item.action : "unknown",
    rulePackId: typeof item.rulePackId === "string" ? item.rulePackId : null,
    result: typeof item.result === "string" ? item.result : "unknown",
    details: isObjectRecord(item.details) ? sanitizeRuleAuditDetails(item.details) : {},
  };
}

function sanitizeRuleAuditDetails(details) {
  const allowed = {};
  for (const [key, value] of Object.entries(details)) {
    if (["rules", "backupId", "currentBackupId", "roundChanges", "risks", "ambiguousDelta", "unknownDelta", "customRules"].includes(key)) {
      allowed[key] = value;
    }
  }
  return allowed;
}

async function performanceResponse(context) {
  const history = await readRefreshHistory(context);
  const items = history.items;
  const appStatus = (await appStatusResponse(context, "GET")).body;
  const baseline = buildRefreshPerformanceBaseline(items, history.warning);
  const store = await buildStorePerformanceBaseline(context, appStatus);
  const cache = await buildCachePerformanceBaseline(context);
  const outputs = await buildPerformanceOutputsBaseline(context, appStatus);
  const storeReadMetrics = await readStoreReadMetrics(context);
  const storeReadBaseline = await measureStoreReadBaseline({
    storeDir: context.storeDir,
    manifestPath: context.storeManifestPath,
  });
  const currentPerformanceBaseline = {
    generatedAt: new Date().toISOString(),
    baseline,
    store,
    storeReadBaseline,
  };
  const savedPerformanceBaseline = await readJsonOptional(context, context.performanceBaselinePath, { kind: "performance_baseline" });
  const apiCache = apiJsonCachePerformance(context.apiJsonCache);
  return jsonResponse(200, {
    ok: true,
    schema: {
      name: "minecraft-log-observatory-performance",
      version: 1,
    },
    generatedAt: new Date().toISOString(),
    refresh: privacySafeRefresh(context.refresh),
    refreshHistory: {
      total: items.length,
      retention: {
        maxItems: 50,
      },
      warning: history.warning,
      summary: summarizeDiagnosticRefreshHistory(items),
      latest: performanceRefreshHistoryItem(items[0] ?? null),
    },
    warnings: history.warning ? [history.warning] : [],
    baseline,
    outputs,
    store,
    storeReads: storeReadMetrics.summary,
    storeReadBaseline,
    cache,
    apiCache,
    refreshDiagnostics: summarizeRefreshDiagnostics(context.refresh, items),
    comparison: comparePerformanceBaselines(currentPerformanceBaseline, savedPerformanceBaseline),
    dataReady: Boolean(appStatus.ready),
    needsRefresh: Boolean(appStatus.needsRefresh),
    refreshReasons: appStatus.refreshReasons ?? [],
    recommendations: buildDiagnosticPerformanceRecommendations({
      baseline,
      store,
      storeReads: storeReadMetrics.summary,
      storeReadBaseline,
      cache,
      historyWarning: history.warning,
      needsRefresh: Boolean(appStatus.needsRefresh),
      refreshReasons: appStatus.refreshReasons ?? [],
    }),
  });
}

async function buildPerformanceOutputsBaseline(context, appStatus) {
  const reportFile = await checkFile(context.reportPath);
  const summaryFile = await checkFile(context.summaryPath);
  return {
    report: {
      ready: Boolean(appStatus.report?.ready),
      exists: Boolean(reportFile.exists && reportFile.type === "file"),
      bytes: reportFile.exists && reportFile.type === "file" ? reportFile.bytes : null,
      generatedAt: appStatus.report?.generatedAt ?? null,
      schema: appStatus.report?.schema ?? null,
      jsonError: appStatus.report?.jsonError ?? null,
      schemaErrorReason: appStatus.report?.schemaErrorReason ?? null,
    },
    summary: {
      exists: Boolean(summaryFile.exists && summaryFile.type === "file"),
      bytes: summaryFile.exists && summaryFile.type === "file" ? summaryFile.bytes : null,
      jsonError: appStatus.report?.summaryJsonError ?? null,
      schemaErrorReason: appStatus.report?.summarySchemaErrorReason ?? null,
    },
    consistency: {
      reportGeneratedAt: appStatus.report?.generatedAt ?? null,
      storeReportGeneratedAt: appStatus.store?.reportGeneratedAt ?? null,
      storeGeneratedAt: appStatus.store?.generatedAt ?? null,
      reportMatchesStore: appStatus.store?.reportMatchesStore ?? null,
      storeOutOfSync: Boolean(appStatus.store?.outOfSync),
    },
  };
}

async function readRefreshHistoryItems(context) {
  return (await readRefreshHistory(context)).items;
}

async function readRefreshHistory(context) {
  if (context.refreshHistoryWrite) {
    await context.refreshHistoryWrite.catch(() => {});
  }
  try {
    const data = await readJson(context, context.refreshHistoryPath, { kind: "refresh_history" });
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

async function appendRefreshHistory(context, refresh) {
  try {
    let history = [];
    try {
      const parsed = JSON.parse(await readFile(context.refreshHistoryPath, "utf8"));
      history = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    history.unshift(buildRefreshHistoryEntry(refresh));
    history = history.slice(0, 50);
    await mkdir(path.dirname(context.refreshHistoryPath), { recursive: true });
    await writeFile(context.refreshHistoryPath, JSON.stringify(history, null, 2), "utf8");
    invalidateApiJsonCachePath(context, context.refreshHistoryPath);
  } catch {
    // Refresh history is diagnostic; never fail the refresh because history could not be written.
  }
}

function refreshHistoryWarning(code, message, extra = {}) {
  return {
    code,
    message,
    ...extra,
  };
}

function buildRefreshHistoryEntry(refresh) {
  const filesDone = refresh.filesDone ?? 0;
  const filesTotal = refresh.filesTotal ?? 0;
  return {
    id: refresh.id,
    status: refreshStatus(refresh.phase),
    phase: refresh.phase,
    failurePhase: refresh.failurePhase ?? null,
    percent: refresh.percent ?? 0,
    filesDone,
    filesTotal,
    files: {
      done: filesDone,
      total: filesTotal,
    },
    startedAt: refresh.startedAt,
    finishedAt: refresh.finishedAt,
    durationMs: durationBetweenMs(refresh.startedAt, refresh.finishedAt),
    phaseTimings: publicPhaseTimings(refresh),
    phaseDurationsMs: phaseDurationsMs(refresh),
    diagnostics: privacySafeRefreshDiagnostics(refresh.diagnostics),
    exitCode: refresh.exitCode,
    cancelRequested: Boolean(refresh.cancelRequested),
    errorCategory: refresh.errorCategory ?? classifyRefreshError(refresh),
    error: refresh.error,
    logTail: (refresh.log ?? []).slice(-10),
  };
}

function normalizeRefreshHistory(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const filesDone = item.filesDone ?? item.files?.done ?? 0;
    const filesTotal = item.filesTotal ?? item.files?.total ?? 0;
    const normalized = {
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
      phaseTimings: normalizePhaseTimings(item.phaseTimings),
      phaseDurationsMs: item.phaseDurationsMs ?? phaseDurationsMs({ phaseTimings: item.phaseTimings ?? {} }),
      diagnostics: privacySafeRefreshDiagnostics(item.diagnostics),
      cancelRequested: Boolean(item.cancelRequested),
      errorCategory: item.errorCategory ?? classifyRefreshError(item),
      logTail: Array.isArray(item.logTail) ? item.logTail : [],
    };
    return normalized;
  });
}

function performanceRefreshHistoryItem(item) {
  if (!item) return null;
  const { currentFile: _currentFile, error: _error, log: _log, logTail: _logTail, ...safe } = item;
  return {
    ...safe,
    hasCurrentFile: Boolean(item.currentFile),
    hasError: Boolean(item.error),
    logLines: Array.isArray(item.log) ? item.log.length : 0,
    logTailLines: Array.isArray(item.logTail) ? item.logTail.length : 0,
  };
}

function privacySafeRefreshHistoryResponse(history) {
  return {
    total: history.total ?? 0,
    retention: history.retention ?? { maxItems: 50 },
    warning: history.warning ?? null,
    summary: history.summary ?? summarizeDiagnosticRefreshHistory([]),
    latest: performanceRefreshHistoryItem(history.latest ?? null),
    items: Array.isArray(history.items) ? history.items.map(performanceRefreshHistoryItem) : [],
  };
}

async function buildStorePerformanceBaseline(context, appStatus) {
  const statusStore = appStatus.store ?? {};
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

  let manifest;
  try {
    manifest = await readJson(context, context.storeManifestPath, { kind: "store_manifest" });
  } catch (error) {
    if (error.code === "ENOENT") return output;
    if (error instanceof SyntaxError) {
      output.jsonError ??= error.message;
      return output;
    }
    throw error;
  }

  const validation = validateStoreManifestShape(manifest);
  if (!validation.ok) {
    output.manifestErrorReason ??= validation.reason;
    return output;
  }

  const files = [];
  const storeDir = path.resolve(context.storeDir);
  for (const [name, fileName] of Object.entries(manifest.files ?? {})) {
    const filePath = path.resolve(storeDir, fileName);
    if (!isSameOrInside(filePath, storeDir)) continue;
    const file = await checkFile(filePath);
    const bytes = file.exists && file.type === "file" ? file.bytes : null;
    const jsonl = fileName.endsWith(".jsonl");
    const rows = jsonl && Number.isFinite(manifest.counts?.[name]) ? manifest.counts[name] : null;
    files.push({
      name,
      file: fileName,
      kind: jsonl ? "jsonl" : "json",
      exists: Boolean(file.exists && file.type === "file"),
      bytes,
      rows,
    });
  }

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
  return output;
}

async function buildCachePerformanceBaseline(context) {
  const config = context.configContext.config;
  const entries = {
    parse: await cacheFileStatus(context, "parse", config.cache.parse),
    chat: await cacheFileStatus(context, "chat", config.cache.chat),
    chatLines: await cacheFileStatus(context, "chatLines", config.cache.chatLines),
  };
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

async function readStoreReadMetrics(context) {
  try {
    const data = await readJson(context, context.storeReadMetricsPath, { kind: "store_read_metrics" });
    const items = Array.isArray(data) ? data.map(normalizeStoreReadMetric).filter(Boolean) : [];
    return {
      items,
      summary: summarizeStoreReadMetrics(items),
    };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return {
        items: [],
        summary: summarizeStoreReadMetrics([]),
      };
    }
    throw error;
  }
}

async function appendStoreReadMetric(context, metric) {
  try {
    let history = [];
    try {
      const parsed = JSON.parse(await readFile(context.storeReadMetricsPath, "utf8"));
      history = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    history.unshift(normalizeStoreReadMetric({
      createdAt: new Date().toISOString(),
      ...metric,
    }));
    history = history.filter(Boolean).slice(0, 100);
    await mkdir(path.dirname(context.storeReadMetricsPath), { recursive: true });
    await writeFile(context.storeReadMetricsPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    invalidateApiJsonCachePath(context, context.storeReadMetricsPath);
  } catch {
    // Store read metrics are diagnostic; table reads should not fail if they cannot be recorded.
  }
}

function normalizeStoreReadMetric(metric) {
  if (!metric || typeof metric !== "object" || Array.isArray(metric)) return null;
  return {
    createdAt: typeof metric.createdAt === "string" ? metric.createdAt : null,
    table: typeof metric.table === "string" ? metric.table : "unknown",
    offset: Number.isInteger(metric.offset) ? metric.offset : 0,
    limit: Number.isInteger(metric.limit) ? metric.limit : 0,
    returned: Number.isInteger(metric.returned) ? metric.returned : 0,
    scannedLines: Number.isInteger(metric.scannedLines) ? metric.scannedLines : 0,
    durationMs: Number.isFinite(metric.durationMs) ? metric.durationMs : 0,
  };
}

function summarizeStoreReadMetrics(items) {
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
    .map((bucket) => ({
      table: bucket.table,
      reads: bucket.reads,
      averageMs: averageFinite(bucket._durationMs),
      maxMs: Math.max(...bucket._durationMs),
      averageScannedLines: averageFinite(bucket._scannedLines),
    }))
    .sort((a, b) => b.maxMs - a.maxMs || a.table.localeCompare(b.table));
  const slowest = tables[0] ?? null;
  return {
    sampleSize: items.length,
    latestAt: items[0]?.createdAt ?? null,
    averageReadMs: averageFinite(items.map((item) => item.durationMs)),
    slowestTable: slowest?.table ?? null,
    slowestReadMs: slowest?.maxMs ?? null,
    tables,
    retention: {
      maxItems: 100,
    },
  };
}

async function cacheFileStatus(context, name, configPath) {
  const file = await checkFile(resolveConfigPath(context.configContext, configPath));
  return {
    name,
    exists: Boolean(file.exists && file.type === "file"),
    bytes: file.exists && file.type === "file" ? file.bytes : null,
    modifiedAt: file.exists && file.type === "file" ? file.modifiedAt : null,
  };
}

function averageFinite(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return Math.round(finite.reduce((total, value) => total + value, 0) / finite.length);
}

function refreshStatus(phase) {
  if (!phase || phase === "idle") return "idle";
  if (phase === "done") return "succeeded";
  if (phase === "cancelled") return "cancelled";
  if (phase === "failed") return "failed";
  return "running";
}

function classifyRefreshError(refresh) {
  if (!refresh?.error && refresh?.phase === "done") return null;
  if (refresh?.phase === "cancelled" || refresh?.cancelRequested) return "cancelled";
  const error = String(refresh?.error ?? "");
  if (/Report refresh exited/i.test(error)) return "report_refresh_failed";
  if (/Store export exited/i.test(error)) return "store_export_failed";
  if (/Could not commit refreshed outputs/i.test(error)) return "commit_failed";
  if (/spawn|ENOENT|EACCES|EPERM/i.test(error)) return "process_error";
  return error ? "unknown_failure" : null;
}

function durationBetweenMs(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function createPhaseTimings(initialPhase, startedAt) {
  const timings = {};
  if (initialPhase && !isTerminalRefreshPhase(initialPhase)) {
    timings[initialPhase] = {
      startedAt,
      finishedAt: null,
      durationMs: null,
    };
  }
  return timings;
}

function transitionRefreshPhase(refresh, nextPhase, at = new Date().toISOString()) {
  if (!nextPhase || refresh.phase === nextPhase) {
    ensureActiveRefreshPhase(refresh, refresh.phase, at);
    return;
  }
  finishActiveRefreshPhase(refresh, at);
  refresh.phase = nextPhase;
  ensureActiveRefreshPhase(refresh, nextPhase, at);
}

function ensureActiveRefreshPhase(refresh, phase, at = new Date().toISOString()) {
  if (!phase || isTerminalRefreshPhase(phase)) return;
  refresh.phaseTimings ??= {};
  if (!refresh.phaseTimings[phase] || refresh.phaseTimings[phase].finishedAt) {
    refresh.phaseTimings[phase] = {
      startedAt: at,
      finishedAt: null,
      durationMs: null,
    };
  }
}

function finishActiveRefreshPhase(refresh, at = new Date().toISOString()) {
  const phase = refresh.phase;
  if (!phase || isTerminalRefreshPhase(phase)) return;
  ensureActiveRefreshPhase(refresh, phase, refresh.startedAt ?? at);
  const timing = refresh.phaseTimings?.[phase];
  if (!timing || timing.finishedAt) return;
  timing.finishedAt = at;
  timing.durationMs = durationBetweenMs(timing.startedAt, timing.finishedAt);
}

function publicPhaseTimings(refresh) {
  return normalizePhaseTimings(refresh.phaseTimings ?? {}, refresh.running ? new Date().toISOString() : null);
}

function normalizePhaseTimings(timings, now = null) {
  if (!timings || typeof timings !== "object" || Array.isArray(timings)) return {};
  return Object.fromEntries(
    Object.entries(timings)
      .filter(([phase, timing]) => phase && timing && typeof timing === "object" && !Array.isArray(timing))
      .map(([phase, timing]) => {
        const startedAt = timing.startedAt ?? null;
        const finishedAt = timing.finishedAt ?? null;
        const durationMs = Number.isFinite(timing.durationMs)
          ? timing.durationMs
          : durationBetweenMs(startedAt, finishedAt ?? now);
        return [phase, { startedAt, finishedAt, durationMs }];
      }),
  );
}

function phaseDurationsMs(refresh) {
  const timings = normalizePhaseTimings(refresh.phaseTimings ?? {}, refresh.running ? new Date().toISOString() : null);
  return Object.fromEntries(
    Object.entries(timings)
      .filter(([, timing]) => Number.isFinite(timing.durationMs))
      .map(([phase, timing]) => [phase, timing.durationMs]),
  );
}

function isTerminalRefreshPhase(phase) {
  return phase === "idle" || phase === "done" || phase === "failed" || phase === "cancelled";
}

function appendRefreshLog(refresh, chunk) {
  const text = chunk.toString("utf8").trim();
  if (!text) return;
  const lines = text.split(/\r?\n/).slice(-20);
  const userLines = [];
  for (const line of lines) {
    if (updateRefreshPhaseFromLog(refresh, line)) continue;
    userLines.push(line);
  }
  refresh.log.push(...userLines);
  refresh.log = refresh.log.slice(-50);
}

function updateRefreshPhaseFromLog(refresh, line) {
  const progress = parseProgressLine(line);
  if (progress) {
    mergeRefreshDiagnostics(refresh, progress.diagnostics);
    const phase = progress.phase === "extract_chat_lines" ? "parse" : progress.phase;
    if (phase) transitionRefreshPhase(refresh, phase);
    if (typeof progress.percent === "number") {
      refresh.percent = Math.max(refresh.percent, Math.max(0, Math.min(100, progress.percent)));
    } else {
      refresh.percent = Math.max(refresh.percent, progressPercent(progress));
    }
    refresh.currentFile = progress.currentFile ?? refresh.currentFile ?? null;
    refresh.filesDone = Number.isFinite(progress.filesDone) ? progress.filesDone : refresh.filesDone;
    refresh.filesTotal = Number.isFinite(progress.filesTotal) ? progress.filesTotal : refresh.filesTotal;
    return true;
  }
  if (/Analyzing sessions and playtime/i.test(line)) {
    transitionRefreshPhase(refresh, "scan");
    refresh.percent = Math.max(refresh.percent, 10);
  } else if (/Analyzing chat events/i.test(line)) {
    transitionRefreshPhase(refresh, "parse");
    refresh.percent = Math.max(refresh.percent, 35);
  } else if (/Building rounds and final report/i.test(line)) {
    transitionRefreshPhase(refresh, "build_report");
    refresh.percent = Math.max(refresh.percent, 65);
  } else if (/Wrote/i.test(line)) {
    refresh.percent = Math.max(refresh.percent, 75);
  }
  return false;
}

function parseProgressLine(line) {
  const marker = "@@MLO_PROGRESS@@";
  if (!line.startsWith(marker)) return null;
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    return null;
  }
}

function progressPercent(progress) {
  const filesDone = Number(progress.filesDone);
  const filesTotal = Number(progress.filesTotal);
  const ratio = filesTotal > 0 ? filesDone / filesTotal : 0;
  if (progress.phase === "scan") return 10 + Math.round(ratio * 20);
  if (progress.phase === "extract_chat_lines") return 30 + Math.round(ratio * 20);
  if (progress.phase === "parse") return 45 + Math.round(ratio * 20);
  if (progress.phase === "build_report") return 65;
  return refreshPhaseMinimum(progress.phase);
}

function mergeRefreshDiagnostics(refresh, diagnostics) {
  const sanitized = privacySafeRefreshDiagnostics(diagnostics);
  if (!sanitized) return;
  refresh.diagnostics = {
    ...(refresh.diagnostics ?? {}),
    ...sanitized,
  };
}

function privacySafeRefreshDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return null;
  const output = {};
  for (const section of ["discovery", "scan", "parse", "chatLines", "chatEvents"]) {
    const value = diagnostics[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const sanitized = sanitizeRefreshDiagnosticSection(value);
    if (Object.keys(sanitized).length) output[section] = sanitized;
  }
  return Object.keys(output).length ? output : null;
}

function sanitizeRefreshDiagnosticSection(value) {
  const allowedFields = [
    "roots",
    "scopes",
    "files",
    "bytes",
    "latestModifiedMs",
    "durationMs",
    "chatLines",
    "matched",
    "cacheHits",
    "cacheMisses",
    "cacheSkippedFiles",
  ];
  return Object.fromEntries(
    allowedFields
      .filter((field) => Number.isFinite(value[field]))
      .map((field) => [field, value[field]]),
  );
}

function summarizeRefreshDiagnostics(activeRefresh, historyItems = []) {
  const latest = activeRefresh?.running
    ? privacySafeRefreshDiagnostics(activeRefresh.diagnostics)
    : privacySafeRefreshDiagnostics(historyItems[0]?.diagnostics);
  const succeeded = historyItems
    .filter((item) => item.status === "succeeded")
    .map((item) => privacySafeRefreshDiagnostics(item.diagnostics))
    .filter(Boolean);
  return {
    latest,
    averages: averageRefreshDiagnostics(succeeded),
  };
}

function averageRefreshDiagnostics(items) {
  const output = {};
  for (const section of ["discovery", "scan", "parse", "chatLines", "chatEvents"]) {
    const rows = items.map((item) => item[section]).filter(Boolean);
    if (!rows.length) continue;
    const fields = new Set(rows.flatMap((row) => Object.keys(row)));
    const sectionAverages = Object.fromEntries(
      [...fields]
        .sort()
        .map((field) => [field, averageFinite(rows.map((row) => row[field]))])
        .filter(([, value]) => Number.isFinite(value)),
    );
    if (Object.keys(sectionAverages).length) output[section] = sectionAverages;
  }
  return Object.keys(output).length ? output : null;
}

function refreshPhaseMinimum(phase) {
  return {
    scan: 10,
    parse: 35,
    build_report: 65,
    export_store: 85,
    done: 100,
  }[phase] ?? 0;
}

async function accountsResponse(context) {
  const report = await readReport(context);
  return jsonResponse(200, withPlayerBedDestroyAliases(report.accounts));
}

async function accountsPlaytimeResponse(context, url) {
  const report = await readReport(context);
  const source = url.searchParams.get("source");
  const user = url.searchParams.get("user");
  const rows = (report.accounts.playtimeByUser ?? []).filter((row) => {
    if (source && !row.sources?.includes(source)) return false;
    if (user && row.user !== user) return false;
    return true;
  });
  const pagination = readPagination(url, 100, 1000);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  return jsonResponse(200, {
    filters: { source, user },
    total: rows.length,
    offset,
    limit,
    items: withPlayerBedDestroyAliases(rows.slice(offset, offset + limit)),
  });
}

async function accountDetailResponse(context, url) {
  const report = await readReport(context);
  const user = decodeURIComponent(url.pathname.slice("/api/accounts/".length));
  if (user === "owner") return jsonResponse(200, withPlayerBedDestroyAliases(report.accounts.owner));
  const row = report.accounts.localUsers.find((account) => account.user === user);
  if (!row) return errorResponse(404, "account_not_found", "Account was not found.", { user });
  return jsonResponse(200, withPlayerBedDestroyAliases(row));
}

async function sourcesResponse(context, url) {
  const report = await readReport(context);
  return pagedRows(url, report.bySource, { total: report.bySource.length });
}

async function scopesResponse(context, url) {
  const report = await readReport(context);
  const source = url.searchParams.get("source");
  const rows = report.byScope.filter((scope) => !source || scope.source === source);
  return pagedRows(url, rows, { total: rows.length, filters: { source } });
}

async function daysResponse(context, url) {
  const report = await readReport(context);
  const filterResult = readDaysFilters(url);
  if (filterResult.response) return filterResult.response;
  const filters = filterResult.filters;
  const rows = report.byDay.filter((day) => {
    if (filters.dateFrom && day.date < filters.dateFrom) return false;
    if (filters.dateTo && day.date > filters.dateTo) return false;
    return true;
  });
  return pagedRows(url, rows, { total: rows.length, filters });
}

async function rulesResponse(context) {
  const report = await readReport(context);
  return jsonResponse(200, report.rules);
}

async function rulePacksResponse(context) {
  const customRulePaths = resolveCustomRulePaths(context);
  try {
    const inventory = await buildRulePackInventory(context);
    return jsonResponse(200, {
      customRulePaths,
      ...inventory,
    });
  } catch (error) {
    return invalidRulePackConfigResponse(customRulePaths, error);
  }
}

async function validateRulePacksResponse(context) {
  const customRulePaths = resolveCustomRulePaths(context);
  try {
    const customRuleSets = loadCustomRuleSets(customRulePaths);
    return jsonResponse(200, {
      ok: true,
      customRulePaths,
      total: customRuleSets.length,
      items: customRuleSets.map((ruleSet) => ({
        id: ruleSet.id,
        name: ruleSet.name,
        filePath: ruleSet.filePath,
        rules: ruleSet.rules.length,
      })),
    });
  } catch (error) {
    return invalidRulePackConfigResponse(customRulePaths, error);
  }
}

function invalidRulePackConfigResponse(customRulePaths, error) {
  return errorResponse(400, "invalid_rule_pack_config", "Configured custom rule packs could not be loaded.", {
    customRulePaths,
    details: error.message,
    errorCode: error.code ?? null,
  });
}

function readRequestCustomRulePaths(context, value) {
  if (value === undefined) return { paths: resolveCustomRulePaths(context) };
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return {
      response: errorResponse(400, "invalid_custom_rule_paths", "customRulePaths must be an array of safe project-relative rule-pack paths.", {
        errors: [{ field: "customRulePaths", error: "expected_string_array" }],
      }),
    };
  }

  const customRules = uniqueStrings(value.map((item) => item.trim()).filter(Boolean));
  const errors = [];
  for (const customRule of customRules) {
    const validation = validateApiCustomRulePath(context, customRule);
    if (!validation.ok) {
      errors.push({ field: "customRulePaths", value: customRule, error: validation.error });
    }
  }
  if (errors.length) {
    return {
      response: errorResponse(400, "invalid_custom_rule_paths", "customRulePaths must be safe project-relative rule-pack directories or .json files.", { errors }),
    };
  }

  return {
    paths: customRules.map((customRule) => resolveConfigPath(context.configContext, customRule)),
  };
}

function readRequestRuleSets(value, customRulePaths) {
  if (value === undefined || value === null) return { ruleSets: null };
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return {
      response: errorResponse(400, "invalid_rule_sets", "ruleSets must be an array of known rule set ids.", {
        errors: [{ field: "ruleSets", error: "expected_string_array" }],
      }),
    };
  }

  const ruleSets = uniqueStrings(value.map((item) => item.trim()).filter(Boolean));
  if (!ruleSets.length) return { ruleSets: null };

  let allowed;
  try {
    allowed = listRuleSets({ customRulePaths }).map((ruleSet) => ruleSet.id).sort();
  } catch (error) {
    return { response: invalidRulePackConfigResponse(customRulePaths, error) };
  }
  const unknown = ruleSets.filter((ruleSet) => !allowed.includes(ruleSet));
  if (unknown.length) {
    return {
      response: errorResponse(400, "invalid_rule_sets", "ruleSets contains unknown rule set ids.", {
        unknown,
        allowed,
      }),
    };
  }
  return { ruleSets };
}

async function storeResponse(context) {
  const manifestResult = await readStoreManifestForApi(context, "report store");
  if (manifestResult.response) return manifestResult.response;
  return jsonResponse(200, manifestResult.manifest);
}

async function storeTableResponse(context, url) {
  const manifestResult = await readStoreManifestForApi(context, "store tables");
  if (manifestResult.response) return manifestResult.response;
  const manifest = manifestResult.manifest;
  const name = url.searchParams.get("name") ?? url.searchParams.get("table");
  if (!name) {
    return errorResponse(400, "missing_store_table", "Provide a store table name.", { allowed: storeJsonlTableNames(manifest) });
  }
  const fileName = manifest.files?.[name];
  if (!fileName || !fileName.endsWith(".jsonl")) {
    return errorResponse(400, "invalid_store_table", "Store table must be a JSONL table declared by the manifest.", { name, allowed: storeJsonlTableNames(manifest) });
  }
  const filePath = path.resolve(context.storeDir, fileName);
  if (!isSameOrInside(filePath, path.resolve(context.storeDir))) {
    return errorResponse(400, "invalid_store_table_path", "Store table path is outside the report store.");
  }
  const pagination = readPagination(url, 100, 1000);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  const declaredTotal = Number.isFinite(manifest.counts?.[name]) ? manifest.counts[name] : null;
  let rows;
  const started = process.hrtime.bigint();
  try {
    rows = await readJsonlPage(filePath, { offset, limit, stopAfterPage: declaredTotal !== null });
  } catch (error) {
    if (error.code === "ENOENT") {
      return errorResponse(503, "store_table_not_ready", "A declared store table file is missing. Refresh to regenerate the report store.", {
        name,
        file: fileName,
      });
    }
    if (error instanceof SyntaxError) {
      return errorResponse(503, "store_table_invalid_jsonl", "A declared store table contains invalid JSONL. Refresh to regenerate the report store.", {
        name,
        file: fileName,
        details: error.message,
      });
    }
    throw error;
  }
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const total = declaredTotal ?? rows.total;
  await appendStoreReadMetric(context, {
    table: name,
    offset,
    limit,
    returned: rows.items.length,
    scannedLines: rows.scannedLines,
    durationMs,
  });
  return jsonResponse(200, {
    name,
    file: fileName,
    total,
    offset,
    limit,
    items: rows.items,
    truncated: offset + rows.items.length < total,
    read: {
      durationMs,
      scannedLines: rows.scannedLines,
      source: declaredTotal !== null ? "manifest_count" : "line_count",
      metricsRecorded: true,
    },
    source: {
      storeManifest: context.storeManifestPath,
      reportGeneratedAt: manifest.reportGeneratedAt ?? null,
      storeGeneratedAt: manifest.generatedAt ?? null,
    },
  });
}

async function readStoreManifestForApi(context, purpose) {
  try {
    const manifest = await readJson(context, context.storeManifestPath, { kind: "store_manifest" });
    const validation = validateStoreManifestShape(manifest);
    if (!validation.ok) {
      return {
        response: storeInvalidManifestResponse(context, validation),
      };
    }
    return { manifest };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        response: errorResponse(503, "store_not_ready", `Run a refresh or npm run store:export before querying ${purpose}.`, {
          manifestPath: context.storeManifestPath,
        }),
      };
    }
    if (error instanceof SyntaxError) {
      return {
        response: errorResponse(503, "store_invalid_json", "Report store manifest is not valid JSON. Refresh to regenerate the report store.", {
          manifestPath: context.storeManifestPath,
          details: error.message,
        }),
      };
    }
    throw error;
  }
}

function storeInvalidManifestResponse(context, validation) {
  return errorResponse(503, "store_invalid_manifest", "Report store manifest has an unsupported shape. Refresh to regenerate the report store.", {
    manifestPath: context.storeManifestPath,
    reason: validation.reason,
    details: validation.message,
  });
}

function validateReportShape(report) {
  if (!isObjectRecord(report)) return invalidDataShape("report_not_object", "Report must be a JSON object.");
  if (!isObjectRecord(report.schema)) return invalidDataShape("missing_schema", "Report schema must be an object.");
  if (report.schema.name !== reportSchemaName) return invalidDataShape("invalid_schema_name", `Report schema.name must be ${reportSchemaName}.`);
  if (report.schema.version !== 1) return invalidDataShape("invalid_schema_version", "Report schema.version must be 1.");
  if (report.version !== 1) return invalidDataShape("invalid_version", "Report version must be 1.");
  if (typeof report.generatedAt !== "string" || !report.generatedAt) return invalidDataShape("missing_generated_at", "Report generatedAt must be a non-empty string.");
  if (!isObjectRecord(report.overview)) return invalidDataShape("missing_overview", "Report overview must be an object.");
  if (!isObjectRecord(report.rounds)) return invalidDataShape("missing_rounds", "Report rounds must be an object.");
  if (!isObjectRecord(report.rounds.summary)) return invalidDataShape("missing_rounds_summary", "Report rounds.summary must be an object.");
  if (!Array.isArray(report.rounds.reliable)) return invalidDataShape("missing_reliable_rounds", "Report rounds.reliable must be an array.");
  if (!Array.isArray(report.rounds.ignored)) return invalidDataShape("missing_ignored_rounds", "Report rounds.ignored must be an array.");
  if (!Array.isArray(report.rounds.all)) return invalidDataShape("missing_all_rounds", "Report rounds.all must be an array.");
  if (!Array.isArray(report.byDay)) return invalidDataShape("missing_by_day", "Report byDay must be an array.");
  if (!Array.isArray(report.byWeek)) return invalidDataShape("missing_by_week", "Report byWeek must be an array.");
  if (!Array.isArray(report.byMonth)) return invalidDataShape("missing_by_month", "Report byMonth must be an array.");
  if (!Array.isArray(report.bySource)) return invalidDataShape("missing_by_source", "Report bySource must be an array.");
  if (!Array.isArray(report.byScope)) return invalidDataShape("missing_by_scope", "Report byScope must be an array.");
  if (!isObjectRecord(report.profile)) return invalidDataShape("missing_profile", "Report profile must be an object.");
  if (!isObjectRecord(report.accounts)) return invalidDataShape("missing_accounts", "Report accounts must be an object.");
  if (!isObjectRecord(report.rules)) return invalidDataShape("missing_rules", "Report rules must be an object.");
  return { ok: true, reason: null, message: null };
}

function validateSummaryShape(summary) {
  if (!isObjectRecord(summary)) return invalidDataShape("summary_not_object", "Summary must be a JSON object.");
  if (!isObjectRecord(summary.schema)) return invalidDataShape("missing_schema", "Summary schema must be an object.");
  if (summary.schema.name !== summarySchemaName) return invalidDataShape("invalid_schema_name", `Summary schema.name must be ${summarySchemaName}.`);
  if (summary.schema.version !== 1) return invalidDataShape("invalid_schema_version", "Summary schema.version must be 1.");
  if (summary.schema.reportSchema?.name !== reportSchemaName) {
    return invalidDataShape("invalid_report_schema_name", `Summary schema.reportSchema.name must be ${reportSchemaName}.`);
  }
  if (typeof summary.generatedAt !== "string" || !summary.generatedAt) return invalidDataShape("missing_generated_at", "Summary generatedAt must be a non-empty string.");
  if (!isObjectRecord(summary.overview)) return invalidDataShape("missing_overview", "Summary overview must be an object.");
  if (!isObjectRecord(summary.rounds)) return invalidDataShape("missing_rounds", "Summary rounds must be an object.");
  if (!isObjectRecord(summary.profile)) return invalidDataShape("missing_profile", "Summary profile must be an object.");
  if (!isObjectRecord(summary.accounts)) return invalidDataShape("missing_accounts", "Summary accounts must be an object.");
  if (!isObjectRecord(summary.anomalies)) return invalidDataShape("missing_anomalies", "Summary anomalies must be an object.");
  return { ok: true, reason: null, message: null };
}

function validateStoreManifestShape(manifest) {
  if (!isObjectRecord(manifest)) return invalidStoreManifest("manifest_not_object", "Manifest must be a JSON object.");
  if (!isObjectRecord(manifest.schema)) return invalidStoreManifest("missing_schema", "Manifest schema must be an object.");
  if (manifest.schema.name !== storeManifestSchemaName) {
    return invalidStoreManifest("invalid_schema_name", `Manifest schema.name must be ${storeManifestSchemaName}.`);
  }
  if (manifest.schema.version !== 1) return invalidStoreManifest("invalid_schema_version", "Manifest schema.version must be 1.");
  if (typeof manifest.generatedAt !== "string" || !manifest.generatedAt) {
    return invalidStoreManifest("missing_generated_at", "Manifest generatedAt must be a non-empty string.");
  }
  if (typeof manifest.reportGeneratedAt !== "string" || !manifest.reportGeneratedAt) {
    return invalidStoreManifest("missing_report_generated_at", "Manifest reportGeneratedAt must be a non-empty string.");
  }
  if (!isObjectRecord(manifest.files)) return invalidStoreManifest("missing_files", "Manifest files must be an object.");
  if (!isObjectRecord(manifest.counts)) return invalidStoreManifest("missing_counts", "Manifest counts must be an object.");

  for (const [key, fileName] of Object.entries(manifest.files)) {
    if (!isSafeStoreManifestFileName(fileName)) {
      return invalidStoreManifest("invalid_file", `Manifest files.${key} must be a safe relative file name.`);
    }
  }

  for (const key of requiredStoreFiles) {
    const fileName = manifest.files[key];
    if (!fileName) {
      return invalidStoreManifest("missing_file", `Manifest files.${key} is required.`);
    }
  }

  const jsonlTables = storeJsonlTableNames(manifest);
  if (!jsonlTables.length) return invalidStoreManifest("missing_jsonl_tables", "Manifest must declare at least one JSONL table.");
  for (const tableName of jsonlTables) {
    const count = manifest.counts[tableName];
    if (!Number.isInteger(count) || count < 0) {
      return invalidStoreManifest("invalid_count", `Manifest counts.${tableName} must be a non-negative integer.`);
    }
  }

  return { ok: true, reason: null, message: null };
}

async function validateStoreFilesForStatus(context, manifest, manifestValidation) {
  if (!manifestValidation.ok) return { ok: false, reason: null, message: null, files: [] };
  const storeDir = path.resolve(context.storeDir);
  const missing = [];
  for (const [name, fileName] of Object.entries(manifest.files ?? {})) {
    const filePath = path.resolve(storeDir, fileName);
    if (!isSameOrInside(filePath, storeDir)) {
      return {
        ok: false,
        reason: "invalid_file_path",
        message: `Store manifest file ${name} resolves outside the report store.`,
        files: [{ name, file: fileName }],
      };
    }
    const file = await checkFile(filePath);
    if (!file.exists || file.type !== "file") {
      missing.push({ name, file: fileName });
    }
  }
  if (missing.length) {
    return {
      ok: false,
      reason: "missing_files",
      message: "Store manifest declares files that are missing. Refresh to regenerate the report store.",
      files: missing.slice(0, 20),
      missingCount: missing.length,
    };
  }
  return { ok: true, reason: null, message: null, files: [] };
}

function invalidStoreManifest(reason, message) {
  return { ok: false, reason, message };
}

function invalidDataShape(reason, message) {
  return { ok: false, reason, message };
}

function dataFileError(code, details, extra = {}) {
  const error = new Error(details);
  error.code = code;
  error.details = details;
  Object.assign(error, extra);
  return error;
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeStoreManifestFileName(fileName) {
  if (typeof fileName !== "string" || !fileName) return false;
  if (fileName.includes("\0")) return false;
  if (path.isAbsolute(fileName) || path.posix.isAbsolute(fileName) || path.win32.isAbsolute(fileName)) return false;
  const normalized = path.posix.normalize(fileName.replace(/\\/g, "/"));
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}

function storeJsonlTableNames(manifest) {
  return Object.entries(manifest.files ?? {})
    .filter(([, fileName]) => String(fileName).endsWith(".jsonl"))
    .map(([name]) => name)
    .sort();
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

async function timeSeriesResponse(context, url) {
  const report = await readReport(context);
  const period = url.searchParams.get("period") ?? "day";
  const key = {
    day: "byDay",
    week: "byWeek",
    month: "byMonth",
  }[period];

  if (!key) return errorResponse(400, "invalid_period", "Period must be day, week, or month.", { allowed: ["day", "week", "month"] });
  return jsonResponse(200, {
    period,
    total: report[key].length,
    items: report[key],
  });
}

async function unmatchedResponse(context) {
  try {
    return jsonResponse(200, await readJson(context, context.unmatchedPath, { kind: "unmatched_debug" }));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const report = await readReport(context);
    return jsonResponse(200, {
      generatedAt: report.generatedAt,
      roots: report.roots,
      encoding: report.encoding,
      categories: report.rules.topUnmatchedByCategory ?? report.rules.unmatchedByCategory,
      templates: report.anomalies.unmatchedTemplates,
    });
  }
}

function publicConfig(config) {
  return {
    roots: config.roots ?? [],
    encoding: config.encoding,
    rules: config.rules ?? [],
    customRules: config.customRules ?? [],
    scopes: config.scopes ?? [],
    unmatchedTemplatesLimit: config.unmatchedTemplatesLimit,
    owner: {
      mode: config.owner?.mode ?? "all_local_users",
      displayName: config.owner?.displayName ?? "Owner",
      aliases: config.owner?.aliases ?? [],
    },
    app: {
      dataDir: config.app?.dataDir ?? "data",
      skinProxyEnabled: config.app?.skinProxyEnabled !== false,
    },
    outputs: {
      report: config.outputs?.report,
      summary: config.outputs?.summary,
    },
  };
}

function publicAppRuntimeStatus(context) {
  const enabled = context.configContext.config.app?.skinProxyEnabled !== false;
  return {
    dataDir: context.dataDir,
    storeDir: context.storeDir,
    launcher: publicLauncherContract(context),
    skinProxyEnabled: enabled,
    skinProxy: {
      enabled,
      remoteRequestsAllowed: enabled,
    },
  };
}

function publicLauncherContract(context) {
  return {
    contractVersion: 1,
    runtimeStateFile: path.resolve(context.configContext.dir, ".cache/api-server.json"),
    bindPolicy: {
      localOnly: true,
      allowedHosts: ["127.0.0.1", "localhost", "::1"],
      defaultHost: "127.0.0.1",
      defaultPort: 8787,
      supportsPortFallback: true,
    },
    lifecycle: {
      startCommand: "npm.cmd run api",
      gracefulShutdown: {
        ipcMessages: ["shutdown", "mlo_shutdown"],
        signals: ["SIGINT", "SIGTERM"],
      },
    },
    desktopIntegration: {
      directoryPickerRequired: true,
      directoryPickerEndpoint: "POST /api/system/select-directory",
      rootValidationEndpoint: "POST /api/config/validate-roots",
      saveConfigEndpoint: "PUT /api/config",
      statusEndpoint: "GET /api/app/status",
      refreshEndpoint: "POST /api/refresh",
    },
  };
}

async function sanitizeLocalConfigPatch(context, body) {
  const errors = [];
  const existing = (await readJsonOptional(context, context.configContext.localPath, { kind: "local_config" })) ?? {};
  const next = { ...existing };
  const allowedTopLevel = new Set(["roots", "owner", "customRules", "app", "outputs"]);

  for (const key of Object.keys(body ?? {})) {
    if (!allowedTopLevel.has(key)) errors.push({ field: key, error: "unsupported_field" });
  }

  if ("roots" in body) {
    if (!Array.isArray(body.roots) || !body.roots.every((value) => typeof value === "string")) {
      errors.push({ field: "roots", error: "expected_string_array" });
    } else {
      const roots = body.roots.map((value) => value.trim()).filter(Boolean);
      if (roots.length) {
        const validation = await validateLogRoots(context, roots, { encoding: context.configContext.config.encoding });
        const invalidRoots = validation.roots.filter((root) => !root.valid);
        if (invalidRoots.length) errors.push({ field: "roots", error: "invalid_roots", roots: invalidRoots });
      }
      next.roots = uniqueStrings(roots);
    }
  }

  if ("owner" in body) {
    if (!body.owner || typeof body.owner !== "object" || Array.isArray(body.owner)) {
      errors.push({ field: "owner", error: "expected_object" });
    } else {
      const owner = { ...(existing.owner ?? {}) };
      for (const key of Object.keys(body.owner)) {
        if (!new Set(["aliases", "displayName"]).has(key)) errors.push({ field: `owner.${key}`, error: "unsupported_field" });
      }
      if ("aliases" in body.owner) {
        if (!Array.isArray(body.owner.aliases) || !body.owner.aliases.every((value) => typeof value === "string")) {
          errors.push({ field: "owner.aliases", error: "expected_string_array" });
        } else {
          owner.aliases = uniqueStrings(body.owner.aliases.map((value) => value.trim()).filter(Boolean));
        }
      }
      if ("displayName" in body.owner) {
        if (typeof body.owner.displayName !== "string" || !body.owner.displayName.trim()) {
          errors.push({ field: "owner.displayName", error: "expected_non_empty_string" });
        } else {
          owner.displayName = body.owner.displayName.trim();
        }
      }
      next.owner = owner;
    }
  }

  if ("customRules" in body) {
    if (!Array.isArray(body.customRules) || !body.customRules.every((value) => typeof value === "string")) {
      errors.push({ field: "customRules", error: "expected_string_array" });
    } else {
      const customRules = uniqueStrings(body.customRules.map((value) => value.trim()).filter(Boolean));
      for (const customRule of customRules) {
        const validation = validateApiCustomRulePath(context, customRule, next.roots ?? context.configContext.config.roots);
        if (!validation.ok) {
          errors.push({ field: "customRules", value: customRule, error: validation.error });
        }
      }
      next.customRules = customRules;
    }
  }

  if ("app" in body) {
    if (!body.app || typeof body.app !== "object" || Array.isArray(body.app)) {
      errors.push({ field: "app", error: "expected_object" });
    } else {
      const app = { ...(existing.app ?? {}) };
      for (const key of Object.keys(body.app)) {
        if (!new Set(["dataDir", "skinProxyEnabled"]).has(key)) errors.push({ field: `app.${key}`, error: "unsupported_field" });
      }
      if ("dataDir" in body.app) {
        const validation = validateApiDataDirPath(context, body.app.dataDir, next.roots ?? context.configContext.config.roots);
        if (!validation.ok) {
          errors.push({ field: "app.dataDir", error: validation.error });
        } else {
          app.dataDir = validation.value;
        }
      }
      if ("skinProxyEnabled" in body.app) {
        if (typeof body.app.skinProxyEnabled !== "boolean") {
          errors.push({ field: "app.skinProxyEnabled", error: "expected_boolean" });
        } else {
          app.skinProxyEnabled = body.app.skinProxyEnabled;
        }
      }
      next.app = app;
    }
  }

  if ("outputs" in body) {
    if (!body.outputs || typeof body.outputs !== "object" || Array.isArray(body.outputs)) {
      errors.push({ field: "outputs", error: "expected_object" });
    } else {
      const outputs = { ...(existing.outputs ?? {}) };
      for (const key of Object.keys(body.outputs)) {
        if (!new Set(["report", "summary"]).has(key)) errors.push({ field: `outputs.${key}`, error: "unsupported_field" });
      }
      for (const key of ["report", "summary"]) {
        if (!(key in body.outputs)) continue;
        const value = body.outputs[key];
        const validation = validateApiOutputPath(context, value);
        if (!validation.ok) {
          errors.push({ field: `outputs.${key}`, error: validation.error });
        } else {
          outputs[key] = validation.value;
        }
      }
      const effectiveOutputs = { ...(context.configContext.config.outputs ?? {}), ...outputs };
      if (
        effectiveOutputs.report &&
        effectiveOutputs.summary &&
        sameResolvedPath(
          resolveConfigPath(context.configContext, effectiveOutputs.report),
          resolveConfigPath(context.configContext, effectiveOutputs.summary),
        )
      ) {
        errors.push({ field: "outputs", error: "report_summary_must_be_distinct" });
      }
      next.outputs = outputs;
    }
  }

  return { config: next, errors };
}

async function validateLogRoots(context, roots, options = {}) {
  const encoding = options.encoding ?? context.configContext.config.encoding;
  const seen = new Set();
  const items = [];
  for (const root of roots) {
    const rawPath = String(root ?? "").trim();
    const resolvedPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(context.configContext.dir, rawPath);
    const normalizedKey = resolvedPath.toLowerCase();
    const issues = [];
    if (!rawPath) issues.push({ code: "empty_root", message: "Root path is empty." });
    if (seen.has(normalizedKey)) issues.push({ code: "duplicate_root", message: "Root path is duplicated." });
    seen.add(normalizedKey);

    const item = {
      root: options.redact ? redactPath(resolvedPath) : resolvedPath,
      input: options.redact ? redactPath(rawPath) : rawPath,
      exists: false,
      readable: false,
      type: null,
      scopes: 0,
      logFiles: 0,
      sampleReadable: false,
      issues,
      recommendations: [],
      valid: false,
    };

    if (!rawPath) {
      items.push(finishRootValidationItem(item));
      continue;
    }

    try {
      const rootStat = await stat(resolvedPath);
      item.exists = true;
      item.type = rootStat.isDirectory() ? "directory" : "file";
      if (!rootStat.isDirectory()) {
        item.issues.push({ code: "not_directory", message: "Root path must be a directory." });
        items.push(finishRootValidationItem(item));
        continue;
      }
      item.readable = true;
      const scopes = await discoverScopes(resolvedPath);
      item.scopes = scopes.length;
      if (!scopes.length) item.issues.push({ code: "no_log_scopes", message: "No logs directory found at root/logs or root/versions/*/logs." });
      const filesByScope = await Promise.all(scopes.map((scope) => discoverLogFiles(scope)));
      const files = filesByScope.flat();
      item.logFiles = files.length;
      if (!files.length) item.issues.push({ code: "no_logs_found", message: "No .log, .log.gz, or !CHAT log files were found." });
      if (files.length) {
        try {
          for await (const _line of readLogLines(files[0], { encoding })) {
            item.sampleReadable = true;
            break;
          }
          if (!item.sampleReadable) {
            item.sampleReadable = true;
          }
        } catch (error) {
          item.issues.push({ code: "sample_unreadable", message: error.message });
        }
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        item.issues.push({ code: "not_found", message: "Root path does not exist." });
      } else if (error.code === "EACCES" || error.code === "EPERM") {
        item.exists = true;
        item.issues.push({ code: "permission_denied", message: "Root path is not readable." });
      } else {
        item.issues.push({ code: "read_error", message: error.message });
      }
    }
    items.push(finishRootValidationItem(item));
  }

  return {
    ok: items.length > 0 && items.every((item) => item.valid),
    encoding,
    total: items.length,
    logFiles: items.reduce((total, item) => total + item.logFiles, 0),
    roots: items,
  };
}

function finishRootValidationItem(item) {
  if (item.issues.some((issue) => issue.code === "not_found")) {
    item.recommendations.push("Choose the actual .minecraft directory, not a parent folder that does not exist.");
  }
  if (item.issues.some((issue) => issue.code === "no_log_scopes")) {
    item.recommendations.push("Choose a .minecraft directory that contains logs/ or versions/*/logs.");
  }
  if (item.issues.some((issue) => issue.code === "no_logs_found")) {
    item.recommendations.push("Start Minecraft once or choose a client directory that already has log files.");
  }
  item.valid = item.exists && item.readable && item.type === "directory" && item.logFiles > 0 && !item.issues.some((issue) => issue.code === "duplicate_root" || issue.code === "sample_unreadable");
  return item;
}

function cleanupTargets(context, scope) {
  const config = context.configContext.config;
  const cacheTargets = [
    { kind: "parse_cache", path: resolveConfigPath(context.configContext, config.cache.parse) },
    { kind: "chat_cache", path: resolveConfigPath(context.configContext, config.cache.chat) },
    { kind: "chat_lines_cache", path: resolveConfigPath(context.configContext, config.cache.chatLines) },
    { kind: "refresh_history", path: context.refreshHistoryPath },
    { kind: "rule_audit_history", path: context.ruleAuditPath },
    { kind: "unknown_audit_label_sets", path: context.unknownAuditLabelSetsPath },
    { kind: "store_read_metrics", path: context.storeReadMetricsPath },
  ];
  const reportTargets = [
    { kind: "report", path: context.reportPath },
    { kind: "summary", path: context.summaryPath },
    { kind: "unmatched_debug", path: context.unmatchedPath },
    { kind: "result_candidates", path: context.resultCandidatesPath },
  ];
  const storeTargets = [{ kind: "store", path: context.storeDir }];
  if (scope === "cache") return cacheTargets;
  if (scope === "report") return reportTargets;
  if (scope === "store") return storeTargets;
  return [...cacheTargets, ...reportTargets, ...storeTargets];
}

function validateDerivedTarget(context, targetPath) {
  const allowedTargets = cleanupTargets(context, "all_derived").map((target) => path.resolve(target.path));
  return validateApiWriteTarget(context, targetPath, {
    allowedTargets,
    allowInsideTargets: true,
    blockReservedProjectPaths: true,
    notAllowedReason: "target_not_derived",
  });
}

function validateRefreshWriteTargets(context) {
  const errors = [];
  const config = context.configContext.config;
  const reportValidation = validateApiOutputPath(context, config.outputs?.report);
  if (!reportValidation.ok) {
    errors.push({ field: "outputs.report", error: reportValidation.error });
  }
  const summaryValidation = validateApiOutputPath(context, config.outputs?.summary);
  if (!summaryValidation.ok) {
    errors.push({ field: "outputs.summary", error: summaryValidation.error });
  }
  if (reportValidation.ok && summaryValidation.ok) {
    const reportPath = resolveConfigPath(context.configContext, reportValidation.value);
    const summaryPath = resolveConfigPath(context.configContext, summaryValidation.value);
    if (sameResolvedPath(reportPath, summaryPath)) {
      errors.push({ field: "outputs", error: "report_summary_must_be_distinct" });
    }
  }

  const dataDirValidation = validateApiDataDirPath(context, config.app?.dataDir ?? "data");
  if (!dataDirValidation.ok) {
    errors.push({ field: "app.dataDir", error: dataDirValidation.error });
  }

  if (!errors.length) {
    for (const target of [
      { field: "outputs.report", path: context.reportPath },
      { field: "outputs.summary", path: context.summaryPath },
      { field: "outputs.unmatched", path: context.unmatchedPath },
      { field: "app.dataDir", path: context.storeDir },
    ]) {
      const safety = validateDerivedTarget(context, target.path);
      if (!safety.ok) {
        errors.push({ field: target.field, error: safety.reason });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateUserRulePackTarget(context, targetPath) {
  return validateApiWriteTarget(context, targetPath, {
    allowedRoots: [context.userRulePacksPath],
    extensions: [".json"],
    notAllowedReason: "target_not_managed_rule_pack",
  });
}

function validateUnknownAuditLabelSetTarget(context, targetPath) {
  return validateApiWriteTarget(context, targetPath, {
    allowedRoots: [context.unknownAuditLabelSetsPath],
    extensions: [".json"],
    notAllowedReason: "target_not_unknown_audit_label_set",
  });
}

function validateLocalConfigWriteTarget(context) {
  const localPath = path.resolve(context.configContext.localPath);
  const configDir = path.resolve(context.configContext.dir);
  if (!localPath.toLowerCase().endsWith(".json")) {
    return { ok: false, reason: "local_config_must_be_json" };
  }
  if (!isSameOrInside(localPath, configDir)) {
    return { ok: false, reason: "local_config_outside_config_dir" };
  }
  if (sameResolvedPath(localPath, context.configContext.path)) {
    return { ok: false, reason: "local_config_overwrites_shareable_config" };
  }
  if (isInsideConfiguredLogRoot(context, localPath)) {
    return { ok: false, reason: "target_inside_minecraft_root" };
  }
  if (isReservedProjectRelativeTarget(context, localPath)) {
    return { ok: false, reason: "local_config_reserved_project_path" };
  }
  return { ok: true, path: localPath };
}

function validateApiDataDirPath(context, value, roots = context.configContext.config.roots) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "expected_non_empty_string" };
  }
  const trimmed = value.trim();
  if (!isSafeProjectRelativePath(trimmed)) {
    return { ok: false, error: "must_be_project_relative_path" };
  }
  const resolved = resolveConfigPath(context.configContext, trimmed);
  if (sameResolvedPath(resolved, context.configContext.path) || sameResolvedPath(resolved, context.configContext.localPath)) {
    return { ok: false, error: "must_target_derived_data_dir" };
  }
  if (isInsideLogRoot(resolved, roots ?? [])) {
    return { ok: false, error: "must_not_be_inside_minecraft_root" };
  }
  if (isReservedProjectRelativeTarget(context, resolved)) {
    return { ok: false, error: "must_target_derived_data_dir" };
  }
  return { ok: true, value: trimmed };
}

function validateApiCustomRulePath(context, value, roots = context.configContext.config.roots) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "expected_non_empty_string" };
  }
  const trimmed = value.trim();
  if (!isSafeProjectRelativePath(trimmed)) {
    return { ok: false, error: "must_be_project_relative_path" };
  }

  const resolved = resolveConfigPath(context.configContext, trimmed);
  if (sameResolvedPath(resolved, context.configContext.path) || sameResolvedPath(resolved, context.configContext.localPath)) {
    return { ok: false, error: "must_target_rule_pack_path" };
  }
  if (isInsideLogRoot(resolved, roots ?? [])) {
    return { ok: false, error: "must_not_be_inside_minecraft_root" };
  }
  if (isInsideConfiguredDerivedData(context, resolved)) {
    return { ok: false, error: "must_target_rule_pack_path" };
  }
  if (isReservedCustomRuleTarget(context, resolved)) {
    return { ok: false, error: "must_target_rule_pack_path" };
  }

  const extension = path.extname(trimmed).toLowerCase();
  if (extension && extension !== ".json") {
    return { ok: false, error: "must_be_rule_pack_json_or_directory" };
  }
  return { ok: true, value: trimmed };
}

function validateApiWriteTarget(context, targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  if (isInsideConfiguredLogRoot(context, resolvedTarget)) {
    return { ok: false, reason: "target_inside_minecraft_root" };
  }
  if (options.blockReservedProjectPaths && isReservedProjectResolvedPath(context, resolvedTarget)) {
    return { ok: false, reason: "target_reserved_project_path" };
  }
  if (options.extensions?.length) {
    const allowedExtensions = options.extensions.map((extension) => extension.toLowerCase());
    if (!allowedExtensions.includes(path.extname(resolvedTarget).toLowerCase())) {
      return { ok: false, reason: "target_extension_not_allowed" };
    }
  }
  if (options.allowedTargets?.length) {
    const allowedTargets = options.allowedTargets.map((target) => path.resolve(target));
    const allowed = allowedTargets.some((target) => (
      sameResolvedPath(resolvedTarget, target) ||
      (options.allowInsideTargets && isSameOrInside(resolvedTarget, target))
    ));
    if (!allowed) return { ok: false, reason: options.notAllowedReason ?? "target_not_allowed" };
  }
  if (options.allowedRoots?.length) {
    const allowedRoots = options.allowedRoots.map((root) => path.resolve(root));
    const allowed = allowedRoots.some((root) => isSameOrInside(resolvedTarget, root));
    if (!allowed) return { ok: false, reason: options.notAllowedReason ?? "target_not_allowed" };
  }
  return { ok: true, path: resolvedTarget };
}

function isInsideConfiguredLogRoot(context, resolvedTarget) {
  return isInsideLogRoot(resolvedTarget, context.configContext.config.roots ?? []);
}

function isInsideLogRoot(resolvedTarget, roots) {
  return (roots ?? []).some((root) => {
    const resolvedRoot = path.resolve(root);
    return isSameOrInside(resolvedTarget, resolvedRoot);
  });
}

function isInsideConfiguredDerivedData(context, resolvedTarget) {
  const dataDir = path.resolve(context.dataDir);
  return isSameOrInside(resolvedTarget, dataDir);
}

function isReservedProjectResolvedPath(context, resolvedTarget) {
  if (sameResolvedPath(resolvedTarget, context.configContext.path) || sameResolvedPath(resolvedTarget, context.configContext.localPath)) {
    return true;
  }

  return isReservedProjectRelativeTarget(context, resolvedTarget);
}

function isReservedCustomRuleTarget(context, resolvedTarget) {
  const projectDir = path.resolve(context.configContext.dir);
  if (!isSameOrInside(resolvedTarget, projectDir)) return false;

  const relativePath = path.relative(projectDir, resolvedTarget);
  const segments = projectRelativeSegments(relativePath).map((segment) => segment.toLowerCase());
  const firstSegment = segments[0];
  if (new Set([".agents", ".codex", ".git", ".cache", "docs", "node_modules", "scripts", "src"]).has(firstSegment)) {
    return true;
  }
  const rootFile = segments.length === 1 ? segments[0] : null;
  return reservedApiOutputRootFiles.has(rootFile);
}

function isReservedProjectRelativeTarget(context, resolvedTarget) {
  const projectDir = path.resolve(context.configContext.dir);
  if (!isSameOrInside(resolvedTarget, projectDir)) return false;

  const relativePath = path.relative(projectDir, resolvedTarget);
  const segments = projectRelativeSegments(relativePath).map((segment) => segment.toLowerCase());
  const firstSegment = segments[0];
  if (reservedApiOutputDirs.has(firstSegment)) return true;

  const rootFile = segments.length === 1 ? segments[0] : null;
  return reservedApiOutputRootFiles.has(rootFile);
}

function validateApiOutputPath(context, value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !isSafeProjectRelativePath(value) ||
    !value.trim().toLowerCase().endsWith(".json")
  ) {
    return { ok: false, error: "must_be_project_relative_json_path" };
  }

  const trimmed = value.trim();
  if (isReservedApiOutputPath(context, trimmed)) {
    return { ok: false, error: "must_target_derived_output_path" };
  }

  return { ok: true, value: trimmed };
}

function isReservedApiOutputPath(context, relativePath) {
  const resolved = resolveConfigPath(context.configContext, relativePath);
  if (sameResolvedPath(resolved, context.configContext.path) || sameResolvedPath(resolved, context.configContext.localPath)) {
    return true;
  }

  const segments = projectRelativeSegments(relativePath).map((segment) => segment.toLowerCase());
  const firstSegment = segments[0];
  if (reservedApiOutputDirs.has(firstSegment)) {
    return true;
  }

  const rootFile = segments.length === 1 ? segments[0] : null;
  return reservedApiOutputRootFiles.has(rootFile);
}

function buildConfigSignature(context) {
  const config = context.configContext.config;
  const customRulePaths = (config.customRules ?? []).map((rulePath) => resolveConfigPath(context.configContext, rulePath));
  return stableJson({
    roots: (config.roots ?? []).map((root) => path.resolve(root)),
    encoding: config.encoding,
    rules: config.rules ?? [],
    bundledRuleFiles: buildBundledRuleManifest(),
    customRules: customRulePaths,
    customRuleFiles: buildCustomRuleManifest(customRulePaths),
    ownerAliases: config.owner?.aliases ?? [],
    ownerMode: config.owner?.mode ?? "all_local_users",
  });
}

function buildReportSignature(report) {
  if (report.inputs) {
    return stableJson({
      roots: (report.inputs.roots ?? []).map((root) => path.resolve(root)),
      encoding: report.inputs.encoding,
      rules: report.inputs.selectedRuleSets ?? [],
      bundledRuleFiles: report.inputs.bundledRuleFiles ?? null,
      customRules: report.inputs.customRulePaths ?? [],
      customRuleFiles: report.inputs.customRuleFiles ?? ((report.inputs.customRulePaths ?? []).length ? null : []),
      ownerAliases: report.inputs.ownerAliases ?? [],
      ownerMode: report.inputs.ownerMode ?? "all_local_users",
    });
  }
  return stableJson({
    roots: (report.roots ?? []).map((root) => path.resolve(root)),
    encoding: report.encoding,
    rules: report.selectedRuleSets === "all" ? [] : report.selectedRuleSets ?? [],
    bundledRuleFiles: null,
    customRules: null,
    customRuleFiles: null,
    ownerAliases: null,
    ownerMode: null,
  });
}

function refreshNeededReasons(status) {
  const reasons = [];
  if (status.reportJsonError) reasons.push("report_invalid_json");
  if (status.summaryJsonError) reasons.push("summary_invalid_json");
  if (status.reportSchemaError) reasons.push("report_invalid_schema");
  if (status.summarySchemaError) reasons.push("summary_invalid_schema");
  if (!status.reportReady && !status.reportJsonError && !status.summaryJsonError && !status.reportSchemaError && !status.summarySchemaError) reasons.push("report_not_ready");
  if (status.storeJsonError) reasons.push("store_invalid_json");
  if (status.storeManifestError) reasons.push("store_invalid_manifest");
  if (status.storeFileError) reasons.push("store_files_missing");
  if (!status.storeReady && !status.storeJsonError && !status.storeManifestError && !status.storeFileError) reasons.push("store_not_ready");
  if (status.configChanged) reasons.push("inputs_changed");
  if (status.reportReady && status.storeReady && status.storeReportGeneratedAt !== status.reportGeneratedAt) {
    reasons.push("store_out_of_sync");
  }
  return reasons;
}

function buildSetupStatus({ firstRun, reportReady, storeReady, configChanged, refreshReasons, refresh }) {
  const refreshRunning = Boolean(refresh?.running);
  const reasons = [
    ...(firstRun ? ["no_roots"] : []),
    ...(refreshReasons ?? []),
    ...(refreshRunning ? ["refresh_running"] : []),
  ];
  let state = "ready";
  let recommendedAction = "none";
  if (firstRun) {
    state = "first_run";
    recommendedAction = "configure_roots";
  } else if (refreshRunning) {
    state = "refreshing";
    recommendedAction = "wait_for_refresh";
  } else if ((refreshReasons ?? []).length) {
    state = "needs_refresh";
    recommendedAction = "run_refresh";
  }
  return {
    state,
    reasons,
    recommendedAction,
    nextActions: setupNextActions({ state, recommendedAction, reasons, refreshReasons, refreshRunning }),
    dataReady: Boolean(reportReady && storeReady && !configChanged),
    canConfigure: !refreshRunning,
    canRefresh: !firstRun && !refreshRunning,
  };
}

function setupNextActions({ state, recommendedAction, reasons, refreshReasons, refreshRunning }) {
  if (state === "ready") return [];
  if (state === "first_run") {
    return [
      setupAction("configure_roots", "blocking", "Choose at least one readable Minecraft log root.", {
        endpoint: "PUT /api/config",
      }),
      setupAction("validate_roots", "recommended", "Validate selected roots before saving them.", {
        endpoint: "POST /api/config/validate-roots",
      }),
    ];
  }
  if (refreshRunning) {
    return [
      setupAction("wait_for_refresh", "blocking", "Wait for the active refresh job to finish or cancel it.", {
        endpoint: "GET /api/refresh",
      }),
    ];
  }
  if (recommendedAction === "run_refresh") {
    return [
      setupAction("run_refresh", "blocking", "Regenerate derived report and split-store outputs.", {
        endpoint: "POST /api/refresh",
        reasons: refreshReasons ?? [],
      }),
      ...cleanupRecoveryActions(refreshReasons ?? []),
    ];
  }
  return (reasons ?? []).map((reason) => setupAction(reason, "info", `Review setup reason: ${reason}.`));
}

function setupAction(code, severity, message, details = {}) {
  return {
    code,
    severity,
    message,
    ...details,
  };
}

function cleanupRecoveryActions(refreshReasons) {
  const corruptDerived = refreshReasons.some((reason) => [
    "report_invalid_json",
    "summary_invalid_json",
    "report_invalid_schema",
    "summary_invalid_schema",
    "store_invalid_json",
    "store_invalid_manifest",
    "store_files_missing",
  ].includes(reason));
  if (!corruptDerived) return [];
  return [
    setupAction("cleanup_derived_preview", "recommended", "Preview derived-data cleanup if refresh cannot replace corrupt outputs cleanly.", {
      endpoint: "POST /api/data/cleanup",
      scope: "all_derived",
      dryRun: true,
    }),
  ];
}

function buildRecoveryStatus({ firstRun, refreshReasons, refresh, setup, reportValidation, summaryValidation, storeManifestValidation, storeFilesValidation }) {
  const actions = [];
  if (firstRun) {
    actions.push(recoveryAction("configure_roots", "blocking", "No log roots are configured.", {
      endpoint: "PUT /api/config",
      blocks: ["refresh"],
    }));
    actions.push(recoveryAction("validate_roots", "recommended", "Validate candidate log roots before saving.", {
      endpoint: "POST /api/config/validate-roots",
    }));
  }

  if (refresh?.running) {
    actions.push(recoveryAction("wait_for_refresh", "blocking", "A refresh is already running.", {
      endpoint: "GET /api/refresh",
      phase: refresh.phase ?? "scan",
    }));
    actions.push(recoveryAction("cancel_refresh", "optional", "Cancel the active refresh if the user explicitly requests it.", {
      endpoint: "POST /api/refresh/cancel",
    }));
  }

  for (const reason of refreshReasons ?? []) {
    actions.push(...recoveryActionsForRefreshReason(reason, {
      reportValidation,
      summaryValidation,
      storeManifestValidation,
      storeFilesValidation,
    }));
  }

  return {
    state: setup?.state ?? "ready",
    summary: recoverySummary(actions),
    actions: dedupeRecoveryActions(actions),
  };
}

function recoveryActionsForRefreshReason(reason, details = {}) {
  const refreshAction = recoveryAction("run_refresh", "blocking", "Regenerate report and split-store derived outputs.", {
    endpoint: "POST /api/refresh",
    reason,
  });
  if (reason === "inputs_changed") {
    return [
      recoveryAction("run_refresh", "blocking", "Config, rules, or owner aliases changed since the report was generated.", {
        endpoint: "POST /api/refresh",
        reason,
      }),
    ];
  }
  if (reason === "store_out_of_sync") {
    return [
      recoveryAction("run_refresh", "blocking", "Regenerate the split store so it matches the current report.", {
        endpoint: "POST /api/refresh",
        reason,
      }),
    ];
  }
  if (reason === "store_files_missing") {
    return [
      refreshAction,
      recoveryAction("cleanup_store_preview", "optional", "Preview store cleanup if manifest-declared files are missing.", {
        endpoint: "POST /api/data/cleanup",
        scope: "store",
        dryRun: true,
        missingFiles: details.storeFilesValidation?.files ?? [],
      }),
    ];
  }
  if (reason.endsWith("_invalid_json") || reason.endsWith("_invalid_schema") || reason === "store_invalid_manifest") {
    return [
      refreshAction,
      recoveryAction("cleanup_derived_preview", "optional", "Preview derived-data cleanup if refresh cannot recover corrupt outputs.", {
        endpoint: "POST /api/data/cleanup",
        scope: "all_derived",
        dryRun: true,
        reason,
      }),
    ];
  }
  if (reason === "report_not_ready" || reason === "store_not_ready") return [refreshAction];
  return [
    recoveryAction("inspect_status", "info", `Inspect refresh reason: ${reason}.`, {
      reason,
    }),
  ];
}

function recoveryAction(code, severity, message, details = {}) {
  return {
    code,
    severity,
    message,
    ...details,
  };
}

function recoverySummary(actions) {
  if (actions.some((action) => action.severity === "blocking")) return "action_required";
  if (actions.some((action) => action.severity === "recommended")) return "attention_recommended";
  if (actions.length) return "informational";
  return "none";
}

function dedupeRecoveryActions(actions) {
  const seen = new Set();
  const result = [];
  for (const action of actions) {
    const key = `${action.code}\0${action.endpoint ?? ""}\0${action.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

function publicRefresh(refresh) {
  return {
    id: refresh.id ?? null,
    running: Boolean(refresh.running),
    phase: refresh.phase ?? (refresh.running ? "scan" : "idle"),
    status: refreshStatus(refresh.phase ?? (refresh.running ? "scan" : "idle")),
    percent: refresh.percent ?? 0,
    currentFile: refresh.currentFile ?? null,
    filesDone: refresh.filesDone ?? 0,
    filesTotal: refresh.filesTotal ?? 0,
    files: {
      done: refresh.filesDone ?? 0,
      total: refresh.filesTotal ?? 0,
    },
    startedAt: refresh.startedAt ?? null,
    finishedAt: refresh.finishedAt ?? null,
    durationMs: durationBetweenMs(refresh.startedAt, refresh.finishedAt),
    phaseTimings: publicPhaseTimings(refresh),
    phaseDurationsMs: phaseDurationsMs(refresh),
    diagnostics: privacySafeRefreshDiagnostics(refresh.diagnostics),
    exitCode: refresh.exitCode ?? null,
    cancelRequested: Boolean(refresh.cancelRequested),
    failurePhase: refresh.failurePhase ?? null,
    errorCategory: refresh.errorCategory ?? classifyRefreshError(refresh),
    error: refresh.error ?? null,
    log: refresh.log ?? [],
  };
}

function privacySafeRefresh(refresh) {
  const publicState = publicRefresh(refresh);
  const { currentFile: _currentFile, log: _log, error: _error, ...safe } = publicState;
  return {
    ...safe,
    hasCurrentFile: Boolean(publicState.currentFile),
    logLines: Array.isArray(publicState.log) ? publicState.log.length : 0,
    hasError: Boolean(publicState.error),
  };
}

function createApiJsonCache() {
  return {
    maxEntries: 24,
    entries: new Map(),
    recent: [],
    stats: {
      reads: 0,
      hits: 0,
      misses: 0,
      missing: 0,
      invalidations: 0,
      clears: 0,
      totalDurationMs: 0,
      totalReadMs: 0,
      totalParseMs: 0,
      byKind: {},
    },
  };
}

function clearApiJsonCache(context, reason = "manual") {
  const cache = context?.apiJsonCache;
  if (!cache) return;
  cache.entries.clear();
  cache.stats.clears += 1;
  cache.lastClear = {
    reason,
    at: new Date().toISOString(),
  };
}

function invalidateApiJsonCachePath(context, filePath) {
  if (!context?.apiJsonCache || !filePath) return;
  context.apiJsonCache.entries.delete(path.resolve(filePath));
}

function recordApiJsonCacheAccess(cache, event) {
  const durationMs = Number.isFinite(event.durationMs) ? event.durationMs : 0;
  const readMs = Number.isFinite(event.readMs) ? event.readMs : 0;
  const parseMs = Number.isFinite(event.parseMs) ? event.parseMs : 0;
  cache.stats.reads += 1;
  cache.stats.totalDurationMs += durationMs;
  cache.stats.totalReadMs += readMs;
  cache.stats.totalParseMs += parseMs;
  if (event.hit) cache.stats.hits += 1;
  else cache.stats.misses += 1;
  if (event.missing) cache.stats.missing += 1;
  cache.stats.byKind[event.kind] ??= {
    kind: event.kind,
    reads: 0,
    hits: 0,
    misses: 0,
    missing: 0,
    bytes: null,
    totalDurationMs: 0,
    totalReadMs: 0,
    totalParseMs: 0,
    maxDurationMs: 0,
  };
  const bucket = cache.stats.byKind[event.kind];
  bucket.reads += 1;
  if (event.hit) bucket.hits += 1;
  else bucket.misses += 1;
  if (event.missing) bucket.missing += 1;
  if (Number.isFinite(event.bytes)) bucket.bytes = event.bytes;
  bucket.totalDurationMs += durationMs;
  bucket.totalReadMs += readMs;
  bucket.totalParseMs += parseMs;
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);
  cache.recent.unshift({
    kind: event.kind,
    hit: Boolean(event.hit),
    missing: Boolean(event.missing),
    bytes: Number.isFinite(event.bytes) ? event.bytes : null,
    durationMs,
    readMs,
    parseMs,
    at: new Date().toISOString(),
  });
  cache.recent = cache.recent.slice(0, 25);
}

function trimApiJsonCache(cache) {
  if (cache.entries.size <= cache.maxEntries) return;
  const removable = [...cache.entries.entries()]
    .sort((a, b) => String(a[1].loadedAt).localeCompare(String(b[1].loadedAt)))
    .slice(0, Math.max(0, cache.entries.size - cache.maxEntries));
  for (const [key] of removable) cache.entries.delete(key);
}

function apiJsonCacheKind(context, resolvedPath, explicitKind) {
  if (typeof explicitKind === "string" && explicitKind.trim()) return explicitKind.trim();
  const checks = [
    ["report", context.reportPath],
    ["summary", context.summaryPath],
    ["store_manifest", context.storeManifestPath],
    ["refresh_history", context.refreshHistoryPath],
    ["store_read_metrics", context.storeReadMetricsPath],
    ["performance_baseline", context.performanceBaselinePath],
    ["result_candidates", context.resultCandidatesPath],
    ["unmatched_debug", context.unmatchedPath],
    ["rule_audit_history", context.ruleAuditPath],
    ["local_config", context.configContext?.localPath],
  ];
  const normalized = path.resolve(resolvedPath);
  for (const [kind, knownPath] of checks) {
    if (knownPath && path.resolve(knownPath) === normalized) return kind;
  }
  if (context.unknownAuditLabelSetsPath && isSameOrInside(normalized, path.resolve(context.unknownAuditLabelSetsPath))) return "unknown_audit_label_set";
  if (context.userRulePacksPath && isSameOrInside(normalized, path.resolve(context.userRulePacksPath))) return "user_rule_pack";
  return "other_json";
}

function fileSignature(fileStat) {
  return `${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`;
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function apiJsonCachePerformance(cache) {
  if (!cache) return apiJsonCachePerformance(createApiJsonCache());
  const stats = cache.stats;
  const kinds = Object.values(stats.byKind)
    .map((bucket) => ({
      kind: bucket.kind,
      reads: bucket.reads,
      hits: bucket.hits,
      misses: bucket.misses,
      missing: bucket.missing,
      hitRate: ratio(bucket.hits, bucket.reads),
      bytes: bucket.bytes,
      averageDurationMs: averageFromTotal(bucket.totalDurationMs, bucket.reads),
      averageReadMs: averageFromTotal(bucket.totalReadMs, bucket.misses),
      averageParseMs: averageFromTotal(bucket.totalParseMs, bucket.misses),
      maxDurationMs: bucket.maxDurationMs,
    }))
    .sort((a, b) => b.reads - a.reads || b.misses - a.misses || a.kind.localeCompare(b.kind));
  return {
    ready: true,
    policy: "process_json_cache_mtime_size",
    entries: cache.entries.size,
    maxEntries: cache.maxEntries,
    reads: stats.reads,
    hits: stats.hits,
    misses: stats.misses,
    missing: stats.missing,
    invalidations: stats.invalidations,
    clears: stats.clears,
    hitRate: ratio(stats.hits, stats.reads),
    averageDurationMs: averageFromTotal(stats.totalDurationMs, stats.reads),
    averageReadMs: averageFromTotal(stats.totalReadMs, stats.misses),
    averageParseMs: averageFromTotal(stats.totalParseMs, stats.misses),
    lastClear: cache.lastClear ?? null,
    kinds,
    hotFiles: kinds.slice(0, 10),
    recent: cache.recent.slice(0, 10),
  };
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function averageFromTotal(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return null;
  return Number((total / count).toFixed(3));
}

async function checkJsonFile(filePath) {
  const result = await checkFile(filePath);
  if (!result.exists || result.type !== "file") return result;
  try {
    const data = await readJson(filePath);
    return {
      ...result,
      schema: data.schema ?? null,
      generatedAt: data.generatedAt ?? null,
      reportGeneratedAt: data.reportGeneratedAt ?? null,
    };
  } catch (error) {
    return {
      ...result,
      jsonError: error.message,
    };
  }
}

async function checkFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    return {
      path: filePath,
      exists: true,
      type: fileStat.isDirectory() ? "directory" : "file",
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      path: filePath,
      exists: false,
    };
  }
}

function redactFileCheck(fileCheck) {
  return {
    ...fileCheck,
    path: fileCheck.path ? redactPath(fileCheck.path) : fileCheck.path,
  };
}

function diagnosticReportOutput(fileCheck, statusReport, options = {}) {
  const output = options.full ? { ...fileCheck } : redactFileCheck(fileCheck);
  const jsonError = statusReport?.jsonError ?? output.jsonError ?? null;
  const schemaError = statusReport?.schemaError ?? null;
  return {
    ...output,
    ready: Boolean(output.exists && !jsonError && !schemaError),
    generatedAt: statusReport?.generatedAt ?? output.generatedAt ?? null,
    schema: statusReport?.schema ?? output.schema ?? null,
    jsonError,
    schemaError,
    schemaErrorReason: statusReport?.schemaErrorReason ?? null,
  };
}

function diagnosticSummaryOutput(fileCheck, statusReport, options = {}) {
  const output = options.full ? { ...fileCheck } : redactFileCheck(fileCheck);
  const jsonError = statusReport?.summaryJsonError ?? output.jsonError ?? null;
  const schemaError = statusReport?.summarySchemaError ?? null;
  return {
    ...output,
    ready: Boolean(output.exists && !jsonError && !schemaError),
    jsonError,
    schemaError,
    schemaErrorReason: statusReport?.summarySchemaErrorReason ?? null,
  };
}

function diagnosticStoreOutput(fileCheck, statusStore, options = {}) {
  const output = options.full ? { ...fileCheck } : redactFileCheck(fileCheck);
  return {
    ...output,
    ready: Boolean(statusStore?.ready),
    generatedAt: statusStore?.generatedAt ?? output.generatedAt ?? null,
    reportGeneratedAt: statusStore?.reportGeneratedAt ?? output.reportGeneratedAt ?? null,
    jsonError: statusStore?.jsonError ?? output.jsonError ?? null,
    manifestError: statusStore?.manifestError ?? null,
    manifestErrorReason: statusStore?.manifestErrorReason ?? null,
    fileError: statusStore?.fileError ?? null,
    fileErrorReason: statusStore?.fileErrorReason ?? null,
    missingFiles: statusStore?.missingFiles ?? [],
  };
}

function diagnosticsSensitiveValues(context) {
  const config = context.configContext.config;
  return [
    context.configContext.path,
    context.configContext.localPath,
    context.dataDir,
    context.storeDir,
    context.storeManifestPath,
    context.reportPath,
    context.summaryPath,
    context.unmatchedPath,
    context.resultCandidatesPath,
    context.refreshHistoryPath,
    context.userRulePacksPath,
    ...(config.roots ?? []),
    ...(config.owner?.aliases ?? []),
    ...(config.owner?.displayName && config.owner.displayName !== "Owner" ? [config.owner.displayName] : []),
  ].filter(Boolean);
}

function sanitizeDiagnosticsPackage(value, key = "", context = {}) {
  const lowerKey = key.toLowerCase();
  const childContext = {
    ...context,
    inMissingFiles: context.inMissingFiles || lowerKey === "missingfiles",
  };
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticsPackage(item, key, childContext));
  }
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (isLogKey(lowerKey)) return redactTextPaths(value);
    if (isIdentityKey(lowerKey)) return redactIdentity(value);
    if (context.inMissingFiles && lowerKey === "file" && isSafeStoreManifestFileName(value)) return value;
    if (isPathKey(lowerKey) || looksLikeAbsolutePath(value)) return redactPath(value);
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([childKey]) => !isPrivacySafeDiagnosticsDroppedKey(childKey))
      .map(([childKey, childValue]) => [
        childKey,
        sanitizeDiagnosticsPackage(childValue, childKey, childContext),
      ]),
  );
}

function isPrivacySafeDiagnosticsDroppedKey(key) {
  const normalized = String(key).toLowerCase();
  return privacySafeDiagnosticsForbiddenKeys.some((blocked) => blocked.toLowerCase() === normalized);
}

function isPathKey(key) {
  return ["path", "paths", "filepath", "filepaths", "localpath", "configpath", "localconfigpath", "summarypath", "manifestpath", "datadir", "storedir", "currentfile", "root", "roots", "input"].includes(key)
    || key.endsWith("path")
    || key.endsWith("paths")
    || key.endsWith("dir")
    || key.endsWith("file")
    || key.endsWith("root")
    || key.endsWith("roots");
}

function isIdentityKey(key) {
  return ["owneraliases", "aliases", "displayname"].includes(key);
}

function isLogKey(key) {
  return key === "log" || key === "logtail" || key.endsWith("log");
}

function looksLikeAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function redactIdentity(value) {
  return {
    redacted: true,
    fingerprint: shortHash(String(value).trim().toLowerCase()),
  };
}

function redactTextPaths(value) {
  return String(value).replace(/[A-Za-z]:[\\/][^\s"',)]+/g, (match) => `[path:${shortHash(match.toLowerCase())}]`);
}

function redactPath(value) {
  if (!value) return value;
  const resolved = path.resolve(String(value));
  return {
    redacted: true,
    fingerprint: shortHash(resolved.toLowerCase()),
  };
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isSafeProjectRelativePath(value) {
  if (!value || path.isAbsolute(value) || value.includes("\0") || /^[A-Za-z]:/.test(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== "." && !normalized.startsWith("..") && !path.isAbsolute(normalized);
}

function sameResolvedPath(left, right) {
  return pathKey(left) === pathKey(right);
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectRelativeSegments(value) {
  return path.normalize(value).split(/[\\/]+/).filter(Boolean);
}

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function countByValues(items, keyFn) {
  const counts = {};
  for (const item of items ?? []) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function stableJson(value) {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value) {
  if (Array.isArray(value)) return value.map(sortForStableJson).sort();
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortForStableJson(value[key])]));
}

function readPagination(url, defaultLimit, maxLimit) {
  const errors = [];
  const offset = parsePaginationInt(url.searchParams.get("offset"), {
    field: "offset",
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
    errors,
  });
  const limit = parsePaginationInt(url.searchParams.get("limit"), {
    field: "limit",
    min: 1,
    max: maxLimit,
    fallback: defaultLimit,
    errors,
  });
  if (errors.length) {
    return {
      response: errorResponse(400, "invalid_pagination", "Pagination query parameters are invalid.", { errors }),
    };
  }
  return { offset, limit };
}

function pagedRows(url, rows, extra = {}) {
  const pagination = readPagination(url, 100, 1000);
  if (pagination.response) return pagination.response;
  const { offset, limit } = pagination;
  return jsonResponse(200, {
    ...extra,
    offset,
    limit,
    items: rows.slice(offset, offset + limit),
  });
}

function parsePaginationInt(value, { field, min, max, fallback, errors }) {
  if (value === null || value === "") return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    errors.push({ field, error: "expected_integer", min, max });
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    errors.push({ field, error: "expected_safe_integer", min, max });
    return fallback;
  }
  if (parsed < min) {
    errors.push({ field, error: "too_small", min, max });
    return fallback;
  }
  if (parsed > max) {
    errors.push({ field, error: "too_large", min, max });
    return fallback;
  }
  return parsed;
}

function parseOptionalNumber(value) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumberQuery(url, field, errors) {
  const raw = url.searchParams.get(field);
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    errors.push({ field, error: "expected_number" });
    return null;
  }
  if (parsed < 0) {
    errors.push({ field, error: "must_be_non_negative" });
    return null;
  }
  return parsed;
}

function readDateQuery(url, field, errors) {
  const raw = url.searchParams.get(field);
  if (raw === null || raw === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    errors.push({ field, error: "expected_date" });
    return null;
  }
  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== raw) {
    errors.push({ field, error: "expected_date" });
    return null;
  }
  return raw;
}

function parseOptionalBoolean(value) {
  if (value === null || value === "") return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function readBooleanQuery(url, field, defaultValue) {
  const errors = [];
  const value = readBooleanQueryValue(url, field, defaultValue, errors);
  if (errors.length) {
    return {
      response: invalidBooleanQueryResponse(field),
    };
  }
  return { value };
}

function readBooleanQueryValue(url, field, defaultValue, errors) {
  const raw = url.searchParams.get(field);
  if (raw === null || raw === "") return defaultValue;
  const parsed = parseOptionalBoolean(raw);
  if (parsed === null) {
    errors.push({ field, error: "expected_boolean" });
    return defaultValue;
  }
  return parsed;
}

function invalidBooleanQueryResponse(field) {
  return errorResponse(400, "invalid_boolean_query", `${field} must be true or false when provided.`, {
    field,
    allowed: ["true", "false", "1", "0", "yes", "no"],
  });
}

function draftRuleId(type, message) {
  const slug = message
    .toLowerCase()
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${type}_${slug || "rule"}`;
}

function safeRulePackFileName(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "rule-pack";
}

function isManagedRulePackId(id) {
  return typeof id === "string"
    && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)
    && safeRulePackFileName(id) === id;
}

function invalidManagedRulePackIdResponse() {
  return errorResponse(400, "invalid_rule_pack_id", "Managed rule pack ids must use 1-80 lowercase ASCII letters, numbers, underscores, or hyphens, and must not need filename normalization.", {
    pattern: "^[a-z0-9][a-z0-9_-]{0,79}$",
  });
}

function isManagedLabelSetId(id) {
  return typeof id === "string"
    && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)
    && safeRulePackFileName(id) === id;
}

function invalidManagedLabelSetIdResponse() {
  return errorResponse(400, "invalid_label_set_id", "Unknown-audit label set ids must use 1-80 lowercase ASCII letters, numbers, underscores, or hyphens, and must not need filename normalization.", {
    pattern: "^[a-z0-9][a-z0-9_-]{0,79}$",
  });
}

function readUserRulePackRouteId(pathname) {
  const prefix = "/api/rule-packs/user/";
  if (!pathname.startsWith(prefix)) return null;
  const encodedId = pathname.slice(prefix.length);
  if (!encodedId || encodedId.includes("/")) return null;
  try {
    const id = decodeURIComponent(encodedId).trim();
    if (!id || id.includes("/") || id.includes("\\")) return null;
    return id;
  } catch {
    return null;
  }
}

function readUnknownAuditLabelSetRouteId(pathname) {
  const prefix = "/api/unknown-audit/label-sets/";
  if (!pathname.startsWith(prefix)) return null;
  const encodedId = pathname.slice(prefix.length);
  if (!encodedId || encodedId.includes("/")) return null;
  try {
    const id = decodeURIComponent(encodedId).trim();
    if (!id || id.includes("/") || id.includes("\\")) return null;
    return id;
  } catch {
    return null;
  }
}

function resolveUserRulePackFile(context, id) {
  const safeId = safeRulePackFileName(id);
  const rootPath = path.resolve(context.userRulePacksPath);
  const filePath = path.resolve(rootPath, `${safeId}.json`);
  const safety = validateUserRulePackTarget(context, filePath);
  if (!safety.ok) {
    const error = new Error("Resolved user rule pack path is outside the managed rule pack directory.");
    error.code = "INVALID_RULE_PACK_PATH";
    error.reason = safety.reason;
    throw error;
  }
  return { safeId, filePath };
}

function resolveUnknownAuditLabelSetFile(context, id) {
  const safeId = safeRulePackFileName(id);
  const rootPath = path.resolve(context.unknownAuditLabelSetsPath);
  const filePath = path.resolve(rootPath, `${safeId}.json`);
  const safety = validateUnknownAuditLabelSetTarget(context, filePath);
  if (!safety.ok) {
    const error = new Error("Resolved unknown-audit label set path is outside the managed label set directory.");
    error.code = "INVALID_LABEL_SET_PATH";
    error.reason = safety.reason;
    throw error;
  }
  return { safeId, filePath };
}

function resolveUserRulePackFileOrResponse(context, id) {
  try {
    return { value: resolveUserRulePackFile(context, id) };
  } catch (error) {
    if (error.code === "INVALID_RULE_PACK_PATH") {
      return {
        response: errorResponse(400, "unsafe_rule_pack_path", "Resolved user rule pack path is not writable by the local API policy.", {
          reason: error.reason ?? "invalid_rule_pack_path",
        }),
      };
    }
    throw error;
  }
}

function resolveUnknownAuditLabelSetFileOrResponse(context, id) {
  try {
    return { value: resolveUnknownAuditLabelSetFile(context, id) };
  } catch (error) {
    if (error.code === "INVALID_LABEL_SET_PATH") {
      return {
        response: errorResponse(400, "unsafe_label_set_path", "Resolved unknown-audit label set path is not writable by the local API policy.", {
          reason: error.reason ?? "invalid_label_set_path",
        }),
      };
    }
    throw error;
  }
}

function compactRulePackMetadata(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    filePath: item.filePath,
    bytes: item.bytes,
    modifiedAt: item.modifiedAt,
    rules: item.rules,
    valid: item.valid,
    errors: item.errors,
  };
}

async function readUnknownAuditLabelSetMetadata(context, id, filePath) {
  const file = await stat(filePath);
  try {
    const data = await readJson(filePath);
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.labels) ? data.labels : [];
    return {
      ...normalizeUnknownAuditLabelSet(data, id),
      filePath,
      bytes: file.size,
      modifiedAt: file.mtime.toISOString(),
      rows: rows.length,
      valid: true,
      errors: [],
    };
  } catch (error) {
    return {
      id,
      title: id,
      description: "",
      filePath,
      bytes: file.size,
      modifiedAt: file.mtime.toISOString(),
      rows: 0,
      valid: false,
      errors: [error.message],
    };
  }
}

function normalizeUnknownAuditLabelSet(data, fallbackId) {
  return {
    schema: isObjectRecord(data?.schema) ? data.schema : {
      name: "minecraft-log-observatory-unknown-audit-label-set",
      version: 1,
    },
    id: typeof data?.id === "string" && data.id.trim() ? data.id.trim() : fallbackId,
    title: typeof data?.title === "string" && data.title.trim() ? data.title.trim() : fallbackId,
    description: typeof data?.description === "string" ? data.description : "",
    source: sanitizeLabelSetSource(data?.source),
    createdAt: typeof data?.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
    validateRoundRefs: data?.validateRoundRefs !== false,
  };
}

function sanitizeLabelSetSource(source) {
  if (!isObjectRecord(source)) return {};
  const allowed = {};
  for (const [key, value] of Object.entries(source)) {
    if (["auditExport", "mode", "priority", "reportGeneratedAt", "notes"].includes(key)) {
      allowed[key] = typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value);
    }
  }
  return allowed;
}

function unknownAuditLabelSetWrites() {
  return {
    report: false,
    store: false,
    config: false,
    rules: false,
    labelSet: true,
  };
}

function enabledCustomRulePathSet(context) {
  return new Set((context.configContext.config.customRules ?? []).map((item) => String(item).replaceAll("\\", "/").replace(/^\.\//, "")));
}

function isUserRulePackEnabled(context, id, enabled = enabledCustomRulePathSet(context)) {
  return enabled.has("custom-rules/user") || enabled.has(`custom-rules/user/${id}.json`);
}

function messageToPattern(message) {
  const cleaned = message.replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "").replace(/\s+/g, " ").trim();
  return `^${escapeRegex(cleaned).replace(/\d+/g, "\\d+")}$`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readReport(context) {
  let report;
  try {
    report = await readJson(context, context.reportPath, { kind: "report" });
  } catch (error) {
    if (error instanceof SyntaxError) throw dataFileError("REPORT_INVALID_JSON", error.message);
    throw error;
  }
  const validation = validateReportShape(report);
  if (!validation.ok) throw dataFileError("REPORT_INVALID_SCHEMA", validation.message, { reason: validation.reason });
  return report;
}

function resolveCustomRulePaths(context) {
  return (context.configContext.config.customRules ?? []).map((value) => resolveConfigPath(context.configContext, value));
}

async function readSummary(context) {
  let summary;
  try {
    summary = await readJson(context, context.summaryPath, { kind: "summary" });
  } catch (error) {
    if (error instanceof SyntaxError) throw dataFileError("SUMMARY_INVALID_JSON", error.message);
    throw error;
  }
  const validation = validateSummaryShape(summary);
  if (!validation.ok) throw dataFileError("SUMMARY_INVALID_SCHEMA", validation.message, { reason: validation.reason });
  return summary;
}

async function readJson(contextOrPath, maybeFilePath, options = {}) {
  if (typeof contextOrPath === "string") {
    return JSON.parse(await readFile(contextOrPath, "utf8"));
  }
  return await readJsonCached(contextOrPath, maybeFilePath, options);
}

async function readJsonCached(context, filePath, options = {}) {
  if (!context?.apiJsonCache || !filePath) return JSON.parse(await readFile(filePath, "utf8"));
  const cache = context.apiJsonCache;
  const resolvedPath = path.resolve(filePath);
  const kind = apiJsonCacheKind(context, resolvedPath, options.kind);
  const started = process.hrtime.bigint();
  let fileStat;
  try {
    fileStat = await stat(resolvedPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      cache.entries.delete(resolvedPath);
      recordApiJsonCacheAccess(cache, {
        kind,
        hit: false,
        missing: true,
        durationMs: elapsedMs(started),
      });
    }
    throw error;
  }

  const signature = fileSignature(fileStat);
  const existing = cache.entries.get(resolvedPath);
  if (existing && existing.signature === signature) {
    recordApiJsonCacheAccess(cache, {
      kind,
      hit: true,
      bytes: fileStat.size,
      durationMs: elapsedMs(started),
    });
    return existing.data;
  }

  if (existing) cache.stats.invalidations += 1;
  const readStarted = process.hrtime.bigint();
  const text = await readFile(resolvedPath, "utf8");
  const readMs = elapsedMs(readStarted);
  const parseStarted = process.hrtime.bigint();
  const data = JSON.parse(text);
  const parseMs = elapsedMs(parseStarted);
  cache.entries.set(resolvedPath, {
    kind,
    signature,
    bytes: fileStat.size,
    loadedAt: new Date().toISOString(),
    data,
  });
  trimApiJsonCache(cache);
  recordApiJsonCacheAccess(cache, {
    kind,
    hit: false,
    bytes: fileStat.size,
    durationMs: elapsedMs(started),
    readMs,
    parseMs,
  });
  return data;
}

async function readJsonForStatus(context, filePath, options = {}) {
  try {
    return {
      data: await readJson(context, filePath, options),
      error: null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { data: null, error: null };
    }
    return {
      data: null,
      error: error.message,
    };
  }
}

async function readJsonOptional(contextOrPath, maybeFilePath, options = {}) {
  const hasContext = typeof contextOrPath !== "string";
  const filePath = hasContext ? maybeFilePath : contextOrPath;
  try {
    return hasContext ? await readJson(contextOrPath, filePath, options) : await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function errorResponse(status, error, message, extra = {}) {
  return jsonResponse(status, {
    ok: false,
    error,
    message,
    ...extra,
  });
}

function jsonResponse(status, body, headers = {}) {
  return { status, headers, body };
}

function binaryResponse(status, body, headers = {}) {
  return { status, headers, body };
}
