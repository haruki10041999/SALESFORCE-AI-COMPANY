type ConfidenceLevel = "low" | "medium" | "high";

export interface ConfidenceSnapshot {
  level: ConfidenceLevel;
  topScore: number;
  secondScore: number;
  scoreGap: number;
  relativeGap: number;
  signalCount: number;
}

export interface ResourceScoreExplanation {
  matchedTokens: string[];
  unmatchedTokens: string[];
  matchedFields: string[];
  fieldMatches: Array<{
    field: string;
    matchedTokens: string[];
    hitCount: number;
  }>;
  coverage: {
    matchedTokenCount: number;
    totalTokenCount: number;
    ratio: number;
  };
  scores: {
    base: number;
    final: number;
    delta: number;
    feedbackMultiplier?: number;
    incrementalMultiplier?: number;
  };
  score: number;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_\-\u3040-\u30ff\u4e00-\u9faf]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function buildResourceScoreExplanation(
  params: {
    query: string;
    baseScore: number;
    finalScore: number;
    fields: Record<string, string | undefined>;
    feedbackMultiplier?: number;
    incrementalMultiplier?: number;
  }
): ResourceScoreExplanation {
  const { query, baseScore, finalScore, fields, feedbackMultiplier, incrementalMultiplier } = params;
  const tokens = [...new Set(tokenizeQuery(query))];
  const matchedTokenSet = new Set<string>();
  const matchedFieldSet = new Set<string>();
  const fieldMatches: Array<{ field: string; matchedTokens: string[]; hitCount: number }> = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) continue;
    const normalized = value.toLowerCase();
    const matchedTokens = tokens.filter((token) => normalized.includes(token));
    if (matchedTokens.length === 0) continue;
    fieldMatches.push({
      field: fieldName,
      matchedTokens,
      hitCount: matchedTokens.length
    });
    matchedFieldSet.add(fieldName);
    for (const token of matchedTokens) {
      matchedTokenSet.add(token);
    }
  }

  const matchedTokens = [...matchedTokenSet];
  const unmatchedTokens = tokens.filter((token) => !matchedTokenSet.has(token));
  const matchedTokenCount = matchedTokens.length;
  const totalTokenCount = tokens.length;
  const coverageRatio = totalTokenCount > 0 ? matchedTokenCount / totalTokenCount : 0;
  const roundedBase = Number(baseScore.toFixed(3));
  const roundedFinal = Number(finalScore.toFixed(3));

  return {
    matchedTokens,
    unmatchedTokens,
    matchedFields: [...matchedFieldSet],
    fieldMatches,
    coverage: {
      matchedTokenCount,
      totalTokenCount,
      ratio: Number(coverageRatio.toFixed(3))
    },
    scores: {
      base: roundedBase,
      final: roundedFinal,
      delta: Number((roundedFinal - roundedBase).toFixed(3)),
      feedbackMultiplier: feedbackMultiplier === undefined ? undefined : Number(feedbackMultiplier.toFixed(3)),
      incrementalMultiplier: incrementalMultiplier === undefined ? undefined : Number(incrementalMultiplier.toFixed(3))
    },
    score: roundedFinal
  };
}

function buildConfidenceSnapshot(scores: number[]): ConfidenceSnapshot {
  const ranked = [...scores]
    .filter((score) => Number.isFinite(score) && score > 0)
    .sort((a, b) => b - a);

  const topScore = ranked[0] ?? 0;
  const secondScore = ranked[1] ?? 0;
  const scoreGap = Math.max(0, topScore - secondScore);
  const relativeGap = topScore > 0 ? scoreGap / topScore : 0;

  if (topScore <= 0) {
    return {
      level: "low",
      topScore,
      secondScore,
      scoreGap,
      relativeGap,
      signalCount: ranked.length
    };
  }

  if (ranked.length <= 1) {
    return {
      level: "medium",
      topScore,
      secondScore,
      scoreGap,
      relativeGap,
      signalCount: ranked.length
    };
  }

  if (relativeGap < 0.15) {
    return {
      level: "low",
      topScore,
      secondScore,
      scoreGap,
      relativeGap,
      signalCount: ranked.length
    };
  }

  if (relativeGap < 0.35) {
    return {
      level: "medium",
      topScore,
      secondScore,
      scoreGap,
      relativeGap,
      signalCount: ranked.length
    };
  }

  return {
    level: "high",
    topScore,
    secondScore,
    scoreGap,
    relativeGap,
    signalCount: ranked.length
  };
}

export function evaluateAutoSelectionConfidence(params: {
  skills: Array<{ score: number }>;
  tools: Array<{ score: number }>;
  presets: Array<{ score: number }>;
}): ConfidenceSnapshot {
  return buildConfidenceSnapshot([
    ...params.skills.map((row) => row.score),
    ...params.tools.map((row) => row.score),
    ...params.presets.map((row) => row.score)
  ]);
}
