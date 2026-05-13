/**
 * T-09: Eval Harness – Prompt Template eval cases
 *
 * evaluatePromptMetrics を使い、プロンプトの品質指標を検証する。
 */

import type { EvalCase } from "../../mcp/core/learning/eval-harness.js";
import { evaluatePromptMetrics } from "../../mcp/core/prompt/prompt-evaluator.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(__dirname, "datasets/prompt-templates.json");

interface PromptTemplateCase {
  name: string;
  agents: string[];
  skills: string[];
  topic: string;
  expectSections?: string[];
  maxTokens?: number;
}

const dataset: PromptTemplateCase[] = JSON.parse(readFileSync(datasetPath, "utf-8")) as PromptTemplateCase[];

/** シンプルなプロンプトテンプレートを組み立てるヘルパー（テスト用） */
function buildTestPrompt(item: PromptTemplateCase): string {
  const sections: string[] = [
    `# Role`,
    `You are acting as: ${item.agents.join(", ") || "AI assistant"}.`,
    ``,
    `# Task`,
    `Topic: ${item.topic}`,
    ``
  ];

  if (item.skills.length > 0) {
    sections.push(`# Skills`);
    sections.push(item.skills.join("\n"));
    sections.push(``);
  }

  return sections.join("\n");
}

export const promptTemplateEvals: EvalCase[] = dataset.map((item) => ({
  name: item.name,
  group: "prompt-templates",
  run: async () => {
    const prompt = buildTestPrompt(item);
    const metrics = evaluatePromptMetrics(prompt, item.skills);
    return { prompt, metrics };
  },
  rubric: {
    scorer: (output) => {
      const { metrics, prompt } = output as {
        prompt: string;
        metrics: ReturnType<typeof evaluatePromptMetrics>;
      };

      const scores: number[] = [];

      // セクション存在チェック
      if (item.expectSections && item.expectSections.length > 0) {
        const lc = prompt.toLowerCase();
        const matched = item.expectSections.filter((s) => lc.includes(`# ${s.toLowerCase()}`)).length;
        scores.push(matched / item.expectSections.length);
      }

      // トークン上限チェック
      if (item.maxTokens !== undefined) {
        scores.push(metrics.estimatedTokens <= item.maxTokens ? 1 : 0);
      }

      // スキルカバレッジ（スキルがある場合のみ）
      if (item.skills.length > 0) {
        scores.push(metrics.skillCoverageRate);
      }

      return scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 1;
    },
    minScore: 0.8
  }
}));
