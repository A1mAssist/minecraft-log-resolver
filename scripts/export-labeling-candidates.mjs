import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const unmatchedPath = readOption("--unmatched") ?? "unmatched-debug.json";
const resultPath = readOption("--result-candidates") ?? "result-candidates.json";
const outDir = readOption("--out-dir") ?? "labeling";
const limit = Number(readOption("--limit") ?? 120);

const unmatched = JSON.parse(await readFile(unmatchedPath, "utf8"));
const resultCandidates = JSON.parse(await readFile(resultPath, "utf8"));
const rows = [];

for (const template of unmatched.templates ?? []) {
  const text = searchableText(template);
  if (!isUsefulForLabeling(text, template.category)) continue;
  rows.push({
    id: `unmatched:${rows.length + 1}`,
    sourceType: "unmatched",
    source: template.source,
    scope: template.scope,
    category: template.category,
    count: template.count,
    template: template.template,
    examples: template.examples ?? [],
    suggestedTypes: template.ruleDraft?.suggestedTypes ?? [],
    matchedType: null,
    matchedRule: null,
    label: "",
    notes: "",
  });
}

for (const candidate of resultCandidates.candidates ?? []) {
  const text = searchableText(candidate);
  if (!isUsefulForLabeling(text, candidate.category)) continue;
  rows.push({
    id: `result:${rows.length + 1}`,
    sourceType: "result-candidate",
    source: candidate.source,
    scope: candidate.scope,
    category: candidate.category,
    gameMode: candidate.gameMode,
    count: candidate.count,
    template: candidate.template,
    examples: candidate.examples ?? [],
    suggestedTypes: [candidate.matchedType].filter(Boolean),
    matchedType: candidate.matchedType,
    matchedRule: candidate.matchedRule,
    label: "",
    notes: "",
  });
}

const sortedRows = rows
  .sort((a, b) => score(b) - score(a) || b.count - a.count)
  .slice(0, limit);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "candidates.json"), JSON.stringify(sortedRows, null, 2), "utf8");
await writeFile(path.join(outDir, "candidates.jsonl"), `${sortedRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(path.join(outDir, "candidates.csv"), toCsv(sortedRows), "utf8");
await writeFile(path.join(outDir, "README.md"), readme(), "utf8");

console.log(JSON.stringify({ outDir, rows: sortedRows.length, top: sortedRows.slice(0, 10).map(({ id, category, count, template }) => ({ id, category, count, template })) }, null, 2));

function isUsefulForLabeling(text, category) {
  const needles = [
    "victory",
    "defeat",
    "winner",
    "winning",
    "you won",
    "you lost",
    "you lose",
    "game over",
    "joined (",
    "has joined",
    "the game starts",
    "胜利",
    "失败",
    "获胜",
    "输了",
    "赢了",
    "战败",
    "游戏将在",
    "加入了游戏",
    "队伍",
    "红",
    "蓝",
    "绿",
    "黄",
  ];
  return ["possible_round_state", "possible_presence", "possible_bedwars_objective", "possible_combat", "explicit_win", "explicit_loss", "winner_announcement"].includes(category)
    || needles.some((needle) => text.includes(needle));
}

function searchableText(row) {
  return [row.template, ...(row.examples ?? [])].join(" ").toLowerCase();
}

function score(row) {
  const weights = {
    explicit_loss: 120,
    explicit_win: 110,
    winner_announcement: 100,
    possible_round_state: 90,
    possible_bedwars_objective: 80,
    possible_combat: 70,
    possible_presence: 45,
  };
  return (weights[row.category] ?? 10) + Math.min(30, Math.log10(Math.max(1, row.count)) * 10);
}

function toCsv(rows) {
  const headers = ["id", "sourceType", "source", "scope", "category", "gameMode", "count", "matchedType", "matchedRule", "template", "example1", "example2", "label", "notes"];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => csvCell(header.startsWith("example") ? row.examples?.[Number(header.slice(-1)) - 1] ?? "" : row[header] ?? ""))
        .join(","),
    ),
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readme() {
  return `# Log Labeling Candidates

这些文件用于手动标记规则候选。

建议填写 \`label\`：

- \`ignore\`: 噪音，不进规则。
- \`round_countdown\`: 对局倒计时。
- \`round_start\`: 对局开始。
- \`player_join\`: 玩家加入当前游戏。
- \`player_leave\`: 玩家离开当前游戏。
- \`win_self\`: 明确表示你赢了。
- \`loss_self\`: 明确表示你输了。
- \`winner_ambiguous\`: 只知道某人/某队赢，不能确认是不是你。
- \`team_assignment\`: 表示你所在队伍。
- \`combat_context\`: 战斗上下文，但不应计入你的击杀。

可以直接编辑 \`candidates.csv\` 或 \`candidates.json\`。优先标记 count 高、看起来像胜负/倒计时/玩家加入的行。
`;
}
