import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfig, resolveConfigPath, resolveStoreDir } from "../src/config/appConfig.mjs";

const args = process.argv.slice(2);
const configContext = await loadAppConfig(readOption("--config") ?? undefined);
const reportPath = resolveConfigPath(configContext, readOption("--report") ?? configContext.config.outputs.report);
const outDir = readOption("--out-dir")
  ? resolveConfigPath(configContext, readOption("--out-dir"))
  : resolveStoreDir(configContext);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const modesIndex = buildModesIndex(report);

maybeFailForRefreshTest();
await maybeDelayForRefreshTest();
await mkdir(outDir, { recursive: true });

await writeJson("manifest.json", {
  schema: {
    name: "minecraft-log-observatory-store",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  reportGeneratedAt: report.generatedAt,
  reportSchema: report.schema,
  sourceReport: reportPath,
  files: {
    overview: "overview.json",
    summary: "summary.json",
    profile: "profile.json",
    metricDefinitions: "metric-definitions.json",
    modes: "modes.json",
    accounts: "accounts.json",
    accountPlaytime: "account-playtime.jsonl",
    activity: "activity.json",
    activitySegments: "activity-segments.jsonl",
    results: "results.json",
    rules: "rules.json",
    confidence: "confidence.json",
    byDay: "by-day.jsonl",
    byWeek: "by-week.jsonl",
    byMonth: "by-month.jsonl",
    bySource: "by-source.jsonl",
    byScope: "by-scope.jsonl",
    sourcesIndex: "sources-index.json",
    scopesIndex: "scopes-index.json",
    accountsIndex: "accounts-index.json",
    modesIndex: "modes-index.json",
    reliableRounds: "rounds-reliable.jsonl",
    ignoredRounds: "rounds-ignored.jsonl",
  },
  counts: {
    reliableRounds: report.rounds.reliable.length,
    ignoredRounds: report.rounds.ignored.length,
    byDay: report.byDay.length,
    byWeek: report.byWeek.length,
    byMonth: report.byMonth.length,
    bySource: report.bySource.length,
    byScope: report.byScope.length,
    modes: modesIndex.length,
    roundModes: Object.keys(report.rounds.summary.gameModes ?? {}).length,
    activitySegments: report.activity?.segments?.length ?? 0,
    activityModes: Object.keys(report.activity?.summary?.gameModes ?? {}).length,
    accounts: report.accounts.localUsers.length,
    accountPlaytime: report.accounts.playtimeByUser?.length ?? 0,
  },
});

await writeJson("overview.json", report.overview);
await writeJson("summary.json", report.rounds.summary);
await writeJson("profile.json", report.profile);
await writeJson("metric-definitions.json", report.metricDefinitions ?? report.profile?.metricDefinitions ?? {});
await writeJson("modes.json", report.rounds.summary.gameModes ?? {});
await writeJson("accounts.json", report.accounts);
await writeJsonl("account-playtime.jsonl", report.accounts.playtimeByUser ?? []);
await writeJson("activity.json", report.activity ?? { summary: { segments: 0 }, segments: [] });
await writeJsonl("activity-segments.jsonl", report.activity?.segments ?? []);
await writeJson("results.json", report.results);
await writeJson("rules.json", report.rules);
await writeJson("confidence.json", report.confidence);
await writeJson("sources-index.json", buildSourcesIndex(report));
await writeJson("scopes-index.json", buildScopesIndex(report));
await writeJson("accounts-index.json", buildAccountsIndex(report));
await writeJson("modes-index.json", modesIndex);
await writeJsonl("by-day.jsonl", report.byDay);
await writeJsonl("by-week.jsonl", report.byWeek);
await writeJsonl("by-month.jsonl", report.byMonth);
await writeJsonl("by-source.jsonl", report.bySource);
await writeJsonl("by-scope.jsonl", report.byScope);
await writeJsonl("rounds-reliable.jsonl", report.rounds.reliable);
await writeJsonl("rounds-ignored.jsonl", report.rounds.ignored);

console.log(JSON.stringify({ outDir, reportPath, reliableRounds: report.rounds.reliable.length, ignoredRounds: report.rounds.ignored.length }, null, 2));

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function maybeFailForRefreshTest() {
  if (process.env.MLO_STORE_TEST_FAIL !== "1") return;
  console.error("MLO_STORE_TEST_FAIL requested; failing split-store export.");
  process.exit(42);
}

async function maybeDelayForRefreshTest() {
  const delayMs = Number(process.env.MLO_STORE_TEST_DELAY_MS ?? 0);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 30000)));
}

async function writeJson(fileName, data) {
  await writeFile(path.join(outDir, fileName), JSON.stringify(data, null, 2), "utf8");
}

async function writeJsonl(fileName, rows) {
  await writeFile(path.join(outDir, fileName), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function buildSourcesIndex(report) {
  return report.bySource.map((source) => ({
    id: source.source,
    source: source.source,
    scopes: source.scopes,
    files: source.files,
    playtimeSeconds: source.playtimeSeconds,
    playtime: source.playtime,
    reliableRounds: source.rounds.reliable,
    wins: source.rounds.wins,
    losses: source.rounds.losses,
    activitySegments: source.activity?.segments ?? 0,
    activityModes: Object.keys(source.activity?.gameModes ?? {}),
  }));
}

function buildScopesIndex(report) {
  return report.byScope.map((scope) => ({
    id: `${scope.source}\0${scope.scope}`,
    source: scope.source,
    scope: scope.scope,
    files: scope.files,
    playtimeSeconds: scope.playtimeSeconds,
    playtime: scope.playtime,
    reliableRounds: scope.rounds.reliable,
    wins: scope.rounds.wins,
    losses: scope.rounds.losses,
    gameModes: Object.keys(scope.rounds.gameModes ?? {}),
    activityModes: Object.keys(scope.activity?.gameModes ?? {}),
  }));
}

function buildAccountsIndex(report) {
  return [
    {
      id: "owner",
      user: "owner",
      displayName: report.accounts.owner.displayName,
      localUserCount: report.accounts.owner.localUserCount,
      events: report.accounts.owner.observedEvents,
      reliableRounds: report.accounts.owner.rounds.reliable,
      wins: report.accounts.owner.rounds.wins,
      losses: report.accounts.owner.rounds.losses,
    },
    ...report.accounts.localUsers.map((account) => ({
      id: account.user,
      user: account.user,
      events: account.events,
      files: account.files,
      scopes: account.scopes,
      reliableRounds: account.rounds.reliable,
      wins: account.rounds.wins,
      losses: account.rounds.losses,
    })),
  ];
}

function buildModesIndex(report) {
  const roundModes = Object.values(report.rounds.summary.gameModes ?? {}).map((mode) => ({
    id: `round:${mode.id}`,
    modeId: mode.id,
    label: mode.label,
    kind: "round",
    rounds: mode.rounds,
    resultEligible: mode.resultEligible,
    nonResult: mode.nonResult,
    durationSeconds: mode.durationSeconds,
    duration: mode.duration,
    wins: mode.wins,
    losses: mode.losses,
    unknownResults: mode.unknownResults,
    notApplicableResults: mode.notApplicableResults,
    bedDestroys: mode.bedDestroys ?? 0,
    selfBedDestroys: mode.selfBedDestroys ?? 0,
    playerBedDestroys: mode.playerBedDestroys ?? mode.selfBedDestroys ?? 0,
    playerMaxKillStreak: mode.playerMaxKillStreak ?? 0,
    winRate: mode.winRate,
  }));
  const activityModes = Object.values(report.activity?.summary?.gameModes ?? {}).map((mode) => ({
    id: `activity:${mode.id}`,
    modeId: mode.id,
    label: mode.label,
    kind: "activity",
    segments: mode.segments,
    durationSeconds: mode.durationSeconds,
    duration: mode.duration,
    kills: mode.kills,
    deaths: mode.deaths,
    selfKills: mode.selfKills,
    selfDeaths: mode.selfDeaths,
    maxStreak: mode.maxStreak,
    observedBroadcastMaxKillStreak: mode.observedBroadcastMaxKillStreak ?? mode.maxStreak ?? 0,
    playerMaxKillStreak: mode.playerMaxKillStreak ?? 0,
    streakPoints: mode.streakPoints,
    rewardEvents: mode.rewardEvents ?? 0,
    goldEarned: mode.goldEarned ?? 0,
    xpEarned: mode.xpEarned ?? 0,
    bountyClaims: mode.bountyClaims ?? 0,
    bountyGoldEarned: mode.bountyGoldEarned ?? 0,
    megastreaks: mode.megastreaks,
  }));
  return [...roundModes, ...activityModes].sort((a, b) => b.durationSeconds - a.durationSeconds || a.id.localeCompare(b.id));
}
