import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "mlo-local-desktop-"));
try {
  const outDir = path.join(tempDir, "bundle");
  const result = JSON.parse(await runBuild(["--out", outDir]));
  assert.equal(result.ok, true);
  assert.equal(result.outDir.endsWith("bundle"), true);
  assert.equal(result.embeddedNode, false);
  assert.ok(result.excluded.includes("data"));
  assert.ok(result.excluded.includes("labeling"));
  assert.ok(result.excluded.includes("node_modules"));

  const manifest = JSON.parse(await readFile(path.join(outDir, "bundle-manifest.json"), "utf8"));
  assert.equal(manifest.schema.name, "minecraft-log-observatory-local-desktop-bundle");
  assert.ok(manifest.files.includes("README.md"));
  assert.ok(manifest.files.includes("start.bat"));
  assert.ok(manifest.dirs.includes("scripts"));
  assert.ok(manifest.dirs.includes("src"));
  assert.ok(manifest.dirs.includes("custom-rules"));
  assert.ok(manifest.excluded.includes("artifacts"));
  assert.ok(manifest.notes.some((note) => /excludes raw Minecraft logs/i.test(note)));

  await assertFile(path.join(outDir, "scripts", "api.mjs"));
  await assertFile(path.join(outDir, "scripts", "serve.mjs"));
  await assertFile(path.join(outDir, "src", "api", "reportApi.mjs"));
  await assertFile(path.join(outDir, "src", "app", "main.js"));
  await assertFile(path.join(outDir, "src", "parser", "rules", "game-state.json"));
  await assertMissing(path.join(outDir, "data"));
  await assertMissing(path.join(outDir, "artifacts"));
  await assertMissing(path.join(outDir, "exports"));
  await assertMissing(path.join(outDir, "labeling"));
  await assertMissing(path.join(outDir, "node_modules"));

  const startBat = await readFile(path.join(outDir, "start.bat"), "utf8");
  assert.match(startBat, /runtime\\node\\node\.exe/);
  assert.match(startBat, /"%NODE_EXE%" scripts\/api\.mjs --port 8787/);
  assert.match(startBat, /"%NODE_EXE%" scripts\/serve\.mjs/);

  const embeddedOutDir = path.join(tempDir, "bundle-embedded");
  const embeddedResult = JSON.parse(await runBuild(["--out", embeddedOutDir, "--embed-node", "current"]));
  assert.equal(embeddedResult.ok, true);
  assert.equal(embeddedResult.embeddedNode, true);
  const embeddedManifest = JSON.parse(await readFile(path.join(embeddedOutDir, "bundle-manifest.json"), "utf8"));
  assert.equal(embeddedManifest.runtime.embeddedNode, true);
  assert.equal(embeddedManifest.runtime.nodePath, "runtime/node/node.exe");
  assert.equal(embeddedManifest.runtime.source, "current_process");
  await assertFile(path.join(embeddedOutDir, "runtime", "node", "node.exe"));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("local desktop build tests passed");

function runBuild(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/build-local-desktop.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${stderr}\n${stdout}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function assertFile(filePath) {
  const fileStat = await stat(filePath);
  assert.equal(fileStat.isFile(), true, `${filePath} should be a file`);
}

async function assertMissing(filePath) {
  await assert.rejects(() => stat(filePath), { code: "ENOENT" });
}
