import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "mlo-audit-export-"));
try {
  const reportPath = path.join(tempDir, "report.json");
  const tempRoot = path.join(tempDir, "root");
  const logPath = path.join(tempRoot, "logs", "2026-06-15-1.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, [
    "[10:00:00] [Client thread/INFO]: [CHAT] The game starts in 5 seconds!",
    "[10:00:01] [Client thread/INFO]: [CHAT] You are now a ghost.",
    "[10:00:02] [Client thread/INFO]: [CHAT] VICTORY!",
    "[10:00:11] [Client thread/INFO]: [CHAT] You are now a ghost.",
    "[10:00:12] [Client thread/INFO]: [CHAT] DEFEAT!",
  ].join("\n") + "\n", "utf8");
  await writeFile(reportPath, `${JSON.stringify(buildFixtureReport(logPath), null, 2)}\n`, "utf8");

  const run = await runUnknownAuditExport([
    "--report",
    reportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "unknown-audit",
    "--limit",
    "2",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const stdout = JSON.parse(run.stdout);
  assert.equal(stdout.exported, 2);
  assert.equal(Object.hasOwn(stdout, "packetPath"), false);

  const jsonPath = path.join(tempDir, "unknown-audit.json");
  const jsonlPath = path.join(tempDir, "unknown-audit.jsonl");
  const csvPath = path.join(tempDir, "unknown-audit.csv");
  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(json.schema.name, "minecraft-log-observatory-unknown-audit-export");
  assert.equal(json.schema.version, 2);
  assert.deepEqual(json.review.allowedReviewLabels, ["keep-unknown", "win", "loss", "ignore", "new-rule-needed"]);
  assert.deepEqual(json.review.draftableReviewLabels, ["win", "loss", "ignore"]);
  assert.equal(json.totals.exported, 2);
  assert.equal(json.totals.sourceUnknownReliableRounds, 2);
  assert.equal(json.totals.exportedByPriority.medium, 1);
  assert.equal(json.totals.exportedByPriority.low, 1);

  const labelSample = json.rows.find((row) => row.unknownAudit.nextAction === "label_sample");
  const ruleCandidate = json.rows.find((row) => row.unknownAudit.nextAction === "review_rule_candidate");
  assert.ok(labelSample);
  assert.ok(ruleCandidate);
  assert.equal(labelSample.unknownAudit.reviewPriority, "low");
  assert.equal(typeof labelSample.unknownAudit.reviewReason, "string");
  assert.equal(ruleCandidate.unknownAudit.reviewPriority, "medium");
  assert.deepEqual(labelSample.allowedReviewLabels, json.review.allowedReviewLabels);
  assert.equal(labelSample.suggestedReviewLabel, "");
  assert.equal(ruleCandidate.suggestedReviewLabel, "new-rule-needed");
  for (const row of json.rows) {
    assert.equal(row.reviewLabel, null);
    assert.equal(row.reviewNotes, null);
    assert.equal(row.message, null);
    assert.equal(row.ruleId, null);
    assert.equal(row.confidence, null);
    assert.equal(row.reviewedAt, null);
    assert.deepEqual(row.negativeExamples, []);
    assert.equal(typeof row.roundRef, "string");
  }

  const jsonlRows = (await readFile(jsonlPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(jsonlRows.length, 2);
  assert.deepEqual(jsonlRows[0].allowedReviewLabels, json.review.allowedReviewLabels);
  assert.ok(jsonlRows.every((row) => Object.hasOwn(row, "suggestedReviewLabel")));
  assert.ok(jsonlRows.every((row) => ["high", "medium", "low"].includes(row.unknownAudit.reviewPriority)));

  const csvText = await readFile(csvPath, "utf8");
  const headers = csvText.split(/\r?\n/, 1)[0].split(",");
  for (const field of [
    "reviewPriority",
    "reviewReason",
    "allowedReviewLabels",
    "suggestedReviewLabel",
    "message",
    "ruleId",
    "confidence",
    "reviewLabel",
    "reviewNotes",
    "reviewedAt",
  ]) {
    assert.ok(headers.includes(field), `${field} missing from CSV`);
  }
  assert.match(csvText, /keep-unknown\|win\|loss\|ignore\|new-rule-needed/);

  const priorityRun = await runUnknownAuditExport([
    "--report",
    reportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "unknown-audit-medium",
    "--priority",
    "medium",
  ]);
  assert.equal(priorityRun.status, 0, priorityRun.stderr);
  const priorityJson = JSON.parse(await readFile(path.join(tempDir, "unknown-audit-medium.json"), "utf8"));
  assert.equal(priorityJson.filters.priority[0], "medium");
  assert.equal(priorityJson.rows.length, 1);
  assert.equal(priorityJson.rows[0].unknownAudit.reviewPriority, "medium");

  const badPriorityRun = await runUnknownAuditExport([
    "--report",
    reportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "unknown-audit-bad-priority",
    "--priority",
    "urgent",
  ]);
  assert.equal(badPriorityRun.status, 2);
  const badPriority = JSON.parse(badPriorityRun.stderr);
  assert.equal(badPriority.error, "invalid_priority");

  const contextRun = await runUnknownAuditExport([
    "--report",
    reportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "unknown-audit-context",
    "--limit",
    "2",
    "--include-context",
    "--root",
    tempRoot,
    "--chat-lines-cache",
    path.join(tempDir, "chat-lines-cache.json"),
    "--before-ms",
    "0",
    "--after-ms",
    "60000",
    "--context-lines",
    "12",
    "--review-packet",
    "--label-template",
  ]);
  assert.equal(contextRun.status, 0, contextRun.stderr);
  const contextStdout = JSON.parse(contextRun.stdout);
  assert.ok(contextStdout.packetPath.endsWith("unknown-audit-context.review.md"));
  assert.ok(contextStdout.labelTemplatePath.endsWith("unknown-audit-context.labels.jsonl"));
  const contextJson = JSON.parse(await readFile(path.join(tempDir, "unknown-audit-context.json"), "utf8"));
  assert.equal(contextJson.context.included, true);
  assert.match(contextJson.context.privacy, /full-local/);
  const contextualRow = contextJson.rows.find((row) => row.contextLineCount > 0);
  assert.ok(contextualRow, "expected at least one contextual row");
  assert.equal(contextualRow.contextLineCount, contextualRow.contextLines.length);
  assert.ok(contextualRow.contextLines.some((line) => line.text.includes("You are now a ghost.")));
  assert.ok(contextualRow.contextLines.some((line) => line.matchedEvent?.type === "self_death"));
  assert.ok(contextualRow.contextLines.some((line) => line.matchedEvent?.type === "win" || line.matchedEvent?.type === "loss"));
  const packetText = await readFile(path.join(tempDir, "unknown-audit-context.review.md"), "utf8");
  assert.match(packetText, /^# Unknown Audit Review Packet/m);
  assert.match(packetText, /reviewLabel:/);
  assert.match(packetText, /Context lines:/);
  assert.match(packetText, /You are now a ghost\./);

  const labelTemplateRows = (await readFile(path.join(tempDir, "unknown-audit-context.labels.jsonl"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(labelTemplateRows.length, 2);
  assert.ok(labelTemplateRows.every((row) => row.reviewLabel === null));
  assert.ok(labelTemplateRows.every((row) => row.roundRef));
  assert.ok(labelTemplateRows.every((row) => row.auditCategory));
  assert.ok(labelTemplateRows.every((row) => row.context.included));
  assert.ok(labelTemplateRows.some((row) => row.context.importantMessages.some((line) => line.text.includes("You are now a ghost."))));

  const labelTemplateValidation = await runAuditLabels([
    "--input",
    path.join(tempDir, "unknown-audit-context.labels.jsonl"),
    "--report",
    reportPath,
  ]);
  assert.equal(labelTemplateValidation.status, 0, labelTemplateValidation.stderr);
  const labelTemplateSummary = JSON.parse(labelTemplateValidation.stdout);
  assert.equal(labelTemplateSummary.ok, true);
  assert.equal(labelTemplateSummary.totalRows, 2);
  assert.equal(labelTemplateSummary.labeledRows, 0);

  const labelTemplateStatus = await runAuditStatus([
    "--input",
    path.join(tempDir, "unknown-audit-context.labels.jsonl"),
    "--report",
    reportPath,
  ]);
  assert.equal(labelTemplateStatus.status, 0, labelTemplateStatus.stderr);
  const labelTemplateReadiness = JSON.parse(labelTemplateStatus.stdout);
  assert.equal(labelTemplateReadiness.status, "needs_labeling");
  assert.equal(labelTemplateReadiness.nextStep, "label_rows");
  assert.equal(labelTemplateReadiness.blocked, true);
  assert.equal(labelTemplateReadiness.blockingReason, "unlabeled_rows");
  assert.equal(labelTemplateReadiness.requiresHumanInput, true);
  assert.equal(labelTemplateReadiness.readyForWorkflow, false);
  assert.equal(labelTemplateReadiness.counts.unlabeledRows, 2);
  assert.equal(labelTemplateReadiness.writes.report, false);

  const missingRuleTextPath = path.join(tempDir, "missing-rule-text.labels.jsonl");
  await writeFile(missingRuleTextPath, `${JSON.stringify({
    ...labelTemplateRows[0],
    reviewLabel: "loss",
    message: null,
  })}\n`, "utf8");
  const missingRuleTextStatus = await runAuditStatus(["--input", missingRuleTextPath, "--report", reportPath]);
  assert.equal(missingRuleTextStatus.status, 0, missingRuleTextStatus.stderr);
  const missingRuleTextReadiness = JSON.parse(missingRuleTextStatus.stdout);
  assert.equal(missingRuleTextReadiness.status, "needs_rule_text");
  assert.equal(missingRuleTextReadiness.nextStep, "add_rule_text");
  assert.equal(missingRuleTextReadiness.blockingReason, "missing_rule_text");
  assert.equal(missingRuleTextReadiness.counts.missingRuleTextRows, 1);

  const readyWorkflowPath = path.join(tempDir, "ready-workflow.labels.jsonl");
  await writeFile(readyWorkflowPath, `${JSON.stringify({
    ...labelTemplateRows[0],
    reviewLabel: "loss",
    message: "DEFEAT!",
  })}\n`, "utf8");
  const readyWorkflowStatus = await runAuditStatus(["--input", readyWorkflowPath, "--report", reportPath]);
  assert.equal(readyWorkflowStatus.status, 0, readyWorkflowStatus.stderr);
  const readyWorkflowReadiness = JSON.parse(readyWorkflowStatus.stdout);
  assert.equal(readyWorkflowReadiness.status, "ready_for_workflow");
  assert.equal(readyWorkflowReadiness.nextStep, "run_audit_workflow");
  assert.equal(readyWorkflowReadiness.blocked, false);
  assert.equal(readyWorkflowReadiness.canDraftRules, true);
  assert.equal(readyWorkflowReadiness.canRunDryRun, true);
  assert.equal(readyWorkflowReadiness.readyForWorkflow, true);
  assert.equal(readyWorkflowReadiness.workflowRecommended, true);
  assert.equal(readyWorkflowReadiness.counts.draftableRuleRows, 1);

  const utf8ChineseLogPath = path.join(tempRoot, "logs", "2026-06-15-2.log");
  const readableChineseLine = "\u8d77\u5e8a\u6218\u4e89>> \u6e38\u620f\u5c06\u572810 \u79d2\u540e\u5f00\u59cb!";
  await writeFile(utf8ChineseLogPath, [
    `[10:05:00] [Client thread/INFO]: [CHAT] ${readableChineseLine}`,
    "[10:05:01] [Client thread/INFO]: [CHAT] \u8d77\u5e8a\u6218\u4e89>> Blue \u52a0\u5165\u4e86\u6e38\u620f!",
  ].join("\n") + "\n", "utf8");
  const chineseReportPath = path.join(tempDir, "report-cn.json");
  await writeFile(chineseReportPath, `${JSON.stringify(buildChineseFixtureReport(utf8ChineseLogPath), null, 2)}\n`, "utf8");

  const chineseContextRun = await runUnknownAuditExport([
    "--report",
    chineseReportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "unknown-audit-cn-context",
    "--limit",
    "1",
    "--include-context",
    "--root",
    tempRoot,
    "--chat-lines-cache",
    path.join(tempDir, "chat-lines-cache-cn-gb18030.json"),
    "--display-encoding",
    "utf-8",
    "--before-ms",
    "0",
    "--after-ms",
    "60000",
    "--context-lines",
    "12",
    "--review-packet",
  ]);
  assert.equal(chineseContextRun.status, 0, chineseContextRun.stderr);
  const chineseJsonText = await readFile(path.join(tempDir, "unknown-audit-cn-context.json"), "utf8");
  const chineseJson = JSON.parse(chineseJsonText);
  assert.doesNotMatch(chineseJsonText, new RegExp(escapeRegExp(utf8ChineseLogPath)));
  assert.doesNotMatch(await readFile(path.join(tempDir, "unknown-audit-cn-context.jsonl"), "utf8"), new RegExp(escapeRegExp(utf8ChineseLogPath)));
  const chineseRow = chineseJson.rows[0];
  const repairedLine = chineseRow.contextLines.find((line) => line.displayText?.includes("\u8d77\u5e8a\u6218\u4e89"));
  assert.ok(repairedLine, "expected UTF-8 display text for mojibake context line");
  assert.equal(repairedLine.displayText, readableChineseLine);
  assert.notEqual(repairedLine.text, repairedLine.displayText);
  const chinesePacketText = await readFile(path.join(tempDir, "unknown-audit-cn-context.review.md"), "utf8");
  assert.match(chinesePacketText, /\u8d77\u5e8a\u6218\u4e89>> \u6e38\u620f\u5c06\u572810 \u79d2\u540e\u5f00\u59cb!/);
  assert.match(chinesePacketText, /\(raw: /);

  const activityReportPath = path.join(tempDir, "activity-report.json");
  await writeFile(activityReportPath, `${JSON.stringify(buildActivityFixtureReport(logPath), null, 2)}\n`, "utf8");
  const activityRun = await runActivityReviewExport([
    "--report",
    activityReportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "activity-review",
    "--mode",
    "the_pit",
  ]);
  assert.equal(activityRun.status, 0, activityRun.stderr);
  const activityStdout = JSON.parse(activityRun.stdout);
  assert.equal(activityStdout.exported, 2);
  assert.match(activityStdout.privacy, /privacy-safe/);

  const activityJsonText = await readFile(path.join(tempDir, "activity-review.json"), "utf8");
  const activityJson = JSON.parse(activityJsonText);
  assert.equal(activityJson.schema.name, "minecraft-log-observatory-activity-review-export");
  assert.equal(activityJson.schema.version, 1);
  assert.equal(activityJson.source.reportOnly, true);
  assert.equal(activityJson.source.rawLogRead, false);
  assert.equal(activityJson.totals.sourceActivitySegments, 3);
  assert.equal(activityJson.totals.exported, 2);
  assert.equal(activityJson.totals.withRewards, 1);
  assert.equal(activityJson.totals.withDiagnostics, 1);
  assert.equal(activityJson.totals.withOwnerId, 1);
  assert.equal(activityJson.totals.maxPlayerKillStreak, 3);
  assert.equal(activityJson.totals.bountyClaims, 1);
  assert.equal(activityJson.totals.bountyGoldEarned, 100);
  assert.doesNotMatch(activityJsonText, new RegExp(escapeRegExp(logPath)));
  assert.doesNotMatch(activityJsonText, /STREAK! of 630 kills by OtherPlayer/);
  assert.ok(activityJson.rows.every((row) => !Object.hasOwn(row, "examples")));
  assert.ok(activityJson.rows.every((row) => typeof row.segmentRef === "string"));
  assert.ok(activityJson.rows.every((row) => row.reviewNotes === null));
  const rewardRow = activityJson.rows.find((row) => row.reviewFlags.hasReward);
  assert.ok(rewardRow);
  assert.equal(rewardRow.stats.rewardEvents, 2);
  assert.equal(rewardRow.stats.goldEarned, 125);
  assert.equal(rewardRow.stats.xpEarned, 10);
  assert.equal(rewardRow.stats.bountyClaims, 1);
  assert.equal(rewardRow.stats.bountyGoldEarned, 100);
  assert.equal(rewardRow.stats.observedBroadcastMaxKillStreak, 630);
  assert.equal(rewardRow.stats.playerMaxKillStreak, 3);

  const activityJsonlRows = (await readFile(path.join(tempDir, "activity-review.jsonl"), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(activityJsonlRows.length, 2);
  const activityCsvText = await readFile(path.join(tempDir, "activity-review.csv"), "utf8");
  for (const field of ["segmentRef", "playerMaxKillStreak", "observedBroadcastMaxKillStreak", "rewardEvents", "diagnosticRuleIds", "reviewNotes"]) {
    assert.ok(activityCsvText.split(/\r?\n/, 1)[0].split(",").includes(field), `${field} missing from activity CSV`);
  }
  assert.ok(activityCsvText.split(/\r?\n/, 1)[0].split(",").includes("bountyClaims"), "bountyClaims missing from activity CSV");
  assert.ok(activityCsvText.split(/\r?\n/, 1)[0].split(",").includes("bountyGoldEarned"), "bountyGoldEarned missing from activity CSV");

  const diagnosticActivityRun = await runActivityReviewExport([
    "--report",
    activityReportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "activity-review-diagnostic",
    "--mode",
    "the_pit",
    "--has-diagnostic",
    "--include-examples",
  ]);
  assert.equal(diagnosticActivityRun.status, 0, diagnosticActivityRun.stderr);
  const diagnosticActivityJsonText = await readFile(path.join(tempDir, "activity-review-diagnostic.json"), "utf8");
  const diagnosticActivityJson = JSON.parse(diagnosticActivityJsonText);
  assert.equal(diagnosticActivityJson.rows.length, 1);
  assert.match(diagnosticActivityJson.privacy, /full-local/);
  assert.equal(diagnosticActivityJson.rows[0].reviewFlags.hasDiagnostic, true);
  assert.ok(diagnosticActivityJson.rows[0].examples.some((example) => example.message.includes("BOUNTY!")));

  const ownerActivityRun = await runActivityReviewExport([
    "--report",
    activityReportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "activity-review-owner",
    "--has-owner-id",
  ]);
  assert.equal(ownerActivityRun.status, 0, ownerActivityRun.stderr);
  const ownerActivityJson = JSON.parse(await readFile(path.join(tempDir, "activity-review-owner.json"), "utf8"));
  assert.equal(ownerActivityJson.rows.length, 1);
  assert.equal(ownerActivityJson.rows[0].identity.serverPlayerId, "OwnerName");

  const badSortRun = await runActivityReviewExport([
    "--report",
    activityReportPath,
    "--out-dir",
    tempDir,
    "--prefix",
    "activity-review-bad-sort",
    "--sort",
    "chaos",
  ]);
  assert.equal(badSortRun.status, 2);
  const badSort = JSON.parse(badSortRun.stderr);
  assert.equal(badSort.error, "invalid_sort");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("audit export tests passed");

function buildFixtureReport(logPath) {
  return {
    generatedAt: "2026-06-15T00:00:00.000Z",
    rounds: {
      reliable: [
        {
          result: "unknown",
          gameMode: "bedwars",
          source: "Fixture",
          scope: "Scope",
          filePath: logPath,
          lineNo: 10,
          startMs: localTimeMs(10, 0, 0),
          endMs: localTimeMs(10, 0, 2),
          durationSeconds: 1,
          startReason: "round_countdown",
          endReason: "last_event",
          unknownAudit: {
            category: "bedwars_no_safe_result_evidence",
            nextAction: "label_sample",
            features: {
              mode: "bedwars",
              durationSeconds: 1,
              endReason: "last_event",
              ownerTeamKnown: false,
              selfAction: false,
              evidenceKinds: [],
            },
          },
        },
        {
          result: "unknown",
          gameMode: "skywars",
          source: "Fixture",
          scope: "Scope",
          filePath: logPath,
          lineNo: 20,
          startMs: localTimeMs(10, 0, 10),
          endMs: localTimeMs(10, 0, 12),
          durationSeconds: 2,
          startReason: "round_countdown",
          endReason: "last_event",
          resultHint: {
            value: "keep_unknown",
            confidence: "none",
            reason: "solo_mode_last_event_no_result",
          },
          unknownAudit: {
            category: "non_bedwars_remaining_unknown",
            nextAction: "review_rule_candidate",
            features: {
              mode: "skywars",
              durationSeconds: 2,
              endReason: "last_event",
              ownerTeamKnown: false,
              selfAction: false,
              evidenceKinds: [],
            },
          },
        },
        {
          result: "win",
          gameMode: "bedwars",
          source: "Fixture",
          scope: "Scope",
          filePath: "D:/logs/latest.log",
          lineNo: 30,
          startMs: 6000,
          endMs: 7000,
        },
      ],
    },
  };
}

function buildChineseFixtureReport(logPath) {
  return {
    generatedAt: "2026-06-15T00:00:00.000Z",
    rounds: {
      reliable: [
        {
          result: "unknown",
          gameMode: "bedwars",
          source: "Fixture",
          scope: "Scope",
          filePath: logPath,
          lineNo: 1,
          startMs: localTimeMs(10, 5, 0),
          endMs: localTimeMs(10, 5, 1),
          durationSeconds: 1,
          startReason: "round_countdown",
          endReason: "last_event",
          unknownAudit: {
            category: "bedwars_no_safe_result_evidence",
            nextAction: "label_sample",
            features: {
              mode: "bedwars",
              durationSeconds: 1,
              endReason: "last_event",
              ownerTeamKnown: false,
              selfAction: false,
              evidenceKinds: [],
            },
          },
        },
      ],
    },
  };
}

function buildActivityFixtureReport(logPath) {
  return {
    generatedAt: "2026-06-15T00:00:00.000Z",
    activity: {
      segments: [
        {
          key: "pit-owner",
          source: "Fixture",
          scope: "Scope",
          mode: "the_pit",
          label: "The Pit",
          localUser: "OwnerName",
          localUsers: { OwnerName: 4 },
          filePath: logPath,
          lineNo: 100,
          startMs: localTimeMs(11, 0, 0),
          startAt: "2026-06-15T03:00:00.000Z",
          endMs: localTimeMs(11, 5, 0),
          endAt: "2026-06-15T03:05:00.000Z",
          durationSeconds: 300,
          duration: "5m",
          confidence: "inferred",
          startReason: "game-state:pit_mode",
          endReason: "client_stop",
          modeSignals: 9,
          kills: 5,
          deaths: 1,
          selfKills: 3,
          selfDeaths: 1,
          maxStreak: 630,
          observedBroadcastMaxKillStreak: 630,
          playerMaxKillStreak: 3,
          rewardEvents: 2,
          goldEarned: 125,
          xpEarned: 10,
          bountyClaims: 1,
          bountyGoldEarned: 100,
          streakPoints: 1,
          megastreaks: 1,
          rules: {
            "game-state:pit_mode": 1,
            "game-state:pit_reward_summary": 2,
            "game-state:zh_pit_streak_broadcast": 1,
          },
          examples: [
            {
              lineNo: 101,
              timeText: "11:00:01",
              type: "game_mode",
              rule: "game-state:zh_pit_streak_broadcast",
              message: "STREAK! of 630 kills by OtherPlayer",
              payload: { gameMode: "the_pit", player: "OtherPlayer", streak: "630" },
            },
          ],
          serverLabel: "Hypixel",
          serverNetwork: "Hypixel",
          serverAddress: "mc.hypixel.net",
          serverConfidence: "direct",
          serverEvidence: { source: "server_connect", lineNo: 99, timestampMs: localTimeMs(10, 59, 59) },
          serverPlayerId: "OwnerName",
          serverPlayerIds: { OwnerName: 3 },
          serverPlayerIdSource: "direct_chat",
          serverPlayerIdConfidence: "high",
          serverIdentityContext: "activity_segment",
        },
        {
          key: "pit-diagnostic",
          source: "Fixture",
          scope: "Scope",
          mode: "the_pit",
          label: "The Pit",
          localUser: "OwnerName",
          localUsers: { OwnerName: 1 },
          filePath: logPath,
          lineNo: 200,
          startMs: localTimeMs(12, 0, 0),
          startAt: "2026-06-15T04:00:00.000Z",
          endMs: localTimeMs(12, 10, 0),
          endAt: "2026-06-15T04:10:00.000Z",
          durationSeconds: 600,
          duration: "10m",
          confidence: "inferred",
          startReason: "game-state:pit_mode",
          endReason: "server_connect",
          modeSignals: 3,
          kills: 0,
          deaths: 0,
          selfKills: 0,
          selfDeaths: 0,
          maxStreak: 0,
          observedBroadcastMaxKillStreak: 0,
          playerMaxKillStreak: 0,
          rewardEvents: 0,
          goldEarned: 0,
          xpEarned: 0,
          streakPoints: 0,
          megastreaks: 0,
          rules: {
            "game-state:pit_bounty_created": 2,
            "game-state:pit_prestige_broadcast": 1,
          },
          examples: [
            {
              lineNo: 201,
              timeText: "12:00:01",
              type: "activity_diagnostic",
              rule: "game-state:pit_bounty_created",
              message: "BOUNTY! OtherPlayer has a 500g bounty!",
              payload: { gameMode: "the_pit", player: "OtherPlayer" },
            },
          ],
          serverLabel: "Local proxy / Unknown server",
          serverNetwork: null,
          serverAddress: "127.0.0.1",
          serverConfidence: "direct",
          serverEvidence: { source: "server_connect", lineNo: 199, timestampMs: localTimeMs(11, 59, 59) },
          serverPlayerId: null,
          serverPlayerIds: {},
          serverPlayerIdSource: "none",
          serverPlayerIdConfidence: "none",
          serverIdentityContext: "activity_segment",
        },
        {
          key: "duels-activity",
          source: "Fixture",
          scope: "Scope",
          mode: "duels",
          label: "Duels",
          localUser: "OwnerName",
          localUsers: { OwnerName: 1 },
          filePath: logPath,
          lineNo: 300,
          startMs: localTimeMs(13, 0, 0),
          startAt: "2026-06-15T05:00:00.000Z",
          endMs: localTimeMs(13, 2, 0),
          endAt: "2026-06-15T05:02:00.000Z",
          durationSeconds: 120,
          duration: "2m",
          confidence: "inferred",
          startReason: "game-state:duels_mode",
          endReason: "client_stop",
          kills: 1,
          deaths: 1,
          selfKills: 1,
          selfDeaths: 1,
          playerMaxKillStreak: 1,
          rules: {},
          examples: [],
          serverLabel: "Unknown server",
          serverNetwork: null,
          serverAddress: null,
          serverConfidence: "unknown",
          serverEvidence: { source: "unknown" },
        },
      ],
      summary: {
        segments: 3,
      },
    },
    rounds: {
      reliable: [],
    },
  };
}

function localTimeMs(hour, minute, second) {
  return new Date(2026, 5, 15, hour, minute, second).getTime();
}

function runUnknownAuditExport(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/export-unknown-audit.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        status: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function runAuditLabels(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/audit-labels.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        status: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function runAuditStatus(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/audit-status.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        status: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function runActivityReviewExport(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/export-activity-review.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({
        status: error?.code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
