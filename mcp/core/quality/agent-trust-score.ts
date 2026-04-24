export interface AgentTrustFactors {
  adoptionRate: number;
  feedbackScore: number;
  contextMatch: number;
}

export interface AgentTrustEvaluation {
  score: number;
  threshold: number;
  belowThreshold: boolean;
  factors: AgentTrustFactors;
  reasons: string[];
}

export interface AgentTrustHistory {
  accepted: number;
  rejected: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u3040-\u30ff\u3400-\u9fff\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function computeContextMatchScore(topic: string, message: string): number {
  const topicTokens = new Set(normalize(topic));
  const messageTokens = normalize(message);

  if (topicTokens.size === 0 || messageTokens.length === 0) {
    return 0;
  }

  let hitCount = 0;
  for (const token of messageTokens) {
    if (topicTokens.has(token)) {
      hitCount += 1;
    }
  }

  return clamp(hitCount / messageTokens.length, 0, 1);
}

export function computeAdoptionRate(history: AgentTrustHistory): number {
  const accepted = Math.max(0, history.accepted);
  const rejected = Math.max(0, history.rejected);
  const total = accepted + rejected;

  if (total === 0) {
    return 0.5;
  }

  // Laplace smoothing to avoid extreme swings in early turns.
  return clamp((accepted + 1) / (total + 2), 0, 1);
}

export function computeFeedbackScore(feedbackSignal: number): number {
  // feedbackSignal expected range: -1..1, converted to 0..1.
  return clamp((feedbackSignal + 1) / 2, 0, 1);
}

export function evaluateAgentTrust(params: {
  topic: string;
  message: string;
  history: AgentTrustHistory;
  feedbackSignal?: number;
  threshold: number;
}): AgentTrustEvaluation {
  const adoptionRate = computeAdoptionRate(params.history);
  const feedbackScore = computeFeedbackScore(params.feedbackSignal ?? 0);
  const contextMatch = computeContextMatchScore(params.topic, params.message);

  const score = clamp(
    adoptionRate * 0.4 + feedbackScore * 0.3 + contextMatch * 0.3,
    0,
    1
  );

  const reasons = [
    `adoptionRate=${adoptionRate.toFixed(2)}`,
    `feedbackScore=${feedbackScore.toFixed(2)}`,
    `contextMatch=${contextMatch.toFixed(2)}`,
    `threshold=${params.threshold.toFixed(2)}`
  ];

  return {
    score,
    threshold: params.threshold,
    belowThreshold: score < params.threshold,
    factors: {
      adoptionRate,
      feedbackScore,
      contextMatch
    },
    reasons
  };
}

export function rankEscalationCandidates(
  candidates: string[],
  topic: string,
  message: string,
  excludedAgents: string[]
): string[] {
  const excluded = new Set(excludedAgents);
  return candidates
    .filter((candidate) => !excluded.has(candidate))
    .map((candidate) => ({
      name: candidate,
      score: computeContextMatchScore(`${topic} ${candidate}`, message)
    }))
    .sort((a, b) => b.score - a.score)
    .map((row) => row.name);
}
