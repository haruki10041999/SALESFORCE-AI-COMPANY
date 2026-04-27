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

export interface FeedbackMetrics {
  totalFeedback: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  neutralCount: number;
  thumbsUpRate: number;
  averageQualityScore?: number;
  mostCommonTags?: { tag: string; count: number }[];
}
