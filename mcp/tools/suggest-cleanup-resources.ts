import type { GovernedResourceType } from "../core/governance/governance-state.js";
import { detectUsagePattern, shouldDeferCleanup, type UsagePattern } from "../core/resource/usage-pattern.js";

export interface ResourceActivitySnapshot {
  lastUsedAt?: string;
  firstSeenAt?: string;
}

export interface SuggestCleanupResourcesInput {
  now?: Date;
  daysUnused: number;
  limit: number;
  usage: Record<GovernedResourceType, Record<string, number>>;
  bugSignals: Record<GovernedResourceType, Record<string, number>>;
  catalogs: {
    skills: string[];
    presets: string[];
    customTools: string[];
  };
  activity: Record<GovernedResourceType, Record<string, ResourceActivitySnapshot>>;
}

export interface CleanupCandidate {
  resourceType: "skills" | "presets" | "tools";
  name: string;
  usageCount: number;
  bugSignals: number;
  lastUsedAt: string | null;
  firstSeenAt: string | null;
  daysSinceLastUse: number | null;
  daysSinceFirstSeen: number | null;
  reason: string;
  confidence: "low" | "medium" | "high";
  /** TASK-039: 使用パターン */
  usagePattern?: UsagePattern;
  /** TASK-039: パターン判定の補足 */
  patternRationale?: string;
}

export interface SuggestCleanupResourcesResult {
  generatedAt: string;
  thresholdDays: number;
  totalAnalyzed: {
    skills: number;
    presets: number;
    customTools: number;
  };
  candidates: CleanupCandidate[];
}

function toDaysSince(now: Date, iso?: string): number | null {
  if (!iso) {
    return null;
  }
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return null;
  }
  const diffMs = now.getTime() - ts;
  if (diffMs < 0) {
    return 0;
  }
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function buildCandidate(
  now: Date,
  thresholdDays: number,
  resourceType: "skills" | "presets" | "tools",
  name: string,
  usageCount: number,
  bugSignals: number,
  activity: ResourceActivitySnapshot
): CleanupCandidate | null {
  const daysSinceLastUse = toDaysSince(now, activity.lastUsedAt);
  const daysSinceFirstSeen = toDaysSince(now, activity.firstSeenAt);

  const staleByLastUse = daysSinceLastUse !== null && daysSinceLastUse >= thresholdDays;
  const staleByNeverUse =
    daysSinceLastUse === null &&
    usageCount <= 0 &&
    daysSinceFirstSeen !== null &&
    daysSinceFirstSeen >= thresholdDays;

  if (!staleByLastUse && !staleByNeverUse) {
    return null;
  }

  const reason = staleByLastUse
    ? `last used ${daysSinceLastUse} days ago`
    : `never used for ${daysSinceFirstSeen} days`;

  let confidence: CleanupCandidate["confidence"] = "low";
  if (usageCount <= 0 && staleByNeverUse) {
    confidence = "high";
  } else if (staleByLastUse && usageCount <= 1) {
    confidence = "high";
  } else if (staleByLastUse) {
    confidence = "medium";
  }

  // TASK-039: usage pattern を付加し、burst / daily は confidence を押さえる
  const patternResult = detectUsagePattern({
    firstSeenAt: activity.firstSeenAt ?? null,
    lastUsedAt: activity.lastUsedAt ?? null,
    usageCount,
    now
  });
  if (shouldDeferCleanup(patternResult.pattern) && confidence === "high") {
    confidence = "medium";
  } else if (shouldDeferCleanup(patternResult.pattern) && confidence === "medium") {
    confidence = "low";
  }

  return {
    resourceType,
    name,
    usageCount,
    bugSignals,
    lastUsedAt: activity.lastUsedAt ?? null,
    firstSeenAt: activity.firstSeenAt ?? null,
    daysSinceLastUse,
    daysSinceFirstSeen,
    reason,
    confidence,
    usagePattern: patternResult.pattern,
    patternRationale: patternResult.rationale
  };
}

export function suggestCleanupResources(input: SuggestCleanupResourcesInput): SuggestCleanupResourcesResult {
  const now = input.now ?? new Date();
  const thresholdDays = Math.max(1, Math.min(365, Math.floor(input.daysUnused)));
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));

  const candidates: CleanupCandidate[] = [];

  for (const skillName of input.catalogs.skills) {
    const candidate = buildCandidate(
      now,
      thresholdDays,
      "skills",
      skillName,
      input.usage.skills[skillName] ?? 0,
      input.bugSignals.skills[skillName] ?? 0,
      input.activity.skills[skillName] ?? {}
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const presetName of input.catalogs.presets) {
    const candidate = buildCandidate(
      now,
      thresholdDays,
      "presets",
      presetName,
      input.usage.presets[presetName] ?? 0,
      input.bugSignals.presets[presetName] ?? 0,
      input.activity.presets[presetName] ?? {}
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const toolName of input.catalogs.customTools) {
    const candidate = buildCandidate(
      now,
      thresholdDays,
      "tools",
      toolName,
      input.usage.tools[toolName] ?? 0,
      input.bugSignals.tools[toolName] ?? 0,
      input.activity.tools[toolName] ?? {}
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => {
    const da = a.daysSinceLastUse ?? a.daysSinceFirstSeen ?? 0;
    const db = b.daysSinceLastUse ?? b.daysSinceFirstSeen ?? 0;
    if (db !== da) {
      return db - da;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    generatedAt: now.toISOString(),
    thresholdDays,
    totalAnalyzed: {
      skills: input.catalogs.skills.length,
      presets: input.catalogs.presets.length,
      customTools: input.catalogs.customTools.length
    },
    candidates: candidates.slice(0, limit)
  };
}
