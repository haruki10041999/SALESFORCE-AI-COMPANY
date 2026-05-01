function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

type ResourceType = "skills" | "tools" | "presets";

type ScoringConfigOverride = Partial<{
  exactNameMatchWeight: number;
  nameContainWeight: number;
  tokenMatchWeight: number;
  tagMatchWeight: number;
  descriptionMatchWeight: number;
  usageWeight: number;
  bugPenaltyWeight: number;
  recencyBonusWeight: number;
  dayWindow: number;
  gapThreshold: number;
  embeddingMode: "off" | "hybrid";
  embeddingAlpha: number;
}>;

type RubricCriterionOverride = Partial<{
  label: string;
  description: string;
  weight: number;
}>;

export type ResourceScoringOverrideByAgent = Record<
  string,
  Partial<Record<ResourceType, ScoringConfigOverride>>
>;

export type RubricCriteriaOverrideByAgent = Record<string, Record<string, RubricCriterionOverride>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeScoringConfigOverride(value: unknown): ScoringConfigOverride | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const out: ScoringConfigOverride = {};
  const numericKeys: Array<keyof ScoringConfigOverride> = [
    "exactNameMatchWeight",
    "nameContainWeight",
    "tokenMatchWeight",
    "tagMatchWeight",
    "descriptionMatchWeight",
    "usageWeight",
    "bugPenaltyWeight",
    "recencyBonusWeight",
    "dayWindow",
    "gapThreshold",
    "embeddingAlpha"
  ];
  for (const key of numericKeys) {
    const v = value[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      (out as Record<string, number | "off" | "hybrid">)[key] = v;
    }
  }
  if (value.embeddingMode === "off" || value.embeddingMode === "hybrid") {
    out.embeddingMode = value.embeddingMode;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseResourceScoringOverrideByAgent(value: string | undefined): ResourceScoringOverrideByAgent {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const out: ResourceScoringOverrideByAgent = {};
    for (const [agentName, perType] of Object.entries(parsed)) {
      if (!isPlainObject(perType)) {
        continue;
      }
      const byType: Partial<Record<ResourceType, ScoringConfigOverride>> = {};
      for (const resourceType of ["skills", "tools", "presets"] as const) {
        const sanitized = sanitizeScoringConfigOverride(perType[resourceType]);
        if (sanitized) {
          byType[resourceType] = sanitized;
        }
      }
      if (Object.keys(byType).length > 0) {
        out[agentName] = byType;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function sanitizeRubricCriterionOverride(value: unknown): RubricCriterionOverride | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const out: RubricCriterionOverride = {};
  if (typeof value.label === "string") {
    out.label = value.label;
  }
  if (typeof value.description === "string") {
    out.description = value.description;
  }
  if (typeof value.weight === "number" && Number.isFinite(value.weight) && value.weight >= 0) {
    out.weight = value.weight;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseRubricCriteriaOverrideByAgent(value: string | undefined): RubricCriteriaOverrideByAgent {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const out: RubricCriteriaOverrideByAgent = {};
    for (const [agentName, criteria] of Object.entries(parsed)) {
      if (!isPlainObject(criteria)) {
        continue;
      }
      const perCriterion: Record<string, RubricCriterionOverride> = {};
      for (const [criterionId, criterionOverride] of Object.entries(criteria)) {
        const sanitized = sanitizeRubricCriterionOverride(criterionOverride);
        if (sanitized) {
          perCriterion[criterionId] = sanitized;
        }
      }
      if (Object.keys(perCriterion).length > 0) {
        out[agentName] = perCriterion;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getLowRelevanceScoreThreshold(): number {
  return parsePositiveInt(
    process.env.AI_LOW_RELEVANCE_THRESHOLD ?? process.env.LOW_RELEVANCE_SCORE_THRESHOLD,
    6
  );
}

export function getPromptCacheMaxEntries(): number {
  return parsePositiveInt(
    process.env.AI_PROMPT_CACHE_MAX_ENTRIES ?? process.env.PROMPT_CACHE_MAX_ENTRIES,
    100
  );
}

export function getPromptCacheTtlSeconds(): number {
  return parsePositiveInt(
    process.env.AI_PROMPT_CACHE_TTL_SECONDS ?? process.env.PROMPT_CACHE_TTL_SECONDS,
    600  // 10 minutes (previously 60 seconds)
  );
}

export function getAgentTrustScoringEnabled(): boolean {
  return parseBoolean(
    process.env.AI_AGENT_TRUST_SCORING_ENABLED ?? process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED,
    false
  );
}

export function getAgentTrustThreshold(): number {
  return parseRatio(
    process.env.AI_AGENT_TRUST_THRESHOLD ?? process.env.SF_AI_AGENT_TRUST_THRESHOLD,
    0.55
  );
}

export function getResourceScoringOverrideByAgent(): ResourceScoringOverrideByAgent {
  return parseResourceScoringOverrideByAgent(
    process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT ?? process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT
  );
}

export function getRubricCriteriaOverrideByAgent(): RubricCriteriaOverrideByAgent {
  return parseRubricCriteriaOverrideByAgent(
    process.env.AI_RUBRIC_CRITERIA_BY_AGENT ?? process.env.SF_AI_RUBRIC_CRITERIA_BY_AGENT
  );
}
