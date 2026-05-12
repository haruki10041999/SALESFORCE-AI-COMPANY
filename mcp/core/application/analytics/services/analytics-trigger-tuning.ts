import type { TriggerRuleRecommendation } from "./analytics-event-insights.js";

export const TRIGGER_TUNING_REPORT_RELATIVE_PATH = "reports/trigger-tuning/latest.json";
export const TRIGGER_TUNING_APPLIED_RULES_RELATIVE_PATH = "reports/trigger-tuning/applied-rules.json";

export interface TriggerTuningReport {
  generatedAt: string;
  sourceEventCount: number;
  minSupport: number;
  minConfidence: number;
  recommendations: TriggerRuleRecommendation[];
}

export function buildTriggerTuningReport(args: {
  sourceEventCount: number;
  minSupport: number;
  minConfidence: number;
  recommendations: TriggerRuleRecommendation[];
}): TriggerTuningReport {
  return {
    generatedAt: new Date().toISOString(),
    sourceEventCount: args.sourceEventCount,
    minSupport: args.minSupport,
    minConfidence: args.minConfidence,
    recommendations: args.recommendations
  };
}

export function buildAppliedTriggerRulesPayload(recommendations: TriggerRuleRecommendation[]): {
  updatedAt: string;
  rules: Array<{ whenAgent: string; thenAgent: string; reason: string; once: boolean }>;
} {
  return {
    updatedAt: new Date().toISOString(),
    rules: recommendations.map((r) => ({
      whenAgent: r.whenAgent,
      thenAgent: r.thenAgent,
      reason: r.reason,
      once: r.once
    }))
  };
}

export function buildTriggerTuningResponse(args: {
  reportPath: string;
  recommendations: TriggerRuleRecommendation[];
  appliedPath: string | null;
}): {
  reportPath: string;
  recommendationCount: number;
  topRecommendations: TriggerRuleRecommendation[];
  appliedPath: string | null;
} {
  return {
    reportPath: args.reportPath,
    recommendationCount: args.recommendations.length,
    topRecommendations: args.recommendations.slice(0, 10),
    appliedPath: args.appliedPath
  };
}
