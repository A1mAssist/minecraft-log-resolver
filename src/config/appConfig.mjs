import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const defaultConfigPath = path.resolve("minecraft-log-observatory.config.json");

const defaultConfig = {
  roots: [],
  encoding: "gb18030",
  rules: [],
  customRules: [],
  scopes: [],
  unmatchedTemplatesLimit: 50,
  owner: {
    mode: "all_local_users",
    displayName: "Owner",
    aliases: [],
  },
  app: {
    dataDir: "data",
    skinProxyEnabled: true,
  },
  cache: {
    parse: ".cache/parse-cache.json",
    chat: ".cache/chat-event-cache.json",
    chatLines: ".cache/chat-lines-cache.json",
  },
  outputs: {
    report: "report-combined.json",
    summary: "report-combined-summary.json",
  },
};

export async function loadAppConfig(configPath = defaultConfigPath) {
  const resolvedPath = path.resolve(configPath);
  const loaded = await readOptionalJson(resolvedPath);
  const localPath = resolveLocalConfigPath(resolvedPath, loaded.data.localConfig);
  const localLoaded = await readOptionalJson(localPath);

  const config = mergeConfig(mergeConfig(defaultConfig, loaded.data), localLoaded.data);
  return {
    path: resolvedPath,
    dir: path.dirname(resolvedPath),
    localPath,
    localExists: localLoaded.exists,
    layers: [
      { kind: "default", exists: true },
      { kind: "config", path: resolvedPath, exists: loaded.exists },
      { kind: "local", path: localPath, exists: localLoaded.exists },
    ],
    config,
  };
}

export function resolveConfigPath(configContext, value) {
  if (!value) return value;
  if (path.isAbsolute(value)) return value;
  return path.resolve(configContext.dir, value);
}

export function resolveDataDir(configContext) {
  return resolveConfigPath(configContext, configContext.config.app?.dataDir ?? "data");
}

export function resolveStoreDir(configContext) {
  return path.join(resolveDataDir(configContext), "report-store");
}

export async function writeLocalAppConfig(configContext, localConfig) {
  await mkdir(path.dirname(configContext.localPath), { recursive: true });
  await writeFile(configContext.localPath, `${JSON.stringify(localConfig, null, 2)}\n`, "utf8");
}

function mergeConfig(base, override) {
  const merged = { ...base, ...override };
  merged.cache = { ...base.cache, ...(override.cache ?? {}) };
  merged.outputs = { ...base.outputs, ...(override.outputs ?? {}) };
  merged.owner = { ...base.owner, ...(override.owner ?? {}) };
  merged.app = { ...base.app, ...(override.app ?? {}) };
  merged.customRules = override.customRules ?? base.customRules;
  return merged;
}

async function readOptionalJson(filePath) {
  try {
    return {
      exists: true,
      data: JSON.parse(await readFile(filePath, "utf8")),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      exists: false,
      data: {},
    };
  }
}

function resolveLocalConfigPath(configPath, configuredLocalPath) {
  if (configuredLocalPath) {
    return path.isAbsolute(configuredLocalPath)
      ? configuredLocalPath
      : path.resolve(path.dirname(configPath), configuredLocalPath);
  }

  const dir = path.dirname(configPath);
  const fileName = path.basename(configPath);
  if (fileName.endsWith(".config.json")) {
    return path.join(dir, fileName.replace(/\.config\.json$/, ".local.json"));
  }
  if (fileName.endsWith(".json")) {
    return path.join(dir, fileName.replace(/\.json$/, ".local.json"));
  }
  return `${configPath}.local.json`;
}
