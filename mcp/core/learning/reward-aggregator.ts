/**
 * Automatic reward aggregation from multiple sources
 * Collects signals from tests, deployments, token costs, PR readiness, and error recovery
 * Feeds them into feedback-manager for learning loop
 */

import { promises as fsPromises } from "fs";
import { resolve, dirname } from "path";
import { randomUUID } from "crypto";
import type { RewardRecord, RewardAggregatorConfig, UserFeedback } from "../types/feedback.js";
import { recordUserFeedback, loadAllFeedback } from "./feedback-manager.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

const REWARD_JSONL_PATH = resolve("outputs", "learning", "rewards.jsonl");

/**
 * Default reward aggregator configuration
 */
const DEFAULT_CONFIG: Required<RewardAggregatorConfig> = {
  testWeight: 0.3,
  deploymentWeight: 0.25,
  tokenCostWeight: 0.15,
  prReadinessWeight: 0.2,
  errorRecoveryWeight: 0.1,
  minSamples: 1
};

/**
 * Ensure outputs/learning directory exists
 */
async function ensureLearningDir(): Promise<void> {
  try {
    await fsPromises.mkdir(dirname(REWARD_JSONL_PATH), { recursive: true });
  } catch {
    // directory already exists
  }
}

/**
 * Record a reward signal to outputs/learning/rewards.jsonl
 */
export async function recordReward(
  reward: Omit<RewardRecord, "rewardId" | "timestamp">
): Promise<RewardRecord> {
  await ensureLearningDir();

  const record: RewardRecord = {
    rewardId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...reward,
    confidence: reward.confidence ?? 1.0
  };

  try {
    await appendTextFileAtomic(REWARD_JSONL_PATH, JSON.stringify(record) + "\n");
  } catch (error) {
    throw new Error(`Failed to record reward: ${error instanceof Error ? error.message : String(error)}`);
  }

  return record;
}

/**
 * Load all reward records from outputs/learning/rewards.jsonl
 */
export async function loadAllRewards(): Promise<RewardRecord[]> {
  try {
    const content = await fsPromises.readFile(REWARD_JSONL_PATH, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RewardRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to load rewards: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load rewards for a specific session
 */
export async function loadRewardsForSession(sessionId: string): Promise<RewardRecord[]> {
  const allRewards = await loadAllRewards();
  return allRewards.filter((r) => r.sessionId === sessionId);
}

/**
 * Load rewards for a specific agent
 */
export async function loadRewardsForAgent(agentName: string): Promise<RewardRecord[]> {
  const allRewards = await loadAllRewards();
  return allRewards.filter((r) => r.agentName === agentName);
}

/**
 * Load rewards for a specific tool
 */
export async function loadRewardsForTool(toolName: string): Promise<RewardRecord[]> {
  const allRewards = await loadAllRewards();
  return allRewards.filter((r) => r.toolName === toolName);
}

/**
 * Aggregate rewards by source and compute statistics
 */
export async function aggregateRewardsBySource(
  config: RewardAggregatorConfig = {}
): Promise<Map<string, { avgReward: number; count: number; confidence: number }>> {
  const allRewards = await loadAllRewards();
  const merged = { ...DEFAULT_CONFIG, ...config };

  const sourceStats = new Map<string, { sum: number; count: number; confidences: number[] }>();

  for (const reward of allRewards) {
    if (!sourceStats.has(reward.source)) {
      sourceStats.set(reward.source, { sum: 0, count: 0, confidences: [] });
    }
    const stats = sourceStats.get(reward.source)!;
    stats.sum += reward.reward;
    stats.count += 1;
    stats.confidences.push(reward.confidence ?? 1.0);
  }

  const result = new Map<string, { avgReward: number; count: number; confidence: number }>();
  for (const [source, stats] of sourceStats.entries()) {
    if (stats.count >= merged.minSamples) {
      result.set(source, {
        avgReward: stats.sum / stats.count,
        count: stats.count,
        confidence: stats.confidences.reduce((a, b) => a + b, 0) / stats.confidences.length
      });
    }
  }

  return result;
}

/**
 * Compute weighted composite reward from all sources
 */
export async function computeCompositeReward(
  config: RewardAggregatorConfig = {}
): Promise<{ composite: number; details: Map<string, number>; weight: number }> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const stats = await aggregateRewardsBySource(config);

  const details = new Map<string, number>();
  let weightedSum = 0;
  let totalWeight = 0;

  const weightMap: Record<string, number> = {
    test: merged.testWeight,
    deployment: merged.deploymentWeight,
    token_cost: merged.tokenCostWeight,
    pr_readiness: merged.prReadinessWeight,
    error_recovery: merged.errorRecoveryWeight,
    custom: 0.0
  };

  for (const [source, sourceStats] of stats.entries()) {
    const weight = weightMap[source] ?? 0;
    weightedSum += sourceStats.avgReward * weight * sourceStats.confidence;
    totalWeight += weight * sourceStats.confidence;
    details.set(source, sourceStats.avgReward);
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    composite: Math.max(-1, Math.min(1, composite)), // Normalize to [-1, 1]
    details,
    weight: Math.min(1, totalWeight)
  };
}

/**
 * Sync rewards to feedback records for integration with feedback-manager
 * Creates UserFeedback entries from RewardRecords
 */
export async function syncRewardsToFeedback(
  filterSessionId?: string,
  _config: RewardAggregatorConfig = {}
): Promise<UserFeedback[]> {
  let allRewards = await loadAllRewards();

  if (filterSessionId) {
    allRewards = allRewards.filter((r) => r.sessionId === filterSessionId);
  }

  // Build set of already-converted rewardIds from existing feedback tags
  const existingFeedback = await loadAllFeedback();
  const convertedIds = new Set<string>();
  for (const fb of existingFeedback) {
    for (const tag of fb.tags ?? []) {
      if (tag.startsWith("reward:")) {
        convertedIds.add(tag.slice("reward:".length));
      }
    }
  }

  const feedbacks: UserFeedback[] = [];

  for (const reward of allRewards) {
    // Skip if already converted (check by rewardId in existing feedback tags)
    if (convertedIds.has(reward.rewardId)) {
      continue;
    }

    const feedback = await recordUserFeedback({
      sessionId: reward.sessionId || "auto",
      agentName: reward.agentName,
      rating: reward.reward > 0.2 ? "thumbs-up" : reward.reward < -0.2 ? "thumbs-down" : "neutral",
      qualityScore: (reward.reward + 1) / 2, // Normalize to [0, 1]
      comment: reward.reason,
      tags: [
        `source:${reward.source}`,
        `tool:${reward.toolName || "unknown"}`,
        `reward:${reward.rewardId}`
      ]
    });

    feedbacks.push(feedback);
  }

  return feedbacks;
}

/**
 * Compute reward statistics over a time window
 */
export async function getRewardStats(
  hours: number = 24,
  source?: string
): Promise<{
  totalCount: number;
  avgReward: number;
  minReward: number;
  maxReward: number;
  stdDev: number;
  positiveRate: number;
}> {
  const now = Date.now();
  const windowMs = hours * 60 * 60 * 1000;

  let allRewards = await loadAllRewards();
  allRewards = allRewards.filter((r) => {
    const recordTime = new Date(r.timestamp).getTime();
    return now - recordTime <= windowMs;
  });

  if (source) {
    allRewards = allRewards.filter((r) => r.source === source);
  }

  if (allRewards.length === 0) {
    return {
      totalCount: 0,
      avgReward: 0,
      minReward: 0,
      maxReward: 0,
      stdDev: 0,
      positiveRate: 0
    };
  }

  const rewards = allRewards.map((r) => r.reward);
  const sum = rewards.reduce((a, b) => a + b, 0);
  const avg = sum / rewards.length;
  const variance = rewards.reduce((sq, r) => sq + Math.pow(r - avg, 2), 0) / rewards.length;

  return {
    totalCount: rewards.length,
    avgReward: avg,
    minReward: Math.min(...rewards),
    maxReward: Math.max(...rewards),
    stdDev: Math.sqrt(variance),
    positiveRate: rewards.filter((r) => r > 0).length / rewards.length
  };
}
