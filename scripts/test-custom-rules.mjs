import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuleSignature, listRuleSets, parseChatEvent } from "../src/parser/chatRules.mjs";

const fixtureDir = path.resolve(".cache", "test-custom-rules");
const fixturePath = path.join(fixtureDir, "local-server.json");

await mkdir(fixtureDir, { recursive: true });
await writeFile(
  fixturePath,
  JSON.stringify(
    {
      id: "local-server",
      name: "Local Server",
      description: "Fixture custom rule pack.",
      rules: [
        {
          id: "local_win",
          type: "win",
          pattern: "^LOCAL WIN (?<map>.+)!$",
          payload: {
            gameMode: "duels",
          },
        },
      ],
    },
    null,
    2,
  ),
  "utf8",
);

try {
  const customRulePaths = [fixtureDir];
  const ruleSets = listRuleSets({ customRulePaths });
  assert.equal(ruleSets[0].id, "local-server");
  assert.equal(ruleSets[0].source, "custom");

  const event = parseChatEvent("LOCAL WIN Arena!", { customRulePaths });
  assert.equal(event.type, "win");
  assert.equal(event.ruleSet, "local-server");
  assert.equal(event.ruleId, "local_win");
  assert.equal(event.payload.map, "Arena");
  assert.equal(event.payload.gameMode, "duels");

  const bundledOnly = getRuleSignature([]);
  const withCustom = getRuleSignature([], { customRulePaths });
  assert.notEqual(withCustom, bundledOnly);

  await writeFile(
    fixturePath,
    JSON.stringify(
      {
        id: "local-server",
        name: "Local Server",
        description: "Updated fixture custom rule pack.",
        rules: [
          {
            id: "local_loss",
            type: "loss",
            pattern: "^LOCAL LOSS (?<map>.+)!$",
            payload: {
              gameMode: "duels",
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const updatedEvent = parseChatEvent("LOCAL LOSS Arena!", { customRulePaths });
  assert.equal(updatedEvent.type, "loss");
  assert.equal(updatedEvent.ruleSet, "local-server");
  assert.equal(updatedEvent.ruleId, "local_loss");
  assert.equal(updatedEvent.payload.map, "Arena");
  assert.equal(parseChatEvent("LOCAL WIN Arena!", { customRulePaths }), null);

  const validLabelsPath = path.join(fixtureDir, "valid-labels.jsonl");
  const draftOutPath = path.join(fixtureDir, "drafts", "valid-draft.json");
  await writeFile(validLabelsPath, `${JSON.stringify({ reviewLabel: "win", message: "CLI DRAFT WIN", gameMode: "bedwars" })}\n`, "utf8");
  const validDraft = JSON.parse(await runDraftFromLabels(["--input", validLabelsPath, "--out", draftOutPath]));
  assert.equal(validDraft.ok, true);
  assert.equal(validDraft.rules, 1);
  const writtenDraft = JSON.parse(await readFile(draftOutPath, "utf8"));
  assert.equal(writtenDraft.rules[0].type, "win");
  assert.equal(writtenDraft.rules[0].payload.gameMode, "bedwars");

  const workflowOutDir = path.join(fixtureDir, "audit-workflows");
  const workflow = JSON.parse(await runAuditWorkflow(["--input", validLabelsPath, "--out-dir", workflowOutDir, "--prefix", "valid", "--skip-dry-run"]));
  assert.equal(workflow.ok, true);
  assert.equal(workflow.status, "draft_ready");
  assert.equal(workflow.draftRules, 1);
  assert.equal(workflow.dryRunStatus, null);
  assert.equal(workflow.writes.report, false);
  assert.equal(workflow.writes.store, false);
  assert.equal(workflow.writes.config, false);
  assert.equal(workflow.writes.rules, false);
  assert.equal(workflow.artifactSummary.privacy, "local_paths_redacted");
  assert.equal(path.isAbsolute(workflow.artifactSummary.outDir), false);
  assert.equal(workflow.artifactSummary.files.workflow.fileName, "valid.workflow.json");
  assert.equal(path.isAbsolute(workflow.artifactSummary.files.workflow.relativePath), false);
  assert.equal(await fileExists(path.join(workflowOutDir, "valid.workflow.json")), true);
  assert.equal(await fileExists(path.join(workflowOutDir, "valid.draft-rule-pack.json")), true);

  const missingTextLabelsPath = path.join(fixtureDir, "missing-text-labels.jsonl");
  await writeFile(missingTextLabelsPath, `${JSON.stringify({ reviewLabel: "win", gameMode: "bedwars", roundRef: null })}\n`, "utf8");
  const missingTextWorkflow = JSON.parse(await runAuditWorkflow([
    "--input",
    missingTextLabelsPath,
    "--out-dir",
    workflowOutDir,
    "--prefix",
    "missing-text",
    "--skip-dry-run",
    "--no-validate-round-refs",
  ]));
  assert.equal(missingTextWorkflow.ok, true);
  assert.equal(missingTextWorkflow.status, "missing_rule_text");
  assert.equal(missingTextWorkflow.missingRuleTextRows, 1);
  assert.equal(missingTextWorkflow.draftRules, 0);
  const missingTextArtifact = JSON.parse(await readFile(path.join(workflowOutDir, "missing-text.workflow.json"), "utf8"));
  assert.equal(missingTextArtifact.workflow.status, "missing_rule_text");
  assert.equal(missingTextArtifact.labelSummary.candidates.missingRuleTextRows, 1);
  assert.equal(missingTextArtifact.labelSummary.missingRuleTextRows[0].label, "win");

  const dryRunFixtureDir = path.join(fixtureDir, "dry-run-workflow");
  const dryRunRoot = path.join(dryRunFixtureDir, "minecraft");
  const dryRunLogPath = path.join(dryRunRoot, "logs", "2026-06-15-1.log");
  const dryRunConfigPath = path.join(dryRunFixtureDir, "observatory.config.json");
  const dryRunReportPath = path.join(dryRunFixtureDir, "report.json");
  const dryRunSummaryPath = path.join(dryRunFixtureDir, "summary.json");
  await mkdir(path.dirname(dryRunLogPath), { recursive: true });
  await writeFile(dryRunLogPath, [
    "[10:00:00] [Client thread/INFO]: [CHAT] The game starts in 5 seconds!",
    "[10:00:05] [Client thread/INFO]: [CHAT] WORKFLOW CLI WIN",
    "[10:00:06] [Client thread/INFO]: [CHAT] You are now a ghost.",
  ].join("\n") + "\n", "utf8");
  await writeFile(
    dryRunConfigPath,
    JSON.stringify({
      roots: [dryRunRoot],
      encoding: "utf-8",
      rules: [],
      customRules: [],
      owner: {
        mode: "all_local_users",
        displayName: "Owner",
        aliases: [],
      },
      app: {
        dataDir: "derived-data",
        skinProxyEnabled: false,
      },
      cache: {
        parse: ".cache/parse.json",
        chat: ".cache/chat.json",
        chatLines: ".cache/chat-lines.json",
      },
      outputs: {
        report: "report.json",
        summary: "summary.json",
      },
    }, null, 2),
    "utf8",
  );
  await runReport(["--config", dryRunConfigPath]);
  const dryRunReportBefore = await readFile(dryRunReportPath, "utf8");
  const dryRunSummaryBefore = await readFile(dryRunSummaryPath, "utf8");
  const dryRunLocalPath = path.join(dryRunFixtureDir, "observatory.local.json");
  const dryRunLocalBefore = await readOptionalText(dryRunLocalPath);
  const dryRunLabelsPath = path.join(dryRunFixtureDir, "reviewed.jsonl");
  await writeFile(dryRunLabelsPath, `${JSON.stringify({ reviewLabel: "win", message: "WORKFLOW CLI WIN", gameMode: "bedwars" })}\n`, "utf8");
  const dryRunWorkflowOutDir = path.join(dryRunFixtureDir, "artifacts");
  const dryRunWorkflow = JSON.parse(await runAuditWorkflow([
    "--config",
    dryRunConfigPath,
    "--input",
    dryRunLabelsPath,
    "--out-dir",
    dryRunWorkflowOutDir,
    "--prefix",
    "full",
    "--target-mode",
    "bedwars",
  ]));
  assert.equal(dryRunWorkflow.ok, true);
  assert.equal(dryRunWorkflow.draftRules, 1);
  assert.ok(["pass", "review", "blocked"].includes(dryRunWorkflow.dryRunStatus));
  assert.equal(typeof dryRunWorkflow.roundChanges, "number");
  assert.equal(dryRunWorkflow.writes.report, false);
  assert.equal(dryRunWorkflow.writes.store, false);
  assert.equal(dryRunWorkflow.writes.config, false);
  assert.equal(dryRunWorkflow.writes.rules, false);
  assert.equal(dryRunWorkflow.writes.dryRunCache, true);
  assert.equal(dryRunWorkflow.artifactSummary.privacy, "local_paths_redacted");
  assert.equal(path.isAbsolute(dryRunWorkflow.artifactSummary.outDir), false);
  assert.equal(dryRunWorkflow.artifactSummary.files.dryRun.fileName, "full.dry-run.json");
  assert.equal(path.isAbsolute(dryRunWorkflow.artifactSummary.files.dryRun.relativePath), false);
  assert.equal(await fileExists(path.join(dryRunWorkflowOutDir, "full.workflow.json")), true);
  assert.equal(await fileExists(path.join(dryRunWorkflowOutDir, "full.draft-rule-pack.json")), true);
  assert.equal(await fileExists(path.join(dryRunWorkflowOutDir, "full.dry-run.json")), true);
  const dryRunArtifact = JSON.parse(await readFile(path.join(dryRunWorkflowOutDir, "full.dry-run.json"), "utf8"));
  assert.equal(dryRunArtifact.writes.report, false);
  assert.equal(dryRunArtifact.writes.store, false);
  assert.equal(dryRunArtifact.writes.config, false);
  assert.equal(dryRunArtifact.writes.officialCache, false);
  assert.equal(dryRunArtifact.writes.dryRunCache, true);
  assert.equal(dryRunArtifact.promotionGate.targetMode, "bedwars");
  assert.equal(await readFile(dryRunReportPath, "utf8"), dryRunReportBefore);
  assert.equal(await readFile(dryRunSummaryPath, "utf8"), dryRunSummaryBefore);
  assert.equal(await readOptionalText(dryRunLocalPath), dryRunLocalBefore);

  const invalidLabelsPath = path.join(fixtureDir, "invalid-labels.jsonl");
  const invalidOutPath = path.join(fixtureDir, "drafts", "invalid-draft.json");
  await writeFile(invalidLabelsPath, `${JSON.stringify({ reviewLabel: "maybe", message: "BAD LABEL" })}\n`, "utf8");
  const invalidDraft = await runDraftFromLabels(["--input", invalidLabelsPath, "--out", invalidOutPath], { expectFailure: true });
  assert.equal(invalidDraft.status, 1);
  assert.equal(invalidDraft.body.error, "invalid_label_rows");
  assert.equal(invalidDraft.body.errors[0].value, "maybe");
  assert.equal(await fileExists(invalidOutPath), false);

  const reportPath = path.join(fixtureDir, "report.json");
  await writeFile(
    reportPath,
    JSON.stringify({
      rounds: {
        reliable: [
          {
            result: "unknown",
            source: "Fixture",
            scope: "Scope",
            filePath: "D:/logs/latest.log",
            lineNo: 10,
            startMs: 1000,
            endMs: 2000,
          },
        ],
      },
    }, null, 2),
    "utf8",
  );
  const staleLabelsPath = path.join(fixtureDir, "stale-labels.jsonl");
  await writeFile(staleLabelsPath, `${JSON.stringify({ reviewLabel: "loss", roundRef: "stale-round-ref", message: "STALE LABEL" })}\n`, "utf8");
  const staleDraft = await runDraftFromLabels(["--input", staleLabelsPath, "--report", reportPath], { expectFailure: true });
  assert.equal(staleDraft.status, 1);
  assert.equal(staleDraft.body.error, "invalid_label_rows");
  assert.equal(staleDraft.body.errors[0].error, "stale_or_unknown_round_ref");

  console.log("custom rule tests passed");
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

function runDraftFromLabels(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/rules-draft-from-labels.mjs", ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        if (options.expectFailure) {
          resolve({ status: error.code, body: JSON.parse(stderr || stdout) });
          return;
        }
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function runAuditWorkflow(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/rules-audit-workflow.mjs", ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        if (options.expectFailure) {
          resolve({ status: error.code, body: JSON.parse(stderr || stdout) });
          return;
        }
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function runReport(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/report.mjs", ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
