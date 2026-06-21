import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReportApiContext, handleReportApiRequest, sendApiResponse } from "../src/api/reportApi.mjs";

const args = process.argv.slice(2);
const port = Number(readOption("--port") ?? process.env.PORT ?? 8787);
const host = readOption("--host") ?? process.env.HOST ?? "127.0.0.1";
const configPath = readOption("--config") ?? undefined;
const maxBodyBytes = Number(readOption("--max-body-bytes") ?? process.env.MAX_BODY_BYTES ?? 1024 * 1024);
const strictPort = args.includes("--strict-port") || process.env.STRICT_PORT === "1";
const portRange = Number(readOption("--port-range") ?? process.env.PORT_RANGE ?? 20);
if (!isLocalHost(host)) {
  console.error(`Refusing to bind non-local host "${host}". Use 127.0.0.1 or localhost for the local desktop API.`);
  process.exit(1);
}
const context = await createReportApiContext(configPath);

const handler = async (request, response) => {
  try {
    const body = await readRequestBody(request);
    const apiResponse = await handleReportApiRequest(context, {
      method: request.method,
      url: request.url,
      body,
    });
    await sendApiResponse(response, apiResponse);
  } catch (error) {
    await sendApiResponse(response, {
      status: error.status ?? 500,
      headers: {},
      body: {
        ok: false,
        error: error.code ?? "request_failed",
        message: error.message,
      },
    });
  }
};

const { server, actualPort } = await listenWithFallback(handler, { host, port, strictPort, portRange });
const runtimeState = {
  schema: {
    name: "minecraft-log-observatory-api-server-state",
    version: 1,
  },
  contractVersion: 1,
  host,
  port: actualPort,
  requestedPort: port,
  status: "running",
  startedAt: new Date().toISOString(),
  pid: process.pid,
  localOnly: true,
  strictPort,
  portRange,
  endpoints: {
    status: "/api/app/status",
    refresh: "/api/refresh",
    health: "/api/health",
  },
  shutdown: {
    ipcMessages: ["shutdown", "mlo_shutdown"],
    signals: ["SIGINT", "SIGTERM"],
  },
};
await writeServerState(runtimeState);
installShutdownHandlers(server, runtimeState);
console.log(`Report API running at http://${host}:${actualPort}`);
if (actualPort !== port) {
  console.log(`Requested port ${port} was unavailable; selected ${actualPort}.`);
}
console.log("Endpoints: /api/health /api/app/status /api/config /api/summary /api/report /api/profile /api/activity /api/rounds /api/modes /api/results /api/result-candidates /api/refresh /api/refresh/history /api/accounts /api/accounts/playtime /api/rules /api/rules/test /api/rules/draft /api/rules/validate /api/rule-packs /api/rule-packs/user /api/store /api/timeseries /api/unmatched");

function readRequestBody(request) {
  if (!["POST", "PUT", "PATCH"].includes(request.method ?? "GET")) return {};
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLargeError = null;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        tooLargeError ??= apiError(413, "request_too_large", `Request body exceeds ${maxBodyBytes} bytes.`);
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLargeError) return reject(tooLargeError);
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      if (!isJsonContentType(request.headers["content-type"])) {
        return reject(apiError(415, "unsupported_media_type", "Use application/json for request bodies."));
      }
      try {
        return resolve(JSON.parse(raw));
      } catch (error) {
        return reject(apiError(400, "invalid_json", `Request body must be valid JSON: ${error.message}`));
      }
    });
  });
}

function readOption(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function listenWithFallback(handler, options) {
  const maxAttempts = options.port === 0 || options.strictPort ? 1 : Math.max(1, options.portRange + 1);
  let lastError = null;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidatePort = options.port === 0 ? 0 : options.port + offset;
    try {
      const server = await listenOnce(handler, options.host, candidatePort);
      return {
        server,
        actualPort: server.address().port,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableListenError(error) || options.strictPort) break;
    }
  }
  console.error(`Could not start API on ${options.host}:${options.port}${options.strictPort ? "" : `..${options.port + options.portRange}`}.`);
  if (lastError) console.error(lastError.message);
  process.exit(1);
}

function isRetryableListenError(error) {
  return ["EADDRINUSE", "EACCES", "EPERM"].includes(error?.code);
}

function listenOnce(handler, host, candidatePort) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(candidatePort, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function writeServerState(state) {
  const statePath = path.resolve(".cache", "api-server.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        ...state,
        url: `http://${state.host}:${state.port}`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function installShutdownHandlers(server, state) {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await closeServer(server);
      await writeServerState({
        ...state,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
        signal,
      });
    } catch (error) {
      console.error(`Failed to update API server state during shutdown: ${error.message}`);
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("message", (message) => {
    if (message?.type === "shutdown" || message?.type === "mlo_shutdown") {
      shutdown("ipc_shutdown");
    }
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isLocalHost(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(value);
}

function isJsonContentType(value) {
  if (!value) return false;
  const mediaType = String(value).split(";")[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function apiError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
