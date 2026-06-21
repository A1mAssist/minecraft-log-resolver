import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT ?? 5173);
const apiStateProbeTimeoutMs = Number(process.env.API_STATE_PROBE_TIMEOUT_MS ?? 500);
const apiTarget = process.env.API_TARGET ?? (await readApiServerState()) ?? "http://127.0.0.1:8787";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function resolveRequest(url) {
  let parsed;
  let pathname;
  try {
    parsed = new URL(url, `http://127.0.0.1:${port}`);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return {
      ok: false,
      status: 400,
      body: "Bad request",
    };
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, relative);
  if (!isSameOrInside(filePath, root)) {
    return {
      ok: false,
      status: 403,
      body: "Forbidden",
    };
  }
  return {
    ok: true,
    filePath,
  };
}

const server = createServer(async (request, response) => {
  if ((request.url ?? "").startsWith("/api/")) {
    await proxyApiRequest(request, response);
    return;
  }

  const resolved = resolveRequest(request.url ?? "/");
  if (!resolved.ok) {
    response.writeHead(resolved.status);
    response.end(resolved.body);
    return;
  }

  try {
    const filePath = resolved.filePath;
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  const actualPort = server.address().port;
  console.log(`Dev server running at http://127.0.0.1:${actualPort}`);
  console.log(`Proxying /api/* to ${apiTarget}`);
});

async function proxyApiRequest(request, response) {
  const targetUrl = new URL(request.url ?? "/", apiTarget);
  const body = await readBody(request);
  try {
    const apiResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "Content-Type": request.headers["content-type"] ?? "application/json",
      },
      body: body.length ? body : undefined,
    });
    const responseBody = Buffer.from(await apiResponse.arrayBuffer());
    response.writeHead(apiResponse.status, {
      "Content-Type": apiResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      "Content-Length": responseBody.length,
    });
    response.end(responseBody);
  } catch (error) {
    const text = JSON.stringify({
      ok: false,
      error: "api_proxy_failed",
      message: error.message,
    }, null, 2);
    response.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
    });
    response.end(text);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function readApiServerState() {
  try {
    const state = JSON.parse(await readFile(path.resolve(".cache", "api-server.json"), "utf8"));
    if (state.status !== "running") return null;
    const url = state.url ?? (state.host && state.port ? `http://${state.host}:${state.port}` : null);
    if (!isLocalHttpUrl(url)) return null;
    return await isApiTargetReady(url) ? url : null;
  } catch {
    return null;
  }
}

async function isApiTargetReady(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiStateProbeTimeoutMs);
  try {
    const response = await fetch(new URL("/api/refresh", url), {
      method: "GET",
      signal: controller.signal,
    });
    return response.headers.get("content-type")?.includes("application/json");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isLocalHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isSameOrInside(targetPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
