import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_VERSION = 2;
const CACHE_DIRTY = Symbol("parseCacheDirty");

export async function loadParseCache(cachePath) {
  if (!cachePath) return createEmptyCache();
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8"));
    if (parsed.version !== CACHE_VERSION || !parsed.files) return createEmptyCache();
    markCacheClean(parsed);
    return parsed;
  } catch {
    return createEmptyCache();
  }
}

export async function saveParseCache(cachePath, cache) {
  if (!cachePath) return;
  if (!isCacheDirty(cache)) return;
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify({ ...cache, version: CACHE_VERSION }), "utf8");
  markCacheClean(cache);
}

export function createEmptyCache() {
  const cache = {
    version: CACHE_VERSION,
    generatedAt: null,
    files: {},
  };
  markCacheClean(cache);
  return cache;
}

export function getCachedFile(cache, file, options = {}) {
  const cached = cache.files[file.path];
  const expectedSignature = options.cacheSignature ?? null;
  if (!cached) return null;
  if (
    cached.size !== file.size ||
    cached.modifiedMs !== file.modifiedMs ||
    cached.kind !== file.kind ||
    cached.encoding !== normalizeEncoding(options.encoding) ||
    (expectedSignature !== null && cached.signature !== expectedSignature)
  ) {
    return null;
  }
  return cached.result;
}

export function setCachedFile(cache, file, result, options = {}) {
  cache.files[file.path] = {
    size: file.size,
    modifiedMs: file.modifiedMs,
    kind: file.kind,
    encoding: normalizeEncoding(options.encoding),
    signature: options.cacheSignature ?? null,
    cachedAt: new Date().toISOString(),
    result,
  };
  markCacheDirty(cache);
}

export function touchCache(cache) {
  if (!isCacheDirty(cache)) return;
  cache.generatedAt = new Date().toISOString();
}

function normalizeEncoding(encoding) {
  return (encoding ?? "utf-8").toLowerCase();
}

function isCacheDirty(cache) {
  return Boolean(cache?.[CACHE_DIRTY]);
}

function markCacheDirty(cache) {
  if (!cache || typeof cache !== "object") return;
  Object.defineProperty(cache, CACHE_DIRTY, {
    value: true,
    enumerable: false,
    configurable: true,
  });
}

function markCacheClean(cache) {
  if (!cache || typeof cache !== "object") return;
  Object.defineProperty(cache, CACHE_DIRTY, {
    value: false,
    enumerable: false,
    configurable: true,
  });
}
