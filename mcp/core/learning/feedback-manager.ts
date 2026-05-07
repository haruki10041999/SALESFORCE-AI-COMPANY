/**
 * User feedback recording and retrieval for F-25
 */

import { promises as fsPromises } from "fs";
import { resolve, dirname } from "path";
import { randomUUID } from "crypto";
import type { UserFeedback, FeedbackMetrics } from "../types/feedback.js";
import { PostgresAnalyticsStore } from "../persistence/postgres-analytics-store.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";
import type { RewardAggregatorConfig } from "../types/feedback.js";
import { syncRewardsToFeedback, computeCompositeReward, getRewardStats } from "./reward-aggregator.js";
import { injectFailureContext, getRAGInjectionStats } from "./failure-memory-rag.js";

const FEEDBACK_JSONL_PATH = resolve("outputs", "learning", "feedback.jsonl");
const analyticsStorePromise = process.env.DATABASE_URL
  ? PostgresAnalyticsStore.open({ databaseUrl: process.env.DATABASE_URL }).catch(() => null)
  : Promise.resolve(null);

/**
 * Ensure outputs/learning directory exists
 */
async function ensureLearningDir(): Promise<void> {
  try {
    await fsPromises.mkdir(dirname(FEEDBACK_JSONL_PATH), { recursive: true });
  } catch {
    // directory already exists
  }
}

/**
 * Record a user feedback entry to outputs/learning/feedback.jsonl
 *
 * @param feedback - Feedback data (feedbackId will be auto-generated if not provided)
 */
export async function recordUserFeedback(feedback: Omit<UserFeedback, "feedbackId" | "timestamp">): Promise<UserFeedback> {
  const record: UserFeedback = {
    feedbackId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...feedback
  };

  const analyticsStore = await analyticsStorePromise;
  if (analyticsStore) {
    await analyticsStore.insertFeedback(record);
    return record;
  }

  await ensureLearningDir();

  try {
    await appendTextFileAtomic(FEEDBACK_JSONL_PATH, JSON.stringify(record) + "\n");
  } catch (error) {
    throw new Error(`Failed to record feedback: ${error instanceof Error ? error.message : String(error)}`);
  }

  return record;
}

/**
 * Load all feedback entries from outputs/learning/feedback.jsonl
 */
export async function loadAllFeedback(): Promise<UserFeedback[]> {
  const analyticsStore = await analyticsStorePromise;
  if (analyticsStore) {
    return analyticsStore.listFeedback();
  }

  try {
    const content = await fsPromises.readFile(FEEDBACK_JSONL_PATH, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as UserFeedback);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to load feedback: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load feedback for a specific session
 */
export async function loadFeedbackForSession(sessionId: string): Promise<UserFeedback[]> {
  const allFeedback = await loadAllFeedback();
  return allFeedback.filter((f) => f.sessionId === sessionId);
}

/**
 * Compute feedback metrics from all recorded feedback
 */
export async function computeFeedbackMetrics(filterSessionId?: string): Promise<FeedbackMetrics> {
  let allFeedback = await loadAllFeedback();
  if (filterSessionId) {
    allFeedback = allFeedback.filter((f) => f.sessionId === filterSessionId);
  }

  const thumbsUp = allFeedback.filter((f) => f.rating === "thumbs-up").length;
  const thumbsDown = allFeedback.filter((f) => f.rating === "thumbs-down").length;
  const neutral = allFeedback.filter((f) => f.rating === "neutral").length;
  const total = allFeedback.length;

  const qualityScores = allFeedback
    .map((f) => f.qualityScore)
    .filter((s) => typeof s === "number") as number[];
  const avgQuality = qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : undefined;

  // Tag frequency analysis
  const tagCounts = new Map<string, number>();
  allFeedback.forEach((f) => {
    if (f.tags) {
      f.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    }
  });
  const mostCommonTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalFeedback: total,
    thumbsUpCount: thumbsUp,
    thumbsDownCount: thumbsDown,
    neutralCount: neutral,
    thumbsUpRate: total > 0 ? thumbsUp / total : 0,
    averageQualityScore: avgQuality,
    mostCommonTags: mostCommonTags.length > 0 ? mostCommonTags : undefined
  };
}

/**
 * Integrate rewards into feedback system
 * Converts reward records to feedback and maintains unified record
 */
export async function integrateRewardsToFeedback(
  filterSessionId?: string,
  rewardConfig?: RewardAggregatorConfig
): Promise<{ feedbacks: UserFeedback[]; totalConverted: number }> {
  const feedbacks = await syncRewardsToFeedback(filterSessionId, rewardConfig);
  return {
    feedbacks,
    totalConverted: feedbacks.length
  };
}

/**
 * Get composite feedback metrics including reward-derived data
 */
export async function computeCompositeMetrics(
  filterSessionId?: string,
  rewardConfig?: RewardAggregatorConfig
): Promise<FeedbackMetrics & { compositeReward: number; rewardWeight: number }> {
  const baseFeedback = await computeFeedbackMetrics(filterSessionId);
  const composite = await computeCompositeReward(rewardConfig);

  return {
    ...baseFeedback,
    compositeReward: composite.composite,
    rewardWeight: composite.weight
  };
}

/**
 * Get reward health over a time window
 * Used to monitor learning signal strength
 */
export async function getRewardHealth(
  hours: number = 24
): Promise<{
  isHealthy: boolean;
  totalRewards: number;
  avgReward: number;
  positiveRate: number;
  warning?: string;
}> {
  const stats = await getRewardStats(hours);

  let warning: string | undefined;
  let isHealthy = true;

  if (stats.totalCount === 0) {
    isHealthy = false;
    warning = "No reward signals received in the time window";
  } else if (stats.positiveRate < 0.3) {
    warning = "Low positive reward rate - check system performance";
  } else if (stats.stdDev > 0.5) {
    warning = "High variance in rewards - consider stabilizing conditions";
  }

  return {
    isHealthy,
    totalRewards: stats.totalCount,
    avgReward: stats.avgReward,
    positiveRate: stats.positiveRate,
    warning
  };
}

/**
 * Inject failure memory context into prompt (RAG integration)
 * Searches for similar past errors and returns resolution guidance
 */
export async function injectFailureContextToPrompt(errorData: {
  code?: string;
  message: string;
  stack?: string;
  context?: {
    tool?: string;
    agent?: string;
    operation?: string;
    stage?: string;
  };
}): Promise<{
  hasContext: boolean;
  injectionPrompt: string;
  confidence: number;
  recommendationLevel: string;
  similarFailures: number;
}> {
  try {
    const result = await injectFailureContext(errorData);
    return {
      hasContext: result.similarFailures.length > 0,
      injectionPrompt: result.injectionPrompt,
      confidence: result.confidence,
      recommendationLevel: result.recommendationLevel,
      similarFailures: result.similarFailures.length
    };
  } catch {
    // Return empty context if injection fails
    return {
      hasContext: false,
      injectionPrompt: "",
      confidence: 0,
      recommendationLevel: "none",
      similarFailures: 0
    };
  }
}

/**
 * Get RAG injection monitoring statistics
 */
export async function getRAGStats(hours: number = 24): Promise<{
  totalInjections: number;
  successRate: number;
  avgConfidence: number;
  topErrors: Array<{
    code?: string;
    message: string;
    count: number;
  }>;
}> {
  const stats = await getRAGInjectionStats(hours);
  return {
    totalInjections: stats.totalInjections,
    successRate: stats.successRate,
    avgConfidence: stats.avgConfidence,
    topErrors: stats.topRecommendedErrors.map((e) => ({
      message: e.message,
      count: e.injectionCount
    }))
  };
}
