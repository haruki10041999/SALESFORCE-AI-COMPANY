import type { VectorTier } from "../ports/memory-service.js";

export interface VectorTierInput {
  text: string;
  tags?: string[];
  updatedAt?: string | Date;
  estimatedTokens?: number;
}

function toTimestamp(value: string | Date | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function classifyVectorTier(input: VectorTierInput): VectorTier {
  const ageMs = Date.now() - (toTimestamp(input.updatedAt) ?? Date.now());
  const daysOld = ageMs / (24 * 60 * 60 * 1000);
  const textLength = input.text.length;
  const tokenEstimate = input.estimatedTokens ?? Math.ceil(textLength / 4);
  const tagCount = input.tags?.length ?? 0;

  if (daysOld <= 7 || tokenEstimate <= 120 || textLength <= 500 || tagCount <= 3) {
    return "hot";
  }

  if (daysOld <= 90 || tokenEstimate <= 1200 || textLength <= 4000) {
    return "warm";
  }

  return "cold";
}