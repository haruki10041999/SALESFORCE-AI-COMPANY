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
