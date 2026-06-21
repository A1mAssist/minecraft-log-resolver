import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateRuleSetDefinition } from "./chatRules.mjs";
import {
  buildLabelReviewSummary,
  buildRulePackDraftFromLabels,
  labelDecision,
  runRulesDryRun,
  validateLabelRows,
  validateLabelRowsAgainstReport,
} from "./ruleEcosystem.mjs";

export async function runAuditLabelWorkflow(context, labels = [], options = {}) {
  const validateRoundRefs = options.validateRoundRefs !== false;
  const report = validateRoundRefs ? options.report ?? await safeReadReport(context) : null;
  const sampleLimit = Number.isInteger(options.sampleLimit) ? options.sampleLimit : 25;
  const labelSummary = buildLabelReviewSummary(labels, {
    validateRoundRefs,
    report,
    sampleLimit,
  });

  const result = {
    ok: labelSummary.ok,
    generatedAt: new Date().toISOString(),
    policy: "Audit labels can generate draft rule packs and dry-run previews, but this workflow does not enable rules or change official report/store/config data.",
    writes: {
      report: false,
      store: false,
      config: false,
      rules: false,
      artifacts: false,
      dryRunCache: false,
    },
    input: {
      rows: Array.isArray(labels) ? labels.length : 0,
      validateRoundRefs,
      targetMode: typeof options.targetMode === "string" && options.targetMode.trim() ? options.targetMode.trim() : null,
    },
    labelSummary,
    draft: null,
    dryRun: null,
    artifacts: {},
    workflow: {
      status: labelSummary.ok ? "validated" : "invalid_labels",
      nextActions: labelSummary.ok
        ? ["Review draft rule regexes.", "Inspect dry-run promotionGate before enabling any user rule pack."]
        : ["Fix invalid or stale label rows, then rerun the workflow."],
    },
  };

  if (!labelSummary.ok) return result;

  const labelValidation = validateRoundRefs && report
    ? validateLabelRowsAgainstReport(labels, report)
    : validateLabelRows(labels);
  if (labelValidation.errors.length) {
    return {
      ...result,
      ok: false,
      workflow: {
        status: "invalid_labels",
        nextActions: ["Fix invalid or stale label rows, then rerun the workflow."],
      },
    };
  }

  const rulePack = buildRulePackDraftFromLabels(labels, {
    id: options.id ?? "reviewed-label-draft",
    name: options.name ?? "Reviewed Label Draft",
  });
  const errors = validateRuleSetDefinition(rulePack, "<audit-label-workflow>");
  result.draft = {
    ok: errors.length === 0,
    rulePack,
    rules: rulePack.rules.length,
    errors,
    sourceRows: labels.length,
    decisions: countBy(labels, (item) => labelDecision(item) ?? "unlabeled"),
  };
  if (errors.length) {
    result.ok = false;
    result.workflow = {
      status: "invalid_draft",
      nextActions: ["Fix draft rule validation errors before dry-running."],
    };
    return result;
  }

  if (rulePack.rules.length > 0 && options.skipDryRun !== true) {
    const dryRun = await runRulesDryRun(context, {
      rulePack,
      targetMode: result.input.targetMode,
      full: options.full === true,
    });
    result.dryRun = dryRun;
    result.writes.dryRunCache = Boolean(dryRun?.writes?.dryRunCache);
    result.workflow = {
      status: dryRun.promotionGate?.status === "pass" ? "dry_run_pass" : "dry_run_review",
      nextActions: [
        "Review promotionGate, risks, and roundChanges before saving or enabling rules.",
        "If accepted, save the draft as a user rule pack and refresh official report/store.",
      ],
    };
  } else if (rulePack.rules.length === 0) {
    const missingRuleTextRows = result.labelSummary?.candidates?.missingRuleTextRows ?? 0;
    result.workflow = {
      status: missingRuleTextRows > 0 ? "missing_rule_text" : "no_draftable_rules",
      nextActions: missingRuleTextRows > 0
        ? ["Fill the message field for win/loss/ignore labels that should become draft rules.", "Rerun label validation and audit workflow after adding exact chat text."]
        : ["Add win/loss/ignore labels with message text to produce draft rules."],
    };
  } else {
    result.workflow = {
      status: "draft_ready",
      nextActions: ["Run rules:dry-run or POST /api/rules/dry-run before enabling the draft."],
    };
  }

  if (options.writeArtifacts) {
    const artifacts = await writeAuditWorkflowArtifacts(context, result, options);
    result.artifacts = artifacts;
    result.artifactSummary = buildArtifactSummary(context, artifacts, options);
    result.writes.artifacts = Object.keys(artifacts).length > 0;
  }

  return result;
}

export async function writeAuditWorkflowArtifacts(context, result, options = {}) {
  const outDir = options.outDir ?? path.join(context.dataDir, "unknown-audit-workflows");
  const prefix = safeFileName(options.prefix ?? result.draft?.rulePack?.id ?? "audit-workflow");
  await mkdir(outDir, { recursive: true });
  const artifacts = {};
  if (result.draft?.rulePack) {
    const draftPath = path.join(outDir, `${prefix}.draft-rule-pack.json`);
    await writeFile(draftPath, `${JSON.stringify(result.draft.rulePack, null, 2)}\n`, "utf8");
    artifacts.draftRulePack = draftPath;
  }
  if (result.dryRun) {
    const dryRunPath = path.join(outDir, `${prefix}.dry-run.json`);
    await writeFile(dryRunPath, `${JSON.stringify(result.dryRun, null, 2)}\n`, "utf8");
    artifacts.dryRun = dryRunPath;
  }
  const workflowPath = path.join(outDir, `${prefix}.workflow.json`);
  await writeFile(workflowPath, `${JSON.stringify({ ...result, artifacts, writes: { ...result.writes, artifacts: true } }, null, 2)}\n`, "utf8");
  artifacts.workflow = workflowPath;
  return artifacts;
}

function buildArtifactSummary(context, artifacts, options = {}) {
  const projectRoot = context?.configContext?.dir ?? process.cwd();
  const outDir = options.outDir ?? path.join(context.dataDir, "unknown-audit-workflows");
  return {
    privacy: "local_paths_redacted",
    outDir: safeRelativePath(projectRoot, outDir),
    files: Object.fromEntries(Object.entries(artifacts ?? {}).map(([key, filePath]) => [key, {
      fileName: path.basename(filePath),
      relativePath: safeRelativePath(projectRoot, filePath),
    }])),
  };
}

function safeRelativePath(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return path.basename(target);
  return relative.split(path.sep).join("/");
}

async function safeReadReport(context) {
  try {
    const text = await readFile(context.reportPath, "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items ?? []) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function safeFileName(value) {
  return String(value ?? "audit-workflow").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "audit-workflow";
}
