export interface PromptMetrics {
  lengthChars: number;
  lineCount: number;
  estimatedTokens: number;
  /** F-06: トークン推定方式 ("tiktoken" or "approx") */
  tokenMethod?: "tiktoken" | "approx";
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  matchedSkillCount: number;
  totalSkillCount: number;
  matchedTriggerCount: number;
  totalTriggerCount: number;
  skillCoverageRate: number;
  triggerMatchRate: number;
}

import { countTokens } from "../mcp/core/prompt/token-counter.js";
import { readFileSync } from "fs";
import { resolve } from "path";

export type PromptCostTier = "batch" | "interactive" | "bulk";

export interface TokenCostBreakdown {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  tierApplied: PromptCostTier;
  discountRate: number;
}

export interface PromptCostEstimate {
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  breakdown: TokenCostBreakdown;
  notes: string[];
}

/** F-23: pricing.json から model レートを取得する */
function loadPricingConfig(): Record<string, any> {
  try {
    const filePath = resolve("outputs", "pricing.json");
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    // フォールバック: デフォルトレート
    return {
      models: {
        mistral: {
          inputTokenRate: 0.00005,
          outputTokenRate: 0.00015,
          currency: "USD"
        }
      },
      defaults: { primaryModel: "mistral", currency: "USD" }
    };
  }
}

/** F-23: トークン数から cost tier を決定する */
function decideTier(inputTokens: number): PromptCostTier {
  if (inputTokens >= 10000) return "bulk";
  if (inputTokens >= 1000) return "batch";
  return "interactive";
}

/**
 * F-23: Prompt metrics から推定コストを計算。
 *
 * @param metrics - evaluatePromptMetrics の出力
 * @param modelName - 使用 LLM モデル名（既定: "mistral"）
 * @param outputTokenEstimate - 出力トークン数予測（既定: 入力の 0.3 倍）
 */
export function estimatePromptCost(
  metrics: PromptMetrics,
  modelName: string = "mistral",
  outputTokenEstimate?: number
): PromptCostEstimate {
  const pricingConfig = loadPricingConfig();
  const modelConfig = pricingConfig.models?.[modelName.toLowerCase()] || pricingConfig.models?.mistral;

  const inputTokens = metrics.estimatedTokens;
  const outputTokens = outputTokenEstimate ?? Math.ceil(inputTokens * 0.3);
  const tier = decideTier(inputTokens);
  const tierConfig = pricingConfig.tiers?.[tier] || { discount: 1.0 };
  const discountRate = tierConfig.discount ?? 1.0;

  const inputCostRate = modelConfig.inputTokenRate ?? 0.00005;
  const outputCostRate = modelConfig.outputTokenRate ?? 0.00015;
  const currency = modelConfig.currency ?? "USD";

  const inputCost = (inputTokens * inputCostRate) * discountRate;
  const outputCost = (outputTokens * outputCostRate) * discountRate;
  const totalCost = inputCost + outputCost;

  const notes: string[] = [];
  if (modelConfig.provider?.includes("local")) {
    notes.push("ローカル実行のため実際の課金なし。参考値のみ。");
  }
  if (discountRate < 1.0) {
    notes.push(`${tier} tier により ${Math.round((1 - discountRate) * 100)}% 割引適用`);
  }

  return {
    model: modelName,
    inputCost,
    outputCost,
    totalCost,
    currency,
    breakdown: {
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost,
      currency,
      tierApplied: tier,
      discountRate
    },
    notes
  };
}

export function evaluatePromptMetrics(
  prompt: string,
  skills: string[] = [],
  triggerKeywords: string[] = []
): PromptMetrics {
  const normalizedPrompt = prompt.toLowerCase();
  const lengthChars = prompt.length;
  const lineCount = prompt.split(/\r?\n/).length;

  const matchedSkills = skills.filter((skill) => normalizedPrompt.includes(skill.toLowerCase()));
  const matchedTriggers = triggerKeywords.filter((keyword) => normalizedPrompt.includes(keyword.toLowerCase()));

  const tokenResult = countTokens(prompt);

  return {
    lengthChars,
    lineCount,
    estimatedTokens: tokenResult.tokens,
    tokenMethod: tokenResult.method,
    containsProjectContext: normalizedPrompt.includes("プロジェクトコンテキスト") || normalizedPrompt.includes("project context"),
    containsAgentsSection: normalizedPrompt.includes("参加エージェント") || normalizedPrompt.includes("agents"),
    containsSkillsSection: normalizedPrompt.includes("適用スキル") || normalizedPrompt.includes("skills"),
    containsTaskSection: normalizedPrompt.includes("タスク") || normalizedPrompt.includes("task"),
    matchedSkillCount: matchedSkills.length,
    totalSkillCount: skills.length,
    matchedTriggerCount: matchedTriggers.length,
    totalTriggerCount: triggerKeywords.length,
    skillCoverageRate: skills.length === 0 ? 1 : matchedSkills.length / skills.length,
    triggerMatchRate: triggerKeywords.length === 0 ? 1 : matchedTriggers.length / triggerKeywords.length
  };
}
