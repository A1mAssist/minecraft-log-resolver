import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isClientModNoiseMessage } from "./chatNoise.mjs";
import { normalizeChatMessage } from "./chatTemplates.mjs";
import { buildCustomRuleManifest } from "./customRuleManifest.mjs";
export { isClientModNoiseMessage };

const rulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "rules");
const bundledRuleSets = loadBundledRuleSets();
const customRuleSetCache = new Map();
const gameStateCompatRuleSets = new Set([
  "game-state",
  "bedwars",
  "skywars",
  "duels",
  "mega_walls",
  "mini_walls",
  "the_pit",
  "blitz_sg",
  "bridge",
  "build_battle",
  "hide_and_seek",
  "murder_mystery",
  "speed_uhc",
  "the_walls",
  "uhc",
]);

export function parseChatEvent(message, options = {}) {
  if (isClientModNoiseMessage(message)) return null;
  const ruleEntries = selectRuleEntries(options.ruleSets, options);

  for (const { ruleSet, rule } of ruleEntries) {
    const cleaned = cleanChatMessage(message, ruleSet, rule);
    const match = cleaned.match(rule.pattern);
    if (!match) continue;
    const isCompatSelection = ruleSet.selection !== "direct";
    return {
      type: rule.type,
      ruleSet: isCompatSelection ? (rule.legacyRuleSet ?? ruleSet.id) : ruleSet.id,
      rulePack: ruleSet.id,
      legacyRuleSet: rule.legacyRuleSet ?? null,
      ruleId: rule.id,
      message: cleaned,
      template: normalizeChatMessage(cleaned),
      payload: {
        ...(rule.payload ?? {}),
        ...cleanupGroups(match.groups ?? {}),
      },
    };
  }

  return null;
}

export function cleanChatMessage(message, ruleSet = null, rule = null) {
  let cleaned = message
    .replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const cleaner of rule?.cleaners ?? ruleSet?.cleaners ?? []) {
    cleaned = cleaned.replace(cleaner.pattern, cleaner.replacement);
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export function listRuleSets(options = {}) {
  return getAllRuleSets(options).map(({ id, name, description, rules, source, filePath }) => ({
    id,
    name,
    description,
    rules: rules.length,
    source,
    filePath,
  }));
}

export function listRuleSetDetails(options = {}) {
  return selectRuleSets(options.ruleSets, options).map(({ id, name, description, rules, source, filePath }) => ({
    id,
    name,
    description,
    source,
    filePath,
    rules: rules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      pattern: rule.pattern?.source ?? String(rule.pattern ?? ""),
      flags: rule.pattern?.flags ?? rule.flags ?? "",
      payload: rule.payload ?? {},
      confidence: rule.confidence ?? null,
      notes: rule.notes ?? null,
    })),
  }));
}

export function getRuleSignature(ruleSetIds, options = {}) {
  return JSON.stringify(
    selectRuleSets(ruleSetIds, options).map((ruleSet) => ({
      id: ruleSet.id,
      source: ruleSet.source,
      filePath: ruleSet.filePath,
      cleaners: ruleSet.cleaners.map((cleaner) => ({
        pattern: cleaner.pattern.source,
        flags: cleaner.pattern.flags,
        replacement: cleaner.replacement,
      })),
      rules: ruleSet.rules.map((rule) => ({
        id: rule.id,
        type: rule.type,
        pattern: rule.pattern.source,
        flags: rule.pattern.flags,
        payload: rule.payload ?? {},
        matchOrder: rule.matchOrder ?? null,
        legacyRuleSet: rule.legacyRuleSet ?? null,
      })),
    })),
  );
}

export function validateRuleSetDefinition(raw, sourceName = "<inline>") {
  const errors = [];
  if (!raw || typeof raw !== "object") errors.push(`${sourceName}: rule set must be an object`);
  if (!raw?.id || typeof raw.id !== "string") errors.push(`${sourceName}: id is required`);
  if (!Array.isArray(raw?.rules)) errors.push(`${sourceName}: rules must be an array`);
  for (const [index, cleaner] of (raw?.cleaners ?? []).entries()) {
    if (!cleaner.pattern) errors.push(`${sourceName}: cleaners[${index}].pattern is required`);
    try {
      if (cleaner.pattern) new RegExp(cleaner.pattern, cleaner.flags ?? "");
    } catch (error) {
      errors.push(`${sourceName}: cleaners[${index}] invalid regex: ${error.message}`);
    }
  }
  for (const [index, rule] of (raw?.rules ?? []).entries()) {
    if (!rule.id || typeof rule.id !== "string") errors.push(`${sourceName}: rules[${index}].id is required`);
    if (!rule.type || typeof rule.type !== "string") errors.push(`${sourceName}: rules[${index}].type is required`);
    if (!rule.pattern || typeof rule.pattern !== "string") errors.push(`${sourceName}: rules[${index}].pattern is required`);
    try {
      if (rule.pattern) new RegExp(rule.pattern, rule.flags ?? "");
    } catch (error) {
      errors.push(`${sourceName}: rules[${index}] invalid regex: ${error.message}`);
    }
  }
  return errors;
}

export function loadCustomRuleSets(customRulePaths = []) {
  const paths = customRulePaths.filter(Boolean).map((rulePath) => path.resolve(rulePath));
  const cacheKey = JSON.stringify({
    paths,
    files: buildCustomRuleManifest(paths),
  });
  if (customRuleSetCache.has(cacheKey)) return customRuleSetCache.get(cacheKey);

  const loaded = [];
  for (const rulePath of paths) {
    for (const filePath of expandRulePath(rulePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      const errors = validateRuleSetDefinition(raw, filePath);
      if (errors.length) {
        const error = new Error(errors.join("\n"));
        error.code = "INVALID_RULE_SET";
        throw error;
      }
      loaded.push(compileRuleSet(raw, { source: "custom", filePath }));
    }
  }

  customRuleSetCache.set(cacheKey, loaded);
  return loaded;
}

function selectRuleSets(ruleSetIds, options = {}) {
  const allRuleSets = getAllRuleSets(options);
  if (!ruleSetIds?.length) {
    return allRuleSets.map((ruleSet) => ({
      ...ruleSet,
      selection: "default",
    }));
  }
  const wanted = new Set(expandRuleSetAliases(ruleSetIds));
  return allRuleSets
    .map((ruleSet) => filterCompatRuleSet(ruleSet, ruleSetIds, wanted))
    .filter(Boolean);
}

function selectRuleEntries(ruleSetIds, options = {}) {
  return selectRuleSets(ruleSetIds, options)
    .flatMap((ruleSet, ruleSetIndex) => ruleSet.rules.map((rule, ruleIndex) => ({
      ruleSet,
      rule,
      order: ruleOrder(rule, ruleSetIndex, ruleIndex),
    })))
    .sort((a, b) => a.order - b.order || a.ruleSet.id.localeCompare(b.ruleSet.id) || a.rule.id.localeCompare(b.rule.id));
}

function getAllRuleSets(options = {}) {
  const customRuleSets = loadCustomRuleSets(options.customRulePaths ?? []);
  const inlineRuleSets = loadInlineRuleSets(options.inlineRulePacks ?? []);
  return [...inlineRuleSets, ...customRuleSets, ...bundledRuleSets];
}

function loadBundledRuleSets() {
  return readdirSync(rulesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort((a, b) => ruleSetFilePriority(a) - ruleSetFilePriority(b) || a.localeCompare(b))
    .map((fileName) => {
      const raw = JSON.parse(readFileSync(path.join(rulesDir, fileName), "utf8"));
      return compileRuleSet(raw, { source: "bundled", filePath: path.join(rulesDir, fileName) });
    });
}

function expandRulePath(rulePath) {
  const fileStat = statSync(rulePath);
  if (fileStat.isDirectory()) {
    return readdirSync(rulePath)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort((a, b) => ruleSetFilePriority(a) - ruleSetFilePriority(b) || a.localeCompare(b))
      .map((fileName) => path.join(rulePath, fileName));
  }
  return [rulePath];
}

function compileRuleSet(raw, metadata) {
  return {
    ...raw,
    source: metadata.source,
    filePath: metadata.filePath,
    cleaners: (raw.cleaners ?? []).map(compileCleaner),
    rules: raw.rules.map((rule, index) => compileRule(rule, index)),
  };
}

function loadInlineRuleSets(rulePacks = []) {
  return rulePacks.map((rulePack, index) => {
    const errors = validateRuleSetDefinition(rulePack, `<inline:${index}>`);
    if (errors.length) {
      const error = new Error(errors.join("\n"));
      error.code = "INVALID_RULE_SET";
      throw error;
    }
    return compileRuleSet(rulePack, { source: "inline", filePath: `<inline:${rulePack.id ?? index}>` });
  });
}

function ruleSetFilePriority(fileName) {
  const order = [
    "game-state.json",
    "bedwars.json",
    "skywars.json",
    "duels.json",
    "mega_walls.json",
    "mini_walls.json",
    "the_pit.json",
    "blitz_sg.json",
    "bridge.json",
    "build_battle.json",
    "hide_and_seek.json",
    "murder_mystery.json",
    "speed_uhc.json",
    "the_walls.json",
    "uhc.json",
    "minecraft-combat.json",
  ];
  const index = order.indexOf(fileName);
  return index >= 0 ? index : order.length;
}

function compileCleaner(cleaner) {
  return {
    pattern: new RegExp(cleaner.pattern, cleaner.flags ?? ""),
    replacement: cleaner.replacement ?? "",
  };
}

function compileRule(rule, index = 0) {
  return {
    ...rule,
    internalOrder: index,
    cleaners: (rule.cleaners ?? null)?.map(compileCleaner) ?? null,
    pattern: new RegExp(rule.pattern, rule.flags ?? ""),
  };
}

function expandRuleSetAliases(ruleSetIds = []) {
  const expanded = [];
  for (const id of ruleSetIds) {
    expanded.push(id);
    if (id === "game-state") {
      for (const compatId of gameStateCompatRuleSets) expanded.push(compatId);
    }
  }
  return expanded;
}

function filterCompatRuleSet(ruleSet, requestedIds, wanted) {
  if (!wanted.has(ruleSet.id)) return null;
  if (requestedIds.includes(ruleSet.id) && ruleSet.id !== "game-state") {
    return {
      ...ruleSet,
      selection: "direct",
    };
  }
  if (!requestedIds.includes("game-state")) {
    return {
      ...ruleSet,
      selection: "direct",
    };
  }
  if (ruleSet.id === "game-state" || !gameStateCompatRuleSets.has(ruleSet.id)) {
    return {
      ...ruleSet,
      selection: "direct",
    };
  }
  return {
    ...ruleSet,
    selection: "compat",
    rules: ruleSet.rules.filter((rule) => rule.legacyRuleSet === "game-state"),
  };
}

function ruleOrder(rule, ruleSetIndex, ruleIndex) {
  if (Number.isFinite(rule.matchOrder)) return rule.matchOrder;
  return 100000 + ruleSetIndex * 1000 + (rule.internalOrder ?? ruleIndex);
}

function cleanupGroups(groups) {
  const cleaned = {};
  for (const [key, value] of Object.entries(groups)) {
    if (value === undefined) continue;
    cleaned[key] = value.replace(/(?:\u00a7|&)[0-9a-fk-or]/gi, "").trim();
  }
  return cleaned;
}
