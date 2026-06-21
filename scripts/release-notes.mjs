import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const outPath = readOption("--out");
const full = hasFlag("--full");

const statusText = await git(["status", "--porcelain=v1", "-uall"]);
const statusEntries = parseStatus(statusText).filter((entry) => full || !isIgnoredReleaseNoise(entry.path));
const groups = groupEntries(statusEntries);
const generatedAt = new Date().toISOString();

const lines = [
  "# Backend Release Boundary Draft",
  "",
  `Generated: ${generatedAt}`,
  "",
  "This is a working-tree inventory for review and handoff. It does not prove release readiness by itself; use the verification commands below before handing off or committing.",
  "",
  "## Suggested Review Slices",
  "",
  "- Parser, rules, and accuracy changes",
  "- Report, store, API, and OpenAPI contract changes",
  "- Productization, refresh/config/diagnostics/performance changes",
  "- Audit workflow, rule lifecycle, and release-gate tooling",
  "- Frontend/static app changes",
  "- Documentation and handoff updates",
  "",
  "## Current Working Tree",
  "",
  `Total paths: ${statusEntries.length}`,
  "",
];

for (const group of groups) {
  lines.push(`### ${group.label}`);
  lines.push("");
  if (group.entries.length === 0) {
    lines.push("- No paths currently detected.");
  } else {
    for (const entry of group.entries) {
      lines.push(`- \`${entry.status}\` \`${entry.path}\``);
    }
  }
  lines.push("");
}

lines.push(
  "## Verification Commands",
  "",
  "```bat",
  "npm.cmd run release:check",
  "npm.cmd run test:api",
  "npm.cmd run test:api-server",
  "npm.cmd run test:doctor",
  "npm.cmd run test:store",
  "npm.cmd run test:openapi",
  "npm.cmd test",
  "```",
  "",
  "## Guardrails",
  "",
  "- Do not include raw Minecraft logs, local config, raw chat context packets, full reports, split store rows, or local cache internals in a shareable release.",
  "- Keep The Pit as non-result activity: `resultEligible === 0`, `notApplicableResults === rounds`, `unknownResults === 0`.",
  "- Keep official result inference conservative; candidate rules need label validation and dry-run before enable/refresh.",
  "- Keep privacy-safe outputs as the default. Use full-local modes only for trusted local debugging.",
  "",
);

const markdown = `${lines.join("\n")}\n`;
if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");
  console.log(JSON.stringify({ ok: true, out: outPath, paths: statusEntries.length }, null, 2));
} else {
  console.log(markdown);
}

function parseStatus(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "??";
      const rawPath = line.slice(3).trim();
      const renamed = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
      return { status, path: renamed.replaceAll("\\", "/") };
    });
}

function groupEntries(entries) {
  const definitions = [
    ["Parser / Rules", (file) => file.startsWith("src/parser/") || file.startsWith("scripts/test-chat-rules") || file.includes("rules")],
    ["Report / Store / API", (file) => file.startsWith("src/report/") || file.startsWith("src/api/") || file.startsWith("scripts/export-store") || file.startsWith("scripts/test-store") || file.startsWith("scripts/test-api") || file.startsWith("docs/api") || file.startsWith("docs/openapi") || file.startsWith("docs/store") || file.startsWith("docs/report-schema")],
    ["Audit / Release Tooling", (file) => file.includes("audit") || file.includes("release") || file.includes("performance") || file.startsWith("src/diagnostics/") || file.startsWith("scripts/doctor")],
    ["Frontend / Static App", (file) => file === "index.html" || file.startsWith("src/app/") || file.startsWith("scripts/test-frontend")],
    ["Configuration / Launch", (file) => file.includes("config") || file.endsWith(".bat") || file === "package.json" || file === "package-lock.json" || file === ".gitignore"],
    ["Documentation", (file) => file.startsWith("docs/") || file === "README.md" || file === "HANDOFF.md" || file.startsWith("custom-rules/README")],
  ];
  const remaining = [...entries];
  const groups = definitions.map(([label, predicate]) => {
    const picked = [];
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (predicate(remaining[index].path)) picked.unshift(...remaining.splice(index, 1));
    }
    return { label, entries: picked.sort(compareEntries) };
  });
  groups.push({ label: "Other", entries: remaining.sort(compareEntries) });
  return groups;
}

function isIgnoredReleaseNoise(file) {
  return file.startsWith("node_modules/")
    || file.startsWith("data/")
    || file.startsWith("artifacts/")
    || file.startsWith("exports/")
    || file.startsWith("labeling/")
    || file.startsWith(".cache/");
}

function compareEntries(left, right) {
  return left.path.localeCompare(right.path);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function git(gitArgs) {
  return new Promise((resolve, reject) => {
    execFile("git", gitArgs, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr}`;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
