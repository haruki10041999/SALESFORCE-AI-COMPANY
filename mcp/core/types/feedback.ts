/**
 * User feedback types for F-25 task
 */

export type FeedbackRating = "thumbs-up" | "thumbs-down" | "neutral";

export interface UserFeedback {
  /** Unique feedback ID (UUID) */
  feedbackId: string;
  /** Associated chat session ID */
  sessionId: string;
  /** Associated agent name */
  agentName?: string;
  /** Thumbs up/down/neutral rating */
  rating: FeedbackRating;
  /** Optional comment from user */
  comment?: string;
  /** Timestamp when feedback was recorded (ISO 8601) */
  timestamp: string;
  /** Quality score of the response (0-1, optional) */
  qualityScore?: number;
  /** Tags for categorization */
  tags?: string[];
  /** User ID or anonymous marker */
  userId?: string;
}

export interface StarRatingFeedback {
  sessionId: string;
  toolName: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  tags?: string[];
}

export interface FeedbackMetrics {
  totalFeedback: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  neutralCount: number;
  thumbsUpRate: number;
  averageQualityScore?: number;
  mostCommonTags?: { tag: string; count: number }[];
}

/**
 * Automatic reward signals from multiple sources (tests, deployments, costs, errors)
 */
export interface RewardRecord {
  /** Unique ID for this reward record */
  rewardId: string;
  /** Source of the reward (test, deployment, token_cost, pr_readiness, error_recovery) */
  source: "test" | "deployment" | "token_cost" | "pr_readiness" | "error_recovery" | "custom";
  /** Associated session ID (optional) */
  sessionId?: string;
  /** Associated agent name (optional) */
  agentName?: string;
  /** Associated tool name (optional) */
  toolName?: string;
  /** Normalized reward signal (-1.0 to 1.0) */
  reward: number;
  /** Confidence of this reward (0.0 to 1.0) */
  confidence?: number;
  /** Raw metric that generated this reward (e.g., pass_rate, latency_ms, token_count) */
  rawMetric?: Record<string, unknown>;
  /** Human-readable reason for reward */
  reason?: string;
  /** Timestamp when reward was recorded (ISO 8601) */
  timestamp: string;
  /** Optional tags for aggregation */
  tags?: string[];
}

/**
 * Configuration for reward aggregator
 */
export interface RewardAggregatorConfig {
  /** Weight for test pass rate (0-1) */
  testWeight?: number;
  /** Weight for deployment success (0-1) */
  deploymentWeight?: number;
  /** Weight for token cost reduction (0-1) */
  tokenCostWeight?: number;
  /** Weight for PR readiness score (0-1) */
  prReadinessWeight?: number;
  /** Weight for error recovery rate (0-1) */
  errorRecoveryWeight?: number;
  /** Minimum number of samples before aggregating (default: 1) */
  minSamples?: number;
}
