import { z } from "zod";
import { resolve } from "path";
import { executeEstimatePromptCost } from "../../core/application/analytics/services/analytics-prompt-cost.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineEstimatePromptCostDeps extends RegisterGovToolDeps {
  evaluatePromptMetrics: any;
  outputRatioFeedbackFile?: string;
  outputsDir: string;
}

export function defineEstimatePromptCostTool(deps: DefineEstimatePromptCostDeps): void {
  const { govTool, evaluatePromptMetrics, outputRatioFeedbackFile, outputsDir } = deps;

  const resolvedOutputRatioFeedbackFile = outputRatioFeedbackFile ?? resolve(outputsDir, "output-ratio.jsonl");

  govTool(
    "estimate_prompt_cost",
    {
      title: "Prompt コスト見積",
      description: "Prompt のトークン数とモデルレート から推定コストを計算します。",
      inputSchema: {
        prompt: z.string().min(1),
        modelName: z.string().optional().describe("使用 LLM モデル (既定: mistral)"),
        outputTokenEstimate: z.number().optional().describe("出力トークン予測 (既定: 入力の 0.3 倍)"),
        agent: z.string().optional().describe("呼び出し元エージェント名 (output ratio feedback 用)")
      }
    },
    async ({ prompt, modelName, outputTokenEstimate, agent }: {
      prompt: string;
      modelName?: string;
      outputTokenEstimate?: number;
      agent?: string;
    }) => {
      const result = await executeEstimatePromptCost({
        prompt,
        modelName,
        outputTokenEstimate,
        agent,
        evaluatePromptMetrics,
        outputRatioFeedbackFile: resolvedOutputRatioFeedbackFile
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
