/**
 * Failure Memory RAG Injection
 * Retrieves similar past errors and injects solutions into prompts
 */

import { promises as fsPromises } from "fs";
import { resolve } from "path";
import type { FailureMemoryEntry } from "../../../memory/failure-memory.js";
import { listFailureMemory } from "../../../memory/failure-memory.js";
import { OutputsArtifactWriter } from "../persistence/outputs-artifact-writer.js";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../config/runtime-config.js";

const RAG_INJECTION_CACHE_PATH = resolve("outputs", "learning", "rag-injection-cache.jsonl");
const artifactWriter = new OutputsArtifactWriter({
  outputsDir: resolve(getOutputsDir()),
  databaseUrl: getPrimaryDatabaseUrl()
});

export interface ErrorSignature {
  code?: string;
  messageKeywords: string[];
  stackPatterns: string[];
  context: {
    tool?: string;
    agent?: string;
    operation?: string;
    stage?: string;
  };
}

export interface SimilarFailure {
  record: FailureMemoryEntry;
  relevanceScore: number;
  tagMatchCount: number;
  recencyScore: number;
}

export interface RAGInjectionResult {
  errorSignature: ErrorSignature;
  similarFailures: SimilarFailure[];
  injectionPrompt: string;
  confidence: number;
  recommendationLevel: "critical" | "high" | "medium" | "low" | "none";
  timestamp: string;
}

export function extractErrorSignature(errorData: {
  code?: string;
  message: string;
  stack?: string;
  context?: {
    tool?: string;
    agent?: string;
    operation?: string;
    stage?: string;
  };
}): ErrorSignature {
  const messageKeywords = errorData.message
    .toLowerCase()
    .split(/[\s\-_().,;:!?]+/)
    .filter((w: string) => w.length > 3 && !["error", "failed", "unable", "could"].includes(w))
    .slice(0, 5);

  const stackPatterns: string[] = [];
  if (errorData.stack) {
    const stackLines = errorData.stack.split("\n");
    stackLines.slice(0, 3).forEach((line: string) => {
      const match = line.match(/at\s+([^\s]+)\s+\(/);
      if (match) {
        stackPatterns.push(match[1].split("/").pop() || match[1]);
      }
    });
  }

  return {
    code: errorData.code,
    messageKeywords,
    stackPatterns,
    context: errorData.context || {}
  };
}

export function calculateErrorSimilarity(
  errorSignature: ErrorSignature,
  failureEntry: FailureMemoryEntry
): number {
  let score = 0;
  let maxScore = 0;

  const patternKeywords = failureEntry.pattern
    .toLowerCase()
    .split(/[\s\-_().,;:!?]+/)
    .filter((w: string) => w.length > 2);

  maxScore += 3;
  if (errorSignature.messageKeywords.length > 0 && patternKeywords.length > 0) {
    const overlap = errorSignature.messageKeywords.filter((k: string) => patternKeywords.includes(k)).length;
    const minLen = Math.min(errorSignature.messageKeywords.length, patternKeywords.length);
    score += (overlap / Math.max(1, minLen)) * 3;
  }

  maxScore += 2;
  if (failureEntry.tags.length > 0) {
    const contextTags = [
      errorSignature.context.tool,
      errorSignature.context.agent,
      errorSignature.context.operation,
      errorSignature.context.stage
    ].filter((t) => !!t) as string[];

    const tagMatches = contextTags.filter((t: string) =>
      failureEntry.tags.some((ft: string) => ft.includes(t) || t.includes(ft))
    );
    score += (tagMatches.length / Math.max(1, failureEntry.tags.length)) * 2;
  }

  maxScore += 2;
  if (failureEntry.reason && failureEntry.preventiveAction) {
    if (failureEntry.reason.toLowerCase().includes("error") || failureEntry.reason.toLowerCase().includes("fail")) {
      score += 1;
    }
    if (
      failureEntry.preventiveAction.toLowerCase().includes("solution") ||
      failureEntry.preventiveAction.toLowerCase().includes("fix")
    ) {
      score += 1;
    }
  }

  return maxScore > 0 ? score / maxScore : 0;
}

export async function searchSimilarFailures(errorSignature: ErrorSignature, topK: number = 5): Promise<SimilarFailure[]> {
  const matches = await listFailureMemory(200);

  const scored = matches.map((entry: FailureMemoryEntry): { record: FailureMemoryEntry; relevanceScore: number; tagMatchCount: number; recencyScore: number } => {
    const similarity = calculateErrorSimilarity(errorSignature, entry);
    const contextTags = [
      errorSignature.context.tool,
      errorSignature.context.agent,
      errorSignature.context.operation,
      errorSignature.context.stage
    ].filter((t) => !!t) as string[];

    const tagMatchCount = contextTags.filter((t: string) =>
      entry.tags.some((ft: string) => ft.includes(t) || t.includes(ft))
    ).length;

    const ageMs = Date.now() - new Date(entry.recordedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const recencyScore = Math.max(0, 1 - ageDays / 30);

    return {
      record: entry,
      relevanceScore: similarity,
      tagMatchCount,
      recencyScore
    };
  });

  scored.sort((a: SimilarFailure, b: SimilarFailure) => {
    const scoreA = a.relevanceScore * (0.7 + 0.3 * a.recencyScore);
    const scoreB = b.relevanceScore * (0.7 + 0.3 * b.recencyScore);
    return scoreB - scoreA;
  });

  return scored.slice(0, topK);
}

export function generateRAGInjectionPrompt(similarFailures: SimilarFailure[]): {
  prompt: string;
  confidence: number;
} {
  if (similarFailures.length === 0) {
    return { prompt: "", confidence: 0 };
  }

  const topMatches = similarFailures.slice(0, 3);
  const sections: string[] = [];

  const highRelevance = topMatches.filter((f) => f.relevanceScore > 0.7);
  if (highRelevance.length > 0) {
    sections.push("⚠️ **Similar Error Pattern Detected**:");
    highRelevance.forEach((failure) => {
      sections.push(`  - Pattern: ${failure.record.pattern}`);
      sections.push(`    Root Cause: ${failure.record.reason}`);
      sections.push(`    Solution: ${failure.record.preventiveAction}`);
    });
  }

  const avgRelevance = topMatches.reduce((sum, f) => sum + f.relevanceScore, 0) / topMatches.length;
  const recencyBonus = topMatches.some((f) => f.recencyScore > 0.8);

  sections.push("\n**Recommended Approach**:");
  sections.push("1. Review solutions from similar past failures");
  sections.push("2. Verify context-specific differences");
  sections.push("3. Consider staged testing");

  const prompt = sections.join("\n");
  const confidence = Math.min(1, avgRelevance * (recencyBonus ? 1.1 : 0.9));

  return { prompt, confidence };
}

export async function injectFailureContext(errorData: {
  code?: string;
  message: string;
  stack?: string;
  context?: {
    tool?: string;
    agent?: string;
    operation?: string;
    stage?: string;
  };
}): Promise<RAGInjectionResult> {
  const errorSignature = extractErrorSignature(errorData);
  const similarFailures = await searchSimilarFailures(errorSignature, 5);
  const { prompt: injectionPrompt, confidence } = generateRAGInjectionPrompt(similarFailures);

  let recommendationLevel: "critical" | "high" | "medium" | "low" | "none" = "none";
  if (similarFailures.length > 0) {
    const topScore = similarFailures[0]!.relevanceScore;
    if (topScore > 0.8 && similarFailures.length > 2) {
      recommendationLevel = "critical";
    } else if (topScore > 0.75) {
      recommendationLevel = "high";
    } else if (topScore > 0.6) {
      recommendationLevel = "medium";
    } else if (topScore > 0.4) {
      recommendationLevel = "low";
    }
  }

  const result: RAGInjectionResult = {
    errorSignature,
    similarFailures,
    injectionPrompt,
    confidence,
    recommendationLevel,
    timestamp: new Date().toISOString()
  };

  try {
    await artifactWriter.appendJsonl("learning/rag-injection-cache.jsonl", result);
  } catch {
    // Ignore cache write failures
  }

  return result;
}

export async function getRAGInjectionStats(hours: number = 24): Promise<{
  totalInjections: number;
  successRate: number;
  avgConfidence: number;
  topRecommendedErrors: Array<{
    message: string;
    injectionCount: number;
  }>;
}> {
  try {
    const content = await fsPromises.readFile(RAG_INJECTION_CACHE_PATH, "utf-8");
    const injections: RAGInjectionResult[] = content
      .split("\n")
      .filter((line: string) => line.trim())
      .map((line: string) => JSON.parse(line));

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentInjections = injections.filter((i: RAGInjectionResult) => new Date(i.timestamp) > cutoffTime);

    if (recentInjections.length === 0) {
      return {
        totalInjections: 0,
        successRate: 0,
        avgConfidence: 0,
        topRecommendedErrors: []
      };
    }

    const successCount = recentInjections.filter((i: RAGInjectionResult) => i.recommendationLevel !== "none").length;
    const avgConfidence = recentInjections.reduce((sum: number, i: RAGInjectionResult) => sum + i.confidence, 0) / recentInjections.length;

    const errorMap = new Map<string, number>();
    recentInjections.forEach((injection: RAGInjectionResult) => {
      const key = injection.errorSignature.messageKeywords.join(" ") || "unknown";
      errorMap.set(key, (errorMap.get(key) ?? 0) + 1);
    });

    const topErrors = Array.from(errorMap.entries())
      .map(([message, count]) => ({
        message,
        injectionCount: count
      }))
      .sort((a, b) => b.injectionCount - a.injectionCount)
      .slice(0, 10);

    return {
      totalInjections: recentInjections.length,
      successRate: successCount / recentInjections.length,
      avgConfidence,
      topRecommendedErrors: topErrors
    };
  } catch {
    return {
      totalInjections: 0,
      successRate: 0,
      avgConfidence: 0,
      topRecommendedErrors: []
    };
  }
}
