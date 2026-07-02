import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const rootDir = process.cwd();
const outDir = path.resolve(readOption("--out") ?? path.join("dist", "local-desktop"));
const exeName = readOption("--name") ?? "MinecraftLogResolver.exe";
const exePath = path.join(outDir, exeName);
const blobPath = path.resolve(readOption("--blob") ?? path.join(".cache", "sea", "minecraft-log-resolver.blob"));
const configPath = path.resolve(readOption("--config-out") ?? path.join(".cache", "sea", "sea-config.json"));
const launcherPath = path.resolve(readOption("--launcher") ?? path.join("scripts", "launcher-windows.cjs"));
const skipBundle = hasFlag("--skip-bundle");
const postjectVersion = "1.0.0-alpha.6";
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

if (!skipBundle) {
  await run(process.execPath, ["scripts/build-local-desktop.mjs", "--out", outDir, "--embed-node", "current"]);
}

await mkdir(path.dirname(blobPath), { recursive: true });
await mkdir(outDir, { recursive: true });
await writeFile(configPath, `${JSON.stringify({
  main: launcherPath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
}, null, 2)}\n`, "utf8");

await run(process.execPath, ["--experimental-sea-config", configPath]);
await copyFile(process.execPath, exePath);
await injectSeaBlob(exePath, blobPath);
await updateManifest(exeName);

console.log(JSON.stringify({
  ok: true,
  outDir: relativePath(rootDir, outDir),
  exe: relativePath(rootDir, exePath),
  blob: relativePath(rootDir, blobPath),
}, null, 2));

async function injectSeaBlob(targetExe, blob) {
  const localPostject = path.resolve("node_modules", "postject", "dist", "cli.js");
  try {
    await run(process.execPath, [
      localPostject,
      targetExe,
      "NODE_SEA_BLOB",
      blob,
      "--sentinel-fuse",
      sentinelFuse,
      "--overwrite",
    ]);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  await run(npx, [
    "--yes",
    `postject@${postjectVersion}`,
    targetExe,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    sentinelFuse,
    "--overwrite",
  ]);
}

async function updateManifest(fileName) {
  const manifestPath = path.join(outDir, "bundle-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const normalized = fileName.replaceAll("\\", "/");
  if (!manifest.files.includes(normalized)) manifest.files.push(normalized);
  manifest.launcher = {
    type: "windows-sea-exe",
    path: normalized,
    entry: "scripts/launcher-windows.cjs",
    starts: ["scripts/api.mjs", "scripts/serve.mjs"],
    opens: "http://127.0.0.1:5173/",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, commandArgs, {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
    child.on("error", reject);
  });
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(name) {
  return args.includes(name);
}

function relativePath(root, target) {
  const relative = path.relative(root, target);
  return relative.split(path.sep).join("/");
}
