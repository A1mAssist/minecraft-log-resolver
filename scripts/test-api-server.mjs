import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtureDir = path.resolve(".cache", "test-api-server");
const configPath = path.join(fixtureDir, "observatory.config.json");
const statePath = path.resolve(".cache", "api-server.json");
let blocker = null;
let child = null;

try {
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        roots: [],
        localConfig: "observatory.local.json",
      },
      null,
      2,
    ),
    "utf8",
  );

  blocker = await listenBlocker();
  const blockedPort = blocker.address().port;
  child = spawn(process.execPath, [
    "scripts/api.mjs",
    "--config",
    configPath,
    "--port",
    String(blockedPort),
    "--port-range",
    "2",
    "--max-body-bytes",
    "128",
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  const output = await waitForServerOutput(child);
  assert.match(output, /Report API running at http:\/\/127\.0\.0\.1:\d+/);

  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.schema.name, "minecraft-log-observatory-api-server-state");
  assert.equal(state.schema.version, 1);
  assert.equal(state.contractVersion, 1);
  assert.equal(state.host, "127.0.0.1");
  assert.equal(state.requestedPort, blockedPort);
  assert.notEqual(state.port, blockedPort);
  assert.equal(state.status, "running");
  assert.equal(state.pid, child.pid);
  assert.equal(state.localOnly, true);
  assert.equal(state.strictPort, false);
  assert.equal(state.portRange, 2);
  assert.equal(state.endpoints.status, "/api/app/status");
  assert.ok(state.shutdown.ipcMessages.includes("mlo_shutdown"));
  assert.match(state.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(state.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  await assertServeProxyTarget(state, state.url);

  const appStatus = await getJson(`${state.url}/api/app/status`);
  assert.equal(appStatus.ok, true);
  assert.equal(appStatus.firstRun, true);
  assert.equal(appStatus.project.rootCount, 0);

  const diagnosticsPackage = await getJson(`${state.url}/api/diagnostics/package`);
  assert.equal(diagnosticsPackage.schema.name, "minecraft-log-observatory-diagnostics-package");
  assert.equal(diagnosticsPackage.privacy, "privacy-safe");
  assert.equal(diagnosticsPackage.manifest.kind, "api-diagnostics-package");
  assert.equal(diagnosticsPackage.privacyAudit.checked, true);
  assert.equal(diagnosticsPackage.privacyAudit.safe, true);
  assert.equal(diagnosticsPackage.containsRawLogs, false);

  const rootValidation = await postJson(`${state.url}/api/config/validate-roots`, { roots: [] });
  assert.equal(rootValidation.status, 400);
  assert.equal(rootValidation.body.ok, false);

  const invalidRootValidation = await postJson(`${state.url}/api/config/validate-roots`, { roots: "not-an-array" });
  assert.equal(invalidRootValidation.status, 400);
  assert.equal(invalidRootValidation.body.ok, false);
  assert.equal(invalidRootValidation.body.error, "invalid_validate_roots_request");
  assert.ok(invalidRootValidation.body.errors.some((item) => item.field === "roots" && item.error === "expected_string_array"));

  const ruleTest = await postJson(`${state.url}/api/rules/test`, { message: "VICTORY!" });
  assert.equal(ruleTest.status, 200);
  assert.equal(ruleTest.body.matched, true);

  const oversized = await postJson(`${state.url}/api/rules/test`, { message: "x".repeat(500) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error, "request_too_large");

  const malformedJson = await postRaw(`${state.url}/api/rules/test`, "{", { "Content-Type": "application/json" });
  assert.equal(malformedJson.status, 400);
  assert.equal(malformedJson.body.error, "invalid_json");

  const nullJson = await postRaw(`${state.url}/api/rules/test`, "null", { "Content-Type": "application/json" });
  assert.equal(nullJson.status, 400);
  assert.equal(nullJson.body.error, "invalid_request_body");
  assert.equal(nullJson.body.received, "null");

  const arrayJson = await postRaw(`${state.url}/api/rules/test`, "[]", { "Content-Type": "application/json" });
  assert.equal(arrayJson.status, 400);
  assert.equal(arrayJson.body.error, "invalid_request_body");
  assert.equal(arrayJson.body.received, "array");

  const textBody = await postRaw(`${state.url}/api/rules/test`, "message=VICTORY", { "Content-Type": "text/plain" });
  assert.equal(textBody.status, 415);
  assert.equal(textBody.body.error, "unsupported_media_type");

  const missingContentType = await postRaw(`${state.url}/api/rules/test`, Buffer.from(JSON.stringify({ message: "VICTORY!" })));
  assert.equal(missingContentType.status, 415);
  assert.equal(missingContentType.body.error, "unsupported_media_type");

  const exitPromise = waitForProcessExit(child);
  child.send({ type: "shutdown" });
  await exitPromise;
  child = null;
  const stoppedState = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(stoppedState.contractVersion, 1);
  assert.equal(stoppedState.status, "stopped");
  assert.equal(stoppedState.pid, state.pid);
  assert.equal(stoppedState.url, state.url);
  assert.equal(stoppedState.signal, "ipc_shutdown");
  assert.match(stoppedState.stoppedAt, /^\d{4}-\d{2}-\d{2}T/);

  await assertServeProxyTarget(stoppedState, "http://127.0.0.1:8787", { assertStaticFiles: true });
  const unusedApiTarget = await unusedLocalHttpUrl();
  await assertServeProxyTarget({
    ...stoppedState,
    status: "running",
    url: unusedApiTarget,
  }, "http://127.0.0.1:8787");
  await assertServeProxyTarget({
    ...stoppedState,
    status: "running",
    url: "https://example.com:443",
  }, "http://127.0.0.1:8787");
  await assertServeProxyTarget(stoppedState, unusedApiTarget, {
    apiTargetEnv: unusedApiTarget,
    assertProxyFailure: true,
  });

  console.log("api server tests passed");
} finally {
  if (child && !child.killed) child.kill();
  if (blocker) await closeServer(blocker);
  await rm(fixtureDir, { recursive: true, force: true });
}

function listenBlocker() {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function unusedLocalHttpUrl() {
  const server = await listenBlocker();
  const selectedPort = server.address().port;
  await closeServer(server);
  return `http://127.0.0.1:${selectedPort}`;
}

function waitForServerOutput(serverProcess) {
  return waitForOutput(serverProcess, (output) => output.includes("Report API running at"), "API server startup");
}

function waitForOutput(serverProcess, ready, label) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label} output:\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (ready(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    serverProcess.stdout.on("data", onData);
    serverProcess.stderr.on("data", onData);
    serverProcess.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API server exited with ${code}:\n${output}`));
    });
    serverProcess.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function assertServeProxyTarget(state, expectedTarget, options = {}) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const serveEnv = {
    ...process.env,
    PORT: "0",
  };
  if (options.apiTargetEnv) {
    serveEnv.API_TARGET = options.apiTargetEnv;
  } else {
    delete serveEnv.API_TARGET;
  }
  const serve = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: process.cwd(),
    env: serveEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const output = await waitForOutput(serve, (text) => text.includes("Proxying /api/* to "), "static server startup");
    assert.match(output, new RegExp(`Proxying /api/\\* to ${escapeRegex(expectedTarget)}`));
    const serveUrl = serveUrlFromOutput(output);
    if (options.assertStaticFiles) {
      const index = await getTextResponse(`${serveUrl}/`);
      assert.equal(index.status, 200);
      assert.match(index.body, /<script type="module" src="\/src\/app\/main\.js"/);
      const traversal = await getTextResponse(`${serveUrl}/..%2fminecraft-log-session-code-evil%2fsecret.txt`);
      assert.equal(traversal.status, 403);
      assert.equal(traversal.body, "Forbidden");
      const malformedPath = await getTextResponse(`${serveUrl}/%E0%A4%A`);
      assert.equal(malformedPath.status, 400);
      assert.equal(malformedPath.body, "Bad request");
    }
    if (options.assertProxyFailure) {
      const proxyFailure = await getJsonResponse(`${serveUrl}/api/app/status`);
      assert.equal(proxyFailure.status, 502);
      assert.equal(proxyFailure.body.ok, false);
      assert.equal(proxyFailure.body.error, "api_proxy_failed");
      assert.equal(typeof proxyFailure.body.message, "string");
    }
  } finally {
    const exitPromise = waitForProcessExit(serve).catch(() => {});
    if (!serve.killed) serve.kill();
    await exitPromise;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serveUrlFromOutput(output) {
  const match = output.match(/Dev server running at (http:\/\/127\.0\.0\.1:\d+)/);
  assert.ok(match, `Could not find static server URL in output:\n${output}`);
  return match[1];
}

function waitForProcessExit(serverProcess) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for API server process exit.")), 10000);
    serverProcess.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    serverProcess.once("error", (error) => {
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

async function getJsonResponse(url) {
  const response = await fetch(url);
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getTextResponse(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.text(),
  };
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

async function postRaw(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
