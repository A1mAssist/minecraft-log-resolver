import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "mlo-release-check-"));
try {
  const configPath = path.join(tempDir, "observatory.config.json");
  const reportPath = path.join(tempDir, "report.json");
  const summaryPath = path.join(tempDir, "summary.json");
  const dataDir = path.join(tempDir, "data");
  const storeDir = path.join(dataDir, "report-store");
  const performancePath = path.join(tempDir, "performance.json");
  const labelPath = path.join(tempDir, "labels.jsonl");
  const report = buildReport();
  const roundRef = hashRoundRef(report.rounds.reliable[0]);

  await mkdir(storeDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    roots: [],
    outputs: {
      report: reportPath,
      summary: summaryPath,
    },
    app: {
      dataDir,
    },
  }, null, 2), "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, `${JSON.stringify({ generatedAt: report.generatedAt, schema: { name: "minecraft-log-observatory-summary", version: 1 } }, null, 2)}\n`, "utf8");
  await writeFile(path.join(storeDir, "manifest.json"), `${JSON.stringify(buildStoreManifest(report), null, 2)}\n`, "utf8");
  await writeFile(performancePath, `${JSON.stringify(buildPerformance(), null, 2)}\n`, "utf8");
  await writeFile(labelPath, `${JSON.stringify(buildLabelRow(roundRef))}\n`, "utf8");

  const pass = await runReleaseCheck([
    "--config",
    configPath,
    "--performance",
    performancePath,
    "--label-template",
    labelPath,
  ]);
  assert.equal(pass.status, 0, pass.stderr);
  const passJson = JSON.parse(pass.stdout);
  assert.equal(passJson.ok, true);
  assert.equal(passJson.privacy, "privacy-safe");
  assert.equal(passJson.gates.ambiguousResultsZero, true);
  assert.equal(passJson.gates.thePitNonResult, true);
  assert.equal(passJson.gates.storeMatchesReport, true);
  assert.equal(passJson.gates.jsonlStoreOk, true);
  assert.equal(passJson.gates.labelTemplateValid, true);
  assert.equal(passJson.summary.labelRows, 1);
  assert.doesNotMatch(pass.stdout, new RegExp(escapeRegExp(tempDir)));

  const full = await runReleaseCheck([
    "--config",
    configPath,
    "--performance",
    performancePath,
    "--label-template",
    labelPath,
    "--full",
  ]);
  assert.equal(full.status, 0, full.stderr);
  const fullJson = JSON.parse(full.stdout);
  assert.equal(fullJson.privacy, "full-local");
  assert.equal(fullJson.inputs.reportPath, reportPath);
  assert.equal(fullJson.inputs.reportPath.startsWith(tempDir), true);

  const staleLabelPath = path.join(tempDir, "labels-stale.jsonl");
  await writeFile(staleLabelPath, `${JSON.stringify(buildLabelRow("stale-round-ref"))}\n`, "utf8");
  const stale = await runReleaseCheck([
    "--config",
    configPath,
    "--performance",
    performancePath,
    "--label-template",
    staleLabelPath,
  ]);
  assert.equal(stale.status, 1);
  const staleJson = JSON.parse(stale.stdout);
  assert.equal(staleJson.ok, false);
  assert.ok(staleJson.failures.some((failure) => failure.code === "label_template_stale_round_refs"));

  const badReportPath = path.join(tempDir, "report-bad.json");
  const badReport = buildReport({
    ambiguousResults: 1,
    pit: {
      rounds: 1,
      resultEligible: 1,
      notApplicableResults: 0,
      unknownResults: 1,
    },
  });
  await writeFile(badReportPath, `${JSON.stringify(badReport, null, 2)}\n`, "utf8");
  const bad = await runReleaseCheck([
    "--config",
    configPath,
    "--report",
    badReportPath,
    "--performance",
    performancePath,
    "--label-template",
    labelPath,
  ]);
  assert.equal(bad.status, 1);
  const badJson = JSON.parse(bad.stdout);
  assert.ok(badJson.failures.some((failure) => failure.code === "ambiguous_results_nonzero"));
  assert.ok(badJson.failures.some((failure) => failure.code === "the_pit_result_eligible"));

  const badPerformancePath = path.join(tempDir, "performance-bad.json");
  await writeFile(badPerformancePath, `${JSON.stringify(buildPerformance({ recommendations: [{ code: "review_split_store_limits" }] }), null, 2)}\n`, "utf8");
  const badPerformance = await runReleaseCheck([
    "--config",
    configPath,
    "--performance",
    badPerformancePath,
    "--label-template",
    labelPath,
  ]);
  assert.equal(badPerformance.status, 1);
  const badPerformanceJson = JSON.parse(badPerformance.stdout);
  assert.ok(badPerformanceJson.failures.some((failure) => failure.code === "jsonl_store_not_ok"));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("release check tests passed");

function buildReport(options = {}) {
  const pit = options.pit ?? {
    rounds: 1,
    resultEligible: 0,
    notApplicableResults: 1,
    unknownResults: 0,
  };
  const unknownRound = {
    source: "Fixture",
    scope: "(root)",
    filePath: "D:/fixture/.minecraft/logs/latest.log",
    lineNo: 10,
    startMs: 1000,
    endMs: 2000,
    startAt: "2026-06-15T00:00:01.000Z",
    endAt: "2026-06-15T00:00:02.000Z",
    result: "unknown",
    gameMode: "bedwars",
  };
  return {
    generatedAt: "2026-06-15T00:00:00.000Z",
    results: {
      summary: {
        reliableRounds: 2,
        resultEligibleRounds: 1,
        unknownRoundResults: 1,
        ambiguousResults: options.ambiguousResults ?? 0,
      },
    },
    rounds: {
      reliable: [unknownRound],
      summary: {
        gameModes: {
          bedwars: {
            rounds: 1,
            unknownResults: 1,
          },
          the_pit: pit,
        },
      },
    },
  };
}

function buildStoreManifest(report) {
  return {
    schema: {
      name: "minecraft-log-observatory-store",
      version: 1,
    },
    generatedAt: "2026-06-15T00:01:00.000Z",
    reportGeneratedAt: report.generatedAt,
    files: {
      reliableRounds: "rounds-reliable.jsonl",
      activitySegments: "activity-segments.jsonl",
      profile: "profile.json",
    },
    counts: {
      reliableRounds: report.results.summary.reliableRounds,
    },
  };
}

function buildPerformance(options = {}) {
  return {
    generatedAt: "2026-06-15T00:02:00.000Z",
    needsRefresh: options.needsRefresh ?? false,
    refreshReasons: [],
    recommendations: options.recommendations ?? [{ code: "jsonl_store_ok" }],
  };
}

function buildLabelRow(roundRef) {
  return {
    id: "unknown-audit:0001",
    roundRef,
    gameMode: "bedwars",
    auditCategory: "bedwars_self_death_boundary_review",
    unknownNextAction: "review_owner_identity",
    reviewPriority: "high",
    allowedReviewLabels: ["keep-unknown", "win", "loss", "ignore", "new-rule-needed"],
    reviewLabel: null,
    reviewNotes: null,
  };
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

function runReleaseCheck(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/release-check.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
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
