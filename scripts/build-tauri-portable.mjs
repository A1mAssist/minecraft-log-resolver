import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const rootDir = process.cwd();
const outDir = path.resolve(readOption("--out") ?? path.join("dist", "tauri-desktop"));
const exeSource = path.resolve(readOption("--exe") ?? path.join("src-tauri", "target", "release", "app.exe"));
const exeName = readOption("--name") ?? "MinecraftLogResolver.exe";

const includedFiles = [
  "README.md",
  "HANDOFF.md",
  "package.json",
  "index.html",
  "minecraft-log-resolver.config.json",
  "minecraft-log-resolver.local.example.json",
];
const optionalFiles = ["package-lock.json"];
const includedDirs = ["docs", "scripts", "src", "custom-rules", path.join("dist", "tauri-frontend")];
const excludedDirs = new Set([
  ".cache",
  ".git",
  "artifacts",
  "data",
  "dist",
  "exports",
  "labeling",
  "node_modules",
  "src-tauri",
]);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const manifest = {
  schema: {
    name: "minecraft-log-resolver-tauri-portable-bundle",
    version: 1,
  },
  generatedAt: new Date().toISOString(),
  outDir: relativePath(rootDir, outDir),
  files: [],
  dirs: [],
  optionalFiles: [],
  missingOptionalFiles: [],
  launcher: {
    type: "tauri-v2-exe",
    path: exeName,
    transport: "tauri-ipc",
    backend: "rust",
    tcpListeners: false,
  },
  runtime: {
    embeddedNode: false,
    nodePath: null,
  },
  excluded: [...excludedDirs].sort(),
  notes: [
    "This Tauri bundle uses IPC instead of localhost HTTP ports.",
    "The desktop runtime handles read-only dashboard API requests in Rust and does not start node.exe.",
    "It intentionally excludes raw Minecraft logs and derived local data such as reports, cache, store, exports, and labeling work queues.",
  ],
};

await includeBuiltExe();
for (const file of includedFiles) await includeFile(file);
for (const file of optionalFiles) await includeOptionalFile(file);
for (const dir of includedDirs) await includeDir(dir);

await writeFile(path.join(outDir, "tauri-bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  outDir: manifest.outDir,
  exe: exeName,
  embeddedNode: false,
  files: manifest.files.length,
  dirs: manifest.dirs.length,
  excluded: manifest.excluded,
}, null, 2));

async function includeBuiltExe() {
  const target = path.join(outDir, exeName);
  await copyFile(exeSource, target);
  manifest.files.push(exeName);
}

async function includeFile(relativeFile) {
  const sourcePath = path.resolve(rootDir, relativeFile);
  const targetPath = path.join(outDir, relativeFile);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
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
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => {
      const relative = path.relative(rootDir, src);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      return !excludedDirs.has(top) || relative === relativeDir;
    },
  });
  manifest.dirs.push(relativeDir.replaceAll("\\", "/"));
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function relativePath(root, target) {
  const relative = path.relative(root, target);
  return relative.split(path.sep).join("/");
}
