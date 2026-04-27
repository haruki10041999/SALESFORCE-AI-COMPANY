/**
 * User feedback recording and retrieval for F-25
 */

import { promises as fsPromises } from "fs";
import { resolve, dirname } from "path";
import { randomUUID } from "crypto";
import type { UserFeedback, FeedbackMetrics } from "../types/feedback.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

const FEEDBACK_JSONL_PATH = resolve("outputs", "learning", "feedback.jsonl");

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
  await ensureLearningDir();

  const record: UserFeedback = {
    feedbackId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...feedback
  };

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
