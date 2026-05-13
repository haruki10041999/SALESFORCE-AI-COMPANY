import { estimatePromptCost, type PromptMetrics } from "../../../prompt/prompt-evaluator.js";
import type { PricingBudgetConfig } from "./analytics-pricing.js";

export interface PromptMetricsSubset {
  estimatedTokens: number;
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  skillCoverageRate: number;
  triggerMatchRate: number;
}

function toPromptMetrics(rawMetrics: PromptMetricsSubset): PromptMetrics {
  return {
    estimatedTokens: rawMetrics.estimatedTokens,
    lengthChars: 0,
    lineCount: 0,
    containsProjectContext: rawMetrics.containsProjectContext,
    containsAgentsSection: rawMetrics.containsAgentsSection,
    containsSkillsSection: rawMetrics.containsSkillsSection,
    containsTaskSection: rawMetrics.containsTaskSection,
    matchedSkillCount: 0,
    totalSkillCount: 0,
    matchedTriggerCount: 0,
    totalTriggerCount: 0,
    skillCoverageRate: rawMetrics.skillCoverageRate,
    triggerMatchRate: rawMetrics.triggerMatchRate
  };
}

export function estimatePromptCostFromSubset(
  rawMetrics: PromptMetricsSubset,
  modelName = "mistral",
  outputTokenEstimate?: number
) {
  return estimatePromptCost(toPromptMetrics(rawMetrics), modelName, outputTokenEstimate);
}

export function buildEstimatePromptCostFeedbackInput(args: {
  costEstimate: ReturnType<typeof estimatePromptCostFromSubset>;
  agent?: string;
}): {
  model: string;
  agent?: string;
  inputTokens: number;
  outputTokens: number;
} {
  return {
    model: args.costEstimate.model,
    agent: args.agent,
    inputTokens: args.costEstimate.breakdown.inputTokens,
    outputTokens: args.costEstimate.breakdown.outputTokens
  };
}

export function buildEstimatePromptCostResponse(
  costEstimate: ReturnType<typeof estimatePromptCostFromSubset>
): Record<string, unknown> {
  return costEstimate as unknown as Record<string, unknown>;
}

export function buildCostSlaResult(args: {
  rawMetrics: PromptMetricsSubset;
  budgets: PricingBudgetConfig;
  modelName?: string;
  outputTokenEstimate?: number;
  expectedDailyRequests?: number;
  expectedMonthlyRequests?: number;
  dailyBudget?: number;
  monthlyBudget?: number;
}) {
  const estimate = estimatePromptCostFromSubset(
    args.rawMetrics,
    args.modelName ?? "mistral",
    args.outputTokenEstimate
  );
  const dailyReq = args.expectedDailyRequests ?? 100;
  const monthlyReq = args.expectedMonthlyRequests ?? 3000;
  const effDailyBudget = args.dailyBudget ?? args.budgets.dailyLimit;
  const effMonthlyBudget = args.monthlyBudget ?? args.budgets.monthlyLimit;

  const projectedDailyCost = estimate.totalCost * dailyReq;
  const projectedMonthlyCost = estimate.totalCost * monthlyReq;

  return {
    model: estimate.model,
    currency: estimate.currency ?? args.budgets.currency,
    requestCost: estimate.totalCost,
    projections: {
      expectedDailyRequests: dailyReq,
      projectedDailyCost,
      dailyBudget: effDailyBudget,
      dailyBudgetRemaining: effDailyBudget - projectedDailyCost,
      dailySlaPass: projectedDailyCost <= effDailyBudget,
      expectedMonthlyRequests: monthlyReq,
      projectedMonthlyCost,
      monthlyBudget: effMonthlyBudget,
      monthlyBudgetRemaining: effMonthlyBudget - projectedMonthlyCost,
      monthlySlaPass: projectedMonthlyCost <= effMonthlyBudget
    }
  };
}
