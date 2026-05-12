import { starToRating } from "./analytics-formatters.js";

export interface RecordUserFeedbackInput {
  sessionId: string;
  agentName?: string;
  rating: "thumbs-up" | "thumbs-down" | "neutral";
  comment?: string;
  qualityScore?: number;
  tags?: string[];
}

export function buildRateToolExecutionFeedbackInput(args: {
  toolName: string;
  stars: number;
  sessionId?: string;
  comment?: string;
  tags?: string[];
}): RecordUserFeedbackInput {
  return {
    sessionId: args.sessionId ?? `tool:${args.toolName}`,
    agentName: args.toolName,
    rating: starToRating(args.stars),
    comment: args.comment,
    qualityScore: Number(((args.stars - 1) / 4).toFixed(2)),
    tags: ["tool-execution", `stars:${args.stars}`, ...(args.tags ?? [])]
  };
}

export function buildRateToolExecutionResponse(args: {
  feedbackId: string;
  toolName: string;
  stars: number;
  normalizedRating: "thumbs-up" | "thumbs-down" | "neutral";
  qualityScore?: number;
  timestamp: string;
}): Record<string, unknown> {
  return {
    success: true,
    feedbackId: args.feedbackId,
    toolName: args.toolName,
    stars: args.stars,
    normalizedRating: args.normalizedRating,
    qualityScore: args.qualityScore,
    timestamp: args.timestamp
  };
}

export function buildRecordUserFeedbackResponse(args: {
  feedbackId: string;
  timestamp: string;
}): Record<string, unknown> {
  return {
    success: true,
    feedbackId: args.feedbackId,
    timestamp: args.timestamp
  };
}

export function buildSessionFeedbackResponse(args: {
  sessionId: string;
  feedback: unknown[];
}): Record<string, unknown> {
  return {
    sessionId: args.sessionId,
    feedbackCount: args.feedback.length,
    records: args.feedback
  };
}