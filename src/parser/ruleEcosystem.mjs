import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeMinecraftRoots } from "./analyzer.mjs";
import { analyzeChatEvents } from "./chatEventAnalyzer.mjs";
import { buildRoundsByFile } from "./roundBuilder.mjs";
import { buildReport } from "../report/reportBuilder.mjs";
import { loadCustomRuleSets, listRuleSets, validateRuleSetDefinition } from "./chatRules.mjs";
import { resolveConfigPath } from "../config/appConfig.mjs";

const resultTypes = new Set(["win", "loss", "round_end"]);
const boundaryTypes = new Set(["round_start", "round_end", "round_countdown", "game_mode", "server_connect", "player_join", "player_leave"]);
const riskyPatternLength = 12;
export const VALID_REVIEW_LABELS = Object.freeze(["keep-unknown", "win", "loss", "ignore", "new-rule-needed"]);

export async function buildRulePackInventory(context) {
  const configuredPaths = resolveCustomRulePaths(context);
  const configuredSet = new Set(configuredPaths.map(normalizePath));
  const enabledCustomRules = new Set((context.configContext.config.customRules ?? []).map((value) => normalizeConfigRulePath(value)));
  const items = [];

  for (const item of safeListBundledAndConfigured(configuredPaths)) {
    const fileStat = await safeStat(item.filePath);
    const source = item.source === "bundled" ? "bundled" : "configured";
    items.push({
      ...item,
      source,
      runtimeSource: item.source,
      category: source,
      modifiedAt: fileStat?.mtime?.toISOString?.() ?? null,
      bytes: fileStat?.size ?? null,
      enabled: source === "bundled" || configuredSet.has(normalizePath(item.filePath)) || configuredSet.has(normalizePath(path.dirname(item.filePath))),
      valid: true,
      errors: [],
      warnings: [],
    });
  }

  const userItems = await listUserRulePackMetadata(context);
  for (const item of userItems.items) {
    items.push({
      ...item,
      source: "user",
      category: "user",
      enabled: userRulePackEnabled(item, enabledCustomRules),
      warnings: item.rulePack ? warningsForRulePack(item.rulePack) : [],
    });
  }

  return {
    customRulePaths: configuredPaths,
    userRulePacksPath: context.userRulePacksPath,
    total: items.length,
    enabled: items.filter((item) => item.enabled).length,
    invalid: items.filter((item) => !item.valid).length,
    items: items.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.id.localeCompare(b.id)),
  };
}

export async function listUserRulePackMetadata(context) {
  try {
    const fileNames = (await readdir(context.userRulePacksPath)).filter((fileName) => fileName.endsWith(".json")).sort();
    const items = [];
    for (const fileName of fileNames) {
      const filePath = path.join(context.userRulePacksPath, fileName);
      items.push(await readRulePackMetadata(filePath, path.basename(fileName, ".json")));
    }
    return {
      path: context.userRulePacksPath,
      total: items.length,
      items,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      path: context.userRulePacksPath,
      total: 0,
      items: [],
    };
  }
}

export async function backupExistingUserRulePack(context, id, filePath) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!fileStat.isFile()) return null;

  const backupDir = ruleBackupDir(context, id);
  await mkdir(backupDir, { recursive: true });
  const backupId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}`;
  const backupPath = path.join(backupDir, `${backupId}.json`);
  await writeFile(backupPath, await readFile(filePath, "utf8"), "utf8");
  return {
    id: backupId,
    rulePackId: id,
    filePath: backupPath,
    createdAt: new Date().toISOString(),
    bytes: fileStat.size,
  };
}

export async function listRulePackBackups(context, id = null) {
  const root = ruleBackupRoot(context);
  const items = [];
  try {
    const rulePackDirs = id ? [id] : await readdir(root);
    for (const rulePackId of rulePackDirs) {
      const dir = ruleBackupDir(context, rulePackId);
      let fileNames;
      try {
        fileNames = (await readdir(dir)).filter((fileName) => fileName.endsWith(".json")).sort().reverse();
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const fileName of fileNames) {
        const filePath = path.join(dir, fileName);
        const fileStat = await stat(filePath);
        items.push({
          id: path.basename(fileName, ".json"),
          rulePackId,
          filePath,
          createdAt: fileStat.mtime.toISOString(),
          bytes: fileStat.size,
        });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    path: root,
    total: items.length,
    items,
  };
}

export async function restoreRulePackBackup(context, id, backupId) {
  const backups = await listRulePackBackups(context, id);
  const backup = backups.items.find((item) => item.id === backupId);
  if (!backup) return { ok: false, error: "backup_not_found" };
  const text = await readFile(backup.filePath, "utf8");
  const parsed = JSON.parse(text);
  const errors = validateRuleSetDefinition(parsed, backup.filePath);
  if (errors.length) return { ok: false, error: "invalid_rule_pack_backup", errors };
  const targetPath = path.join(context.userRulePacksPath, `${id}.json`);
  await mkdir(context.userRulePacksPath, { recursive: true });
  const currentBackup = await backupExistingUserRulePack(context, id, targetPath);
  await writeFile(targetPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return {
    ok: true,
    id,
    restoredFrom: backup,
    currentBackup,
    filePath: targetPath,
  };
}

export async function buildRuleDoctor(context) {
  const inventory = await buildRulePackInventory(context);
  const issues = [];
  for (const item of inventory.items) {
    if (!item.valid) {
      issues.push(issue("invalid_rule_pack", "error", item.id, item.errors.join("; ")));
    }
    for (const warning of item.warnings ?? []) {
      issues.push(issue(warning.code, warning.severity, item.id, warning.message));
    }
  }

  const byId = new Map();
  for (const item of inventory.items) {
    if (!item.id) continue;
    const existing = byId.get(item.id) ?? [];
    existing.push(item);
    byId.set(item.id, existing);
  }
  for (const [id, items] of byId.entries()) {
    const uniqueFiles = new Set(items.map((item) => normalizePath(item.filePath ?? item.path ?? item.id)));
    if (uniqueFiles.size > 1) {
      issues.push(issue("duplicate_rule_set_id", "error", id, `Rule set id appears in ${uniqueFiles.size} different rule pack files.`));
    }
  }

  const userItems = inventory.items.filter((item) => item.source === "user");
  for (const item of userItems) {
    if (!item.enabled) issues.push(issue("user_rule_pack_not_enabled", "info", item.id, "User rule pack exists but is not enabled in customRules."));
  }

  return {
    ok: !issues.some((item) => item.severity === "error"),
    generatedAt: new Date().toISOString(),
    inventory: {
      total: inventory.total,
      enabled: inventory.enabled,
      invalid: inventory.invalid,
      bySource: countBy(inventory.items, (item) => item.source),
    },
    issues,
  };
}

export async function runRulesDryRun(context, options = {}) {
  const baseline = await readJson(context.reportPath);
  const inlineRulePacks = normalizeInlineRulePacks(options.rulePack ? [options.rulePack] : options.rulePacks);
  const customRulePaths = dryRunCustomRulePaths(context, options.rulePackId);
  const ruleSets = context.configContext.config.rules?.length ? context.configContext.config.rules : null;
  const roots = context.configContext.config.roots ?? [];
  const config = context.configContext.config;
  const cacheSuffix = (options.rulePackId ?? inlineRulePacks.map((pack) => pack.id).filter(Boolean).join("-")) || "current";
  const dryRunCacheDir = path.join(context.dataDir, "rules-dry-run");
  const dryRunParseCachePath = path.join(dryRunCacheDir, `${safeFileName(cacheSuffix)}-parse-cache.json`);
  const dryRunChatCachePath = path.join(dryRunCacheDir, `${safeFileName(cacheSuffix)}-chat-cache.json`);
  const dryRunChatLinesCachePath = path.join(dryRunCacheDir, `${safeFileName(cacheSuffix)}-chat-lines-cache.json`);
  const officialParseCachePath = resolveConfigPath(context.configContext, config.cache.parse);
  const officialChatCachePath = resolveConfigPath(context.configContext, config.cache.chat);
  const officialChatLinesCachePath = resolveConfigPath(context.configContext, config.cache.chatLines);

  const cachePrewarm = await Promise.all([
    prewarmDryRunCache(officialParseCachePath, dryRunParseCachePath),
    prewarmDryRunCache(officialChatCachePath, dryRunChatCachePath),
    prewarmDryRunCache(officialChatLinesCachePath, dryRunChatLinesCachePath),
  ]);

  const summaries = await analyzeMinecraftRoots(roots, {
    scope: config.scopes?.length ? config.scopes : null,
    cachePath: dryRunParseCachePath,
    encoding: config.encoding,
  });
  const eventResult = await analyzeChatEvents(roots, {
    scope: config.scopes?.length ? config.scopes : null,
    ruleSets,
    customRulePaths,
    inlineRulePacks,
    encoding: config.encoding,
    unmatchedTemplatesLimit: config.unmatchedTemplatesLimit,
    cachePath: dryRunChatCachePath,
    chatLinesCachePath: dryRunChatLinesCachePath,
    ownerAliases: config.owner.aliases,
  });
  const rounds = buildRoundsByFile([...eventResult.events, ...buildRoundTransitionEvents(summaries)], { ownerAliases: config.owner.aliases });
  const candidate = buildReport({
    roots,
    encoding: config.encoding,
    ruleSets,
    customRulePaths,
    owner: config.owner,
    summaries,
    eventResult,
    rounds,
  });

  return buildDryRunDiff(baseline, candidate, {
    includeSamples: Boolean(options.full),
    full: Boolean(options.full),
    targetMode: options.targetMode ?? null,
    cache: {
      directory: dryRunCacheDir,
      official: {
        parse: officialParseCachePath,
        chat: officialChatCachePath,
        chatLines: officialChatLinesCachePath,
      },
      dryRun: {
        parse: dryRunParseCachePath,
        chat: dryRunChatCachePath,
        chatLines: dryRunChatLinesCachePath,
      },
      prewarmed: {
        parse: cachePrewarm[0],
        chat: cachePrewarm[1],
        chatLines: cachePrewarm[2],
      },
      full: Boolean(options.full),
    },
  });
}

export function buildRulePackDraftFromLabels(labels = [], options = {}) {
  const accepted = labels.filter((item) => ["win", "loss", "ignore", "new-rule-needed"].includes(labelDecision(item)));
  const rules = [];
  for (const [index, item] of accepted.entries()) {
    const text = item.message ?? item.text ?? item.sample ?? item.line;
    const decision = labelDecision(item);
    if (!text || decision === "new-rule-needed") continue;
    rules.push({
      id: item.ruleId ?? `${options.id ?? "label_draft"}_${index + 1}`,
      type: decision === "ignore" ? "ignore" : decision,
      pattern: messageToPattern(text),
      ...(item.gameMode ? { payload: { gameMode: item.gameMode } } : {}),
      examples: [text],
      negativeExamples: item.negativeExamples ?? [],
      confidence: item.confidence ?? "high",
      notes: item.notes ?? "Drafted from reviewed label export; inspect before enabling.",
    });
  }
  return {
    id: options.id ?? "reviewed-label-draft",
    name: options.name ?? "Reviewed Label Draft",
    description: "Draft rule pack generated from reviewed unknown/result labels.",
    rules,
  };
}

export function labelDecision(item = {}) {
  const value = item.reviewLabel ?? item.label ?? item.result ?? item.decision ?? null;
  return typeof value === "string" ? value.trim() || null : value;
}

export function validateLabelRows(labels = []) {
  const errors = [];
  for (const [index, item] of labels.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push({ index, field: "row", error: "expected_object" });
      continue;
    }
    const decision = labelDecision(item);
    if (!decision) continue;
    if (!VALID_REVIEW_LABELS.includes(decision)) {
      errors.push({ index, field: "reviewLabel", error: "unknown_value", value: decision });
    }
  }
  return { errors };
}

export function validateLabelRowsAgainstReport(labels = [], report = {}) {
  const errors = [...validateLabelRows(labels).errors];
  const knownRoundRefs = new Set(
    (report.rounds?.reliable ?? [])
      .filter((round) => round.result === "unknown")
      .map((round) => round.roundRef ?? hashRoundRef(round))
      .filter(Boolean),
  );
  for (const [index, item] of labels.entries()) {
    if (!item?.roundRef) continue;
    if (!knownRoundRefs.has(item.roundRef)) {
      errors.push({ index, field: "roundRef", error: "stale_or_unknown_round_ref", value: item.roundRef });
    }
  }
  return {
    ok: errors.length === 0,
    checkedRoundRefs: labels.filter((item) => item?.roundRef).length,
    knownRoundRefs: knownRoundRefs.size,
    errors,
  };
}

export function buildLabelReviewSummary(labels = [], options = {}) {
  const rows = Array.isArray(labels) ? labels : [];
  const validateRoundRefs = options.validateRoundRefs !== false;
  const labelValidation = validateRoundRefs && options.report
    ? validateLabelRowsAgainstReport(rows, options.report)
    : validateLabelRows(rows);
  const sampleLimit = Number.isInteger(options.sampleLimit) ? options.sampleLimit : 25;
  const normalized = rows.map((row, index) => normalizeLabelReviewRow(row, index));
  const labeledRows = normalized.filter((row) => row.label !== "unlabeled");
  const actionableRows = normalized.filter((row) => ["win", "loss", "ignore", "new-rule-needed"].includes(row.label));
  const draftableRows = normalized.filter((row) => ["win", "loss", "ignore"].includes(row.label) && row.hasRuleText);
  const missingRuleTextRows = normalized.filter((row) => ["win", "loss", "ignore"].includes(row.label) && !row.hasRuleText);
  return {
    ok: labelValidation.errors.length === 0,
    generatedAt: new Date().toISOString(),
    policy: "Reviewed labels are audit inputs only. They do not change report statistics until a reviewed rule pack is dry-run, enabled, and refreshed.",
    writes: {
      report: false,
      store: false,
      config: false,
      rules: false,
      labelSet: false,
    },
    totalRows: rows.length,
    labeledRows: labeledRows.length,
    unlabeledRows: rows.length - labeledRows.length,
    allowedLabels: VALID_REVIEW_LABELS,
    checkedRoundRefs: labelValidation.checkedRoundRefs ?? 0,
    knownRoundRefs: labelValidation.knownRoundRefs ?? null,
    errors: labelValidation.errors,
    byLabel: countBy(normalized, (row) => row.label),
    byCategory: countBy(normalized, (row) => row.category),
    byNextAction: countBy(normalized, (row) => row.nextAction),
    byMode: countBy(normalized, (row) => row.mode),
    byLabelAndCategory: nestedCountBy(normalized, (row) => row.label, (row) => row.category),
    candidates: {
      keepUnknown: labeledRows.filter((row) => row.label === "keep-unknown").length,
      win: labeledRows.filter((row) => row.label === "win").length,
      loss: labeledRows.filter((row) => row.label === "loss").length,
      ignore: labeledRows.filter((row) => row.label === "ignore").length,
      newRuleNeeded: labeledRows.filter((row) => row.label === "new-rule-needed").length,
      actionableRows: actionableRows.length,
      draftableRuleRows: draftableRows.length,
      missingRuleTextRows: missingRuleTextRows.length,
      needsDryRun: draftableRows.length > 0,
    },
    missingRuleTextRows: missingRuleTextRows.slice(0, sampleLimit).map((row) => ({
      index: row.index,
      label: row.label,
      roundRef: row.roundRef,
      category: row.category,
      nextAction: row.nextAction,
      mode: row.mode,
    })),
    staleRoundRefs: labelValidation.errors
      .filter((error) => error.field === "roundRef" && error.error === "stale_or_unknown_round_ref")
      .slice(0, sampleLimit),
    samples: normalized
      .filter((row) => row.label !== "unlabeled" || row.roundRef)
      .slice(0, sampleLimit),
    workflow: {
      readiness: buildLabelReviewReadiness({
        ok: labelValidation.errors.length === 0,
        totalRows: rows.length,
        unlabeledRows: rows.length - labeledRows.length,
        candidates: {
          draftableRuleRows: draftableRows.length,
          missingRuleTextRows: missingRuleTextRows.length,
        },
      }),
      nextActions: [
        "Fix invalid or stale labels before generating rules.",
        "Generate candidate rules with POST /api/rules/draft-from-labels or npm run rules:draft-from-labels.",
        "Run POST /api/rules/dry-run or npm run rules:dry-run before enabling any rule pack.",
        "Only refresh official report/store after dry-run risks are accepted.",
      ],
    },
  };
}

export function buildLabelReviewReadiness(summary = {}) {
  const status = classifyLabelReviewReadiness(summary);
  const action = labelReviewReadinessAction(status);
  return {
    status,
    nextStep: action.nextStep,
    blocked: action.blocked,
    blockingReason: action.blockingReason,
    requiresHumanInput: action.requiresHumanInput,
    canDraftRules: action.canDraftRules,
    canRunDryRun: action.canRunDryRun,
    canArchive: action.canArchive,
    nextCommand: action.nextCommand,
    readyForWorkflow: status === "ready_for_workflow" || status === "ready_keep_unknown_only",
    workflowRecommended: status === "ready_for_workflow",
    nextActions: labelReviewReadinessNextActions(status, summary),
  };
}

function classifyLabelReviewReadiness(summary = {}) {
  if (!summary.ok) return "invalid_labels";
  if ((summary.totalRows ?? 0) === 0) return "empty_queue";
  if ((summary.unlabeledRows ?? 0) > 0) return "needs_labeling";
  if ((summary.candidates?.missingRuleTextRows ?? 0) > 0) return "needs_rule_text";
  if ((summary.candidates?.draftableRuleRows ?? 0) > 0) return "ready_for_workflow";
  return "ready_keep_unknown_only";
}

function labelReviewReadinessNextActions(status, summary = {}) {
  if (status === "invalid_labels") return ["Fix invalid labels or stale roundRefs, then rerun label validation."];
  if (status === "empty_queue") return ["Export an unknown-audit queue before reviewing labels."];
  if (status === "needs_labeling") return [`Fill reviewLabel/reviewNotes for ${summary.unlabeledRows ?? 0} unlabeled row(s), then validate again.`];
  if (status === "needs_rule_text") return [`Add exact message text for ${summary.candidates?.missingRuleTextRows ?? 0} win/loss/ignore row(s), then validate again.`];
  if (status === "ready_for_workflow") return ["Run the combined audit workflow and inspect dry-run promotionGate before enabling any rules."];
  return ["Archive this reviewed batch as keep-unknown evidence, or continue sampling another audit queue."];
}

function labelReviewReadinessAction(status) {
  if (status === "invalid_labels") {
    return readinessAction({
      nextStep: "fix_labels",
      blocked: true,
      blockingReason: "invalid_labels",
      requiresHumanInput: true,
      nextCommand: "npm.cmd run result:audit-labels -- --input <reviewed-file>",
    });
  }
  if (status === "empty_queue") {
    return readinessAction({
      nextStep: "export_queue",
      blocked: true,
      blockingReason: "empty_queue",
      nextCommand: "npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current",
    });
  }
  if (status === "needs_labeling") {
    return readinessAction({
      nextStep: "label_rows",
      blocked: true,
      blockingReason: "unlabeled_rows",
      requiresHumanInput: true,
      nextCommand: "npm.cmd run result:audit-status -- --input <reviewed-file>",
    });
  }
  if (status === "needs_rule_text") {
    return readinessAction({
      nextStep: "add_rule_text",
      blocked: true,
      blockingReason: "missing_rule_text",
      requiresHumanInput: true,
      nextCommand: "npm.cmd run result:audit-status -- --input <reviewed-file>",
    });
  }
  if (status === "ready_for_workflow") {
    return readinessAction({
      nextStep: "run_audit_workflow",
      canDraftRules: true,
      canRunDryRun: true,
      nextCommand: "npm.cmd run rules:audit-workflow -- --input <reviewed-file> --target-mode bedwars",
    });
  }
  return readinessAction({
    nextStep: "archive_keep_unknown",
    canArchive: true,
    nextCommand: "npm.cmd run result:audit -- --mode bedwars --prefix unknown-audit-bedwars-current",
  });
}

function readinessAction(overrides = {}) {
  return {
    nextStep: "fix_labels",
    blocked: false,
    blockingReason: null,
    requiresHumanInput: false,
    canDraftRules: false,
    canRunDryRun: false,
    canArchive: false,
    nextCommand: null,
    ...overrides,
  };
}

function buildDryRunDiff(baseline, candidate, options = {}) {
  const baselineOverview = resultOverview(baseline);
  const candidateOverview = resultOverview(candidate);
  const roundChanges = compareRounds(baseline.rounds?.reliable ?? [], candidate.rounds?.reliable ?? [], options);
  const ambiguousDelta = candidateOverview.ambiguousResults - baselineOverview.ambiguousResults;
  const pitResultRisk = thePitResultRisk(candidate);
  const byMode = compareModeResults(baseline, candidate);
  const risks = [
    ...(ambiguousDelta > 0 ? [{ code: "ambiguous_results_increased", severity: "error", delta: ambiguousDelta }] : []),
    ...(pitResultRisk ? [{ code: "the_pit_result_eligible_rounds", severity: "error", ...pitResultRisk }] : []),
    ...(roundChanges.total > 50 ? [{ code: "large_round_result_diff", severity: "warning", total: roundChanges.total }] : []),
  ];
  return {
    ok: ambiguousDelta === 0 && !pitResultRisk,
    generatedAt: new Date().toISOString(),
    writes: {
      report: false,
      store: false,
      config: false,
      officialCache: false,
      dryRunCache: true,
    },
    cache: dryRunCacheInfo(options.cache),
    summary: {
      baseline: baselineOverview,
      candidate: candidateOverview,
      delta: deltaObject(baselineOverview, candidateOverview),
    },
    byMode,
    chatMatches: {
      baseline: baseline.rules?.chatMatched ?? baseline.overview?.chatMatched ?? 0,
      candidate: candidate.rules?.chatMatched ?? candidate.overview?.chatMatched ?? 0,
      delta: (candidate.rules?.chatMatched ?? candidate.overview?.chatMatched ?? 0) - (baseline.rules?.chatMatched ?? baseline.overview?.chatMatched ?? 0),
    },
    roundChanges,
    risks,
    promotionGate: buildPromotionGate({
      baselineOverview,
      candidateOverview,
      byMode,
      risks,
      targetMode: options.targetMode ?? null,
    }),
  };
}

function thePitResultRisk(report) {
  const pit = report.rounds?.summary?.gameModes?.the_pit;
  if (!pit) return null;
  const resultEligibleRounds = pit.resultEligible ?? 0;
  const resultCount = (pit.wins ?? 0) + (pit.losses ?? 0) + (pit.unknownResults ?? 0) + (pit.ambiguousResults ?? 0);
  if (resultEligibleRounds <= 0 && resultCount <= 0) return null;
  return {
    resultEligibleRounds,
    wins: pit.wins ?? 0,
    losses: pit.losses ?? 0,
    unknownResults: pit.unknownResults ?? 0,
    ambiguousResults: pit.ambiguousResults ?? 0,
  };
}

function dryRunCacheInfo(cache) {
  if (!cache) return null;
  const info = {
    officialCache: false,
    dryRunCache: true,
    prewarmed: cache.prewarmed ?? {},
  };
  return cache.full
    ? {
        ...info,
        directory: cache.directory,
        official: cache.official,
        dryRun: cache.dryRun,
      }
    : info;
}

function compareRounds(baselineRounds, candidateRounds, options) {
  const candidateByKey = new Map(candidateRounds.map((round) => [round.key, round]));
  const changes = [];
  for (const round of baselineRounds) {
    const next = candidateByKey.get(round.key);
    if (!next) continue;
    if (round.result === next.result && round.resultReason === next.resultReason) continue;
    const sampleIndex = changes.length + 1;
    changes.push({
      key: options.full ? round.key : `round-${sampleIndex}`,
      mode: round.gameMode,
      startAt: round.startAt,
      before: { result: round.result, resultReason: round.resultReason },
      after: { result: next.result, resultReason: next.resultReason },
      ...(options.includeSamples ? { filePath: round.filePath, lineNo: round.lineNo } : {}),
    });
  }
  return {
    total: changes.length,
    byMode: countBy(changes, (item) => item.mode),
    byTransition: countBy(changes, (item) => `${item.before.result}->${item.after.result}`),
    samples: changes.slice(0, options.full ? 50 : 10),
  };
}

function compareModeResults(baseline, candidate) {
  const modes = new Set([
    ...Object.keys(baseline.rounds?.summary?.gameModes ?? {}),
    ...Object.keys(candidate.rounds?.summary?.gameModes ?? {}),
  ]);
  return Object.fromEntries([...modes].sort().map((mode) => {
    const before = modeOverview(baseline.rounds?.summary?.gameModes?.[mode]);
    const after = modeOverview(candidate.rounds?.summary?.gameModes?.[mode]);
    return [mode, { before, after, delta: deltaObject(before, after) }];
  }));
}

function buildPromotionGate({ baselineOverview, candidateOverview, byMode, risks, targetMode }) {
  const errorRisks = (risks ?? []).filter((risk) => risk.severity === "error");
  const ambiguousDelta = candidateOverview.ambiguousResults - baselineOverview.ambiguousResults;
  const targetUnknownDelta = targetMode && byMode[targetMode]
    ? byMode[targetMode].delta.unknownResults
    : null;
  const nonTargetResultDeltas = Object.entries(byMode ?? {})
    .filter(([mode]) => !targetMode || mode !== targetMode)
    .map(([mode, item]) => ({
      mode,
      wins: item.delta.wins ?? 0,
      losses: item.delta.losses ?? 0,
      unknownResults: item.delta.unknownResults ?? 0,
      ambiguousResults: item.delta.ambiguousResults ?? 0,
      resultEligible: item.delta.resultEligible ?? 0,
    }))
    .filter((item) => item.wins || item.losses || item.unknownResults || item.ambiguousResults || item.resultEligible);
  const failures = [
    ...(ambiguousDelta > 0 ? [{ code: "ambiguous_results_increased", severity: "error", delta: ambiguousDelta }] : []),
    ...(targetUnknownDelta !== null && targetUnknownDelta > 0 ? [{ code: "target_unknown_increased", severity: "error", mode: targetMode, delta: targetUnknownDelta }] : []),
    ...errorRisks,
  ];
  const warnings = [
    ...(nonTargetResultDeltas.length ? [{ code: "non_target_mode_result_delta", severity: "warning", modes: nonTargetResultDeltas }] : []),
    ...(targetMode ? [] : [{ code: "target_mode_not_declared", severity: "info" }]),
  ];
  return {
    status: failures.length ? "blocked" : warnings.some((warning) => warning.severity === "warning") ? "review" : "pass",
    targetMode,
    checks: {
      ambiguousResultsDelta: ambiguousDelta,
      targetUnknownDelta,
      thePitSafe: !errorRisks.some((risk) => risk.code === "the_pit_result_eligible_rounds"),
      nonTargetResultDeltas,
    },
    failures,
    warnings,
    policy: "Enable candidate rules only after promotionGate passes or review warnings are explicitly accepted; labels and dry-run previews do not change official statistics.",
  };
}

function resultOverview(report) {
  return {
    reliableRounds: report.overview?.reliableRounds ?? report.results?.summary?.reliableRounds ?? 0,
    resultEligibleRounds: report.overview?.resultEligibleRounds ?? report.results?.summary?.resultEligibleRounds ?? 0,
    nonResultRounds: report.overview?.nonResultRounds ?? report.results?.summary?.nonResultRounds ?? 0,
    wins: report.overview?.wins ?? report.results?.summary?.wins ?? 0,
    losses: report.overview?.losses ?? report.results?.summary?.losses ?? 0,
    unknownResults: report.overview?.unknownResults ?? report.results?.summary?.unknownRoundResults ?? 0,
    ambiguousResults: report.overview?.ambiguousResults ?? report.results?.summary?.ambiguousResults ?? 0,
    notApplicableResults: report.overview?.notApplicableResults ?? report.results?.summary?.notApplicableResults ?? 0,
  };
}

function modeOverview(mode) {
  return {
    rounds: mode?.rounds ?? 0,
    resultEligible: mode?.resultEligible ?? 0,
    nonResult: mode?.nonResult ?? 0,
    wins: mode?.wins ?? 0,
    losses: mode?.losses ?? 0,
    unknownResults: mode?.unknownResults ?? 0,
    ambiguousResults: mode?.ambiguousResults ?? 0,
    notApplicableResults: mode?.notApplicableResults ?? 0,
  };
}

function safeListBundledAndConfigured(customRulePaths) {
  return listRuleSets({ customRulePaths }).map((item) => ({
    ...item,
    valid: true,
    errors: [],
  }));
}

async function safeStat(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function prewarmDryRunCache(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) return false;
  try {
    await stat(targetPath);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readRulePackMetadata(filePath, fallbackId) {
  const fileStat = await stat(filePath);
  try {
    const text = await readFile(filePath, "utf8");
    const rulePack = JSON.parse(text);
    const errors = validateRuleSetDefinition(rulePack, filePath);
    return {
      id: rulePack.id ?? fallbackId,
      name: rulePack.name,
      description: rulePack.description,
      filePath,
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      rules: Array.isArray(rulePack.rules) ? rulePack.rules.length : 0,
      valid: errors.length === 0,
      errors,
      rulePack,
    };
  } catch (error) {
    return {
      id: fallbackId,
      filePath,
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      rules: 0,
      valid: false,
      errors: [error.message],
      rulePack: null,
    };
  }
}

function warningsForRulePack(rulePack) {
  const warnings = [];
  const seen = new Set();
  const patterns = new Map();
  for (const rule of rulePack.rules ?? []) {
    if (seen.has(rule.id)) warnings.push({ code: "duplicate_rule_id", severity: "error", message: `Duplicate rule id: ${rule.id}` });
    seen.add(rule.id);
    const patternKey = `${rule.type ?? ""}\0${rule.flags ?? ""}\0${rule.pattern ?? ""}`;
    const previous = patterns.get(patternKey);
    if (previous) {
      warnings.push({
        code: "duplicate_rule_pattern",
        severity: "warning",
        message: `Rule ${rule.id} duplicates ${previous.id} for type ${rule.type}.`,
      });
    } else {
      patterns.set(patternKey, rule);
    }
    if (resultTypes.has(rule.type) && looksBroadPattern(rule.pattern)) {
      warnings.push({ code: "broad_result_rule", severity: "warning", message: `Result rule ${rule.id} has a broad pattern.` });
    }
    if (boundaryTypes.has(rule.type) && looksBroadPattern(rule.pattern)) {
      warnings.push({ code: "broad_boundary_rule", severity: "warning", message: `Boundary rule ${rule.id} has a broad pattern.` });
    }
  }
  if (!(rulePack.rules ?? []).length) warnings.push({ code: "empty_rule_pack", severity: "warning", message: "Rule pack has no rules." });
  return warnings;
}

function looksBroadPattern(pattern = "") {
  const text = String(pattern);
  return text.length < riskyPatternLength || text === ".*" || text === "^.*$" || /\.\*\??/.test(text.replace(/^\^|\$$/g, ""));
}

function issue(code, severity, rulePackId, message) {
  return { code, severity, rulePackId, message };
}

function userRulePackEnabled(item, enabledCustomRules) {
  return enabledCustomRules.has("custom-rules/user")
    || enabledCustomRules.has(`custom-rules/user/${item.id}.json`)
    || enabledCustomRules.has(normalizeConfigRulePath(path.relative(itemProjectRoot(item.filePath), item.filePath)));
}

function itemProjectRoot(filePath) {
  const marker = `${path.sep}custom-rules${path.sep}user${path.sep}`;
  const index = filePath.indexOf(marker);
  return index >= 0 ? filePath.slice(0, index) : process.cwd();
}

function normalizeConfigRulePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

function sourceRank(source) {
  return { bundled: 0, configured: 1, custom: 1, user: 2 }[source] ?? 9;
}

function resolveCustomRulePaths(context) {
  return (context.configContext.config.customRules ?? []).map((value) => resolveConfigPath(context.configContext, value));
}

function dryRunCustomRulePaths(context, rulePackId) {
  const current = resolveCustomRulePaths(context);
  if (!rulePackId) return current;

  const userRulePackPath = path.join(context.userRulePacksPath, `${rulePackId}.json`);
  const currentPaths = new Set(current.map(normalizePath));
  if (currentPaths.has(normalizePath(context.userRulePacksPath)) || currentPaths.has(normalizePath(userRulePackPath))) {
    return current;
  }
  return [...current, userRulePackPath];
}

function ruleBackupRoot(context) {
  return path.join(context.dataDir, "rule-pack-backups");
}

function ruleBackupDir(context, id) {
  return path.join(ruleBackupRoot(context), id);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items ?? []) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function nestedCountBy(items, outerKeyFn, innerKeyFn) {
  const output = {};
  for (const item of items ?? []) {
    const outer = outerKeyFn(item) ?? "unknown";
    const inner = innerKeyFn(item) ?? "unknown";
    output[outer] ??= {};
    output[outer][inner] = (output[outer][inner] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(output)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => [key, Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))]),
  );
}

function normalizeLabelReviewRow(row, index) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {
      index,
      id: null,
      roundRef: null,
      label: "unlabeled",
      category: "unknown",
      nextAction: "unknown",
      mode: "unknown",
      hasRuleText: false,
      hasNotes: false,
    };
  }
  const label = labelDecision(row) ?? "unlabeled";
  const audit = row.unknownAudit ?? row.audit ?? {};
  const features = audit.features ?? {};
  return {
    index,
    id: typeof row.id === "string" ? row.id : null,
    roundRef: typeof row.roundRef === "string" ? row.roundRef : null,
    label,
    category: row.category ?? row.auditCategory ?? audit.category ?? "unknown",
    nextAction: row.nextAction ?? row.unknownNextAction ?? audit.nextAction ?? "unknown",
    mode: row.gameMode ?? row.mode ?? features.mode ?? "unknown",
    hasRuleText: Boolean(row.message ?? row.text ?? row.sample ?? row.line),
    hasNotes: Boolean(row.reviewNotes ?? row.notes),
  };
}

function deltaObject(before, after) {
  return Object.fromEntries(Object.keys({ ...before, ...after }).map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
}

function normalizeInlineRulePacks(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildRoundTransitionEvents(summaries) {
  return summaries.flatMap((summary) => summary.transitionEvents ?? []);
}

function messageToPattern(message) {
  const cleaned = String(message).replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "").replace(/\s+/g, " ").trim();
  return `^${escapeRegex(cleaned).replace(/\d+/g, "\\d+")}$`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "rules";
}

function hashRoundRef(round) {
  return createHash("sha256")
    .update([
      round.source,
      round.scope,
      round.filePath,
      round.lineNo,
      round.startMs,
      round.endMs,
    ].map((value) => String(value ?? "")).join("\0"))
    .digest("hex")
    .slice(0, 16);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
