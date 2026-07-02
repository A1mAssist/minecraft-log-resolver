import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "mlo-local-desktop-runtime-"));
let api = null;
let frontend = null;
try {
  const bundleDir = path.join(tempDir, "bundle");
  await runBuild(["--out", bundleDir]);
  await writeFile(path.join(bundleDir, "minecraft-log-resolver.local.json"), JSON.stringify({
    roots: [],
  }, null, 2), "utf8");

  const apiPort = await unusedPort();
  api = spawn(process.execPath, ["scripts/api.mjs", "--port", String(apiPort), "--strict-port"], {
    cwd: bundleDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const apiOutput = await waitForOutput(api, (text) => text.includes("Report API running at"), "bundle API startup");
  assert.match(apiOutput, new RegExp(`Report API running at http://127\\.0\\.0\\.1:${apiPort}`));
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  const appStatus = await getJson(`${apiUrl}/api/app/status`);
  assert.equal(appStatus.ok, true);
  assert.equal(appStatus.firstRun, true);
  assert.equal(appStatus.project.rootCount, 0);
  assert.equal(appStatus.app.launcher.desktopIntegration.directoryPickerEndpoint, "POST /api/system/select-directory");

  const invalidValidation = await postJson(`${apiUrl}/api/config/validate-roots`, { roots: "not-an-array" });
  assert.equal(invalidValidation.status, 400);
  assert.equal(invalidValidation.body.error, "invalid_validate_roots_request");

  const frontendPort = await unusedPort();
  frontend = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: bundleDir,
    env: {
      ...process.env,
      PORT: String(frontendPort),
      API_TARGET: apiUrl,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const frontendOutput = await waitForOutput(frontend, (text) => text.includes("Proxying /api/* to "), "bundle frontend startup");
  assert.match(frontendOutput, new RegExp(`Dev server running at http://127\\.0\\.0\\.1:${frontendPort}`));
  assert.match(frontendOutput, new RegExp(`Proxying /api/\\* to ${escapeRegex(apiUrl)}`));
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;

  const index = await getText(`${frontendUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.body, /<script type="module" src="\/src\/app\/main\.js"/);

  const proxiedStatus = await getJson(`${frontendUrl}/api/app/status`);
  assert.equal(proxiedStatus.ok, true);
  assert.equal(proxiedStatus.firstRun, true);

  const minecraftRoot = path.join(tempDir, "fixture-minecraft");
  const logDir = path.join(minecraftRoot, "logs");
  await mkdir(logDir, { recursive: true });
  await writeFile(
    path.join(logDir, "2026-06-15-1.log"),
    "[12:00:00] [Client thread/INFO]: [CHAT] The game starts in 10 seconds!\n",
    "utf8",
  );

  const rootValidation = await postJson(`${frontendUrl}/api/config/validate-roots`, { roots: [minecraftRoot] });
  assert.equal(rootValidation.status, 200);
  assert.equal(rootValidation.body.ok, true);
  assert.equal(rootValidation.body.logFiles, 1);

  const saveConfig = await putJson(`${frontendUrl}/api/config`, { roots: [minecraftRoot] });
  assert.equal(saveConfig.status, 200);
  assert.equal(saveConfig.body.ok, true);
  assert.deepEqual(saveConfig.body.effective.roots, [minecraftRoot]);

  const configuredStatus = await getJson(`${frontendUrl}/api/app/status`);
  assert.equal(configuredStatus.ok, true);
  assert.equal(configuredStatus.firstRun, false);
  assert.equal(configuredStatus.project.rootCount, 1);
  assert.equal(configuredStatus.setup.state, "needs_refresh");
  assert.ok(configuredStatus.refreshReasons.includes("report_not_ready"));

  console.log("local desktop runtime tests passed");
} finally {
  if (frontend && !frontend.killed) frontend.kill();
  if (api && !api.killed) {
    try {
      api.send({ type: "shutdown" });
      await waitForExit(api);
    } catch {
      api.kill();
    }
  }
  await rm(tempDir, { recursive: true, force: true });
}

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

async function unusedPort() {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForOutput(child, ready, label) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}:\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (ready(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited with ${code}:\n${output}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for process exit.")), 10000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  assert.equal(response.ok, true);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function putJson(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getText(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.text(),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
