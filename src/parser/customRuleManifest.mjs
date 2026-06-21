import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bundledRulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "rules");

export function buildBundledRuleManifest() {
  return buildRuleManifestFromPaths([bundledRulesDir]);
}

export function buildCustomRuleManifest(customRulePaths = []) {
  return buildRuleManifestFromPaths(customRulePaths);
}

function buildRuleManifestFromPaths(rulePaths = []) {
  const entries = [];
  for (const rulePath of rulePaths.filter(Boolean)) {
    const resolvedPath = path.resolve(rulePath);
    try {
      const pathStat = statSync(resolvedPath);
      if (pathStat.isDirectory()) {
        for (const fileName of readdirSync(resolvedPath).filter((name) => name.endsWith(".json")).sort(ruleFileCompare)) {
          entries.push(fileManifest(path.join(resolvedPath, fileName), resolvedPath));
        }
      } else {
        entries.push(fileManifest(resolvedPath, null));
      }
    } catch (error) {
      entries.push({
        path: resolvedPath,
        exists: false,
        error: error.code ?? "read_error",
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function fileManifest(filePath, parentPath) {
  const fileStat = statSync(filePath);
  if (!fileStat.isFile()) {
    return {
      path: path.resolve(filePath),
      parentPath,
      exists: true,
      type: fileStat.isDirectory() ? "directory" : "other",
      bytes: fileStat.size,
      sha256: null,
    };
  }
  const bytes = readFileSync(filePath);
  return {
    path: path.resolve(filePath),
    parentPath,
    exists: true,
    type: "file",
    bytes: fileStat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function ruleFileCompare(a, b) {
  return ruleFilePriority(a) - ruleFilePriority(b) || a.localeCompare(b);
}

function ruleFilePriority(fileName) {
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
