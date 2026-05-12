import { z } from "zod";
import { buildCostSlaResult } from "../../core/application/analytics/services/analytics-cost-sla.js";
import { loadPricingBudgets } from "../../core/application/analytics/services/analytics-pricing.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineEvaluateCostSlaDeps extends RegisterGovToolDeps {
  evaluatePromptMetrics: any;
  outputsDir: string;
}

export function defineEvaluateCostSlaTool(deps: DefineEvaluateCostSlaDeps): void {
  const { govTool, evaluatePromptMetrics, outputsDir } = deps;

  govTool(
    "evaluate_cost_sla",
    {
      title: "コストSLA評価",
      description: "Prompt 推定コストが日次/月次予算SLAを満たすか評価します。",
      inputSchema: {
        prompt: z.string().min(1),
        modelName: z.string().optional(),
        outputTokenEstimate: z.number().optional(),
        expectedDailyRequests: z.number().int().min(1).optional(),
        expectedMonthlyRequests: z.number().int().min(1).optional(),
        dailyBudget: z.number().min(0).optional(),
        monthlyBudget: z.number().min(0).optional()
      }
    },
    async ({ prompt, modelName, outputTokenEstimate, expectedDailyRequests, expectedMonthlyRequests, dailyBudget, monthlyBudget }: {
      prompt: string;
      modelName?: string;
      outputTokenEstimate?: number;
      expectedDailyRequests?: number;
      expectedMonthlyRequests?: number;
      dailyBudget?: number;
      monthlyBudget?: number;
    }) => {
      const rawMetrics = evaluatePromptMetrics(prompt);
      const budgets = await loadPricingBudgets(outputsDir);
      const result = buildCostSlaResult({
        rawMetrics,
        budgets,
        modelName,
        outputTokenEstimate,
        expectedDailyRequests,
        expectedMonthlyRequests,
        dailyBudget,
        monthlyBudget
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
