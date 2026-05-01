/**
 * Policy mixer: combines agent graph learning, reputation, and contextual bandit
 * for intelligent agent selection in orchestration
 */

import { loadAgentReputationRecords, computeAgentReputationScore } from "./agent-reputation.js";
import { rankLinUcbArms, type LinUcbState } from "./lin-ucb-bandit.js";

export interface PolicyMixerInput {
  /** Candidate agent names */
  candidates: string[];
  /** Current session topic */
  topic: string;
  /** Previous agent in history */
  fromAgent?: string;
  /** Agent graph recommendation (optional) */
  graphRecommendation?: {
    agent: string;
    probability: number;
  };
  /** Current user ID (for reputation scoping) */
  user?: string;
  /** Current org ID (for reputation scoping) */
  org?: string;
  /** Bandit state from previous decisions (optional) */
  banditState?: LinUcbState;
  /** Whether to use graph learning (default: true) */
  useGraphLearning?: boolean;
  /** Whether to use bandit selection (default: true) */
  useBandit?: boolean;
  /** Whether to use reputation scores (default: true) */
  useReputation?: boolean;
  /** Weights for policy averaging */
  weights?: {
    graphWeight?: number;
    banditWeight?: number;
    reputationWeight?: number;
  };
}

export interface PolicyMixerOutput {
  selectedAgent: string;
  confidence: number;
  rationale: {
    graphScore?: number;
    banditScore?: number;
    reputationScore?: number;
    policyMix: string;
  };
  updatedBanditState?: LinUcbState;
}

/**
 * Select agent using policy mixer combining multiple signals
 */
export async function selectAgentWithPolicyMixer(
  input: PolicyMixerInput
): Promise<PolicyMixerOutput> {
  const {
    candidates,
    topic,
    fromAgent,
    graphRecommendation,
    user: userId,
    org: orgId,
    banditState: existingState,
    useGraphLearning = true,
    useBandit = true,
    useReputation = true,
    weights = {}
  } = input;

  const {
    graphWeight = 0.25,
    banditWeight = 0.35,
    reputationWeight = 0.4
  } = weights;

  if (candidates.length === 0) {
    throw new Error("No candidate agents provided");
  }

  // If only one candidate, return immediately
  if (candidates.length === 1) {
    return {
      selectedAgent: candidates[0],
      confidence: 1.0,
      rationale: { policyMix: "single_candidate" }
    };
  }

  const scores: Map<string, { graph: number; bandit: number; reputation: number; final: number }> =
    new Map();

  // Load reputation data
  const reputationRecords = await loadAgentReputationRecords("outputs/agent-reputation.jsonl");

  // Build a map of agent -> global reputation score
  const agentScores = new Map<string, number>();
  const agentNames = new Set(reputationRecords.filter((r) => r.scope === "global").map((r) => r.agentName));
  for (const agentName of agentNames) {
    const score = computeAgentReputationScore(reputationRecords, agentName, "global", "global", 0.5);
    agentScores.set(agentName, score);
  }

  // Initialize scores for all candidates
  for (const agent of candidates) {
    scores.set(agent, { graph: 0, bandit: 0, reputation: 0, final: 0 });
  }

  let selectedAgent = candidates[0];
  let finalConfidence = 0;
  const rationale: PolicyMixerOutput["rationale"] = { policyMix: "policy_mixer" };

  // --- Graph Learning Signal ---
  if (useGraphLearning && graphRecommendation) {
    const graphScore = graphRecommendation.probability;
    const matching = candidates.find((c) => c === graphRecommendation.agent);
    if (matching) {
      scores.get(matching)!.graph = graphScore;
      rationale.graphScore = graphScore;
    }
  }

  // --- Reputation Signal ---
  if (useReputation) {
    let maxRepScore = -Infinity;
    for (const agent of candidates) {
      const agentScore = agentScores.get(agent) ?? 0.5;
      scores.get(agent)!.reputation = agentScore;
      if (agentScore > maxRepScore) {
        maxRepScore = agentScore;
      }
    }
    rationale.reputationScore = maxRepScore;
  }

  // --- Contextual Bandit Signal (simplified) ---
  if (useBandit && existingState) {
    // Use LinUCB state to rank arms
    const inputs = candidates.map((agent) => ({
      name: agent,
      features: [agentScores.get(agent) ?? 0.5]
    }));

    const rankResult = rankLinUcbArms(existingState, inputs, 1.0, 1);

    if (rankResult.length > 0) {
      const topArm = rankResult[0];
      scores.get(topArm.name)!.bandit = topArm.score;
      rationale.banditScore = topArm.score;
    }
  }

  // --- Final Policy Mix ---
  let maxScore = -Infinity;
  for (const [agent, scoreData] of scores.entries()) {
    const mixedScore =
      scoreData.graph * graphWeight +
      scoreData.bandit * banditWeight +
      scoreData.reputation * reputationWeight;

    scoreData.final = mixedScore;

    if (mixedScore > maxScore) {
      maxScore = mixedScore;
      selectedAgent = agent;
      finalConfidence = mixedScore;
    }
  }

  // Normalize confidence to [0, 1]
  finalConfidence = Math.max(0, Math.min(1, finalConfidence));

  return {
    selectedAgent,
    confidence: finalConfidence,
    rationale,
    updatedBanditState: existingState
  };
}

/**
 * Compute agent selection metrics for a batch of decisions
 */
export async function analyzeSelectionMetrics(
  decisions: Array<{
    selectedAgent: string;
    candidates: string[];
    outcome: "success" | "failure" | "neutral";
  }>
): Promise<{
  successRate: number;
  avgDecisionQuality: number;
  topPerformingAgents: Array<{ agent: string; score: number }>;
  topCandidateSizes: Map<number, number>; // Distribution of candidate set sizes
}> {
  const successCount = decisions.filter((d) => d.outcome === "success").length;
  const successRate = decisions.length > 0 ? successCount / decisions.length : 0;

  const agentScores = new Map<string, { count: number; successes: number }>();
  const candidateSizeDistribution = new Map<number, number>();

  for (const decision of decisions) {
    const size = decision.candidates.length;
    candidateSizeDistribution.set(size, (candidateSizeDistribution.get(size) ?? 0) + 1);

    if (!agentScores.has(decision.selectedAgent)) {
      agentScores.set(decision.selectedAgent, { count: 0, successes: 0 });
    }

    const stats = agentScores.get(decision.selectedAgent)!;
    stats.count += 1;
    if (decision.outcome === "success") {
      stats.successes += 1;
    }
  }

  const topPerformingAgents = Array.from(agentScores.entries())
    .map(([agent, stats]) => ({
      agent,
      score: stats.count > 0 ? stats.successes / stats.count : 0
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    successRate,
    avgDecisionQuality: successRate, // Simplified; could be more sophisticated
    topPerformingAgents,
    topCandidateSizes: candidateSizeDistribution
  };
}
