const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const appName = "Minecraft Log Observatory";
const rootDir = path.resolve(process.env.MLO_ROOT || path.dirname(process.execPath));
const bundledNode = path.join(rootDir, "runtime", "node", "node.exe");
const nodeExe = existsSync(bundledNode) ? bundledNode : "node";
const apiPort = Number(process.env.MLO_API_PORT || process.env.API_PORT || 8787);
const frontendPort = Number(process.env.MLO_FRONTEND_PORT || process.env.PORT || 5173);
const noBrowser = process.env.MLO_NO_BROWSER === "1";
const children = new Set();
let shuttingDown = false;

main().catch((error) => {
  console.error(`${appName} failed to start.`);
  console.error(error?.stack || error?.message || String(error));
  shutdown(1);
});

async function main() {
  process.chdir(rootDir);
  const apiScript = requireBundleFile("scripts/api.mjs");
  const frontendScript = requireBundleFile("scripts/serve.mjs");

  console.log(`Starting ${appName}...`);
  const api = spawnManaged(nodeExe, [apiScript, "--port", String(apiPort)], {
    env: process.env,
    label: "api",
  });
  await waitForOutput(api, "Report API running at", "API startup");
  const apiTarget = await readApiTarget() || `http://127.0.0.1:${apiPort}`;

  const frontend = spawnManaged(nodeExe, [frontendScript], {
    env: {
      ...process.env,
      PORT: String(frontendPort),
      API_TARGET: apiTarget,
    },
    label: "frontend",
  });
  await waitForOutput(frontend, "Dev server running at", "frontend startup");

  const frontendUrl = `http://127.0.0.1:${frontendPort}/`;
  console.log("");
  console.log(`${appName} is running.`);
  console.log(`Frontend: ${frontendUrl}`);
  console.log(`API:      ${apiTarget}/api/health`);
  console.log("");
  console.log("Close this window or run stop.bat to stop local services.");
  if (!noBrowser) setTimeout(() => openBrowser(frontendUrl), 800);

  installShutdownHandlers();
  setInterval(() => {}, 60_000);
}

function spawnManaged(command, args, options) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  children.add(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${options.label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${options.label}] ${chunk}`));
  child.on("exit", () => children.delete(child));
  child.on("error", (error) => {
    console.error(`[${options.label}] ${error.message}`);
  });
  return child;
}

function waitForOutput(child, marker, label) {
  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 15_000);
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      if (output.includes(marker)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`${label} exited before it was ready with code ${code}.`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}

function requireBundleFile(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`Required bundle file is missing: ${relativePath}`);
  }
  return filePath;
}

async function readApiTarget() {
  try {
    const state = JSON.parse(await readFile(path.join(rootDir, ".cache", "api-server.json"), "utf8"));
    if (state.status !== "running") return null;
    return state.url || (state.host && state.port ? `http://${state.host}:${state.port}` : null);
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function installShutdownHandlers() {
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGHUP", () => shutdown(0));
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    stopChild(child);
  }
  setTimeout(() => process.exit(code), 500).unref();
}

function stopChild(child) {
  if (child.killed || !child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill();
}
