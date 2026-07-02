import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const outDir = path.resolve(readOption("--out") ?? path.join("dist", "local-desktop"));
const rootDir = process.cwd();
const dryRun = hasFlag("--dry-run");
const embedNodeOption = readOption("--embed-node");
const embeddedNodeSource = resolveEmbeddedNodeSource(embedNodeOption);
const embeddedNodeRelativePath = path.join("runtime", "node", "node.exe");

const includedFiles = [
  "README.md",
  "HANDOFF.md",
  "package.json",
  "start.bat",
  "stop.bat",
  "index.html",
  "minecraft-log-resolver.config.json",
  "minecraft-log-resolver.local.example.json",
];
const optionalFiles = [
  "package-lock.json",
];
const includedDirs = [
  "docs",
  "scripts",
  "src",
  "custom-rules",
];
const excludedDirs = new Set([
  ".cache",
  "artifacts",
  "data",
  "dist",
  "exports",
  "labeling",
  "node_modules",
  ".git",
]);

const manifest = {
  schema: {
    name: "minecraft-log-resolver-local-desktop-bundle",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  sourceRoot: "project-root",
  outDir: relativePath(rootDir, outDir),
  files: [],
  dirs: [],
  optionalFiles: [],
  missingOptionalFiles: [],
  runtime: {
    embeddedNode: Boolean(embeddedNodeSource),
    nodePath: embeddedNodeSource ? embeddedNodeRelativePath.replaceAll("\\", "/") : null,
    source: embeddedNodeSource ? (embedNodeOption === "current" ? "current_process" : "provided_path") : null,
  },
  excluded: [...excludedDirs].sort(),
  notes: [
    embeddedNodeSource
      ? "This bundle includes a copied Node.js runtime at runtime/node/node.exe."
      : "This bundle expects Node.js 20+ on the local machine. Rebuild with --embed-node current or --embed-node <path-to-node.exe> to include a runtime.",
    "It intentionally excludes raw Minecraft logs and derived local data such as reports, cache, store, exports, and labeling work queues.",
  ],
};

if (!dryRun) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

for (const file of includedFiles) {
  await includeFile(file);
}
for (const file of optionalFiles) {
  await includeOptionalFile(file);
}
for (const dir of includedDirs) {
  await includeDir(dir);
}
if (embeddedNodeSource) {
  await includeEmbeddedNode(embeddedNodeSource);
}

if (!dryRun) {
  await writeFile(path.join(outDir, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeLaunchers();
}

const result = {
  ok: true,
  generatedAt: manifest.generatedAt,
  dryRun,
  outDir: manifest.outDir,
  files: manifest.files.length,
  dirs: manifest.dirs.length,
  embeddedNode: manifest.runtime.embeddedNode,
  excluded: manifest.excluded,
};

console.log(JSON.stringify(result, null, 2));

async function includeFile(relativeFile) {
  const sourcePath = path.resolve(rootDir, relativeFile);
  const targetPath = path.join(outDir, relativeFile);
  if (!dryRun) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
  manifest.files.push(relativeFile.replaceAll("\\", "/"));
}

async function includeOptionalFile(relativeFile) {
  try {
    await includeFile(relativeFile);
    manifest.optionalFiles.push(relativeFile.replaceAll("\\", "/"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    manifest.missingOptionalFiles.push(relativeFile.replaceAll("\\", "/"));
  }
}

async function includeDir(relativeDir) {
  const sourceDir = path.resolve(rootDir, relativeDir);
  const targetDir = path.join(outDir, relativeDir);
  if (!dryRun) {
    await cp(sourceDir, targetDir, {
      recursive: true,
      filter: (src) => {
        const relative = path.relative(rootDir, src);
        if (!relative) return true;
        const top = relative.split(path.sep)[0];
        return !excludedDirs.has(top) || relative === relativeDir;
      },
    });
  }
  manifest.dirs.push(relativeDir.replaceAll("\\", "/"));
}

async function includeEmbeddedNode(sourcePath) {
  const targetPath = path.join(outDir, embeddedNodeRelativePath);
  if (!dryRun) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
  manifest.files.push(embeddedNodeRelativePath.replaceAll("\\", "/"));
}

async function writeLaunchers() {
  const start = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "set \"NODE_EXE=node\"",
    "if exist \"%~dp0runtime\\node\\node.exe\" set \"NODE_EXE=%~dp0runtime\\node\\node.exe\"",
    "if not exist \"%~dp0runtime\\node\\node.exe\" where node >nul 2>nul",
    "if errorlevel 1 if not exist \"%~dp0runtime\\node\\node.exe\" (",
    "  echo Node.js was not found in PATH.",
    "  echo Install Node.js 20+ or rebuild this bundle with --embed-node current.",
    "  pause",
    "  exit /b 1",
    ")",
    "echo Starting Minecraft Log Resolver...",
    "start \"MLO API\" /min \"%NODE_EXE%\" scripts/api.mjs --port 8787",
    "timeout /t 1 /nobreak >nul",
    "start \"MLO Frontend\" /min \"%NODE_EXE%\" scripts/serve.mjs",
    "timeout /t 2 /nobreak >nul",
    "start \"\" \"http://127.0.0.1:5173/\"",
    "echo.",
    "echo Frontend: http://127.0.0.1:5173/",
    "echo API:      http://127.0.0.1:8787/api/health",
    "echo.",
    "echo Use stop.bat to stop the local services.",
    "",
  ].join("\r\n");
  const stop = [
    "@echo off",
    "setlocal",
    "echo Stopping Minecraft Log Resolver services...",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*scripts/api.mjs*' -or $_.CommandLine -like '*scripts/serve.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped PID ' + $_.ProcessId) }\"",
    "echo Done.",
    "",
  ].join("\r\n");
  await writeFile(path.join(outDir, "start.bat"), start, "utf8");
  await writeFile(path.join(outDir, "stop.bat"), stop, "utf8");
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}

function resolveEmbeddedNodeSource(value) {
  if (!value) return null;
  if (value === "current") return process.execPath;
  return path.resolve(value);
}

function relativePath(root, target) {
  const relative = path.relative(root, target);
  return relative.split(path.sep).join("/");
}
