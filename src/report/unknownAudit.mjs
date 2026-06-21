import { unknownGameMode } from "../parser/gameModes.mjs";

export const UNKNOWN_AUDIT_CATEGORIES = [
  "bedwars_no_safe_result_evidence",
  "bedwars_low_evidence_pseudo_candidate",
  "bedwars_self_death_boundary_review",
  "bedwars_team_win_low_confidence_review",
  "non_bedwars_remaining_unknown",
];

export const UNKNOWN_AUDIT_NEXT_ACTIONS = [
  "label_sample",
  "review_owner_identity",
  "review_rule_candidate",
  "keep_unknown",
];

export const UNKNOWN_AUDIT_PRIORITIES = [
  "high",
  "medium",
  "low",
];

export const UNKNOWN_AUDIT_CATEGORY_SET = new Set(UNKNOWN_AUDIT_CATEGORIES);
export const UNKNOWN_AUDIT_NEXT_ACTION_SET = new Set(UNKNOWN_AUDIT_NEXT_ACTIONS);
export const UNKNOWN_AUDIT_PRIORITY_SET = new Set(UNKNOWN_AUDIT_PRIORITIES);

const BEDWARS_LOW_EVIDENCE_REASON = "low_evidence_bedwars_pseudo_round_candidate";
const BEDWARS_SELF_DEATH_BOUNDARY_REASON = "self death followed by leaving boundary";
const BEDWARS_TEAM_WIN_REASON = "owner team known and other teams were eliminated";

export function buildUnknownAudit(round) {
  if (!round || round.resultEligible === false || normalizeResult(round.result) !== "unknown") return null;
  const hint = round.resultHint ?? {};
  const category = classifyUnknownAuditCategory(round, hint);
  const nextAction = classifyUnknownAuditNextAction(round, hint, category);
  const priority = classifyUnknownAuditPriority(round, hint, category, nextAction);
  return {
    category,
    nextAction,
    reviewPriority: priority.value,
    reviewReason: priority.reason,
    features: buildUnknownAuditFeatures(round),
  };
}

export function ensureUnknownAudit(round) {
  if (!round || normalizeResult(round.result) !== "unknown") return null;
  const computed = buildUnknownAudit(round);
  if (!round.unknownAudit) return computed;
  const merged = {
    ...computed,
    ...round.unknownAudit,
    features: {
      ...(computed.features ?? {}),
      ...(round.unknownAudit.features ?? {}),
    },
  };
  if (!round.unknownAudit.reviewPriority || !round.unknownAudit.reviewReason) {
    const priority = classifyUnknownAuditPriority(round, round.resultHint ?? {}, merged.category, merged.nextAction);
    merged.reviewPriority = round.unknownAudit.reviewPriority ?? priority.value;
    merged.reviewReason = round.unknownAudit.reviewReason ?? priority.reason;
  }
  return merged;
}

export function buildUnknownAuditSummary(rounds, options = {}) {
  const rows = (rounds ?? [])
    .map((round) => ({ round, audit: ensureUnknownAudit(round) }))
    .filter((row) => row.audit);
  const exampleLimit = Number.isInteger(options.exampleLimit) ? options.exampleLimit : 50;
  return {
    total: rows.length,
    byCategory: countBy(rows, (row) => row.audit.category),
    byNextAction: countBy(rows, (row) => row.audit.nextAction),
    byPriority: countBy(rows, (row) => row.audit.reviewPriority ?? "low"),
    byMode: countBy(rows, (row) => row.audit.features.mode),
    policy: "Unknown audit is diagnostic only. It does not change round.result, ignoredReason, round splitting, or win/loss totals.",
    examples: buildUnknownAuditExamples(rows, exampleLimit),
  };
}

export function ensureUnknownAuditSummary(summary, rounds = []) {
  if (!summary || typeof summary !== "object") return buildUnknownAuditSummary(rounds);
  const computed = buildUnknownAuditSummary(rounds);
  return {
    ...computed,
    ...summary,
    byCategory: summary.byCategory ?? computed.byCategory,
    byNextAction: summary.byNextAction ?? computed.byNextAction,
    byPriority: summary.byPriority ?? computed.byPriority,
    byMode: summary.byMode ?? computed.byMode,
    examples: summary.examples ?? computed.examples,
  };
}

export function isAllowedUnknownAuditCategory(value) {
  return value === null || value === undefined || UNKNOWN_AUDIT_CATEGORY_SET.has(value);
}

export function isAllowedUnknownAuditNextAction(value) {
  return value === null || value === undefined || UNKNOWN_AUDIT_NEXT_ACTION_SET.has(value);
}

export function isAllowedUnknownAuditPriority(value) {
  return value === null || value === undefined || UNKNOWN_AUDIT_PRIORITY_SET.has(value);
}

function classifyUnknownAuditCategory(round, hint) {
  if (round.gameMode !== "bedwars") return "non_bedwars_remaining_unknown";
  if (hint.reason === BEDWARS_LOW_EVIDENCE_REASON) return "bedwars_low_evidence_pseudo_candidate";
  if (hint.reason === BEDWARS_SELF_DEATH_BOUNDARY_REASON || hint.value === "probably_loss") return "bedwars_self_death_boundary_review";
  if (hint.reason === BEDWARS_TEAM_WIN_REASON || hint.value === "probably_win") return "bedwars_team_win_low_confidence_review";
  return "bedwars_no_safe_result_evidence";
}

function classifyUnknownAuditNextAction(round, hint, category) {
  if (category === "bedwars_self_death_boundary_review") return "review_owner_identity";
  if (category === "bedwars_team_win_low_confidence_review") return "review_owner_identity";
  if (category === "bedwars_low_evidence_pseudo_candidate") return "label_sample";
  if (category === "bedwars_no_safe_result_evidence") return "label_sample";
  if (hint.reason === "unknown_mode_combat_fragment") return "review_rule_candidate";
  if (round.gameMode === unknownGameMode || hasCombatSignal(round)) return "review_rule_candidate";
  return "keep_unknown";
}

function classifyUnknownAuditPriority(round, hint, category, nextAction) {
  if (nextAction === "review_owner_identity") {
    return {
      value: "high",
      reason: "owner_identity_can_turn_existing_evidence_into_safe_result_or_keep_unknown",
    };
  }
  if (nextAction === "review_rule_candidate") {
    return {
      value: "medium",
      reason: "non_bedwars_or_unknown_mode_may_need_new_rule_but_requires_manual_pattern_review",
    };
  }
  if (category === "bedwars_low_evidence_pseudo_candidate") {
    return {
      value: "medium",
      reason: "likely_pseudo_round_can_reduce_noise_if_sample_confirms_ignore_policy",
    };
  }
  if (category === "bedwars_no_safe_result_evidence" && hasBedwarsAnchor(round)) {
    return {
      value: "medium",
      reason: "bedwars_unknown_has_gameplay_anchor_but_no_safe_result_evidence",
    };
  }
  if (hint.value === "probably_loss" || hint.value === "probably_win") {
    return {
      value: "medium",
      reason: "hint_suggests_possible_result_but_not_safe_without_review",
    };
  }
  return {
    value: "low",
    reason: "low_information_unknown_sample_for_batch_labeling",
  };
}

function buildUnknownAuditFeatures(round) {
  const resultEvidence = Array.isArray(round.resultEvidence) ? round.resultEvidence : [];
  const evidenceKinds = [...new Set(resultEvidence.map((item) => item?.kind).filter(Boolean))].sort();
  return {
    mode: round.gameMode ?? unknownGameMode,
    durationSeconds: Number.isFinite(round.durationSeconds) ? round.durationSeconds : null,
    endReason: round.endReason ?? null,
    ownerTeamKnown: Boolean(round.ownerTeam),
    selfAction: hasSelfAction(round),
    selfKills: round.selfKills ?? 0,
    selfDeaths: round.selfDeaths ?? 0,
    selfDeathSignals: round.selfDeathSignals ?? 0,
    selfBedDestroys: round.selfBedDestroys ?? 0,
    ownerBedDestroyed: Boolean(round.ownerBedDestroyed),
    ownerTeamEliminated: Boolean(round.ownerTeamEliminated),
    ownFinalDeaths: round.ownFinalDeaths ?? 0,
    teamElimination: hasObjectValues(round.teamEliminations),
    teamEliminations: objectKeysWithPositiveValues(round.teamEliminations),
    bedDestroyedTeams: objectKeysWithPositiveValues(round.bedDestroyedTeams),
    punishment: hasObjectValues(round.punishedPlayers),
    combat: {
      kills: round.kills ?? 0,
      deaths: round.deaths ?? 0,
      bedDestroys: round.bedDestroys ?? 0,
    },
    evidenceKinds,
    strongEvidenceKinds: [...new Set(resultEvidence.filter(isStrongResultEvidence).map((item) => item.kind).filter(Boolean))].sort(),
    resultHint: round.resultHint ? {
      value: round.resultHint.value ?? "keep_unknown",
      confidence: round.resultHint.confidence ?? "none",
      reason: round.resultHint.reason ?? "unknown",
    } : null,
  };
}

function hasBedwarsAnchor(round) {
  return Boolean(
    round.ownerTeam ||
    round.selfKills ||
    round.selfDeaths ||
    round.selfDeathSignals ||
    round.selfBedDestroys ||
    round.ownerBedDestroyed ||
    round.ownerTeamEliminated ||
    round.ownFinalDeaths ||
    hasObjectValues(round.teamEliminations) ||
    hasObjectValues(round.bedDestroyedTeams) ||
    hasObjectValues(round.punishedPlayers)
  );
}

function buildUnknownAuditExamples(rows, limit) {
  const examples = [];
  const seen = new Set();
  for (const row of rows) {
    if (examples.length >= limit) break;
    const key = `${row.audit.category}\0${row.audit.nextAction}`;
    const perBucket = examples.filter((example) => `${example.audit.category}\0${example.audit.nextAction}` === key).length;
    if (seen.has(key) && perBucket >= 5) continue;
    seen.add(key);
    examples.push({
      audit: row.audit,
      round: summarizeAuditRound(row.round),
    });
  }
  return examples;
}

function summarizeAuditRound(round) {
  return {
    startAt: round.startAt ?? null,
    endAt: round.endAt ?? null,
    durationSeconds: Number.isFinite(round.durationSeconds) ? round.durationSeconds : null,
    gameMode: round.gameMode ?? unknownGameMode,
    result: normalizeResult(round.result),
    resultHint: round.resultHint ?? null,
    startReason: round.startReason ?? null,
    endReason: round.endReason ?? null,
  };
}

function normalizeResult(result) {
  if (result === "not_applicable") return "not_applicable";
  return ["win", "loss", "ambiguous"].includes(result) ? result : "unknown";
}

function hasSelfAction(round) {
  return Boolean(round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys);
}

function hasCombatSignal(round) {
  return Boolean(round.kills || round.deaths || round.selfKills || round.selfDeaths || round.selfDeathSignals || round.selfBedDestroys);
}

function hasObjectValues(value) {
  return Object.values(value ?? {}).some((count) => Number(count) > 0);
}

function objectKeysWithPositiveValues(value) {
  return Object.entries(value ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key]) => key)
    .sort();
}

function isStrongResultEvidence(item) {
  return item?.result !== "unknown" && item?.confidence !== "low" && item?.confidence !== "ignored";
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
