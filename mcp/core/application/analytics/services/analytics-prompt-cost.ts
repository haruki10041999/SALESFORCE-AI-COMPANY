import { estimatePromptCost } from "../../../../../prompt-engine/prompt-evaluator.js";
import { appendOutputRatioFeedback } from "../../../learning/cost-feedback.js";

export interface EstimatePromptCostInput {
  prompt: string;
  modelName?: string;
  outputTokenEstimate?: number;
  agent?: string;
  evaluatePromptMetrics: (prompt: string) => Record<string, unknown>;
  outputRatioFeedbackFile: string;
}

export async function executeEstimatePromptCost(input: EstimatePromptCostInput): Promise<any> {
  const {
    prompt,
    modelName,
    outputTokenEstimate,
    agent,
    evaluatePromptMetrics,
    outputRatioFeedbackFile
  } = input;

  // deps から受け取った evaluatePromptMetrics を使用
  const rawMetrics = evaluatePromptMetrics(prompt);
  // deps の返却型は PromptMetrics のサブセット。costEstimate 計算に必要なフィールドのみ使用
  const metrics = {
    estimatedTokens: (rawMetrics as any).estimatedTokens,
    lengthChars: 0,
    lineCount: 0,
    containsProjectContext: (rawMetrics as any).containsProjectContext,
    containsAgentsSection: (rawMetrics as any).containsAgentsSection,
    containsSkillsSection: (rawMetrics as any).containsSkillsSection,
    containsTaskSection: (rawMetrics as any).containsTaskSection,
    matchedSkillCount: 0,
    totalSkillCount: 0,
    matchedTriggerCount: 0,
    totalTriggerCount: 0,
    skillCoverageRate: (rawMetrics as any).skillCoverageRate,
    triggerMatchRate: (rawMetrics as any).triggerMatchRate
  };
  const costEstimate = estimatePromptCost(metrics, modelName ?? "mistral", outputTokenEstimate);
  await appendOutputRatioFeedback(outputRatioFeedbackFile, {
    model: costEstimate.model,
    agent,
    inputTokens: costEstimate.breakdown.inputTokens,
    outputTokens: costEstimate.breakdown.outputTokens
  });
  return costEstimate;
}
