export function buildDiagnosticsPackageManifest(options = {}) {
  return {
    kind: options.kind ?? "diagnostics",
    version: 1,
    privacy: options.privacy ?? "privacy-safe",
    generatedBy: "minecraft-log-observatory",
    contains: {
      rawLogs: false,
      rawChat: false,
      fullReport: false,
      storeRows: false,
      localPaths: options.privacy === "full-local",
      localUserNames: options.privacy === "full-local",
      ...(options.contains ?? {}),
    },
    contents: options.contents ?? [],
    sources: options.sources ?? [],
    excluded: options.excluded ?? [
      "raw_minecraft_logs",
      "raw_chat_lines",
      "full_report_json",
      "split_store_rows",
    ],
  };
}

export function buildPrivacyAudit(value, options = {}) {
  const mode = options.full ? "full-local" : "privacy-safe";
  if (options.full) {
    return {
      mode,
      checked: false,
      safe: false,
      scannedBytes: 0,
      issueCount: null,
      checks: [],
      issues: [
        {
          code: "full_local_mode",
          message: "Full-local diagnostics intentionally may include local filesystem paths and configured identities.",
        },
      ],
    };
  }

  const text = JSON.stringify(value);
  const issues = [
    ...regexIssues(text, "windows_absolute_path", /[A-Za-z]:[\\/][^"',\s})\]]+/g),
    ...regexIssues(text, "unc_absolute_path", /\\\\[^\\/:"'\s]+[\\/][^"',\s})\]]+/g),
    ...regexIssues(text, "uuid", /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32})\b/gi),
    ...knownSensitiveValueIssues(text, options.knownSensitiveValues ?? []),
    ...forbiddenKeyIssues(value, options.forbiddenKeys ?? []),
  ];

  return {
    mode,
    checked: true,
    safe: issues.length === 0,
    scannedBytes: Buffer.byteLength(text, "utf8"),
    issueCount: issues.length,
    checks: [
      "windows_absolute_path",
      "unc_absolute_path",
      "uuid",
      "known_sensitive_values",
      ...(options.forbiddenKeys?.length ? ["forbidden_keys"] : []),
    ],
    issues,
  };
}

function regexIssues(text, code, regex) {
  const fingerprints = new Set();
  let count = 0;
  for (const match of text.matchAll(regex)) {
    count += 1;
    fingerprints.add(shortHash(match[0].toLowerCase()));
  }
  if (!count) return [];
  return [{
    code,
    count,
    fingerprints: [...fingerprints].slice(0, 5),
  }];
}

function knownSensitiveValueIssues(text, values) {
  const lowerText = text.toLowerCase();
  const fingerprints = new Set();
  let count = 0;
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized.length < 4) continue;
    if (!lowerText.includes(normalized)) continue;
    count += 1;
    fingerprints.add(shortHash(normalized));
  }
  if (!count) return [];
  return [{
    code: "known_sensitive_value",
    count,
    fingerprints: [...fingerprints].slice(0, 10),
  }];
}

function forbiddenKeyIssues(value, keys) {
  const blocked = new Set(keys.map((key) => String(key).toLowerCase()));
  if (!blocked.size) return [];
  const counts = {};
  scanForbiddenKeys(value, blocked, counts);
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({
      code: "forbidden_key",
      key,
      count,
    }));
}

function scanForbiddenKeys(value, blocked, counts) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) scanForbiddenKeys(item, blocked, counts);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (blocked.has(normalized)) {
      counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
    scanForbiddenKeys(child, blocked, counts);
  }
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
