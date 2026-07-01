import { readdir, stat } from "node:fs/promises";
import path from "node:path";

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(fullPath);
      return [fullPath];
    }),
  );
  return files.flat();
}

export async function discoverScopes(root) {
  const scopes = [];
  const source = path.basename(path.dirname(root)) || path.basename(root);
  const rootLogs = path.join(root, "logs");

  if (await pathExists(rootLogs)) {
    scopes.push({ root, source, scope: "(root)", logDir: rootLogs });
  }

  const versionsDir = path.join(root, "versions");
  if (!(await pathExists(versionsDir))) return scopes;

  const versions = await readdir(versionsDir, { withFileTypes: true });
  for (const version of versions) {
    if (!version.isDirectory()) continue;
    const logDir = path.join(versionsDir, version.name, "logs");
    if (await pathExists(logDir)) {
      scopes.push({ root, source, scope: version.name, logDir });
    }
  }

  return scopes;
}

export async function discoverLogFiles(scope) {
  const files = await listFilesRecursive(scope.logDir);
  const logFiles = [];

  for (const file of files) {
    const name = path.basename(file);
    const isGzip = /\.log\.gz$/i.test(name);
    const isLog = /\.log$/i.test(name);
    const isChat = /^!CHAT/i.test(name);
    if (!isGzip && !isLog && !isChat) continue;

    const fileStat = await stat(file);
    logFiles.push({
      path: file,
      root: scope.root,
      source: scope.source,
      scope: scope.scope,
      size: fileStat.size,
      modifiedMs: fileStat.mtimeMs,
      kind: isGzip ? "gzip" : isChat ? "chat" : "log",
    });
  }

  return logFiles.sort((a, b) => a.modifiedMs - b.modifiedMs);
}

export async function discoverMinecraftLogScopes(roots, options = {}) {
  const scopeFilter = options.scope ? new Set(options.scope) : null;
  const discovered = [];

  for (const root of roots) {
    let scopes = await discoverScopes(root);
    if (scopeFilter) scopes = scopes.filter((scope) => scopeFilter.has(scope.scope));

    for (const scope of scopes) {
      const files = await discoverLogFiles(scope);
      discovered.push({
        ...scope,
        files,
      });
    }
  }

  return discovered;
}

export function summarizeDiscoveredScopes(scopes = []) {
  const files = scopes.flatMap((scope) => scope.files ?? []);
  return {
    roots: new Set(scopes.map((scope) => scope.root)).size,
    scopes: scopes.length,
    files: files.length,
    bytes: files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0),
    latestModifiedMs: files.reduce((latest, file) => Math.max(latest, Number.isFinite(file.modifiedMs) ? file.modifiedMs : 0), 0),
  };
}
